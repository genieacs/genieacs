import Expression from "../expression.ts";
import { reduce } from "./evaluate.ts";

class Indeterminates {
  declare public map: Map<Expression, number>;
  declare public sortedKeys: Expression[];

  public constructor(exp?: Expression) {
    this.map = new Map();
    if (exp) {
      this.map.set(exp, 1);
      this.sortedKeys = [exp];
    } else {
      this.sortedKeys = [];
    }
  }

  public reciprocal(): Indeterminates {
    const res = new Indeterminates();
    res.sortedKeys = this.sortedKeys;
    res.map = new Map();
    for (const [k, v] of this.map) res.map.set(k, 0 - v);
    return res;
  }

  public static multiply(
    indeterminates1: Indeterminates,
    indeterminates2: Indeterminates,
  ): Indeterminates {
    const res = new Indeterminates();
    res.sortedKeys = indeterminates1.sortedKeys.slice();
    res.map = new Map(indeterminates1.map);
    const strMap: Map<string, Expression> = new Map();
    for (const k of res.map.keys()) strMap.set(k.toString(), k);

    for (const [key, val] of indeterminates2.map) {
      const k = strMap.get(key.toString());
      if (!k) {
        res.map.set(key, val);
        res.sortedKeys.push(key);
      } else {
        const v2 = val + res.map.get(k);
        if (!v2) {
          res.map.delete(k);
          res.sortedKeys = res.sortedKeys.filter((s) => s !== k);
        } else {
          res.map.set(k, v2);
        }
      }
    }

    res.sortedKeys.sort((a, b) => {
      const str1 = a.toString();
      const str2 = b.toString();
      if (str1.length !== str2.length) return str2.length - str1.length;
      else if (str1 > str2) return 1;
      else if (str1 < str2) return -1;
      return 0;
    });

    return res;
  }

  public static compare(a: Indeterminates, b: Indeterminates): number {
    if (a.sortedKeys.length !== b.sortedKeys.length)
      return b.sortedKeys.length - a.sortedKeys.length;
    for (let i = 0; i < a.sortedKeys.length; ++i) {
      const k1 = a.sortedKeys[i];
      const w1 = a.map.get(k1);
      const k2 = b.sortedKeys[i];
      const w2 = b.map.get(k2);
      if (w1 !== w2) return w2 - w1;
      if (k1.toString().length > k2.toString().length) return -1;
      else if (k1.toString().length < k2.toString().length) return 1;
      else if (k1.toString() > k2.toString()) return 1;
      else if (k1.toString() < k2.toString()) return -1;
    }
    return 0;
  }
}

interface Term {
  indeterminates: Indeterminates;
  coefficientNumerator: bigint;
  coefficientDenominator: bigint;
}

function findGcd(a: bigint, b: bigint): bigint {
  while (b !== 0n) {
    const t = b;
    b = a % b;
    a = t;
  }
  return a;
}

class Polynomial extends Expression {
  declare public terms: Term[];

  public constructor(terms: Term[]) {
    super();
    this.terms = terms;
  }

  map(): Polynomial {
    return this;
  }

  async mapAsync(): Promise<Polynomial> {
    return this;
  }

  public static simplifyTerms(terms: Term[]): Term[] {
    const ts = terms
      .slice()
      .sort((a: Term, b: Term) =>
        Indeterminates.compare(a.indeterminates, b.indeterminates),
      );

    for (let i = 1; i < ts.length; ++i) {
      const t1 = ts[i - 1];
      const t2 = ts[i];
      if (Indeterminates.compare(t1.indeterminates, t2.indeterminates) === 0) {
        const numerator =
          t1.coefficientNumerator * t2.coefficientDenominator +
          t2.coefficientNumerator * t1.coefficientDenominator;

        const denominator =
          t1.coefficientDenominator * t2.coefficientDenominator;

        const gcd = findGcd(numerator, denominator);

        ts[i] = {
          indeterminates: t2.indeterminates,
          coefficientNumerator: numerator / gcd,
          coefficientDenominator: denominator / gcd,
        };
        ts[i - 1] = {
          indeterminates: t1.indeterminates,
          coefficientNumerator: 0n,
          coefficientDenominator: t1.coefficientDenominator,
        };
      }
    }
    return ts.filter((v) => v.coefficientNumerator !== 0n);
  }

  public static fromIndeterminate(indeterminate: Expression): Polynomial {
    const indeterminates = new Indeterminates(indeterminate);
    const terms = [
      {
        indeterminates: indeterminates,
        coefficientNumerator: 1n,
        coefficientDenominator: 1n,
      },
    ];
    return new Polynomial(terms);
  }

  public static fromConstant(constant: number): Polynomial {
    const [int, frac] = Math.abs(constant).toString(2).split(".", 2);
    let numerator = BigInt("0b" + int);
    if (constant < 0) numerator = numerator / -1n;
    let denominator = 1n;
    if (frac) {
      denominator = 2n ** BigInt(frac.length);
      numerator = numerator * denominator + BigInt("0b" + frac);
    }

    const terms = [
      {
        indeterminates: new Indeterminates(),
        coefficientNumerator: numerator,
        coefficientDenominator: denominator,
      },
    ];

    return new Polynomial(terms);
  }

