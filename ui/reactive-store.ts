import m from "mithril";
import {
  SignalBase,
  ComputedSignal,
  ComputedState,
  Watcher,
  registerDependency,
} from "./signals.ts";
import { xhrRequest } from "./store.ts";
import { SkewedDate } from "./skewed-date.ts";
import { subtract, covers } from "../lib/common/expression/synth.ts";
import {
  bookmarkToExpression,
  toBookmark,
} from "../lib/common/expression/pagination.ts";
import Expression from "../lib/common/expression.ts";
import memoize from "../lib/common/memoize.ts";

const memoizedStringify = memoize((e: Expression) => e.toString());

function evaluate(
  exp: Expression,
  timestamp: number,
  obj: Record<string, unknown>,
): Expression {
  return exp.evaluate((e) => {
    if (e instanceof Expression.Literal) return e;
    else if (e instanceof Expression.FunctionCall) {
      if (e.name === "NOW") return new Expression.Literal(timestamp);
    } else if (e instanceof Expression.Parameter && obj) {
      let v = obj[e.path.toString()];
      if (v == null) return new Expression.Literal(null);
      if (typeof v === "object")
        v = (v as Record<string, unknown>)["value"]?.[0];
      return new Expression.Literal(v as string | number | boolean | null);
    }
    return e;
  });
}

type BookmarkData = Record<string, null | boolean | number | string>;

export interface QueryState<T> {
  value: T;
  timestamp: number; // 0 means never fetched
  loading: boolean;
}

interface FetchedRegion {
  filter: Expression;
  timestamp: number;
  filterStr: string;
}

interface CachedCount {
  value: number;
  timestamp: number;
}

interface CachedBookmark {
  data: BookmarkData | null;
  timestamp: number;
}

interface ResourceCache {
  objects: Map<string, unknown>; // Cached objects by ID
  counts: Map<string, CachedCount>; // Count cache keyed by stringified filter
  bookmarks: Map<string, CachedBookmark>; // Bookmark cache keyed by (filter, sort, offset)
  fetchedRegions: FetchedRegion[]; // Tracks what filter regions were fetched when
}

export class Bookmark {
  constructor(
    private _data: BookmarkData,
    private _sort: Record<string, number>,
  ) {}

  // bookmarkToExpression returns condition for rows <= bookmark position
  applySkip(filter: Expression): Expression {
    const condition = bookmarkToExpression(this._data, this._sort);
    return Expression.and(filter, condition);
  }

  // NOT(rows <= bookmark) = rows > bookmark
  applyLimit(filter: Expression): Expression {
    const condition = bookmarkToExpression(this._data, this._sort);
    return Expression.and(filter, new Expression.Unary("NOT", condition));
  }
}

export class QuerySignal<T> extends SignalBase<QueryState<T>> {
  declare _sinks: Set<globalThis.WeakRef<ComputedSignal<unknown> | Watcher>>;
  private _state: QueryState<T>;

  constructor(initialValue: T) {
    super();
    this._sinks = new Set();
    this._state = {
      value: initialValue,
      timestamp: 0,
      loading: true,
    };
  }

  get(): QueryState<T> {
    if (this._disposed) throw new Error("Cannot read disposed signal");
    registerDependency(this);
    return this._state;
  }

  // Returns the state without registering a dependency
  _peek(): QueryState<T> {
    if (this._disposed) throw new Error("Cannot read disposed signal");
    return this._state;
  }

  _update(value: T, timestamp: number, loading: boolean): void {
    const changed =
      !Object.is(this._state.value, value) ||
      this._state.timestamp !== timestamp ||
      this._state.loading !== loading;

    if (changed) {
      this._state = { value, timestamp, loading };
      this._markSinksDirty();
    }
  }

  private _markSinksDirty(): void {
    for (const weakRef of this._sinks) {
      const sink = weakRef.deref();
      if (sink === undefined) {
        this._sinks.delete(weakRef);
        continue;
      }
      if (sink instanceof Watcher) {
        sink._notify();
        continue;
      }
      sink._state = ComputedState.Dirty;
      this._markSinksChecking(sink._sinks);
    }
  }

