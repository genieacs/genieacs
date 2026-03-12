import Expression, { Value } from "../common/expression.ts";
import Path from "../common/path.ts";
import { encodeTag } from "../util.ts";

// Optimize projection by removing overlaps
// This can modify the object
export function optimizeProjection(obj: { [path: string]: 1 }): {
  [path: string]: 1;
} {
  if (obj[""]) return { "": obj[""] };

  const keys = Object.keys(obj).sort();
  if (keys.length <= 1) return obj;

  for (let i = 1; i < keys.length; ++i) {
    const a = keys[i - 1];
    const b = keys[i];
    if (b.startsWith(a)) {
      if (b.charAt(a.length) === "." || b.charAt(a.length - 1) === ".") {
        delete obj[b];
        keys.splice(i--, 1);
      }
    }
  }
  return obj;
}

export function convertOldPrecondition(q: Record<string, unknown>): Expression {
  function recursive(_query): Expression {
    let res: Expression = new Expression.Literal(true);
    for (const [k, v] of Object.entries(_query)) {
      if (k[0] === "$") {
        if (k === "$and") {
          for (const vv of Object.values(v))
            res = Expression.and(res, recursive(vv));
        } else if (k === "$or") {
          let or: Expression = new Expression.Literal(false);
          for (const vv of Object.values(v))
            or = Expression.or(or, recursive(vv));
          res = Expression.and(res, or);
        } else {
          throw new Error(`Operator ${k} not supported`);
        }
      } else if (k === "_tags") {
        if (typeof v === "object") {
          if (Array.isArray(v)) throw new Error(`Invalid type`);
          for (const [op, val] of Object.entries(v)) {
            if (op === "$ne") {
              if (typeof v["$ne"] !== "string")
                throw new Error("Only string values are allowed for _tags");
              res = Expression.and(
                res,
                new Expression.Unary(
                  "IS NULL",
                  new Expression.Parameter(
                    Path.parse(`Tags.${encodeTag(val)}`),
                  ),
                ),
              );
            } else if (op === "$eq") {
              if (typeof v["$eq"] !== "string")
                throw new Error("Only string values are allowed for _tags");
              res = Expression.and(
                res,
                new Expression.Unary(
                  "IS NOT NULL",
                  new Expression.Parameter(
                    Path.parse(`Tags.${encodeTag(val)}`),
                  ),
                ),
              );
            } else {
              throw new Error(`Invalid tag query`);
            }
          }
        } else {
          res = Expression.and(
            res,
            new Expression.Unary(
              "IS NOT NULL",
              new Expression.Parameter(
                Path.parse(`Tags.${encodeTag(v as string)}`),
              ),
            ),
          );
        }
      } else if (k.startsWith("Tags.")) {
        let exists: boolean;
        if (typeof v === "boolean") exists = v;
        else if (v.hasOwnProperty("$eq")) exists = !!v["$eq"];
        else if (v.hasOwnProperty("$ne")) exists = !v["$ne"];
        else if (v.hasOwnProperty("$exists")) exists = !!v["$exists"];
        else throw new Error(`Invalid tag query`);

        res = Expression.and(
          res,
          new Expression.Unary(
            exists ? "IS NOT NULL" : "IS NULL",
            new Expression.Parameter(Path.parse(k)),
          ),
        );
      } else if (typeof v === "object") {
        if (Array.isArray(v)) throw new Error(`Invalid type`);
        for (const [kk, vv] of Object.entries(v)) {
          if (kk === "$eq") {
            res = Expression.and(
              res,
              new Expression.Binary(
                "=",
                new Expression.Parameter(Path.parse(k)),
                new Expression.Literal(vv),
              ),
            );
          } else if (kk === "$ne") {
            const p = new Expression.Parameter(Path.parse(k));
            res = Expression.and(
              res,
              Expression.or(
                new Expression.Binary("<>", p, new Expression.Literal(vv)),
                new Expression.Unary("IS NULL", p),
              ),
            );
          } else if (kk === "$lt") {
            res = Expression.and(
              res,
              new Expression.Binary(
                "<",
                new Expression.Parameter(Path.parse(k)),
                new Expression.Literal(vv),
              ),
            );
          } else if (kk === "$lte") {
            res = Expression.and(
              res,
              new Expression.Binary(
                "<=",
                new Expression.Parameter(Path.parse(k)),
                new Expression.Literal(vv),
              ),
            );
          } else if (kk === "$gt") {
            res = Expression.and(
              res,
              new Expression.Binary(
                ">",
                new Expression.Parameter(Path.parse(k)),
                new Expression.Literal(vv),
              ),
            );
          } else if (kk === "$gte") {
            res = Expression.and(
              res,
              new Expression.Binary(
                ">=",
                new Expression.Parameter(Path.parse(k)),
                new Expression.Literal(vv),
              ),
            );
          } else {
            throw new Error(`Operator ${kk} not supported`);
          }
          if (!["string", "number", "boolean"].includes(typeof vv))
            throw new Error(`Invalid value for ${kk} operator`);
        }
      } else {
        res = Expression.and(
          res,
          new Expression.Binary(
            "=",
            new Expression.Parameter(Path.parse(k)),
            new Expression.Literal(v as Value),
          ),
        );
      }
    }
    return res;
  }

  // empty filter
  if (!Object.keys(q).length) return new Expression.Literal(true);

  return recursive(q);
}
