import { filters } from "./config.ts";
import Expression from "../lib/common/expression.ts";
import { encodeTag } from "../lib/util.ts";
import Path from "../lib/common/path.ts";

type ResourceFilter = {
  parameter: Expression;
  type: string | string[];
};

export type Resource = keyof typeof resources;

const resources = {
  devices: {} as Record<string, ResourceFilter>,
  faults: {
    Device: {
      parameter: new Expression.Parameter(Path.parse("device")),
      type: "string",
    },
    Channel: {
      parameter: new Expression.Parameter(Path.parse("channel")),
      type: "string",
    },
    Code: {
      parameter: new Expression.Parameter(Path.parse("code")),
      type: "string",
    },
    Retries: {
      parameter: new Expression.Parameter(Path.parse("retries")),
      type: "number",
    },
    Timestamp: {
      parameter: new Expression.Parameter(Path.parse("timestamp")),
      type: "timestamp",
    },
  },
  presets: {
    ID: {
      parameter: new Expression.Parameter(Path.parse("_id")),
      type: "string",
    },
    Channel: {
      parameter: new Expression.Parameter(Path.parse("channel")),
      type: "string",
    },
    Weight: {
      parameter: new Expression.Parameter(Path.parse("weight")),
      type: "number",
    },
  },
  provisions: {
    ID: {
      parameter: new Expression.Parameter(Path.parse("_id")),
      type: "string",
    },
  },
  virtualParameters: {
    ID: {
      parameter: new Expression.Parameter(Path.parse("_id")),
      type: "string",
    },
  },
  files: {
    ID: {
      parameter: new Expression.Parameter(Path.parse("_id")),
      type: "string",
    },
    Type: {
      parameter: new Expression.Parameter(Path.parse("metadata.fileType")),
      type: "string",
    },
    OUI: {
      parameter: new Expression.Parameter(Path.parse("metadata.oui")),
      type: "string",
    },
    "Product class": {
      parameter: new Expression.Parameter(Path.parse("metadata.productClass")),
      type: "string",
    },
    Version: {
      parameter: new Expression.Parameter(Path.parse("metadata.version")),
      type: "string",
    },
  },
  permissions: {
    Role: {
      parameter: new Expression.Parameter(Path.parse("role")),
      type: "string",
    },
    Resource: {
      parameter: new Expression.Parameter(Path.parse("resource")),
      type: "string",
    },
    Access: {
      parameter: new Expression.Parameter(Path.parse("access")),
      type: "number",
    },
  },
  users: {
    Username: {
      parameter: new Expression.Parameter(Path.parse("_id")),
      type: "string",
    },
  },
  views: {
    ID: {
      parameter: new Expression.Parameter(Path.parse("_id")),
      type: "string",
    },
  },
};

for (const v of filters) {
  resources.devices[v.label] = {
    parameter: v.parameter,
    type: (v.type || "").split(",").map((s) => s.trim()),
  };
}

export function getLabels(resource: Resource): string[] {
  if (!resources[resource]) return [];
  return Object.keys(resources[resource]);
}

function queryNumber(param: Expression, value: string): Expression | null {
  let op = "=";
  for (const o of ["<>", "=", "<=", "<", ">=", ">"]) {
    if (value.startsWith(o)) {
      op = o;
      value = value.slice(o.length).trim();
      break;
    }
  }

  const v = parseInt(value);
  if (v !== +value) return null;

  return new Expression.Binary(op, param, new Expression.Literal(v));
}

function queryTimestamp(param: Expression, value: string): Expression | null {
  let op = "=";
  for (const o of ["<>", "=", "<=", "<", ">=", ">"]) {
    if (value.startsWith(o)) {
      op = o;
      value = value.slice(o.length).trim();
      break;
    }
  }

  let v = parseInt(value);
  if (v !== +value) v = Date.parse(value);
  if (isNaN(v)) return null;
  return new Expression.Binary(op, param, new Expression.Literal(v));
}

function queryString(param: Expression, value: string): Expression {
  return new Expression.Binary(
    "LIKE",
    new Expression.FunctionCall("LOWER", [param]),
    new Expression.Literal(value.toLowerCase()),
  );
}

function queryStringCaseSensitive(
  param: Expression,
  value: string,
): Expression {
  return new Expression.Binary("LIKE", param, new Expression.Literal(value));
}

function queryStringMonoCase(param: Expression, value: string): Expression {
  return Expression.or(
    new Expression.Binary(
      "LIKE",
      param,
      new Expression.Literal(value.toLowerCase()),
    ),
    new Expression.Binary(
      "LIKE",
      param,
      new Expression.Literal(value.toUpperCase()),
    ),
  );
}

