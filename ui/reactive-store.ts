import { request } from "./api-client.ts";
import {
  SignalBase,
  ComputedSignal,
  Watcher,
  registerDependency,
  markSinksDirty,
} from "./signals.ts";
import { SkewedDate } from "./skewed-date.ts";
import { subtract, covers } from "../lib/common/expression/synth.ts";
import {
  bookmarkToExpression,
  paginate,
  toBookmark,
} from "../lib/common/expression/pagination.ts";
import Expression from "../lib/common/expression.ts";

// =============================================================================
// Expression Evaluation
// =============================================================================

export function evaluateExpression(exp: Expression): Expression;
export function evaluateExpression(
  exp: Expression,
  obj: Record<string, unknown>,
): Expression.Literal;
export function evaluateExpression(
  exp: Expression,
  obj?: Record<string, unknown>,
): Expression {
  return evaluate(exp, SkewedDate.now(), obj);
}

function evaluate(
  exp: Expression,
  timestamp: number,
  obj?: Record<string, unknown>,
): Expression {
  return exp.evaluate((e) => {
    if (e instanceof Expression.Literal) return e;
    else if (e instanceof Expression.FunctionCall) {
      if (e.name === "NOW") return new Expression.Literal(timestamp);
    } else if (e instanceof Expression.Parameter && obj) {
      let v = obj[e.path.toString()];
      if (v == null) return new Expression.Literal(null);
      if (typeof v === "object")
        v = ((v as Record<string, unknown>)["value"] as unknown[])?.[0];
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
  bookmarks: Map<string, CachedBookmark>; // Bookmark cache keyed by (filter, sort, limit)
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

// A Set that notifies the owning QuerySignal when entries are removed,
// so the signal can auto-dispose when no live sinks remain.
class TrackedSinkSet extends Set<
  globalThis.WeakRef<ComputedSignal<unknown> | Watcher>
> {
  private _owner: QuerySignal<unknown> | null = null;

  _setOwner(owner: QuerySignal<unknown>): void {
    this._owner = owner;
  }

  override delete(
    value: globalThis.WeakRef<ComputedSignal<unknown> | Watcher>,
  ): boolean {
    const result = super.delete(value);
    if (result && this._owner && this.size === 0) {
      // Last sink removed — auto-dispose on next microtask so that
      // any ongoing batch of sink removals completes first.
      const owner = this._owner;
      queueMicrotask(() => {
        if (owner._disposed) return;
        // Re-check: a new sink may have been added in the meantime
        for (const ref of owner._sinks) {
          const sink = ref.deref();
          if (sink && !sink._disposed) return;
        }
        owner[Symbol.dispose]();
      });
    }
    return result;
  }
}

export class QuerySignal<T> extends SignalBase<QueryState<T>> {
  declare _sinks: TrackedSinkSet;
  private _state: QueryState<T>;
  private _onDispose: (() => void) | null = null;

  constructor(initialValue: T) {
    super();
    this._sinks = new TrackedSinkSet();
    (this._sinks as TrackedSinkSet)._setOwner(
      this as unknown as QuerySignal<unknown>,
    );
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
      markSinksDirty(this._sinks);
    }
  }

  _setOnDispose(callback: () => void): void {
    this._onDispose = callback;
  }

  [Symbol.dispose](): void {
    if (this._disposed) return;
    this._disposed = true;
    this._sinks.clear();
    if (this._onDispose) {
      this._onDispose();
      this._onDispose = null;
    }
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
      // Nulls and missing params tie with each other and sort first,
      // matching MongoDB's type bracket order. Checked explicitly because
      // JS comparison operators coerce null to 0, which would misorder
      // null against negative numbers.
      if (v1 == null || v2 == null) {
        if (v1 == null && v2 == null) continue;
        return (v1 == null ? -1 : 1) * asc;
      }
      // Compare type brackets before magnitude (number < string < other),
      // matching MongoDB's sort order. The magnitude comparison must never
      // see mixed-type operands: JS coercion would misorder numeric-looking
      // strings and booleans against numbers.
      const w: Record<string, number> = {
        number: 2,
        string: 3,
      };
      const w1 = w[typeof v1] || 4;
      const w2 = w[typeof v2] || 4;
      if (w1 !== w2) return Math.max(-1, Math.min(1, w1 - w2)) * asc;
      if ((v1 as number) > (v2 as number)) {
        return asc;
      } else if ((v1 as number) < (v2 as number)) {
        return asc * -1;
      }
    }
    return 0;
  };
}

// Cast a cached object or probe response row to the shape toBookmark expects
function asRow(
  obj: unknown,
): Record<string, string | number | boolean | { value: [string] } | null> {
  return obj as Record<
    string,
    string | number | boolean | { value: [string] } | null
  >;
}

function getObjectId(resourceType: string, obj: unknown): string {
  const record = obj as Record<string, unknown>;
  if (resourceType === "devices")
    return (record["DeviceID.ID"] as string) ?? "";
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
  limit: number;
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
    const filterStr = filter.toString();
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
      // WeakRef is dead — clean up before checking coverage
      this.fetchQueries.delete(key);
    }

    // Sweep dead entries so pruneCache clears stale fetchedRegions
    // that would otherwise make checkCoverage skip the re-fetch.
    this.sweepAndPrune();

    const signal = new QuerySignal<unknown[]>([]);
    signal._setOnDispose(() => this.onQueryDisposed("fetch", key));
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
    const filterStr = filter.toString();

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
    signal._setOnDispose(() => this.onQueryDisposed("count", filterStr));
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

  // Resolves to a Bookmark bounding (at least) the first `limit` records of
  // the filter, or null when fewer than `limit` records exist. The bound is
  // anchored to current cache coverage: cached fresh matches are counted
  // locally and only the remainder is probed, so the probe's skip stays
  // below one page regardless of pagination depth. Consequently the same
  // (filter, sort, limit) can yield different — equally valid — bookmarks
  // depending on coverage state at probe time; freshness governs staleness.
  createBookmark(
    filter: Expression,
    sort: Record<string, number>,
    limit: number,
    freshness: number,
  ): QuerySignal<Bookmark | null> {
    const filterStr = filter.toString();
    const key = `${filterStr}:${JSON.stringify(sort)}:${limit}`;

    const existingEntry = this.bookmarkQueries.get(key);
    if (existingEntry) {
      const existing = existingEntry.weakRef.deref();
      if (existing) {
        // Use _peek() to avoid registering a dependency on the caller
        const state = existing._peek();
        if (state.timestamp < freshness && !state.loading) {
          existing._update(state.value, state.timestamp, true);
          this.triggerBookmarkRefresh(filter, sort, limit, freshness, existing);
        }
        return existing;
      }
    }

    const signal = new QuerySignal<Bookmark | null>(null);
    signal._setOnDispose(() => this.onQueryDisposed("bookmark", key));
    const weakRef = new globalThis.WeakRef(signal);
    this.bookmarkQueries.set(key, {
      weakRef,
      filter,
      sort,
      limit,
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
      this.triggerBookmarkRefresh(filter, sort, limit, freshness, signal);
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

  // Cached objects forming the sort-contiguous covered prefix of the
  // filter — provably the first records of the query result (as of the
  // coverage's freshness). Purely a cache read; never issues a request.
  coveredPrefix(
    filter: Expression,
    sort: Record<string, number>,
    freshness: number,
  ): unknown[] {
    const combined = this.getCombinedFilter(freshness);
    if (combined instanceof Expression.Literal && !combined.value) return [];
    const [satisfied] = paginate(combined, filter, sort);
    if (satisfied instanceof Expression.Literal && !satisfied.value) return [];
    return this.findMatchingObjects(satisfied, sort);
  }

  // Subtract new region from existing regions to maintain non-overlapping regions
  private addFetchedRegion(filter: Expression, timestamp: number): void {
    const filterStr = filter.toString();
    const updatedRegions: FetchedRegion[] = [];

    for (const region of this.cache.fetchedRegions) {
      const remainder = subtract(filter, region.filter);
      if (!(remainder instanceof Expression.Literal && !remainder.value)) {
        updatedRegions.push({
          filter: remainder,
          timestamp: region.timestamp,
          filterStr: remainder.toString(),
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
  // Currently each query issues its own request. When multiple queries are
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
    // Hold the signal via WeakRef so the async closure does not prevent
    // the signal from being garbage-collected when no consumer remains.
    const signalRef = new globalThis.WeakRef(signal);

    const doFetch = async (retryCount = 0): Promise<void> => {
      try {
        const s = signalRef.deref();
        if (!s || s._disposed) return;

        const combined = this.getCombinedFilter(freshness);
        const diff = subtract(combined, filter);

        if (diff instanceof Expression.Literal && !diff.value) {
          const data = this.findMatchingObjects(filter, sort);
          s._update(data, Date.now(), false);
          return;
        }

        const filterStr = diff.toString();
        const res = (await request(`/api/${this.resourceType}/`, {
          params: { filter: filterStr },
        }).then((r) => r.json())) as unknown[];

        const s2 = signalRef.deref();
        if (!s2 || s2._disposed) return;

        const returnedIds = new Set<string>();
        for (const obj of res) {
          const id = getObjectId(this.resourceType, obj);
          if (id) {
            this.cache.objects.set(id, obj);
            returnedIds.add(id);
          }
        }
        // Only delete objects in the region we actually queried (diff).
        // Objects in already-covered regions are left untouched — we
        // didn't ask the server about those so we can't know if they
        // were deleted.
        for (const obj of this.findMatchingObjects(diff, {})) {
          const id = getObjectId(this.resourceType, obj);
          if (!returnedIds.has(id)) this.cache.objects.delete(id);
        }

        const now = Date.now();
        this.addFetchedRegion(diff, now);
        const data = this.findMatchingObjects(filter, sort);
        s2._update(data, now, false);
      } catch (err) {
        console.error(
          `Error fetching ${this.resourceType}:`,
          (err as Error).message,
        );
        if (retryCount < 1) {
          await new Promise((resolve) => globalThis.setTimeout(resolve, 1000));
          return doFetch(retryCount + 1);
        }
        const s = signalRef.deref();
        if (s && !s._disposed) {
          const state = s._peek();
          s._update(state.value, state.timestamp, false);
        }
      }
    };

    void doFetch();
  }

  private triggerCountRefresh(
    filter: Expression,
    signal: QuerySignal<number>,
  ): void {
    const signalRef = new globalThis.WeakRef(signal);

    const doCount = async (retryCount = 0): Promise<void> => {
      try {
        const s = signalRef.deref();
        if (!s || s._disposed) return;

        const filterStr = filter.toString();
        const res = await request(`/api/${this.resourceType}/`, {
          method: "HEAD",
          params: { filter: filterStr },
        });
        const countValue = +(res.headers.get("x-total-count") ?? 0);

        const s2 = signalRef.deref();
        if (!s2 || s2._disposed) return;

        const now = Date.now();
        this.cache.counts.set(filterStr, { value: countValue, timestamp: now });
        s2._update(countValue, now, false);
      } catch (err) {
        console.error(
          `Error counting ${this.resourceType}:`,
          (err as Error).message,
        );
        if (retryCount < 1) {
          await new Promise((resolve) => globalThis.setTimeout(resolve, 1000));
          return doCount(retryCount + 1);
        }
        const s = signalRef.deref();
        if (s && !s._disposed) {
          const state = s._peek();
          s._update(state.value, state.timestamp, false);
        }
      }
    };

    void doCount();
  }

  private triggerBookmarkRefresh(
    filter: Expression,
    sort: Record<string, number>,
    limit: number,
    freshness: number,
    signal: QuerySignal<Bookmark | null>,
  ): void {
    const signalRef = new globalThis.WeakRef(signal);
    const key = `${filter.toString()}:${JSON.stringify(sort)}:${limit}`;

    const settle = (
      s: QuerySignal<Bookmark | null>,
      data: BookmarkData | null,
      timestamp: number,
    ): void => {
      this.cache.bookmarks.set(key, { data, timestamp });
      s._update(data ? new Bookmark(data, sort) : null, timestamp, false);
    };

    const doBookmark = async (retryCount = 0): Promise<void> => {
      try {
        const s = signalRef.deref();
        if (!s || s._disposed) return;

        // Split the filter into the sort-contiguous covered prefix and the
        // remainder, count the cached prefix matches, and probe only the
        // remainder. Anchoring to the prefix keeps the probe's skip below
        // one page regardless of pagination depth, makes the skip
        // arithmetic exact even when coverage is scattered (non-prefix
        // coverage stays in the remainder, where the server counts it),
        // and inserts before the covered region can't starve the next
        // chunk of new rows.
        const freshRegions = this.cache.fetchedRegions.filter(
          (region) => region.timestamp >= freshness,
        );
        const combined = freshRegions.reduce(
          (acc, region) => Expression.or(acc, region.filter),
          new Expression.Literal(false) as Expression,
        );
        // The resolved bookmark is only as fresh as the oldest region that
        // contributed to the match count
        const timestamp = freshRegions.length
          ? Math.min(...freshRegions.map((r) => r.timestamp))
          : Date.now();

        const [satisfied, remainder] = paginate(combined, filter, sort);
        const cachedMatches = this.findMatchingObjects(satisfied, sort);
        const m = cachedMatches.length;

        if (m >= limit) {
          // The first `limit` records are all cached — bound by the
          // limit-th match without any request
          settle(
            s,
            toBookmark(sort, asRow(cachedMatches[limit - 1])),
            timestamp,
          );
          return;
        }

        if (remainder instanceof Expression.Literal && !remainder.value) {
          // The filter is fully covered and only m < limit records exist
          settle(s, null, timestamp);
          return;
        }

        const res = (await request(`/api/${this.resourceType}/`, {
          params: {
            filter: remainder.toString(),
            skip: String(limit - m - 1),
            limit: "1",
            sort: JSON.stringify(sort),
            projection: Object.keys(sort).join(","),
          },
        }).then((r) => r.json())) as unknown[];

        const s2 = signalRef.deref();
        if (!s2 || s2._disposed) return;

        if (res.length === 0) {
          // Fewer than limit − m records in the remainder → total < limit
          settle(s2, null, timestamp);
          return;
        }

        // The probe row bounds the whole first-`limit` set: paginate
        // guarantees every record of the satisfied prefix (the m cached
        // matches) sorts before every record of the remainder, so the
        // (limit − m)-th remainder record is the limit-th record overall.
        settle(s2, toBookmark(sort, asRow(res[0])), timestamp);
      } catch (err) {
        console.error(
          `Error creating bookmark for ${this.resourceType}:`,
          (err as Error).message,
        );
        if (retryCount < 1) {
          await new Promise((resolve) => globalThis.setTimeout(resolve, 1000));
          return doBookmark(retryCount + 1);
        }
        const s = signalRef.deref();
        if (s && !s._disposed) {
          const state = s._peek();
          s._update(state.value, state.timestamp, false);
        }
      }
    };

    void doBookmark();
  }

  invalidate(timestamp: number): void {
    // Invalidate queries whose data was fetched strictly before the given
    // timestamp. The timestamp is exclusive: data fetched at exactly the
    // given timestamp is considered fresh.
    for (const [key, entry] of this.fetchQueries) {
      const signal = entry.weakRef.deref();
      if (!signal || signal._disposed) {
        this.fetchQueries.delete(key);
        continue;
      }
      const state = signal._peek();
      if (state.timestamp < timestamp && !state.loading) {
        signal._update(state.value, state.timestamp, true);
        this.triggerFetchRefresh(entry.filter, entry.sort, signal, timestamp);
      }
    }

    // Invalidate count queries
    for (const [key, entry] of this.countQueries) {
      const signal = entry.weakRef.deref();
      if (!signal || signal._disposed) {
        this.countQueries.delete(key);
        continue;
      }
      const state = signal._peek();
      if (state.timestamp < timestamp && !state.loading) {
        signal._update(state.value, state.timestamp, true);
        this.triggerCountRefresh(entry.filter, signal);
      }
    }

    // Invalidate bookmark queries
    for (const [key, entry] of this.bookmarkQueries) {
      const signal = entry.weakRef.deref();
      if (!signal || signal._disposed) {
        this.bookmarkQueries.delete(key);
        continue;
      }
      const state = signal._peek();
      if (state.timestamp < timestamp && !state.loading) {
        signal._update(state.value, state.timestamp, true);
        this.triggerBookmarkRefresh(
          entry.filter,
          entry.sort,
          entry.limit,
          timestamp,
          signal,
        );
      }
    }

    this.sweepAndPrune();
  }

  private sweepAndPrune(): void {
    let swept = false;
    for (const [key, entry] of this.fetchQueries) {
      if (!entry.weakRef.deref()) {
        this.fetchQueries.delete(key);
        swept = true;
      }
    }
    for (const [key, entry] of this.countQueries) {
      if (!entry.weakRef.deref()) {
        this.countQueries.delete(key);
        this.cache.counts.delete(key);
      }
    }
    for (const [key, entry] of this.bookmarkQueries) {
      if (!entry.weakRef.deref()) {
        this.bookmarkQueries.delete(key);
        this.cache.bookmarks.delete(key);
      }
    }
    if (swept) this.pruneCache();
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
  limit: number,
  options: {
    freshness?: number;
  } = {},
): QuerySignal<Bookmark | null> {
  const normalizedSort = applyDefaultSort(resource, sort);
  const freshness = options.freshness ?? 0;
  return getStore(resource).createBookmark(
    filter,
    normalizedSort,
    limit,
    freshness,
  );
}

// Composes createBookmark and fetch into a limit-bounded query: probe for a
// bookmark bounding the first `limit` records, then fetch only the bounded
// region. Call inside a reactive computation — repeated calls are cheap
// (signals are deduplicated by the store) and register dependencies, so the
// computation re-runs as the bookmark and then the data resolve. Without
// `limit` this degrades to a plain fetch.
export function pagedFetch(
  resource: string,
  filter: Expression,
  options: {
    sort?: Record<string, number>;
    limit?: number;
    freshness?: number;
  } = {},
): { value: unknown[]; loading: boolean } {
  const { sort, limit, freshness } = options;
  if (!limit) {
    const q = fetch(resource, filter, { sort, freshness }).get();
    return { value: q.value, loading: q.loading };
  }
  const bm = createBookmark(resource, filter, sort ?? {}, limit, {
    freshness,
  }).get();
  // An unresolved probe must not fall through to an unbounded fetch.
  // timestamp === 0 means "never resolved" (vs. a resolved null value,
  // which means the whole collection holds fewer than `limit` records).
  // While the probe resolves, show the cached sort-contiguous covered
  // prefix of this query — provably its first records — so e.g. a "show
  // more" doesn't blank the records already on screen.
  if (bm.timestamp === 0) {
    const prefix = getStore(resource).coveredPrefix(
      filter,
      applyDefaultSort(resource, sort),
      freshness ?? 0,
    );
    return { value: prefix.slice(0, limit), loading: true };
  }
  const effective = bm.value ? bm.value.applySkip(filter) : filter;
  const q = fetch(resource, effective, { sort, freshness }).get();
  return { value: q.value.slice(0, limit), loading: q.loading || bm.loading };
}

export function invalidate(timestamp: number): void {
  for (const store of stores.values()) {
    store.invalidate(timestamp);
  }
}