  private _markSinksChecking(
    sinks: Set<globalThis.WeakRef<ComputedSignal<unknown> | Watcher>>,
  ): void {
    for (const weakRef of sinks) {
      const sink = weakRef.deref();
      if (sink === undefined) {
        sinks.delete(weakRef);
        continue;
      }
      if (sink instanceof Watcher) {
        sink._notify();
        continue;
      }
      if ((sink as { _state: ComputedState })._state === ComputedState.Clean) {
        (sink as { _state: ComputedState })._state = ComputedState.Checking;
        this._markSinksChecking((sink as ComputedSignal<unknown>)._sinks);
      }
    }
  }

  [Symbol.dispose](): void {
    if (this._disposed) return;
    this._disposed = true;
    this._sinks.clear();
  }
}

function compareFunction(
  sort: Record<string, number>,
): (a: unknown, b: unknown) => number {
  return (a, b) => {
    for (const [param, asc] of Object.entries(sort)) {
      let v1 = (a as Record<string, unknown>)[param];
      let v2 = (b as Record<string, unknown>)[param];
      if (v1 != null && typeof v1 === "object") {
        const v1Obj = v1 as { value?: unknown[] };
        if (v1Obj.value) v1 = v1Obj.value[0];
        else v1 = null;
      }
      if (v2 != null && typeof v2 === "object") {
        const v2Obj = v2 as { value?: unknown[] };
        if (v2Obj.value) v2 = v2Obj.value[0];
        else v2 = null;
      }
      if (v1 > v2) {
        return asc;
      } else if (v1 < v2) {
        return asc * -1;
      } else if (v1 !== v2) {
        const w: Record<string, number> = {
          null: 1,
          number: 2,
          string: 3,
        };
        const w1 = w[v1 == null ? "null" : typeof v1] || 4;
        const w2 = w[v2 == null ? "null" : typeof v2] || 4;
        return Math.max(-1, Math.min(1, w1 - w2)) * asc;
      }
    }
    return 0;
  };
}

function getObjectId(resourceType: string, obj: unknown): string {
  const record = obj as Record<string, unknown>;
  if (resourceType === "devices") {
    const deviceId = record["DeviceID.ID"] as { value?: unknown[] } | undefined;
    return (deviceId?.value?.[0] as string) ?? "";
  }
  return (record["_id"] as string) ?? "";
}

interface FetchQueryEntry {
  weakRef: globalThis.WeakRef<QuerySignal<unknown[]>>;
  filter: Expression;
  sort: Record<string, number>;
}

interface CountQueryEntry {
  weakRef: globalThis.WeakRef<QuerySignal<number>>;
  filter: Expression;
}

interface BookmarkQueryEntry {
  weakRef: globalThis.WeakRef<QuerySignal<Bookmark | null>>;
  filter: Expression;
  sort: Record<string, number>;
  offset: number;
}

class ResourceStore {
  private cache: ResourceCache;
  private fetchQueries: Map<string, FetchQueryEntry>;
  private countQueries: Map<string, CountQueryEntry>;
  private bookmarkQueries: Map<string, BookmarkQueryEntry>;
  private registry: globalThis.FinalizationRegistry<{
    type: string;
    key: string;
  }>;

  constructor(private resourceType: string) {
    this.cache = {
      objects: new Map(),
      counts: new Map(),
      bookmarks: new Map(),
      fetchedRegions: [],
    };
    this.fetchQueries = new Map();
    this.countQueries = new Map();
    this.bookmarkQueries = new Map();

    this.registry = new globalThis.FinalizationRegistry(({ type, key }) => {
      this.onQueryDisposed(type, key);
    });
  }

