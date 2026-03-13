import { espresso, complement, tautology } from "espresso-iisojs";
import Expression from "../expression.ts";
import { parseLikePattern } from "./parser.ts";
import normalize from "./normalize.ts";

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

  abstract getMinterms(exp: T, res: number): Minterm[];
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
  if (exp instanceof Expression.Literal) return;
  else if (exp instanceof Expression.Unary) {
    if (exp.operator === "IS NULL" || exp.operator === "IS NOT NULL") return;
    yield* findIsNullDeps(exp.operand);
  } else if (exp instanceof Expression.Binary) {
    yield* findIsNullDeps(exp.left);
    yield* findIsNullDeps(exp.right);
  } else if (exp instanceof Expression.FunctionCall) {
    if (exp.name === "NOW") return;
    else if (exp.name === "LOWER" || exp.name === "UPPER")
      yield* findIsNullDeps(exp.args[0]);
    else if (exp.name === "ROUND") {
      for (const e of exp.args.slice(0, 2)) yield* findIsNullDeps(e);
    }
  } else yield exp;
}

export abstract class Clause {
  private _isNullable: Set<string>;
  protected _expression: Expression;
  abstract getMinterms(
    context: SynthContextBase<Clause>,
    res: number,
  ): Minterm[];
  expression(): Expression {
    if (this._expression !== undefined) return this._expression;
    const context = createSynthContext();
    const minterms = this.getMinterms(context, 0b100);
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
    return this.expression().toString();
  }
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace Clause {
  export class Not extends Clause {
    constructor(public operand: Clause) {
      super();
    }
    getMinterms(context: SynthContextBase<Clause>, res: number): Minterm[] {
      let r = res & 0b001;
      if (res & 0b010) r |= 0b100;
      if (res & 0b100) r |= 0b010;
      return this.operand.getMinterms(context, r);
    }
  }

  export class And extends Clause {
    constructor(public operands: Clause[]) {
      super();
    }
    getMinterms(context: SynthContextBase<Clause>, res: number): Minterm[] {
      res = res & 0b111;
      if (!res) return [];
      if (res === 0b111) return [[]];

      if (res === 0b110)
        return [
          ...this.getMinterms(context, 0b010),
          ...this.getMinterms(context, 0b100),
        ];

      if (!(res & 0b010)) return complement(this.getMinterms(context, ~res));

      const minterms: Minterm[] = [];
      for (const o of this.operands) {
        const m = o.getMinterms(context, res);
        if (m.length === 1 && !m[0].length) return [[]];
        minterms.push(...m);
      }

      return minterms;
    }
  }

  export class IsNull extends Clause {
    constructor(public operand: Clause) {
      super();
    }
    getMinterms(context: SynthContextBase<Clause>, res: number): Minterm[] {
      res = res & 0b111;
      const minterms: Minterm[] = [];
      if ((res & 0b110) === 0b110) return [[]];
      if (res & 0b100)
        minterms.push(...this.operand.getMinterms(context, 0b001));
      if (res & 0b010)
        minterms.push(...this.operand.getMinterms(context, 0b110));
      return minterms;
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
        return new Expression.Unary("IS NULL", this.operand.expression());
      return super.expression();
    }
  }

  export class Exp extends Clause {
    constructor(public exp: Expression) {
      super();
    }
    getMinterms(context: SynthContextBase<Clause>, res: number): Minterm[] {
      if (!(this.exp instanceof Expression.Literal))
        return context.getMinterms(this, res);
      if (this.exp.value == null) return res & 0b001 ? [[]] : [];
      if (this.exp.value && res & 0b100) return [[]];
      if (!this.exp.value && res & 0b010) return [[]];
      return [];
    }
    expression(): Expression {
      return this.exp;
    }
    isBoolean(): boolean {
      if (this.exp instanceof Expression.Literal) {
        return (
          this.exp.value === true ||
          this.exp.value === false ||
          this.exp.value == null
        );
      }
      return false;
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
    getMinterms(context: SynthContextBase<Clause>, res: number): Minterm[] {
      res = res & 0b111;
      if (!res) return [];
      if (res === 0b111) return [[]];
      if (res === 0b001 || res === 0b110)
        return this.lhs.getMinterms(context, res);
      return context.getMinterms(this, res);
    }
    *getNullables(): IterableIterator<IsNull> {
      yield* this.lhs.getNullables();
    }
    isBoolean(): boolean {
      return true;
    }
    expression(): Expression {
      return new Expression.Binary(
        this.op,
        this.lhs.expression(),
        new Expression.Literal(this.rhs),
      );
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
      if (exp instanceof Expression.FunctionCall) {
        if (exp.name === "UPPER" || exp.name === "LOWER") {
          const p =
            exp.name === "UPPER" ? rhs.toUpperCase() : rhs.toLowerCase();
          if (p === rhs) caseSensitive = false;
          else contradiction = true;
          lhs = new Exp(exp.args[0]);
        }
      }
      this.lhs = lhs;
      this.pattern = parseLikePattern(rhs, esc);
      this.caseSensitive = caseSensitive;
      this.contradiction = contradiction;
    }
    getMinterms(context: SynthContextBase<Clause>, res: number): Minterm[] {
      res = res & 0b111;
      if (!res) return [];
      if (res === 0b111) return [[]];
      if (res === 0b001 || res === 0b110)
        return this.lhs.getMinterms(context, res);
      return context.getMinterms(this, res);
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
          lhs = new Expression.FunctionCall("LOWER", [lhs]);
        else lhs = new Expression.FunctionCall("UPPER", [lhs]);
      } else if (!this.caseSensitive) {
        if (this.rhs === this.rhs.toLocaleUpperCase())
          lhs = new Expression.FunctionCall("UPPER", [lhs]);
        else lhs = new Expression.FunctionCall("LOWER", [lhs]);
      }
      return new Expression.Binary(
        "LIKE",
        lhs,
        new Expression.Literal(this.rhs),
      );
    }
  }

  export class Conditional extends Clause {
    constructor(
      public condition: Clause,
      public then: Clause,
      public otherwise: Clause,
    ) {
      super();
    }
    getMinterms(context: SynthContextBase<Clause>, res: number): Minterm[] {
      const condition = this.condition.getMinterms(context, 0b011);
      if (!condition.length) return this.then.getMinterms(context, res);
      return [
        ...complement([...condition, ...this.then.getMinterms(context, ~res)]),
        ...complement([
          ...complement(condition),
          ...this.otherwise.getMinterms(context, ~res),
        ]),
      ];
    }
    expression(): Expression {
      if (this._expression != null) return this._expression;
      if (this.isBoolean()) {
        this._expression = new Clause.Not(new Clause.Not(this)).expression();
        return this._expression;
      }
      const context = createSynthContext();
      const cases: { when: Minterm[]; then: Expression }[] = [];
      let clause = this as Conditional;

      for (;;) {
        let minterms = clause.condition.getMinterms(context, 0b100);
        const then = clause.then.expression();
        if (
          cases.length &&
          then.toString() === cases[cases.length - 1].then.toString()
        )
          minterms.push(...cases.pop().when);
        minterms = context.minimize(
          minterms,
          cases.flatMap((c) => c.when),
        );
        if (!minterms.length) continue;
        cases.push({ when: minterms, then });
        if (minterms.length === 1 && !minterms[0].length) break;
        if (clause.otherwise instanceof Conditional) clause = clause.otherwise;
        else
          clause = new Conditional(
            new Exp(new Expression.Literal(true)),
            clause.otherwise,
            new Exp(new Expression.Literal(null)),
          );
      }
      while (
        cases[cases.length - 1].then instanceof Expression.Literal &&
        (cases[cases.length - 1].then as Expression.Literal).value == null
      )
        cases.pop();
      let res: Expression = new Expression.Literal(null);
      while (cases.length) {
        const c = cases.pop();
        if (c.when.length === 1 && !c.when[0].length) {
          res = c.then;
        } else {
          res = new Expression.Conditional(
            context.toExpression(c.when),
            c.then,
            res,
          );
        }
      }

      this._expression = res;
      return this._expression;
    }

    isBoolean(): boolean {
      return this.then.isBoolean() && this.otherwise.isBoolean();
    }
  }

  export function fromExpression(exp: Expression): Clause {
    let res: Clause;
    let negate = false;
    if (exp instanceof Expression.Unary) {
      let op = exp.operator;
      negate = true;
      if (op === "IS NOT NULL") op = "IS NULL";
      else negate = false;
      if (op === "NOT") res = new Clause.Not(fromExpression(exp.operand));
      else if (op === "IS NULL") res = new IsNull(fromExpression(exp.operand));
    } else if (exp instanceof Expression.Binary) {
      let op = exp.operator;
      negate = true;
      if (op === "NOT LIKE") op = "LIKE";
      else if (op === "<>") op = "=";
      else if (op === ">=") op = "<";
      else if (op === "<=") op = ">";
      else negate = false;

      if (op === "AND") {
        res = new Clause.And([
          fromExpression(exp.left),
          fromExpression(exp.right),
        ]);
      } else if (op === "OR") {
        negate = true;
        res = new Clause.And([
          new Clause.Not(fromExpression(exp.left)),
          new Clause.Not(fromExpression(exp.right)),
        ]);
      } else if (exp.right instanceof Expression.Literal) {
        if (["=", ">", "<"].includes(op)) {
          if (
            ["boolean", "number", "string"].includes(typeof exp.right.value)
          ) {
            res = new Compare(
              fromExpression(exp.left),
              op as ">" | "<" | "=",
              exp.right.value,
            );
          }
        } else if (op === "LIKE") {
          if (typeof exp.right.value === "string")
            res = new Like(fromExpression(exp.left), exp.right.value);
        }
      }
    } else if (exp instanceof Expression.Conditional) {
      res = new Conditional(
        fromExpression(exp.condition),
        fromExpression(exp.then),
        fromExpression(exp.otherwise),
      );
    }

    if (!res) res = new Exp(exp);
    if (negate) res = new Not(res);
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

  getMinterms(clause: Clause, res: number): number[][] {
    const v = this.getVar(clause);
    switch (res & 0b111) {
      case 0b100:
        return [[(v << 2) ^ 3]];
      case 0b010:
        return [[(v << 2) ^ 1]];
      case 0b001:
        return [[v << 2, (v << 2) ^ 2]];
      case 0b110:
        return [[(v << 2) ^ 3], [(v << 2) ^ 1]];
      case 0b101:
        return [[(v << 2) ^ 3], [v << 2, (v << 2) ^ 2]];
      case 0b011:
        return [[(v << 2) ^ 1], [v << 2, (v << 2) ^ 2]];
      default:
        throw new Error("Invalid minterms");
    }
  }

  getDcSet(minterms: Minterm[]): number[][] {
    const dcSet: number[][] = [];

    const whitelist = new Set([...minterms.flat()].map((v) => v >> 2));

    const allClauses = [...whitelist].map((v) => this.getClause(v));
    const comparisons = allClauses.filter(
      (c) => c instanceof Clause.Compare,
    ) as Clause.Compare[];

    // Comparisons
    for (const [, clauses] of groupBy(comparisons, (c) => c.lhs.toString())) {
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

    for (const [, clauses] of groupBy(likes, (c) => c.lhs.toString())) {
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

    for (const [lhsKey, likeGroup] of groupBy(likes, (c) => c.lhs.toString())) {
      const compareGroupAll = comparisons.filter(
        (c) => c.lhs.toString() === lhsKey,
      );

      for (const like of likeGroup) {
        if (like.contradiction) continue;

        const pattern = like.caseSensitive
          ? like.pattern
          : like.pattern.map((c) => c.toLowerCase());

        const likeVar = this.getVar(like);

        for (const compare of compareGroupAll.filter((c) => c.op === "=")) {
          if (typeof compare.rhs !== "string") continue;

          const value = like.caseSensitive
            ? compare.rhs
            : compare.rhs.toLowerCase();

          const matches = likeMatches(pattern, value, true);
          const eqVar = this.getVar(compare);

          if (matches) {
            dcSet.push([(eqVar << 2) ^ 3, (likeVar << 2) ^ 1]);
            // Don't add eq=true AND like=null as DC; combined with eq=true AND
            // like=false, espresso would treat LIKE as don't-care when eq=true
          } else {
            dcSet.push([(eqVar << 2) ^ 3, (likeVar << 2) ^ 3]);
          }
        }

        // Prefix patterns like 'abc%' match strings in range [prefix, upperBound)
        const prefix = getPureLikePrefix(pattern);
        if (prefix) {
          const upperBound = getLikePrefixUpperBound(prefix);

          // string < prefix means it can't match the pattern
          for (const compare of compareGroupAll.filter((c) => c.op === "<")) {
            if (typeof compare.rhs !== "string") continue;

            const value = like.caseSensitive
              ? compare.rhs
              : compare.rhs.toLowerCase();
            const ltVar = this.getVar(compare);

            if (value <= prefix) {
              dcSet.push([(ltVar << 2) ^ 3, (likeVar << 2) ^ 3]);
            }
          }

          // string > upperBound means it can't match the pattern
          // (string > prefix could still match, e.g., 'abcd' > 'abc' matches 'abc%')
          if (upperBound) {
            for (const compare of compareGroupAll.filter((c) => c.op === ">")) {
              if (typeof compare.rhs !== "string") continue;

              const value = like.caseSensitive
                ? compare.rhs
                : compare.rhs.toLowerCase();
              const gtVar = this.getVar(compare);

              if (value >= upperBound) {
                dcSet.push([(gtVar << 2) ^ 3, (likeVar << 2) ^ 3]);
              }
            }
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
        if (clause.operand instanceof Clause.Exp) {
          if (clause.operand.exp instanceof Expression.Parameter) {
            const str = clause.operand.exp.path.toString();
            if (str === "DeviceID.ID" || str === "_id")
              dcSet.push([(v << 2) ^ 3]);
          }
        }
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
    let res: Expression = new Expression.Literal(false);
    for (const s of sop) {
      let conjs: Expression = new Expression.Literal(true);
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
          conjs = Expression.and(
            conjs,
            this.toExpression([
              [i ^ 3],
              ...isNullVars.map((n) => [(n << 2) ^ 3]),
            ]),
          );
          continue;
        }

        let expr = clause.expression();
        if (!(i & 1) !== !(i & 2)) expr = new Expression.Unary("NOT", expr);
        if (expr instanceof Expression.Unary && expr.operator === "NOT") {
          const e = expr.operand;
          if (e instanceof Expression.Unary) {
            if (e.operator === "IS NULL")
              expr = new Expression.Unary("IS NOT NULL", e.operand);
            else if (e.operator === "IS NOT NULL")
              expr = new Expression.Unary("IS NULL", e.operand);
            else if (e.operator === "NOT") expr = e.operand;
          } else if (e instanceof Expression.Binary) {
            if (e.operator === "LIKE")
              expr = new Expression.Binary("NOT LIKE", e.left, e.right);
            else if (e.operator === "=")
              expr = new Expression.Binary("<>", e.left, e.right);
            else if (e.operator === "<>")
              expr = new Expression.Binary("=", e.left, e.right);
            else if (e.operator === ">")
              expr = new Expression.Binary("<=", e.left, e.right);
            else if (e.operator === ">=")
              expr = new Expression.Binary("<", e.left, e.right);
            else if (e.operator === "<")
              expr = new Expression.Binary(">=", e.left, e.right);
            else if (e.operator === "<=")
              expr = new Expression.Binary(">", e.left, e.right);
          }
        }
        conjs = Expression.and(conjs, expr);
      }
      res = Expression.or(res, conjs);
    }
    return res;
  }
}

// Classes aren't hoisted in JS but functions are. This function is used to
// create a new SynthContext instance from inside the Clause class.
export function createSynthContext(): SynthContext {
  return new SynthContext();
}

function likeMatches(
  pattern: string[],
  value: string,
  caseSensitive: boolean,
): boolean {
  if (!caseSensitive) {
    value = value.toLowerCase();
    pattern = pattern.map((c) =>
      c === "\\%" || c === "\\_" ? c : c.toLowerCase(),
    );
  }

  let pi = 0;
  let vi = 0;
  let backtrackPi = -1;
  let backtrackVi = -1;

  while (vi < value.length) {
    if (pi < pattern.length && pattern[pi] === "\\%") {
      backtrackPi = pi;
      backtrackVi = vi;
      pi++;
    } else if (
      pi < pattern.length &&
      (pattern[pi] === "\\_" || pattern[pi] === value[vi])
    ) {
      pi++;
      vi++;
    } else if (backtrackPi >= 0) {
      pi = backtrackPi + 1;
      backtrackVi++;
      vi = backtrackVi;
    } else {
      return false;
    }
  }

  while (pi < pattern.length && pattern[pi] === "\\%") pi++;

  return pi === pattern.length;
}

function getLikePrefixUpperBound(prefix: string): string | null {
  if (!prefix) return null;

  for (let i = prefix.length - 1; i >= 0; i--) {
    const charCode = prefix.charCodeAt(i);
    // 0x10ffff is max Unicode code point; sufficient for practical strings
    if (charCode < 0x10ffff) {
      return prefix.slice(0, i) + String.fromCodePoint(charCode + 1);
    }
  }
  return null;
}

function getPureLikePrefix(pattern: string[]): string | null {
  if (pattern.length === 0) return null;

  let hasTrailingPercent = false;
  let prefix = "";

  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "\\%") {
      for (let j = i; j < pattern.length; j++) {
        if (pattern[j] !== "\\%") return null;
      }
      hasTrailingPercent = true;
      break;
    } else if (c === "\\_") {
      return null;
    } else {
      prefix += c;
    }
  }

  if (!hasTrailingPercent) return null;
  if (!prefix) return null;

  return prefix;
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

  if (expr2 instanceof Expression.Literal && !expr2.value)
    return [expr1, new Expression.Literal(false)];

  const synth2 = Clause.fromExpression(expr2);

  if (expr1 instanceof Expression.Literal && !expr1.value) {
    const e = synth2.expression();
    return [e, e];
  }

  expr1 = normalize(expr1);
  const synth1 = Clause.fromExpression(expr1);

  const context = new SynthContext();

  const expr2Minterms = synth2.getMinterms(context, 0b100);
  const expr1Minterms = synth1.getMinterms(context, 0b100);

  const union = context.minimize([...expr1Minterms, ...expr2Minterms]);

  const diff = context.minimize(
    complement([...expr1Minterms, ...complement(expr2Minterms)]),
  );

  return [context.toExpression(union), context.toExpression(diff)];
}

export function covers(expr1: Expression, expr2: Expression): boolean {
  expr2 = normalize(expr2);
  if (expr2 instanceof Expression.Literal && !expr2.value) return true;
  expr1 = normalize(expr1);
  if (expr1 instanceof Expression.Literal && expr1.value) return true;

  const synt1 = Clause.fromExpression(expr1);
  const synt2 = Clause.fromExpression(expr2);

  const context = new SynthContext();
  const expr1Minterms = synt1.getMinterms(context, 0b100);
  const expr2Minterms = synt2.getMinterms(context, 0b100);

  return tautology([
    ...context.sanitizeMinterms(complement(expr2Minterms)),
    ...context.getDcSet([...expr2Minterms, ...expr1Minterms]),
    ...context.sanitizeMinterms(expr1Minterms),
  ]);
}
