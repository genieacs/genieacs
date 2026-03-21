// Reactive signals system based on the TC39 Signals proposal.
// https://github.com/tc39/proposal-signals

export const enum ComputedState {
  Clean,
  Computing,
  Checking,
  Dirty,
}

// Creates a Proxy that hides underscore-prefixed properties
function createSafeProxy<T extends object>(target: T): T {
  return new Proxy(target, {
    get(obj, prop) {
      if (typeof prop === "string" && prop.startsWith("_")) {
        return undefined;
      }
      const value = Reflect.get(obj, prop, obj);
      if (typeof value === "function") {
        return value.bind(obj);
      }
      return value;
    },
    set(obj, prop, value) {
      if (typeof prop === "string" && prop.startsWith("_")) {
        return false;
      }
      return Reflect.set(obj, prop, value, obj);
    },
    ownKeys(obj) {
      return Reflect.ownKeys(obj).filter(
        (key) => typeof key !== "string" || !key.startsWith("_"),
      );
    },
    getOwnPropertyDescriptor(obj, prop) {
      if (typeof prop === "string" && prop.startsWith("_")) {
        return undefined;
      }
      return Reflect.getOwnPropertyDescriptor(obj, prop);
    },
  });
}

// Tracks the currently computing signal for automatic dependency registration
let computing: ComputedSignal<unknown> | null = null;

export function registerDependency(source: SignalBase<unknown>): void {
  if (computing !== null) {
    source._sinks.add(computing._selfRef);
    computing._sources.add(source);
  }
}

function registerCleanup(cleanup: () => void): void {
  if (computing !== null) {
    computing._cleanups.add(cleanup);
  }
}

function runCleanups(signal: ComputedSignal<unknown>): void {
  for (const cleanup of signal._cleanups) {
    cleanup();
  }
  signal._cleanups.clear();
}

// Type for sinks: can be ComputedSignal or Watcher.
type Sink = ComputedSignal<unknown> | Watcher;

function markSinksChecking(sinks: Set<WeakRef<Sink>>): void {
  for (const weakRef of sinks) {
    const sink = weakRef.deref();
    if (sink === undefined) {
      sinks.delete(weakRef);
      continue;
    }

    // eslint-disable-next-line @typescript-eslint/no-use-before-define
    if (sink instanceof Watcher) {
      sink._notify();
      continue;
    }

    // Only promote Clean to Checking (Dirty/Checking stay as-is)
    if (sink._state === ComputedState.Clean) {
      sink._state = ComputedState.Checking;
      markSinksChecking(sink._sinks);
    }
  }
}

function markSinksDirty(sinks: Set<WeakRef<Sink>>): void {
  for (const weakRef of sinks) {
    const sink = weakRef.deref();
    if (sink === undefined) {
      sinks.delete(weakRef);
      continue;
    }

    // eslint-disable-next-line @typescript-eslint/no-use-before-define
    if (sink instanceof Watcher) {
      sink._notify();
      continue;
    }

    // Promote Clean or Checking to Dirty
    if (
      sink._state === ComputedState.Clean ||
      sink._state === ComputedState.Checking
    ) {
      runCleanups(sink);
      sink._state = ComputedState.Dirty;
      markSinksChecking(sink._sinks); // Indirect dependents become Checking
    }
  }
}

export abstract class SignalBase<T = unknown> implements Disposable {
  declare _sinks: Set<WeakRef<Sink>>;
  _disposed: boolean = false;

  abstract get(): T;
  abstract [Symbol.dispose](): void;
}

export class ConstSignal<T> extends SignalBase<T> {
  private _value: T;

  constructor(value: T) {
    super();
    this._value = value;

    // Register disposal if created inside a computation
    if (computing !== null) {
      registerCleanup(() => this[Symbol.dispose]());
    }
  }

  get(): T {
    if (this._disposed) throw new Error("Cannot read disposed signal");
    return this._value;
  }

  [Symbol.dispose](): void {
    if (this._disposed) return;
    this._disposed = true;
    this._value = undefined as T;
  }
}

export class StateSignal<T> extends SignalBase<T> {
  private _value: T;

  constructor(initialValue: T) {
    super();
    this._sinks = new Set();
    this._value = initialValue;

    // Register disposal if created inside a computation
    if (computing !== null) {
      registerCleanup(() => this[Symbol.dispose]());
    }
  }

