import test from "node:test";
import assert from "node:assert";
import { ComputedSignal } from "../ui/signals.ts";
import Expression from "../lib/common/expression.ts";
import {
  covers,
  subtract,
  areEquivalent,
} from "../lib/common/expression/synth.ts";

// Import actual reactive-store exports (using mocked store.ts via esbuild plugin)
import {
  fetch as reactiveStoreFetch,
  count as reactiveStoreCount,
  createBookmark as reactiveStoreCreateBookmark,
  pagedFetch,
  invalidate,
  evaluateExpression,
  resetRetryState,
  QuerySignal,
  Bookmark,
} from "../ui/reactive-store.ts";
import {
  toBookmark,
  bookmarkToExpression,
} from "../lib/common/expression/pagination.ts";

// Test-only exports added by build/test.ts plugin at build time
import * as reactiveStore from "../ui/reactive-store.ts";
const compareFunction = (reactiveStore as Record<string, unknown>)[
  "_testCompareFunction"
] as (sort: Record<string, number>) => (a: unknown, b: unknown) => number;
function getObjectId(resourceType: string, obj: unknown): string {
  const record = obj as Record<string, unknown>;
  const key = resourceType === "devices" ? "DeviceID.ID" : "_id";
  return (record[key] as string) ?? "";
}
const applyDefaultSort = (reactiveStore as Record<string, unknown>)[
  "_testApplyDefaultSort"
] as (
  resourceType: string,
  sort?: Record<string, number>,
) => Record<string, number>;

const stores = (reactiveStore as Record<string, unknown>)["_testStores"] as Map<
  string,
  unknown
>;
const getStore = (reactiveStore as Record<string, unknown>)[
  "_testGetStore"
] as (resource: string) => unknown;

// The region store's internals: an
// immutable array of disjoint regions, each owning its objects.
interface TestRegion {
  filter: Expression;
  state: "fresh" | "stale" | "pending";
  timestamp: number;
  issuedAt: number;
  objects: unknown[];
}

function getRegions(resource: string): TestRegion[] {
  const store = getStore(resource);
  return (
    store as { regionsSignal: { get(): TestRegion[] } }
  ).regionsSignal.get();
}

function getCacheState(resource: string): {
  objectCount: number;
  regionCount: number;
  regions: Array<{ filter: Expression; timestamp: number }>;
  fetchQueryCount: number;
} {
  const store = getStore(resource);
  const regions = getRegions(resource);
  const fetchQueries = (
    store as {
      fetchQueries: Map<
        string,
        { weakRef: globalThis.WeakRef<QuerySignal<unknown[]>> }
      >;
    }
  ).fetchQueries;

  let activeFetchQueries = 0;
  for (const [, entry] of fetchQueries) {
    if (entry.weakRef.deref()) activeFetchQueries++;
  }

  let objectCount = 0;
  for (const region of regions) objectCount += region.objects.length;

  return {
    objectCount,
    regionCount: regions.length,
    regions: regions.map((r) => ({
      filter: r.filter,
      timestamp: r.timestamp,
    })),
    fetchQueryCount: activeFetchQueries,
  };
}

function clearStores(): void {
  // Cancel scheduled retries first: a zombie retry from a failure test must
  // not fire requests into a later test's mock handlers and request log.
  resetRetryState();
  stores.clear();
}

function getCachedObjectIds(resource: string): string[] {
  const ids: string[] = [];
  for (const region of getRegions(resource))
    for (const obj of region.objects) ids.push(getObjectId(resource, obj));
  return ids;
}

function forcePruneCache(resource: string): void {
  const store = getStore(resource);
  (store as { pruneCache: () => void }).pruneCache();
}

// Import mock utilities for controlling request behavior in tests
import {
  mockRegisterHandler,
  mockClearHandlers,
  mockFetchHandler,
  mockCountHandler,
  mockGetRequestLog,
  mockClearRequestLog,
} from "./mocks/api-client.ts";

// =============================================================================
// compareFunction Tests
// =============================================================================

void test("compareFunction sorts by multiple fields with mixed asc/desc", () => {
  const sort = { category: 1, priority: -1, name: 1 };
  const compare = compareFunction(sort);

  const items = [
    { category: "b", priority: 1, name: "z" },
    { category: "a", priority: 2, name: "y" },
    { category: "a", priority: 2, name: "x" },
    { category: "a", priority: 1, name: "w" },
  ];
  items.sort(compare);

  assert.deepStrictEqual(items, [
    { category: "a", priority: 2, name: "x" },
    { category: "a", priority: 2, name: "y" },
    { category: "a", priority: 1, name: "w" },
    { category: "b", priority: 1, name: "z" },
  ]);
});

void test("compareFunction handles DeviceID.ID nested value objects", () => {
  const sort = { "DeviceID.ID": 1 };
  const compare = compareFunction(sort);

  const items = [
    { "DeviceID.ID": { value: ["device-c"] } },
    { "DeviceID.ID": { value: ["device-a"] } },
    { "DeviceID.ID": {} }, // missing value array treated as null
    { "DeviceID.ID": { value: ["device-b"] } },
  ];
  items.sort(compare);

  // null/missing comes first due to type weight ordering
  assert.strictEqual(
    (items[0]["DeviceID.ID"] as { value?: string[] }).value,
    undefined,
  );
  assert.strictEqual(
    (items[1]["DeviceID.ID"] as { value: string[] }).value[0],
    "device-a",
  );
});

void test("compareFunction handles mixed types with correct ordering", () => {
  const sort = { value: 1 };
  const compare = compareFunction(sort);

  // Test that type weights work: null=1, number=2, string=3
  const items = [{ value: "z" }, { value: 5 }, { value: null }];
  items.sort(compare);

  assert.strictEqual(items[0].value, null);
  assert.strictEqual(items[1].value, 5);
  assert.strictEqual(items[2].value, "z");
});

// =============================================================================
// applyDefaultSort Tests
// =============================================================================

void test("applyDefaultSort adds correct default key without overriding", () => {
  assert.deepStrictEqual(applyDefaultSort("devices"), { "DeviceID.ID": 1 });
  assert.deepStrictEqual(applyDefaultSort("presets"), { _id: 1 });
  assert.deepStrictEqual(applyDefaultSort("devices", { name: -1 }), {
    name: -1,
    "DeviceID.ID": 1,
  });
  assert.deepStrictEqual(applyDefaultSort("devices", { "DeviceID.ID": -1 }), {
    "DeviceID.ID": -1,
  });

  // Does not mutate original
  const original = { name: 1 };
  applyDefaultSort("devices", original);
  assert.deepStrictEqual(original, { name: 1 });
});

// =============================================================================
// QuerySignal Tests
// =============================================================================

void test("QuerySignal state management and disposal", () => {
  const signal = new QuerySignal<number>(0);

  let state = signal.get();
  assert.strictEqual(state.value, 0);
  assert.strictEqual(state.timestamp, 0);
  assert.strictEqual(state.loading, true);

  const now = Date.now();
  signal._update(42, now, false);
  state = signal.get();
  assert.strictEqual(state.value, 42);
  assert.strictEqual(state.loading, false);

  const stateBefore = signal.get();
  signal._update(42, now, false);
  assert.strictEqual(signal.get(), stateBefore);

  signal[Symbol.dispose]();
  assert.throws(() => signal.get(), { message: "Cannot read disposed signal" });
  signal[Symbol.dispose](); // Double disposal is safe
});

void test("QuerySignal registers dependency when read by ComputedSignal", () => {
  const querySignal = new QuerySignal<number>(0);

  let computeCount = 0;
  const computed = new ComputedSignal(() => {
    computeCount++;
    return querySignal.get().value * 2;
  });

  assert.strictEqual(computed.get(), 0);
  assert.strictEqual(computeCount, 1);

  querySignal._update(21, Date.now(), false);

  assert.strictEqual(computed.get(), 42);
  assert.strictEqual(computeCount, 2);
});

// =============================================================================
// fetch() Tests
// =============================================================================

void test("fetch() returns QuerySignal and populates data", async () => {
  mockClearHandlers();

  const testData = [
    { _id: "preset-1", name: "First Preset" },
    { _id: "preset-2", name: "Second Preset" },
  ];

  mockRegisterHandler(mockFetchHandler("api/presets/", testData));

  const filter: Expression = new Expression.Literal(true);
  const signal = reactiveStoreFetch("presets", filter);

  assert.ok(signal instanceof QuerySignal);

  await new Promise((resolve) => setTimeout(resolve, 50));

  const state = signal.get();
  assert.strictEqual(state.loading, false);
  assert.strictEqual(state.value.length, 2);
  assert.strictEqual((state.value[0] as { _id: string })._id, "preset-1");
});

void test("fetch() applies default sort based on resource type", async () => {
  mockClearHandlers();

  const deviceData = [
    { "DeviceID.ID": { value: ["device-b"] } },
    { "DeviceID.ID": { value: ["device-a"] } },
  ];

  mockRegisterHandler(mockFetchHandler("api/devices/", deviceData));

  const signal = reactiveStoreFetch("devices", new Expression.Literal(true));
  await new Promise((resolve) => setTimeout(resolve, 50));

  const state = signal.get();
  assert.strictEqual(state.value.length, 2);
  const firstDevice = state.value[0] as {
    "DeviceID.ID": { value: string[] };
  };
  assert.strictEqual(firstDevice["DeviceID.ID"].value[0], "device-a");
});

void test("fetch() returns same signal for same query", () => {
  mockClearHandlers();
  const testData = [
    { _id: "fault-1", type: "test" },
    { _id: "fault-2", type: "other" },
    { _id: "fault-3", type: "test" },
  ];
  mockRegisterHandler(mockFetchHandler("api/faults/", testData));

  const filter: Expression = Expression.parse('type = "test"');
  const signal1 = reactiveStoreFetch("faults", filter);
  const signal2 = reactiveStoreFetch("faults", filter);

  assert.strictEqual(signal1, signal2);
});

void test("fetch() with custom sort option", async () => {
  mockClearHandlers();

  const testData = [
    { _id: "3", priority: 1 },
    { _id: "1", priority: 3 },
    { _id: "2", priority: 2 },
  ];

  mockRegisterHandler(mockFetchHandler("api/faults/", testData));

  const signal = reactiveStoreFetch("faults", new Expression.Literal(true), {
    sort: { priority: -1 },
  });

  await new Promise((resolve) => setTimeout(resolve, 50));

  const state = signal.get();
  assert.strictEqual((state.value[0] as { priority: number }).priority, 3);
  assert.strictEqual((state.value[1] as { priority: number }).priority, 2);
  assert.strictEqual((state.value[2] as { priority: number }).priority, 1);
});

void test("fetch() filters data correctly", async () => {
  mockClearHandlers();
  clearStores();

  const testData = [
    { _id: "task-1", status: "pending", priority: 1 },
    { _id: "task-2", status: "completed", priority: 2 },
    { _id: "task-3", status: "pending", priority: 3 },
    { _id: "task-4", status: "completed", priority: 1 },
    { _id: "task-5", status: "pending", priority: 2 },
  ];

  mockRegisterHandler(mockFetchHandler("api/faults/", testData));

  const filter: Expression = Expression.parse('status = "pending"');
  const signal = reactiveStoreFetch("faults", filter);

  await new Promise((resolve) => setTimeout(resolve, 50));

  const state = signal.get();
  assert.strictEqual(state.value.length, 3, "Should return 3 pending tasks");
  assert.ok(
    state.value.every(
      (item) => (item as { status: string }).status === "pending",
    ),
    "All returned items should have status 'pending'",
  );

  const ids = state.value.map((item) => (item as { _id: string })._id).sort();
  assert.deepStrictEqual(ids, ["task-1", "task-3", "task-5"]);
});

