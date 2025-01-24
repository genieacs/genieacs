import * as BI from "./bigint.ts";
import { Expression } from "../../types.ts";
import { map } from "./parser.ts";
import { and, evaluateCallback } from "./util.ts";

const ZERO = BI.BigInt(0);
const ONE = BI.BigInt(1);
const TWO = BI.BigInt(2);
const NEGATIVE_ONE = BI.BigInt(-1);

class Indeterminates {
  public declare map: Map<string, number>;
  public declare sortedKeys: string[];

  public constructor(str?: string) {
    this.map = new Map();
    if (str) {
      this.map.set(str, 1);
      this.sortedKeys = [str];
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

    for (const [key, val] of indeterminates2.map) {
      const v = res.map.get(key);
      if (!v) {
        res.map.set(key, val);
        res.sortedKeys.push(key);
      } else {
        const v2 = val + v;
        if (!v2) {
          res.map.delete(key);
          res.sortedKeys = res.sortedKeys.filter((s) => s !== key);
        } else {
          res.map.set(key, v2);
        }
      }
    }

    res.sortedKeys.sort((a, b) => {
      if (a.length !== b.length) return b.length - a.length;
      else if (a > b) return 1;
      else if (a < b) return -1;
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
      if (k1.length > k2.length) return -1;
      else if (k1.length < k2.length) return 1;
      else if (k1 > k2) return 1;
      else if (k1 < k2) return -1;
    }
    return 0;
  }
}

interface Term {
  indeterminates: Indeterminates;
  coefficientNumerator: BI.bigint;
  coefficientDenominator: BI.bigint;
}

function findGcd(a: BI.bigint, b: BI.bigint): BI.bigint {
  while (BI.ne(b, ZERO)) {
    const t = b;
    b = BI.rem(a, b);
    a = t;
  }
  return a;
}

class Polynomial {
  public declare terms: Term[];

  public constructor(terms: Term[]) {
    this.terms = terms;
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
        const numerator = BI.add(
          BI.mul(t1.coefficientNumerator, t2.coefficientDenominator),
          BI.mul(t2.coefficientNumerator, t1.coefficientDenominator),
        );

        const denominator = BI.mul(
          t1.coefficientDenominator,
          t2.coefficientDenominator,
        );

        const gcd = findGcd(numerator, denominator);

        ts[i] = {
          indeterminates: t2.indeterminates,
          coefficientNumerator: BI.div(numerator, gcd),
          coefficientDenominator: BI.div(denominator, gcd),
        };
        ts[i - 1] = {
          indeterminates: t1.indeterminates,
          coefficientNumerator: ZERO,
          coefficientDenominator: t1.coefficientDenominator,
        };
      }
    }
    return ts.filter((v) => BI.ne(v.coefficientNumerator, ZERO));
  }

  public static fromIndeterminate(indeterminate: Expression): Polynomial {
    const indeterminates = new Indeterminates(JSON.stringify(indeterminate));
    const terms = [
      {
        indeterminates: indeterminates,
        coefficientNumerator: ONE,
        coefficientDenominator: ONE,
      },
    ];
    return new Polynomial(terms);
  }

  public static fromConstant(constant: number): Polynomial {
    const [int, frac] = Math.abs(constant).toString(2).split(".", 2);
    let numerator = BI.BigInt("0b" + int);
    if (constant < 0) numerator = BI.mul(numerator, NEGATIVE_ONE);
    let denominator = ONE;
    if (frac) {
      denominator = BI.exp(TWO, BI.BigInt(frac.length));
      numerator = BI.add(
        BI.mul(numerator, denominator),
        BI.BigInt("0b" + frac),
      );
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
      coefficientNumerator: BI.mul(t.coefficientNumerator, NEGATIVE_ONE),
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
        const numerator = BI.mul(
          t1.coefficientNumerator,
          t2.coefficientNumerator,
        );
        const denominator = BI.mul(
          t1.coefficientDenominator,
          t2.coefficientDenominator,
        );
        const gcd = findGcd(numerator, denominator);

        terms.push({
          indeterminates: Indeterminates.multiply(
            t1.indeterminates,
            t2.indeterminates,
          ),
          coefficientNumerator: BI.div(numerator, gcd),
          coefficientDenominator: BI.div(denominator, gcd),
        });
      }
    }

