import { Expression } from "../types.ts";
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
    const expressions: Expression[] = [];
    for (const [k, v] of Object.entries(_query)) {
      if (k[0] === "$") {
        if (k === "$and") {
          const and: Expression = ["AND"];
          for (const vv of Object.values(v)) and.push(recursive(vv));
          expressions.push(and);
        } else if (k === "$or") {
          const or: Expression = ["OR"];
          for (const vv of Object.values(v)) or.push(recursive(vv));
          expressions.push(or);
        } else {
          throw new Error(`Operator ${k} not supported`);
        }
      } else if (k === "_tags") {
        if (typeof v === "object") {
          if (Array.isArray(v)) throw new Error(`Invalid type`);
          const conjs: Expression[] = [];
          for (const [op, val] of Object.entries(v)) {
            if (op === "$ne") {
              if (typeof v["$ne"] !== "string")
                throw new Error("Only string values are allowed for _tags");
              conjs.push(["IS NULL", ["PARAM", `Tags.${encodeTag(val)}`]]);
            } else if (op === "$eq") {
              if (typeof v["$eq"] !== "string")
                throw new Error("Only string values are allowed for _tags");
              conjs.push(["IS NOT NULL", ["PARAM", `Tags.${encodeTag(val)}`]]);
            } else {
              throw new Error(`Invalid tag query`);
            }
          }
          if (conjs.length === 1) expressions.push(conjs[0]);
          else if (conjs.length > 1) expressions.push(["AND", ...conjs]);
        } else {
          expressions.push([
            "IS NOT NULL",
            ["PARAM", `Tags.${encodeTag(v as string)}`],
          ]);
        }
      } else if (k.startsWith("Tags.")) {
        let exists: boolean;
        if (typeof v === "boolean") exists = v;
        else if (v.hasOwnProperty("$eq")) exists = !!v["$eq"];
        else if (v.hasOwnProperty("$ne")) exists = !v["$ne"];
        else if (v.hasOwnProperty("$exists")) exists = !!v["$exists"];
        else throw new Error(`Invalid tag query`);

        expressions.push([exists ? "IS NOT NULL" : "IS NULL", ["PARAM", k]]);
      } else if (typeof v === "object") {
        if (Array.isArray(v)) throw new Error(`Invalid type`);

        const exps: Expression[] = [];
        for (const [kk, vv] of Object.entries(v)) {
          if (kk === "$eq") {
            exps.push(["=", ["PARAM", k], vv]);
          } else if (kk === "$ne") {
            exps.push([
              "OR",
              ["<>", ["PARAM", k], vv],
              ["IS NULL", ["PARAM", k]],
            ]);
          } else if (kk === "$lt") {
            exps.push(["<", ["PARAM", k], vv]);
          } else if (kk === "$lte") {
            exps.push(["<=", ["PARAM", k], vv]);
          } else if (kk === "$gt") {
            exps.push([">", ["PARAM", k], vv]);
          } else if (kk === "$gte") {
            exps.push([">=", ["PARAM", k], vv]);
          } else {
            throw new Error(`Operator ${kk} not supported`);
          }
          if (!["string", "number", "boolean"].includes(typeof vv))
            throw new Error(`Invalid value for ${kk} operator`);
        }
        if (exps.length === 1) {
          expressions.push(exps[0]);
        } else if (exps.length > 1) {
          const and: Expression = ["AND"];
          expressions.push(and.concat(exps));
        }
      } else {
        expressions.push(["=", ["PARAM", k], v]);
      }
    }
    if (expressions.length === 1) return expressions[0];
    if (expressions.length === 0) return true;
    return ["AND", ...expressions];
  }

  // empty filter
  if (!Object.keys(q).length) return true;

  return recursive(q);
}