// =============================================================================
// count() Tests
// =============================================================================

void test("count() returns QuerySignal with count value", async () => {
  mockClearHandlers();

  const testData = Array.from({ length: 42 }, (_, i) => ({
    _id: `preset-${i}`,
    name: `Preset ${i}`,
    active: i < 15,
  }));
  mockRegisterHandler(mockCountHandler("api/presets/", testData));

  const filter: Expression = Expression.parse("active = true");
  const signal = reactiveStoreCount("presets", filter);

  assert.ok(signal instanceof QuerySignal);

  await new Promise((resolve) => setTimeout(resolve, 50));

  const state = signal.get();
  assert.strictEqual(state.loading, false);
  assert.strictEqual(state.value, 15);
});

void test("count() returns same signal for same query", () => {
  mockClearHandlers();
  const testData = [
    ...Array.from({ length: 10 }, (_, i) => ({ _id: `ui.config-${i}` })),
    ...Array.from({ length: 5 }, (_, i) => ({ _id: `api.config-${i}` })),
  ];
  mockRegisterHandler(mockCountHandler("api/config/", testData));

  const filter: Expression = Expression.parse('_id LIKE "ui.%"');
  const signal1 = reactiveStoreCount("config", filter);
  const signal2 = reactiveStoreCount("config", filter);

  assert.strictEqual(signal1, signal2);
});

// =============================================================================
// createBookmark() / pagedFetch() Tests
// =============================================================================

// A mock GET handler that honors filter, sort, skip and limit query params —
// createBookmark's coverage-anchored probes depend on all four.
function mockQueryHandler(
  urlPattern: string,
  data: unknown[],
  delayMs = 0,
): (options: { url: string; method: string }) => unknown {
  return (options) => {
    if (options.method && options.method !== "GET") return undefined;
    if (!options.url.includes(urlPattern)) return undefined;

    const queryStart = options.url.indexOf("?");
    const params = Object.fromEntries(
      new URLSearchParams(
        queryStart === -1 ? "" : options.url.slice(queryStart + 1),
      ),
    );

    let rows = data;
    if (params["filter"]) {
      const expr = Expression.parse(params["filter"]);
      rows = rows.filter((obj) => {
        const result = evaluateExpression(expr, obj as Record<string, unknown>);
        return !!result.value;
      });
    }
    if (params["sort"])
      rows = [...rows].sort(
        compareFunction(JSON.parse(params["sort"]) as Record<string, number>),
      );
    if (params["skip"]) rows = rows.slice(+params["skip"]);
    if (params["limit"]) rows = rows.slice(0, +params["limit"]);

    if (delayMs > 0)
      return new Promise((resolve) => setTimeout(() => resolve(rows), delayMs));
    return rows;
  };
}

function getRequestParams(url: string): Record<string, string> {
  const queryStart = url.indexOf("?");
  return Object.fromEntries(
    new URLSearchParams(queryStart === -1 ? "" : url.slice(queryStart + 1)),
  );
}

// Rows of `data` matching the given filter string
function matchingRows(data: unknown[], filterStr: string): unknown[] {
  const expr = Expression.parse(filterStr);
  return data.filter(
    (obj) => !!evaluateExpression(expr, obj as Record<string, unknown>).value,
  );
}

void test("createBookmark() probes the remainder and bounds the first `limit` records", async () => {
  mockClearHandlers();
  clearStores();

  const testData = Array.from({ length: 12 }, (_, i) => ({
    _id: `preset-${String(i + 1).padStart(2, "0")}`,
  }));
  mockRegisterHandler(mockQueryHandler("api/presets/", testData));

  const filter: Expression = new Expression.Literal(true);
  const sort = { _id: 1 };
  const signal = reactiveStoreCreateBookmark("presets", filter, sort, 5);

  assert.ok(signal instanceof QuerySignal);

  await new Promise((resolve) => setTimeout(resolve, 50));

  const state = signal.get();
  assert.strictEqual(state.loading, false);
  assert.ok(state.value instanceof Bookmark);
  assert.ok(state.timestamp > 0);

  // With no coverage the probe targets the whole filter at skip = limit − 1
  const log = mockGetRequestLog();
  assert.strictEqual(log.length, 1);
  const params = getRequestParams(log[0].url);
  assert.strictEqual(params["filter"], "TRUE");
  assert.strictEqual(params["skip"], "4");
  assert.strictEqual(params["limit"], "1");
  assert.strictEqual(params["projection"], "_id");

  // The bookmark must bound exactly the first 5 records
  const bounded = state.value!.applySkip(filter);
  assert.deepStrictEqual(
    matchingRows(testData, bounded.toString()),
    testData.slice(0, 5),
  );
});

void test("createBookmark() returns null when limit exceeds result count", async () => {
  mockClearHandlers();
  clearStores();

  const testData = [{ _id: "preset-1" }, { _id: "preset-2" }];
  mockRegisterHandler(mockQueryHandler("api/presets/", testData));

  const filter: Expression = new Expression.Literal(true);
  const sort = { _id: 1 };
  const signal = reactiveStoreCreateBookmark("presets", filter, sort, 1000);

  await new Promise((resolve) => setTimeout(resolve, 50));

  const state = signal.get();
  assert.strictEqual(state.loading, false);
  assert.strictEqual(state.value, null);
  assert.ok(state.timestamp > 0, "resolved null must not look unresolved");
});

void test("createBookmark() resolves synchronously without requests when limit records are cached", async () => {
  mockClearHandlers();
  clearStores();

  const testData = Array.from({ length: 8 }, (_, i) => ({
    _id: `fault-${i + 1}`,
  }));
  mockRegisterHandler(mockQueryHandler("api/faults/", testData));

  // Cover the whole filter so all 8 objects are cached and fresh
  const filter: Expression = new Expression.Literal(true);
  reactiveStoreFetch("faults", filter);
  await new Promise((resolve) => setTimeout(resolve, 50));

  mockClearRequestLog();

  // m = 8 ≥ limit = 5 → bound by the 5th cached match, zero requests,
  // resolved synchronously (no await needed)
  const sort = { _id: 1 };
  const signal = reactiveStoreCreateBookmark("faults", filter, sort, 5);

  const state = signal.get();
  assert.strictEqual(state.loading, false);
  assert.ok(state.value instanceof Bookmark);
  assert.strictEqual(mockGetRequestLog().length, 0);

  const bounded = state.value!.applySkip(filter);
  assert.deepStrictEqual(
    matchingRows(testData, bounded.toString()),
    testData.slice(0, 5),
  );

  // Fully covered with m = 8 < limit → null (fewer than limit records
  // exist), still synchronous and request-free
  const signal2 = reactiveStoreCreateBookmark("faults", filter, sort, 20);
  const state2 = signal2.get();
  assert.strictEqual(state2.loading, false);
  assert.strictEqual(state2.value, null);
  assert.ok(state2.timestamp > 0);
  assert.strictEqual(mockGetRequestLog().length, 0);
});

void test("Bookmark.applySkip() and applyLimit() modify filter correctly", async () => {
  mockClearHandlers();
  clearStores();

  const testData = Array.from({ length: 12 }, (_, i) => ({
    _id: `preset-${String(i + 1).padStart(2, "0")}`,
    active: true,
  }));
  mockRegisterHandler(mockQueryHandler("api/presets/", testData));

  const filter: Expression = Expression.parse("active = true");
  const sort = { _id: 1 };
  const signal = reactiveStoreCreateBookmark("presets", filter, sort, 10);

  await new Promise((resolve) => setTimeout(resolve, 50));

  const state = signal.get();
  assert.ok(state.value instanceof Bookmark);

  const skipFilter = state.value!.applySkip(filter);
  assert.ok(
    skipFilter instanceof Expression,
    "skipFilter should be an Expression",
  );
  // applySkip returns AND(filter, bookmarkCondition)
  assert.ok(
    skipFilter instanceof Expression.Binary && skipFilter.operator === "AND",
    "skipFilter should be an AND expression",
  );

  const limitFilter = state.value!.applyLimit(filter);
  assert.ok(
    limitFilter instanceof Expression,
    "limitFilter should be an Expression",
  );
  // applyLimit returns AND(filter, NOT(bookmarkCondition))
  assert.ok(
    limitFilter instanceof Expression.Binary && limitFilter.operator === "AND",
    "limitFilter should be an AND expression",
  );
});

void test('pagedFetch() "show more" probes the remainder and fetches only the new chunk', async () => {
  mockClearHandlers();
  clearStores();

  const testData = Array.from({ length: 25 }, (_, i) => ({
    "DeviceID.ID": { value: [`device-${String(i + 1).padStart(2, "0")}`] },
  }));
  mockRegisterHandler(mockQueryHandler("api/devices/", testData));

  const filter: Expression = new Expression.Literal(true);
  const ids = (rows: unknown[]): string[] =>
    rows.map(
      (r) =>
        (r as { "DeviceID.ID": { value: string[] } })["DeviceID.ID"].value[0],
    );

  // --- Page 1: limit 10 ---
  // pagedFetch is a snapshot; re-call it after each resolution step the way
  // a reactive computation would re-run.
  const q1 = pagedFetch("devices", filter, { limit: 10 });
  assert.deepStrictEqual(q1, { value: [], loading: true });

  await new Promise((resolve) => setTimeout(resolve, 50));
  const q2 = pagedFetch("devices", filter, { limit: 10 });
  assert.strictEqual(q2.loading, true, "bounded fetch should be in flight");

  await new Promise((resolve) => setTimeout(resolve, 50));
  const q3 = pagedFetch("devices", filter, { limit: 10 });
  assert.strictEqual(q3.loading, false);
  assert.deepStrictEqual(ids(q3.value), ids(testData.slice(0, 10)));

  // Two requests: the probe (skip=9, limit=1) and the bounded chunk fetch
  const log1 = mockGetRequestLog();
  assert.strictEqual(log1.length, 2);
  const probe1 = getRequestParams(log1[0].url);
  assert.strictEqual(probe1["skip"], "9");
  assert.strictEqual(probe1["limit"], "1");
  assert.strictEqual(probe1["filter"], "TRUE");
  const chunk1 = getRequestParams(log1[1].url);
  assert.strictEqual(chunk1["limit"], undefined);
  assert.deepStrictEqual(
    ids(matchingRows(testData, chunk1["filter"])),
    ids(testData.slice(0, 10)),
    "chunk fetch must cover exactly the first 10 records",
  );

  mockClearRequestLog();

  // --- "Show more": limit 20 ---
  // While the new bookmark probe is in flight, the cached covered prefix
  // (the 10 records already on screen) is served — no blank flash
  const p1 = pagedFetch("devices", filter, { limit: 20 });
  assert.strictEqual(p1.loading, true);
  assert.deepStrictEqual(ids(p1.value), ids(testData.slice(0, 10)));

  await new Promise((resolve) => setTimeout(resolve, 50));
  pagedFetch("devices", filter, { limit: 20 });
  await new Promise((resolve) => setTimeout(resolve, 50));
  const p3 = pagedFetch("devices", filter, { limit: 20 });
  assert.strictEqual(p3.loading, false);
  assert.deepStrictEqual(ids(p3.value), ids(testData.slice(0, 20)));

  const log2 = mockGetRequestLog();
  assert.strictEqual(log2.length, 2);

  // The probe is coverage-anchored: it targets the remainder (everything
  // after the 10 cached records) at skip = 20 − 10 − 1 = 9, not skip 19
  const probe2 = getRequestParams(log2[0].url);
  assert.strictEqual(probe2["skip"], "9");
  assert.strictEqual(probe2["limit"], "1");
  assert.deepStrictEqual(
    ids(matchingRows(testData, probe2["filter"])),
    ids(testData.slice(10)),
    "probe must exclude the covered region",
  );

  // The chunk fetch covers only (bm10, bm20] — no covered row re-fetched
  const chunk2 = getRequestParams(log2[1].url);
  assert.deepStrictEqual(
    ids(matchingRows(testData, chunk2["filter"])),
    ids(testData.slice(10, 20)),
    "chunk fetch must cover exactly records 11–20",
  );
});