    return new Polynomial(Polynomial.simplifyTerms(terms));
  }

  public divide(rhs: Polynomial): Polynomial {
    return this.multiply(rhs.reciprocal());
  }

  public toString(): string {
    const add: string[] = [];
    for (const t of this.terms) {
      const coefficient =
        BI.toNumber(t.coefficientNumerator) /
        BI.toNumber(t.coefficientDenominator);

      const mul: string[] = [];
      if (t.indeterminates.sortedKeys.length) {
        for (const k of t.indeterminates.sortedKeys) {
          const w = t.indeterminates.map.get(k);
          for (let i = Math.abs(w); i > 0; --i) {
            if (w > 0) mul.push(k);
            else mul.push(`["/",1,${k}]`);
          }
        }

        if (coefficient !== 1) mul.push(coefficient.toString());

        if (mul.length > 1) add.push(`["*",${mul.join(",")}]`);
        else add.push(mul["0"]);
      } else {
        add.push(coefficient.toString());
      }
    }

    if (!add.length) return "0";
    else if (add.length === 1) return add[0];
    else return `["+",${add.join(",")}]`;
  }
}

const ADDITIVE_IDENTITY = Polynomial.fromConstant(0);
const MULTIPLICATIVE_IDENTITY = Polynomial.fromConstant(1);

const SWAPPED_OPS = {
  "=": "=",
  "<>": "<>",
  ">": "<",
  ">=": "<=",
  "<": ">",
  "<=": ">=",
};