  public negation(): Polynomial {
    const terms = this.terms.map((t) => ({
      indeterminates: t.indeterminates,
      coefficientNumerator: t.coefficientNumerator * -1n,
      coefficientDenominator: t.coefficientDenominator,
    }));

    return new Polynomial(terms);
  }

  public reciprocal(): Polynomial {
    const terms = this.terms.map((t) => ({
      indeterminates: t.indeterminates.reciprocal(),
      coefficientNumerator: t.coefficientDenominator,
      coefficientDenominator: t.coefficientNumerator,
    }));
    return new Polynomial(terms);
  }

  public constant(): Polynomial {
    const terms = this.terms.filter((t) => !t.indeterminates.sortedKeys.length);
    return new Polynomial(terms);
  }

  public add(rhs: Polynomial): Polynomial {
    return new Polynomial(
      Polynomial.simplifyTerms(this.terms.concat(rhs.terms)),
    );
  }

  public subtract(rhs: Polynomial): Polynomial {
    return this.add(rhs.negation());
  }

  public multiply(rhs: Polynomial): Polynomial {
    const terms: Term[] = [];

    for (const t1 of this.terms) {
      for (const t2 of rhs.terms) {
        const numerator = t1.coefficientNumerator * t2.coefficientNumerator;
        const denominator =
          t1.coefficientDenominator * t2.coefficientDenominator;
        const gcd = findGcd(numerator, denominator);

        terms.push({
          indeterminates: Indeterminates.multiply(
            t1.indeterminates,
            t2.indeterminates,
          ),
          coefficientNumerator: numerator / gcd,
          coefficientDenominator: denominator / gcd,
        });
      }
    }

    return new Polynomial(Polynomial.simplifyTerms(terms));
  }

  public divide(rhs: Polynomial): Polynomial {
    return this.multiply(rhs.reciprocal());
  }

  public toExpression(): Expression {
    const add: Expression[] = [];
    for (const t of this.terms) {
      const coefficient =
        Number(t.coefficientNumerator) / Number(t.coefficientDenominator);

      const mul: Expression[] = [];
      if (t.indeterminates.sortedKeys.length) {
        for (const k of t.indeterminates.sortedKeys) {
          const w = t.indeterminates.map.get(k);
          for (let i = Math.abs(w); i > 0; --i) {
            if (w > 0) mul.push(k);
            else
              mul.push(
                new Expression.Binary("/", new Expression.Literal(1), k),
              );
          }
        }

        if (coefficient !== 1) mul.push(new Expression.Literal(coefficient));

        while (mul.length > 1) {
          const r = mul.pop();
          const l = mul.pop();
          mul.push(new Expression.Binary("*", l, r));
        }
        add.push(mul[0]);
      } else {
        add.push(new Expression.Literal(coefficient));
      }
    }

    while (add.length > 1) {
      const r = add.pop();
      const l = add.pop();
      add.push(new Expression.Binary("+", l, r));
    }

    if (!add.length) return new Expression.Literal(0);
    return add[0];
  }
}

const SWAPPED_OPS = {
  "=": "=",
  "<>": "<>",
  ">": "<",
  ">=": "<=",
  "<": ">",
  "<=": ">=",
};

function cartesianProduct<T>(arrays: T[][]): T[][] {
  return arrays.reduce<T[][]>(
    (acc, cur) => acc.flatMap((a) => cur.map((item) => [...a, item])),
    [[]],
  );
}

function toPolynomial(e: Expression): Polynomial {
  if (e instanceof Polynomial) return e;
  if (e instanceof Expression.Literal) {
    if (e.value == null) return null;
    if (typeof e.value === "number") return Polynomial.fromConstant(e.value);
    if (typeof e.value === "string")
      return Polynomial.fromConstant(parseFloat(e.value) || 0);
    if (typeof e.value === "boolean") return Polynomial.fromConstant(+e.value);
  }
  return Polynomial.fromIndeterminate(e);
}

function fromPolynomial(e: Expression): Expression {
  if (e instanceof Polynomial) return e.toExpression();
  if (e instanceof Expression.Conditional) return e.map(fromPolynomial);
  return e;
}