void test("invalidate() while a bookmark probe is in flight does not double-fire", async () => {
  mockClearHandlers();
  clearStores();

  const testData = Array.from({ length: 12 }, (_, i) => ({
    _id: `file-${String(i + 1).padStart(2, "0")}`,
  }));
  mockRegisterHandler(mockQueryHandler("api/files/", testData, 100));

  const filter: Expression = new Expression.Literal(true);
  const sort = { _id: 1 };
  const signal = reactiveStoreCreateBookmark("files", filter, sort, 5);
  assert.strictEqual(signal.get().loading, true);

  // Invalidate mid-probe: the !state.loading guard must skip re-triggering
  await new Promise((resolve) => setTimeout(resolve, 20));
  const invalidationTime = Date.now();
  invalidate(invalidationTime);

  await new Promise((resolve) => setTimeout(resolve, 150));
  const state = signal.get();
  assert.strictEqual(state.loading, false);
  assert.ok(state.value instanceof Bookmark);
  assert.strictEqual(mockGetRequestLog().length, 1, "must not double-fire");

  // The probe predates the invalidation, so the result resolved stale —
  // the next demand at that freshness re-probes
  assert.ok(state.timestamp < invalidationTime);
  const signal2 = reactiveStoreCreateBookmark("files", filter, sort, 5, {
    freshness: invalidationTime,
  });
  assert.strictEqual(signal2, signal);
  assert.strictEqual(signal2.get().loading, true);
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.strictEqual(signal2.get().loading, false);
  assert.strictEqual(mockGetRequestLog().length, 2);
});

void test("pagedFetch() never falls through to an unbounded fetch while the probe is pending", async () => {
  mockClearHandlers();
  clearStores();

  const testData = Array.from({ length: 12 }, (_, i) => ({
    _id: `provision-${String(i + 1).padStart(2, "0")}`,
  }));
  mockRegisterHandler(mockQueryHandler("api/provisions/", testData, 100));

  const filter: Expression = new Expression.Literal(true);

  const q1 = pagedFetch("provisions", filter, { limit: 5 });
  assert.deepStrictEqual(q1, { value: [], loading: true });
  const q2 = pagedFetch("provisions", filter, { limit: 5 });
  assert.deepStrictEqual(q2, { value: [], loading: true });

  // Only the probe may have been issued — nothing unbounded
  let log = mockGetRequestLog();
  assert.strictEqual(log.length, 1);
  assert.strictEqual(getRequestParams(log[0].url)["limit"], "1");

  await new Promise((resolve) => setTimeout(resolve, 150));
  pagedFetch("provisions", filter, { limit: 5 });
  await new Promise((resolve) => setTimeout(resolve, 150));

  const q3 = pagedFetch("provisions", filter, { limit: 5 });
  assert.strictEqual(q3.loading, false);
  assert.strictEqual(q3.value.length, 5);

  // Every data request (the non-probe) was bounded by the bookmark
  log = mockGetRequestLog();
  assert.strictEqual(log.length, 2);
  const chunk = getRequestParams(log[1].url);
  assert.strictEqual(
    matchingRows(testData, chunk["filter"]).length,
    5,
    "data fetch must be bounded to the first 5 records",
  );
});

void test("pagedFetch() serves only the sort-contiguous covered prefix while the probe is pending", async () => {
  mockClearHandlers();
  clearStores();

  const testData = Array.from({ length: 10 }, (_, i) => ({
    _id: `item-${i}`,
  }));
  mockRegisterHandler(mockQueryHandler("api/config/", testData));
  const itemIds = (rows: unknown[]): string[] =>
    rows.map((r) => (r as { _id: string })._id);

  // Cover only a middle slice: item-3..5 get cached
  reactiveStoreFetch(
    "config",
    Expression.parse('_id >= "item-3" AND _id < "item-6"'),
  );
  await new Promise((resolve) => setTimeout(resolve, 50));

  // A paged query over the whole collection must NOT present the cached
  // middle records as its first rows — they aren't a prefix of the sort
  // order, so the gate shows nothing until the probe resolves
  const filter: Expression = new Expression.Literal(true);
  const q1 = pagedFetch("config", filter, { limit: 2 });
  assert.deepStrictEqual(q1, { value: [], loading: true });

  await new Promise((resolve) => setTimeout(resolve, 50));
  pagedFetch("config", filter, { limit: 2 });
  await new Promise((resolve) => setTimeout(resolve, 50));
  const q2 = pagedFetch("config", filter, { limit: 2 });
  assert.strictEqual(q2.loading, false);
  assert.deepStrictEqual(itemIds(q2.value), ["item-0", "item-1"]);

  mockClearRequestLog();

  // "Show more": the contiguous prefix is item-0..1; the cached middle
  // slice still isn't part of it (item-2 is uncovered), so the gate
  // serves exactly the records already on screen
  const q3 = pagedFetch("config", filter, { limit: 4 });
  assert.strictEqual(q3.loading, true);
  assert.deepStrictEqual(itemIds(q3.value), ["item-0", "item-1"]);

  await new Promise((resolve) => setTimeout(resolve, 50));
  pagedFetch("config", filter, { limit: 4 });
  await new Promise((resolve) => setTimeout(resolve, 50));
  const q4 = pagedFetch("config", filter, { limit: 4 });
  assert.strictEqual(q4.loading, false);
  assert.deepStrictEqual(itemIds(q4.value), [
    "item-0",
    "item-1",
    "item-2",
    "item-3",
  ]);

  // m counted only the contiguous prefix (2 records), not the cached
  // middle slice: the probe ran over the remainder (item-2 onward,
  // including the covered slice — the server counts it) at
  // skip = 4 − 2 − 1 = 1, landing exactly on item-3
  const log = mockGetRequestLog();
  assert.strictEqual(log.length, 2);
  const probe = getRequestParams(log[0].url);
  assert.strictEqual(probe["skip"], "1");
  assert.strictEqual(probe["limit"], "1");
  // ... while the chunk fetch requested only the uncovered gap (item-2),
  // not the already-cached item-3
  const chunk = getRequestParams(log[1].url);
  assert.deepStrictEqual(itemIds(matchingRows(testData, chunk["filter"])), [
    "item-2",
  ]);
});

// =============================================================================
// Caching Tests - fetch() results caching
// =============================================================================

void test("fetch() uses cached data without making new request", async () => {
  mockClearHandlers();
  clearStores();

  const testData = [
    { _id: "item-1", name: "First" },
    { _id: "item-2", name: "Second" },
  ];

  mockRegisterHandler(mockFetchHandler("api/provisions/", testData));

  const filter: Expression = new Expression.Literal(true);
  const signal1 = reactiveStoreFetch("provisions", filter);

  await new Promise((resolve) => setTimeout(resolve, 50));

  const state1 = signal1.get();
  assert.strictEqual(state1.loading, false);
  assert.strictEqual(state1.value.length, 2);

  mockClearRequestLog();

  const signal2 = reactiveStoreFetch("provisions", filter);
  assert.strictEqual(signal1, signal2);

  const log = mockGetRequestLog();
  assert.strictEqual(
    log.length,
    0,
    "Should not make new request for cached query",
  );
});

void test("fetch() with freshness=0 uses cached objects without refetch", async () => {
  mockClearHandlers();

  const testData = [
    { _id: "cached-1", value: "original" },
    { _id: "cached-2", value: "original" },
  ];

  mockRegisterHandler(mockFetchHandler("api/config/", testData));

  const signal1 = reactiveStoreFetch("config", new Expression.Literal(true));
  await new Promise((resolve) => setTimeout(resolve, 50));

  const state1 = signal1.get();
  assert.strictEqual(state1.value.length, 2);

  mockClearRequestLog();

  const filter2: Expression = Expression.parse('_id = "cached-1"');
  const signal2 = reactiveStoreFetch("config", filter2, { freshness: 0 });

  await new Promise((resolve) => setTimeout(resolve, 50));

  const state2 = signal2.get();
  assert.strictEqual(state2.value.length, 1);
  assert.strictEqual((state2.value[0] as { _id: string })._id, "cached-1");
});

// =============================================================================
// Stale Data Tests - show old data while fetching new data
// =============================================================================

void test("fetch() shows stale data with loading=true while fetching fresh data", async () => {
  mockClearHandlers();

  const staleData = [{ _id: "stale-item", name: "Stale Data" }];
  const freshData = [
    { _id: "stale-item", name: "Fresh Data" },
    { _id: "new-item", name: "New Item" },
  ];

  mockRegisterHandler(mockFetchHandler("api/users/", staleData));

  const filter: Expression = new Expression.Literal(true);
  const signal = reactiveStoreFetch("users", filter);

  await new Promise((resolve) => setTimeout(resolve, 50));

  const staleState = signal.get();
  assert.strictEqual(staleState.loading, false);
  assert.strictEqual(staleState.value.length, 1);
  const staleTimestamp = staleState.timestamp;

  mockClearHandlers();
  mockRegisterHandler(mockFetchHandler("api/users/", freshData, 100));

  const futureTimestamp = Date.now() + 100000;
  const signal2 = reactiveStoreFetch("users", filter, {
    freshness: futureTimestamp,
  });

  assert.strictEqual(signal, signal2);

  const loadingState = signal.get();
  assert.strictEqual(
    loadingState.loading,
    true,
    "Should be loading while fetching fresh data",
  );
  assert.strictEqual(
    loadingState.value.length,
    1,
    "Should show stale data while loading",
  );
  assert.strictEqual(
    loadingState.timestamp,
    staleTimestamp,
    "Timestamp should be from stale data",
  );

  await new Promise((resolve) => setTimeout(resolve, 150));

  const freshState = signal.get();
  assert.strictEqual(
    freshState.loading,
    false,
    "Should not be loading after fetch completes",
  );
  assert.strictEqual(freshState.value.length, 2, "Should have fresh data");
  assert.ok(
    freshState.timestamp > staleTimestamp,
    "Timestamp should be updated",
  );
});

void test("count() shows stale count with loading=true while fetching fresh count", async () => {
  mockClearHandlers();

  const staleData = Array.from({ length: 10 }, (_, i) => ({
    _id: `perm-${i}`,
  }));
  mockRegisterHandler(mockCountHandler("api/permissions/", staleData));

  const filter: Expression = new Expression.Literal(true);
  const signal = reactiveStoreCount("permissions", filter);

  await new Promise((resolve) => setTimeout(resolve, 50));

  const staleState = signal.get();
  assert.strictEqual(staleState.loading, false);
  assert.strictEqual(staleState.value, 10);
  const staleTimestamp = staleState.timestamp;

  mockClearHandlers();
  const freshData = Array.from({ length: 25 }, (_, i) => ({
    _id: `perm-${i}`,
  }));
  mockRegisterHandler(mockCountHandler("api/permissions/", freshData, 100));

  const futureTimestamp = Date.now() + 100000;
  const signal2 = reactiveStoreCount("permissions", filter, {
    freshness: futureTimestamp,
  });

  assert.strictEqual(signal, signal2);

  const loadingState = signal.get();
  assert.strictEqual(
    loadingState.loading,
    true,
    "Should be loading while fetching fresh count",
  );
  assert.strictEqual(
    loadingState.value,
    10,
    "Should show stale count while loading",
  );

  await new Promise((resolve) => setTimeout(resolve, 150));

  const freshState = signal.get();
  assert.strictEqual(
    freshState.loading,
    false,
    "Should not be loading after fetch completes",
  );
  assert.strictEqual(freshState.value, 25, "Should have fresh count");
  assert.ok(
    freshState.timestamp > staleTimestamp,
    "Timestamp should be updated",
  );
});

