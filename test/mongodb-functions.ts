import ava from "ava";
import { EJSON } from "bson";
import { Filter } from "mongodb";
import * as mongodbFunctions from "../lib/mongodb-functions";
import { stringify, parse } from "../lib/common/expression/parser";

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

ava("toMongoQuery", async (t) => {
  const queries: [string, Filter<unknown> | false][] = [
    ["true", {}],
    ["Tags.tag1 = true", { _tags: { $eq: "tag1" } }],
    ["Tags.tag1 <> false", { _tags: { $eq: "tag1" } }],
    ["Tags.tag1 IS NULL", { _tags: { $ne: "tag1" } }],
    ["Tags.tag1 = 123", false],
    ["Param1 = 'value1'", { "Param1._value": { $eq: "value1" } }],
    [
      "Param1 <> 'value1'",
      {
        "Param1._value": { $ne: "value1" },
        $and: [{ "Param1._value": { $ne: null } }],
      },
    ],
    [
      "Param1 <> 1657844103524",
      {
        "Param1._value": { $ne: 1657844103524 },

        $and: [
          {
            "Param1._value": { $ne: { $date: "2022-07-15T00:15:03.524Z" } },
          },
          { "Param1._value": { $ne: null } },
        ],
      },
    ],
    [
      "Param1 = 1657844103524",
      {
        $or: [
          { "Param1._value": { $eq: { $date: "2022-07-15T00:15:03.524Z" } } },
          { "Param1._value": { $eq: 1657844103524 } },
        ],
      },
    ],
    ["Param1 > 'value'", { "Param1._value": { $gt: "value" } }],
    ["Param1 IS NOT NULL", { "Param1._value": { $ne: null } }],
    [
      "Param1 LIKE 'value'",
      {
        "Param1._value": {
          $regularExpression: { options: "s", pattern: "^value$" },
        },
      },
    ],

    [
      "LOWER(Param1) LIKE 'value'",
      {
        "Param1._value": {
          $regularExpression: { options: "is", pattern: "^value$" },
        },
      },
    ],
    [
      "Param1 <> 'value2' OR NOT (Param2 = 'value1' OR Param1 < 'value2')",
      {
        $or: [
          {
            "Param2._value": { $ne: null },
            $and: [{ "Param2._value": { $ne: "value1" } }],
            "Param1._value": { $eq: "value2" },
          },
          {
            "Param1._value": { $ne: "value2" },
            $and: [{ "Param1._value": { $ne: null } }],
          },
        ],
      },
    ],
    [
      "Param1 <> 'value2' OR Param1 IS NULL",
      { "Param1._value": { $ne: "value2" } },
    ],
  ];

  for (const [expStr, expect] of queries) {
    const exp = parse(expStr);
    let query = mongodbFunctions.toMongoQuery(exp, "devices");
    if (query) query = EJSON.serialize(query);
    t.deepEqual(query, expect);
  }

  const failQueries: [any, string][] = [
    ["Param1 = Param2", "Right-hand operand must be a literal value"],
    ["Param1 LIKE Param2", "Right-hand operand of 'LIKE' must be a string"],
    ["NOW() = 1", "Left-hand operand must be a parameter"],
    ["param{param2} = 1", "Left-hand operand must be a parameter"],
  ];

  for (const [expStr, err] of failQueries) {
    const exp = parse(expStr);
    t.throws(() => mongodbFunctions.toMongoQuery(exp, "devices"), {
      message: err,
    });
  }
});
