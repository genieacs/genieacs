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

import parsimmon from "parsimmon";
import { Expression } from "../types";

// Turn escaped characters into real ones (e.g. "\\n" becomes "\n").
function interpretEscapes(str): string {
  const escapes = {
    b: "\b",
    f: "\f",
    n: "\n",
    r: "\r",
    t: "\t",
  };
  return str.replace(/\\(u[0-9a-fA-F]{4}|[^u])/, (_, escape) => {
    const type = escape.charAt(0);
    const hex = escape.slice(1);
    if (type === "u") return String.fromCharCode(parseInt(hex, 16));

    if (escapes.hasOwnProperty(type)) return escapes[type];

    return type;
  });
}

export function map(
  exp: Expression,
  callback: (e: Expression) => Expression
): Expression {
  if (!Array.isArray(exp)) return callback(exp);

  let clone;
  for (let i = 1; i < exp.length; ++i) {
    const sub = map(exp[i], callback);
    if (sub !== exp[i]) {
      clone = clone || exp.slice();
      clone[i] = sub;
    }
  }

  return callback(clone || exp);
}

export async function mapAsync(
  exp: Expression,
  callback: (e: Expression) => Promise<Expression>
): Promise<Expression> {
  if (!Array.isArray(exp)) return callback(exp);

  let clone;
  for (let i = 1; i < exp.length; ++i) {
    const sub = await mapAsync(exp[i], callback);
    if (sub !== exp[i]) {
      clone = clone || exp.slice();
      clone[i] = sub;
    }
  }

  return callback(clone || exp);
}

function binaryLeft(
  operatorsParser: parsimmon.Parser<string>,
  nextParser: parsimmon.Parser<Expression>
): parsimmon.Parser<Expression> {
  return parsimmon.seqMap(
    nextParser,
    parsimmon.seq(operatorsParser, nextParser).many(),
    (first, rest) =>
      rest.reduce((acc, ch) => {
        const [op, another] = ch;
        if (Array.isArray(acc) && op === acc[0]) return acc.concat([another]);
        if (Array.isArray(another) && op === another[0])
          return [op, acc].concat(another.slice(1));
        return [op, acc, another];
      }, first)
  );
}

