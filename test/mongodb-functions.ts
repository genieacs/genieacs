import ava from "ava";
import * as mongodbFunctions from "../lib/mongodb-functions";
import { stringify, parse } from "../lib/common/expression-parser";

ava("convertOldPrecondition", (t) => {
  const tests = [
    [{}, "true"],
    [{ test: "test" }, 'test = "test"'],
    [{ test: { $eq: "test" } }, 'test = "test"'],
    [{ test: { $ne: "test" } }, 'test <> "test" OR test IS NULL'],
    [{ test: { $gte: "test" } }, 'test >= "test"'],
    [{ "Tags.test": true }, "Tags.test IS NOT NULL"],
    [{ "Tags.test": false }, "Tags.test IS NULL"],
    [{ "Tags.test": { $exists: true } }, "Tags.test IS NOT NULL"],
    [{ "Tags.test": { $exists: false } }, "Tags.test IS NULL"],
    [{ "Tags.test": { $ne: true } }, "Tags.test IS NULL"],
    [{ "Tags.test": { $ne: false } }, "Tags.test IS NOT NULL"],
    [{ "Tags.test": { $eq: true } }, "Tags.test IS NOT NULL"],
    [{ "Tags.test": { $eq: false } }, "Tags.test IS NULL"],
    [{ _tags: "test" }, "Tags.test IS NOT NULL"],
    [{ _tags: { $ne: "test" } }, "Tags.test IS NULL"],
    [{ _tags: { $eq: "test" } }, "Tags.test IS NOT NULL"],
    [
      { $and: [{ test: "test" }, { test: { $ne: "test" } }] },
      'test = "test" AND (test <> "test" OR test IS NULL)',
    ],
    [{ test: "test", test2: "test2" }, 'test = "test" AND test2 = "test2"'],
    [
      { $or: [{ test: "test" }, { test: { $ne: "test" } }] },
      'test = "test" OR (test <> "test" OR test IS NULL)',
    ],
    [
      { test: { $gte: "test1", $ne: "test2" } },
      'test >= "test1" AND (test <> "test2" OR test IS NULL)',
    ],
    [
      { test: "test", test2: { $ne: "test2" } },
      'test = "test" AND (test2 <> "test2" OR test2 IS NULL)',
    ],
  ];

  const shouldFailTests = [
    [{ test: { $gee: "test" } }, "Operator $gee not supported"],
    [{ test: [] }, "Invalid type"],
    [{ "Tags.test": { $gt: true } }, "Invalid tag query"],
    [{ _tags: [] }, "Invalid type"],
    [{ _tags: { $gt: "test" } }, "Invalid tag query"],
    [{ $nor: [] }, "Operator $nor not supported"],
  ];

  t.plan(tests.length + 2 * shouldFailTests.length);
  for (const test of tests) {
    t.is(
      stringify(
        mongodbFunctions.convertOldPrecondition(
          test[0] as Record<string, unknown>
        )
      ),
      test[1]
    );
  }

  for (const test of shouldFailTests) {
    const func = (): void => {
      mongodbFunctions.convertOldPrecondition(
        test[0] as Record<string, unknown>
      );
    };
    const error = t.throws(func, { instanceOf: Error });
    t.is(error.message, test[1]);
  }
});

ava("filterToMongoQuery", async (t) => {
  const queries: [string, Record<string, unknown>][] = [
    ["true", {}],
    ["Tags.tag1 = true", { _tags: "tag1" }],
    ["Tags.tag1 <> false", { _tags: "tag1" }],
    ["Tags.tag1 IS NULL", { _tags: { $ne: "tag1" } }],
    ["Tags.tag1 = 123", { "Tags.tag1": 123 }],
    ["Param1 = 'value1'", { "Param1._value": "value1" }],
    ["Param1 <> 'value1'", { "Param1._value": { $nin: ["value1", null] } }],
    [
      "Param1 <> 1657844103524",
      {
        $and: [
          { "Param1._value": { $nin: [1657844103524, null] } },
          { "Param1._value": { $nin: [new Date(1657844103524), null] } },
        ],
      },
    ],
    [
      "Param1 = 1657844103524",
      {
        $or: [
          { "Param1._value": 1657844103524 },
          { "Param1._value": new Date(1657844103524) },
        ],
      },
    ],
    ["Param1 > 'value'", { "Param1._value": { $gt: "value" } }],
    ["Param1 IS NOT NULL", { "Param1._value": { $ne: null } }],
    ["Param1 LIKE 'value'", { "Param1._value": /^value$/ }],
    ["LOWER(Param1) LIKE 'value'", { "Param1._value": /^value$/i }],
    [
      "Param1 <> 'value2' OR NOT (Param2 = 'value1' OR Param1 < 'value2')",
      {
        $or: [
          { "Param1._value": { $nin: ["value2", null] } },
          {
            $and: [
              { "Param2._value": { $nin: ["value1", null] } },
              { "Param1._value": { $gte: "value2" } },
            ],
          },
        ],
      },
    ],
    [
      "Param1 <> 'value2' OR Param1 IS NULL",
      {
        $or: [
          { "Param1._value": { $nin: ["value2", null] } },
          { "Param1._value": null },
        ],
      },
    ],
  ];

  for (const [expStr, expect] of queries) {
    const exp = parse(expStr);
    const query = mongodbFunctions.filterToMongoQuery(
      mongodbFunctions.processDeviceFilter(exp)
    );
    t.deepEqual(query, expect);
  }

  const failQueries: [any, string][] = [
    ["Param1 = Param2", "Invalid RHS operand of = clause"],
    ["Param1 LIKE Param2", "Invalid RHS operand of LIKE clause"],
    ["1 LIKE '1'", "Invalid LHS operand of LIKE clause"],
    ["1 = 2", "Invalid LHS operand of = clause"],
    ["1 IS NULL", "Invalid LHS operand of IS NULL clause"],
    ["false", "Primitives are not valid queries"],
    ["UPPER(Param1) LIKE 'value'", "Invalid RHS operand of LIKE clause"],
  ];

  for (const [expStr, err] of failQueries) {
    const exp = parse(expStr);
    t.throws(
      () =>
        mongodbFunctions.filterToMongoQuery(
          mongodbFunctions.processDeviceFilter(exp)
        ),
      { message: err }
    );
  }
});
