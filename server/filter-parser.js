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

const lang = parsimmon.createLanguage({
  ComparisonOperator: function(r) {
    return parsimmon
      .alt(
        parsimmon.string(">="),
        parsimmon.string("<>"),
        parsimmon.string("<="),
        parsimmon.string("="),
        parsimmon.string(">"),
        parsimmon.string("<")
      )
      .skip(r._);
  },
  IsNullOperator: function(r) {
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
      .skip(r._);
  },
  NotOperator: function(r) {
    return parsimmon
      .regexp(/not/i)
      .result("NOT")
      .skip(r._)
      .desc("NOT");
  },
  AndOperator: function(r) {
    return parsimmon
      .regexp(/and/i)
      .result("AND")
      .skip(r._)
      .desc("AND");
  },
  OrOperator: function(r) {
    return parsimmon
      .regexp(/or/i)
      .result("OR")
      .skip(r._)
      .desc("OR");
  },
  Parameter: function(r) {
    return parsimmon
      .regexp(/[a-zA-Z0-9_.*]+/)
      .skip(r._)
      .desc("parameter");
  },
  StringValueSql: function(r) {
    return parsimmon
      .regexp(/'([^']*)'/, 1)
      .atLeast(1)
      .skip(r._)
      .map(s => s.join("'"))
      .desc("string");
  },
  StringValueJs: function(r) {
    return parsimmon
      .regexp(/"((?:\\.|.)*?)"/, 1)
      .skip(r._)
      .map(interpretEscapes)
      .desc("string");
  },
  NumberValue: function(r) {
    return parsimmon
      .regexp(/-?(0|[1-9][0-9]*)([.][0-9]+)?([eE][+-]?[0-9]+)?/)
      .skip(r._)
      .map(Number)
      .desc("number");
  },
  FuncValue: function(r) {
    return parsimmon.seqMap(
      parsimmon
        .regexp(/([a-zA-Z0-0_]+)/, 1)
        .skip(r._)
        .desc("function"),
      r.Value.sepBy(parsimmon.string(",").skip(r._)).wrap(
        parsimmon.string("(").skip(r._),
        parsimmon.string(")").skip(r._)
      ),
      (f, args) => ["FUNC", f.toUpperCase()].concat(args)
    );
  },
  Value: function(r) {
    return parsimmon.alt(
      r.NumberValue,
      r.StringValueSql,
      r.StringValueJs,
      r.FuncValue
    );
  },
  Comparison: function(r) {
    return parsimmon.alt(
      parsimmon.seqMap(r.Parameter, r.IsNullOperator, (p, o) => [o, p]),
      parsimmon.seqMap(
        r.Parameter,
        r.ComparisonOperator,
        r.Value,
        (p, o, v) => [o, p, v]
      )
    );
  },
  Expression: function(r) {
    function binaryLeft(operatorsParser, nextParser) {
      return parsimmon.seqMap(
        nextParser,
        parsimmon.seq(operatorsParser, nextParser).many(),
        (first, rest) =>
          rest.reduce((acc, ch) => {
            let [op, another] = ch;
            if (op === acc[0]) return acc.concat([another]);
            if (op === another[0]) return [op, acc].concat(another.slice(1));
            return [op, acc, another];
          }, first)
      );
    }

    function unary(operatorsParser, nextParser) {
      return parsimmon.seq(operatorsParser, nextParser).or(nextParser);
    }

    return binaryLeft(
      r.OrOperator,
      binaryLeft(
        r.AndOperator,
        unary(
          r.NotOperator,
          r.Comparison.or(
            r.Expression.wrap(
              parsimmon.string("("),
              parsimmon.string(")").skip(r._)
            )
          )
        )
      )
    ).trim(r._);
  },
  _: function() {
    return parsimmon.optWhitespace;
  }
});

function parse(filter) {
  return lang.Expression.tryParse(filter);
}

function stringify(filter) {
  function value(v) {
    if (Array.isArray(v) && v[0].toUpperCase() === "FUNC")
      return `${v[1]}(${v
        .slice(2)
        .map(e => value(e))
        .join(", ")})`;
    return JSON.stringify(v);
  }

  function expressions(v) {
    return v.map(e => {
      let str = stringify(e);
      if (e[0] === "AND" || e[0] === "OR") return `(${str})`;
      else return str;
    });
  }

  const op = filter[0].toUpperCase();

  if (["AND", "OR"].includes(op))
    return expressions(filter.slice(1)).join(` ${op} `);
  else if (op === "NOT") return `NOT ${expressions(filter.slice(1))[0]}`;
  else if ([">=", "<>", "<=", "=", ">", "<"].includes(op))
    return `${filter[1]} ${op} ${value(filter[2])}`;
  else if (["IS NULL", "IS NOT NULL"].includes(op)) return `${filter[1]} ${op}`;
  else throw new Error("Unrecognized operator");
}

exports.parse = parse;
exports.stringify = stringify;
