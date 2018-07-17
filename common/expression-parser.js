"use strict";

const parsimmon = require("parsimmon");

// Turn escaped characters into real ones (e.g. "\\n" becomes "\n").
function interpretEscapes(str) {
  let escapes = {
    b: "\b",
    f: "\f",
    n: "\n",
    r: "\r",
    t: "\t"
  };
  return str.replace(/\\(u[0-9a-fA-F]{4}|[^u])/, (_, escape) => {
    let type = escape.charAt(0);
    let hex = escape.slice(1);
    if (type === "u") return String.fromCharCode(parseInt(hex, 16));

    if (escapes.hasOwnProperty(type)) return escapes[type];

    return type;
  });
}

function map(exp, callback) {
  if (!Array.isArray(exp)) return callback(exp);

  let clone;
  for (let i = 1; i < exp.length; ++i) {
    let sub = map(exp[i], callback);
    if (sub !== exp[i]) {
      clone = clone || exp.slice();
      clone[i] = sub;
    }
  }

  return callback(clone || exp);
}

function binaryLeft(operatorsParser, nextParser) {
  return parsimmon.seqMap(
    nextParser,
    parsimmon.seq(operatorsParser, nextParser).many(),
    (first, rest) =>
      rest.reduce((acc, ch) => {
        let [op, another] = ch;
        if (Array.isArray(acc) && op === acc[0]) return acc.concat([another]);
        if (Array.isArray(another) && op === another[0])
          return [op, acc].concat(another.slice(1));
        return [op, acc, another];
      }, first)
  );
}

