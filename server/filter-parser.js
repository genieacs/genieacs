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
  Value: function(r) {
    return parsimmon.alt(r.NumberValue, r.StringValueSql, r.StringValueJs);
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

exports.parse = parse;
