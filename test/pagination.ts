import test from "node:test";
import assert from "node:assert";
import initSqlJs, { Database } from "sql.js/dist/sql-asm.js";
import {
  bookmarkToExpression,
  paginate,
  toBookmark,
} from "../lib/common/expression/pagination.ts";
import Expression from "../lib/common/expression.ts";
import { covers, minimize, subtract } from "../lib/common/expression/synth.ts";

const VALUES = [null, -1, false, "a"];
const PARAMS = ["param1", "param2"];

let db: Database;

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
      const values: (null | number | string)[] = [];
      for (let j = 0; j < PARAMS.length; ++j)
        values.push(
          VALUES[Math.trunc(i / VALUES.length ** j) % VALUES.length] as
            | null
            | number
            | string,
        );
      stmt.run(values);
    }
    stmt.free();
  }

  const res = db.exec(`SELECT * FROM test WHERE ${filter}`);
  if (!res.length) return [];
  return res[0].values.map(
    (row: unknown[]) =>
      Object.fromEntries(
        row.map((v: unknown, i: number) => [res[0].columns[i], v]),
      ) as { id: string },
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

  const allMatches = await query(`${q2.toString()} ORDER BY ${orderBy}`);
  const [fulfilled, diff] = paginate(q1, q2, sort);
  assert.ok(covers(q1, fulfilled));

  const fulfilledMatches = await query(
    `${fulfilled.toString()} ORDER BY ${orderBy}`,
  );

  const diffMatches = await query(`${diff.toString()} ORDER BY ${orderBy}`);
  assert.deepStrictEqual(allMatches, [...fulfilledMatches, ...diffMatches]);

  if (allMatches.length === fulfilledMatches.length) return;

  const nextMatches = allMatches.slice(
    fulfilledMatches.length,
    fulfilledMatches.length + 1,
  );
  const bookmark = toBookmark(sort, nextMatches[nextMatches.length - 1]);
  const bookmarkFilter = bookmarkToExpression(bookmark, sort);
  const capped = Expression.and(q2, bookmarkFilter);

  assert.ok(!covers(q1, capped));
  const cappedMatches = await query(
    `(${capped.toString()}) ORDER BY ${orderBy}`,
  );
  assert.deepStrictEqual(cappedMatches, [...fulfilledMatches, ...nextMatches]);
  const min = minimize(Expression.or(q1, capped));
  await testPaginate(min, q2, sort);
}

void test("paginate", async () => {
  const cases: [string, string][] = [["param2 < 'a'", "param1 >= 'a'"]];
  const params = ["id", ...PARAMS];
  const sortOrders = getAllSortOrders(params);

  for (const [q1, q2] of cases)
    for (const sort of sortOrders) {
      await testPaginate(Expression.parse(q1), Expression.parse(q2), sort);
    }
});

function idsOf(rows: { id: string }[]): Set<string> {
  return new Set(rows.map((r) => r.id));
}

function isFalse(expr: Expression): boolean {
  return expr instanceof Expression.Literal && !expr.value;
}

// Simulates the reactive store's chunked pagination flow: probe the
// pageSize-th uncovered record, bound the filter by its bookmark, request
// subtract(coverage, bounded), accumulate coverage. Verifies the synth
// subtract()/covers() algebra over bookmark-shaped range conditions against
// SQLite ground truth at every step.
async function testChunkedSubtract(
  filterStr: string,
  sort: Record<string, number>,
  pageSize: number,
): Promise<void> {
  const filter = Expression.parse(filterStr);
  const orderBy = Object.entries(sort)
    .map(([k, v]) => `${k} ${v > 0 ? "ASC" : "DESC"}`)
    .join(", ");
  const ctx = `filter=${filterStr} sort=${JSON.stringify(sort)}`;

  const allMatches = await query(`(${filter.toString()}) ORDER BY ${orderBy}`);
  let coverage: Expression = new Expression.Literal(false);
  const fetched = new Set<string>();

  const maxRounds = Math.ceil(allMatches.length / pageSize) + 1;
  for (let round = 0; ; ++round) {
    const remainder = subtract(coverage, filter);
    if (isFalse(remainder)) break;
    assert.ok(round < maxRounds, `no convergence: ${ctx}`);

    // The remainder must be exactly the uncovered part of the filter
    const remainderMatches = await query(
      `(${remainder.toString()}) ORDER BY ${orderBy}`,
    );
    const expectedRemainder = allMatches.filter((r) => !fetched.has(r.id));
    assert.deepStrictEqual(
      idsOf(remainderMatches),
      idsOf(expectedRemainder),
      `remainder mismatch (round ${round}): ${ctx}`,
    );

    // Probe the pageSize-th uncovered record; fewer than pageSize left means
    // a null bookmark, i.e. fetch the rest unbounded
    let bounded = filter;
    if (remainderMatches.length > pageSize) {
      const bookmark = toBookmark(sort, remainderMatches[pageSize - 1]);
      bounded = Expression.and(filter, bookmarkToExpression(bookmark, sort));
    }

    // The store would request subtract(coverage, bounded): it must not
    // re-fetch covered records, and must include (at least) the next
    // pageSize records — boundary ties on non-unique sort keys may admit
    // extras, which is fine
    const diff = subtract(coverage, bounded);
    const diffMatches = await query(`(${diff.toString()}) ORDER BY ${orderBy}`);
    const diffIds = idsOf(diffMatches);
    for (const id of diffIds) {
      assert.ok(
        !fetched.has(id),
        `chunk re-fetches covered row ${id} (round ${round}): ${ctx}`,
      );
    }
    for (const r of expectedRemainder.slice(0, pageSize)) {
      assert.ok(
        diffIds.has(r.id),
        `chunk misses row ${r.id} (round ${round}): ${ctx}`,
      );
    }

    for (const id of diffIds) fetched.add(id);
    coverage = minimize(Expression.or(coverage, diff));
    assert.ok(
      covers(coverage, bounded),
      `bounded region not covered after fetch (round ${round}): ${ctx}`,
    );
  }

  assert.deepStrictEqual(fetched, idsOf(allMatches), `incomplete: ${ctx}`);
}

void test("subtract over bookmark-bounded chunk regions", async () => {
  const filters = ["true", "param1 >= 'a'", "param1 >= 'a' OR param2 < 'a'"];

  // Unique sort tuples (id is part of every sort, as applyDefaultSort
  // guarantees in production)
  for (const filter of filters) {
    for (const sort of getAllSortOrders(["id", ...PARAMS]))
      await testChunkedSubtract(filter, sort, 3);
  }

  // Non-unique sort tuples: boundary ties get admitted into chunks; the
  // algebra must still converge without ever re-fetching a covered row
  for (const sort of getAllSortOrders(PARAMS))
    await testChunkedSubtract("true", sort, 3);
});