// =============================================================================
// Partial Data / Overlapping Query Tests
// =============================================================================

void test("fetch() fetches only missing data for partially covered query", async () => {
  mockClearHandlers();
  clearStores();

  const allData = [
    { _id: "file-1", region: "A" },
    { _id: "file-2", region: "A" },
    { _id: "file-3", region: "B" },
    { _id: "file-4", region: "B" },
  ];

  mockRegisterHandler(mockFetchHandler("api/files/", allData));

  const filterA: Expression = Expression.parse('region = "A"');
  const signalA = reactiveStoreFetch("files", filterA);

  await new Promise((resolve) => setTimeout(resolve, 50));

  const stateA = signalA.get();
  assert.strictEqual(stateA.value.length, 2);
  assert.ok(
    stateA.value.every((item) => (item as { region: string }).region === "A"),
  );

  mockClearRequestLog();

  const filterB: Expression = Expression.parse('region = "B"');
  const signalB = reactiveStoreFetch("files", filterB);

  await new Promise((resolve) => setTimeout(resolve, 50));

  const stateB = signalB.get();
  assert.strictEqual(stateB.value.length, 2);
  assert.ok(
    stateB.value.every((item) => (item as { region: string }).region === "B"),
  );

  const log = mockGetRequestLog();
  assert.ok(log.length > 0, "Should make request for uncached region");
});

void test("overlapping queries use and share cached objects", async () => {
  mockClearHandlers();

  const allItems = [
    { _id: "shared-1", type: "X", priority: 1 },
    { _id: "shared-2", type: "X", priority: 2 },
    { _id: "shared-3", type: "Y", priority: 1 },
    { _id: "shared-4", type: "Y", priority: 2 },
  ];

  mockRegisterHandler(mockFetchHandler("api/permissions/", allItems));

  const signalAll = reactiveStoreFetch(
    "permissions",
    new Expression.Literal(true),
  );
  await new Promise((resolve) => setTimeout(resolve, 50));

  const stateAll = signalAll.get();
  assert.strictEqual(stateAll.value.length, 4);

  mockClearRequestLog();

  // Subset queries should use cached objects
  const filterX: Expression = Expression.parse('type = "X"');
  const signalX = reactiveStoreFetch("permissions", filterX, { freshness: 0 });

  const filterP1: Expression = Expression.parse("priority = 1");
  const signalP1 = reactiveStoreFetch("permissions", filterP1, {
    freshness: 0,
  });

  await new Promise((resolve) => setTimeout(resolve, 50));

  const stateX = signalX.get();
  const stateP1 = signalP1.get();

  // Verify filtering works correctly
  assert.strictEqual(stateX.value.length, 2);
  assert.ok(
    stateX.value.every((item) => (item as { type: string }).type === "X"),
    "All items should have type X",
  );
  assert.strictEqual(stateP1.value.length, 2);
  assert.ok(
    stateP1.value.every(
      (item) => (item as { priority: number }).priority === 1,
    ),
    "All items should have priority 1",
  );

  // Verify same object reference is shared across queries
  const itemFromX = stateX.value.find(
    (i) => (i as { _id: string })._id === "shared-1",
  );
  const itemFromP1 = stateP1.value.find(
    (i) => (i as { _id: string })._id === "shared-1",
  );
  assert.strictEqual(
    itemFromX,
    itemFromP1,
    "Same cached object should be shared across queries",
  );
});

// =============================================================================
// Non-Overlapping FetchedRegions Tests
// =============================================================================

void test("fetching subset with newer timestamp replaces overlapping region", async () => {
  mockClearHandlers();
  clearStores();

  const resource = "views";

  const allData = [
    { _id: "item-1", category: "X" },
    { _id: "item-2", category: "X" },
    { _id: "item-3", category: "Y" },
  ];

  mockRegisterHandler(mockFetchHandler(`api/${resource}/`, allData));

  const signalAll = reactiveStoreFetch(resource, new Expression.Literal(true));
  await new Promise((resolve) => setTimeout(resolve, 50));

  let state = getCacheState(resource);
  assert.strictEqual(
    state.regionCount,
    1,
    "Should have 1 region after first fetch",
  );
  assert.strictEqual(state.objectCount, 3, "Should have 3 objects cached");

  mockClearHandlers();
  const subsetData = [
    { _id: "item-1", category: "X" },
    { _id: "item-2", category: "X" },
  ];
  mockRegisterHandler(mockFetchHandler(`api/${resource}/`, subsetData));

  const futureTimestamp = Date.now() + 100000;
  const filterX: Expression = Expression.parse('category = "X"');
  const signalX = reactiveStoreFetch(resource, filterX, {
    freshness: futureTimestamp,
  });

  await new Promise((resolve) => setTimeout(resolve, 50));

  state = getCacheState(resource);
  assert.strictEqual(
    state.regionCount,
    2,
    "Should have 2 non-overlapping regions",
  );

  const [region1, region2] = state.regions.map((r) => r.filter);

  const oneCoversX = covers(region1, filterX) || covers(region2, filterX);
  assert.ok(oneCoversX, "One region should cover filterX (category = X)");

  const unionOfRegions = Expression.or(region1, region2);
  assert.ok(
    covers(unionOfRegions, new Expression.Literal(true)),
    "Union of regions should cover the original filter (true)",
  );

  assert.ok(
    covers(new Expression.Literal(false), Expression.and(region1, region2)),
    "Regions should not overlap (areDisjoint should return true)",
  );

  const diff = subtract(region1, region2);
  assert.ok(
    areEquivalent(diff, region2),
    "Regions should not overlap (diff should equal region2)",
  );

  void signalAll;
  void signalX;
});

void test("fetching same region with newer timestamp replaces old region entirely", async () => {
  mockClearHandlers();
  clearStores();

  const resource = "config";

  const data = [{ _id: "cfg-1", value: "test" }];
  mockRegisterHandler(mockFetchHandler(`api/${resource}/`, data));

  const filterA: Expression = Expression.parse('_id = "cfg-1"');
  const signal1 = reactiveStoreFetch(resource, filterA);
  await new Promise((resolve) => setTimeout(resolve, 50));

  let state = getCacheState(resource);
  const firstTimestamp = state.regions[0]?.timestamp;
  assert.strictEqual(state.regionCount, 1, "Should have 1 region");

  await new Promise((resolve) => setTimeout(resolve, 10));

  mockClearHandlers();
  mockRegisterHandler(mockFetchHandler(`api/${resource}/`, data));

  const futureTimestamp = Date.now() + 100000;
  const signal2 = reactiveStoreFetch(resource, filterA, {
    freshness: futureTimestamp,
  });

  await new Promise((resolve) => setTimeout(resolve, 50));

  state = getCacheState(resource);
  assert.strictEqual(
    state.regionCount,
    1,
    "Should still have 1 region after refresh",
  );

  assert.ok(
    state.regions[0].timestamp > firstTimestamp,
    "Region timestamp should be updated",
  );

  void signal1;
  void signal2;
});

void test("multiple overlapping fetches result in non-overlapping regions", async () => {
  mockClearHandlers();
  clearStores();

  const resource = "faults";

  const allData = [
    { _id: "fault-1", type: "A" },
    { _id: "fault-2", type: "B" },
    { _id: "fault-3", type: "C" },
  ];

  mockRegisterHandler(mockFetchHandler(`api/${resource}/`, allData));

  const filterA: Expression = Expression.parse('type = "A"');
  const filterB: Expression = Expression.parse('type = "B"');
  const filterC: Expression = Expression.parse('type = "C"');

  const signalA = reactiveStoreFetch(resource, filterA);
  await new Promise((resolve) => setTimeout(resolve, 50));

  const signalB = reactiveStoreFetch(resource, filterB);
  await new Promise((resolve) => setTimeout(resolve, 50));

  const signalC = reactiveStoreFetch(resource, filterC);
  await new Promise((resolve) => setTimeout(resolve, 50));

  const state = getCacheState(resource);

  assert.strictEqual(
    state.regionCount,
    3,
    "Should have 3 non-overlapping regions",
  );
  assert.strictEqual(state.objectCount, 3, "Should have 3 objects cached");

  assert.strictEqual(signalA.get().value.length, 1);
  assert.strictEqual((signalA.get().value[0] as { type: string }).type, "A");
  assert.strictEqual(signalB.get().value.length, 1);
  assert.strictEqual((signalB.get().value[0] as { type: string }).type, "B");
  assert.strictEqual(signalC.get().value.length, 1);
  assert.strictEqual((signalC.get().value[0] as { type: string }).type, "C");

  const regionFilters = state.regions.map((r) => r.filter);
  assert.ok(
    regionFilters.some((rf) => covers(rf, filterA)),
    "One region should cover filterA",
  );
  assert.ok(
    regionFilters.some((rf) => covers(rf, filterB)),
    "One region should cover filterB",
  );
  assert.ok(
    regionFilters.some((rf) => covers(rf, filterC)),
    "One region should cover filterC",
  );

  for (let i = 0; i < regionFilters.length; i++) {
    for (let j = i + 1; j < regionFilters.length; j++) {
      assert.ok(
        covers(
          new Expression.Literal(false),
          Expression.and(regionFilters[i], regionFilters[j]),
        ),
        `Regions ${i} and ${j} should not overlap (areDisjoint)`,
      );
    }
  }
});

// =============================================================================
// Cache Pruning Tests
// =============================================================================

void test("cache is cleared when all fetch signals are disposed", async () => {
  mockClearHandlers();
  clearStores();

  const resource = "users";
  const data = [
    { _id: "user-1", name: "Alice" },
    { _id: "user-2", name: "Bob" },
  ];

  mockRegisterHandler(mockFetchHandler(`api/${resource}/`, data));

  const signal = reactiveStoreFetch(resource, new Expression.Literal(true));
  await new Promise((resolve) => setTimeout(resolve, 50));

  let state = getCacheState(resource);
  assert.strictEqual(state.objectCount, 2, "Should have 2 objects cached");
  assert.strictEqual(state.regionCount, 1, "Should have 1 region");
  assert.strictEqual(state.fetchQueryCount, 1, "Should have 1 active query");

  signal[Symbol.dispose]();
  void signal;

  forcePruneCache(resource);

  state = getCacheState(resource);
  assert.strictEqual(state.fetchQueryCount, 0, "no live queries remain");
  assert.strictEqual(state.regionCount, 0, "regions dropped");
  assert.strictEqual(state.objectCount, 0, "objects dropped");
});

