import test from "node:test";
import assert from "node:assert";
import * as common from "../lib/util.ts";

void test("generateDeviceId", () => {
  const space = [" ", "%20"];
  const special = [";", "%3B"];
  const cases = [
    [
      {
        ProductClass: "TestProductClass",
        OUI: "TestOUI",
        SerialNumber: "TestSerialNumber",
      },
      "TestOUI-TestProductClass-TestSerialNumber",
    ],
    [
      {
        OUI: "TestOUI",
        SerialNumber: "TestSerialNumber",
      },
      "TestOUI-TestSerialNumber",
    ],
    [
      {
        OUI: `TestOUIWith${space[0]}_${special[0]}2912`,
        SerialNumber: `TestSerialNumberWith${space[0]}_${special[0]}2912`,
      },
      `TestOUIWith${space[1]}_${special[1]}2912-TestSerialNumberWith${space[1]}_${special[1]}2912`,
    ],
  ];

  for (const c of cases)
    assert.strictEqual(
      common.generateDeviceId(c[0] as Record<string, string>),
      c[1],
    );
});

void test("escapeRegExp", () => {
  assert.strictEqual(
    common.escapeRegExp("\\ ^ $ * + ? . ( ) | { } [ ]"),
    "\\\\ \\^ \\$ \\* \\+ \\? \\. \\( \\) \\| \\{ \\} \\[ \\]",
  );
});
