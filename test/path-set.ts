import test from "node:test";
import assert from "node:assert";
import Path from "../lib/common/path.ts";
import PathSet from "../lib/common/path-set.ts";

void test("add", () => {
  const pathSet = new PathSet();
  pathSet.add("a");
  pathSet.add("a");
  assert.strictEqual(
    pathSet.findCompat(Path.parse("a"), true, true, 99).length,
    1,
  );
});

void test("get", () => {
  const pathSet = new PathSet();
  pathSet.add("a.*");
  pathSet.add("a.a");
  pathSet.add("*.*");

  assert.strictEqual(pathSet.get("a.*").toString(), "a.*");
  assert.equal(pathSet.get("*.a"), null);
});

void test("find", () => {
  const pathSet = new PathSet();
  pathSet.add("a");
  pathSet.add("a.*");
  pathSet.add("a.a");
  pathSet.add("*.a");
  pathSet.add("*.*");

  assert.deepStrictEqual(
    pathSet.findCompat(Path.root, true, true, 1).map((p) => p.toString()),
    ["a"],
  );

  assert.deepStrictEqual(
    pathSet.findCompat(Path.root, false, false, 2).map((p) => p.toString()),
    ["a", "a.*", "a.a", "*.a", "*.*"],
  );

  assert.deepStrictEqual(
    pathSet
      .findCompat(Path.parse("a.*"), false, false)
      .map((p) => p.toString()),
    ["a.*"],
  );

  assert.deepStrictEqual(
    pathSet.findCompat(Path.parse("a.*"), false, true).map((p) => p.toString()),
    ["a.*", "a.a"],
  );

  assert.deepStrictEqual(
    pathSet.findCompat(Path.parse("a.*"), true, false).map((p) => p.toString()),
    ["a.*", "*.*"],
  );

  assert.deepStrictEqual(
    pathSet.findCompat(Path.parse("a.*"), true, true).map((p) => p.toString()),
    ["a.*", "a.a", "*.a", "*.*"],
  );
});