void test("regions not serving active queries are pruned", async () => {
  mockClearHandlers();
  clearStores();

  const resource = "provisions";

  const allData = [
    { _id: "prov-1", category: "X" },
    { _id: "prov-2", category: "X" },
    { _id: "prov-3", category: "Y" },
    { _id: "prov-4", category: "Y" },
  ];

  mockRegisterHandler(mockFetchHandler(`api/${resource}/`, allData));

  const filterX: Expression = Expression.parse('category = "X"');
  const filterY: Expression = Expression.parse('category = "Y"');

  const signalX = reactiveStoreFetch(resource, filterX);
  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.strictEqual(signalX.get().value.length, 2);
  assert.ok(
    signalX
      .get()
      .value.every((item) => (item as { category: string }).category === "X"),
  );

  const signalY = reactiveStoreFetch(resource, filterY);
  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.strictEqual(signalY.get().value.length, 2);
  assert.ok(
    signalY
      .get()
      .value.every((item) => (item as { category: string }).category === "Y"),
  );

  let state = getCacheState(resource);
  assert.strictEqual(state.regionCount, 2, "Should have 2 regions");
  assert.strictEqual(state.objectCount, 4, "Should have 4 objects");
  assert.strictEqual(state.fetchQueryCount, 2, "Should have 2 active queries");

  signalY[Symbol.dispose]();
  forcePruneCache(resource);

  state = getCacheState(resource);
  assert.strictEqual(
    state.regionCount,
    1,
    "Should have 1 region after pruning (only X)",
  );
  assert.strictEqual(
    state.objectCount,
    2,
    "Should have 2 objects after pruning (only X)",
  );

  const remainingRegion = state.regions[0].filter;
  assert.ok(
    covers(remainingRegion, filterX),
    "Remaining region should cover filterX",
  );

  void signalX;
});

void test("overlapping regions are consolidated after pruning", async () => {
  mockClearHandlers();
  clearStores();

  const resource = "virtualParameters";

  const allData = [
    { _id: "vp-1", type: "A" },
    { _id: "vp-2", type: "B" },
  ];

  mockRegisterHandler(mockFetchHandler(`api/${resource}/`, allData));

  const signalAll = reactiveStoreFetch(resource, new Expression.Literal(true));
  await new Promise((resolve) => setTimeout(resolve, 50));

  let state = getCacheState(resource);
  assert.strictEqual(state.regionCount, 1, "Should have 1 region");
  assert.strictEqual(signalAll.get().value.length, 2);

  const futureTimestamp = Date.now() + 100000;
  const filterA: Expression = Expression.parse('type = "A"');

  mockClearHandlers();
  mockRegisterHandler(mockFetchHandler(`api/${resource}/`, allData));

  const signalA = reactiveStoreFetch(resource, filterA, {
    freshness: futureTimestamp,
  });
  await new Promise((resolve) => setTimeout(resolve, 50));

  state = getCacheState(resource);
  assert.strictEqual(
    state.regionCount,
    2,
    "Should have 2 regions after subset fetch",
  );

  signalAll[Symbol.dispose]();
  forcePruneCache(resource);

  state = getCacheState(resource);

  assert.strictEqual(
    state.regionCount,
    1,
    "Should have 1 region after pruning",
  );
  assert.strictEqual(
    state.objectCount,
    1,
    "Should have 1 object (only type A)",
  );

  const remainingRegion = state.regions[0].filter;
  assert.ok(
    covers(remainingRegion, filterA),
    "Remaining region should cover filterA",
  );

  void signalA;
});

void test("a live bookmark query pins regions through pruning", async () => {
  mockClearHandlers();
  clearStores();

  const resource = "files";
  const data = Array.from({ length: 10 }, (_, i) => ({ _id: `f-${i}` }));
  mockRegisterHandler(mockQueryHandler(`api/${resource}/`, data));

  const signal = reactiveStoreFetch(resource, new Expression.Literal(true));
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.strictEqual(getCacheState(resource).objectCount, 10);

  const bookmark = reactiveStoreCreateBookmark(
    resource,
    new Expression.Literal(true),
    { _id: 1 },
    5,
  );
  await new Promise((resolve) => setTimeout(resolve, 50));

  signal[Symbol.dispose]();
  forcePruneCache(resource);

  // The bookmark query anchors on cached regions (and pagedFetch displays
  // the covered prefix while a probe resolves), so it pins like a fetch
  // query does.
  const state = getCacheState(resource);
  assert.strictEqual(state.regionCount, 1, "region pinned by the bookmark");
  assert.strictEqual(state.objectCount, 10, "rows pinned by the bookmark");

  void bookmark;
});

void test("a disposal during the bookmark probe window does not flush the displayed rows", async () => {
  mockClearHandlers();
  clearStores();

  const resource = "presets";
  const data = Array.from({ length: 10 }, (_, i) => ({ _id: `p-${i}` }));
  // Latency so the back-navigation's bookmark probe is still in flight when
  // the outgoing page's signal is disposed
  mockRegisterHandler(mockQueryHandler(`api/${resource}/`, data, 30));

  // List page loads, then a detail page query (covered, freshness 0) takes
  // over; the list signal is disposed and the post-navigation invalidate
  // carves the detail footprint and prunes the orphaned remainder, leaving
  // only the detail region.
  const list = reactiveStoreFetch(resource, new Expression.Literal(true));
  await new Promise((resolve) => setTimeout(resolve, 50));
  const detail = reactiveStoreFetch(resource, Expression.parse('_id = "p-0"'));
  list[Symbol.dispose]();
  invalidate(Date.now());
  await new Promise((resolve) => setTimeout(resolve, 50));
  let state = getCacheState(resource);
  assert.strictEqual(state.regionCount, 1, "only the detail region remains");
  assert.strictEqual(state.objectCount, 1);

  // Back to the list: first render starts the bookmark probe (the one-row
  // detail region cannot anchor a 10-row bookmark); no data fetch query
  // exists until the probe resolves.
  let page = pagedFetch(resource, new Expression.Literal(true), { limit: 10 });
  assert.strictEqual(page.loading, true);

  // The detail signal's disposal lands inside the probe window. The live
  // bookmark query must keep the detail region pinned — it feeds the
  // provisional display and the probe's anchoring.
  detail[Symbol.dispose]();
  state = getCacheState(resource);
  assert.strictEqual(
    state.regionCount,
    1,
    "region survives the mid-probe prune",
  );
  assert.strictEqual(state.objectCount, 1);

  // Probe resolves, the data fetch issues; the cached detail row shows
  // provisionally while the rest loads, then the page settles fresh.
  await new Promise((resolve) => setTimeout(resolve, 50));
  page = pagedFetch(resource, new Expression.Literal(true), { limit: 10 });
  assert.strictEqual(page.value.length, 1, "cached row shown while loading");
  assert.strictEqual(page.loading, true);
  await new Promise((resolve) => setTimeout(resolve, 50));
  page = pagedFetch(resource, new Expression.Literal(true), { limit: 10 });
  assert.strictEqual(page.value.length, 10);
  assert.strictEqual(page.loading, false, "settled fresh");
});

void test("invalidate() prunes a carve remainder no live query overlaps", async () => {
  mockClearHandlers();
  clearStores();

  const resource = "files";
  const data = Array.from({ length: 10 }, (_, i) => ({ _id: `f-${i}` }));
  mockRegisterHandler(mockQueryHandler(`api/${resource}/`, data));

  // List page caches 10 rows; a detail query (freshness 0) settles on the
  // same region; the list signal dies with the navigation. The whole region
  // stays pinned by overlap with the detail demand.
  const list = reactiveStoreFetch(resource, new Expression.Literal(true));
  await new Promise((resolve) => setTimeout(resolve, 50));
  const detail = reactiveStoreFetch(resource, Expression.parse('_id = "f-0"'));
  list[Symbol.dispose]();
  assert.strictEqual(getCacheState(resource).objectCount, 10);

  // The post-navigation invalidate stales the region and refetches only the
  // detail footprint; the carve orphans the 9-row remainder, which must be
  // pruned right away — not left around until some later prune (often
  // GC-timed) happens to drop it.
  invalidate(Date.now());
  assert.strictEqual(
    getCacheState(resource).regionCount,
    1,
    "remainder pruned at invalidate",
  );
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.strictEqual(getCacheState(resource).objectCount, 1);

  void detail;
});

void test("disposing the last bookmark query prunes the regions it pinned", async () => {
  mockClearHandlers();
  clearStores();

  const resource = "files";
  const data = Array.from({ length: 10 }, (_, i) => ({ _id: `f-${i}` }));
  mockRegisterHandler(mockQueryHandler(`api/${resource}/`, data));

  const signal = reactiveStoreFetch(resource, new Expression.Literal(true));
  await new Promise((resolve) => setTimeout(resolve, 50));
  const bookmark = reactiveStoreCreateBookmark(
    resource,
    new Expression.Literal(true),
    { _id: 1 },
    5,
  );
  await new Promise((resolve) => setTimeout(resolve, 50));
  signal[Symbol.dispose]();
  forcePruneCache(resource);
  assert.strictEqual(getCacheState(resource).regionCount, 1);

  // The bookmark was the last pin; its disposal must prune what it pinned —
  // a prune that ran only on fetch disposals would strand these regions.
  bookmark[Symbol.dispose]();
  const state = getCacheState(resource);
  assert.strictEqual(state.regionCount, 0, "store flushed");
  assert.strictEqual(state.objectCount, 0);
});

// =============================================================================
// invalidate() Tests
// =============================================================================

void test("invalidate() triggers re-fetch for stale fetch queries", async () => {
  mockClearHandlers();
  clearStores();

  const resource = "presets";
  const staleData = [{ _id: "p-1", name: "Old" }];
  const freshData = [
    { _id: "p-1", name: "Updated" },
    { _id: "p-2", name: "New" },
  ];

  mockRegisterHandler(mockFetchHandler(`api/${resource}/`, staleData));

  const signal = reactiveStoreFetch(resource, new Expression.Literal(true));
  await new Promise((resolve) => setTimeout(resolve, 50));

  const staleState = signal.get();
  assert.strictEqual(staleState.loading, false);
  assert.strictEqual(staleState.value.length, 1);
  assert.strictEqual((staleState.value[0] as { name: string }).name, "Old");

  // Replace handler with fresh data
  mockClearHandlers();
  mockRegisterHandler(mockFetchHandler(`api/${resource}/`, freshData));

  // Invalidate with a future timestamp so all current data is stale
  invalidate(Date.now() + 100000);

  // Wait for re-fetch to complete
  await new Promise((resolve) => setTimeout(resolve, 50));

  const freshState = signal.get();
  assert.strictEqual(freshState.loading, false, "Should finish loading");
  assert.strictEqual(freshState.value.length, 2, "Should have fresh data");
  const freshNames = freshState.value
    .map((item) => (item as { name: string }).name)
    .sort();
  assert.deepStrictEqual(
    freshNames,
    ["New", "Updated"],
    "Should have updated data",
  );
});

void test("invalidate() triggers re-fetch for stale count queries", async () => {
  mockClearHandlers();
  clearStores();

  const resource = "faults";
  const staleData = Array.from({ length: 5 }, (_, i) => ({ _id: `f-${i}` }));
  const freshData = Array.from({ length: 12 }, (_, i) => ({ _id: `f-${i}` }));

  mockRegisterHandler(mockCountHandler(`api/${resource}/`, staleData));

  const signal = reactiveStoreCount(resource, new Expression.Literal(true));
  await new Promise((resolve) => setTimeout(resolve, 50));

  const staleState = signal.get();
  assert.strictEqual(staleState.loading, false);
  assert.strictEqual(staleState.value, 5);

  // Replace handler with fresh data
  mockClearHandlers();
  mockRegisterHandler(mockCountHandler(`api/${resource}/`, freshData));

  invalidate(Date.now() + 100000);

  await new Promise((resolve) => setTimeout(resolve, 50));

  const freshState = signal.get();
  assert.strictEqual(freshState.loading, false, "Should finish loading");
  assert.strictEqual(freshState.value, 12, "Should have fresh count");
});

