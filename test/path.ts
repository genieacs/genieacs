import test from "node:test";
import assert from "node:assert";
import Path from "../lib/common/path.ts";

void test("parse", () => {
  assert.throws(() => Path.parse("."));
  assert.throws(() => Path.parse("a "));
  assert.throws(() => Path.parse(".a"));
  assert.throws(() => Path.parse("a."));
  assert.throws(() => Path.parse("a..b"));
  assert.doesNotThrow(() => Path.parse("b*"));
  assert.doesNotThrow(() => Path.parse("*b"));
  assert.throws(() => Path.parse("a.b c.d"));
  assert.throws(() => Path.parse("a["));
  assert.throws(() => Path.parse("a[b"));
  assert.throws(() => Path.parse("a[b:"));
  assert.throws(() => Path.parse('a[b:"waef]'));
  assert.doesNotThrow(() => Path.parse("*"));
  assert.throws(() => Path.parse(""));
});

void test("toString", () => {
  const path1 = Path.parse('abc.[ abc=123 and def=" abc " ].123');
  const path2 = Path.parse('abc.[abc = 123 AND def = " abc "].123');
  assert.strictEqual(path1.toString(), path2.toString());
});

void test("slice", () => {
  const path = Path.parse(`a.*.b.[x = "y"].c`);
  const sliced = path.slice(1, -1);
  assert.strictEqual(sliced.toString(), '*.b.[x = "y"]');
  assert.strictEqual(sliced.alias, 0b100);
  assert.strictEqual(sliced.wildcard, 0b1);

  const path2 = Path.parse("a.b:c.d");

  // Trim from right into colon region
  assert.strictEqual(path2.slice(0, 3).toString(), "a.b:c");
  assert.strictEqual(path2.slice(0, 3).colon, 1);

  // Trim from right past colon region
  assert.strictEqual(path2.slice(0, 2).toString(), "a.b");
  assert.strictEqual(path2.slice(0, 2).colon, 0);

  // Start exactly at colon boundary (all-colon result)
  assert.strictEqual(path2.slice(2, 4).toString(), ":c.d");
  assert.strictEqual(path2.slice(2, 4).colon, 2);

  // Start past colon boundary (colon dropped)
  assert.strictEqual(path2.slice(3, 4).toString(), "d");
  assert.strictEqual(path2.slice(3, 4).colon, 0);

  // Span across boundary from both sides
  assert.strictEqual(path2.slice(1, 3).toString(), "b:c");
  assert.strictEqual(path2.slice(1, 3).colon, 1);
});

void test("concat", () => {
  // Alias and wildcard propagation
  const c0 = Path.parse("a").concat(Path.parse('*.[a = "b"]'));
  assert.strictEqual(c0.toString(), 'a.*.[a = "b"]');
  assert.strictEqual(c0.alias, 0b100);
  assert.strictEqual(c0.wildcard, 0b10);

  // Left plain, right all-colon
  const allColon = Path.parse("a:b.c").slice(1, 3);
  const c1 = Path.parse("a.b").concat(allColon);
  assert.strictEqual(c1.toString(), "a.b:b.c");
  assert.strictEqual(c1.colon, 2);

  // Left colon, right all-colon
  const c2 = Path.parse("a:b").concat(Path.parse("a.b:c.d").slice(2, 4));
  assert.strictEqual(c2.toString(), "a:b.c.d");
  assert.strictEqual(c2.colon, 3);

  // Both have mixed colon — should throw
  assert.throws(() => Path.parse("a:b").concat(Path.parse("c:d")));
});

void test("old alias format", () => {
  // Empty brackets
  const empty = Path.parse("a.[].b");
  assert.strictEqual(empty.alias, 0b10);
  assert.strictEqual(empty.toString(), "a.[TRUE].b");

  // Single key-value
  const single = Path.parse("a.[b:c].d");
  assert.strictEqual(single.alias, 0b10);
  assert.strictEqual(single.toString(), 'a.[b = "c"].d');

  // Multiple key-value pairs
  const multi = Path.parse("a.[b:1,c:2].d");
  assert.strictEqual(multi.alias, 0b10);
  assert.strictEqual(multi.toString(), 'a.[b = "1" AND c = "2"].d');

  // Key with empty value
  const emptyVal = Path.parse("a.[b:].d");
  assert.strictEqual(emptyVal.toString(), 'a.[b = ""].d');

  // Value containing colons (split on first : only)
  const colonVal = Path.parse("a.[b:c:d].e");
  assert.strictEqual(colonVal.toString(), 'a.[b = "c:d"].e');

  // Value containing spaces (trimmed)
  const spaceVal = Path.parse("a.[b:hello world].c");
  assert.strictEqual(spaceVal.toString(), 'a.[b = "hello world"].c');

  // Unquoted values are trimmed
  const trimmed = Path.parse("a.[b: hello ].c");
  assert.strictEqual(trimmed.toString(), 'a.[b = "hello"].c');

  // Whitespace around keys is trimmed
  const keySpace = Path.parse("a.[ b : c ].d");
  assert.strictEqual(keySpace.toString(), 'a.[b = "c"].d');

  // Equivalence with new format
  const oldFmt = Path.parse("x.[a:1,b:2].y");
  const newFmt = Path.parse('x.[a = "1" AND b = "2"].y');
  assert.strictEqual(oldFmt.toString(), newFmt.toString());

  // Nested old-format alias
  const nested = Path.parse("a.[b.[x:1].c:2].d");
  assert.strictEqual(nested.toString(), 'a.[b.[x = "1"].c = "2"].d');

  // New SQL format still works
  const sql = Path.parse("a.[b = 1 AND c = 2].d");
  assert.strictEqual(sql.toString(), "a.[b = 1 AND c = 2].d");

  // Double-quoted value containing closing bracket
  const quotedBracket = Path.parse('a.[b:"hello]world"].c');
  assert.strictEqual(quotedBracket.toString(), 'a.[b = "hello]world"].c');

  // Double-quoted value containing comma
  const quotedComma = Path.parse('a.[b:"hello,world"].c');
  assert.strictEqual(quotedComma.toString(), 'a.[b = "hello,world"].c');

  // Double-quoted value with escape sequences (JSON semantics)
  const escaped = Path.parse('a.[b:"hello\\"world"].c');
  assert.strictEqual(escaped.toString(), 'a.[b = "hello\\"world"].c');

  // Single-quoted value
  const singleQuoted = Path.parse("a.[b:'value'].c");
  assert.strictEqual(singleQuoted.toString(), 'a.[b = "value"].c');

  // Invalid old format (no colon) still throws
  assert.throws(() => Path.parse("[abc]"));
});

void test("slice concat round-trip", () => {
  const path = Path.parse("a.b:c.d");

  // Round-trips at every split position up to and including the boundary
  for (let i = 1; i <= path.paramLength; i++) {
    const rejoined = path.slice(0, i).concat(path.slice(i));
    assert.strictEqual(rejoined.toString(), path.toString());
    assert.strictEqual(rejoined.colon, path.colon);
  }

  // Split inside the colon region: right half loses colon,
  // but concat still extends the left's attr region
  const left = path.slice(0, 3);
  const right = path.slice(3);
  assert.strictEqual(left.colon, 1);
  assert.strictEqual(right.colon, 0);
  const rejoined = left.concat(right);
  assert.strictEqual(rejoined.toString(), "a.b:c.d");
  assert.strictEqual(rejoined.colon, 2);
});