const lang = parsimmon.createLanguage({
  ComparisonOperator: function() {
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
  IsNullOperator: function() {
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
  NotOperator: function() {
    return parsimmon
      .regexp(/not/i)
      .result("NOT")
      .notFollowedBy(parsimmon.regexp(/[a-zA-Z0-9_]/))
      .skip(parsimmon.optWhitespace)
      .desc("NOT");
  },
  AndOperator: function() {
    return parsimmon
      .regexp(/and/i)
      .result("AND")
      .notFollowedBy(parsimmon.regexp(/[a-zA-Z0-9_]/))
      .skip(parsimmon.optWhitespace)
      .desc("AND");
  },
  OrOperator: function() {
    return parsimmon
      .regexp(/or/i)
      .result("OR")
      .notFollowedBy(parsimmon.regexp(/[a-zA-Z0-9_]/))
      .skip(parsimmon.optWhitespace)
      .desc("OR");
  },
  Parameter: function(r) {
    return parsimmon
      .alt(
        parsimmon.regexp(/[a-zA-Z0-9_.*]+/),
        r.Expression.wrap(
          parsimmon.string("{").skip(parsimmon.optWhitespace),
          parsimmon.string("}")
        )
      )
      .atLeast(1)
      .map(x => ["PARAM", x.length > 1 ? ["||"].concat(x) : x[0]])
      .skip(parsimmon.optWhitespace)
      .desc("parameter");
  },
  StringValueSql: function() {
    return parsimmon
      .regexp(/'([^']*)'/, 1)
      .atLeast(1)
      .skip(parsimmon.optWhitespace)
      .map(s => s.join("'"))
      .desc("string");
  },
  StringValueJs: function() {
    return parsimmon
      .regexp(/"((?:\\.|.)*?)"/, 1)
      .skip(parsimmon.optWhitespace)
      .map(interpretEscapes)
      .desc("string");
  },
  NumberValue: function() {
    return parsimmon
      .regexp(/-?(0|[1-9][0-9]*)([.][0-9]+)?([eE][+-]?[0-9]+)?/)
      .skip(parsimmon.optWhitespace)
      .map(Number)
      .desc("number");
  },
  BooleanValue: function() {
    return parsimmon
      .alt(
        parsimmon
          .regexp(/true/i)
          .result(true)
          .desc("TRUE"),
        parsimmon
          .regexp(/false/i)
          .result(false)
          .desc("FALSE")
      )
      .notFollowedBy(parsimmon.regexp(/[a-zA-Z0-9_]/))
      .skip(parsimmon.optWhitespace);
  },
  NullValue: function() {
    return parsimmon
      .regexp(/null/i)
      .notFollowedBy(parsimmon.regexp(/[a-zA-Z0-9_]/))
      .skip(parsimmon.optWhitespace)
      .result(null)
      .desc("NULL");
  },
  FuncValue: function(r) {
    return parsimmon.seqMap(
      parsimmon
        .regexp(/([a-zA-Z0-9_]+)/, 1)
        .skip(parsimmon.optWhitespace)
        .desc("function"),
      r.ValueExpression.sepBy(
        parsimmon.string(",").skip(parsimmon.optWhitespace)
      ).wrap(
        parsimmon.string("(").skip(parsimmon.optWhitespace),
        parsimmon.string(")").skip(parsimmon.optWhitespace)
      ),
      (f, args) => ["FUNC", f.toUpperCase()].concat(args)
    );
  },
  Value: function(r) {
    return parsimmon.alt(
      r.NullValue,
      r.BooleanValue,
      r.NumberValue,
      r.StringValueSql,
      r.StringValueJs,
      r.FuncValue
    );
  },
  ValueExpression: function(r) {
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
  Comparison: function(r) {
    return parsimmon.alt(
      parsimmon.seqMap(r.Parameter, r.IsNullOperator, (p, o) => [o, p]),
      parsimmon.seqMap(
        r.ValueExpression,
        r.ComparisonOperator,
        r.ValueExpression,
        (p, o, v) => [o, p, v]
      )
    );
  },
  Expression: function(r) {
    function unary(operatorsParser, nextParser) {
      return parsimmon.seq(operatorsParser, nextParser).or(nextParser);
    }

    return binaryLeft(
      r.OrOperator,
      binaryLeft(
        r.AndOperator,
        unary(r.NotOperator, r.Comparison.or(r.ValueExpression))
      )
    ).trim(parsimmon.optWhitespace);
  }
});

function parse(str) {
  if (!str) return null;
  return lang.Expression.tryParse(str);
}

function stringify(exp) {
  if (!Array.isArray(exp)) return JSON.stringify(exp);

  const opLevels = {
    OR: 10,
    AND: 11,
    NOT: 12,
    "=": 20,
    "<>": 21,
    ">": 22,
    ">=": 23,
    "<": 24,
    "<=": 25,
    "||": 30,
    "+": 31,
    "-": 31,
    "*": 32,
    "/": 32
  };

  const op = exp[0].toUpperCase();

  if (op === "FUNC") {
    return `${exp[1]}(${exp
      .slice(2)
      .map(e => stringify(e))
      .join(", ")})`;
  } else if (op === "PARAM") {
    if (typeof exp[1] === "string") return exp[1];
    else if (Array.isArray(exp[1]) && exp[1][0] === "||")
      return exp[1]
        .slice(1)
        .map(p => {
          if (typeof p === "string") return p;
          else return `{${stringify(p)}}`;
        })
        .join("");
    else return `{${stringify(exp[1])}}`;
  } else if (op === "IS NULL" || op === "IS NOT NULL") {
    return `${stringify(exp[1])} ${op}`;
  } else if (op in opLevels) {
    const parts = exp.slice(1).map((e, i) => {
      if (
        Array.isArray(e) &&
        (opLevels[e[0]] < opLevels[exp[0]] ||
          (opLevels[e[0]] < opLevels[exp[0]] && i > 0) ||
          (opLevels[exp[0]] >= 20 &&
            opLevels[e[0]] >= 20 &&
            opLevels[e[0]] < 30))
      )
        return `(${stringify(e)})`;
      else return stringify(e);
    });

    if (op === "NOT") return `${op} ${parts[0]}`;
    else return parts.join(` ${op} `);
  } else {
    throw new Error(`Unrecognized operator ${exp[0]}`);
  }
}

exports.parse = parse;
exports.stringify = stringify;
exports.map = map;