function normalizeCallback(exp: Expression): Expression {
  if (exp instanceof Expression.FunctionCall) {
    if (exp.name === "COALESCE") {
      let e: Expression = new Expression.Literal(null);
      for (let i = exp.args.length - 1; i >= 0; --i) {
        e = new Expression.Conditional(
          normalizeCallback(new Expression.Unary("IS NOT NULL", exp.args[i])),
          exp.args[i],
          e,
        );
      }
      return normalizeCallback(e);
    }
  }

  if (exp instanceof Expression.Conditional) {
    let e = exp;

    if (e.condition instanceof Polynomial)
      e = new Expression.Conditional(
        e.condition.toExpression(),
        e.then,
        e.otherwise,
      );

    if (e.then instanceof Expression.Conditional) {
      e = new Expression.Conditional(
        Expression.and(e.condition, e.then.condition),
        e.then.then,
        new Expression.Conditional(e.condition, e.then.otherwise, e.otherwise),
      );
    }

    return e;
  }

  const combs: [Expression, Expression][][] = [];
  const callback: (e: Expression) => Expression = (e) => {
    if (e instanceof Expression.Conditional) {
      combs[combs.length - 1].push([e.condition, e.then]);
      callback(e.otherwise);
    } else {
      combs[combs.length - 1].push([new Expression.Literal(true), e]);
    }
    return e;
  };

  exp.map((e) => {
    combs.push([]);
    callback(e);
    return e;
  });

  if (combs.some((a) => a.length > 1)) {
    let res: Expression = new Expression.Literal(null);
    for (const p of cartesianProduct(combs).reverse()) {
      let condition: Expression = new Expression.Literal(true);
      const e = reduce(
        normalizeCallback(
          exp.map((_, i) => {
            condition = Expression.and(condition, p[i][0]);
            return p[i][1];
          }),
        ),
      );

      if (!(condition instanceof Expression.Literal))
        res = new Expression.Conditional(condition, e, res);
      else if (condition.value) res = e;
    }
    return res;
  }

  if (exp instanceof Expression.Binary) {
    if (["+", "-", "*", "/"].includes(exp.operator)) {
      const lhs = toPolynomial(exp.left);
      const rhs = toPolynomial(exp.right);
      if (lhs == null || rhs == null) return new Expression.Literal(null);
      if (exp.operator === "+") return lhs.add(rhs);
      if (exp.operator === "-") return lhs.subtract(rhs);
      if (exp.operator === "*") return lhs.multiply(rhs);
      if (exp.operator === "/") return lhs.divide(rhs);
    } else if ([">", ">=", "<", "<=", "=", "<>"].includes(exp.operator)) {
      let lhs: Polynomial, rhs: Polynomial;

      if (exp.left instanceof Polynomial) lhs = exp.left;
      else if (exp.left instanceof Expression.Literal) {
        if (exp.left.value == null) return exp.left;
        else if (typeof exp.left.value === "number")
          lhs = Polynomial.fromConstant(exp.left.value);
      }

      if (exp.right instanceof Polynomial) rhs = exp.right;
      else if (exp.right instanceof Expression.Literal) {
        if (exp.right.value == null) return exp.right;
        else if (typeof exp.right.value === "number")
          rhs = Polynomial.fromConstant(exp.right.value);
      }

      if (lhs || rhs) {
        if (!lhs) lhs = Polynomial.fromIndeterminate(exp.left);
        if (!rhs) rhs = Polynomial.fromIndeterminate(exp.right);

        lhs = lhs.subtract(rhs);
        rhs = lhs.constant().negation();
        lhs = lhs.add(rhs);

        if (!lhs.terms.length) {
          const l = lhs.toExpression() as Expression.Literal;
          const r = rhs.toExpression() as Expression.Literal;

          if (exp.operator === "=")
            return new Expression.Literal(l.value === r.value);
          else if (exp.operator === "<>")
            return new Expression.Literal(l.value !== r.value);
          else if (exp.operator === ">")
            return new Expression.Literal(l.value > r.value);
          else if (exp.operator === ">=")
            return new Expression.Literal(l.value >= r.value);
          else if (exp.operator === "<")
            return new Expression.Literal(l.value < r.value);
          else if (exp.operator === "<=")
            return new Expression.Literal(l.value <= r.value);
          else throw new Error("Invalid operator");
        }

        let flipOp = 1;

        const n = lhs.terms[0].coefficientNumerator;
        const d = lhs.terms[0].coefficientDenominator;

        if (n < 0n || d < 0n) flipOp *= -1;

        const reciprocal = new Polynomial([
          {
            indeterminates: new Indeterminates(),
            coefficientNumerator: d,
            coefficientDenominator: n,
          },
        ]);

        lhs = lhs.multiply(reciprocal);
        rhs = rhs.multiply(reciprocal);

        const keys = lhs.terms[0].indeterminates.sortedKeys;
        let invert = lhs.terms[0].indeterminates.map.get(keys[0]) < 0 ? -1 : 0;

        for (const t of lhs.terms)
          for (const v of t.indeterminates.map.values()) invert += v;

        if (invert < 0) {
          flipOp *= -1;
          lhs = lhs.reciprocal();
          rhs = rhs.reciprocal();
        }

        if (flipOp > 0) exp = new Expression.Binary(exp.operator, lhs, rhs);
        else exp = new Expression.Binary(SWAPPED_OPS[exp.operator], lhs, rhs);
      }
    }
  }

  // Restore polynomial expressions
  exp = exp.map(fromPolynomial);

  return exp;
}

export default function normalize(exp: Expression): Expression {
  return fromPolynomial(exp.evaluate(normalizeCallback));
}