function normalizeCallback(exp: Expression): Expression {
  if (!Array.isArray(exp)) return exp;
  const op = exp[0];

  if (op === "FUNC" && exp[1] === "COALESCE") {
    const res: Expression[] = ["CASE"];
    for (let i = 2; i < exp.length; ++i)
      res.push(normalizeCallback(["IS NOT NULL", exp[i]]), exp[i]);
    return normalizeCallback(res);
  }

  if (op === "CASE") {
    const res = [] as [Expression, Expression][];
    for (let i = 1; i < exp.length; i += 2) {
      let w = exp[i];
      if (w instanceof Polynomial) w = JSON.parse(w.toString());
      if (!Array.isArray(w) && !w) continue;
      const t = exp[i + 1];
      if (!Array.isArray(t) || t[0] !== "CASE") {
        res.push([w, t]);
        continue;
      }
      for (let j = 1; j < t.length; j += 2) res.push([and(w, t[j]), t[j + 1]]);
      res.push([w, null]);
      if (!Array.isArray(w) && w) break;
    }
    while (res[res.length - 1][1] == null) res.pop();
    return ["CASE", ...res.flat()];
  }

  const permutations: Map<number, [Expression, Expression][]> = new Map();
  for (const [i, e] of exp.entries()) {
    if (!Array.isArray(e)) continue;
    if (e[0] !== "CASE") continue;
    const perms: [Expression, Expression][] = [];
    for (let j = 1; j < e.length; j += 2) perms.push([e[j], e[j + 1]]);
    perms.push([true, null]);
    permutations.set(i, perms);
  }

  if (permutations.size) {
    let res: [Expression, Expression][] = [[true, exp]];
    for (const [i, perms] of permutations) {
      const res2: [Expression, Expression][] = [];
      for (const [w, t] of perms) {
        res2.push(
          ...res.map((r) => {
            const e = (r[1] as Expression[]).slice();
            e[i] = t;
            return [and(w, r[0]), e] as [Expression, Expression];
          }),
        );
        if (!Array.isArray(w) && w) break;
      }
      res = res2;
    }

    for (const r of res) r[1] = normalizeCallback(r[1]);

    if (res[0][0] === true) return res[0][1];
    while (res[res.length - 1][1] == null) res.pop();

    return ["CASE", ...res.flat()];
  }

  function toPolynomial(e: Expression): Polynomial {
    if (e == null) return null;
    if (e instanceof Polynomial) return e;
    if (typeof e === "number") return Polynomial.fromConstant(e);
    if (typeof e === "string")
      return Polynomial.fromConstant(parseFloat(e) || 0);
    if (typeof e === "boolean") return Polynomial.fromConstant(+e);
    return Polynomial.fromIndeterminate(e);
  }

  if (op === "+") {
    const args: Polynomial[] = [];
    for (let i = 1; i < exp.length; ++i) {
      const p = toPolynomial(exp[i]);
      if (p == null) return null;
      args.push(p);
    }
    return args.reduce(
      (previousValue, currentValue) => previousValue.add(currentValue),
      ADDITIVE_IDENTITY,
    ) as unknown as Expression;
  } else if (op === "*") {
    const args: Polynomial[] = [];
    for (let i = 1; i < exp.length; ++i) {
      const p = toPolynomial(exp[i]);
      if (p == null) return null;
      args.push(p);
    }
    return args.reduce(
      (previousValue, currentValue) => previousValue.multiply(currentValue),
      MULTIPLICATIVE_IDENTITY,
    ) as unknown as Expression;
  } else if (op === "-") {
    const args: Polynomial[] = [];
    for (let i = 1; i < exp.length; ++i) {
      const p = toPolynomial(exp[i]);
      if (p == null) return null;
      args.push(p);
    }
    return args.reduce((previousValue, currentValue) =>
      previousValue.subtract(currentValue),
    ) as unknown as Expression;
  } else if (op === "/") {
    const args: Polynomial[] = [];
    for (let i = 1; i < exp.length; ++i) {
      const p = toPolynomial(exp[i]);
      if (p == null) return null;
      args.push(p);
    }
    return args.reduce((previousValue, currentValue) =>
      previousValue.divide(currentValue),
    ) as unknown as Expression;
  } else if (["=", "<>", ">", ">=", "<", "<="].includes(op)) {
    if (exp[1] == null || exp[2] == null) return null;
    let lhs: Polynomial, rhs: Polynomial;
    if (exp[1] instanceof Polynomial) lhs = exp[1];
    else if (typeof exp[1] === "number") lhs = Polynomial.fromConstant(exp[1]);

    if (exp[2] instanceof Polynomial) rhs = exp[2];
    else if (typeof exp[2] === "number") rhs = Polynomial.fromConstant(exp[2]);

    if (lhs || rhs) {
      if (!lhs) lhs = Polynomial.fromIndeterminate(exp[1]);
      if (!rhs) rhs = Polynomial.fromIndeterminate(exp[2]);

      lhs = lhs.subtract(rhs);
      rhs = lhs.constant().negation();
      lhs = lhs.add(rhs);

      if (!lhs.terms.length) {
        exp = [op, JSON.parse(lhs.toString()), JSON.parse(rhs.toString())];

        if (op === "=") return exp[1] === exp[2];
        else if (op === "<>") return exp[1] !== exp[2];
        else if (op === ">") return exp[1] > exp[2];
        else if (op === ">=") return exp[1] >= exp[2];
        else if (op === "<") return exp[1] < exp[2];
        else if (op === "<=") return exp[1] <= exp[2];
      } else {
        let flipOp = 1;

        const n = lhs.terms[0].coefficientNumerator;
        const d = lhs.terms[0].coefficientDenominator;

        if (BI.lt(n, ZERO) || BI.lt(d, ZERO)) flipOp *= -1;

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

        if (flipOp < 0) exp = [SWAPPED_OPS[op], lhs, rhs];
        else exp = [op, lhs, rhs];
      }
    }
  }

  // Restore polynomial expressions
  exp = exp.map((e) =>
    e instanceof Polynomial ? JSON.parse(e.toString()) : e,
  );

  exp = evaluateCallback(exp);

  return exp;
}

export default function normalize(expr: Expression): Expression {
  expr = map(expr, normalizeCallback);
  if (expr instanceof Polynomial) {
    expr = JSON.parse(expr.toString());
  } else if (Array.isArray(expr) && expr[0] === "CASE") {
    expr = expr.map((e) =>
      e instanceof Polynomial ? JSON.parse(e.toString()) : e,
    );
  }
  return expr;
}
