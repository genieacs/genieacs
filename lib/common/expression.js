"use strict";

const expressionParser = require("./expression-parser");
const expressionCnf = require("./expression-cnf");
const satSolver = require("./sat-solver");

const isArray = Array.isArray;

const regExpCache = new WeakMap();

const REDUCE_SKIP = {};
function reduce(exp, callback) {
  let loop = true;
  while (loop) {
    loop = false;
    for (let i = 2; i < exp.length; ++i) {
      const res = callback(exp[i - 1], exp[i]);
      if (res !== REDUCE_SKIP) {
        loop = true;
        exp = exp.slice();
        exp.splice(i - 1, 2, res);
      }
    }
  }
  if (exp.length === 2) return exp[1];
  return exp;
}

function evaluate(exp, obj, now, cb) {
  function getRegExp(pat, esc) {
    const k = `${esc || ""}:${pat}`;
    let c = regExpCache.get(exp);
    if (!c) regExpCache.set(exp, (c = {}));
    if (!c[k]) c[k] = likePatternToRegExp(pat, esc);
    return c[k];
  }

  return expressionParser.map(exp, e => {
    if (cb) e = cb(e);
    if (!isArray(e)) return e;

    if (e[0] === "FUNC") {
      if (e[1] === "NOW") {
        if (now) return now;
      } else if (e[1] === "UPPER") {
        if (e[2] == null) return null;
        if (!isArray(e[2])) return `${e[2]}`.toUpperCase();
      } else if (e[1] === "LOWER") {
        if (e[2] == null) return null;
        if (!isArray(e[2])) return `${e[2]}`.toLowerCase();
      }
    } else if (e[0] === "PARAM") {
      if (e[1] == null) return null;
      if (obj && !isArray(e[1])) {
        let v = obj[e[1]];
        if (v == null) return null;
        if (typeof v === "object") v = v.value ? v.value[0] : null;
        return v;
      }
    } else if (e[0] === "AND") {
      return reduce(e, (a, b) => {
        if (!isArray(a)) return a ? b : a;
        if (!isArray(b)) return b ? a : b;
        return REDUCE_SKIP;
      });
    } else if (e[0] === "OR") {
      return reduce(e, (a, b) => {
        if (!isArray(a)) return a ? a : b;
        if (!isArray(b)) return b ? b : a;
        return REDUCE_SKIP;
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
    } else if (e[0] === "LIKE") {
      if (isArray(e[1]) || isArray(e[2]) || isArray(e[3])) return e;
      else if (e[1] == null || e[2] == null || (e.length >= 4 && e[3] == null))
        return null;

      const r = getRegExp(e[2], e[3]);
      return r.test(e[1]);
    } else if (e[0] === "NOT LIKE") {
      if (isArray(e[1]) || isArray(e[2]) || isArray(e[3])) return e;
      else if (e[1] == null || e[2] == null || (e.length >= 4 && e[3] == null))
        return null;
      const r = getRegExp(e[2], e[3]);
      return !r.test(e[1]);
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
        return REDUCE_SKIP;
      });
    } else if (e[0] === "/") {
      return reduce(e, (a, b) => {
        if (!isArray(a) && !isArray(b)) {
          if (a == null || b == null) return null;
          return a / b;
        }
        return REDUCE_SKIP;
      });
    } else if (e[0] === "+") {
      return reduce(e, (a, b) => {
        if (!isArray(a) && !isArray(b)) {
          if (a == null || b == null) return null;
          return a + b;
        }
        return REDUCE_SKIP;
      });
    } else if (e[0] === "-") {
      return reduce(e, (a, b) => {
        if (!isArray(a) && !isArray(b)) {
          if (a == null || b == null) return null;
          return a - b;
        }
        return REDUCE_SKIP;
      });
    } else if (e[0] === "||") {
      return reduce(e, (a, b) => {
        if (!isArray(a) && !isArray(b)) {
          if (a == null || b == null) return null;
          return `${a}${b}`;
        }
        return REDUCE_SKIP;
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

function likePatternToRegExp(pat, esc = "", flags = "") {
  const convChars = {
    "-": "\\-",
    "/": "\\/",
    "\\": "\\/",
    "^": "\\^",
    $: "\\$",
    "*": "\\*",
    "+": "\\+",
    "?": "\\?",
    ".": "\\.",
    "(": "\\(",
    ")": "\\)",
    "|": "\\|",
    "[": "\\[",
    "]": "\\]",
    "{": "\\{",
    "}": "\\}",
    "\\%": ".*",
    "\\_": "."
  };
  let chars = expressionParser.parseLikePattern(pat, esc);
  if (!chars.length) return new RegExp("^$", flags);
  chars = chars.map(c => convChars[c] || c);
  chars[0] = chars[0] === ".*" ? "" : "^" + chars[0];
  const l = chars.length - 1;
  chars[l] = [".*", ""].includes(chars[l]) ? "" : chars[l] + "$";
  return new RegExp(chars.join(""), flags);
}

function extractParams(exp) {
  const params = new Set();
  expressionParser.map(exp, e => {
    if (isArray(e) && e[0] === "PARAM") params.add(e[1]);
    return e;
  });
  return Array.from(params);
}

exports.evaluate = evaluate;
exports.and = and;
exports.or = or;
exports.not = not;
exports.subset = subset;
exports.parse = expressionParser.parse;
exports.stringify = expressionParser.stringify;
exports.likePatternToRegExp = likePatternToRegExp;
exports.extractParams = extractParams;
