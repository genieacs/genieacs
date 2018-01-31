"use strict";

function collectRanges(filter, ranges = new Map()) {
  if (["AND", "OR", "NOT"].includes(filter[0])) {
    for (let i = 1; i < filter.length; ++i) collectRanges(filter[i], ranges);
  } else if ([">", ">=", "<", "<=", "=", "<>"].includes(filter[0])) {
    const key = `${filter[1]}:${typeof filter[2]}`;
    let s = ranges.get(key);
    if (!s) ranges.set(key, (s = new Set()));
    s.add(filter[2]);
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

function booleanCnf(filter) {
  const ranges = collectRanges(filter);
  for (let [k, v] of ranges)
    if (k.endsWith(":number"))
      ranges.set(k, Array.from(v).sort((a, b) => a - b));
    else ranges.set(k, Array.from(v).sort());

  const expressions = new Map();
  const mutuallyExclusive = new Map();

  function getIsNullVariable(param) {
    const key = `${param}:null`;
    let f = expressions.get(key);
    if (!f) {
      expressions.set(key, (f = expressions.size + 1));
      let m = mutuallyExclusive.get(param);
      if (!m) mutuallyExclusive.set(param, (m = new Set()));
      m.add(f);
    }
    return f;
  }

  function getComparisonVariables(param, from, fromInclusive, to, toInclusive) {
    const type = from != null ? typeof from : typeof to;
    const range = ranges.get(`${param}:${type}`);
    const vars = [];

    if (from == null) vars.push(`${param}:--${range[0]}`);
    if (to == null) vars.push(`${param}:${range[range.length - 1]}--`);
    if (fromInclusive) vars.push(`${param}:${from}`);
    if (toInclusive) vars.push(`${param}:${to}`);

    for (let i = 1; i < range.length; ++i)
      if ((from == null || range[i] > from) && (to == null || range[i] <= to)) {
        vars.push(`${param}:${range[i - 1]}`);
        vars.push(`${param}:${range[i]}`);
        vars.push(`${param}:${range[i - 1]}--${range[i]}`);
      }

    return vars.map(key => {
      let f = expressions.get(key);
      if (!f) {
        expressions.set(key, (f = expressions.size + 1));
        let m = mutuallyExclusive.get(param);
        if (!m) mutuallyExclusive.set(param, (m = new Set()));
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
    const op = clause[0];

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
    } else if (op in comparisonOperators) {
      const vars = getComparisonVariables(
        clause[1],
        ...comparisonOperators[op](clause[2])
      );
      if (negate) return vars.map(x => [0 - x]);
      else return [vars];
    } else if (op === "<>") {
      const vars = getComparisonVariables(
        clause[1],
        ...comparisonOperators["="](clause[2])
      );
      if (!negate) return vars.map(x => [0 - x]);
      else return [vars];
    } else if (op === "IS NULL") {
      const v = getIsNullVariable(clause[1]);
      if (negate) return [[0 - v]];
      else return [[v]];
    } else if (op === "IS NOT NULL") {
      const v = getIsNullVariable(clause[1]);
      if (!negate) return [[0 - v]];
      else return [[v]];
    } else {
      throw new Error(`Unknown operator ${op}`);
    }
  }

  const cnf = recursive(filter, false);

  for (let m of mutuallyExclusive.values()) {
    let ar = Array.from(m);
    for (let i = 0; i < ar.length; ++i)
      for (let j = i + 1; j < ar.length; ++j) cnf.push([0 - ar[i], 0 - ar[j]]);
  }

  return { vars: expressions.size, clauses: cnf };
}

exports.booleanCnf = booleanCnf;
