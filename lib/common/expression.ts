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

import { map, mapAsync, parseLikePattern } from "./expression-parser";
import { Expression } from "../types";

const isArray = Array.isArray;

const regExpCache = new WeakMap<any, RegExp>();

const REDUCE_SKIP = {};
function reduce(exp, callback): Expression {
  let loop = true;
  while (loop) {
    loop = false;
    for (let i = 2; i < exp.length; ++i) {
      const res = callback(exp[i - 1], exp[i], i - 2);
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

export function likePatternToRegExp(pat: string, esc = "", flags = ""): RegExp {
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
    "\\_": ".",
  };
  let chars = parseLikePattern(pat, esc);
  if (!chars.length) return new RegExp("^$", flags);
  chars = chars.map((c) => convChars[c] || c);
  chars[0] = chars[0] === ".*" ? "" : "^" + chars[0];
  const l = chars.length - 1;
  chars[l] = [".*", ""].includes(chars[l]) ? "" : chars[l] + "$";
  return new RegExp(chars.join(""), flags);
}

function compare(
  a: boolean | number | string,
  b: boolean | number | string
): number {
  if (typeof a === "boolean") a = +a;
  if (typeof b === "boolean") b = +b;
  if (typeof a !== typeof b) return typeof a === "string" ? 1 : -1;
  return a > b ? 1 : a < b ? -1 : 0;
}

function toNumber(a: boolean | number | string): number {
  switch (typeof a) {
    case "number":
      return a;
    case "boolean":
      return +a;
    case "string":
      return parseFloat(a) || 0;
  }
}

function toString(a: boolean | number | string): string {
  switch (typeof a) {
    case "string":
      return a;
    case "number":
      return a.toString();
    case "boolean":
      return (+a).toString();
  }
}

export function evaluateCallback(exp: Expression): Expression {
  if (!Array.isArray(exp)) return exp;
  if (exp[0] === "CASE") {
    for (let i = 1; i < exp.length; i += 2) {
      if (Array.isArray(exp[i])) return exp;
      if (exp[i]) return exp[i + 1];
    }
    return null;
  } else if (exp[0] === "FUNC") {
    if (exp[1] === "COALESCE") {
      const args: Expression[] = [];
      for (let i = 2; i < exp.length; ++i) {
        const e = exp[i];
        if (e == null) continue;
        args.push(e);
        if (!Array.isArray(e)) break;
      }
      if (!args.length) return null;
      if (args.length === 1) return args[0];
      return ["FUNC", "COALESCE", ...args];
    } else if (exp[1] === "UPPER") {
      if (exp[2] == null) return null;
      if (!isArray(exp[2])) return toString(exp[2]).toUpperCase();
    } else if (exp[1] === "LOWER") {
      if (exp[2] == null) return null;
      if (!isArray(exp[2])) return toString(exp[2]).toLowerCase();
    }
  } else if (exp[0] === "PARAM") {
    if (exp[1] == null) return null;
  } else if (exp[0] === "AND") {
    for (let i = 1; i < exp.length; ++i)
      if (!Array.isArray(exp[i]) && exp[i] != null && !exp[i]) return false;
    const args: Expression[] = [];
    for (let i = 1; i < exp.length; ++i) {
      const ee = exp[i];
      if (ee == null) return null;
      if (Array.isArray(ee)) {
        if (ee[0] === "AND") args.push(...ee.slice(1));
        else args.push(ee);
      }
    }
    if (!args.length) return true;
    if (args.length === 1) args.push(true);
    return ["AND", ...args];
  } else if (exp[0] === "OR") {
    const args: Expression[] = [];
    for (let i = 1; i < exp.length; ++i) {
      const ee = exp[i];
      if (Array.isArray(ee)) {
        if (ee[0] === "OR") args.push(...ee.slice(1));
        else args.push(ee);
      } else if (ee) {
        return true;
      }
    }
    if (!args.length) return exp.some((ee) => ee == null) ? null : false;
    if (args.length === 1) args.push(false);
    return ["OR", ...args];
  } else if (exp[0] === "NOT") {
    if (exp[1] == null) return null;
    if (!isArray(exp[1])) return !exp[1];
    else if (exp[1][0] === "NOT") return exp[1][1];
  } else if (exp[0] === "IS NULL") {
    if (isArray(exp[1])) return exp;
    else if (exp[1] == null) return true;
    else return null;
  } else if (exp[0] === "IS NOT NULL") {
    if (isArray(exp[1])) return exp;
    else if (exp[1] != null) return true;
    else return null;
  } else if (exp[0] === "LIKE") {
    if (isArray(exp[1]) || isArray(exp[2]) || isArray(exp[3])) return exp;
    else if (
      exp[1] == null ||
      exp[2] == null ||
      ((exp as any[]).length >= 4 && exp[3] == null)
    )
      return null;
    let r = regExpCache.get(exp as any[]);
    if (!r) {
      r = likePatternToRegExp(exp[2], exp[3]);
      regExpCache.set(exp as any[], r);
    }
    return r.test(exp[1]);
  } else if (exp[0] === "NOT LIKE") {
    if (isArray(exp[1]) || isArray(exp[2]) || isArray(exp[3])) return exp;
    else if (
      exp[1] == null ||
      exp[2] == null ||
      ((exp as any[]).length >= 4 && exp[3] == null)
    )
      return null;
    let r = regExpCache.get(exp as any[]);
    if (!r) {
      r = likePatternToRegExp(exp[2], exp[3]);
      regExpCache.set(exp as any[], r);
    }
    return !r.test(exp[1]);
  } else if (exp[0] === "=") {
    if (exp[1] == null || exp[2] == null) return null;
    if (isArray(exp[1]) || isArray(exp[2])) return exp;
    return compare(exp[1], exp[2]) === 0;
  } else if (exp[0] === "<>") {
    if (exp[1] == null || exp[2] == null) return null;
    if (isArray(exp[1]) || isArray(exp[2])) return exp;
    return compare(exp[1], exp[2]) !== 0;
  } else if (exp[0] === ">") {
    if (exp[1] == null || exp[2] == null) return null;
    if (isArray(exp[1]) || isArray(exp[2])) return exp;
    return compare(exp[1], exp[2]) > 0;
  } else if (exp[0] === ">=") {
    if (exp[1] == null || exp[2] == null) return null;
    if (isArray(exp[1]) || isArray(exp[2])) return exp;
    return compare(exp[1], exp[2]) >= 0;
  } else if (exp[0] === "<") {
    if (exp[1] == null || exp[2] == null) return null;
    if (isArray(exp[1]) || isArray(exp[2])) return exp;
    return compare(exp[1], exp[2]) < 0;
  } else if (exp[0] === "<=") {
    if (exp[1] == null || exp[2] == null) return null;
    if (isArray(exp[1]) || isArray(exp[2])) return exp;
    return compare(exp[1], exp[2]) <= 0;
  } else if (exp[0] === "*") {
    return reduce(exp, (a, b) => {
      if (a == null || b == null) return null;
      if (!isArray(a) && !isArray(b)) return toNumber(a) * toNumber(b);
      return REDUCE_SKIP;
    });
  } else if (exp[0] === "/") {
    return reduce(exp, (a, b, i) => {
      if (a == null || b == null) return null;
      if (!isArray(a) && !isArray(b))
        return i === 0 ? toNumber(a) / toNumber(b) : toNumber(a) * toNumber(b);
      return REDUCE_SKIP;
    });
  } else if (exp[0] === "+") {
    return reduce(exp, (a, b) => {
      if (a == null || b == null) return null;
      if (!isArray(a) && !isArray(b)) return toNumber(a) + toNumber(b);
      return REDUCE_SKIP;
    });
  } else if (exp[0] === "-") {
    return reduce(exp, (a, b, i) => {
      if (a == null || b == null) return null;
      if (!isArray(a) && !isArray(b))
        return i === 0 ? toNumber(a) - toNumber(b) : toNumber(a) + toNumber(b);
      return REDUCE_SKIP;
    });
  } else if (exp[0] === "||") {
    return reduce(exp, (a, b) => {
      if (a == null || b == null) return null;
      if (!isArray(a) && !isArray(b)) return toString(a) + toString(b);
      return REDUCE_SKIP;
    });
  }
  return exp;
}

export function evaluate(
  exp: Expression,
  obj: Record<string, unknown> | ((e: string) => Expression),
  now: number,
  cb?: (e: Expression) => Expression
): string | number | boolean | null;
export function evaluate(
  exp: Expression,
  obj?: Record<string, unknown> | ((e: string) => Expression),
  now?: number,
  cb?: (e: Expression) => Expression
): Expression;
export function evaluate(
  exp: Expression,
  obj?: Record<string, unknown> | ((e: string) => Expression),
  now?: number,
  cb?: (e: Expression) => Expression
): Expression {
  return map(exp, (e) => {
    if (cb) e = cb(e);
    if (!isArray(e)) return e;

    if (e[0] === "FUNC" && e[1] === "NOW") {
      if (now) return now;
    } else if (e[0] === "PARAM") {
      if (e[1] == null) return null;
      if (obj && !isArray(e[1])) {
        let v;
        if (typeof obj === "function") v = obj(e[1]);
        else v = obj[e[1]];

        if (v == null) return null;
        if (typeof v === "object") v = v.value ? v.value[0] : null;
        return v;
      }
    }
    return evaluateCallback(e);
  });
}

export async function evaluateAsync(
  exp: Expression,
  obj: Record<string, unknown>,
  now: number,
  cb?: (e: Expression) => Promise<Expression>
): Promise<string | number | boolean | null>;
export async function evaluateAsync(
  exp: Expression,
  obj?: Record<string, unknown>,
  now?: number,
  cb?: (e: Expression) => Promise<Expression>
): Promise<Expression>;
export async function evaluateAsync(
  exp: Expression,
  obj?: Record<string, unknown>,
  now?: number,
  cb?: (e: Expression) => Promise<Expression>
): Promise<Expression> {
  return mapAsync(exp, async (e) => {
    if (cb) e = await cb(e);
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
        if (typeof v === "object") v = v["value"] ? v["value"][0] : null;
        return v as Expression;
      }
    }
    return evaluateCallback(e);
  });
}

