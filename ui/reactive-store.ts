// Region-centric reactive query store.
//
// The cache region is the unit of storage AND the unit of reactivity: an
// immutable set of disjoint regions, each owning its objects and a single
// freshness timestamp, lives in a state signal. Queries are pure projections
// over the regions they overlap, so when a region is refreshed every
// overlapping query heals automatically (passive propagation). All effects —
// carving gaps, coalescing them, firing fetches — are confined to one
// store-level settle pass over the active demands.

import { request } from "./api-client.ts";
import * as notifications from "./notifications.ts";
import {
  SignalBase,
  StateSignal,
  ComputedSignal,
  Watcher,
  registerDependency,
  markSinksDirty,
  untracked,
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

interface CachedCount {
  value: number;
  timestamp: number;
  stale: boolean; // invalidated; show while revalidating, never settle on it
}

interface CachedBookmark {
  data: BookmarkData | null;
  timestamp: number;
  stale: boolean; // invalidated; show while revalidating, never settle on it
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

// =============================================================================
// Regions
// =============================================================================

type RegionState = "fresh" | "stale" | "pending";

// An in-flight region fetch. Pending regions point at the request that will
// land into them; a region carved or invalidated away from the request drops
// the pointer, so the land handler only ever writes the footprint the request
// still owns (a superseded response is discarded for the lost footprint).
interface RegionRequest {
  issuedAt: number; // also the freshness stamp of the regions it lands
  // Demands this request was issued for — parked (backedOff) if it fails
  entries: FetchQueryEntry[];
}

// The atomic unit of cached truth: a disjoint area of the query space that
// owns the rows matching it. Regions are immutable — any change mints a new
// region object — so reference equality is an exact change detector for the
// read graph, and rows are moved (not copied) between regions so an unchanged
// row keeps its identity across carves.
interface Region {
  filter: Expression;
  state: RegionState;
  // Freshness of the data in `objects` (0 = no data yet). For a pending
  // region this describes the provisional rows shown while revalidating,
  // not the in-flight request.
  timestamp: number;
  // Pending regions: when their request was issued. Decides whether an
  // in-flight fetch is fresh enough to count toward a demand's coverage.
  issuedAt: number;
  objects: unknown[]; // canonical row instances
  owner: RegionRequest | null; // pending regions only
}

// servable(r, F): the single predicate shared by the gap computation,
// the loading flag, and carve-on-touch. Only a fresh region at least as fresh
// as the demand contributes trusted values; a fresh-state region stamped
// before the demand's freshness reads as loading and gets carved, never as
// settled.
function servable(region: Region, freshness: number): boolean {
  return region.state === "fresh" && region.timestamp >= freshness;
}

// Whether a region counts toward a demand's fetch coverage (i.e. must not be
// re-requested): servable, or pending with a request issued no earlier than
// the demanded freshness — its land will be servable.
function countsTowardCoverage(region: Region, freshness: number): boolean {
  if (servable(region, freshness)) return true;
  return region.state === "pending" && region.issuedAt >= freshness;
}

function isFalse(exp: Expression): boolean {
  return exp instanceof Expression.Literal && !exp.value;
}

// An espresso satisfiability check, memoized by the filter pair. Filters are
// immutable, and a region's filter object survives its state transitions
// (stale/fresh copies share it), so a footprint's relationship to a query
// filter is computed once — not once per region mutation. The WeakMaps let
// entries die with either filter.
const intersectsMemo = new WeakMap<Expression, WeakMap<Expression, boolean>>();
function intersects(a: Expression, b: Expression): boolean {
  let byB = intersectsMemo.get(a);
  if (!byB) {
    byB = new WeakMap();
    intersectsMemo.set(a, byB);
  }
  let result = byB.get(b);
  if (result == null) {
    result = !covers(new Expression.Literal(false), Expression.and(a, b));
    byB.set(b, result);
  }
  return result;
}

function unionOf(filters: Expression[]): Expression {
  return filters.reduce(
    (acc, f) => Expression.or(acc, f),
    new Expression.Literal(false) as Expression,
  );
}

function matchesRow(
  filter: Expression,
  obj: unknown,
  timestamp: number,
): boolean {
  const result = evaluate(filter, timestamp, obj as Record<string, unknown>);
  return result instanceof Expression.Literal && !!result.value;
}

// =============================================================================
// Failure recovery
// =============================================================================
// Failed requests are retried indefinitely (every RETRY_DELAY ms): the store
// is the page's only path to the data, so giving up would strand the UI on
// stale data until a full reload. While requests are failing, a single
// persistent error notification (shared across stores and request kinds) is
// shown; the first successful response dismisses it. It deliberately covers
// any failure cause (server errors included, not just connectivity —
// api-client's health poll reports that one separately); the cause itself is
// logged to the console. Affected queries keep loading: true the whole
// time — honest, since the store is still trying.

const RETRY_DELAY = 10000;
let retryTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
const pendingRetries = new Set<() => void>();
let errorNotification: notifications.Notification | null = null;

function flushRetries(): void {
  if (retryTimer != null) {
    globalThis.clearTimeout(retryTimer);
    retryTimer = null;
  }
  const retries = [...pendingRetries];
  pendingRetries.clear();
  for (const fn of retries) fn();
}

function reportFailure(retry: () => void): void {
  if (!errorNotification) {
    // An actions object (even an empty one) makes the notification persist
    // until explicitly dismissed — by the next successful request.
    errorNotification = notifications.push(
      "error",
      "Error fetching data — retrying...",
      {},
    );
  }
  pendingRetries.add(retry);
  if (retryTimer == null)
    retryTimer = globalThis.setTimeout(flushRetries, RETRY_DELAY);
}

function reportSuccess(): void {
  if (errorNotification) {
    notifications.dismiss(errorNotification);
    errorNotification = null;
  }
}

// Cancel scheduled retries and clear the error notification. Exported for
// tests (zombie retries from a failure test must not fire into the next
// test's request log); harmless elsewhere — the next failure re-arms.
export function resetRetryState(): void {
  if (retryTimer != null) {
    globalThis.clearTimeout(retryTimer);
    retryTimer = null;
  }
  pendingRetries.clear();
  if (errorNotification) {
    notifications.dismiss(errorNotification);
    errorNotification = null;
  }
}

// equals comparator for the read-graph computeds: same length and
// element-wise identical references. Exact because regions are immutable and
// rows are moved-not-copied, so an unchanged element keeps its reference.
function sameRefs<T>(prev: readonly T[], next: readonly T[]): boolean {
  if (prev.length !== next.length) return false;
  for (let i = 0; i < prev.length; i++)
    if (!Object.is(prev[i], next[i])) return false;
  return true;
}

// An active demand: a live query the settle pass keeps covered, plus its
// pure read graph (overlap → data) over the regions signal.
interface FetchQueryEntry {
  weakRef: globalThis.WeakRef<QuerySignal<unknown[]>>;
  filter: Expression;
  // Effective demanded freshness. Raised when fetch() re-demands fresher
  // data; lowered to the request's issue time when the settle pass fires the
  // request that will satisfy it (a future-dated freshness means "refetch
  // now", and that refetch's land is the freshest possible answer).
  freshness: number;
  // Parked between a failed request and its backed-off retry: the settle
  // pass skips parked demands, so a footprint that keeps failing neither
  // tight-loops nor starves overlapping demands whose own requests would
  // succeed (they dedup against its pending otherwise). The retry thunk and
  // invalidate() un-park; the query stays loading throughout.
  backedOff: boolean;
  overlap: ComputedSignal<Region[]>;
  data: ComputedSignal<unknown[]>;
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
  // The store of truth: an immutable array of disjoint regions. Every
  // change writes a brand-new array reference (and new region objects for
  // the regions that changed).
  private regionsSignal: StateSignal<Region[]>;
  // Counts and bookmarks are parallel lightweight caches (per-query-keyed),
  // not region projections.
  private counts: Map<string, CachedCount>;
  private bookmarks: Map<string, CachedBookmark>;
  private fetchQueries: Map<string, FetchQueryEntry>;
  private countQueries: Map<string, CountQueryEntry>;
  private bookmarkQueries: Map<string, BookmarkQueryEntry>;
  private registry: globalThis.FinalizationRegistry<{
    type: string;
    key: string;
  }>;

  constructor(private resourceType: string) {
    this.regionsSignal = new StateSignal<Region[]>([]);
    this.counts = new Map();
    this.bookmarks = new Map();
    this.fetchQueries = new Map();
    this.countQueries = new Map();
    this.bookmarkQueries = new Map();

    this.registry = new globalThis.FinalizationRegistry(({ type, key }) => {
      this.onQueryDisposed(type, key);
    });
  }

  // Read the regions without registering a dependency. Everything outside
  // the per-query read-graph computeds (the settle pass, display helpers,
  // count/bookmark anchoring) must use this: those paths can run inside a
  // consumer's computation, and entangling the consumer with the regions
  // signal would redraw it on every region change.
  private peekRegions(): Region[] {
    return untracked(() => this.regionsSignal.get());
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
          untracked(() => {
            existingEntry.freshness = Math.max(
              existingEntry.freshness,
              freshness,
            );
            this.settle([existingEntry]);
            this.refreshFetchQueries();
          });
        }
        return existing;
      }
      // WeakRef is dead — clean up before re-creating the demand
      this.disposeFetchEntry(key, existingEntry);
    }

    // Sweep dead entries so pruneCache drops regions that served only dead
    // queries; the new demand then refetches instead of settling on them.
    this.sweepAndPrune();

    const signal = new QuerySignal<unknown[]>([]);
    signal._setOnDispose(() => this.onQueryDisposed("fetch", key));

    untracked(() => {
      const entry = this.createFetchEntry(signal, filter, sort, freshness);
      this.fetchQueries.set(key, entry);
      this.registry.register(signal, { type: "fetch", key });
      this.settle([entry]);
      this.refreshFetchQueries();
    });

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

    const cached = this.counts.get(filterStr);
    if (cached && !cached.stale && cached.timestamp >= freshness) {
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

    const cached = this.bookmarks.get(key);
    if (cached && !cached.stale && cached.timestamp >= freshness) {
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

  // ---------------------------------------------------------------------------
  // The per-query read graph: pure projections over the regions signal,
  // stabilized by `equals` so untouched queries stay silent.
  // ---------------------------------------------------------------------------

  private createFetchEntry(
    signal: QuerySignal<unknown[]>,
    filter: Expression,
    sort: Record<string, number>,
    freshness: number,
  ): FetchQueryEntry {
    // Layer 1 — which regions does this query touch? `equals` keeps the
    // prior array when the overlapping set is unchanged, gating Layer 2.
    // intersects is memoized on the filter pair, so a recompute after a
    // mutation only pays espresso for footprints minted by that mutation.
    const overlap = new ComputedSignal<Region[]>(
      () =>
        this.regionsSignal.get().filter((r) => intersects(r.filter, filter)),
      { equals: sameRefs },
    );
    // Layer 2 — the matching rows, sorted. When a carve renarrows a region
    // but this query's rows are untouched, `equals` keeps the prior array and
    // the consumer never recomputes.
    const compare = compareFunction(sort);
    const data = new ComputedSignal<unknown[]>(
      () => {
        const rows: unknown[] = [];
        const now = SkewedDate.now();
        for (const region of overlap.get()) {
          for (const obj of region.objects)
            if (matchesRow(filter, obj, now)) rows.push(obj);
        }
        return rows.sort(compare);
      },
      { equals: sameRefs },
    );

    return {
      weakRef: new globalThis.WeakRef(signal),
      filter,
      freshness,
      backedOff: false,
      overlap,
      data,
    };
  }

  // Recompute every live query's state from the region store and push it
  // into its QuerySignal (which gates notification on actual change). Runs
  // after every region mutation — this is passive propagation: landing a
  // region heals every overlapping query, whoever initiated the fetch.
  private refreshFetchQueries(): void {
    untracked(() => {
      for (const entry of this.fetchQueries.values()) {
        const signal = entry.weakRef.deref();
        if (!signal || signal._disposed) continue; // swept elsewhere
        const regions = entry.overlap.get();
        const value = entry.data.get();
        // loading — keyed off the servable predicate, NOT bare state: a
        // fresh-state region stamped before this demand's freshness is about
        // to be carved and refetched, so it must already read as loading.
        // Failed footprints stay stale until a retry lands, so a failing
        // query honestly keeps loading: true.
        const loading = regions.some((r) => !servable(r, entry.freshness));
        const timestamp = regions.length
          ? Math.min(...regions.map((r) => r.timestamp))
          : 0;
        signal._update(value, timestamp, loading);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // The settle pass: the single effect driver.
  // ---------------------------------------------------------------------------

  // For each demand, compute the gap (demand − servable − fresh-enough
  // pending), carve a pending region over it, then coalesce the
  // carved footprints into one network request. Demands are processed
  // sequentially, so each later demand sees the pendings the earlier ones
  // carved — that sequencing IS the in-flight deduplication.
  //
  // Self-terminating: after carving, a demand's gap is covered by pending
  // regions, so the next settle finds an empty gap and writes nothing.
  private settle(entriesArg?: FetchQueryEntry[]): void {
    untracked(() => {
      const entries = entriesArg ?? [...this.fetchQueries.values()];
      let regions = this.peekRegions();
      const issuedAt = Date.now();
      const req: RegionRequest = { issuedAt, entries: [] };
      const gaps: Expression[] = [];
      let carvedAny = false;

      for (const entry of entries) {
        const signal = entry.weakRef.deref();
        if (!signal || signal._disposed) continue;
        if (entry.backedOff) continue;

        let gap: Expression = entry.filter;
        for (const region of regions) {
          if (isFalse(gap)) break;
          // The gap only ever shrinks from entry.filter, so a region
          // disjoint from the filter cannot reduce it — the memoized
          // intersects skips the espresso subtract for such regions.
          if (!intersects(region.filter, entry.filter)) continue;
          if (countsTowardCoverage(region, entry.freshness))
            gap = subtract(region.filter, gap); // subtract(x, y) = y − x
        }
        if (isFalse(gap)) continue;

        regions = this.carve(regions, gap, issuedAt, req);
        gaps.push(gap);
        req.entries.push(entry);
        carvedAny = true;
        // The request satisfying this gap is being issued now; its land is
        // the freshest answer a future-dated demand can get, so the demand
        // decays to "fresh as of the issue time" — without this, a demand
        // for future freshness would refetch forever.
        entry.freshness = Math.min(entry.freshness, issuedAt);
      }

      if (!carvedAny) return;
      this.regionsSignal.set(regions);
      void this.runRequest(req, unionOf(gaps));
    });
  }

  // Carve-on-touch, the only place regions split. The gap footprint
  // becomes a new pending region adopting the touched rows as provisional
  // display (stale-while-revalidate); each touched region is replaced by its
  // remainder, keeping its own state, timestamp and rows — so refetch
  // granularity matches the demand footprint, never the whole region.
  private carve(
    regions: Region[],
    gap: Expression,
    issuedAt: number,
    owner: RegionRequest,
  ): Region[] {
    const kept: Region[] = [];
    const adopted: unknown[] = [];
    let provisionalTimestamp = Infinity;
    const now = SkewedDate.now();

    for (const region of regions) {
      if (!intersects(region.filter, gap)) {
        kept.push(region);
        continue;
      }
      provisionalTimestamp = Math.min(provisionalTimestamp, region.timestamp);
      const remainderFilter = subtract(gap, region.filter); // region − gap
      const remainderObjects: unknown[] = [];
      for (const obj of region.objects) {
        if (matchesRow(gap, obj, now)) adopted.push(obj);
        else remainderObjects.push(obj);
      }
      if (!isFalse(remainderFilter)) {
        // The remainder of a pending region keeps its owner: its in-flight
        // request still covers (and will land into) that footprint.
        kept.push({
          ...region,
          filter: remainderFilter,
          objects: remainderObjects,
        });
      }
    }

    kept.push({
      filter: gap,
      state: "pending",
      timestamp: Number.isFinite(provisionalTimestamp)
        ? provisionalTimestamp
        : 0,
      issuedAt,
      objects: adopted,
      owner,
    });
    return kept;
  }

  // Issue the (single, coalesced) request for a settle pass.
  private async runRequest(
    req: RegionRequest,
    filter: Expression,
  ): Promise<void> {
    try {
      const res = (await request(`/api/${this.resourceType}/`, {
        params: { filter: filter.toString() },
      }).then((r) => r.json())) as unknown[];
      reportSuccess();
      this.land(req, res);
    } catch (err) {
      console.error(`Error fetching ${this.resourceType}:`, err);
      this.handleFailure(req);
    }
  }

  // Land: replace each region this request still owns with a fresh
  // region whose objects are the response rows in its footprint, wholesale.
  // Disjointness makes the landing region the sole authority over its
  // footprint, so rows the server didn't return simply disappear — deletion
  // reconciliation is free. Regions the request no longer owns (carved away
  // or invalidated while in flight) are left alone; that part of the
  // response is discarded.
  private land(req: RegionRequest, rows: unknown[]): void {
    untracked(() => {
      const now = SkewedDate.now();
      let changed = false;
      const next = this.peekRegions().map((region): Region => {
        if (region.owner !== req) return region;
        const objects: unknown[] = [];
        for (const row of rows)
          if (matchesRow(region.filter, row, now)) objects.push(row);
        changed = true;
        return {
          filter: region.filter,
          state: "fresh",
          // The response reflects server state no earlier than the issue
          // time, so stamp that: a demand fresher than the issue must not
          // settle on this data.
          timestamp: req.issuedAt,
          issuedAt: req.issuedAt,
          objects,
          owner: null,
        };
      });
      if (!changed) return;
      this.regionsSignal.set(next);
      this.refreshFetchQueries();
    });
  }

  // The request failed. Revert its pending regions to stale (keeping the
  // provisional rows on display), park the demands it served, and settle the
  // rest immediately: a demand that was deduplicating against the failed
  // footprint re-carves its own request right away, which may well succeed.
  // The parked demands stay loading and are retried with backoff.
  private handleFailure(req: RegionRequest): void {
    untracked(() => {
      let changed = false;
      const next = this.peekRegions().map((region): Region => {
        if (region.owner !== req) return region;
        changed = true;
        return { ...region, state: "stale", owner: null };
      });
      if (changed) this.regionsSignal.set(next);
      for (const entry of req.entries) entry.backedOff = true;
      this.settle();
      this.refreshFetchQueries();
      reportFailure(() =>
        untracked(() => {
          for (const entry of req.entries) entry.backedOff = false;
          this.settle();
          this.refreshFetchQueries();
        }),
      );
    });
  }

  // ---------------------------------------------------------------------------
  // Display helpers (stale-while-revalidate paths — deliberately NOT keyed
  // off servability; provably-positioned stale rows stay visible).
  // ---------------------------------------------------------------------------

  private findMatchingObjects(
    filter: Expression,
    sort: Record<string, number>,
  ): unknown[] {
    const now = SkewedDate.now();
    const matches: unknown[] = [];
    for (const region of this.peekRegions()) {
      for (const obj of region.objects)
        if (matchesRow(filter, obj, now)) matches.push(obj);
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
    const covered = this.peekRegions().filter((r) => r.timestamp >= freshness);
    if (covered.length === 0) return [];
    const combined = unionOf(covered.map((r) => r.filter));
    if (isFalse(combined)) return [];
    const [satisfied] = paginate(combined, filter, sort);
    if (isFalse(satisfied)) return [];
    return this.findMatchingObjects(satisfied, sort);
  }

  // ---------------------------------------------------------------------------
  // Counts and bookmarks (parallel mechanisms)
  // ---------------------------------------------------------------------------

  private triggerCountRefresh(
    filter: Expression,
    signal: QuerySignal<number>,
  ): void {
    const signalRef = new globalThis.WeakRef(signal);

    const doCount = async (): Promise<void> => {
      try {
        const s = signalRef.deref();
        if (!s || s._disposed) return;

        const filterStr = filter.toString();
        // The response reflects server state as of (no earlier than) the
        // request's issue time — stamp that, consistent with region lands.
        const issued = Date.now();
        const res = await request(`/api/${this.resourceType}/`, {
          method: "HEAD",
          params: { filter: filterStr },
        });
        reportSuccess();
        const countValue = +(res.headers.get("x-total-count") ?? 0);

        // Unlike region fetches, this guard must STAY: the count cache is
        // keyed per query and is only reachable for cleanup while a query-map
        // entry exists (sweepAndPrune/onQueryDisposed delete both together).
        // Writing after disposal would orphan an entry no path can reclaim.
        const s2 = signalRef.deref();
        if (!s2 || s2._disposed) return;

        this.counts.set(filterStr, {
          value: countValue,
          timestamp: issued,
          stale: false,
        });
        s2._update(countValue, issued, false);
      } catch (err) {
        console.error(`Error counting ${this.resourceType}:`, err);
        // Keep loading: true and retry with backoff (the disposal guard at
        // the top of doCount ends the loop once nobody is listening).
        reportFailure(() => void doCount());
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
      this.bookmarks.set(key, { data, timestamp, stale: false });
      s._update(data ? new Bookmark(data, sort) : null, timestamp, false);
    };

    const doBookmark = async (): Promise<void> => {
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
        //
        // Only servable regions anchor the count: stale and pending
        // coverage is exactly what an invalidation taints, so a bookmark
        // resolved after one never counts pre-invalidation rows.
        const freshRegions = this.peekRegions().filter((r) =>
          servable(r, freshness),
        );
        const combined = unionOf(freshRegions.map((r) => r.filter));
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
        reportSuccess();

        // Like count (and unlike region fetches), this guard must STAY: the
        // bookmark cache is per-query-keyed and only reclaimable while its
        // query-map entry lives, so a post-disposal settle() would orphan it.
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
        console.error(`Error creating bookmark for ${this.resourceType}:`, err);
        // Keep loading: true and retry with backoff (the disposal guard at
        // the top of doBookmark ends the loop once nobody is listening).
        reportFailure(() => void doBookmark());
      }
    };

    void doBookmark();
  }

  // ---------------------------------------------------------------------------
  // Invalidation
  // ---------------------------------------------------------------------------

  invalidate(timestamp: number): void {
    // Invalidate data fetched strictly before the given timestamp. The
    // timestamp is exclusive: data fetched at exactly the given timestamp is
    // considered fresh.
    //
    // For regions this is the entire operation: replace every region whose
    // data (or in-flight request) predates the invalidation with a stale
    // copy. The read graph notices the new references, the settle pass
    // refetches whatever is still demanded, and queries heal on land. A
    // superseded pending region drops its owner link, so the in-flight
    // response is discarded for that footprint when it lands. No staleness
    // floor, no in-flight ledger.
    untracked(() => {
      let changed = false;
      const next = this.peekRegions().map((region): Region => {
        const reference =
          region.state === "pending" ? region.issuedAt : region.timestamp;
        if (region.state !== "stale" && reference < timestamp) {
          changed = true;
          return { ...region, state: "stale", owner: null };
        }
        return region;
      });
      if (changed) this.regionsSignal.set(next);
      // An invalidation demands current truth now — bypass any retry backoff
      for (const entry of this.fetchQueries.values()) entry.backedOff = false;
      this.settle();
      this.refreshFetchQueries();
    });

    // Counts and bookmarks: mark pre-invalidation cache entries stale so a
    // newborn query shows them only as stale-while-revalidate, and re-trigger
    // live signals (skipping ones already refreshing).
    for (const [key, cached] of this.counts) {
      if (cached.timestamp < timestamp && !cached.stale)
        this.counts.set(key, { ...cached, stale: true });
    }
    for (const [key, cached] of this.bookmarks) {
      if (cached.timestamp < timestamp && !cached.stale)
        this.bookmarks.set(key, { ...cached, stale: true });
    }

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
    // The settle above carves staled regions down to the live demands'
    // footprints, and a carve can orphan the remainder (the carving demand
    // no longer intersects it). sweepAndPrune only prunes when it swept a
    // dead entry, so prune explicitly — otherwise the orphan lingers until
    // some unrelated prune (often GC-timed, via the FinalizationRegistry)
    // drops it, making post-navigation display nondeterministic.
    this.pruneCache();
  }

  // ---------------------------------------------------------------------------
  // Lifecycle / eviction
  // ---------------------------------------------------------------------------

  private disposeFetchEntry(key: string, entry: FetchQueryEntry): void {
    this.fetchQueries.delete(key);
    entry.data[Symbol.dispose]();
    entry.overlap[Symbol.dispose]();
  }

  private sweepAndPrune(): void {
    let swept = false;
    for (const [key, entry] of this.fetchQueries) {
      if (!entry.weakRef.deref()) {
        this.disposeFetchEntry(key, entry);
        swept = true;
      }
    }
    for (const [key, entry] of this.countQueries) {
      if (!entry.weakRef.deref()) {
        this.countQueries.delete(key);
        this.counts.delete(key);
      }
    }
    for (const [key, entry] of this.bookmarkQueries) {
      if (!entry.weakRef.deref()) {
        this.bookmarkQueries.delete(key);
        this.bookmarks.delete(key);
      }
    }
    if (swept) this.pruneCache();
  }

  private onQueryDisposed(type: string, key: string): void {
    if (type === "fetch") {
      const entry = this.fetchQueries.get(key);
      if (entry) this.disposeFetchEntry(key, entry);
      this.pruneCache();
    } else if (type === "count") {
      this.countQueries.delete(key);
      this.counts.delete(key);
    } else if (type === "bookmark") {
      this.bookmarkQueries.delete(key);
      this.bookmarks.delete(key);
      // Bookmark queries pin regions too — losing one can orphan.
      this.pruneCache();
    }
  }

  // Eviction policy: regions outlive queries (a landed response is retained
  // for the benefit of every query, including later ones), but a region no
  // live demand overlaps is dropped. Whole-region pinning by overlap is what
  // gives cache reuse across immediate navigations (list → detail → back:
  // the detail query pins the list's region), and dropping at orphan time
  // bounds the cache by the live pin set — a store whose last query dies is
  // flushed entirely. A pending region pruned mid-flight makes its land a
  // no-op — nobody needs the response.
  //
  // Live bookmark queries pin too: an unresolved bookmark anchors its probe
  // on cached regions, and pagedFetch displays the covered prefix while it
  // resolves — a window in which the page's data fetch query doesn't exist
  // yet. A prune landing in that window (the outgoing page's disposals race
  // against the probe's round trip) must not flush the rows on display.
  private pruneCache(): void {
    untracked(() => {
      const live: Expression[] = [];
      for (const [key, entry] of this.fetchQueries) {
        const signal = entry.weakRef.deref();
        if (!signal || signal._disposed) {
          this.disposeFetchEntry(key, entry);
          continue;
        }
        live.push(entry.filter);
      }
      for (const entry of this.bookmarkQueries.values()) {
        const signal = entry.weakRef.deref();
        if (signal && !signal._disposed) live.push(entry.filter);
      }

      const regions = this.peekRegions();
      if (regions.length === 0) return;

      // A region intersects the union of the live filters iff it intersects
      // at least one of them — per-pair checks hit the intersects memo the
      // read graph has usually already populated.
      const kept = regions.filter((r) =>
        live.some((f) => intersects(r.filter, f)),
      );
      if (kept.length !== regions.length) this.regionsSignal.set(kept);
    });
  }
}

const stores: Map<string, ResourceStore> = new Map();

function getStore(resource: string): ResourceStore {
  let store = stores.get(resource);
  if (!store) {
    // untracked: creating store-lifetime signals inside a consumer's
    // computation must not tie their disposal to that computation.
    store = untracked(() => new ResourceStore(resource));
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
  // Rows shown under a bookmark must be at least as fresh as the bookmark:
  // bm.timestamp is the freshness of the bookmark's inputs, so floor the data
  // fetch by it. Otherwise a freshly re-probed bookmark (timestamp ~ now)
  // could pair with rows settled from stale pre-invalidation coverage.
  const q = fetch(resource, effective, {
    sort,
    freshness: Math.max(freshness ?? 0, bm.timestamp),
  }).get();
  return { value: q.value.slice(0, limit), loading: q.loading || bm.loading };
}

export function invalidate(timestamp: number): void {
  for (const store of stores.values()) {
    store.invalidate(timestamp);
  }
}
