import test from "node:test";
import assert from "node:assert";
import Path from "../lib/common/path.ts";

void test("parse", () => {
  assert.throws(() => Path.parse("."));
  assert.throws(() => Path.parse("a "));
  assert.throws(() => Path.parse(".a"));
  assert.throws(() => Path.parse("a."));
  assert.throws(() => Path.parse("a..b"));
  assert.throws(() => Path.parse("b*"));
  assert.throws(() => Path.parse("*b"));
  assert.throws(() => Path.parse("a.b c.d"));
  assert.throws(() => Path.parse("a["));
  assert.throws(() => Path.parse("a[b"));
  assert.throws(() => Path.parse("a[b:"));
  assert.throws(() => Path.parse('a[b:"waef]'));
  assert.doesNotThrow(() => Path.parse("[]"));
  assert.doesNotThrow(() => Path.parse("[a:]"));
  assert.doesNotThrow(() => Path.parse("*"));
  assert.doesNotThrow(() => Path.parse(""));
});

void test("toString", () => {
  const path1 = Path.parse('abc.[ abc : 123 , 123 : abc , 123: " abc "].123');
  const path2 = Path.parse('abc.[123:  " abc ",abc:123,123:abc].123');
  assert.strictEqual(path1.toString(), path2.toString());
});

void test("slice", () => {
  const path = Path.parse("a.*.b.[x:y].c");
  const sliced = path.slice(1, -1);
  assert.strictEqual(sliced.toString(), '*.b.[x:"y"]');
  assert.strictEqual(sliced.alias, 0b100);
  assert.strictEqual(sliced.wildcard, 0b1);
});

void test("concat", () => {
  const path1 = Path.parse("a");
  const path2 = Path.parse("*.[a:b]");
  const concat = path1.concat(path2);
  assert.strictEqual(concat.toString(), 'a.*.[a:"b"]');
  assert.strictEqual(concat.alias, 0b100);
  assert.strictEqual(concat.wildcard, 0b10);
});
