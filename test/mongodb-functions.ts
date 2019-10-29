import ava from "ava";
import * as mongodbFunctions from "../lib/mongodb-functions";
import { stringify } from "../lib/common/expression-parser";

ava("mongoQueryToFilter", t => {
  const tests = [
    [{}, "true"],
    [{ test: "test" }, 'test = "test"'],
    [{ test: { $eq: "test" } }, 'test = "test"'],
    [{ test: { $ne: "test" } }, 'test <> "test"'],
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
      'test = "test" AND test <> "test"'
    ],
    [{ test: "test", test2: "test2" }, 'test = "test" AND test2 = "test2"'],
    [
      { $or: [{ test: "test" }, { test: { $ne: "test" } }] },
      'test = "test" OR test <> "test"'
    ],
    [
      { test: { $gte: "test1", $ne: "test2" } },
      'test >= "test1" AND test <> "test2"'
    ],
    [
      { test: "test", test2: { $ne: "test2" } },
      'test = "test" AND test2 <> "test2"'
    ]
  ];

  const shouldFailTests = [
    [{ test: { $gee: "test" } }, "Operator $gee not supported"],
    [{ test: [] }, "Invalid type"],
    [{ "Tags.test": { $gt: true } }, "Invalid tag query"],
    [{ _tags: [] }, "Invalid type"],
    [{ _tags: { $gt: "test" } }, "Invalid tag query"],
    [{ $nor: [] }, "Operator $nor not supported"]
  ];

  t.plan(tests.length + 2 * shouldFailTests.length);
  for (const test of tests)
    t.is(stringify(mongodbFunctions.mongoQueryToFilter(test[0])), test[1]);

  for (const test of shouldFailTests) {
    const func = (): void => {
      mongodbFunctions.mongoQueryToFilter(test[0]);
    };
    const error = t.throws(func, Error);
    t.is(error.message, test[1]);
  }
});
