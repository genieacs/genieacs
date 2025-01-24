import test from "node:test";
import assert from "node:assert";
import * as yaml from "yaml";
import { stringify } from "../lib/common/yaml.ts";

import testCases from "./yaml-tests.json";

void test("stringify", () => {
  for (const testCase of testCases) {
    let str = stringify(testCase);
    if (str.startsWith(">2")) str = ">3" + str.slice(2);
    if (str.startsWith("|2")) str = "|3" + str.slice(2);
    assert.deepStrictEqual(
      yaml.parse(yaml.stringify(testCase)),
      yaml.parse(str),
    );
  }
});