  fetch(
    filter: Expression,
    sort: Record<string, number>,
    freshness: number,
  ): QuerySignal<unknown[]> {
    const filterStr = memoizedStringify(filter);
    const key = `${filterStr}:${JSON.stringify(sort)}`;

    const existingEntry = this.fetchQueries.get(key);
    if (existingEntry) {
      const existing = existingEntry.weakRef.deref();
      if (existing) {
        // Use _peek() to avoid registering a dependency on the caller
        const state = existing._peek();
        if (state.timestamp < freshness && !state.loading) {
          existing._update(state.value, state.timestamp, true);
          this.triggerFetchRefresh(filter, sort, existing, freshness);
        }
        return existing;
      }
    }

    const signal = new QuerySignal<unknown[]>([]);
    const weakRef = new globalThis.WeakRef(signal);
    this.fetchQueries.set(key, { weakRef, filter, sort });
    this.registry.register(signal, { type: "fetch", key });

    const cachedData = this.findMatchingObjects(filter, sort);
    const { covered, oldestTimestamp } = this.checkCoverage(filter, freshness);

    if (cachedData.length > 0) {
      signal._update(cachedData, oldestTimestamp, !covered);
    }

    if (!covered) {
      this.triggerFetchRefresh(filter, sort, signal, freshness);
    } else {
      signal._update(cachedData, oldestTimestamp, false);
    }

    return signal;
  }

  count(filter: Expression, freshness: number): QuerySignal<number> {
    const filterStr = memoizedStringify(filter);

    const existingEntry = this.countQueries.get(filterStr);
    if (existingEntry) {
      const existing = existingEntry.weakRef.deref();
      if (existing) {
        // Use _peek() to avoid registering a dependency on the caller
        const state = existing._peek();
        if (state.timestamp < freshness && !state.loading) {
          existing._update(state.value, state.timestamp, true);
          this.triggerCountRefresh(filter, existing);
        }
        return existing;
      }
    }

    const signal = new QuerySignal<number>(0);
    const weakRef = new globalThis.WeakRef(signal);
    this.countQueries.set(filterStr, { weakRef, filter });
    this.registry.register(signal, { type: "count", key: filterStr });

    const cached = this.cache.counts.get(filterStr);
    if (cached && cached.timestamp >= freshness) {
      signal._update(cached.value, cached.timestamp, false);
    } else {
      if (cached) {
        signal._update(cached.value, cached.timestamp, true);
      }
      this.triggerCountRefresh(filter, signal);
    }

    return signal;
  }

  createBookmark(
    filter: Expression,
    sort: Record<string, number>,
    offset: number,
    freshness: number,
    after?: Bookmark,
  ): QuerySignal<Bookmark | null> {
    const effectiveFilter = after ? after.applySkip(filter) : filter;
    const filterStr = memoizedStringify(effectiveFilter);
    const key = `${filterStr}:${JSON.stringify(sort)}:${offset}`;

    const existingEntry = this.bookmarkQueries.get(key);
    if (existingEntry) {
      const existing = existingEntry.weakRef.deref();
      if (existing) {
        // Use _peek() to avoid registering a dependency on the caller
        const state = existing._peek();
        if (state.timestamp < freshness && !state.loading) {
          this.triggerBookmarkRefresh(effectiveFilter, sort, offset, existing);
        }
        return existing;
      }
    }

    const signal = new QuerySignal<Bookmark | null>(null);
    const weakRef = new globalThis.WeakRef(signal);
    this.bookmarkQueries.set(key, {
      weakRef,
      filter: effectiveFilter,
      sort,
      offset,
    });
    this.registry.register(signal, { type: "bookmark", key });

    const cached = this.cache.bookmarks.get(key);
    if (cached && cached.timestamp >= freshness) {
      const bookmark = cached.data ? new Bookmark(cached.data, sort) : null;
      signal._update(bookmark, cached.timestamp, false);
    } else {
      if (cached) {
        const bookmark = cached.data ? new Bookmark(cached.data, sort) : null;
        signal._update(bookmark, cached.timestamp, true);
      }
      this.triggerBookmarkRefresh(effectiveFilter, sort, offset, signal);
    }

    return signal;
  }

  private getCombinedFilter(minTimestamp: number): Expression {
    return this.cache.fetchedRegions
      .filter((region) => region.timestamp >= minTimestamp)
      .reduce(
        (acc, region) => Expression.or(acc, region.filter),
        new Expression.Literal(false) as Expression,
      );
  }

