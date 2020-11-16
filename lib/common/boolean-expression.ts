/**
 * Copyright 2013-2020  GenieACS Inc.
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

import * as BI from "./bigint";
import { espresso, complement, tautology } from "espresso-iisojs";
import { Expression } from "../types";
import { map } from "./expression-parser";
import { and, evaluateCallback } from "./expression";

const ZERO = BI.BigInt(0);
const ONE = BI.BigInt(1);
const TWO = BI.BigInt(2);
const NEGATIVE_ONE = BI.BigInt(-1);

class Indeterminates {
  public map: Map<string, number>;
  public sortedKeys: string[];

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
    indeterminates2: Indeterminates
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
  public terms: Term[];

  public constructor(terms: Term[]) {
    this.terms = terms;
  }

  public static simplifyTerms(terms: Term[]): Term[] {
    const ts = terms
      .slice()
      .sort((a: Term, b: Term) =>
        Indeterminates.compare(a.indeterminates, b.indeterminates)
      );

    for (let i = 1; i < ts.length; ++i) {
      const t1 = ts[i - 1];
      const t2 = ts[i];
      if (Indeterminates.compare(t1.indeterminates, t2.indeterminates) === 0) {
        const numerator = BI.add(
          BI.mul(t1.coefficientNumerator, t2.coefficientDenominator),
          BI.mul(t2.coefficientNumerator, t1.coefficientDenominator)
        );

        const denominator = BI.mul(
          t1.coefficientDenominator,
          t2.coefficientDenominator
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
        BI.BigInt("0b" + frac)
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
      Polynomial.simplifyTerms(this.terms.concat(rhs.terms))
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
          t2.coefficientNumerator
        );
        const denominator = BI.mul(
          t1.coefficientDenominator,
          t2.coefficientDenominator
        );
        const gcd = findGcd(numerator, denominator);

        terms.push({
          indeterminates: Indeterminates.multiply(
            t1.indeterminates,
            t2.indeterminates
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

type Minterm = number[];
type Context = Map<string, number>;

abstract class BoolExprSynth {
  public abstract true(context: Context): Minterm[];
  public abstract false(context: Context): Minterm[];
  public abstract null(context: Context): Minterm[];
}

class TrueSynth extends BoolExprSynth {
  public true(): Minterm[] {
    return [[]];
  }
  public false(): Minterm[] {
    return [];
  }
  public null(): Minterm[] {
    return [];
  }
}

class FalseSynth extends BoolExprSynth {
  public true(): Minterm[] {
    return [];
  }
  public false(): Minterm[] {
    return [[]];
  }
  public null(): Minterm[] {
    return [];
  }
}

class NullSynth extends BoolExprSynth {
  public true(): Minterm[] {
    return [];
  }
  public false(): Minterm[] {
    return [];
  }
  public null(): Minterm[] {
    return [[]];
  }
}

class VarSynth extends BoolExprSynth {
  private expStr: string;
  private negate: boolean;
  public constructor(exp: Expression) {
    super();
    this.negate = false;
    if (Array.isArray(exp)) {
      const op = exp[0];
      if (op === "<>") {
        exp = exp.slice();
        exp[0] = "=";
        this.negate = true;
      } else if (op === ">=") {
        exp = exp.slice();
        exp[0] = "<";
        this.negate = true;
      } else if (op === "<=") {
        exp = exp.slice();
        exp[0] = ">";
        this.negate = true;
      } else if (op === "NOT LIKE") {
        exp = exp.slice();
        exp[0] = "LIKE";
        this.negate = true;
      }
    }
    this.expStr = JSON.stringify(exp);
  }
  public true(context: Context): Minterm[] {
    let v = context.get(this.expStr);
    if (v == null) context.set(this.expStr, (v = context.size));
    return [[(v << 2) ^ (this.negate ? 1 : 3)]];
  }
  public false(context: Context): Minterm[] {
    let v = context.get(this.expStr);
    if (v == null) context.set(this.expStr, (v = context.size));
    return [[(v << 2) ^ (this.negate ? 3 : 1)]];
  }
  public null(context: Context): Minterm[] {
    let v = context.get(this.expStr);
    if (v == null) context.set(this.expStr, (v = context.size));
    return [[v << 2, (v << 2) ^ 2]];
  }
}

class NotSynth extends BoolExprSynth {
  private exprSynth: BoolExprSynth;
  public constructor(e: BoolExprSynth) {
    super();
    this.exprSynth = e;
  }
  public true(context: Context): Minterm[] {
    return this.exprSynth.false(context);
  }
  public false(context: Context): Minterm[] {
    return this.exprSynth.true(context);
  }
  public null(context: Context): Minterm[] {
    return this.exprSynth.null(context);
  }
}

class IsNullSynth extends BoolExprSynth {
  private exprSynth: BoolExprSynth;
  public constructor(e: BoolExprSynth) {
    super();
    this.exprSynth = e;
  }
  public true(context: Context): Minterm[] {
    return this.exprSynth.null(context);
  }
  public false(context: Context): Minterm[] {
    return [...this.exprSynth.true(context), ...this.exprSynth.false(context)];
  }
  public null(): Minterm[] {
    return [];
  }
}

class OrSynth extends BoolExprSynth {
  private exprSynths: BoolExprSynth[];
  public constructor(...e: BoolExprSynth[]) {
    super();
    this.exprSynths = e.filter((ee) => !(ee instanceof FalseSynth));
    const unpacked: BoolExprSynth[] = [];
    this.exprSynths = this.exprSynths.filter((ee) => {
      if (ee instanceof OrSynth) {
        unpacked.push(...ee.exprSynths);
        return false;
      }
      return true;
    });
    this.exprSynths.push(...unpacked);
  }
  public true(context: Context): Minterm[] {
    if (this.exprSynths.length === 0) return [];
    if (this.exprSynths.length === 1) return this.exprSynths[0].true(context);
    if (this.exprSynths.some((e) => e instanceof TrueSynth)) return [[]];
    return this.exprSynths.map((e) => e.true(context)).flat();
  }
  public false(context: Context): Minterm[] {
    if (this.exprSynths.length === 0) return [[]];
    if (this.exprSynths.length === 1) return this.exprSynths[0].false(context);
    if (
      this.exprSynths.some(
        (e) => e instanceof TrueSynth || e instanceof NullSynth
      )
    )
      return [];
    return complement(
      this.exprSynths.map((e) => complement(e.false(context))).flat()
    );
  }
  public null(context: Context): Minterm[] {
    if (this.exprSynths.length === 0) return [];
    if (this.exprSynths.length === 1) return this.exprSynths[0].null(context);
    const n = this.exprSynths.map((e) => e.null(context)).flat();
    const t = this.exprSynths.map((e) => e.true(context)).flat();
    return complement([...complement(n), ...t]);
  }
}

class AndSynth extends BoolExprSynth {
  private exprSynths: BoolExprSynth[];
  public constructor(...e: BoolExprSynth[]) {
    super();
    this.exprSynths = e.filter((ee) => !(ee instanceof TrueSynth));
    const unpacked: BoolExprSynth[] = [];
    this.exprSynths = this.exprSynths.filter((ee) => {
      if (ee instanceof AndSynth) {
        unpacked.push(...ee.exprSynths);
        return false;
      }
      return true;
    });
    this.exprSynths.push(...unpacked);
  }
  public true(context: Context): Minterm[] {
    if (this.exprSynths.length === 0) return [[]];
    if (this.exprSynths.length === 1) return this.exprSynths[0].true(context);
    if (
      this.exprSynths.some(
        (e) => e instanceof FalseSynth || e instanceof NullSynth
      )
    )
      return [];
    return complement(
      this.exprSynths.map((e) => complement(e.true(context))).flat()
    );
  }
  public false(context: Context): Minterm[] {
    if (this.exprSynths.length === 0) return [];
    if (this.exprSynths.length === 1) return this.exprSynths[0].false(context);
    if (this.exprSynths.some((e) => e instanceof FalseSynth)) return [[]];
    return this.exprSynths.map((e) => e.false(context)).flat();
  }
  public null(context: Context): Minterm[] {
    if (this.exprSynths.length === 0) return [];
    if (this.exprSynths.length === 1) return this.exprSynths[0].null(context);
    const n = this.exprSynths.map((e) => e.null(context)).flat();
    const f = this.exprSynths.map((e) => e.false(context)).flat();
    return complement([...complement(n), ...f]);
  }
}

class CaseSynth extends BoolExprSynth {
  private exprSynths: BoolExprSynth[];
  public constructor(e: BoolExprSynth[]) {
    super();
    this.exprSynths = e;
  }
  public true(context: Context): Minterm[] {
    const minterms: Minterm[] = [];
    const cumulative: Minterm[] = [];
    for (let i = 0; i < this.exprSynths.length; i += 2) {
      const w = this.exprSynths[i].true(context);
      const t = this.exprSynths[i + 1].true(context);
      minterms.push(
        ...complement([...cumulative, ...complement(w), ...complement(t)])
      );
      if (i < this.exprSynths.length - 2) {
        cumulative.push(
          ...complement([
            ...this.exprSynths[i].false(context),
            ...this.exprSynths[i].null(context),
          ])
        );
      }
    }
    return minterms;
  }
  public false(context: Context): Minterm[] {
    const minterms: Minterm[] = [];
    const cumulative: Minterm[] = [];
    for (let i = 0; i < this.exprSynths.length; i += 2) {
      const w = this.exprSynths[i].true(context);
      const t = this.exprSynths[i + 1].false(context);
      minterms.push(
        ...complement([...cumulative, ...complement(w), ...complement(t)])
      );
      if (i < this.exprSynths.length - 2) {
        cumulative.push(
          ...complement([
            ...this.exprSynths[i].false(context),
            ...this.exprSynths[i].null(context),
          ])
        );
      }
    }
    return minterms;
  }
  public null(context: Context): Minterm[] {
    const minterms: Minterm[] = [];
    const cumulative: Minterm[] = [];
    for (let i = 0; i < this.exprSynths.length; i += 2) {
      const w = this.exprSynths[i].true(context);
      const t = this.exprSynths[i + 1].null(context);
      minterms.push(
        ...complement([...cumulative, ...complement(w), ...complement(t)])
      );
      cumulative.push(
        ...complement([
          ...this.exprSynths[i].false(context),
          ...this.exprSynths[i].null(context),
        ])
      );
    }
    minterms.push(...complement([...cumulative]));
    return minterms;
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
          })
        );
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
    return (args.reduce(
      (previousValue, currentValue) => previousValue.add(currentValue),
      ADDITIVE_IDENTITY
    ) as unknown) as Expression;
  } else if (op === "*") {
    const args: Polynomial[] = [];
    for (let i = 1; i < exp.length; ++i) {
      const p = toPolynomial(exp[i]);
      if (p == null) return null;
      args.push(p);
    }
    return (args.reduce(
      (previousValue, currentValue) => previousValue.multiply(currentValue),
      MULTIPLICATIVE_IDENTITY
    ) as unknown) as Expression;
  } else if (op === "-") {
    const args: Polynomial[] = [];
    for (let i = 1; i < exp.length; ++i) {
      const p = toPolynomial(exp[i]);
      if (p == null) return null;
      args.push(p);
    }
    return (args.reduce((previousValue, currentValue) =>
      previousValue.subtract(currentValue)
    ) as unknown) as Expression;
  } else if (op === "/") {
    const args: Polynomial[] = [];
    for (let i = 1; i < exp.length; ++i) {
      const p = toPolynomial(exp[i]);
      if (p == null) return null;
      args.push(p);
    }
    return (args.reduce((previousValue, currentValue) =>
      previousValue.divide(currentValue)
    ) as unknown) as Expression;
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
    e instanceof Polynomial ? JSON.parse(e.toString()) : e
  );

  exp = evaluateCallback(exp);

  return exp;
}

export function normalize(expr: Expression): Expression {
  expr = map(expr, normalizeCallback);
  if (expr instanceof Polynomial) {
    expr = JSON.parse(expr.toString());
  } else if (Array.isArray(expr) && expr[0] === "CASE") {
    expr = expr.map((e) =>
      e instanceof Polynomial ? JSON.parse(e.toString()) : e
    );
  }
  return expr;
}

function toBoolExprSynth(e: Expression | BoolExprSynth): BoolExprSynth {
  if (e instanceof BoolExprSynth) return e;
  if (Array.isArray(e)) {
    if (e[0] === "CASE")
      return new CaseSynth(e.slice(1).map((ee) => toBoolExprSynth(ee)));
    return new VarSynth(e);
  }
  if (e == null) return new NullSynth();
  if (e) return new TrueSynth();
  return new FalseSynth();
}

function sopToExpression(
  sop: number[][],
  expressions: Map<number, Expression>
): Expression {
  if (!sop.length) return false;
  const res: Expression[] = [];
  for (const s of sop) {
    if (!s.length) return true;
    const conjs: Expression[] = [];
    for (const i of s) {
      let expr = expressions.get(i >>> 2);
      if (!(i & 1) !== !(i & 2)) expr = ["NOT", expr];
      if (Array.isArray(expr) && expr[0] === "NOT" && Array.isArray(expr[1])) {
        const e: Expression[] = expr[1];
        if (e[0] === "IS NULL") expr = ["IS NOT NULL", ...e.slice(1)];
        else if (e[0] === "LIKE") expr = ["NOT LIKE", ...e.slice(1)];
        else if (e[0] === "=") expr = ["<>", ...e.slice(1)];
        else if (e[0] === "<>") expr = ["=", ...e.slice(1)];
        else if (e[0] === ">") expr = ["<=", ...e.slice(1)];
        else if (e[0] === ">=") expr = ["<", ...e.slice(1)];
        else if (e[0] === "<") expr = [">=", ...e.slice(1)];
        else if (e[0] === "<=") expr = [">", ...e.slice(1)];
        else if (e[0] === "NOT") expr = e[1];
        else expr = ["NOT", e];
      }
      conjs.push(expr);
    }
    if (conjs.length > 1) res.push(["AND" as any].concat(conjs));
    else res.push(conjs[0]);
  }
  if (res.length > 1) return ["OR" as any].concat(res);
  return res[0];
}

function generateDcSetAndIsNull(
  variables: Map<number, Expression>
): { dcSet: number[][]; isNull: Map<number, number> } {
  const relations: Map<
    string,
    { op: string; rhs: boolean | number | string; var: number }[]
  > = new Map();

  for (const [n, e] of variables) {
    const op = e[0] as string;
    if (["=", ">", "<"].includes(op) && !Array.isArray(e[2])) {
      const lhs = JSON.stringify(e[1]);
      let r = relations.get(lhs);
      if (!r) relations.set(lhs, (r = []));
      r.push({ op: op, rhs: e[2], var: n });
    } else if (op === "LIKE" && !Array.isArray(e[2]) && !Array.isArray(e[3])) {
      const lhs = JSON.stringify(e[1]);
      let r = relations.get(lhs);
      if (!r) relations.set(lhs, (r = []));
      r.push({ op: "", rhs: null, var: n });
    } else {
      const lhs = JSON.stringify(e);
      let r = relations.get(lhs);
      if (!r) relations.set(lhs, (r = []));
      r.push({ op: "", rhs: null, var: n });
    }
  }

  const dcSet: number[][] = [];
  const isNull: Map<number, number> = new Map();

  for (const [key, rels] of relations) {
    const n = variables.size;
    variables.set(n, ["IS NULL", JSON.parse(key)]);

    if (key === '["PARAM","DeviceID.ID"]' || key === '["PARAM","_id"]')
      dcSet.push([(n << 2) ^ 3]);

    const existingOps = new Map() as Map<string, Map<string, number>>;
    for (const rel of rels) {
      if (!rel.op) continue;
      const rhsStr = JSON.stringify(rel.rhs);
      const s = existingOps.get(rhsStr);
      if (s) s.set(rel.op, rel.var);
      else existingOps.set(rhsStr, new Map([[rel.op, rel.var]]));
    }

    for (const [k, v] of existingOps) {
      if (v.size > 1) {
        if (!v.has("=")) {
          const va = variables.size;
          variables.set(va, ["=", JSON.parse(key), JSON.parse(k)]);
          rels.push({ op: "=", rhs: JSON.parse(k), var: va });
          v.set("=", va);
        }

        if (!v.has(">")) {
          const va = variables.size;
          variables.set(va, [">", JSON.parse(key), JSON.parse(k)]);
          rels.push({ op: ">", rhs: JSON.parse(k), var: va });
          v.set(">", va);
        }

        if (!v.has("<")) {
          const va = variables.size;
          variables.set(va, ["<", JSON.parse(key), JSON.parse(k)]);
          rels.push({ op: "<", rhs: JSON.parse(k), var: va });
          v.set("<", va);
        }

        dcSet.push([
          (v.get("=") << 2) ^ 1,
          (v.get(">") << 2) ^ 1,
          (v.get("<") << 2) ^ 1,
        ]);
      }
    }

    for (let i = 0; i < rels.length; ++i) {
      const rel1 = rels[i];
      isNull.set(rel1.var, n);

      dcSet.push([(n << 2) ^ 3, (rel1.var << 2) ^ 1]);
      dcSet.push([(n << 2) ^ 3, (rel1.var << 2) ^ 3]);
      dcSet.push([(rel1.var << 2) ^ 0, (rel1.var << 2) ^ 2, (n << 2) ^ 2]);

      if (!rel1.op) continue;
      for (let j = i + 1; j < rels.length; ++j) {
        const rel2 = rels[j];
        if (!rel2.op) continue;
        let comp = 0;
        if (Array.isArray(rel1.rhs) || Array.isArray(rel2.rhs)) {
          if (JSON.stringify(rel1.rhs) !== JSON.stringify(rel2.rhs)) continue;
        } else if (typeof rel1.rhs === "string") {
          if (typeof rel2.rhs === "string") {
            if (rel1.rhs > rel2.rhs) comp = 1;
            else if (rel1.rhs < rel2.rhs) comp = -1;
          } else {
            comp = 1;
          }
        } else if (typeof rel2.rhs === "string") {
          comp = -1;
        } else {
          comp = +rel1.rhs - +rel2.rhs;
        }

        if (rel1.op === rel2.op) {
          if (comp === 0)
            dcSet.push([(rel1.var << 2) ^ 1, (rel2.var << 2) ^ 1]);
          else if (rel1.op === "=")
            dcSet.push([(rel1.var << 2) ^ 3, (rel2.var << 2) ^ 3]);
          else if (
            (rel1.op === ">" && comp > 0) ||
            (rel1.op === "<" && comp < 0)
          )
            dcSet.push([(rel1.var << 2) ^ 3, (rel2.var << 2) ^ 1]);
          else if (
            (rel1.op === "<" && comp > 0) ||
            (rel1.op === ">" && comp < 0)
          )
            dcSet.push([(rel1.var << 2) ^ 1, (rel2.var << 2) ^ 3]);
        } else if (rel1.op === "=" || rel2.op === "=") {
          let r1 = rel1,
            r2 = rel2,
            cmp = comp;
          if (rel1.op !== "=") {
            r2 = rel1;
            r1 = rel2;
            cmp = -comp;
          }
          if (r2.op === ">" || r2.op === "<") {
            if (cmp === 0) {
              dcSet.push([(r1.var << 2) ^ 3, (r2.var << 2) ^ 3]);
            } else {
              if ((cmp > 0 && r2.op === ">") || (cmp < 0 && r2.op === "<"))
                dcSet.push([(r1.var << 2) ^ 3, (r2.var << 2) ^ 1]);
              else dcSet.push([(r1.var << 2) ^ 3, (r2.var << 2) ^ 3]);
            }
          }
        } else if (
          [">", "<"].includes(rel1.op) &&
          [">", "<"].includes(rel2.op)
        ) {
          if ((rel1.op === ">" && comp < 0) || (rel1.op === "<" && comp > 0))
            dcSet.push([(rel1.var << 2) ^ 1, (rel2.var << 2) ^ 1]);
          else dcSet.push([(rel1.var << 2) ^ 3, (rel2.var << 2) ^ 3]);
        }
      }
    }
  }

  return { dcSet, isNull };
}

function sanitizeMinterms(
  minterms: number[][],
  isNull: Map<number, number>
): number[][] {
  const res = [] as number[][];
  loop: for (const m of minterms) {
    const merged: Map<number, number> = new Map();
    for (const i of m)
      merged.set(i >> 2, (merged.get(i >> 2) || 0) | (1 << (i & 3)));
    const minterm: number[] = [];
    const perms: number[][] = [];
    for (const [k, v] of merged) {
      if (v === 0b1010) continue loop;
      const n = isNull.get(k) << 2;
      const t = k << 2;
      if (v === 0b0101) minterm.push(n ^ 3);
      else if (v === 0b0001) perms.push([n ^ 3, t ^ 3]);
      else if (v === 0b0100) perms.push([n ^ 3, t ^ 1]);
      else if (v & 0b1000) minterm.push(t ^ 3);
      else if (v & 0b0010) minterm.push(t ^ 1);
    }
    let ms = [minterm];
    while (perms.length) {
      const newMs: number[][] = [];
      const perm = perms.pop();
      for (const p of perm) newMs.push(...ms.map((mm) => [...mm, p]));
      ms = newMs;
    }
    res.push(...ms);
  }
  return res;
}

function boolExprSynthToExpression(boolExpr: BoolExprSynth): Expression {
  const context: Map<string, number> = new Map();
  let minterms = boolExpr.true(context);
  const variables = new Map(
    Array.from(context).map(([k, v]) => [v, JSON.parse(k) as Expression])
  );
  const { dcSet, isNull } = generateDcSetAndIsNull(variables);
  minterms = sanitizeMinterms(minterms, isNull);

  const canRaise = getCanRaiseCallback(isNull);
  minterms = espresso(minterms, dcSet, { canRaise });
  return sopToExpression(minterms, variables);
}

function mapCallback(exp: Expression | BoolExprSynth): Expression {
  if (!Array.isArray(exp)) return exp as Expression;
  if (exp[0] === "CASE") {
    exp = exp.slice();
    for (let i = 1; i < exp.length; i += 2) exp[i] = toBoolExprSynth(exp[i]);
    return exp;
  }

  const op = exp[0];
  if (op === "IS NULL")
    return (new IsNullSynth(toBoolExprSynth(exp[1])) as unknown) as Expression;

  if (op === "IS NOT NULL") {
    return (new NotSynth(
      new IsNullSynth(toBoolExprSynth(exp[1]))
    ) as unknown) as Expression;
  } else if (op === "NOT") {
    return (new NotSynth(toBoolExprSynth(exp[1])) as unknown) as Expression;
  } else if (op === "OR") {
    return (new OrSynth(
      ...exp.slice(1).map((a) => toBoolExprSynth(a))
    ) as unknown) as Expression;
  } else if (op === "AND") {
    return (new AndSynth(
      ...exp.slice(1).map((a) => toBoolExprSynth(a))
    ) as unknown) as Expression;
  }
  for (let i = 1; i < exp.length; ++i) {
    if (exp[i] instanceof BoolExprSynth) {
      exp[i] = boolExprSynthToExpression(exp[i]);
    } else if (Array.isArray(exp[i]) && exp[i][0] === "CASE") {
      for (let j = 2; j < exp[i].length; j += 2) {
        if (exp[i][j] instanceof BoolExprSynth)
          exp[i][j] = boolExprSynthToExpression(exp[i][j]);
      }
    }
  }
  return exp;
}

function getCanRaiseCallback(
  isNull: Map<number, number>
): (idx: number, set: Set<number>) => boolean {
  return (idx: number, set: Set<number>): boolean => {
    const i = idx >> 2;
    const n = isNull.get(i);
    if (n != null) {
      if (!(idx & 1)) return true;
      if (set.has((n << 2) ^ 2)) return true;
      if (set.has((n << 2) ^ 3)) return true;
      return !set.has(idx ^ 3);
    }
    for (const [k, v] of isNull) {
      if (v !== i) continue;
      if (set.has((k << 2) ^ 1)) continue;
      if (set.has((k << 2) ^ 3)) continue;
      if (set.has((k << 2) ^ 0)) return false;
      if (set.has((k << 2) ^ 2)) return false;
    }
    return true;
  };
}

export function minimize(expr: Expression, boolean = false): Expression {
  expr = normalize(expr);
  expr = map(expr, mapCallback);
  if (Array.isArray(expr) && expr[0] === "CASE") {
    if (!boolean) {
      const context: Map<string, number> = new Map();
      const whens = expr.filter((e, i) => i % 2).map((e) => e.true(context));
      const variables = new Map(
        Array.from(context).map(([k, v]) => [v, JSON.parse(k) as Expression])
      );
      const { dcSet, isNull } = generateDcSetAndIsNull(variables);
      const canRaise = getCanRaiseCallback(isNull);
      const res: Expression = ["CASE"];
      for (let i = 1; i < expr.length; i += 2) {
        let minterms = sanitizeMinterms(whens[(i - 1) / 2], isNull);
        minterms = espresso(minterms, dcSet, { canRaise });
        if (!minterms.length) continue;
        const w = sopToExpression(minterms, variables);
        let t = expr[i + 1];
        if (t instanceof BoolExprSynth) t = boolExprSynthToExpression(t);
        res.push(w, t);
        if (w === true) break;
        dcSet.push(...minterms);
      }
      while (res[res.length - 1] == null) res.splice(-2);
      if (res.length < 3) return null;
      return res;
    }
    expr = (toBoolExprSynth(expr) as unknown) as Expression;
  }

  if (boolean) expr = (toBoolExprSynth(expr) as unknown) as Expression;

  if (expr instanceof BoolExprSynth) expr = boolExprSynthToExpression(expr);
  return expr;
}

export function unionDiff(
  expr1: Expression,
  expr2: Expression
): [Expression, Expression] {
  expr2 = normalize(expr2);

  if (!expr2) return [expr1, false];

  expr2 = map(expr2, mapCallback);

  if (!expr1) {
    if (Array.isArray(expr2) && expr2[0] === "CASE")
      expr2 = (toBoolExprSynth(expr2) as unknown) as Expression;
    if (expr2 instanceof BoolExprSynth)
      expr2 = boolExprSynthToExpression(expr2);
    return [expr2, expr2];
  }

  const b2 = toBoolExprSynth(expr2);
  expr1 = normalize(expr1);
  expr1 = map(expr1, mapCallback);
  const b1 = toBoolExprSynth(expr1);

  const context: Map<string, number> = new Map();

  const expr2Minterms = b2.true(context);
  const expr1Minterms = b1.true(context);
  const expr1NullMinterms = b1.null(context);
  const expr1FalseMinterms = b1.false(context);
  const variables = new Map(
    Array.from(context).map(([k, v]) => [v, JSON.parse(k) as Expression])
  );
  const { dcSet, isNull } = generateDcSetAndIsNull(variables);

  const unionMinterms = sanitizeMinterms(
    [...expr1Minterms, ...expr2Minterms],
    isNull
  );
  const diffMinterms = sanitizeMinterms(
    complement([
      ...complement([...expr1NullMinterms, ...expr1FalseMinterms]),
      ...complement(expr2Minterms),
    ]),
    isNull
  );

  const canRaise = getCanRaiseCallback(isNull);

  const union = espresso(unionMinterms, dcSet, { canRaise });
  const diff = espresso(diffMinterms, dcSet, { canRaise });

  return [sopToExpression(union, variables), sopToExpression(diff, variables)];
}

export function covers(expr1: Expression, expr2: Expression): boolean {
  expr2 = normalize(expr2);
  if (!expr2) return true;
  expr1 = normalize(expr1);
  if (!Array.isArray(expr1)) return !!expr1;

  expr1 = map(expr1, mapCallback);
  const b1 = toBoolExprSynth(expr1);
  expr2 = map(expr2, mapCallback);
  const b2 = toBoolExprSynth(expr2);

  const context: Map<string, number> = new Map();
  const expr1Minterms = b1.true(context);
  const expr2Minterms = b2.true(context);
  const variables = new Map(
    Array.from(context).map(([k, v]) => [v, JSON.parse(k) as Expression])
  );
  const { dcSet } = generateDcSetAndIsNull(variables);

  return tautology([...complement(expr2Minterms), ...dcSet, ...expr1Minterms]);
}