export function and(exp1: Expression, exp2: Expression): Expression {
  if (exp1 != null && !exp1) return false;
  if (exp2 != null && !exp2) return false;
  if (!Array.isArray(exp1) && !Array.isArray(exp2)) {
    if (exp1 == null || exp2 == null) return null;
    return true;
  }
  if (!Array.isArray(exp2) && exp1[0] === "AND") return exp1;
  if (!Array.isArray(exp1) && exp2[0] === "AND") return exp2;

  const res: Expression = ["AND"];

  if (Array.isArray(exp1) && exp1[0] === "AND") res.push(...exp1.slice(1));
  else res.push(exp1);

  if (Array.isArray(exp2) && exp2[0] === "AND") res.push(...exp2.slice(1));
  else res.push(exp2);

  return res;
}

export function or(exp1: Expression, exp2: Expression): Expression {
  if (!Array.isArray(exp1) && exp1) return true;
  if (!Array.isArray(exp2) && exp2) return true;
  if (!Array.isArray(exp1) && !Array.isArray(exp2)) {
    if (exp1 == null || exp2 == null) return null;
    return false;
  }
  if (!Array.isArray(exp2) && exp1[0] === "OR") return exp1;
  if (!Array.isArray(exp1) && exp2[0] === "OR") return exp2;

  const res: Expression = ["OR"];

  if (Array.isArray(exp1) && exp1[0] === "OR") res.push(...exp1.slice(1));
  else res.push(exp1);

  if (Array.isArray(exp2) && exp2[0] === "OR") res.push(...exp2.slice(1));
  else res.push(exp2);

  return res;
}

export function extractParams(exp: Expression): Expression[] {
  const params = new Set<Expression>();
  map(exp, (e) => {
    if (isArray(e) && e[0] === "PARAM") params.add(e[1]);
    return e;
  });
  return Array.from(params);
}