  get(): T {
    if (this._disposed) throw new Error("Cannot read disposed signal");
    registerDependency(this);
    return this._value;
  }

  set(newValue: T): void {
    if (this._disposed) throw new Error("Cannot write to disposed signal");
    if (Object.is(this._value, newValue)) return;
    this._value = newValue;
    markSinksDirty(this._sinks);
  }

  [Symbol.dispose](): void {
    if (this._disposed) return;
    this._disposed = true;
    this._value = undefined as T;
    this._sinks.clear();
  }
}

export class ComputedSignal<T> extends SignalBase<T> {
  private _callback: () => T;
  private _value: T | undefined;
  private _error: unknown;
  private _hasError: boolean = false;

  _state: ComputedState = ComputedState.Dirty;
  _sources: Set<SignalBase<unknown>> = new Set();
  _cleanups: Set<() => void> = new Set();

  // Single WeakRef reused when registering with sources for memory efficiency
  readonly _selfRef: WeakRef<ComputedSignal<unknown>>;

  constructor(callback: () => T) {
    super();
    this._sinks = new Set();
    this._callback = callback;
    this._selfRef = new WeakRef(this as ComputedSignal<unknown>);

    // Register disposal if created inside a computation
    if (computing !== null) {
      registerCleanup(() => this[Symbol.dispose]());
    }
  }

  get(): T {
    if (this._disposed) throw new Error("Cannot read disposed signal");
    registerDependency(this);

    if (this._state === ComputedState.Computing) {
      throw new Error("Circular dependency detected");
    }

    if (!this._isValid()) return this._recompute();

    if (this._hasError) throw this._error;
    return this._value as T;
  }

  _isValid(): boolean {
    if (this._state === ComputedState.Clean) return true;
    if (this._state !== ComputedState.Checking) return false;
    // Checking: verify if sources have changed
    for (const source of this._sources) {
      if (source instanceof ComputedSignal) {
        source.get(); // Triggers recomputation if source is Dirty/Checking
        // If source's value changed, it would have marked us Dirty
        if ((this._state as ComputedState) === ComputedState.Dirty)
          return false;
      }
    }
    // All sources unchanged, we're clean
    this._state = ComputedState.Clean;
    return true;
  }

  private _recompute(): T {
    // Clear old dependencies
    for (const source of this._sources) {
      source._sinks.delete(this._selfRef);
    }
    this._sources.clear();

    const prevComputing = computing;
    computing = this as ComputedSignal<unknown>;
    this._state = ComputedState.Computing;

    try {
      const oldValue = this._value;
      const hadError = this._hasError;
      this._value = this._callback();
      this._hasError = false;
      this._state = ComputedState.Clean;
      // If value changed, mark sinks dirty (for Checking optimization)
      if (hadError || !Object.is(oldValue, this._value)) {
        markSinksDirty(this._sinks);
      }
      return this._value;
    } catch (e) {
      const oldError = this._error;
      const hadError = this._hasError;
      this._error = e;
      this._hasError = true;
      this._state = ComputedState.Clean;
      // If error changed, mark sinks dirty
      if (!hadError || !Object.is(oldError, e)) {
        markSinksDirty(this._sinks);
      }
      throw e;
    } finally {
      computing = prevComputing;
    }
  }

  [Symbol.dispose](): void {
    if (this._disposed) return;
    this._disposed = true;

    // Run all registered cleanups (clears timeouts/intervals and disposes
    // nested signals)
    runCleanups(this as ComputedSignal<unknown>);

    // Detach from sources
    for (const source of this._sources) {
      source._sinks?.delete(this._selfRef);
    }
    this._sources.clear();

    // Clear sinks
    this._sinks.clear();

    // Release references for GC
    this._value = undefined;
    this._error = undefined;
  }
}

// Observes signal changes from outside the reactive graph.
// Based on the TC39 Signals proposal's Signal.subtle.Watcher.
// The notify callback fires synchronously and should be lightweight
// (e.g., just schedule a redraw).
export class Watcher implements Disposable {
  private _callback: () => void;
  private _notified: boolean = false;
  private _disposed: boolean = false;
  private _watching: Set<SignalBase<unknown>> = new Set();
  readonly _selfRef: WeakRef<Watcher>;

