import Expression from "../expression.ts";
import { likePatternToRegExp } from "./parser.ts";

function compare(
  a: boolean | number | string,
  b: boolean | number | string,
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

const regExpCache: WeakMap<Expression.Literal, RegExp> = new WeakMap();

export function reduce(exp: Expression): Expression {
  if (exp instanceof Expression.Literal) return exp;

  if (exp instanceof Expression.Unary) {
    if (exp.operator === "NOT") {
      if (exp.operand instanceof Expression.Literal) {
        if (exp.operand.value == null) return exp.operand;
        return new Expression.Literal(!exp.operand.value);
      } else if (exp.operand instanceof Expression.Unary) {
        if (exp.operand.operator === "NOT") return exp.operand.operand;
      }
    } else if (exp.operator === "IS NULL") {
      if (exp.operand instanceof Expression.Literal) {
        return new Expression.Literal(exp.operand.value == null);
      }
    } else if (exp.operator === "IS NOT NULL") {
      if (exp.operand instanceof Expression.Literal) {
        return new Expression.Literal(exp.operand.value != null);
      }
    }
  } else if (exp instanceof Expression.Binary) {
    if (exp.operator === "AND") {
      return Expression.and(exp.left, exp.right);
    } else if (exp.operator === "OR") {
      return Expression.or(exp.left, exp.right);
    } else if (["=", ">", "<", "<>", ">=", "<="].includes(exp.operator)) {
      if (exp.left instanceof Expression.Literal && exp.left.value == null)
        return exp.left;
      if (exp.right instanceof Expression.Literal && exp.right.value == null)
        return exp.right;
      if (
        exp.left instanceof Expression.Literal &&
        exp.right instanceof Expression.Literal
      ) {
        const c = compare(exp.left.value, exp.right.value);
        switch (exp.operator) {
          case "=":
            return new Expression.Literal(c === 0);
          case ">":
            return new Expression.Literal(c > 0);
          case "<":
            return new Expression.Literal(c < 0);
          case "<>":
            return new Expression.Literal(c !== 0);
          case ">=":
            return new Expression.Literal(c >= 0);
          case "<=":
            return new Expression.Literal(c <= 0);
        }
      }
    } else if (["+", "-", "*", "/"].includes(exp.operator)) {
      if (exp.left instanceof Expression.Literal && exp.left.value == null)
        return exp.left;
      if (exp.right instanceof Expression.Literal && exp.right.value == null)
        return exp.right;
      if (
        exp.left instanceof Expression.Literal &&
        exp.right instanceof Expression.Literal
      ) {
        const a = toNumber(exp.left.value);
        const b = toNumber(exp.right.value);
        switch (exp.operator) {
          case "+":
            return new Expression.Literal(a + b);
          case "-":
            return new Expression.Literal(a - b);
          case "*":
            return new Expression.Literal(a * b);
          case "/":
            return new Expression.Literal(a / b);
        }
      }
    } else if (exp.operator === "%") {
      if (exp.left instanceof Expression.Literal && exp.left.value == null)
        return exp.left;
      if (exp.right instanceof Expression.Literal && exp.right.value == null)
        return exp.right;
      if (
        exp.left instanceof Expression.Literal &&
        exp.right instanceof Expression.Literal
      ) {
        const a = toNumber(exp.left.value);
        const b = Math.trunc(toNumber(exp.right.value));
        if (b === 0) return new Expression.Literal(null);
        return new Expression.Literal(a % b);
      }
    } else if (exp.operator === "||") {
      if (exp.left instanceof Expression.Literal && exp.left.value == null)
        return exp.left;
      if (exp.right instanceof Expression.Literal && exp.right.value == null)
        return exp.right;
      if (
        exp.left instanceof Expression.Literal &&
        exp.right instanceof Expression.Literal
      ) {
        const a = toString(exp.left.value);
        const b = toString(exp.right.value);
        return new Expression.Literal(a + b);
      }
    } else if (exp.operator === "LIKE") {
      if (exp.left instanceof Expression.Literal && exp.left.value == null)
        return exp.left;
      if (exp.right instanceof Expression.Literal && exp.right.value == null)
        return exp.right;
      if (
        exp.left instanceof Expression.Literal &&
        exp.right instanceof Expression.Literal
      ) {
        const s = toString(exp.left.value);
        let r = regExpCache.get(exp.right);
        if (!r) {
          r = likePatternToRegExp(toString(exp.right.value));
          regExpCache.set(exp.right, r);
        }
        return new Expression.Literal(r.test(s));
      }
    } else if (exp.operator === "NOT LIKE") {
      if (exp.left instanceof Expression.Literal && exp.left.value == null)
        return exp.left;
      if (exp.right instanceof Expression.Literal && exp.right.value == null)
        return exp.right;
      if (
        exp.left instanceof Expression.Literal &&
        exp.right instanceof Expression.Literal
      ) {
        const s = toString(exp.left.value);
        let r = regExpCache.get(exp.right);
        if (!r) {
          r = likePatternToRegExp(toString(exp.right.value));
          regExpCache.set(exp.right, r);
        }
        return new Expression.Literal(!r.test(s));
      }
    }
  } else if (exp instanceof Expression.FunctionCall) {
    if (exp.name === "COALESCE") {
      const args = exp.args.filter(
        (arg) => !(arg instanceof Expression.Literal && arg.value == null),
      );
      if (!args.length) return new Expression.Literal(null);
      if (args.length === 1) return args[0];
      if (args[0] instanceof Expression.Literal) return args[0];
      if (args.length !== exp.args.length)
        return new Expression.FunctionCall("COALESCE", args);
    } else if (exp.name === "UPPER") {
      if (exp.args[0] instanceof Expression.Literal) {
        if (exp.args[0].value == null) return exp.args[0];
        const a = toString(exp.args[0].value);
        return new Expression.Literal(a.toUpperCase());
      }
    } else if (exp.name === "LOWER") {
      if (exp.args[0] instanceof Expression.Literal) {
        if (exp.args[0].value == null) return exp.args[0];
        const a = toString(exp.args[0].value);
        return new Expression.Literal(a.toLowerCase());
      }
    } else if (exp.name === "ROUND") {
      let p = 0;
      if (exp.args.length > 1) {
        if (exp.args[1] instanceof Expression.Literal) {
          if (exp.args[1].value == null) return exp.args[1];
          p = Math.trunc(toNumber(exp.args[1].value));
        }
      }
      if (exp.args[0] instanceof Expression.Literal) {
        if (exp.args[0].value == null) return exp.args[0];
        const n = toNumber(exp.args[0].value);
        const d = 10 ** p;
        const m = n * d * (1 + Number.EPSILON);
        return new Expression.Literal(Math.round(m) / d);
      }
    }
  } else if (exp instanceof Expression.Conditional) {
    if (exp.condition instanceof Expression.Literal) {
      if (exp.condition.value) return exp.then;
      return exp.otherwise;
    }
  }

  return exp;
}
