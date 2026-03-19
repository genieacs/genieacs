import test from "node:test";
import assert from "node:assert";
import {
  ConstSignal,
  SignalBase,
  StateSignal,
  ComputedSignal,
  setTimeout,
  setInterval,
} from "../ui/signals.ts";

// =============================================================================
// ConstSignal Tests
// =============================================================================

void test("ConstSignal returns constant value", () => {
  const signal = new ConstSignal(42);
  assert.strictEqual(signal.get(), 42);
  assert.strictEqual(signal.get(), 42);

  // Works with different types
  const strSignal = new ConstSignal("hello");
  assert.strictEqual(strSignal.get(), "hello");

  const objSignal = new ConstSignal({ a: 1 });
  assert.strictEqual(objSignal.get().a, 1);
  assert.strictEqual(objSignal.get(), objSignal.get()); // Same reference
});

void test("ConstSignal extends SignalBase but doesn't allocate _sinks", () => {
  const constant = new ConstSignal(42);

  // ConstSignal extends SignalBase for proper type hierarchy
  assert.strictEqual(constant instanceof SignalBase, true);

  // But doesn't allocate _sinks (optimization)
  assert.strictEqual((constant as any)._sinks, undefined);
});

// =============================================================================
// StateSignal Tests
// =============================================================================

void test("StateSignal get and set", () => {
  const signal = new StateSignal(42);
  assert.strictEqual(signal.get(), 42);

  signal.set(100);
  assert.strictEqual(signal.get(), 100);
});

void test("StateSignal.set() with same value (Object.is) doesn't trigger updates", () => {
  const signal = new StateSignal(1);
  let computeCount = 0;

  const computed = new ComputedSignal(() => {
    computeCount++;
    return signal.get() * 2;
  });

  assert.strictEqual(computed.get(), 2);
  assert.strictEqual(computeCount, 1);

  // Set to same value
  signal.set(1);
  assert.strictEqual(computed.get(), 2);
  assert.strictEqual(computeCount, 1);

  // Object.is(NaN, NaN) is true
  const nanSignal = new StateSignal(NaN);
  let nanComputeCount = 0;
  const nanComputed = new ComputedSignal(() => {
    nanComputeCount++;
    return nanSignal.get();
  });
  nanComputed.get();
  nanSignal.set(NaN);
  nanComputed.get();
  assert.strictEqual(nanComputeCount, 1);
});

void test("Can subclass StateSignal", () => {
  class Counter extends StateSignal<number> {
    increment(): void {
      this.set(this.get() + 1);
    }
  }

  const counter = new Counter(0);
  counter.increment();
  counter.increment();

  assert.strictEqual(counter.get(), 2);
});

// =============================================================================
// ComputedSignal Tests
// =============================================================================

void test("ComputedSignal is lazy and memoized", () => {
  let computeCount = 0;
  const computed = new ComputedSignal(() => {
    computeCount++;
    return 1 + 2;
  });

  // Lazy: callback not called until get()
  assert.strictEqual(computeCount, 0);

  // First get() computes
  assert.strictEqual(computed.get(), 3);
  assert.strictEqual(computeCount, 1);

  // Memoized: second get() returns cached value
  assert.strictEqual(computed.get(), 3);
  assert.strictEqual(computeCount, 1);
});

void test("ComputedSignal tracks dependencies", () => {
  // StateSignal dependencies
  const a = new StateSignal(1);
  const b = new StateSignal(2);
  const sum = new ComputedSignal(() => a.get() + b.get());

  assert.strictEqual(sum.get(), 3);
  a.set(10);
  assert.strictEqual(sum.get(), 12);
  b.set(20);
  assert.strictEqual(sum.get(), 30);

  // ComputedSignal dependencies (chained)
  const c = new StateSignal(2);
  const doubled = new ComputedSignal(() => c.get() * 2);
  const quadrupled = new ComputedSignal(() => doubled.get() * 2);

  assert.strictEqual(quadrupled.get(), 8);
  c.set(3);
  assert.strictEqual(quadrupled.get(), 12);
});

