"use strict";

const expressionParser = require("./expression-parser");
const expressionCnf = require("./expression-cnf");
const satSolver = require("./sat-solver");

const isArray = Array.isArray;

function* permute(arr) {
  if (arr.length <= 1) {
    for (let i = 0; i < arr[0]; ++i) yield [i];
    return;
  }

  let slc = arr.slice(1);
  for (let i = 0; i < arr[0]; ++i)
    for (let innerArr of permute(slc)) yield [i].concat(innerArr);
}

function reduce(exp, callback) {
  let loop = true;
  while (loop) {
    loop = false;
    for (let i = 2; i < exp.length; ++i) {
      let res = callback(exp[i - 1], exp[i]);
      if (res !== undefined) {
        loop = true;
        exp = exp.slice();
        exp.splice(i - 1, 2, res);
      }
    }
  }
  if (exp.length === 2) return exp[1];
  return exp;
}

function evaluate(exp, obj, now) {
  return expressionParser.map(exp, e => {
    if (!isArray(e)) return e;

    if (e[0] === "FUNC") {
      if (e[1] === "NOW") {
        if (now) return now;
      } else if (e[1] === "UPPER") {
        if (e[2] == null) return null;
        if (!isArray(e[2])) return `${e[2]}`.toUpperCase();
      } else if (e[1] === "LOWER") {
        if (e[12] == null) return null;
        if (!isArray(e[2])) return `${e[2]}`.toLowerCase();
      }
    } else if (e[0] === "PARAM") {
      if (e[1] == null) return null;
      if (obj && !isArray(e[1])) {
        let v = obj[e[1]];
        if (typeof v === "object") v = v.value ? v.value[0] : null;
        if (v == null) return null;
        return v;
      }
    } else if (e[0] === "AND") {
      return reduce(e, (a, b) => {
        if (!isArray(a)) return a ? b : a;
        if (!isArray(b)) return b ? a : b;
      });
    } else if (e[0] === "OR") {
      return reduce(e, (a, b) => {
        if (!isArray(a)) return a ? a : b;
        if (!isArray(b)) return b ? b : a;
      });
    } else if (e[0] === "NOT") {
      if (!isArray(e[1])) return !e[1];
      else if (e[1][0] === "NOT") return e[1][1];
    } else if (e[0] === "IS NULL") {
      if (isArray(e[1])) return e;
      else if (e[1] == null) return true;
      else return null;
    } else if (e[0] === "IS NOT NULL") {
      if (isArray(e[1])) return e;
      else if (e[1] != null) return true;
      else return null;
    } else if (e[0] === "=") {
      if (isArray(e[1]) || isArray(e[2])) return e;
      if (e[1] == null || e[2] == null) return null;
      return e[1] === e[2];
    } else if (e[0] === "<>") {
      if (isArray(e[1]) || isArray(e[2])) return e;
      if (e[1] == null || e[2] == null) return null;
      return e[1] !== e[2];
    } else if (e[0] === ">") {
      if (isArray(e[1]) || isArray(e[2])) return e;
      if (e[1] == null || e[2] == null) return null;
      return e[1] > e[2];
    } else if (e[0] === ">=") {
      if (isArray(e[1]) || isArray(e[2])) return e;
      if (e[1] == null || e[2] == null) return null;
      return e[1] >= e[2];
    } else if (e[0] === "<") {
      if (isArray(e[1]) || isArray(e[2])) return e;
      if (e[1] == null || e[2] == null) return null;
      return e[1] < e[2];
    } else if (e[0] === "<=") {
      if (isArray(e[1]) || isArray(e[2])) return e;
      if (e[1] == null || e[2] == null) return null;
      return e[1] <= e[2];
    } else if (e[0] === "*") {
      return reduce(e, (a, b) => {
        if (!isArray(a) && !isArray(b)) {
          if (a == null || b == null) return null;
          return a * b;
        }
      });
    } else if (e[0] === "/") {
      return reduce(e, (a, b) => {
        if (!isArray(a) && !isArray(b)) {
          if (a == null || b == null) return null;
          return a / b;
        }
      });
    } else if (e[0] === "+") {
      return reduce(e, (a, b) => {
        if (!isArray(a) && !isArray(b)) {
          if (a == null || b == null) return null;
          return a + b;
        }
      });
    } else if (e[0] === "-") {
      return reduce(e, (a, b) => {
        if (!isArray(a) && !isArray(b)) {
          if (a == null || b == null) return null;
          return a - b;
        }
      });
    } else if (e[0] === "||") {
      return reduce(e, (a, b) => {
        if (!isArray(a) && !isArray(b)) {
          if (a == null || b == null) return null;
          return `${a}${b}`;
        }
      });
    }
    return e;
  });
}

function and(exp1, exp2) {
  if (!isArray(exp1)) return exp1 ? exp2 : exp1;
  if (!isArray(exp2)) return exp2 ? exp1 : exp2;

  let res = ["AND"];

  if (exp1[0] === "AND") res = res.concat(exp1.slice(1));
  else res.push(exp1);

  if (exp2[0] === "AND") res = res.concat(exp2.slice(1));
  else res.push(exp2);

  return res;
}

function or(exp1, exp2) {
  if (!isArray(exp1)) return exp1 ? exp1 : exp2;
  if (!isArray(exp2)) return exp2 ? exp2 : exp1;

  let res = ["OR"];

  if (exp1[0] === "OR") res = res.concat(exp1.slice(1));
  else res.push(exp1);

  if (exp2[0] === "OR") res = res.concat(exp2.slice(1));
  else res.push(exp2);

  return res;
}

function not(exp) {
  if (isArray(exp) && exp[0] === "NOT") return exp[1];
  return ["NOT", exp];
}

function subset(exp1, exp2) {
  const e = evaluate(["NOT", ["OR", ["NOT", exp1], exp2]]);
  if (!isArray(e)) return !e;
  const { vars, clauses } = expressionCnf.booleanCnf(e);
  return !satSolver.naiveDpll(clauses, vars);
}

exports.evaluate = evaluate;
exports.and = and;
exports.or = or;
exports.not = not;
exports.subset = subset;
exports.parse = expressionParser.parse;
exports.stringify = expressionParser.stringify;