const lang = parsimmon.createLanguage({
  ComparisonOperator: function () {
    return parsimmon
      .alt(
        parsimmon.string(">="),
        parsimmon.string("<>"),
        parsimmon.string("<="),
        parsimmon.string("="),
        parsimmon.string(">"),
        parsimmon.string("<")
      )
      .skip(parsimmon.optWhitespace);
  },
  LikeOperator: function () {
    return parsimmon
      .alt(
        parsimmon.regexp(/like/i).result("LIKE").desc("LIKE"),
        parsimmon
          .regexp(/not\s+like/i)
          .result("NOT LIKE")
          .desc("NOT LIKE")
      )
      .notFollowedBy(parsimmon.regexp(/[a-zA-Z0-9_]/))
      .skip(parsimmon.optWhitespace);
  },
  IsNullOperator: function () {
    return parsimmon
      .alt(
        parsimmon
          .regexp(/is\s+null/i)
          .result("IS NULL")
          .desc("IS NULL"),
        parsimmon
          .regexp(/is\s+not\s+null/i)
          .result("IS NOT NULL")
          .desc("IS NOT NULL")
      )
      .notFollowedBy(parsimmon.regexp(/[a-zA-Z0-9_]/))
      .skip(parsimmon.optWhitespace);
  },
  NotOperator: function () {
    return parsimmon
      .regexp(/not/i)
      .result("NOT")
      .notFollowedBy(parsimmon.regexp(/[a-zA-Z0-9_]/))
      .skip(parsimmon.optWhitespace)
      .desc("NOT");
  },
  AndOperator: function () {
    return parsimmon
      .regexp(/and/i)
      .result("AND")
      .notFollowedBy(parsimmon.regexp(/[a-zA-Z0-9_]/))
      .skip(parsimmon.optWhitespace)
      .desc("AND");
  },
  OrOperator: function () {
    return parsimmon
      .regexp(/or/i)
      .result("OR")
      .notFollowedBy(parsimmon.regexp(/[a-zA-Z0-9_]/))
      .skip(parsimmon.optWhitespace)
      .desc("OR");
  },
  Parameter: function (r) {
    return parsimmon
      .alt(
        parsimmon.regexp(/[a-zA-Z0-9_.*-]+/),
        r.Expression.wrap(
          parsimmon.string("{").skip(parsimmon.optWhitespace),
          parsimmon.string("}")
        )
      )
      .atLeast(1)
      .map((x) => ["PARAM", x.length > 1 ? ["||"].concat(x) : x[0]])
      .skip(parsimmon.optWhitespace)
      .desc("parameter");
  },
  StringValueSql: function () {
    return parsimmon
      .regexp(/'([^']*)'/, 1)
      .atLeast(1)
      .skip(parsimmon.optWhitespace)
      .map((s) => s.join("'"))
      .desc("string");
  },
  StringValueJs: function () {
    return parsimmon
      .regexp(/"((?:\\.|.)*?)"/, 1)
      .skip(parsimmon.optWhitespace)
      .map(interpretEscapes)
      .desc("string");
  },
  NumberValue: function () {
    return parsimmon
      .regexp(/-?(0|[1-9][0-9]*)([.][0-9]+)?([eE][+-]?[0-9]+)?/)
      .notFollowedBy(parsimmon.regexp(/[a-zA-Z0-9_]/))
      .skip(parsimmon.optWhitespace)
      .map(Number)
      .desc("number");
  },
  BooleanValue: function () {
    return parsimmon
      .alt(
        parsimmon.regexp(/true/i).result(true).desc("TRUE"),
        parsimmon.regexp(/false/i).result(false).desc("FALSE")
      )
      .notFollowedBy(parsimmon.regexp(/[a-zA-Z0-9_]/))
      .skip(parsimmon.optWhitespace);
  },
  NullValue: function () {
    return parsimmon
      .regexp(/null/i)
      .notFollowedBy(parsimmon.regexp(/[a-zA-Z0-9_]/))
      .skip(parsimmon.optWhitespace)
      .result(null)
      .desc("NULL");
  },
  FuncValue: function (r) {
    return parsimmon.seqMap(
      parsimmon
        .regexp(/([a-zA-Z0-9_]+)/, 1)
        .skip(parsimmon.optWhitespace)
        .desc("function"),
      r.ExpressionList.wrap(
        parsimmon.string("(").skip(parsimmon.optWhitespace),
        parsimmon.string(")").skip(parsimmon.optWhitespace)
      ),
      (f, args) => ["FUNC", f.toUpperCase()].concat(args)
    );
  },
  WhenPair: function (r) {
    return parsimmon.seq(
      parsimmon
        .regexp(/when/i)
        .notFollowedBy(parsimmon.regexp(/[a-zA-Z0-9_]/))
        .skip(parsimmon.optWhitespace)
        .desc("WHEN")
        .then(r.Expression),
      parsimmon
        .regexp(/then/i)
        .notFollowedBy(parsimmon.regexp(/[a-zA-Z0-9_]/))
        .skip(parsimmon.optWhitespace)
        .desc("THEN")
        .then(r.Expression)
    );
  },
  CaseStatement: function (r) {
    return parsimmon.seqMap(
      parsimmon
        .regexp(/case/i)
        .result("CASE")
        .notFollowedBy(parsimmon.regexp(/[a-zA-Z0-9_]/))
        .skip(parsimmon.optWhitespace)
        .desc("CASE"),
      r.WhenPair.many(),
      parsimmon
        .regexp(/else/i)
        .notFollowedBy(parsimmon.regexp(/[a-zA-Z0-9_]/))
        .skip(parsimmon.optWhitespace)
        .desc("ELSE")
        .then(r.Expression)
        .map((e) => [[true, e]])
        .fallback(null)
        .skip(
          parsimmon
            .regex(/end/i)
            .notFollowedBy(parsimmon.regexp(/[a-zA-Z0-9_]/))
        )
        .skip(parsimmon.optWhitespace),
      (...arr) => arr.flat(2)
    );
  },
  Value: function (r) {
    return parsimmon.alt(
      r.NullValue,
      r.BooleanValue,
      r.NumberValue,
      r.StringValueSql,
      r.StringValueJs,
      r.FuncValue,
      r.CaseStatement
    );
  },
  ValueExpression: function (r) {
    return binaryLeft(
      parsimmon.string("||").skip(parsimmon.optWhitespace),
      binaryLeft(
        parsimmon
          .alt(parsimmon.string("+"), parsimmon.string("-"))
          .skip(parsimmon.optWhitespace),
        binaryLeft(
          parsimmon
            .alt(parsimmon.string("*"), parsimmon.string("/"))
            .skip(parsimmon.optWhitespace),
          parsimmon.alt(
            r.Value,
            r.Parameter,
            r.Expression.wrap(
              parsimmon.string("(").skip(parsimmon.optWhitespace),
              parsimmon.string(")").skip(parsimmon.optWhitespace)
            )
          )
        )
      )
    );
  },
  Comparison: function (r) {
    return parsimmon.alt(
      parsimmon.seqMap(r.ValueExpression, r.IsNullOperator, (p, o) => [o, p]),
      parsimmon.seqMap(
        r.ValueExpression,
        r.ComparisonOperator,
        r.ValueExpression,
        (p, o, v) => [o, p, v]
      ),
      parsimmon.seqMap(
        r.ValueExpression,
        r.LikeOperator,
        r.ValueExpression.skip(
          parsimmon
            .regexp(/escape/i)
            .result("ESCAPE")
            .skip(parsimmon.whitespace)
            .desc("ESCAPE")
        ),
        r.ValueExpression,
        (a, b, c, d) => [b, a, c, d]
      ),
      parsimmon.seqMap(
        r.ValueExpression,
        r.LikeOperator,
        r.ValueExpression,
        (a, b, c) => [b, a, c]
      )
    );
  },
  ExpressionList: function (r) {
    return r.Expression.sepBy(
      parsimmon.string(",").skip(parsimmon.optWhitespace)
    );
  },
  Expression: function (r) {
    function unary(
      operatorsParser: parsimmon.Parser<string>,
      nextParser: parsimmon.Parser<Expression>
    ): parsimmon.Parser<Expression> {
      return parsimmon.seq(operatorsParser, nextParser).or(nextParser);
    }

    return binaryLeft(
      r.OrOperator,
      binaryLeft(
        r.AndOperator,
        unary(r.NotOperator, r.Comparison.or(r.ValueExpression))
      )
    ).trim(parsimmon.optWhitespace);
  },
});