  private checkCoverage(
    filter: Expression,
    freshness: number,
  ): { covered: boolean; diff: Expression; oldestTimestamp: number } {
    const freshRegions = this.cache.fetchedRegions.filter(
      (region) => region.timestamp >= freshness,
    );

    if (freshRegions.length === 0) {
      return { covered: false, diff: filter, oldestTimestamp: 0 };
    }

    const combined = freshRegions.reduce(
      (acc, region) => Expression.or(acc, region.filter),
      new Expression.Literal(false) as Expression,
    );
    const oldestTimestamp = Math.min(...freshRegions.map((r) => r.timestamp));
    const diff = subtract(combined, filter);

    return {
      covered: diff instanceof Expression.Literal && !diff.value,
      diff,
      oldestTimestamp,
    };
  }

  private findMatchingObjects(
    filter: Expression,
    sort: Record<string, number>,
  ): unknown[] {
    const now = SkewedDate.now();
    const matches: unknown[] = [];

    for (const obj of this.cache.objects.values()) {
      const result = evaluate(filter, now, obj as Record<string, unknown>);
      if (result instanceof Expression.Literal && !!result.value) {
        matches.push(obj);
      }
    }

    return matches.sort(compareFunction(sort));
  }

  // Subtract new region from existing regions to maintain non-overlapping regions
  private addFetchedRegion(filter: Expression, timestamp: number): void {
    const filterStr = memoizedStringify(filter);
    const updatedRegions: FetchedRegion[] = [];

    for (const region of this.cache.fetchedRegions) {
      const remainder = subtract(filter, region.filter);
      if (!(remainder instanceof Expression.Literal && !remainder.value)) {
        updatedRegions.push({
          filter: remainder,
          timestamp: region.timestamp,
          filterStr: memoizedStringify(remainder),
        });
      }
    }

    updatedRegions.push({
      filter,
      timestamp,
      filterStr,
    });

    this.cache.fetchedRegions = updatedRegions;
  }

  // TODO: Consider batching concurrent fetch requests for the same resource.
  // Currently each query issues its own XHR. When multiple queries are
  // triggered at the same time (e.g. after invalidation), they race and
  // fetch overlapping data independently. A batching mechanism could combine
  // them into fewer requests by deferring execution to the next microtask and
  // merging the filters.
  private triggerFetchRefresh(
    filter: Expression,
    sort: Record<string, number>,
    signal: QuerySignal<unknown[]>,
    freshness: number,
  ): void {
    const doFetch = async (retryCount = 0): Promise<void> => {
      try {
        const combined = this.getCombinedFilter(freshness);
        const diff = subtract(combined, filter);

        if (diff instanceof Expression.Literal && !diff.value) {
          const data = this.findMatchingObjects(filter, sort);
          signal._update(data, Date.now(), false);
          return;
        }

        const filterStr = memoizedStringify(diff);
        const res = await xhrRequest({
          method: "GET",
          url:
            `api/${this.resourceType}/?` +
            m.buildQueryString({
              filter: filterStr,
            }),
          background: true,
        });

        const returnedIds = new Set<string>();
        for (const obj of res as unknown[]) {
          const id = getObjectId(this.resourceType, obj);
          if (id) {
            this.cache.objects.set(id, obj);
            returnedIds.add(id);
          }
        }
        for (const obj of this.findMatchingObjects(filter, {})) {
          const id = getObjectId(this.resourceType, obj);
          if (!returnedIds.has(id)) this.cache.objects.delete(id);
        }

        const now = Date.now();
        this.addFetchedRegion(diff, now);
        const data = this.findMatchingObjects(filter, sort);
        signal._update(data, now, false);
      } catch (err) {
        console.error(
          `Error fetching ${this.resourceType}:`,
          (err as Error).message,
        );
        if (retryCount < 1) {
          await new Promise((resolve) => globalThis.setTimeout(resolve, 1000));
          return doFetch(retryCount + 1);
        }
        const state = signal.get();
        signal._update(state.value, state.timestamp, false);
      }
    };

    void doFetch();
  }

