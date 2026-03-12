import { complement } from "espresso-iisojs";
import Expression from "../expression.ts";
import normalize from "./normalize.ts";
import { Clause, SynthContext } from "./synth.ts";
import Path from "../path.ts";

type Bookmark = Record<string, null | boolean | number | string>;

type Minterm = number[];

export function toBookmark(
  sort: Record<string, number>,
  row: unknown,
): Bookmark {
  const bookmark: Bookmark = {};
  for (const param of Object.keys(sort)) {
    let v = row[param];
    if (v != null && typeof v === "object") v = v.value?.[0];
    bookmark[param] = v;
  }
  return bookmark;
}

export function bookmarkToExpression(
  bookmark: Bookmark,
  sort: Record<string, number>,
): Expression {
  return Object.entries(sort)
    .reverse()
    .reduce(
      (cur, kv) => {
        const [param, asc] = kv;
        const p = new Expression.Parameter(Path.parse(param));
        const b = new Expression.Literal(bookmark[param]);
        if (asc < 0) {
          if (bookmark[param] == null) {
            return Expression.or(
              new Expression.Unary("IS NOT NULL", p),
              Expression.and(new Expression.Unary("IS NULL", p), cur),
            );
          }
          return new Expression.Binary(
            "OR",
            new Expression.Binary(">", p, b),
            new Expression.Binary("AND", new Expression.Binary("=", p, b), cur),
          );
        } else {
          let f: Expression = new Expression.Unary("IS NULL", p);
          if (bookmark[param] == null) return Expression.and(f, cur);
          f = Expression.or(f, new Expression.Binary("<", p, b));
          return Expression.or(
            f,
            Expression.and(new Expression.Binary("=", p, b), cur),
          );
        }
      },
      new Expression.Literal(true) as Expression,
    );
}

function getCover(
  context: SynthContext,
  minterm: Minterm,
  allSort: [string, number][],
): Minterm[] {
  if (!allSort.length) return [[]];
  const [param, sort] = allSort[0];

  const cov: Minterm = [];
  const nextCov: Minterm = [];

  if (sort > 0) {
    const lhs = new Clause.Exp(new Expression.Parameter(Path.parse(param)));
    const isNull = context.getVar(new Clause.IsNull(lhs));
    cov.push((isNull << 2) ^ 2);
  }

  for (const m of minterm) {
    const clause = context.getClause(m >>> 2);
    if (clause instanceof Clause.IsNull) {
      if (!(clause.operand instanceof Clause.Exp)) continue;
      if (!(clause.operand.exp instanceof Expression.Parameter)) continue;
      if (clause.operand.exp.path.toString() !== param) continue;
      nextCov.push(m);
      if (sort < 0 && m & 1) cov.push(m, m ^ 1);
    } else if (clause instanceof Clause.Compare) {
      if (!(clause.lhs instanceof Clause.Exp)) continue;
      if (!(clause.lhs.exp instanceof Expression.Parameter)) continue;
      if (clause.lhs.exp.path.toString() !== param) continue;
      if (!(m & 1) && sort > 0) continue;
      nextCov.push(m);

      const negate = (m ^ (m >> 1)) & 1;

      if (sort > 0) {
        if (
          (clause.op === "=" && !negate) ||
          (clause.op === ">" && !negate) ||
          (clause.op === "<" && negate)
        ) {
          const c = new Clause.Compare(clause.lhs, ">", clause.rhs);
          const v = context.getVar(c);
          cov.push((v << 2) ^ 3);
        }
      } else if (sort < 0) {
        if (
          (clause.op === "=" && !negate) ||
          (clause.op === ">" && negate) ||
          (clause.op === "<" && !negate)
        ) {
          const c = new Clause.Compare(clause.lhs, "<", clause.rhs);
          const v = context.getVar(c);
          cov.push((v << 2) ^ 0);
        }
      }
    }
  }

  const next = getCover(context, minterm, allSort.slice(1));

  return [cov, ...next.map((n) => [...nextCov, ...n])];
}

export function paginate(
  fetched: Expression,
  toFetch: Expression,
  sort: Record<string, number>,
): [Expression, Expression] {
  fetched = normalize(fetched);
  if (fetched instanceof Expression.Literal && !fetched.value)
    return [new Expression.Literal(false), toFetch];

  toFetch = normalize(toFetch);
  if (toFetch instanceof Expression.Literal && !toFetch.value)
    return [new Expression.Literal(false), toFetch];

  const synth1 = Clause.fromExpression(fetched);
  const synth2 = Clause.fromExpression(toFetch);

  const context = new SynthContext();

  const expr1Minterms = synth1.getMinterms(context, 0b100);
  const expr2MintermsC = synth2.getMinterms(context, 0b011);

  const gaps = context.sanitizeMinterms(
    complement([
      ...expr1Minterms,
      ...expr2MintermsC,
      ...context.getDcSet([...expr1Minterms, ...expr2MintermsC]),
    ]),
  );

  const cover = gaps.flatMap((m) => getCover(context, m, Object.entries(sort)));
  const minterms1 = context.minimize(complement([...cover, ...expr2MintermsC]));
  const minterms2 = context.minimize(
    complement([...minterms1, ...expr2MintermsC]),
  );

  return [context.toExpression(minterms1), context.toExpression(minterms2)];
}
