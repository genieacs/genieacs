"use strict";

const filterParser = require("./filter-parser");
const filterCnf = require("./filter-cnf");
const satSolver = require("./sat-solver");

function* permute(arr) {
  if (arr.length <= 1) {
    for (let i = 0; i < arr[0]; ++i) yield [i];
    return;
  }

  let slc = arr.slice(1);
  for (let i = 0; i < arr[0]; ++i)
    for (let innerArr of permute(slc)) yield [i].concat(innerArr);
}

class Filter {
  constructor(str) {
    if (Array.isArray(str)) this.ast = str;
    else if (str instanceof Filter) this.ast = str.ast;
    else if (!str) this.ast = null;
    else this.ast = filterParser.parse(str);
  }

  toString() {
    if (!this.string)
      if (this.ast) this.string = filterParser.stringify(this.ast);
      else this.string = "";

    return this.string;
  }

  or(fltr) {
    if (!fltr || !this.ast) return this;

    let f = ["OR"];

    if (this.ast[0] === "OR") f = f.concat(this.ast.slice(1));
    else f.push(this.ast);

    if (fltr.ast[0] === "OR") f = f.concat(fltr.ast.slice(1));
    else f.push(fltr.ast);

    return new Filter(f);
  }

  and(fltr) {
    if (!fltr) return this;
    else if (!this.ast) return fltr;

    let f = ["AND"];

    if (this.ast[0] === "AND") f = f.concat(this.ast.slice(1));
    else f.push(this.ast);

    if (fltr.ast[0] === "AND") f = f.concat(fltr.ast.slice(1));
    else f.push(fltr.ast);

    return new Filter(f);
  }

  not() {
    if (this.ast[0] === "NOT") return new Filter(this.ast[1]);
    else return new Filter(["NOT", this.ast]);
  }

  evaluateExpressions(now = Date.now()) {
    if (!this.ast) return this;
    let ast = filterParser.map(this.ast, exp => {
      if (exp[0] === "FUNC" && exp[1] === "NOW") {
        return now;
      } else if (exp[0] === "*") {
        let v = exp[1];
        for (let i = 2; i < exp.length; ++i) v *= exp[i];
        return v;
      } else if (exp[0] === "/") {
        let v = exp[1];
        for (let i = 2; i < exp.length; ++i) v /= exp[i];
        return v;
      } else if (exp[0] === "+") {
        let v = exp[1];
        for (let i = 2; i < exp.length; ++i) v += exp[i];
        return v;
      } else if (exp[0] === "-") {
        let v = exp[1];
        for (let i = 2; i < exp.length; ++i) v -= exp[i];
        return v;
      } else if (exp[0] === "||") {
        return exp.slice(1).join("");
      }
    });

    if (ast === this.ast) return this;
    else return new Filter(ast);
  }

  subset(fltr) {
    if (!fltr.ast) return true;
    else if (!this.ast) return false;

    const f = this.not()
      .or(fltr)
      .not();
    const { vars, clauses } = filterCnf.booleanCnf(f.ast);
    return !satSolver.naiveDpll(clauses, vars);
  }

  test(obj) {
    if (!this.ast) return true;
    return filterParser.map(this.ast, exp => {
      const op = exp[0];

      if (op === "AND") {
        for (let i = 1; i < exp.length; ++i) if (!exp[i]) return false;
        return true;
      } else if (op === "OR") {
        for (let i = 1; i < exp.length; ++i) if (exp[i]) return true;
        return false;
      } else if (op === "NOT") {
        return !exp[1];
      } else if (op === "=") {
        const val =
          typeof obj[exp[1]] === "object" ? obj[exp[1]].value[0] : obj[exp[1]];
        return val === exp[2];
      } else if (op === "<>") {
        const val =
          typeof obj[exp[1]] === "object" ? obj[exp[1]].value[0] : obj[exp[1]];
        return val !== exp[2];
      } else if (op === ">=") {
        const val =
          typeof obj[exp[1]] === "object" ? obj[exp[1]].value[0] : obj[exp[1]];
        return typeof val === typeof exp[2] && val >= exp[2];
      } else if (op === ">") {
        const val =
          typeof obj[exp[1]] === "object" ? obj[exp[1]].value[0] : obj[exp[1]];
        return typeof val === typeof exp[2] && val > exp[2];
      } else if (op === "<=") {
        const val =
          typeof obj[exp[1]] === "object" ? obj[exp[1]].value[0] : obj[exp[1]];
        return typeof val === typeof exp[2] && val <= exp[2];
      } else if (op === "<") {
        const val =
          typeof obj[exp[1]] === "object" ? obj[exp[1]].value[0] : obj[exp[1]];
        return typeof val === typeof exp[2] && val < exp[2];
      } else if (op === "IS NULL") {
        return obj[exp[1]] == null;
      } else if (op === "IS NOT NULL") {
        return obj[exp[1]] != null;
      } else {
        throw new Error(`Unsupported operator ${op}`);
      }
    });
  }
}

module.exports = Filter;