void test("Dependencies can change between evaluations", () => {
  const condition = new StateSignal(true);
  const a = new StateSignal(1);
  const b = new StateSignal(2);

  let computeCount = 0;
  const computed = new ComputedSignal(() => {
    computeCount++;
    return condition.get() ? a.get() : b.get();
  });

  assert.strictEqual(computed.get(), 1);
  assert.strictEqual(computeCount, 1);

  // Changing a should trigger recompute
  a.set(10);
  assert.strictEqual(computed.get(), 10);
  assert.strictEqual(computeCount, 2);

  // Changing b should NOT trigger recompute (not a dependency)
  b.set(20);
  assert.strictEqual(computed.get(), 10);
  assert.strictEqual(computeCount, 2);

  // Switch condition - now b is dependency, a is not
  condition.set(false);
  assert.strictEqual(computed.get(), 20);
  assert.strictEqual(computeCount, 3);

  // Now changing a should NOT trigger recompute
  a.set(100);
  assert.strictEqual(computed.get(), 20);
  assert.strictEqual(computeCount, 3);

  // But changing b should
  b.set(200);
  assert.strictEqual(computed.get(), 200);
  assert.strictEqual(computeCount, 4);
});

void test("Diamond dependency pattern (glitch-free with Checking optimization)", () => {
  //       A
  //      / \
  //     B   C
  //      \ /
  //       D
  const a = new StateSignal(1);

  let bCount = 0;
  const b = new ComputedSignal(() => {
    bCount++;
    // Returns 10 for positive, 0 for non-positive
    return a.get() > 0 ? 10 : 0;
  });

  let cCount = 0;
  const c = new ComputedSignal(() => {
    cCount++;
    // Returns 20 for positive, 0 for non-positive
    return a.get() > 0 ? 20 : 0;
  });

  let dCount = 0;
  const d = new ComputedSignal(() => {
    dCount++;
    return b.get() + c.get();
  });

  // Initial computation
  assert.strictEqual(d.get(), 30);
  assert.strictEqual(bCount, 1);
  assert.strictEqual(cCount, 1);
  assert.strictEqual(dCount, 1);

  // Change a, but b and c return same values - d should NOT recompute (Checking optimization)
  a.set(2);
  assert.strictEqual(d.get(), 30);
  assert.strictEqual(bCount, 2);
  assert.strictEqual(cCount, 2);
  assert.strictEqual(dCount, 1); // d NOT recomputed

  // Change a to negative - b and c return different values, d MUST recompute
  a.set(-1);
  assert.strictEqual(d.get(), 0);
  assert.strictEqual(bCount, 3);
  assert.strictEqual(cCount, 3);
  assert.strictEqual(dCount, 2);
});

void test("Deeply nested computeds", () => {
  const state = new StateSignal(1);

  // Create a chain of 100 computeds
  let current: StateSignal<number> | ComputedSignal<number> = state;
  for (let i = 0; i < 100; i++) {
    const prev = current;
    current = new ComputedSignal(() => prev.get() + 1);
  }

  assert.strictEqual(current.get(), 101);

  state.set(0);
  assert.strictEqual(current.get(), 100);
});

// =============================================================================
// Error Handling
// =============================================================================

void test("ComputedSignal caches and rethrows errors", () => {
  let computeCount = 0;

  const computed = new ComputedSignal(() => {
    computeCount++;
    throw new Error("test error");
  });

  // First call throws
  assert.throws(() => computed.get(), { message: "test error" });
  assert.strictEqual(computeCount, 1);

  // Second call throws cached error without recomputing
  assert.throws(() => computed.get(), { message: "test error" });
  assert.strictEqual(computeCount, 1);
});

