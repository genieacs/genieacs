/**
 * Copyright 2013-2019  GenieACS Inc.
 *
 * This file is part of GenieACS.
 *
 * GenieACS is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * GenieACS is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with GenieACS.  If not, see <http://www.gnu.org/licenses/>.
 */

import { map, parseLikePattern } from "./expression-parser";
import { Expression } from "../types";

type CNF = number[][];

function or(cnf1: CNF, cnf2: CNF): CNF {
  if (cnf1.length === 0) return cnf2;
  else if (cnf2.length === 0) return cnf1;

  if (cnf1.length > cnf2.length) {
    const c = cnf1;
    cnf1 = cnf2;
    cnf2 = c;
  }

  const res = [];
  for (let i = 0; i < cnf1.length; ++i)
    for (let j = i; j < cnf2.length; ++j) res.push(cnf1[i].concat(cnf2[j]));

  return res;
}

function likePatternIncludes(pat1, pat2, idx1 = 0, idx2 = 0): boolean {
  while (idx1 < pat1.length && idx2 < pat2.length) {
    if (pat1[idx1] === "\\%") {
      for (let i = idx2; i <= pat2.length; ++i)
        if (likePatternIncludes(pat1, pat2, idx1 + 1, i)) return true;
      return false;
    } else if (pat2[idx2] === "\\%") {
      if (pat1[idx1] !== "\\%") return false;
    } else if (pat1[idx1] === "\\_") {
      // Ignore
    } else if (pat2[idx2] === "\\_") {
      return false;
    } else if (pat2[idx2] !== pat1[idx1]) {
      return false;
    }
    ++idx1;
    ++idx2;
  }

  if (idx1 === pat1.length && idx2 === pat2.length) return true;
  return false;
}

