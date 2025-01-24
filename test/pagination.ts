import test from "node:test";
import assert from "node:assert";
import initSqlJs from "sql.js/dist/sql-asm.js";
import { parse, stringify } from "../lib/common/expression/parser.ts";
import {
  bookmarkToExpression,
  paginate,
  toBookmark,
} from "../lib/common/expression/pagination.ts";
import { Expression } from "../lib/types.ts";
import { covers, minimize } from "../lib/common/expression/synth.ts";

const VALUES = [null, -1, false, "a"];
const PARAMS = ["param1", "param2"];

let db;

async function query(filter: string): Promise<{ id: string }[]> {
  if (!db) {
    const sql = await initSqlJs();
    db = new sql.Database();

    db.run(`CREATE TABLE test (id INTEGER PRIMARY KEY, ${PARAMS.join(", ")})`);

    const stmt = db.prepare(
      `INSERT INTO test (${PARAMS.join(", ")}) VALUES (${PARAMS.map(
        () => "?",
      ).join(", ")})`,
    );
    const count = VALUES.length ** PARAMS.length;
    for (let i = 0; i < count; ++i) {
      const values: (boolean | number | string)[] = [];
      for (let j = 0; j < PARAMS.length; ++j)
        values.push(VALUES[Math.trunc(i / VALUES.length ** j) % VALUES.length]);
      stmt.run(values);
    }
    stmt.free();
  }

  const res = db.exec(`SELECT * FROM test WHERE ${filter}`);
  if (!res.length) return [];
  return res[0].values.map((row) =>
    Object.fromEntries(row.map((v, i) => [res[0].columns[i], v])),
  );
}

function getAllSortOrders(columns: string[]): Array<Record<string, number>> {
  const sortOrders: Array<Record<string, number>> = [];

  function generateOrders(
    remaining: string[],
    current: Record<string, number>,
  ): void {
    if (remaining.length === 0) {
      sortOrders.push({ ...current });
      return;
    }

    for (const column of remaining) {
      const newRemaining = remaining.filter((c) => c !== column);
      current[column] = -1;
      generateOrders(newRemaining, current);
      current[column] = 1;
      generateOrders(newRemaining, current);
      delete current[column];
    }
  }

  generateOrders(columns, {});
  return sortOrders;
}

async function testPaginate(
  q1: Expression,
  q2: Expression,
  sort: Record<string, number>,
): Promise<void> {
  const orderBy = Object.entries(sort)
    .map(([k, v]) => `${k} ${v > 0 ? "ASC" : "DESC"}`)
    .join(", ");

  const allMatches = await query(`${stringify(q2)} ORDER BY ${orderBy}`);
  const [fulfilled, diff] = paginate(q1, q2, sort);
  assert.ok(covers(q1, fulfilled));

  const fulfilledMatches = await query(
    `${stringify(fulfilled)} ORDER BY ${orderBy}`,
  );

  const diffMatches = await query(`${stringify(diff)} ORDER BY ${orderBy}`);
  assert.deepStrictEqual(allMatches, [...fulfilledMatches, ...diffMatches]);

  if (allMatches.length === fulfilledMatches.length) return;

  const nextMatches = allMatches.slice(
    fulfilledMatches.length,
    fulfilledMatches.length + 1,
  );
  const bookmark = toBookmark(sort, nextMatches[nextMatches.length - 1]);
  const bookmarkFilter = bookmarkToExpression(bookmark, sort);
  const capped = ["AND", q2, bookmarkFilter];

  assert.ok(!covers(q1, capped));
  const cappedMatches = await query(
    `(${stringify(capped)}) ORDER BY ${orderBy}`,
  );
  assert.deepStrictEqual(cappedMatches, [...fulfilledMatches, ...nextMatches]);
  const min = minimize(["OR", q1, capped]);
  await testPaginate(min, q2, sort);
}

void test("paginate", async () => {
  const cases: [string, string][] = [["param2 < 'a'", "param1 >= 'a'"]];
  const params = ["id", ...PARAMS];
  const sortOrders = getAllSortOrders(params);

  for (const [q1, q2] of cases)
    for (const sort of sortOrders)
      await testPaginate(parse(q1), parse(q2), sort);
});