void test("invalidate() preserves stale data while loading", async () => {
  mockClearHandlers();
  clearStores();

  const resource = "provisions";
  const staleData = [{ _id: "item-1", value: "stale" }];
  const freshData = [{ _id: "item-1", value: "fresh" }];

  mockRegisterHandler(mockFetchHandler(`api/${resource}/`, staleData));

  const signal = reactiveStoreFetch(resource, new Expression.Literal(true));
  await new Promise((resolve) => setTimeout(resolve, 50));

  const staleState = signal.get();
  assert.strictEqual(staleState.loading, false);
  assert.strictEqual(staleState.value.length, 1);

  // Use a delayed handler so we can observe the loading state
  mockClearHandlers();
  mockRegisterHandler(mockFetchHandler(`api/${resource}/`, freshData, 100));

  invalidate(Date.now() + 100000);

  // Immediately after invalidate, should be loading with stale data
  const loadingState = signal._peek();
  assert.strictEqual(
    loadingState.loading,
    true,
    "Should be loading after invalidate",
  );
  assert.strictEqual(
    loadingState.value.length,
    1,
    "Should still have stale data while loading",
  );
  assert.strictEqual(
    (loadingState.value[0] as { value: string }).value,
    "stale",
    "Stale data should be preserved while loading",
  );

  // Wait for re-fetch to complete
  await new Promise((resolve) => setTimeout(resolve, 150));

  const freshState = signal.get();
  assert.strictEqual(freshState.loading, false, "Should finish loading");
  assert.strictEqual(
    (freshState.value[0] as { value: string }).value,
    "fresh",
    "Should have fresh data after loading completes",
  );
});

void test("invalidate() supersedes an in-flight fetch with a fresh request", async () => {
  mockClearHandlers();
  clearStores();

  const resource = "config";
  const preInvalidation = [{ _id: "cfg-1", value: "old" }];
  const postInvalidation = [{ _id: "cfg-1", value: "new" }];

  // Use a slow handler so the initial fetch is still in-flight when the
  // invalidation fires
  mockRegisterHandler(
    mockFetchHandler(`api/${resource}/`, preInvalidation, 200),
  );

  const signal = reactiveStoreFetch(resource, new Expression.Literal(true));

  // Signal should still be loading from initial fetch
  const state = signal._peek();
  assert.strictEqual(
    state.loading,
    true,
    "Should be loading from initial fetch",
  );

  mockClearHandlers();
  mockRegisterHandler(mockFetchHandler(`api/${resource}/`, postInvalidation));

  // Invalidate while the request is in flight: the pending region was issued
  // before the invalidation, so its response can no longer satisfy any
  // demand. It is superseded — a replacement request fires immediately and
  // the doomed response is discarded when it lands.
  invalidate(Date.now() + 100000);

  const log = mockGetRequestLog();
  assert.strictEqual(
    log.length,
    1,
    "Should re-request the superseded footprint",
  );
  assert.strictEqual(signal._peek().loading, true);

  // Wait for both the replacement and the superseded response to land
  await new Promise((resolve) => setTimeout(resolve, 250));

  const finalState = signal.get();
  assert.strictEqual(finalState.loading, false);
  assert.deepStrictEqual(
    finalState.value.map((r) => (r as { value: string }).value),
    ["new"],
    "Should settle on the post-invalidation response; the superseded one is discarded",
  );
});

void test("invalidate() skips queries newer than the given timestamp", async () => {
  mockClearHandlers();
  clearStores();

  const resource = "files";
  const data = [{ _id: "file-1", name: "Test" }];

  mockRegisterHandler(mockFetchHandler(`api/${resource}/`, data));

  const signal = reactiveStoreFetch(resource, new Expression.Literal(true));
  await new Promise((resolve) => setTimeout(resolve, 50));

  const state = signal.get();
  assert.strictEqual(state.loading, false);
  assert.strictEqual(state.value.length, 1);

  mockClearRequestLog();

  // Invalidate with a timestamp in the past (older than fetched data)
  invalidate(1);

  const log = mockGetRequestLog();
  assert.strictEqual(
    log.length,
    0,
    "Should not trigger request when data is newer than invalidation timestamp",
  );

  // Signal state should be unchanged
  const unchanged = signal.get();
  assert.strictEqual(unchanged.loading, false, "Should not be loading");
  assert.strictEqual(unchanged.value.length, 1, "Data should be unchanged");
});

void test("invalidate() refreshes queries across multiple resource stores", async () => {
  mockClearHandlers();
  clearStores();

  const presetsData = [{ _id: "preset-1", name: "P1" }];
  const faultsData = [{ _id: "fault-1", type: "error" }];

  mockRegisterHandler(mockFetchHandler("api/presets/", presetsData));
  mockRegisterHandler(mockFetchHandler("api/faults/", faultsData));
  mockRegisterHandler(mockCountHandler("api/faults/", faultsData));

  const presetSignal = reactiveStoreFetch(
    "presets",
    new Expression.Literal(true),
  );
  const faultSignal = reactiveStoreFetch(
    "faults",
    new Expression.Literal(true),
  );
  const faultCount = reactiveStoreCount("faults", new Expression.Literal(true));
  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.strictEqual(presetSignal.get().value.length, 1);
  assert.strictEqual(faultSignal.get().value.length, 1);
  assert.strictEqual(faultCount.get().value, 1);

  // Replace with fresh data
  mockClearHandlers();
  const freshPresets = [
    { _id: "preset-1", name: "P1" },
    { _id: "preset-2", name: "P2" },
  ];
  const freshFaults = [
    { _id: "fault-1", type: "error" },
    { _id: "fault-2", type: "warning" },
    { _id: "fault-3", type: "error" },
  ];
  mockRegisterHandler(mockFetchHandler("api/presets/", freshPresets));
  mockRegisterHandler(mockFetchHandler("api/faults/", freshFaults));
  mockRegisterHandler(mockCountHandler("api/faults/", freshFaults));

  invalidate(Date.now() + 100000);
  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.strictEqual(
    presetSignal.get().value.length,
    2,
    "Presets should be refreshed",
  );
  assert.strictEqual(
    faultSignal.get().value.length,
    3,
    "Faults fetch should be refreshed",
  );
  assert.strictEqual(
    faultCount.get().value,
    3,
    "Faults count should be refreshed",
  );
});

void test("fetch() removes deleted records from cache on refresh", async () => {
  mockClearHandlers();
  clearStores();

  const resource = "presets";
  const initialData = [
    { _id: "p-1", name: "First" },
    { _id: "p-2", name: "Second" },
    { _id: "p-3", name: "Third" },
  ];

  mockRegisterHandler(mockFetchHandler(`api/${resource}/`, initialData));

  const signal = reactiveStoreFetch(resource, new Expression.Literal(true));
  await new Promise((resolve) => setTimeout(resolve, 50));

  const initialState = signal.get();
  assert.strictEqual(initialState.value.length, 3);

  // Simulate server-side deletion: p-2 is deleted
  const afterDeleteData = [
    { _id: "p-1", name: "First" },
    { _id: "p-3", name: "Third" },
  ];

  mockClearHandlers();
  mockRegisterHandler(mockFetchHandler(`api/${resource}/`, afterDeleteData));

  invalidate(Date.now() + 100000);
  await new Promise((resolve) => setTimeout(resolve, 50));

  const afterState = signal.get();
  assert.strictEqual(
    afterState.value.length,
    2,
    "Deleted record should be removed",
  );
  const ids = afterState.value
    .map((item) => (item as { _id: string })._id)
    .sort();
  assert.deepStrictEqual(
    ids,
    ["p-1", "p-3"],
    "Only non-deleted records remain",
  );
});

// =============================================================================
// Coherence for signals minted after an invalidation
// =============================================================================
//
// Two guarantees under test:
//   - pagedFetch fetches the rows shown under a bookmark at a freshness
//     floored by the bookmark's timestamp, so a freshly re-probed bookmark
//     cannot pair with rows settled from stale pre-invalidation coverage.
//   - invalidate() marks affected regions themselves stale, so a signal born
//     after an invalidation cannot satisfy itself from pre-invalidation
//     coverage even at freshness 0.
// Staleness deliberately does NOT affect the display path (coveredPrefix),
// preserving stale-while-revalidate.

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const rowIds = (rows: unknown[]): string[] =>
  rows.map((r) => (r as { _id: string })._id);

void test("paged rows are floored by the bookmark's freshness", async () => {
  // No invalidate() here, so only the freshness floor is under test: a
  // bookmark resolved fresh from the server while the object cache still
  // holds a since-deleted row. Without the floor the rows settle from that
  // stale cache and show the deleted row.
  mockClearHandlers();
  clearStores();

  const resource = "presets";
  const fullData = Array.from({ length: 5 }, (_, i) => ({
    _id: `item-${String(i + 1).padStart(2, "0")}`,
  }));
  mockRegisterHandler(mockQueryHandler(`api/${resource}/`, fullData));

  const filter: Expression = new Expression.Literal(true);

  // Cover the whole collection — all 5 rows cached at t0. Keep the signal
  // alive so the region (and stale objects) survive pruning.
  const broad = reactiveStoreFetch(resource, filter, { sort: { _id: 1 } });
  await wait(50);
  assert.strictEqual(broad.get().value.length, 5);

  // Server-side delete of item-02; advance the clock so any new fetch is
  // strictly newer than the cached region.
  await wait(10);
  mockClearHandlers();
  const afterDelete = fullData.filter((r) => r._id !== "item-02");
  mockRegisterHandler(mockQueryHandler(`api/${resource}/`, afterDelete));

  // Force a fresh bookmark via an explicit future freshness: it probes the
  // server (post-delete) and resolves <= item-04, timestamp ~ now.
  const future = Date.now() + 100000;
  const bmSignal = reactiveStoreCreateBookmark(
    resource,
    filter,
    { _id: 1 },
    3,
    { freshness: future },
  );
  await wait(50);
  assert.strictEqual(bmSignal.get().loading, false);
  assert.ok(bmSignal.get().value instanceof Bookmark);
  // The object cache still holds the stale item-02 (bookmark probes don't
  // write objects).
  assert.ok(
    getCachedObjectIds(resource).includes("item-02"),
    "precondition: stale item-02 still cached",
  );

  mockClearRequestLog();

  // pagedFetch passes freshness 0; the cached fresh bookmark (timestamp ~now)
  // must floor the data fetch so it goes to the server, not the stale cache.
  pagedFetch(resource, filter, { limit: 3, sort: { _id: 1 } });
  await wait(50);
  const q = pagedFetch(resource, filter, { limit: 3, sort: { _id: 1 } });

  assert.strictEqual(q.loading, false);
  assert.deepStrictEqual(
    rowIds(q.value),
    ["item-01", "item-03", "item-04"],
    "deleted row must not appear; rows come from the server, not stale cache",
  );
  const log = mockGetRequestLog();
  assert.ok(
    log.some((e) => !getRequestParams(e.url)["limit"]),
    "the bounded data fetch must hit the server (not settle from cache)",
  );

  void bmSignal;
  void broad;
});