  constructor(notify: () => void) {
    this._callback = notify;
    this._selfRef = new WeakRef(this);
  }

  // Also resets the notified flag, allowing the callback to fire again.
  watch(...signals: SignalBase<unknown>[]): void {
    for (const signal of signals) {
      if (!signal._sinks) continue; // ConstSignal has no sinks
      signal._sinks.add(this._selfRef);
      this._watching.add(signal);
    }
    this._notified = false;
  }

  unwatch(...signals: SignalBase<unknown>[]): void {
    for (const signal of signals) {
      if (!signal._sinks) continue;
      signal._sinks.delete(this._selfRef);
      this._watching.delete(signal);
    }
  }

  // Only ComputedSignals can be dirty/checking; StateSignals are always current.
  getPending(): SignalBase<unknown>[] {
    const pending: SignalBase<unknown>[] = [];
    for (const signal of this._watching) {
      if (signal instanceof ComputedSignal) {
        if (signal._state !== ComputedState.Clean) {
          pending.push(signal);
        }
      }
    }
    return pending;
  }

  _notify(): void {
    if (this._disposed || this._notified) return;
    this._notified = true;
    this._callback();
  }

  [Symbol.dispose](): void {
    if (this._disposed) return;
    this._disposed = true;
    for (const signal of this._watching) {
      signal._sinks?.delete(this._selfRef);
    }
    this._watching.clear();
  }
}

// Safe signal wrappers that hide internal properties via Proxy.
// Exposed to user scripts as Signal.State, Signal.Computed, and Signal.Const.
class SafeConstSignal<T> extends ConstSignal<T> {
  static [Symbol.hasInstance](instance: unknown): boolean {
    return instance instanceof ConstSignal;
  }

  constructor(value: T) {
    super(value);
    return createSafeProxy(this);
  }
}

class SafeStateSignal<T> extends StateSignal<T> {
  static [Symbol.hasInstance](instance: unknown): boolean {
    return instance instanceof StateSignal;
  }

  constructor(initialValue: T) {
    super(initialValue);
    return createSafeProxy(this);
  }
}

class SafeComputedSignal<T> extends ComputedSignal<T> {
  static [Symbol.hasInstance](instance: unknown): boolean {
    return instance instanceof ComputedSignal;
  }

  constructor(callback: () => T) {
    super(callback);
    return createSafeProxy(this);
  }
}

export const Signal = {
  Const: SafeConstSignal,
  State: SafeStateSignal,
  Computed: SafeComputedSignal,
  [Symbol.hasInstance](instance: unknown): boolean {
    return instance instanceof SignalBase;
  },
};

// setTimeout wrapper that skips the callback if the enclosing computed
// signal is no longer valid when the timeout fires. Outside a computed
// signal, behaves exactly like globalThis.setTimeout.
export function setTimeout<TArgs extends unknown[]>(
  callback: (...callbackArgs: TArgs) => void,
  delay?: number,
  ...args: TArgs
): ReturnType<typeof globalThis.setTimeout> {
  const signal = computing;

  if (signal === null) {
    return globalThis.setTimeout(callback, delay, ...args);
  }

  const timeoutId = globalThis.setTimeout(
    (...callbackArgs: TArgs) => {
      if (signal._isValid()) {
        callback(...callbackArgs);
      }
    },
    delay,
    ...args,
  );
  registerCleanup(() => globalThis.clearTimeout(timeoutId));
  return timeoutId;
}

// setInterval wrapper that clears the interval when the enclosing computed
// signal becomes dirty or is recomputed. Outside a computed signal, behaves
// exactly like globalThis.setInterval.
export function setInterval<TArgs extends unknown[]>(
  callback: (...callbackArgs: TArgs) => void,
  delay?: number,
  ...args: TArgs
): ReturnType<typeof globalThis.setInterval> {
  const signal = computing;

  if (signal === null) {
    return globalThis.setInterval(callback, delay, ...args);
  }

  const intervalId = globalThis.setInterval(
    (...callbackArgs: TArgs) => {
      if (signal._isValid()) {
        callback(...callbackArgs);
      } else {
        globalThis.clearInterval(intervalId);
      }
    },
    delay,
    ...args,
  );
  registerCleanup(() => globalThis.clearInterval(intervalId));
  return intervalId;
}