  private triggerCountRefresh(
    filter: Expression,
    signal: QuerySignal<number>,
  ): void {
    const doCount = async (retryCount = 0): Promise<void> => {
      try {
        const filterStr = memoizedStringify(filter);
        const countValue = await xhrRequest({
          method: "HEAD",
          url:
            `api/${this.resourceType}/?` +
            m.buildQueryString({
              filter: filterStr,
            }),
          extract: (xhr: XMLHttpRequest) => {
            if (xhr.status === 403) throw new Error("Not authorized");
            if (!xhr.status) throw new Error("Server is unreachable");
            if (xhr.status !== 200) {
              throw new Error(`Unexpected response status code ${xhr.status}`);
            }
            return +xhr.getResponseHeader("x-total-count")!;
          },
          background: true,
        });

        const now = Date.now();
        this.cache.counts.set(filterStr, { value: countValue, timestamp: now });
        signal._update(countValue, now, false);
      } catch (err) {
        console.error(
          `Error counting ${this.resourceType}:`,
          (err as Error).message,
        );
        if (retryCount < 1) {
          await new Promise((resolve) => globalThis.setTimeout(resolve, 1000));
          return doCount(retryCount + 1);
        }
        const state = signal.get();
        signal._update(state.value, state.timestamp, false);
      }
    };

    void doCount();
  }

  private triggerBookmarkRefresh(
    filter: Expression,
    sort: Record<string, number>,
    offset: number,
    signal: QuerySignal<Bookmark | null>,
  ): void {
    const doBookmark = async (retryCount = 0): Promise<void> => {
      try {
        const filterStr = memoizedStringify(filter);
        const projection = Object.keys(sort).join(",");

        const res = await xhrRequest({
          method: "GET",
          url:
            `api/${this.resourceType}/?` +
            m.buildQueryString({
              filter: filterStr,
              skip: offset,
              limit: 1,
              sort: JSON.stringify(sort),
              projection,
            }),
          background: true,
        });

        const now = Date.now();
        const key = `${filterStr}:${JSON.stringify(sort)}:${offset}`;

        let bookmarkData: BookmarkData | null = null;
        if ((res as unknown[]).length > 0) {
          bookmarkData = toBookmark(sort, (res as unknown[])[0]);
        }

        this.cache.bookmarks.set(key, { data: bookmarkData, timestamp: now });
        const bookmark = bookmarkData ? new Bookmark(bookmarkData, sort) : null;
        signal._update(bookmark, now, false);
      } catch (err) {
        console.error(
          `Error creating bookmark for ${this.resourceType}:`,
          (err as Error).message,
        );
        if (retryCount < 1) {
          await new Promise((resolve) => globalThis.setTimeout(resolve, 1000));
          return doBookmark(retryCount + 1);
        }
        const state = signal.get();
        signal._update(state.value, state.timestamp, false);
      }
    };

    void doBookmark();
  }

  invalidate(timestamp: number): void {
    // Invalidate queries whose data was fetched strictly before the given
    // timestamp. The timestamp is exclusive: data fetched at exactly the
    // given timestamp is considered fresh.
    for (const [, entry] of this.fetchQueries) {
      const signal = entry.weakRef.deref();
      if (!signal || signal._disposed) continue;
      const state = signal._peek();
      if (state.timestamp < timestamp && !state.loading) {
        signal._update(state.value, state.timestamp, true);
        this.triggerFetchRefresh(entry.filter, entry.sort, signal, timestamp);
      }
    }

    // Invalidate count queries
    for (const [, entry] of this.countQueries) {
      const signal = entry.weakRef.deref();
      if (!signal || signal._disposed) continue;
      const state = signal._peek();
      if (state.timestamp < timestamp && !state.loading) {
        signal._update(state.value, state.timestamp, true);
        this.triggerCountRefresh(entry.filter, signal);
      }
    }

    // Invalidate bookmark queries
    for (const [, entry] of this.bookmarkQueries) {
      const signal = entry.weakRef.deref();
      if (!signal || signal._disposed) continue;
      const state = signal._peek();
      if (state.timestamp < timestamp && !state.loading) {
        signal._update(state.value, state.timestamp, true);
        this.triggerBookmarkRefresh(
          entry.filter,
          entry.sort,
          entry.offset,
          signal,
        );
      }
    }
  }