void test("a fetch minted after invalidate() does not settle on pre-invalidation coverage", async () => {
  mockClearHandlers();
  clearStores();

  const resource = "faults";
  const initial = [{ _id: "p-1" }, { _id: "p-2" }, { _id: "p-3" }];
  mockRegisterHandler(mockQueryHandler(`api/${resource}/`, initial));

  const filter: Expression = new Expression.Literal(true);
  const broad = reactiveStoreFetch(resource, filter);
  await wait(50);
  assert.strictEqual(broad.get().value.length, 3);

  // Delete p-2; use a delayed handler so the invalidation's own refetch is
  // still in flight (region stays stale) when the new signal is minted.
  mockClearHandlers();
  const afterDelete = [{ _id: "p-1" }, { _id: "p-3" }];
  mockRegisterHandler(mockQueryHandler(`api/${resource}/`, afterDelete, 100));

  invalidate(Date.now() + 100000);
  mockClearRequestLog();

  // A brand-new filter string at freshness 0. The stale region (t0) would
  // have covered it under the old model; staleness now lives on the region
  // itself, so the only coverage that counts is the invalidation's own
  // refetch — issued post-invalidation and still in flight. The new demand
  // dedups against it (no request of its own) and waits for its land.
  const subset = reactiveStoreFetch(resource, Expression.parse('_id = "p-2"'), {
    freshness: 0,
  });
  assert.strictEqual(
    mockGetRequestLog().length,
    0,
    "new demand dedups against the post-invalidation in-flight request",
  );
  assert.strictEqual(
    subset.get().loading,
    true,
    "must not settle on pre-invalidation coverage",
  );

  await wait(150);
  assert.strictEqual(subset.get().loading, false);
  assert.strictEqual(
    subset.get().value.length,
    0,
    "must settle on server truth (p-2 deleted), not the stale cached row",
  );

  void broad;
});

void test("a paged query minted after invalidate() re-probes instead of counting stale cache", async () => {
  mockClearHandlers();
  clearStores();

  const resource = "provisions";
  const fullData = Array.from({ length: 5 }, (_, i) => ({
    _id: `item-${String(i + 1).padStart(2, "0")}`,
  }));
  mockRegisterHandler(mockQueryHandler(`api/${resource}/`, fullData));

  const filter: Expression = new Expression.Literal(true);
  const broad = reactiveStoreFetch(resource, filter, { sort: { _id: 1 } });
  await wait(50);
  assert.strictEqual(broad.get().value.length, 5);

  // Delete item-02 server-side; delayed so coverage stays stale across mint.
  mockClearHandlers();
  const afterDelete = fullData.filter((r) => r._id !== "item-02");
  mockRegisterHandler(mockQueryHandler(`api/${resource}/`, afterDelete, 100));

  invalidate(Date.now() + 100000);
  mockClearRequestLog();

  // Brand-new (filter, sort, limit) key. Without the floor the bookmark would
  // be counted from the stale cached matches (m = 5 >= limit) and resolve with
  // zero requests, bounding the deleted row. With it, the stale region is
  // excluded so the bookmark must probe.
  pagedFetch(resource, filter, { limit: 3, sort: { _id: 1 } });
  assert.ok(
    mockGetRequestLog().some((e) => getRequestParams(e.url)["limit"] === "1"),
    "bookmark must probe rather than count stale cached matches",
  );

  await wait(150);
  pagedFetch(resource, filter, { limit: 3, sort: { _id: 1 } });
  await wait(150);
  const q = pagedFetch(resource, filter, { limit: 3, sort: { _id: 1 } });

  assert.strictEqual(q.loading, false);
  assert.deepStrictEqual(
    rowIds(q.value),
    ["item-01", "item-03", "item-04"],
    "paged value settles on truth, deleted row excluded",
  );

  void broad;
});

void test("display carve-out: covered prefix still shows stale rows after invalidate() while probing", async () => {
  mockClearHandlers();
  clearStores();

  const resource = "config";
  const data = Array.from({ length: 10 }, (_, i) => ({
    _id: `item-${String(i + 1).padStart(2, "0")}`,
  }));
  mockRegisterHandler(mockQueryHandler(`api/${resource}/`, data));

  const filter: Expression = new Expression.Literal(true);
  const broad = reactiveStoreFetch(resource, filter, { sort: { _id: 1 } });
  await wait(50);
  assert.strictEqual(broad.get().value.length, 10);

  // Delayed handler so the invalidation refetch and the new probe both stay
  // in flight — coverage remains stale (t0) for the duration of the check.
  mockClearHandlers();
  mockRegisterHandler(mockQueryHandler(`api/${resource}/`, data, 200));

  invalidate(Date.now() + 100000);

  // Brand-new paged key (limit 4); its probe is in flight. The covered prefix
  // is a display path and must NOT be floored — the stale-but-provably-prefix
  // rows stay on screen with loading:true rather than blanking.
  const q = pagedFetch(resource, filter, { limit: 4, sort: { _id: 1 } });
  assert.strictEqual(q.loading, true);
  assert.deepStrictEqual(
    rowIds(q.value),
    ["item-01", "item-02", "item-03", "item-04"],
    "stale prefix must remain visible during the post-invalidate probe",
  );

  await wait(250); // let the in-flight requests settle before teardown
  void broad;
});

void test("regression: re-rendering a resolved paged query issues no new requests", async () => {
  // Guards pagedFetch's freshness floor: once resolved, the bookmark's
  // timestamp must not exceed the data region's, so a re-render stays covered.
  mockClearHandlers();
  clearStores();

  const resource = "users";
  const data = Array.from({ length: 8 }, (_, i) => ({
    _id: `item-${String(i + 1).padStart(2, "0")}`,
  }));
  mockRegisterHandler(mockQueryHandler(`api/${resource}/`, data));

  const filter: Expression = new Expression.Literal(true);

  pagedFetch(resource, filter, { limit: 5, sort: { _id: 1 } });
  await wait(50);
  pagedFetch(resource, filter, { limit: 5, sort: { _id: 1 } });
  await wait(50);
  const resolved = pagedFetch(resource, filter, { limit: 5, sort: { _id: 1 } });
  assert.strictEqual(resolved.loading, false);
  assert.strictEqual(resolved.value.length, 5);

  mockClearRequestLog();
  const again = pagedFetch(resource, filter, { limit: 5, sort: { _id: 1 } });
  assert.strictEqual(again.loading, false);
  assert.deepStrictEqual(rowIds(again.value), rowIds(resolved.value));
  assert.strictEqual(
    mockGetRequestLog().length,
    0,
    "a settled paged query must not refetch on re-render",
  );
});

// =============================================================================
// Responses are retained independent of the initiating query
// =============================================================================
//
// A response lands into the regions its request still owns even when the
// initiating signal was disposed mid-flight; pruneCache then decides
// retention. The count/bookmark settle guards stay (their caches are
// per-query-keyed and would be orphaned by a post-disposal write).

void test("a disposed initiator's response is kept when a live overlapping query needs it", async () => {
  mockClearHandlers();
  clearStores();

  const resource = "files";
  const allData = [
    { _id: "file-1", region: "A" },
    { _id: "file-2", region: "A" },
    { _id: "file-3", region: "B" },
  ];
  mockRegisterHandler(mockQueryHandler(`api/${resource}/`, allData, 100));

  // A: broad query (covers region B too) — the one we dispose mid-flight.
  // B: a subset query (region A) kept alive; it overlaps A so pruneCache
  // retains A's whole region — including the region-B slice only A fetched.
  const a = reactiveStoreFetch(resource, new Expression.Literal(true));
  const b = reactiveStoreFetch(resource, Expression.parse('region = "A"'));
  a[Symbol.dispose]();

  await wait(150); // both responses land; A's initiator is gone

  assert.strictEqual(b.get().loading, false);
  assert.strictEqual(b.get().value.length, 2, "B settles on region A");

  // A's response was written despite its signal being disposed: all three
  // objects are cached, retained because B keeps the overlapping region.
  assert.strictEqual(
    getCacheState(resource).objectCount,
    3,
    "the disposed initiator's objects (incl. file-3) must survive",
  );

  // The slice only A fetched (region B) is now servable from cache.
  mockClearRequestLog();
  const c = reactiveStoreFetch(resource, Expression.parse('region = "B"'), {
    freshness: 0,
  });
  assert.strictEqual(c.get().loading, false, "region B settles from cache");
  assert.deepStrictEqual(rowIds(c.get().value), ["file-3"]);
  assert.strictEqual(
    mockGetRequestLog().length,
    0,
    "no request needed — A's once-discarded response now lives in cache",
  );

  void b;
});

void test("a disposed initiator's response is pruned when nothing live needs it", async () => {
  mockClearHandlers();
  clearStores();

  const resource = "provisions";
  const data = [{ _id: "p-1" }, { _id: "p-2" }];
  mockRegisterHandler(mockQueryHandler(`api/${resource}/`, data, 100));

  // No other live query: the unconditional write must be reclaimed by the
  // prune that runs after it, leaving the same empty end state as before.
  const a = reactiveStoreFetch(resource, new Expression.Literal(true));
  a[Symbol.dispose]();

  await wait(150);

  const state = getCacheState(resource);
  assert.strictEqual(
    state.objectCount,
    0,
    "objects pruned (nobody needs them)",
  );
  assert.strictEqual(state.regionCount, 0, "region pruned");
});

// =============================================================================
// In-flight request dedup via pending regions
// =============================================================================
//
// The settle pass counts a pending region toward a demand's coverage when its
// request was issued no earlier than the demanded freshness, so a query that
// arrives while an overlapping one is in flight fetches only the non-overlap.
// A request issued before the demanded freshness is too stale to reuse.

void test("an overlapping in-flight query is deduped — only the non-overlap is re-fetched", async () => {
  mockClearHandlers();
  clearStores();

  const resource = "faults";
  const data = [
    { _id: "r1", priority: 1 },
    { _id: "r2", priority: 2 },
    { _id: "r3", priority: 3 },
  ];
  mockRegisterHandler(mockQueryHandler(`api/${resource}/`, data, 100));

  // A in flight over priority<=2 (r1,r2). B over priority>=2 (r2,r3) starts
  // before A lands: it must reuse A's in-flight region for the r2 overlap and
  // request only priority>2 (r3) itself.
  const a = reactiveStoreFetch(resource, Expression.parse("priority <= 2"));
  const b = reactiveStoreFetch(resource, Expression.parse("priority >= 2"));

  const log = mockGetRequestLog();
  assert.strictEqual(log.length, 2, "A's request + B's non-overlap only");
  assert.deepStrictEqual(
    rowIds(matchingRows(data, getRequestParams(log[1].url)["filter"])),
    ["r3"],
    "B fetches only the part A isn't already fetching",
  );

  await wait(150);
  assert.strictEqual(b.get().loading, false);
  assert.deepStrictEqual(
    rowIds(b.get().value),
    ["r2", "r3"],
    "B settles complete — the r2 overlap came from A's request",
  );
  assert.deepStrictEqual(rowIds(a.get().value), ["r1", "r2"]);

  void a;
  void b;
});

void test("when an awaited in-flight request fails, the dependent query refetches the hole", async (t) => {
  mockClearHandlers();
  clearStores();
  // The store logs the simulated failure to the console — silence it
  t.mock.method(console, "error", () => {});

  const resource = "faults";
  const data = [
    { _id: "r1", priority: 1 },
    { _id: "r2", priority: 2 },
    { _id: "r3", priority: 3 },
  ];
  // Fail any request whose result would include r1 — i.e. A's priority<=2.
  // B's narrower requests (priority>2, then the r2 hole) don't include r1, so
  // they fall through to the normal handler and succeed.
  mockRegisterHandler((opts: { url: string; method: string }) => {
    if (opts.method && opts.method !== "GET") return undefined;
    if (!opts.url.includes(`api/${resource}/`)) return undefined;
    const f = getRequestParams(opts.url)["filter"];
    if (f && rowIds(matchingRows(data, f)).includes("r1"))
      return Promise.reject(new Error("simulated failure"));
    return undefined;
  });
  mockRegisterHandler(mockQueryHandler(`api/${resource}/`, data, 50));

  const a = reactiveStoreFetch(resource, Expression.parse("priority <= 2"));
  const b = reactiveStoreFetch(resource, Expression.parse("priority >= 2"));

  // B reused A's in-flight region for the r2 overlap; once A fails (parking
  // only A until the retry timer), the immediate settle has B re-request r2
  // itself and settle whole. A stays loading — that's the indefinite retry
  // contract.
  await wait(300);
  assert.strictEqual(b.get().loading, false);
  assert.deepStrictEqual(
    rowIds(b.get().value),
    ["r2", "r3"],
    "B refetched the hole A's failure left and settled complete",
  );

  void a;
  void b;
});