export function parse(str: string): Expression {
  if (!str) return null;
  return lang.Expression.tryParse(str);
}

export function parseList(str: string): Expression[] {
  if (!str) return [];
  return lang.ExpressionList.tryParse(str);
}

export function stringify(exp: Expression, level = 0): string {
  if (!Array.isArray(exp)) return JSON.stringify(exp);

  const opLevels = {
    OR: 10,
    AND: 11,
    NOT: 12,
    "=": 20,
    "<>": 20,
    ">": 20,
    ">=": 20,
    "<": 20,
    "<=": 20,
    LIKE: 20,
    "NOT LIKE": 20,
    "IS NULL": 20,
    "IS NOT NULL": 20,
    "||": 30,
    "+": 31,
    "-": 31,
    "*": 32,
    "/": 32,
  };

  const op = exp[0].toUpperCase();

  function wrap(e): string {
    if (opLevels[op] <= level) return `(${e})`;
    else return e;
  }

  if (op === "FUNC") {
    return wrap(
      `${exp[1]}(${exp
        .slice(2)
        .map((e) => stringify(e))
        .join(", ")})`
    );
  } else if (op === "PARAM") {
    if (typeof exp[1] === "string") {
      return wrap(exp[1]);
    } else if (Array.isArray(exp[1]) && exp[1][0] === "||") {
      return wrap(
        exp[1]
          .slice(1)
          .map((p) => {
            if (typeof p === "string") return p;
            else return `{${stringify(p)}}`;
          })
          .join("")
      );
    } else {
      return wrap(`{${stringify(exp[1])}}`);
    }
  } else if (op === "IS NULL" || op === "IS NOT NULL") {
    return wrap(`${stringify(exp[1], opLevels[op])} ${op}`);
  } else if (op === "LIKE" || op === "NOT LIKE") {
    if (exp[3]) {
      return wrap(
        `${stringify(exp[1], opLevels[op])} ${op} ${stringify(
          exp[2],
          opLevels[op]
        )} ESCAPE ${stringify(exp[3], opLevels[op])}`
      );
    } else {
      return wrap(
        `${stringify(exp[1], opLevels[op])} ${op} ${stringify(
          exp[2],
          opLevels[op]
        )}`
      );
    }
  } else if (op === "CASE") {
    const parts: string[] = ["CASE"];
    for (let i = 1; i < exp.length - 1; i += 2) {
      if (!Array.isArray(exp[i]) && exp[i]) {
        if (exp[i + 1] != null) parts.push("ELSE", stringify(exp[i + 1]));
        break;
      }
      parts.push("WHEN", stringify(exp[i]), "THEN", stringify(exp[i + 1]));
    }
    parts.push("END");
    return parts.join(" ");
  } else if (op in opLevels) {
    const parts = exp.slice(1).map((e, i) => {
      return stringify(e, opLevels[exp[0]] + Math.min(i - 1, 0));
    });

    if (op === "NOT") return wrap(`${op} ${parts[0]}`);
    else return wrap(parts.join(` ${op} `));
  } else {
    throw new Error(`Unrecognized operator ${exp[0]}`);
  }
}

export function parseLikePattern(pat: string, esc: string): string[] {
  const chars = pat.split("");

  for (let i = 0; i < chars.length; ++i) {
    const c = chars[i];
    if (c === esc) {
      chars[i] = chars[i + 1] || "";
      chars[i + 1] = "";
    } else if (c === "_") {
      chars[i] = "\\_";
    } else if (c === "%") {
      chars[i] = "\\%";
      while (chars[i + 1] === "%") chars[++i] = "";
    }
  }
  return chars.filter((c) => c);
}