void test("Error cache is cleared on dependency change", () => {
  const trigger = new StateSignal(0);
  let shouldThrow = true;
  let computeCount = 0;

  const computed = new ComputedSignal(() => {
    computeCount++;
    trigger.get();
    if (shouldThrow) throw new Error("test error");
    return 42;
  });

  // First call throws
  assert.throws(() => computed.get(), { message: "test error" });
  assert.strictEqual(computeCount, 1);

  // Change dependency and fix the error condition
  shouldThrow = false;
  trigger.set(1);

  // Now should succeed
  assert.strictEqual(computed.get(), 42);
  assert.strictEqual(computeCount, 2);
});

void test("Circular dependency throws error", () => {
  // Direct: a -> b -> a
  // eslint-disable-next-line prefer-const
  let aRef: ComputedSignal<number>;
  const b = new ComputedSignal(() => aRef.get() + 1);
  const a = new ComputedSignal(() => b.get() + 1);
  aRef = a;

  assert.throws(() => a.get(), { message: "Circular dependency detected" });

  // Self-reference
  // eslint-disable-next-line prefer-const
  let selfRef: ComputedSignal<number>;
  const self = new ComputedSignal(() => selfRef.get() + 1);
  selfRef = self;

  assert.throws(() => self.get(), { message: "Circular dependency detected" });
});

// =============================================================================
// setTimeout Tests
// =============================================================================

void test("setTimeout outside computed behaves like regular setTimeout", async () => {
  let called = false;
  setTimeout(() => {
    called = true;
  }, 10);

  assert.strictEqual(called, false);
  await new Promise((r) => globalThis.setTimeout(r, 50));
  assert.strictEqual(called, true);
});

void test("setTimeout inside computed fires when signal stays clean", async () => {
  const state = new StateSignal(1);
  let callCount = 0;

  const computed = new ComputedSignal(() => {
    state.get();
    setTimeout(() => {
      callCount++;
    }, 10);
    return "done";
  });

  computed.get();
  assert.strictEqual(callCount, 0);

  await new Promise((r) => globalThis.setTimeout(r, 50));
  assert.strictEqual(callCount, 1);
});

void test("setTimeout inside computed cancelled when signal becomes dirty", async () => {
  const state = new StateSignal(1);
  let callCount = 0;

  const computed = new ComputedSignal(() => {
    state.get();
    setTimeout(() => {
      callCount++;
    }, 50);
    return "done";
  });

  computed.get();

  // Make the signal dirty before timeout fires - callback skipped via _isValid
  state.set(2);

  await new Promise((r) => globalThis.setTimeout(r, 100));
  assert.strictEqual(callCount, 0);

  // Recompute schedules a new timeout, old one was already skipped
  computed.get();

  await new Promise((r) => globalThis.setTimeout(r, 100));
  assert.strictEqual(callCount, 1);
});

void test("setTimeout with Checking state", async () => {
  // Test: fires when Checking resolves to Clean (sources unchanged)
  const stateA = new StateSignal(1);
  const stateB = new StateSignal(100);

  const intermediate = new ComputedSignal(() => {
    stateA.get();
    return "constant"; // Always returns same value
  });

  let callCount = 0;
  const computed = new ComputedSignal(() => {
    intermediate.get();
    stateB.get();
    setTimeout(() => {
      callCount++;
    }, 10);
    return "done";
  });

  computed.get();
  stateA.set(2); // intermediate recomputes but returns same value

  await new Promise((r) => globalThis.setTimeout(r, 50));
  assert.strictEqual(callCount, 1); // Fires: Checking -> Clean

  // Test: cancelled when Checking resolves to Dirty (sources changed)
  const stateC = new StateSignal(1);
  const intermediate2 = new ComputedSignal(() => stateC.get() * 2);

  let callCount2 = 0;
  const computed2 = new ComputedSignal(() => {
    intermediate2.get();
    setTimeout(() => {
      callCount2++;
    }, 10);
    return "done";
  });

  computed2.get();
  stateC.set(2); // intermediate2 returns different value

  await new Promise((r) => globalThis.setTimeout(r, 50));
  assert.strictEqual(callCount2, 0); // Cancelled: Checking -> Dirty
});