void test("a demand fresher than an in-flight request does not reuse it", async () => {
  mockClearHandlers();
  clearStores();

  const resource = "provisions";
  const data = [
    { _id: "r1", priority: 1 },
    { _id: "r2", priority: 2 },
    { _id: "r3", priority: 3 },
  ];
  mockRegisterHandler(mockQueryHandler(`api/${resource}/`, data, 100));

  // A in flight over priority<=3 at freshness 0. B wants priority<=2 but at a
  // freshness newer than A's issue time, so A's in-flight data is too stale to
  // count — B must issue its own request for the whole region (no dedup).
  const a = reactiveStoreFetch(resource, Expression.parse("priority <= 3"));
  const b = reactiveStoreFetch(resource, Expression.parse("priority <= 2"), {
    freshness: Date.now() + 100000,
  });

  const log = mockGetRequestLog();
  assert.strictEqual(log.length, 2);
  assert.deepStrictEqual(
    rowIds(matchingRows(data, getRequestParams(log[1].url)["filter"])),
    ["r1", "r2"],
    "B requests the full region, not deduped against the staler in-flight A",
  );

  void a;
  void b;
});

// =============================================================================
// Ordering Parity Tests
// =============================================================================
//
// Bookmark pagination depends on three orderings agreeing:
//   1. compareFunction      — orders cached objects for display
//   2. bookmarkToExpression — evaluated client-side by findMatchingObjects to
//                             decide which cached rows fall inside a bounded
//                             region
//   3. MongoDB              — the probe's sort order and the bounded fetch's
//                             range matching (via toMongoQuery; see the
//                             bookmark translation test in test/db.ts)
//
// The pagination contract: each sort key holds values of a single scalar type,
// or null/missing. Mixed number/string within one key also works (all sides
// agree strings sort after numbers). Booleans mixed with numbers within one
// key are OUTSIDE the contract for expression evaluation: the client
// evaluator (lib/common/expression/evaluate.ts compare) coerces booleans to
// numbers, disagreeing with MongoDB's type-bracket order (booleans after
// strings) which compareFunction follows. In practice boolean params (Tags)
// are boolean-or-missing only. String caveat: MongoDB compares UTF-8 bytes,
// JS UTF-16 code units — parity holds for ASCII; exotic code points may order
// differently (same as master).

const PARITY_DOMAINS: Record<
  string,
  (string | number | boolean | null | undefined)[]
> = {
  number: [null, undefined, -10, 0, 10],
  string: [null, undefined, "", "a", "ab"],
  boolean: [null, undefined, false, true],
};

function parityRow(
  v1: string | number | boolean | null | undefined,
  v2: string | number | boolean | null | undefined,
  wrapped: boolean,
): Record<string, unknown> {
  // undefined = missing param; null = present but null. Wrapped mimics the
  // device object shape ({value: [v]}) that both compareFunction and
  // evaluateExpression unwrap.
  const row: Record<string, unknown> = {};
  if (v1 !== undefined)
    row["p1"] = wrapped && v1 !== null ? { value: [v1] } : v1;
  if (v2 !== undefined)
    row["p2"] = wrapped && v2 !== null ? { value: [v2] } : v2;
  return row;
}

void test("ordering parity: bookmarkToExpression matches compareFunction under client evaluation", () => {
  const types = Object.keys(PARITY_DOMAINS);
  for (const t1 of types) {
    for (const t2 of types) {
      for (const d1 of [1, -1]) {
        for (const d2 of [1, -1]) {
          for (const wrapped of [false, true]) {
            const sort = { p1: d1, p2: d2 };
            const cmp = compareFunction(sort);
            const rows: Record<string, unknown>[] = [];
            for (const v1 of PARITY_DOMAINS[t1])
              for (const v2 of PARITY_DOMAINS[t2])
                rows.push(parityRow(v1, v2, wrapped));

            for (const b of rows) {
              const bookmark = toBookmark(
                sort,
                b as Parameters<typeof toBookmark>[1],
              );
              const expr = bookmarkToExpression(bookmark, sort);
              for (const a of rows) {
                // Row a is inside the bounded region (<= bookmark position)
                // iff compareFunction places it at or before row b
                const expected = (cmp(a, b) as number) <= 0;
                const res = evaluateExpression(expr, a);
                const actual = res instanceof Expression.Literal && !!res.value;
                assert.strictEqual(
                  actual,
                  expected,
                  `row=${JSON.stringify(a)} bookmark-row=${JSON.stringify(b)} ` +
                    `sort=${JSON.stringify(sort)} wrapped=${wrapped}: ` +
                    `expression says ${actual}, compareFunction says ${expected}`,
                );
              }
            }
          }
        }
      }
    }
  }
});

void test("ordering parity: compareFunction matches MongoDB type-bracket sort order", () => {
  // Expected orderings per MongoDB's documented comparison/sort order
  // (bson-type-comparison-order): null/missing < numbers < strings; numeric
  // within numbers, lexicographic (ASCII) within strings, false < true.
  // Each case lists values in ascending MongoDB order; null and undefined
  // (missing) tie.
  const cases: (string | number | boolean | null | undefined)[][] = [
    [null, undefined, -10, -1.5, 0, 10],
    [null, undefined, "", "5", "A", "Z", "a", "ab", "b"],
    [null, undefined, false, true],
    // Full bracket order: numbers < strings < booleans. Mixed-type params
    // occur in practice; "" and "5" are numeric-coercible strings that JS
    // comparison would misorder against numbers.
    [null, undefined, -10, 0, 10, "", "5", "A", "a", false, true],
  ];

  for (const ordered of cases) {
    for (const dir of [1, -1]) {
      const cmp = compareFunction({ p: dir });
      // rank: position in expected ascending order; null/missing tie at 0
      const rank = (i: number): number => (ordered[i] == null ? 0 : i);
      // deterministic shuffle: odd indices first, then evens reversed
      const idx = ordered.map((_, i) => i);
      const shuffled = [
        ...idx.filter((i) => i % 2),
        ...idx.filter((i) => !(i % 2)).reverse(),
      ];
      const rows = shuffled.map((i) => ({
        i,
        row: ordered[i] === undefined ? {} : { p: ordered[i] },
      }));

      rows.sort((x, y) => cmp(x.row, y.row) as number);

      const ranks = rows.map((x) => rank(x.i));
      const expectedRanks = [...ranks].sort((a, b) => (a - b) * dir);
      assert.deepStrictEqual(
        ranks,
        expectedRanks,
        `dir=${dir} case=${JSON.stringify(ordered)}`,
      );
    }
  }
});

// =============================================================================
// Region lifecycle
// =============================================================================
//
// The cache region is the unit of storage and reactivity: queries are pure
// projections over the regions they overlap, so landing a region heals every
// overlapping query (passive propagation), and carve-on-touch refetches at
// the granularity of the demand footprint, never the whole region.

void test("passive propagation: a settled query heals when another query refreshes its region", async () => {
  mockClearHandlers();
  clearStores();

  const resource = "presets";
  const before = [
    { _id: "p-1", name: "old" },
    { _id: "p-2", name: "old" },
  ];
  mockRegisterHandler(mockQueryHandler(`api/${resource}/`, before));

  const filter: Expression = new Expression.Literal(true);
  const broad = reactiveStoreFetch(resource, filter);
  await wait(50);
  assert.strictEqual(broad.get().loading, false);
  const settled = broad.get().value;
  assert.strictEqual(settled.length, 2);

  // Server-side update of p-1; a DIFFERENT query forces a refresh of just
  // that sliver.
  mockClearHandlers();
  mockRegisterHandler(
    mockQueryHandler(`api/${resource}/`, [
      { _id: "p-1", name: "new" },
      { _id: "p-2", name: "old" },
    ]),
  );
  const sliver = reactiveStoreFetch(resource, Expression.parse('_id = "p-1"'), {
    freshness: Date.now() + 100000,
  });

  // The broad query overlaps the now-pending sliver: stale-while-revalidate
  // shows its old rows under a loading flag.
  assert.strictEqual(broad.get().loading, true);
  assert.strictEqual(broad.get().value.length, 2);

  await wait(50);

  // When the sliver lands, the broad query heals automatically — it issued
  // no request of its own and was never re-created.
  assert.strictEqual(sliver.get().loading, false);
  assert.strictEqual(broad.get().loading, false);
  const healed = broad.get().value;
  assert.strictEqual(
    (healed[0] as { name: string }).name,
    "new",
    "the settled query must pick up the other query's refresh",
  );
  // The untouched row kept its identity: rows are moved between regions on
  // a carve, never copied
  assert.strictEqual(healed[1], settled[1]);
});

void test("carve-on-touch: only the demanded sliver is refetched; the remainder keeps its rows", async () => {
  mockClearHandlers();
  clearStores();

  const resource = "faults";
  const data = [
    { _id: "r1", priority: 1 },
    { _id: "r2", priority: 2 },
    { _id: "r3", priority: 3 },
  ];
  mockRegisterHandler(mockQueryHandler(`api/${resource}/`, data, 50));

  const broad = reactiveStoreFetch(resource, new Expression.Literal(true));
  await wait(100);
  assert.strictEqual(broad.get().value.length, 3);
  const t0 = broad.get().timestamp;

  mockClearRequestLog();

  // Force-refresh a narrow slice of the broad region
  const narrow = reactiveStoreFetch(
    resource,
    Expression.parse("priority <= 2"),
    { freshness: Date.now() + 100000 },
  );

  // Exactly one request, scoped to the carved sliver — not the whole region
  const log = mockGetRequestLog();
  assert.strictEqual(log.length, 1);
  assert.deepStrictEqual(
    rowIds(matchingRows(data, getRequestParams(log[0].url)["filter"])),
    ["r1", "r2"],
    "request must cover exactly the demanded sliver",
  );

  // Mid-flight: a pending region over the sliver carrying the provisional
  // rows, plus the fresh remainder keeping its rows and original timestamp,
  // disjoint from each other.
  const regions = getRegions(resource);
  assert.strictEqual(regions.length, 2);
  const pending = regions.find((r) => r.state === "pending");
  const remainder = regions.find((r) => r.state === "fresh");
  assert.ok(pending && remainder, "one pending sliver + one fresh remainder");
  assert.deepStrictEqual(rowIds(pending.objects).sort(), ["r1", "r2"]);
  assert.deepStrictEqual(rowIds(remainder.objects), ["r3"]);
  assert.strictEqual(remainder.timestamp, t0);
  assert.ok(
    covers(
      new Expression.Literal(false),
      Expression.and(pending.filter, remainder.filter),
    ),
    "carved regions must be disjoint",
  );

  // The narrow query shows the provisional rows while loading (SWR built in)
  assert.strictEqual(narrow.get().loading, true);
  assert.deepStrictEqual(rowIds(narrow.get().value), ["r1", "r2"]);

  await wait(100);
  assert.strictEqual(narrow.get().loading, false);
  assert.deepStrictEqual(rowIds(narrow.get().value), ["r1", "r2"]);
});
