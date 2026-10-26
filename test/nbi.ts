import test from "node:test";
import assert from "node:assert";
import { assertSafeQueryFilter } from "../lib/nbi.ts";

void test("assertSafeQueryFilter rejects JS operators at any depth", () => {
  const queries = [
    { $where: "true" },
    { a: { $function: { body: "return 1" } } },
    { $or: [{ a: 1 }, { b: { $accumulator: { init: "return 1" } } }] },
    [{ c: { $where: "1" } }],
    { $where: null },
    { a: [[{ b: { $where: "1" } }]] },
  ];

  for (const q of queries) {
    assert.throws(() => assertSafeQueryFilter(q), /Disallowed query operator/);
  }
});

// The validator only rejects disallowed operators; anything else passes
// through to JSON.parse/MongoDB, which enforce query shape downstream
void test("assertSafeQueryFilter rejects nothing but disallowed operators", () => {
  const queries = [
    {},
    "plain string",
    123,
    null,
    { deviceid: "ACME-000000", tags: { $exists: true } },
    {
      $or: [
        { "DeviceID.Model": { $regex: "^ACME" } },
        { timestamp: { $gt: 1000, $lte: 2000 } },
      ],
    },
  ];

  for (const q of queries) assert.doesNotThrow(() => assertSafeQueryFilter(q));
});