export function booleanCnf(exp: Expression): { vars: number; clauses: CNF } {
  const ranges = new Map();
  const likePatterns = new Map();
  map(exp, e => {
    if (!Array.isArray(e)) return e;
    if (e[0] === "LIKE" || e[0] === "NOT LIKE") {
      if (
        typeof e[2] === "string" &&
        (e.length >= 4 || (e[3] != null && !Array.isArray(e[3])))
      ) {
        const key = JSON.stringify(e[1]);
        let s = likePatterns.get(key);
        if (!s) likePatterns.set(key, (s = new Map()));
        s.set(`${e[3] || ""}:${e[2]}`, parseLikePattern(e[2], e[3]));
      }
    } else if ([">", ">=", "<", "<=", "=", "<>"].includes(e[0])) {
      if (!Array.isArray(e[2])) {
        const key = `${JSON.stringify(e[1])}:${typeof e[2]}`;
        let s = ranges.get(key);
        if (!s) ranges.set(key, (s = new Set()));
        s.add(e[2]);
      } else if (!Array.isArray(e[1])) {
        const key = `${JSON.stringify(e[2])}:${typeof e[1]}`;
        let s = ranges.get(key);
        if (!s) ranges.set(key, (s = new Set()));
        s.add(e[2]);
      }
    }
    return e;
  });

  for (const [k, v] of ranges) {
    if (k.endsWith(":number")) {
      ranges.set(
        k,
        Array.from(v as number[]).sort((a: number, b: number) => a - b)
      );
    } else {
      ranges.set(k, Array.from(v).sort());
    }
  }

  const expressions: Map<string, number> = new Map();
  const mutuallyExclusive: Map<string, Set<number>> = new Map();

  function getVariable(lhs, op, rhs = ""): number {
    const key = `${lhs}:${op}:${rhs}`;
    let f = expressions.get(key);
    if (!f) {
      expressions.set(key, (f = expressions.size + 1));
      let m = mutuallyExclusive.get(lhs);
      if (!m) mutuallyExclusive.set(lhs, (m = new Set()));
      m.add(f);
      if (rhs || op !== "null") m.add(getVariable(lhs, "null"));
    }
    return f;
  }

  function getComparisonVariables(
    lhs,
    from,
    fromInclusive,
    to,
    toInclusive
  ): number[] {
    const type = from != null ? typeof from : typeof to;
    const range = ranges.get(`${lhs}:${type}`);
    const vars = [];

    if (from == null) vars.push(`${lhs}:--${range[0]}`);

    for (let i = 0; i < range.length; ++i) {
      if (
        i > 0 &&
        (from == null || range[i] > from) &&
        (to == null || range[i] <= to)
      )
        vars.push(`${lhs}:${range[i - 1]}--${range[i]}`);

      if (
        (range[i] > from && range[i] < to) ||
        (range[i] === from && fromInclusive) ||
        (range[i] === to && toInclusive)
      )
        vars.push(`${lhs}:${range[i]}`);
    }

    if (to == null) vars.push(`${lhs}:${range[range.length - 1]}--`);

    return vars.map(key => {
      let f = expressions.get(key);
      if (!f) {
        expressions.set(key, (f = expressions.size + 1));
        let m = mutuallyExclusive.get(lhs);
        if (!m) mutuallyExclusive.set(lhs, (m = new Set()));
        m.add(f);
      }
      return f;
    });
  }

  function getLikeVariables(lhs, pat, esc): number[] {
    const vars = [];
    const pats = likePatterns.get(lhs);
    pat = pats.get(`${esc || ""}:${pat}`);
    for (const p of pats.values()) {
      if (pat === p || likePatternIncludes(pat, p))
        vars.push(`${lhs}:like:${JSON.stringify(p)}`);
    }

    return vars.map(key => {
      let f = expressions.get(key);
      if (!f) expressions.set(key, (f = expressions.size + 1));
      return f;
    });
  }

  interface ComparisonOperators {
    [name: string]: (v: string) => [string, boolean, string, boolean];
  }

  const comparisonOperators: ComparisonOperators = {
    "=": v => [v, true, v, true],
    ">": v => [v, false, null, null],
    ">=": v => [v, true, null, null],
    "<": v => [null, null, v, false],
    "<=": v => [null, null, v, true]
  };

  function recursive(clause, negate): CNF {
    let op = clause[0];

    if ((op === "AND" && !negate) || (op === "OR" && negate)) {
      let res = [];
      for (let i = 1; i < clause.length; ++i)
        res = res.concat(recursive(clause[i], negate));
      return res;
    } else if ((op === "OR" && !negate) || (op === "AND" && negate)) {
      let res = [];
      for (let i = 1; i < clause.length; ++i)
        res = or(res, recursive(clause[i], negate));
      return res;
    } else if (op === "NOT") {
      return recursive(clause[1], !negate);
    } else if (op === "<>") {
      const vars = getComparisonVariables(
        JSON.stringify(clause[1]),
        ...comparisonOperators["="](clause[2])
      );
      if (!negate) return vars.map(x => [0 - x]);
      else return [vars];
    } else if (op === "IS NULL") {
      const v = getVariable(JSON.stringify(clause[1]), "null");
      if (negate) return [[0 - v]];
      else return [[v]];
    } else if (op === "IS NOT NULL") {
      const v = getVariable(JSON.stringify(clause[1]), "null");
      if (!negate) return [[0 - v]];
      else return [[v]];
    } else if (op in comparisonOperators) {
      if (!Array.isArray(clause[2])) {
        const vars = getComparisonVariables(
          JSON.stringify(clause[1]),
          ...comparisonOperators[op](clause[2])
        );
        if (negate) return vars.map(x => [0 - x]);
        else return [vars];
      } else if (!Array.isArray(clause[1])) {
        op = { ">": "<", ">=": "<=", "<": ">", "<=": ">=" }[op] || op;
        const vars = getComparisonVariables(
          JSON.stringify(clause[2]),
          ...comparisonOperators[op](clause[1])
        );
        if (negate) return vars.map(x => [0 - x]);
        else return [vars];
      } else {
        let lhs = JSON.stringify(clause[1]);
        let rhs = JSON.stringify(clause[2]);
        // For consistency
        if (rhs > lhs) {
          const t = rhs;
          rhs = lhs;
          lhs = t;
          op = { ">": "<", ">=": "<=", "<": ">", "<=": ">=" }[op] || op;
        }

        const v = getVariable(lhs, op, rhs);
        if (negate) return [[0 - v]];
        else return [[v]];
      }
    } else if (
      (op === "LIKE" || op === "NOT LIKE") &&
      !Array.isArray(clause[2]) &&
      clause[2] != null &&
      (clause.length >= 4 || clause[3] != null)
    ) {
      if (op === "NOT LIKE") negate = !negate;
      const vars = getLikeVariables(
        JSON.stringify(clause[1]),
        clause[2],
        clause[3]
      );
      if (negate) return vars.map(x => [0 - x]);
      else return [vars];
    } else {
      const v = getVariable(JSON.stringify(clause), "");
      if (negate) return [[0 - v]];
      else return [[v]];
    }
  }

  const cnf = recursive(exp, false);

  for (const m of mutuallyExclusive.values()) {
    const ar: number[] = Array.from(m);
    for (let i = 0; i < ar.length; ++i)
      for (let j = i + 1; j < ar.length; ++j) cnf.push([0 - ar[i], 0 - ar[j]]);
  }

  return { vars: expressions.size, clauses: cnf };
}