  private onQueryDisposed(type: string, key: string): void {
    if (type === "fetch") {
      this.fetchQueries.delete(key);
      this.pruneCache();
    } else if (type === "count") {
      this.countQueries.delete(key);
      this.cache.counts.delete(key);
    } else if (type === "bookmark") {
      this.bookmarkQueries.delete(key);
      this.cache.bookmarks.delete(key);
    }
  }

  private pruneCache(): void {
    const neededFilters: Expression[] = [];

    for (const [key, entry] of this.fetchQueries) {
      const signal = entry.weakRef.deref();
      if (!signal || signal._disposed) {
        this.fetchQueries.delete(key);
        continue;
      }
      neededFilters.push(entry.filter);
    }

    if (neededFilters.length === 0) {
      this.cache.objects.clear();
      this.cache.fetchedRegions = [];
      return;
    }

    const combinedNeeded = neededFilters.reduce(
      (acc, filter) => Expression.or(acc, filter),
      new Expression.Literal(false) as Expression,
    );

    const keptRegions: FetchedRegion[] = [];

    for (const region of this.cache.fetchedRegions) {
      const intersection = Expression.and(region.filter, combinedNeeded);
      if (!covers(new Expression.Literal(false), intersection)) {
        keptRegions.push(region);
      }
    }

    this.cache.fetchedRegions = keptRegions;

    if (keptRegions.length === 0) {
      this.cache.objects.clear();
    } else {
      const keptCombined = keptRegions.reduce(
        (acc, region) => Expression.or(acc, region.filter),
        new Expression.Literal(false) as Expression,
      );

      const now = SkewedDate.now();
      for (const [id, obj] of this.cache.objects) {
        const result = evaluate(
          keptCombined,
          now,
          obj as Record<string, unknown>,
        );
        if (!(result instanceof Expression.Literal && !!result.value)) {
          this.cache.objects.delete(id);
        }
      }
    }
  }
}

const stores: Map<string, ResourceStore> = new Map();

function getStore(resource: string): ResourceStore {
  let store = stores.get(resource);
  if (!store) {
    store = new ResourceStore(resource);
    stores.set(resource, store);
  }
  return store;
}

function applyDefaultSort(
  resourceType: string,
  sort?: Record<string, number>,
): Record<string, number> {
  const result = Object.assign({}, sort);
  if (resourceType === "devices") {
    result["DeviceID.ID"] = result["DeviceID.ID"] || 1;
  } else {
    result["_id"] = result["_id"] || 1;
  }
  return result;
}

export function fetch(
  resource: string,
  filter: Expression,
  options: {
    sort?: Record<string, number>;
    freshness?: number;
  } = {},
): QuerySignal<unknown[]> {
  const sort = applyDefaultSort(resource, options.sort);
  const freshness = options.freshness ?? 0;
  return getStore(resource).fetch(filter, sort, freshness);
}

export function count(
  resource: string,
  filter: Expression,
  options: { freshness?: number } = {},
): QuerySignal<number> {
  const freshness = options.freshness ?? 0;
  return getStore(resource).count(filter, freshness);
}

export function createBookmark(
  resource: string,
  filter: Expression,
  sort: Record<string, number>,
  offset: number,
  options: {
    freshness?: number;
    after?: Bookmark;
  } = {},
): QuerySignal<Bookmark | null> {
  const normalizedSort = applyDefaultSort(resource, sort);
  const freshness = options.freshness ?? 0;
  return getStore(resource).createBookmark(
    filter,
    normalizedSort,
    offset,
    freshness,
    options.after,
  );
}

export function invalidate(timestamp: number): void {
  for (const store of stores.values()) {
    store.invalidate(timestamp);
  }
}
