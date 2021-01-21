import ava from "ava";
import * as yaml from "yaml";
import { stringify } from "../lib/common/yaml";

import testCases from "./yaml-tests.json";

ava("stringify", (t) => {
  for (const testCase of testCases) {
    let str = stringify(testCase);
    if (str.startsWith(">2")) str = ">3" + str.slice(2);
    if (str.startsWith("|2")) str = "|3" + str.slice(2);
    t.deepEqual(yaml.parse(yaml.stringify(testCase)), yaml.parse(str));
  }
});
