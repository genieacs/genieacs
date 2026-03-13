import test from "node:test";
import assert from "node:assert";
import initSqlJs from "sql.js/dist/sql-asm.js";
import { covers, minimize, unionDiff } from "../lib/common/expression/synth.ts";
import Expression from "../lib/common/expression.ts";

function isFalse(expr: Expression): boolean {
  return expr instanceof Expression.Literal && expr.value === false;
}

const STRING_VALUES = [null, "", "a", "ab", "ab10", "ab-10"];
const DECIMAL_VALUES = [null, 0, -10, 10];

let db;

async function query(filter: string): Promise<Set<number>> {
  if (!db) {
    const sql = await initSqlJs();
    db = new sql.Database();

    db.run(
      "CREATE TABLE test (id INTEGER PRIMARY KEY, string STRING, decimal DECIMAL(4,2))",
    );

    const stmt = db.prepare("INSERT INTO test (string, decimal) VALUES (?, ?)");
    const count = STRING_VALUES.length * DECIMAL_VALUES.length;
    for (let i = 0; i < count; ++i) {
      const str = i % STRING_VALUES.length;
      const dec = Math.trunc(i / STRING_VALUES.length) % DECIMAL_VALUES.length;
      stmt.run([STRING_VALUES[str], DECIMAL_VALUES[dec]]);
    }
    stmt.free();
  }

  const res = db.exec(`SELECT id FROM test WHERE ${filter}`);
  if (!res.length) return new Set();
  return new Set(res[0].values.flat());
}

function setsEqual(set1: Set<number>, set2: Set<number>): boolean {
  if (set1.size !== set2.size) return false;
  for (const s of set1) if (!set2.has(s)) return false;
  return true;
}

function getPermutations(...arrs: any[][]): any[][] {
  const count = arrs.reduce((total, arr) => total * arr.length, 1);
  const res = [];
  for (let i = 0; i < count; ++i) {
    let j = i;
    const row = [];
    for (const arr of arrs) {
      const v = arr[j % arr.length];
      j = Math.trunc(j / arr.length);
      row.push(v);
    }
    res.push(row);
  }
  return res;
}

void test("minimize", async () => {
  const cases: string[] = [];

  cases.push("null");
  cases.push("false");
  cases.push("true");
  cases.push("string");
  cases.push("(string + decimal) IS NULL");
  cases.push("(string + decimal) = NULL");
  cases.push("COALESCE(string, decimal) = 0");

  for (const [s1, s2, s3, op1, op2] of getPermutations(
    STRING_VALUES.filter((s) => s),
    STRING_VALUES.filter((s) => s),
    STRING_VALUES.filter((s) => s),
    [">", "=", "<"],
    ["<>", ">="],
  )) {
    cases.push(
      `string ${op1} "${s1}" OR string ='${s2}' OR NOT string ${op2} '${s3}'`,
    );
  }

  for (const [s1, s2] of getPermutations(
    STRING_VALUES.filter((s) => s),
    STRING_VALUES.filter((s) => s),
  ))
    cases.push(`string > "${s1}" AND string < '${s2}'`);

  for (const c of cases) {
    const res1 = await query(c);
    const min = minimize(Expression.parse(c), true).toString();
    const res2 = await query(min);
    assert.strictEqual(setsEqual(res1, res2), true);
  }
});

void test("unionDiff", async () => {
  const cases = [
    "true",
    "decimal > 0",
    "decimal > 10",
    "UPPER(string || decimal) LIKE 'AB10'",
    "COALESCE(string, decimal) = 0",
  ];

  for (const [c1, c2] of getPermutations(cases, cases)) {
    const res1 = await query(c1);
    const res2 = await query(c2);
    const [union, diff] = unionDiff(Expression.parse(c1), Expression.parse(c2));
    const res3 = await query(union.toString());
    const res4 = await query(diff.toString());

    const unionSet = new Set([...res1, ...res2]);
    const diffSet = new Set(Array.from(res2).filter((r) => !res1.has(r)));

    assert.strictEqual(setsEqual(res3, unionSet), true);
    assert.strictEqual(setsEqual(res4, diffSet), true);
  }
});

