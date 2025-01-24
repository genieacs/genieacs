import config from "./config.ts";
import { Expression } from "../lib/types.ts";
import { encodeTag } from "../lib/util.ts";

const resources = {
  devices: {},
  faults: {
    Device: { parameter: ["PARAM", "device"], type: "string" },
    Channel: { parameter: ["PARAM", "channel"], type: "string" },
    Code: { parameter: ["PARAM", "code"], type: "string" },
    Retries: { parameter: ["PARAM", "retries"], type: "number" },
    Timestamp: { parameter: ["PARAM", "timestamp"], type: "timestamp" },
  },
  presets: {
    ID: { parameter: ["PARAM", "_id"], type: "string" },
    Channel: { parameter: ["PARAM", "channel"], type: "string" },
    Weight: { parameter: ["PARAM", "weight"], type: "number" },
  },
  provisions: {
    ID: { parameter: ["PARAM", "_id"], type: "string" },
  },
  virtualParameters: {
    ID: { parameter: ["PARAM", "_id"], type: "string" },
  },
  files: {
    ID: { parameter: ["PARAM", "_id"], type: "string" },
    Type: { parameter: ["PARAM", "metadata.fileType"], type: "string" },
    OUI: { parameter: ["PARAM", "metadata.oui"], type: "string" },
    "Product class": {
      parameter: ["PARAM", "metadata.productClass"],
      type: "string",
    },
    Version: { parameter: ["PARAM", "metadata.version"], type: "string" },
  },
  permissions: {
    Role: { parameter: ["PARAM", "role"], type: "string" },
    Resource: { parameter: ["PARAM", "resource"], type: "string" },
    Access: { parameter: ["PARAM", "access"], type: "number" },
  },
  users: { Username: { parameter: ["PARAM", "_id"], type: "string" } },
};

for (const v of Object.values(
  config.ui.filters as Record<
    string,
    { label: string; parameter: string; type: string }
  >,
)) {
  resources.devices[v.label] = {
    parameter: v.parameter,
    type: (v.type || "").split(",").map((s) => s.trim()),
  };
}

export function getLabels(resource: string): string[] {
  if (!resources[resource]) return [];
  return Object.keys(resources[resource]);
}

function queryNumber(param: Expression, value: string): Expression {
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

  return [op, param, v];
}

function queryTimestamp(param: Expression, value: string): Expression {
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
  return [op, param, v];
}

function queryString(param: Expression, value: string): Expression {
  return ["LIKE", ["FUNC", "LOWER", param], value.toLowerCase()];
}

function queryStringCaseSensitive(
  param: Expression,
  value: string,
): Expression {
  return ["LIKE", param, value];
}

function queryStringMonoCase(param: Expression, value: string): Expression {
  return [
    "OR",
    ["LIKE", param, value.toLowerCase()],
    ["LIKE", param, value.toUpperCase()],
  ];
}

function queryMac(param: Expression, value: string): Expression {
  value = value.replace(/[^a-f0-9]/gi, "").toLowerCase();
  if (!value) return null;
  if (value.length === 12) {
    return [
      "OR",
      ["=", param, value.replace(/(..)(?!$)/g, "$1:").toLowerCase()],
      ["=", param, value.replace(/(..)(?!$)/g, "$1:").toUpperCase()],
    ];
  }

  return [
    "OR",
    [
      "LIKE",
      ["FUNC", "LOWER", param],
      `%${value.replace(/(..)(?!$)/g, "$1:")}%`,
    ],
    [
      "LIKE",
      ["FUNC", "LOWER", param],
      `%${value.replace(/(.)(.)/g, "$1:$2")}%`,
    ],
  ];
}

function queryMacWildcard(param: Expression, value: string): Expression {
  if (!/^[a-f0-9%]+$/i.test(value)) return queryStringMonoCase(param, value);
  const parts = value.split("%");

  const groups = parts.map((p) => [
    p.replace(/..(?=.)/gi, "$&:"),
    p.replace(/(.)(.)/gi, "$1:$2"),
  ]);

  const res = new Set();
  for (let i = 0; i < 2 ** groups.length; ++i) {
    const r = groups.map((g, j) => g[(i >> j) & 1]).join("%");
    if (/^[a-f0-9]:/i.test(r) || /:[a-f0-9]$/i.test(r)) continue;
    res.add(r.toLocaleLowerCase());
    res.add(r.toUpperCase());
  }
  if (!res.size) return queryStringMonoCase(param, value);

  const clauses = [...res].map((r) => ["LIKE", param, r]);
  if (clauses.length === 1) return clauses[0];
  return ["OR", ...clauses];
}

function queryTag(tag: string): Expression {
  const t = encodeTag(tag);
  return ["IS NOT NULL", ["PARAM", `Tags.${t}`]];
}

export function getTip(resource: string, label: string): string {
  let tip;
  if (resources[resource]?.[label]) {
    const param = resources[resource][label];
    const types =
      resource === "devices" ? param["type"] : param["type"].split(",");

    const tips = [];
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
  resource: string,
  label: string,
  value: string,
): Expression {
  if (!resources[resource]) return null;
  const type = resources[resource][label].type;
  value = value.trim();
  const res: Expression = ["OR"];

  if (type.length === 0 || type.includes("number")) {
    const q = queryNumber(resources[resource][label].parameter, value);
    if (q) res.push(q);
  }

  if (type.length === 0 || type.includes("string")) {
    const q = queryString(resources[resource][label].parameter, value);
    if (q) res.push(q);
  }

  if (type.length === 0 || type.includes("timestamp")) {
    const q = queryTimestamp(resources[resource][label].parameter, value);
    if (q) res.push(q);
  }

  if (type.includes("string-casesensitive")) {
    const q = queryStringCaseSensitive(
      resources[resource][label].parameter,
      value,
    );
    if (q) res.push(q);
  }

  if (type.includes("string-monocase")) {
    const q = queryStringMonoCase(resources[resource][label].parameter, value);
    if (q) res.push(q);
  }

  if (type.includes("mac")) {
    const q = queryMac(resources[resource][label].parameter, value);
    if (q) res.push(q);
  }

  if (type.includes("mac-wildcard")) {
    const q = queryMacWildcard(resources[resource][label].parameter, value);
    if (q) res.push(q);
  }

  if (type.includes("tag")) {
    const q = queryTag(value);
    if (q) res.push(q);
  }

  if (res.length <= 1) return null;
  else if (res.length === 2) return res[1];
  else return res;
}
