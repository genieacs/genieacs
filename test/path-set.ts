import test from "node:test";
import assert from "node:assert";
import Path from "../lib/common/path.ts";
import PathSet from "../lib/common/path-set.ts";

void test("depth", () => {
  const pathSet = new PathSet();
  assert.strictEqual(pathSet.depth, 0);
  pathSet.add(Path.parse(""));
  assert.strictEqual(pathSet.depth, 1);
  pathSet.add(Path.parse("a"));
  assert.strictEqual(pathSet.depth, 2);
});

void test("add", () => {
  const pathSet = new PathSet();
  pathSet.add(Path.parse("a"));
  pathSet.add(Path.parse("a"));
  assert.strictEqual(pathSet.find(Path.parse("a"), true, true, 99).length, 1);
});

void test("get", () => {
  const pathSet = new PathSet();
  pathSet.add(Path.parse("a.*"));
  pathSet.add(Path.parse("a.a"));
  pathSet.add(Path.parse("*.*"));

  assert.strictEqual(pathSet.get(Path.parse("a.*")).toString(), "a.*");
  assert.strictEqual(pathSet.get(Path.parse("*.a")), null);
});

void test("find", () => {
  const pathSet = new PathSet();
  pathSet.add(Path.parse("a"));
  pathSet.add(Path.parse("a.*"));
  pathSet.add(Path.parse("a.a"));
  pathSet.add(Path.parse("*.a"));
  pathSet.add(Path.parse("*.*"));

  assert.deepStrictEqual(
    pathSet.find(Path.parse(""), true, true, 1).map((p) => p.toString()),
    ["a"],
  );

  assert.deepStrictEqual(
    pathSet.find(Path.parse(""), false, false, 2).map((p) => p.toString()),
    ["a", "a.*", "a.a", "*.a", "*.*"],
  );

  assert.deepStrictEqual(
    pathSet.find(Path.parse("a.*"), false, false).map((p) => p.toString()),
    ["a.*"],
  );

  assert.deepStrictEqual(
    pathSet.find(Path.parse("a.*"), false, true).map((p) => p.toString()),
    ["a.*", "a.a"],
  );

  assert.deepStrictEqual(
    pathSet.find(Path.parse("a.*"), true, false).map((p) => p.toString()),
    ["a.*", "*.*"],
  );

  assert.deepStrictEqual(
    pathSet.find(Path.parse("a.*"), true, true).map((p) => p.toString()),
    ["a.*", "a.a", "*.a", "*.*"],
  );
});