void test("setTimeout passes arguments and can be manually cleared", async () => {
  // Test argument passing
  let receivedArgs: unknown[] = [];
  const computed = new ComputedSignal(() => {
    setTimeout(
      (a: number, b: string) => {
        receivedArgs = [a, b];
      },
      10,
      42,
      "hello",
    );
    return "done";
  });

  computed.get();
  await new Promise((r) => globalThis.setTimeout(r, 50));
  assert.deepStrictEqual(receivedArgs, [42, "hello"]);

  // Test manual clearing
  let called = false;
  const computed2 = new ComputedSignal(() => {
    const id = setTimeout(() => {
      called = true;
    }, 50);
    globalThis.clearTimeout(id);
    return "done";
  });

  computed2.get();
  await new Promise((r) => globalThis.setTimeout(r, 100));
  assert.strictEqual(called, false);
});

// =============================================================================
// setInterval Tests
// =============================================================================

void test("setInterval outside computed behaves like regular setInterval", async () => {
  let callCount = 0;
  const id = setInterval(() => {
    callCount++;
  }, 20);

  await new Promise((r) => globalThis.setTimeout(r, 70));
  globalThis.clearInterval(id);

  assert.ok(callCount >= 2, `Expected at least 2 calls, got ${callCount}`);
});

void test("setInterval inside computed stops when signal becomes dirty", async () => {
  const state = new StateSignal(1);
  let callCount = 0;

  const computed = new ComputedSignal(() => {
    state.get();
    setInterval(() => {
      callCount++;
    }, 20);
    return "done";
  });

  computed.get();

  // Let it fire once
  await new Promise((r) => globalThis.setTimeout(r, 30));
  const countAfterFirst = callCount;
  assert.ok(countAfterFirst >= 1, "Should have fired at least once");

  // Make the signal dirty
  state.set(2);

  // Wait for more potential intervals
  await new Promise((r) => globalThis.setTimeout(r, 60));

  // Should not have fired again (or at most once more if timing is tight)
  assert.ok(
    callCount <= countAfterFirst + 1,
    `Expected no more than ${countAfterFirst + 1} calls, got ${callCount}`,
  );
});

void test("setInterval inside computed stops and restarts on recompute", async () => {
  const state = new StateSignal(1);
  let callCount = 0;
  let intervalId: ReturnType<typeof setInterval>;

  const computed = new ComputedSignal(() => {
    const val = state.get();
    intervalId = setInterval(() => {
      callCount++;
    }, 20);
    return val;
  });

  computed.get();

  // Let it fire a couple times
  await new Promise((r) => globalThis.setTimeout(r, 50));
  const countBeforeRecompute = callCount;

  // Recompute - old interval should stop, new one should start
  state.set(2);
  computed.get();

  await new Promise((r) => globalThis.setTimeout(r, 50));
  globalThis.clearInterval(intervalId!);

  // New interval should have fired
  assert.ok(
    callCount > countBeforeRecompute,
    "New interval should have fired after recompute",
  );
});

void test("setInterval passes arguments and can be manually cleared", async () => {
  // Test argument passing
  let receivedArgs: unknown[] = [];
  const id = setInterval(
    (a: number, b: string) => {
      receivedArgs = [a, b];
    },
    10,
    42,
    "hello",
  );

  await new Promise((r) => globalThis.setTimeout(r, 30));
  globalThis.clearInterval(id);
  assert.deepStrictEqual(receivedArgs, [42, "hello"]);

  // Test manual clearing
  let callCount = 0;
  const computed = new ComputedSignal(() => {
    const intervalId = setInterval(() => {
      callCount++;
    }, 20);
    globalThis.clearInterval(intervalId);
    return "done";
  });

  computed.get();
  await new Promise((r) => globalThis.setTimeout(r, 70));
  assert.strictEqual(callCount, 0);
});

