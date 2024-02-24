import { complement } from "espresso-iisojs";
import { Expression } from "../../types";
import normalize from "./normalize";
import { Clause, SynthContext } from "./synth";
import { and, or } from "./util";

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
    .reduce((cur, kv) => {
      const [param, asc] = kv;
      if (asc < 0) {
        if (bookmark[param] == null) {
          return or(
            ["IS NOT NULL", ["PARAM", param]],
            and(["IS NULL", ["PARAM", param]], cur),
          );
        }
        let f = null;
        f = or(f, [">", ["PARAM", param], bookmark[param]]);
        return or(f, and(["=", ["PARAM", param], bookmark[param]], cur));
      } else {
        let f: Expression = ["IS NULL", ["PARAM", param]];
        if (bookmark[param] == null) return and(f, cur);
        f = or(f, ["<", ["PARAM", param], bookmark[param]]);
        return or(f, and(["=", ["PARAM", param], bookmark[param]], cur));
      }
    }, true as Expression);
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
    const lhs = new Clause.Exp(["PARAM", param]);
    const isNull = context.getVar(new Clause.IsNull(lhs));
    cov.push((isNull << 2) ^ 2);
  }

  for (const m of minterm) {
    const clause = context.getClause(m >>> 2);
    if (clause instanceof Clause.IsNull) {
      const lhs = clause.operand.expression();
      if (!Array.isArray(lhs) || lhs[0] !== "PARAM") continue;
      if (lhs[1] !== param) continue;
      nextCov.push(m);
      if (sort < 0 && m & 1) cov.push(m, m ^ 1);
    } else if (clause instanceof Clause.Compare) {
      const lhs = clause.lhs.expression();
      if (!Array.isArray(lhs) || lhs[0] !== "PARAM") continue;
      if (lhs[1] !== param) continue;
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
  if (!fetched) return [false, toFetch];

  toFetch = normalize(toFetch);
  if (!toFetch) return [false, toFetch];

  const synth1 = Clause.fromExpression(fetched);
  const synth2 = Clause.fromExpression(toFetch);

  const context = new SynthContext();

  const expr1Minterms = synth1.true(context);
  const expr2MintermsC = complement(synth2.true(context));

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
