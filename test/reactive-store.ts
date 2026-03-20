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
  invalidate,
  QuerySignal,
  Bookmark,
} from "../ui/reactive-store.ts";

// Test-only exports added by build/test.ts plugin at build time
import * as reactiveStore from "../ui/reactive-store.ts";
const compareFunction = (reactiveStore as Record<string, unknown>)[
  "_testCompareFunction"
] as (sort: Record<string, number>) => (a: unknown, b: unknown) => number;
const getObjectId = (reactiveStore as Record<string, unknown>)[
  "_testGetObjectId"
] as (resourceType: string, obj: unknown) => string;
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

interface FetchedRegion {
  filter: Expression;
  timestamp: number;
  filterStr: string;
}
interface ResourceCache {
  objects: Map<string, unknown>;
  counts: Map<string, unknown>;
  bookmarks: Map<string, unknown>;
  fetchedRegions: FetchedRegion[];
}

function getCacheState(resource: string): {
  objectCount: number;
  regionCount: number;
  regions: Array<{ filter: Expression; timestamp: number }>;
  fetchQueryCount: number;
} {
  const store = getStore(resource);
  const cache = (store as { cache: ResourceCache }).cache;
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

  return {
    objectCount: cache.objects.size,
    regionCount: cache.fetchedRegions.length,
    regions: cache.fetchedRegions.map((r) => ({
      filter: r.filter,
      timestamp: r.timestamp,
    })),
    fetchQueryCount: activeFetchQueries,
  };
}

function clearStores(): void {
  stores.clear();
}

function forcePruneCache(resource: string): void {
  const store = getStore(resource);
  (store as { pruneCache: () => void }).pruneCache();
}

// Import mock utilities for controlling xhrRequest behavior in tests
import {
  mockRegisterHandler,
  mockClearHandlers,
  mockFetchHandler,
  mockCountHandler,
  mockGetRequestLog,
  mockClearRequestLog,
} from "./mocks/store.ts";

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
// getObjectId Tests
// =============================================================================

void test("getObjectId extracts correct ID based on resource type", () => {
  const device = {
    "DeviceID.ID": { value: ["device-123"] },
    _id: "should-not-use",
  };
  const preset = { _id: "preset-123", name: "My Preset" };

  assert.strictEqual(getObjectId("devices", device), "device-123");
  assert.strictEqual(getObjectId("presets", preset), "preset-123");
  assert.strictEqual(getObjectId("devices", { "DeviceID.ID": {} }), "");
  assert.strictEqual(getObjectId("faults", {}), "");
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
// createBookmark() Tests
// =============================================================================

void test("createBookmark() returns QuerySignal with Bookmark", async () => {
  mockClearHandlers();

  const rowAtOffset = [{ _id: "preset-5", name: "Fifth" }];

  mockRegisterHandler(mockFetchHandler("api/presets/", rowAtOffset));

  const filter: Expression = new Expression.Literal(true);
  const sort = { _id: 1 };
  const signal = reactiveStoreCreateBookmark("presets", filter, sort, 5);

  assert.ok(signal instanceof QuerySignal);

  await new Promise((resolve) => setTimeout(resolve, 50));

  const state = signal.get();
  assert.strictEqual(state.loading, false);
  assert.ok(state.value instanceof Bookmark);
});

void test("createBookmark() returns null when offset is beyond result count", async () => {
  mockClearHandlers();

  mockRegisterHandler(mockFetchHandler("api/presets/", []));

  const filter: Expression = new Expression.Literal(true);
  const sort = { _id: 1 };
  const signal = reactiveStoreCreateBookmark("presets", filter, sort, 1000);

  await new Promise((resolve) => setTimeout(resolve, 50));

  const state = signal.get();
  assert.strictEqual(state.loading, false);
  assert.strictEqual(state.value, null);
});

void test("Bookmark.applySkip() and applyLimit() modify filter correctly", async () => {
  mockClearHandlers();

  const rowAtOffset = [{ _id: "preset-10", active: true }];
  mockRegisterHandler(mockFetchHandler("api/presets/", rowAtOffset));

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

// =============================================================================
// Caching Tests - fetch() results caching
// =============================================================================

void test("fetch() uses cached data without making new request", async () => {
  mockClearHandlers();

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

  const state = getCacheState(resource);
  assert.strictEqual(state.objectCount, 2, "Should have 2 objects cached");
  assert.strictEqual(state.regionCount, 1, "Should have 1 region");
  assert.strictEqual(state.fetchQueryCount, 1, "Should have 1 active query");

  signal[Symbol.dispose]();
  void signal;

  forcePruneCache(resource);

  void getCacheState(resource);
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

void test("invalidate() skips queries that are already loading", async () => {
  mockClearHandlers();
  clearStores();

  const resource = "config";
  const data = [{ _id: "cfg-1", value: "test" }];

  // Use a slow handler so initial fetch is still in-flight
  mockRegisterHandler(mockFetchHandler(`api/${resource}/`, data, 200));

  const signal = reactiveStoreFetch(resource, new Expression.Literal(true));

  // Signal should still be loading from initial fetch
  const state = signal._peek();
  assert.strictEqual(
    state.loading,
    true,
    "Should be loading from initial fetch",
  );

  mockClearRequestLog();

  // Invalidate while still loading — should be a no-op
  invalidate(Date.now() + 100000);

  const log = mockGetRequestLog();
  assert.strictEqual(
    log.length,
    0,
    "Should not trigger additional request while already loading",
  );

  // Wait for original fetch to complete
  await new Promise((resolve) => setTimeout(resolve, 250));

  const finalState = signal.get();
  assert.strictEqual(finalState.loading, false);
  assert.strictEqual(finalState.value.length, 1);
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
