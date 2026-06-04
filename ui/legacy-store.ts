// Legacy store shim — wraps reactive-store to provide the old synchronous
// QueryResponse-based API used by legacy components
// New code should import from reactive-store.ts directly.

import {
  fetch as reactiveFetch,
  count as reactiveCount,
  QuerySignal,
} from "./reactive-store.ts";
import { Watcher } from "./signals.ts";
import { redraw, registerRenderCleanup } from "./mithril-compat.ts";
import Expression from "../lib/common/expression.ts";

// Legacy components read query values inside mithril component views (e.g.
// device-faults), which run during mithril's render cycle — outside any
// reactive tracker — so the read does NOT register a dependency that could
// drive redraws or release the signal. We attach a redraw-watcher per query
// signal to make those queries redraw on change, and tie its lifetime to the
// rendering mount point (via registerRenderCleanup) so it is disposed when the
// host unmounts. Disposing it removes the signal's only sink, letting the
// reactive store dispose the query — instead of it lingering until GC and being
// refetched on every navigation.
//
// When fetch() is called OUTSIDE a render (e.g. a createMithrilHost renderFn
// that reads the query reactively, like device-page's deviceQuery), there is no
// mount point to own the watcher — and the reactive tracker already drives
// redraws and disposal — so we skip arming entirely.
const armed = new WeakMap<QuerySignal<unknown>, Watcher>();
function armForRedraw(signal: QuerySignal<unknown>): void {
  if (armed.has(signal)) return;
  const w = new Watcher(() => {
    w.watch(signal); // re-arm for the next update
    redraw();
  });
  const owned = registerRenderCleanup(() => {
    w[Symbol.dispose]();
    armed.delete(signal);
  });
  if (!owned) return; // not inside a render — reactive consumer, no watcher needed
  w.watch(signal);
  armed.set(signal, w);
}

let fulfillTimestamp = 0;

export class QueryResponse {
  private _signal: QuerySignal<unknown>;
  private _minTimestamp: number;

  constructor(signal: QuerySignal<unknown>, minTimestamp: number) {
    this._signal = signal;
    this._minTimestamp = minTimestamp;
  }

  public get fulfilled(): number {
    const state = this._signal.get();
    if (state.timestamp < this._minTimestamp) return 0;
    return state.timestamp;
  }

  public get fulfilling(): boolean {
    const state = this._signal.get();
    return state.loading || state.timestamp < this._minTimestamp;
  }

  public get value(): unknown {
    const state = this._signal.get();
    return state.value;
  }
}

// Legacy fetch — returns a QueryResponse wrapping the reactive QuerySignal.
// The freshness parameter ensures the reactive store triggers a re-fetch
// when the signal's data predates fulfillTimestamp.
export function fetch(
  resourceType: string,
  filter: Expression,
  options: { limit?: number; sort?: { [param: string]: number } } = {},
): QueryResponse {
  const sort = Object.assign({}, options.sort);
  const signal = reactiveFetch(resourceType, filter, {
    sort,
    freshness: fulfillTimestamp,
  });
  armForRedraw(signal);
  return new QueryResponse(signal, fulfillTimestamp);
}

// Legacy count — returns a QueryResponse wrapping the reactive QuerySignal.
export function count(resourceType: string, filter: Expression): QueryResponse {
  const signal = reactiveCount(resourceType, filter, {
    freshness: fulfillTimestamp,
  });
  armForRedraw(signal);
  return new QueryResponse(signal, fulfillTimestamp);
}

export function getTimestamp(): number {
  return fulfillTimestamp;
}

export function setTimestamp(t: number): void {
  if (t > fulfillTimestamp) {
    fulfillTimestamp = t;
  }
}
