import { espresso, complement, tautology } from "espresso-iisojs";
import { Expression } from "../../types.ts";
import normalize from "./normalize.ts";
import { map, parseLikePattern } from "./parser.ts";

type Minterm = number[];

export abstract class SynthContextBase<
  T extends { toString: () => string } = unknown,
  U = unknown,
> {
  public variables = new Map<string, number>();
  protected clauses = new Map<number, U>();

  public getVar(c: U): number {
    const str = c.toString();
    let idx = this.variables.get(str);
    if (idx == null) {
      idx = this.variables.size;
      this.variables.set(str, idx);
      this.clauses.set(idx, c);
    }
    return idx;
  }

  public getClause(v: number): U {
    return this.clauses.get(v);
  }

  abstract getMinterms(exp: T, res: true | false | null): Minterm[];
  abstract getDcSet(minterms: Minterm[]): Minterm[];
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  canRaise(idx: number, set: Set<number>): boolean {
    return true;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  canLower(idx: number, set: Set<number>): boolean {
    return true;
  }

  bias(a: number, b: number): number {
    // Bias towards 1 then lower index
    return (b ^ 1) - (a ^ 1);
  }

  sanitizeMinterms(minterms: Minterm[]): Minterm[] {
    return minterms;
  }

  minimize(minterms: Minterm[], dcSet: Minterm[] = []): Minterm[] {
    minterms = this.sanitizeMinterms(minterms);
    const canRaise = this.canRaise.bind(this);
    const canLower = this.canLower.bind(this);
    const bias = this.bias.bind(this);

    return espresso(
      minterms,
      [...this.getDcSet([...minterms, ...dcSet]), ...dcSet],
      {
        canRaise,
        canLower,
        bias,
      },
    );
  }
}

function* findIsNullDeps(exp: Expression): IterableIterator<Expression> {
  if (!Array.isArray(exp)) return;
  const op = exp[0];
  if (op === "IS NULL" || op === "IS NOT NULL") return;

  if (op === "FUNC") {
    if (exp[1] === "NOW") {
      return;
    } else if (exp[1] === "LOWER" || exp[1] === "UPPER") {
      yield* findIsNullDeps(exp[2]);
    } else if (exp[1] === "ROUND") {
      for (const e of exp.slice(2, 4)) yield* findIsNullDeps(e);
      return;
    }
  } else if (op !== "PARAM") {
    for (const e of exp.slice(1)) yield* findIsNullDeps(e);
    return;
  }
  yield exp;
}

export abstract class Clause {
  private _isNullable: Set<string>;
  protected _expression: Expression;
  abstract true(context: SynthContextBase<Clause>): Minterm[];
  abstract false(context: SynthContextBase<Clause>): Minterm[];
  abstract null(context: SynthContextBase<Clause>): Minterm[];
  expression(): Expression {
    if (this._expression !== undefined) return this._expression;
    const context = createSynthContext();
    const minterms = this.true(context);
    const minimized = context.minimize(minterms);
    this._expression = context.toExpression(minimized) as Expression;
    return this._expression;
  }
  isBoolean(): boolean {
    return true;
  }
  isNullable(c: Clause.IsNull): boolean {
    if (!this._isNullable) {
      this._isNullable = new Set(
        [...this.getNullables()].map((n) => n.toString()),
      );
    }
    return this._isNullable.has(c.toString());
  }
  *getNullables(): IterableIterator<Clause.IsNull> {
    const exp = this.expression();
    for (const e of findIsNullDeps(exp)) {
      if (e === exp) yield new Clause.IsNull(this);
      else yield new Clause.IsNull(new Clause.Exp(e));
    }
  }
  toString(): string {
    return JSON.stringify(this.expression());
  }
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace Clause {
  export class Not extends Clause {
    constructor(public operand: Clause) {
      super();
    }
    true(context: SynthContextBase<Clause>): Minterm[] {
      return this.operand.false(context);
    }
    false(context: SynthContextBase<Clause>): Minterm[] {
      return this.operand.true(context);
    }
    null(context: SynthContextBase<Clause>): Minterm[] {
      return this.operand.null(context);
    }
  }

  export class Or extends Clause {
    constructor(public operands: Clause[]) {
      super();
    }
    true(context: SynthContextBase<Clause>): Minterm[] {
      const minterms: Minterm[] = [];
      for (const s of this.operands) {
        const m = s.true(context);
        if (m.length === 1 && !m[0].length) return [[]];
        minterms.push(...m);
      }
      return minterms;
    }
    false(context: SynthContextBase<Clause>): Minterm[] {
      const minterms: Minterm[][] = [];
      const operands = [...this.operands];
      for (const e of operands) {
        if (e instanceof Or) {
          operands.push(...e.operands);
          continue;
        }
        const m = e.false(context);
        if (!m.length) return [];
        minterms.push(m);
      }
      if (!minterms.length) return [[]];
      if (minterms.length === 1) return minterms[0];
      return complement(minterms.map((m) => complement(m)).flat());
    }
    null(context: SynthContextBase<Clause>): Minterm[] {
      const trueMinterms: Minterm[] = [];
      const operands = [...this.operands];
      for (const s of operands) {
        if (s instanceof Or) {
          operands.push(...s.operands);
          continue;
        }
        const t = s.true(context);
        if (t.length === 1 && !t[0].length) return [];
        trueMinterms.push(...t);
      }

      const nullMinterms: Minterm[] = [];
      for (const s of operands) {
        const n = s.null(context);
        if (n.length === 1 && !n[0].length && !trueMinterms.length) return [[]];
        nullMinterms.push(...n);
      }

      if (!trueMinterms.length) return nullMinterms;
      return complement([...complement(nullMinterms), ...trueMinterms]);
    }
  }

  export class And extends Clause {
    constructor(public operands: Clause[]) {
      super();
    }
    true(context: SynthContextBase<Clause>): Minterm[] {
      const minterms: Minterm[][] = [];
      const operands = [...this.operands];
      for (const s of operands) {
        if (s instanceof And) {
          operands.push(...s.operands);
          continue;
        }
        const m = s.true(context);
        if (!m.length) return [];
        if (m.length === 1 && !m[0].length) continue;
        minterms.push(m);
      }
      if (!minterms.length) return [[]];
      if (minterms.length === 1) return minterms[0];
      return complement(minterms.map((m) => complement(m)).flat());
    }
    false(context: SynthContextBase<Clause>): Minterm[] {
      const minterms: Minterm[] = [];
      for (const s of this.operands) {
        const m = s.false(context);
        if (m.length === 1 && !m[0].length) return [[]];
        minterms.push(...m);
      }
      return minterms;
    }
    null(context: SynthContextBase<Clause>): Minterm[] {
      const falseMinterms: Minterm[] = [];
      const operands = [...this.operands];
      for (const s of operands) {
        if (s instanceof And) {
          operands.push(...s.operands);
          continue;
        }
        const f = s.false(context);
        if (f.length === 1 && !f[0].length) return [];
        falseMinterms.push(...f);
      }

      const nullMinterms: Minterm[] = [];
      for (const s of operands) {
        const n = s.null(context);
        if (n.length === 1 && !n[0].length && !falseMinterms.length)
          return [[]];
        nullMinterms.push(...n);
      }

      if (!falseMinterms.length) return nullMinterms;
      return complement([...complement(nullMinterms), ...falseMinterms]);
    }
  }

  export class Case extends Clause {
    constructor(public clauses: Clause[]) {
      super();
    }
    true(context: SynthContextBase<Clause>): Minterm[] {
      const minterms: Minterm[] = [];
      const cumulative: Minterm[] = [];
      for (let i = 0; i < this.clauses.length; i += 2) {
        const w = this.clauses[i].true(context);
        const t = this.clauses[i + 1].true(context);
        minterms.push(
          ...complement([...cumulative, ...complement(w), ...complement(t)]),
        );
        if (i < this.clauses.length - 2) {
          cumulative.push(
            ...complement([
              ...this.clauses[i].false(context),
              ...this.clauses[i].null(context),
            ]),
          );
        }
      }
      return minterms;
    }
    false(context: SynthContextBase<Clause>): Minterm[] {
      const minterms: Minterm[] = [];
      const cumulative: Minterm[] = [];
      for (let i = 0; i < this.clauses.length; i += 2) {
        const w = this.clauses[i].true(context);
        const t = this.clauses[i + 1].false(context);
        minterms.push(
          ...complement([...cumulative, ...complement(w), ...complement(t)]),
        );
        if (i < this.clauses.length - 2) {
          cumulative.push(
            ...complement([
              ...this.clauses[i].false(context),
              ...this.clauses[i].null(context),
            ]),
          );
        }
      }
      return minterms;
    }
    null(context: SynthContextBase<Clause>): Minterm[] {
      const minterms: Minterm[] = [];
      const cumulative: Minterm[] = [];
      for (let i = 0; i < this.clauses.length; i += 2) {
        const w = this.clauses[i].true(context);
        const t = this.clauses[i + 1].null(context);
        minterms.push(
          ...complement([...cumulative, ...complement(w), ...complement(t)]),
        );
        cumulative.push(
          ...complement([
            ...this.clauses[i].false(context),
            ...this.clauses[i].null(context),
          ]),
        );
      }
      minterms.push(...complement([...cumulative]));
      return minterms;
    }
    expression(): Expression {
      if (this._expression != null) return this._expression;
      if (this.isBoolean()) {
        this._expression = new Clause.Not(new Clause.Not(this)).expression();
        return this._expression;
      }
      const context = createSynthContext();
      const cases: { when: Minterm[]; then: Expression }[] = [];
      for (let i = 0; i < this.clauses.length; i += 2) {
        let minterms = this.clauses[i].true(context);
        const then = this.clauses[i + 1].expression();
        if (
          cases.length &&
          JSON.stringify(then) === JSON.stringify(cases[cases.length - 1].then)
        )
          minterms.push(...cases.pop().when);
        minterms = context.minimize(
          minterms,
          cases.flatMap((c) => c.when),
        );
        if (!minterms.length) continue;
        cases.push({ when: minterms, then });
        if (minterms.length === 1 && !minterms[0].length) break;
      }
      while (cases[cases.length - 1].then == null) cases.pop();
      if (!cases.length) return null;
      this._expression = [
        "CASE",
        ...cases.flatMap((c) => [context.toExpression(c.when), c.then]),
      ];
      return this._expression;
    }

    isBoolean(): boolean {
      for (let i = 1; i < this.clauses.length; i += 2)
        if (!this.clauses[i].isBoolean()) return false;
      return true;
    }
  }

  export class IsNull extends Clause {
    private _boolean: Clause;
    constructor(public operand: Clause) {
      super();
      this._boolean = new Not(new Not(this));
    }
    true(context: SynthContextBase<Clause>): Minterm[] {
      return this.operand.null(context);
    }
    false(context: SynthContextBase<Clause>): Minterm[] {
      return complement(this.true(context));
    }
    null(): Minterm[] {
      return [];
    }
    isBoolean(): boolean {
      return true;
    }
    *getNullables(): IterableIterator<IsNull> {
      // Never returns null
    }
    expression(): Expression {
      const nullables = [...this.operand.getNullables()];
      if (nullables.length === 1 && nullables[0].operand === this.operand)
        return ["IS NULL", this.operand.expression()];
      return super.expression();
    }
  }

  export class Exp extends Clause {
    constructor(public exp: Expression) {
      super();
    }
    true(context: SynthContextBase<Clause>): Minterm[] {
      if (Array.isArray(this.exp)) return context.getMinterms(this, true);
      if (this.exp) return [[]];
      return [];
    }
    false(context: SynthContextBase<Clause>): Minterm[] {
      if (Array.isArray(this.exp)) return context.getMinterms(this, false);
      if (!this.exp && this.exp != null) return [[]];
      return [];
    }
    null(context: SynthContextBase<Clause>): Minterm[] {
      if (Array.isArray(this.exp)) return context.getMinterms(this, null);
      if (this.exp == null) return [[]];
      return [];
    }
    expression(): Expression {
      return this.exp;
    }
    isBoolean(): boolean {
      return this.exp === true || this.exp === false || this.exp == null;
    }
  }

  export class Compare extends Clause {
    constructor(
      public lhs: Clause,
      public op: ">" | "<" | "=",
      public rhs: boolean | number | string,
    ) {
      super();
    }
    true(context: SynthContextBase<Clause>): Minterm[] {
      return context.getMinterms(this, true);
    }
    false(context: SynthContextBase<Clause>): Minterm[] {
      return context.getMinterms(this, false);
    }
    null(context: SynthContextBase<Clause>): Minterm[] {
      return this.lhs.null(context);
    }
    *getNullables(): IterableIterator<IsNull> {
      yield* this.lhs.getNullables();
    }
    isBoolean(): boolean {
      return true;
    }
    expression(): Expression {
      return [this.op, this.lhs.expression(), this.rhs];
    }
  }

  export class Like extends Clause {
    public readonly caseSensitive: boolean;
    public readonly contradiction: boolean;
    public readonly pattern: string[];
    public readonly lhs: Clause;

    constructor(
      lhs: Clause,
      public rhs: string,
      public esc?: string,
    ) {
      super();
      const exp = lhs.expression();
      let caseSensitive = true;
      let contradiction = false;
      if (Array.isArray(exp)) {
        if (exp[0] === "FUNC") {
          const func = exp[1];
          if (func === "UPPER" || func === "LOWER") {
            const p = func === "UPPER" ? rhs.toUpperCase() : rhs.toLowerCase();
            if (p === rhs) caseSensitive = false;
            else contradiction = true;
            lhs = new Exp(exp[2]);
          }
        }
      }
      this.lhs = lhs;
      this.pattern = parseLikePattern(rhs, esc);
      this.caseSensitive = caseSensitive;
      this.contradiction = contradiction;
    }
    true(context: SynthContextBase<Clause>): Minterm[] {
      return context.getMinterms(this, true);
    }
    false(context: SynthContextBase<Clause>): Minterm[] {
      return context.getMinterms(this, false);
    }
    null(context: SynthContextBase<Clause>): Minterm[] {
      return this.lhs.null(context);
    }
    isBoolean(): boolean {
      return true;
    }
    isNullable(c: IsNull): boolean {
      return this.lhs.isNullable(c);
    }
    getNullables(): IterableIterator<IsNull> {
      return this.lhs.getNullables();
    }
    expression(): Expression {
      let lhs = this.lhs.expression();
      if (this.contradiction) {
        if (this.rhs === this.rhs.toLocaleUpperCase())
          lhs = ["FUNC", "LOWER", lhs];
        else lhs = ["FUNC", "UPPER", lhs];
      } else if (!this.caseSensitive) {
        if (this.rhs === this.rhs.toLocaleUpperCase())
          lhs = ["FUNC", "UPPER", lhs];
        else lhs = ["FUNC", "LOWER", lhs];
      }
      return ["LIKE", lhs, this.rhs, ...(this.esc ? [this.esc] : [])];
    }
  }

  export function fromExpression(exp: Expression): Clause {
    const res = map(exp, (e) => {
      if (!Array.isArray(e)) return new Clause.Exp(e);
      let op = e[0];
      let negate = true;
      if (op === "NOT LIKE") op = "LIKE";
      else if (op === "IS NOT NULL") op = "IS NULL";
      else if (op === "<>") op = "=";
      else if (op === ">=") op = "<";
      else if (op === "<=") op = ">";
      else negate = false;

      let clause: Clause;
      if (op === "IS NULL") {
        clause = new Clause.IsNull(e[1]);
      } else if (op === "NOT") {
        clause = new Clause.Not(e[1]);
      } else if (op === "OR") {
        clause = new Clause.Or(e.slice(1));
      } else if (op === "AND") {
        clause = new Clause.And(e.slice(1));
      } else if (op === "CASE") {
        clause = new Clause.Case(e.slice(1));
      } else if (op === "LIKE") {
        const rhs = e[2] instanceof Exp ? e[2].expression() : null;
        const esc = e[3] instanceof Exp ? e[3].expression() : null;
        if (typeof rhs === "string" && typeof esc === "string")
          clause = new Clause.Like(e[1], rhs, esc);
        else if (typeof rhs === "string" && esc == null)
          clause = new Clause.Like(e[1], rhs);
      } else if (op === ">" || op === "<" || op === "=") {
        const rhs = e[2] instanceof Exp ? e[2].expression() : null;
        if (["boolean", "number", "string"].includes(typeof rhs)) {
          clause = new Clause.Compare(
            e[1],
            op,
            rhs as boolean | number | string,
          );
        }
      }

      if (!clause) {
        const args = e.slice(1).map((a) => (a as Clause).expression());
        clause = new Clause.Exp([op, ...args]);
      }

      if (negate) clause = new Clause.Not(clause);
      return clause;
    });

    return res;
  }
}

function groupBy<T, K>(
  input: T[],
  callback: (item: T) => K,
): Iterable<[K, T[]]> {
  const groups = new Map<K, T[]>();
  for (const item of input) {
    const key = callback(item);
    let arr = groups.get(key);
    if (!arr) groups.set(key, (arr = []));
    arr.push(item);
  }

  return groups.entries();
}

export class SynthContext extends SynthContextBase<Clause, Clause> {
  constructor() {
    super();
  }

  getMinterms(clause: Clause, res: true | false | null): number[][] {
    const v = this.getVar(clause);
    if (res === true) return [[(v << 2) ^ 3]];
    else if (res === false) return [[(v << 2) ^ 1]];
    else return [[v << 2, (v << 2) ^ 2]];
  }

  getDcSet(minterms: Minterm[]): number[][] {
    const dcSet: number[][] = [];

    const whitelist = new Set([...minterms.flat()].map((v) => v >> 2));

    const allClauses = [...whitelist].map((v) => this.getClause(v));
    const comparisons = allClauses.filter(
      (c) => c instanceof Clause.Compare,
    ) as Clause.Compare[];

    // Comparisons
    for (const [, clauses] of groupBy(comparisons, (c) =>
      JSON.stringify(c.lhs),
    )) {
      const lhs = clauses[0].lhs;
      const values = new Set(clauses.map((c) => c.rhs));
      const valuesSorted = [...values].sort((a, b) => {
        const ta = typeof a;
        const tb = typeof b;
        if (ta === tb) return a > b ? 1 : -1;
        else if (ta === "string") return 1;
        else if (tb === "string") return -1;
        return +a - +b;
      });

      for (const [i, v] of valuesSorted.entries()) {
        const eq = this.getVar(new Clause.Compare(lhs, "=", v));
        const gt = this.getVar(new Clause.Compare(lhs, ">", v));
        const lt = this.getVar(new Clause.Compare(lhs, "<", v));

        dcSet.push([(eq << 2) ^ 3, (gt << 2) ^ 3]);
        dcSet.push([(lt << 2) ^ 3, (gt << 2) ^ 3]);
        dcSet.push([(lt << 2) ^ 3, (eq << 2) ^ 3]);
        dcSet.push([(lt << 2) ^ 1, (eq << 2) ^ 1, (gt << 2) ^ 1]);

        const negEquivOp = [lt, eq, gt].filter((o) => !whitelist.has(o));
        if (negEquivOp.length === 1) whitelist.add(negEquivOp[0]);

        for (let j = 0; j < i; j++) {
          const eq2 = this.getVar(
            new Clause.Compare(lhs, "=", valuesSorted[j]),
          );
          const gt2 = this.getVar(
            new Clause.Compare(lhs, ">", valuesSorted[j]),
          );
          const lt2 = this.getVar(
            new Clause.Compare(lhs, "<", valuesSorted[j]),
          );

          // This is the minimum clauses required if all relavent vars
          // were included in the DC set.
          // dcSet.push([(eq << 2) ^ 3, (eq2 << 2) ^ 3]);
          // dcSet.push([(lt << 2) ^ 1, (gt2 << 2) ^ 1]);

          // But we use non-minimal set because intermediate vars
          // between any two may not be present in the DC set.
          dcSet.push([(gt2 << 2) ^ 1, (lt << 2) ^ 1]);
          dcSet.push([(eq2 << 2) ^ 3, (lt << 2) ^ 1]);
          dcSet.push([(lt2 << 2) ^ 3, (lt << 2) ^ 1]);
          dcSet.push([(gt2 << 2) ^ 1, (gt << 2) ^ 3]);
          dcSet.push([(gt2 << 2) ^ 1, (eq << 2) ^ 3]);
          dcSet.push([(eq2 << 2) ^ 3, (gt << 2) ^ 3]);
          dcSet.push([(eq2 << 2) ^ 3, (eq << 2) ^ 3]);
          dcSet.push([(lt2 << 2) ^ 3, (gt << 2) ^ 3]);
          dcSet.push([(lt2 << 2) ^ 3, (eq << 2) ^ 3]);
        }
      }
    }

    // LIKE
    const likes = allClauses.filter(
      (c) => c instanceof Clause.Like,
    ) as Clause.Like[];

    for (const [, clauses] of groupBy(likes, (c) => JSON.stringify(c.lhs))) {
      for (let i1 = 0; i1 < clauses.length; ++i1) {
        const l1 = clauses[i1];
        if (l1.contradiction) {
          dcSet.push([(this.getVar(l1) << 2) ^ 3]);
          continue;
        }
        for (let i2 = i1 + 1; i2 < clauses.length; ++i2) {
          const l2 = clauses[i2];
          if (l2.contradiction) continue;
          let p1 = l1.pattern;
          let p2 = l2.pattern;
          if (!l1.caseSensitive || !l2.caseSensitive) {
            p1 = p1.map((c) => c.toLowerCase());
            p2 = p2.map((c) => c.toLowerCase());
          }
          if (likeDisjoint(p1, p2)) {
            dcSet.push([
              (this.getVar(l1) << 2) ^ 3,
              (this.getVar(l2) << 2) ^ 3,
            ]);
          } else if (
            (!l1.caseSensitive || l2.caseSensitive) &&
            likeImplies(p1, p2)
          ) {
            dcSet.push([
              (this.getVar(l1) << 2) ^ 2,
              (this.getVar(l2) << 2) ^ 3,
            ]);
            dcSet.push([
              (this.getVar(l1) << 2) ^ 1,
              (this.getVar(l2) << 2) ^ 0,
            ]);
          } else if (
            (!l2.caseSensitive || l1.caseSensitive) &&
            likeImplies(p2, p1)
          ) {
            dcSet.push([
              (this.getVar(l1) << 2) ^ 3,
              (this.getVar(l2) << 2) ^ 2,
            ]);
            dcSet.push([
              (this.getVar(l1) << 2) ^ 0,
              (this.getVar(l2) << 2) ^ 1,
            ]);
          }
        }
      }
    }

    for (const v of whitelist) {
      const clause = this.getClause(v);
      const nullables = [...clause.getNullables()].map((c) => this.getVar(c));
      if (nullables.length) {
        dcSet.push([
          ...nullables.map((n) => (n << 2) ^ 2),
          (v << 2) ^ 0,
          (v << 2) ^ 2,
        ]);
        for (const n of nullables) {
          dcSet.push([(n << 2) ^ 3, (v << 2) ^ 1]);
          dcSet.push([(n << 2) ^ 3, (v << 2) ^ 3]);
          whitelist.add(n);
        }
      }

      if (clause instanceof Clause.IsNull) {
        const str = clause.operand.toString();
        if (str === '["PARAM","DeviceID.ID"]' || str === '["PARAM","_id"]')
          dcSet.push([(v << 2) ^ 3]);
      }
    }
    return dcSet.filter((m) => m.every((v) => whitelist.has(v >> 2)));
  }

  canRaise(idx: number, set: Set<number>): boolean {
    const clause = this.getClause(idx >> 2);
    if (clause instanceof Clause.IsNull) {
      for (const i of set) {
        if (i === idx || i & 1) continue;
        const c = this.getClause(i >> 2);
        if (c.isNullable(clause)) return false;
      }
      return true;
    }
    return !(idx & 1) || !set.has(idx ^ 3);
  }

  canLower(idx: number, set: Set<number>): boolean {
    if (idx & 1) return true;
    const clause = this.getClause(idx >> 2);
    if (clause instanceof Clause.IsNull) return true;
    return set.has(idx ^ 3) || set.has(idx ^ 1);
  }

  bias(a: number, b: number): number {
    // Bias towards 1 then true
    return ((b & 3) ^ 3) - ((a & 3) ^ 3);
  }

  sanitizeMinterms(minterms: Minterm[]): Minterm[] {
    const res = [] as number[][];

    loop: for (const m of minterms) {
      const merged: Map<number, number> = new Map();
      for (const i of m)
        merged.set(i >> 2, (merged.get(i >> 2) || 0) | (1 << (i & 3)));
      const minterm: number[] = [];
      const perms: number[][] = [];
      for (const [k, v] of merged) {
        if ((v & 0b0011) === 0b0011) continue loop;
        if ((v & 0b1100) === 0b1100) continue loop;
        const clause = this.clauses.get(k);
        if (!clause) throw new Error("Invalid literal");
        if (clause instanceof Clause.IsNull) {
          if (v === 0b0100) minterm.push((k << 2) ^ 2);
          else if (v === 0b1000) minterm.push((k << 2) ^ 3);
          else throw new Error("Invalid literal");
          continue;
        }
        if ((v & 0b1010) === 0b1010) continue loop;
        const isNullVars = [...clause.getNullables()].map((c) =>
          this.getVar(c),
        );
        const t = k << 2;
        if (v === 0b0101) {
          if (isNullVars.length === 1) minterm.push((isNullVars[0] << 2) ^ 3);
          else perms.push(isNullVars.map((n) => (n << 2) ^ 3));
        } else if (v === 0b0001) {
          perms.push([...isNullVars.map((n) => (n << 2) ^ 3), t ^ 3]);
        } else if (v === 0b0100) {
          perms.push([...isNullVars.map((n) => (n << 2) ^ 3), t ^ 1]);
        } else if (v & 0b1000) {
          minterm.push(t ^ 3);
        } else if (v & 0b0010) {
          minterm.push(t ^ 1);
        }
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

  toExpression(sop: number[][]): Expression {
    if (!sop.length) return false;
    const res: Expression[] = [];
    for (const s of sop) {
      if (!s.length) return true;
      const conjs: Expression[] = [];
      for (const i of s) {
        const clause = this.getClause(i >>> 2);
        if (!clause) throw new Error("Invalid literal");
        if (clause instanceof Clause.IsNull) {
          if (!(i & 2)) throw new Error("Invalid literal");
        } else if (!(i & 1)) {
          // Should never be reached if minimized correctly
          const isNullVars = [...clause.getNullables()].map((c) =>
            this.getVar(c),
          );
          conjs.push(
            this.toExpression([
              [i ^ 3],
              ...isNullVars.map((n) => [(n << 2) ^ 3]),
            ]),
          );
          continue;
        }

        let expr = clause.expression() as Expression;
        if (!(i & 1) !== !(i & 2)) expr = ["NOT", expr];
        if (
          Array.isArray(expr) &&
          expr[0] === "NOT" &&
          Array.isArray(expr[1])
        ) {
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
        }
        conjs.push(expr);
      }
      if (conjs.length > 1) res.push(["AND", ...conjs]);
      else res.push(conjs[0]);
    }
    if (res.length > 1) return ["OR", ...res];
    return res[0];
  }
}

// Classes aren't hoisted in JS but functions are. This function is used to
// create a new SynthContext instance from inside the Clause class.
export function createSynthContext(): SynthContext {
  return new SynthContext();
}

export function likeImplies(pat1: string[], pat2: string[]): boolean {
  let backtrack: [number, number] = null;

  for (let i1 = 0, i2 = 0; ; ++i1, ++i2) {
    while (i1 < pat1.length && pat1[i1] === "\\%") backtrack = [i1++, i2];

    if (i2 >= pat2.length) return i1 >= pat1.length;

    const c = i1 < pat1.length ? pat1[i1] : null;

    if (c !== pat2[i2] && c !== "\\_") {
      if (!backtrack) return false;
      [i1, i2] = backtrack;
      ++backtrack[1];
    }
  }
}

export function likeDisjoint(pat1: string[], pat2: string[]): boolean {
  const left1Idx = pat1.indexOf("\\%");
  const left2Idx = pat2.indexOf("\\%");
  const right1Idx = pat1.lastIndexOf("\\%");
  const right2Idx = pat2.lastIndexOf("\\%");

  const left1 = pat1.slice(0, left1Idx !== -1 ? left1Idx : pat1.length);
  const left2 = pat2.slice(0, left2Idx !== -1 ? left2Idx : pat2.length);
  const right1 = pat1.slice(right1Idx !== -1 ? right1Idx + 1 : 0).reverse();
  const right2 = pat2.slice(right2Idx !== -1 ? right2Idx + 1 : 0).reverse();

  for (let i = 0; i < Math.min(left1.length, left2.length); ++i) {
    if (left1[i] !== left2[i] && left1[i] !== "\\_" && left2[i] !== "\\_")
      return true;
  }

  for (let i = 0; i < Math.min(right1.length, right2.length); ++i) {
    if (right1[i] !== right2[i] && right1[i] !== "\\_" && right2[i] !== "\\_")
      return true;
  }

  if (pat1.length === left1.length)
    return pat2.filter((c) => c !== "\\%").length > pat1.length;
  else if (pat2.length === left2.length)
    return pat1.filter((c) => c !== "\\%").length > pat2.length;

  return false;
}

export function minimize(expr: Expression, boolean = false): Expression {
  let synth = Clause.fromExpression(normalize(expr));
  if (boolean) synth = new Clause.Not(new Clause.Not(synth));
  return synth.expression();
}

export function unionDiff(
  expr1: Expression,
  expr2: Expression,
): [Expression, Expression] {
  expr2 = normalize(expr2);

  if (!expr2) return [expr1, false];

  const synth2 = Clause.fromExpression(expr2);

  if (!expr1) {
    const e = synth2.expression();
    return [e, e];
  }

  expr1 = normalize(expr1);
  const synth1 = Clause.fromExpression(expr1);

  const context = new SynthContext();

  const expr2Minterms = synth2.true(context);
  const expr1Minterms = synth1.true(context);

  const union = context.minimize([...expr1Minterms, ...expr2Minterms]);

  const diff = context.minimize(
    complement([...expr1Minterms, ...complement(expr2Minterms)]),
  );

  return [context.toExpression(union), context.toExpression(diff)];
}

export function covers(expr1: Expression, expr2: Expression): boolean {
  expr2 = normalize(expr2);
  if (!expr2) return true;
  expr1 = normalize(expr1);
  if (!Array.isArray(expr1)) return !!expr1;

  const synt1 = Clause.fromExpression(expr1);
  const synt2 = Clause.fromExpression(expr2);

  const context = new SynthContext();
  const expr1Minterms = synt1.true(context);
  const expr2Minterms = synt2.true(context);

  return tautology([
    ...context.sanitizeMinterms(complement(expr2Minterms)),
    ...context.getDcSet([...expr2Minterms, ...expr1Minterms]),
    ...context.sanitizeMinterms(expr1Minterms),
  ]);
}
