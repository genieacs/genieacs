function isObject(obj: any): boolean {
  return Object.prototype.toString.call(obj) === "[object Object]";
}

function stringToRegexp(input, flags?): RegExp | false {
  if (input.indexOf("*") === -1) return false;

  let output = input.replace(/[[\]\\^$.|?+()]/, "\\$&");
  if (output[0] === "*") output = output.replace(/^\*+/g, "");
  else output = "^" + output;

  if (output[output.length - 1] === "*") output = output.replace(/\*+$/g, "");
  else output = output + "$";

  output = output.replace(/[*]/, ".*");
  return new RegExp(output, flags);
}

function normalize(input): any {
  if (typeof input === "string") {
    const vals: any = [input];
    const m = /^\/(.*?)\/(g?i?m?y?)$/.exec(input);
    if (m) vals.push({ $regex: new RegExp(m[1], m[2]) });

    if (+input === parseFloat(input)) vals.push(+input);

    const d = new Date(input);
    if (input.length >= 8 && d.getFullYear() > 1983) vals.push(d);

    const r = stringToRegexp(input);
    if (r !== false) vals.push({ $regex: r });

    return vals;
  }
  return input;
}

const EXPAND_OPS = new Set([
  "$eq",
  "$gt",
  "$gte",
  "$in",
  "$lt",
  "$lte",
  "$ne",
  "$nin",
]);

function expandValue(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    let a = [];
    for (const j of value) a = a.concat(expandValue(j));
    return [a];
  } else if (!isObject(value)) {
    const n = normalize(value);
    if (!Array.isArray(n)) return [n];
    else return n;
  }

  const objs = [];
  const indices = [];
  const keys = [];
  const values = [];
  for (const [k, v] of Object.entries(value)) {
    keys.push(k);
    if (EXPAND_OPS.has(k)) values.push(expandValue(v));
    else values.push([v]);
    indices.push(0);
  }

  let i = 0;
  while (i < indices.length) {
    const obj = {};
    for (let j = 0; j < keys.length; ++j) obj[keys[j]] = values[j][indices[j]];
    objs.push(obj);

    for (i = 0; i < indices.length; ++i) {
      indices[i] += 1;
      if (indices[i] < values[i].length) break;
      indices[i] = 0;
    }
  }
  return objs;
}

function permute(param, val): any[] {
  const conditions = [];
  const values = expandValue(val);

  if (param[param.lastIndexOf(".") + 1] !== "_") param += "._value";

  for (const v of values) {
    const obj = {};
    obj[param] = v;
    conditions.push(obj);
  }

  return conditions;
}

export function expand(
  query: Record<string, unknown>,
): Record<string, unknown> {
  const newQuery = {};
  for (const [k, v] of Object.entries(query)) {
    if (k[0] === "$") {
      // Operator
      newQuery[k] = (v as any[]).map((e) => expand(e));
    } else {
      const conditions = permute(k, v);
      if (conditions.length > 1) {
        newQuery["$and"] = newQuery["$and"] || [];
        if (v && (v["$ne"] != null || v["$not"] != null)) {
          if (Object.keys(v).length > 1)
            throw new Error("Cannot mix $ne or $not with other operators");
          for (const c of conditions) newQuery["$and"].push(c);
        } else {
          newQuery["$and"].push({ $or: conditions });
        }
      } else {
        Object.assign(newQuery, conditions[0]);
      }
    }
  }

  return newQuery;
}

export function sanitizeQueryTypes(
  query: Record<string, unknown>,
  types: Record<string, (v: unknown) => unknown>,
): Record<string, unknown> {
  for (const [k, v] of Object.entries(query)) {
    if (k[0] === "$") {
      // Logical operator
      for (const vv of v as any[]) sanitizeQueryTypes(vv, types);
    } else if (k in types) {
      if (isObject(v)) {
        for (const [kk, vv] of Object.entries(v)) {
          switch (kk) {
            case "$in":
            case "$nin":
              for (let i = 0; i < vv.length; ++i) vv[i] = types[k](vv[i]);
              break;
            case "$eq":
            case "$gt":
            case "$gte":
            case "$lt":
            case "$lte":
            case "$ne":
              v[kk] = types[k](vv);
              break;
            case "$exists":
            case "$type":
              // Ignore
              break;
            default:
              throw new Error("Operator not supported");
          }
        }
      } else {
        query[k] = types[k](query[k]);
      }
    }
  }

  return query;
}
