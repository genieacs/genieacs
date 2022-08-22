import ava, { TestInterface } from "ava";
import { minimize, unionDiff } from "../lib/common/boolean-expression";
import { parse, stringify } from "../lib/common/expression-parser";
import initSqlJs from "sql.js/dist/sql-asm.js";

const test = ava as TestInterface<{
  query: (filter: string) => Promise<Set<number>>;
}>;

const STRING_VALUES = [null, "", "a", "ab", "ab10", "ab-10"];
const DECIMAL_VALUES = [null, 0, -10, 10];

test.before(async (t) => {
  const sql = await initSqlJs();
  const db = new sql.Database();

  t.context.query = async (filter: string): Promise<Set<number>> => {
    const res = db.exec(`SELECT id FROM test WHERE ${filter}`);
    if (!res.length) return new Set();
    return new Set(res[0].values.flat());
  };

  db.run(
    "CREATE TABLE test (id INTEGER PRIMARY KEY, string STRING, decimal DECIMAL(4,2))"
  );

  const stmt = db.prepare("INSERT INTO test (string, decimal) VALUES (?, ?)");
  const count = STRING_VALUES.length * DECIMAL_VALUES.length;
  for (let i = 0; i < count; ++i) {
    const str = i % STRING_VALUES.length;
    const dec = Math.trunc(i / STRING_VALUES.length) % DECIMAL_VALUES.length;
    stmt.run([STRING_VALUES[str], DECIMAL_VALUES[dec]]);
  }
  stmt.free();
});

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

test("minimize", async (t) => {
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
    ["<>", ">="]
  )) {
    cases.push(
      `string ${op1} "${s1}" OR string ='${s2}' OR NOT string ${op2} '${s3}'`
    );
  }

  for (const [s1, s2] of getPermutations(
    STRING_VALUES.filter((s) => s),
    STRING_VALUES.filter((s) => s)
  ))
    cases.push(`string > "${s1}" AND string < '${s2}'`);

  for (const c of cases) {
    const res1 = await t.context.query(c);
    const min = stringify(minimize(parse(c), true));
    const res2 = await t.context.query(min);
    t.true(setsEqual(res1, res2));
  }
});

test("unionDiff", async (t) => {
  const cases = [
    "true",
    "decimal > 0",
    "decimal > 10",
    "UPPER(string || decimal) LIKE 'AB10'",
    "COALESCE(string, decimal) = 0",
  ];

  for (const [c1, c2] of getPermutations(cases, cases)) {
    const res1 = await t.context.query(c1);
    const res2 = await t.context.query(c2);
    const [union, diff] = unionDiff(parse(c1), parse(c2));
    const res3 = await t.context.query(stringify(union));
    const res4 = await t.context.query(stringify(diff));

    const unionSet = new Set([...res1, ...res2]);
    const diffSet = new Set(Array.from(res2).filter((r) => !res1.has(r)));

    t.true(setsEqual(res3, unionSet));
    t.true(setsEqual(res4, diffSet));
  }
});