void test("covers", async () => {
  assert.strictEqual(
    covers(Expression.parse("false"), Expression.parse("false")),
    true,
  );
  assert.strictEqual(
    covers(
      Expression.parse("false"),
      Expression.parse("decimal > 5 AND decimal < 3"),
    ),
    true,
  );
  assert.strictEqual(
    covers(Expression.parse("true"), Expression.parse("decimal > 0")),
    true,
  );
  assert.strictEqual(
    covers(Expression.parse("true"), Expression.parse("false")),
    true,
  );
  assert.strictEqual(
    covers(Expression.parse("false"), Expression.parse("decimal > 0")),
    false,
  );
  assert.strictEqual(
    covers(Expression.parse("decimal >= 0"), Expression.parse("decimal > 0")),
    true,
  );
  assert.strictEqual(
    covers(Expression.parse("decimal > 0"), Expression.parse("decimal >= 0")),
    false,
  );

  const cases = [
    ["decimal >= 0", "decimal > 0"],
    ["decimal > 0", "decimal > 5"],
    ["string IS NOT NULL", "string = 'a'"],
    ["true", "decimal > 0"],
  ];

  for (const [c1, c2] of cases) {
    const res1 = await query(c1);
    const res2 = await query(c2);
    const coversResult = covers(Expression.parse(c1), Expression.parse(c2));
    const actuallyCovers = Array.from(res2).every((r) => res1.has(r));

    assert.strictEqual(
      coversResult,
      actuallyCovers,
      `covers(${c1}, ${c2}) should match actual coverage`,
    );
  }
});

void test("LIKE-Compare DC set relationships", () => {
  const likeExpr = Expression.parse("string LIKE 'a%'");

  const eqExpr = Expression.parse("string = 'a'");
  const conjExpr: Expression = new Expression.Binary("AND", eqExpr, likeExpr);
  assert.strictEqual(
    isFalse(minimize(conjExpr, true)),
    false,
    "(string = 'a') AND (string LIKE 'a%') should NOT minimize to false",
  );

  const nonMatchingExpr = Expression.parse("string = 'b'");
  const conjNonMatch: Expression = new Expression.Binary(
    "AND",
    nonMatchingExpr,
    likeExpr,
  );
  assert.strictEqual(
    isFalse(minimize(conjNonMatch, true)),
    true,
    "(string = 'b') AND (string LIKE 'a%') should minimize to false",
  );
});

void test("LIKE-Compare DC set with range operators", () => {
  const likeExpr = Expression.parse("string LIKE 'abc%'");

  const ltExpr = Expression.parse("string < 'abc'");
  const ltConj: Expression = new Expression.Binary("AND", ltExpr, likeExpr);
  assert.strictEqual(
    isFalse(minimize(ltConj, true)),
    true,
    "(string < 'abc') AND (string LIKE 'abc%') should be false",
  );

  const ltExpr2 = Expression.parse("string < 'abd'");
  const ltConj2: Expression = new Expression.Binary("AND", ltExpr2, likeExpr);
  assert.strictEqual(
    isFalse(minimize(ltConj2, true)),
    false,
    "(string < 'abd') AND (string LIKE 'abc%') should NOT be false",
  );

  const gtExpr = Expression.parse("string > 'abd'");
  const gtConj: Expression = new Expression.Binary("AND", gtExpr, likeExpr);
  assert.strictEqual(
    isFalse(minimize(gtConj, true)),
    true,
    "(string > 'abd') AND (string LIKE 'abc%') should be false",
  );

  const gtExpr2 = Expression.parse("string > 'abc'");
  const gtConj2: Expression = new Expression.Binary("AND", gtExpr2, likeExpr);
  assert.strictEqual(
    isFalse(minimize(gtConj2, true)),
    false,
    "(string > 'abc') AND (string LIKE 'abc%') should NOT be false",
  );
});
