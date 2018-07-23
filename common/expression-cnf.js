"use strict";

function collectRanges(exp, ranges = new Map()) {
  if (["AND", "OR", "NOT"].includes(exp[0]))
    for (let i = 1; i < exp.length; ++i) collectRanges(exp[i], ranges);
  else if ([">", ">=", "<", "<=", "=", "<>"].includes(exp[0]))
    if (!Array.isArray(exp[2])) {
      const key = `${JSON.stringify(exp[1])}:${typeof exp[2]}`;
      let s = ranges.get(key);
      if (!s) ranges.set(key, (s = new Set()));
      s.add(exp[2]);
    } else if (!Array.isArray(exp[1])) {
      const key = `${JSON.stringify(exp[2])}:${typeof exp[1]}`;
      let s = ranges.get(key);
      if (!s) ranges.set(key, (s = new Set()));
      s.add(exp[2]);
    }

  return ranges;
}

function or(cnf1, cnf2) {
  if (cnf1.length === 0) return cnf2;
  else if (cnf2.length === 0) return cnf1;

  const res = [];
  for (let i = 0; i < cnf1.length; ++i)
    for (let j = i; j < cnf2.length; ++j) res.push(cnf1[i].concat(cnf2[j]));

  return res;
}

function booleanCnf(exp) {
  const ranges = collectRanges(exp);
  for (let [k, v] of ranges)
    if (k.endsWith(":number"))
      ranges.set(k, Array.from(v).sort((a, b) => a - b));
    else ranges.set(k, Array.from(v).sort());

  const expressions = new Map();
  const mutuallyExclusive = new Map();

  function getVariable(lhs, op, rhs = "") {
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

  function getComparisonVariables(lhs, from, fromInclusive, to, toInclusive) {
    const type = from != null ? typeof from : typeof to;
    const range = ranges.get(`${lhs}:${type}`);
    const vars = [];

    if (from == null) vars.push(`${lhs}:--${range[0]}`);
    if (to == null) vars.push(`${lhs}:${range[range.length - 1]}--`);
    if (fromInclusive) vars.push(`${lhs}:${from}`);
    if (toInclusive) vars.push(`${lhs}:${to}`);

    for (let i = 1; i < range.length; ++i)
      if ((from == null || range[i] > from) && (to == null || range[i] <= to)) {
        vars.push(`${lhs}:${range[i - 1]}`);
        if (range[i] !== to) vars.push(`${lhs}:${range[i]}`);
        vars.push(`${lhs}:${range[i - 1]}--${range[i]}`);
      }

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

  const comparisonOperators = {
    "=": v => [v, true, v, true],
    ">": v => [v, false, null, null],
    ">=": v => [v, true, null, null],
    "<": v => [null, null, v, false],
    "<=": v => [null, null, v, true]
  };

  function recursive(clause, negate) {
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
          let t = rhs;
          rhs = lhs;
          lhs = t;
          op = { ">": "<", ">=": "<=", "<": ">", "<=": ">=" }[op] || op;
        }

        const v = getVariable(lhs, op, rhs);
        if (negate) return [[0 - v]];
        else return [[v]];
      }
    } else {
      const v = getVariable(JSON.stringify(clause), "");
      if (negate) return [[0 - v]];
      else return [[v]];
    }
  }

  const cnf = recursive(exp, false);

  for (let m of mutuallyExclusive.values()) {
    let ar = Array.from(m);
    for (let i = 0; i < ar.length; ++i)
      for (let j = i + 1; j < ar.length; ++j) cnf.push([0 - ar[i], 0 - ar[j]]);
  }

  return { vars: expressions.size, clauses: cnf };
}

exports.booleanCnf = booleanCnf;