function queryMac(param: Expression, value: string): Expression | null {
  value = value.replace(/[^a-f0-9]/gi, "").toLowerCase();
  if (!value) return null;
  if (value.length === 12) {
    value = value.replace(/(..)(?!$)/g, "$1:");
    return Expression.or(
      new Expression.Binary(
        "=",
        param,
        new Expression.Literal(value.toLowerCase()),
      ),
      new Expression.Binary(
        "=",
        param,
        new Expression.Literal(value.toUpperCase()),
      ),
    );
  }

  param = new Expression.FunctionCall("LOWER", [param]);
  return Expression.or(
    new Expression.Binary(
      "LIKE",
      param,
      new Expression.Literal(`%${value.replace(/(..)(?!$)/g, "$1:")}%`),
    ),
    new Expression.Binary(
      "LIKE",
      param,
      new Expression.Literal(`%${value.replace(/(.)(.)/g, "$1:$2")}%`),
    ),
  );
}

function queryMacWildcard(param: Expression, value: string): Expression {
  if (!/^[a-f0-9%]+$/i.test(value)) return queryStringMonoCase(param, value);
  const parts = value.split("%");

  const groups = parts.map((p) => [
    p.replace(/..(?=.)/gi, "$&:"),
    p.replace(/(.)(.)/gi, "$1:$2"),
  ]);

  const set = new Set<string>();
  for (let i = 0; i < 2 ** groups.length; ++i) {
    const r = groups.map((g, j) => g[(i >> j) & 1]).join("%");
    if (/^[a-f0-9]:/i.test(r) || /:[a-f0-9]$/i.test(r)) continue;
    set.add(r.toLocaleLowerCase());
    set.add(r.toUpperCase());
  }
  if (!set.size) return queryStringMonoCase(param, value);

  let res: Expression = new Expression.Literal(false);
  for (const s of set) {
    res = Expression.or(
      res,
      new Expression.Binary("LIKE", param, new Expression.Literal(s)),
    );
  }

  return res;
}

function queryTag(tag: string): Expression {
  const t = encodeTag(tag);
  return new Expression.Unary(
    "IS NOT NULL",
    new Expression.Parameter(Path.parse(`Tags.${t}`)),
  );
}

export function getTip(resource: Resource, label: string): string {
  const resourceFilter = (
    resources[resource] as Record<string, ResourceFilter>
  )[label];
  let tip: string = "";
  if (resourceFilter) {
    const types =
      resource === "devices"
        ? (resourceFilter.type as string[])
        : (resourceFilter.type as string).split(",");

    const tips: string[] = [];
    for (const type of types) {
      switch (type.trim()) {
        case "string":
          tips.push("case insensitive string pattern");
          break;
        case "string-casesensitive":
          tips.push("case sensitive string pattern");
          break;
        case "string-monocase":
          tips.push("case insensitive string pattern");
          break;
        case "number":
          tips.push("numeric value");
          break;
        case "timestamp":
          tips.push(
            "Unix timestamp or string in the form YYYY-MM-DDTHH:mm:ss.sssZ",
          );
          break;
        case "mac":
          tips.push("partial case insensitive MAC address");
          break;
        case "mac-wildcard":
          tips.push("case insensitive MAC address");
          break;
        case "tag":
          tips.push("case sensitive string");
          break;
      }
    }

    if (tips.length) tip = `${label}: ${tips.join(", ")}`;
  }
  return tip;
}

export function unpack(
  resource: Resource,
  label: string,
  value: string,
): Expression {
  const resourceFilter = (
    resources[resource] as Record<string, ResourceFilter>
  )[label];
  if (!resourceFilter) return new Expression.Literal(null);
  const type = resources[resource as "devices"][label].type;
  value = value.trim();
  let res: Expression = new Expression.Literal(false);

  if (type.length === 0 || type.includes("number")) {
    const q = queryNumber(resourceFilter.parameter, value);
    if (q) res = Expression.or(res, q);
  }

  if (type.length === 0 || type.includes("string")) {
    const q = queryString(resourceFilter.parameter, value);
    if (q) res = Expression.or(res, q);
  }

  if (type.length === 0 || type.includes("timestamp")) {
    const q = queryTimestamp(resourceFilter.parameter, value);
    if (q) res = Expression.or(res, q);
  }

  if (type.includes("string-casesensitive")) {
    const q = queryStringCaseSensitive(resourceFilter.parameter, value);
    if (q) res = Expression.or(res, q);
  }

  if (type.includes("string-monocase")) {
    const q = queryStringMonoCase(resourceFilter.parameter, value);
    if (q) res = Expression.or(res, q);
  }

  if (type.includes("mac")) {
    const q = queryMac(resourceFilter.parameter, value);
    if (q) res = Expression.or(res, q);
  }

  if (type.includes("mac-wildcard")) {
    const q = queryMacWildcard(resourceFilter.parameter, value);
    if (q) res = Expression.or(res, q);
  }

  if (type.includes("tag")) {
    const q = queryTag(value);
    if (q) res = Expression.or(res, q);
  }

  return res;
}