// =============================================================================
// Disposal Tests
// =============================================================================

void test("ConstSignal disposal", () => {
  const signal = new ConstSignal(42);
  assert.strictEqual(signal.get(), 42);

  signal[Symbol.dispose]();

  // Reading after disposal throws
  assert.throws(() => signal.get(), { message: "Cannot read disposed signal" });

  // Disposing again is a no-op (doesn't throw)
  signal[Symbol.dispose]();
});

void test("StateSignal disposal", () => {
  const signal = new StateSignal(42);
  assert.strictEqual(signal.get(), 42);

  signal[Symbol.dispose]();

  // Reading after disposal throws
  assert.throws(() => signal.get(), { message: "Cannot read disposed signal" });

  // Writing after disposal throws
  assert.throws(() => signal.set(100), {
    message: "Cannot write to disposed signal",
  });

  // Disposing again is a no-op (doesn't throw)
  signal[Symbol.dispose]();
});

void test("ComputedSignal disposal", () => {
  const state = new StateSignal(1);
  let computeCount = 0;

  const computed = new ComputedSignal(() => {
    computeCount++;
    return state.get() * 2;
  });

  assert.strictEqual(computed.get(), 2);
  assert.strictEqual(computeCount, 1);

  computed[Symbol.dispose]();

  // Reading after disposal throws
  assert.throws(() => computed.get(), {
    message: "Cannot read disposed signal",
  });

  // Disposing again is a no-op (doesn't throw)
  computed[Symbol.dispose]();

  // Source state still works
  assert.strictEqual(state.get(), 1);
});

void test("ComputedSignal disposal detaches from sources", () => {
  const state = new StateSignal(1);
  let computeCount = 0;

  const computed = new ComputedSignal(() => {
    computeCount++;
    return state.get() * 2;
  });

  assert.strictEqual(computed.get(), 2);
  assert.strictEqual(computeCount, 1);

  // Verify sink is registered
  assert.strictEqual((state as any)._sinks.size, 1);

  computed[Symbol.dispose]();

  // Sink should be removed after disposal
  assert.strictEqual((state as any)._sinks.size, 0);
});

void test("ComputedSignal disposal runs cleanups", async () => {
  let timeoutFired = false;
  let intervalFired = false;

  const computed = new ComputedSignal(() => {
    setTimeout(() => {
      timeoutFired = true;
    }, 10);
    setInterval(() => {
      intervalFired = true;
    }, 10);
    return "done";
  });

  computed.get();
  computed[Symbol.dispose]();

  // Wait for timers that would have fired
  await new Promise((r) => globalThis.setTimeout(r, 50));

  // Neither should have fired because disposal cleared them
  assert.strictEqual(timeoutFired, false);
  assert.strictEqual(intervalFired, false);
});

void test("Disposal cascades to nested signals of all types", () => {
  let innerState: StateSignal<number> | null = null;
  let innerConst: ConstSignal<number> | null = null;
  let innerComputed: ComputedSignal<number> | null = null;

  const outer = new ComputedSignal(() => {
    innerState = new StateSignal(10);
    innerConst = new ConstSignal(20);
    innerComputed = new ComputedSignal(() => 30);
    return innerState.get() + innerConst.get() + innerComputed.get();
  });

  assert.strictEqual(outer.get(), 60);

  outer[Symbol.dispose]();

  assert.throws(() => innerState!.get(), {
    message: "Cannot read disposed signal",
  });
  assert.throws(() => innerConst!.get(), {
    message: "Cannot read disposed signal",
  });
  assert.throws(() => innerComputed!.get(), {
    message: "Cannot read disposed signal",
  });
});
