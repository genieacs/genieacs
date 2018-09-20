"use strict";

import config from "./config";
import * as expression from "../common/expression";

let resources = {
  devices: {},
  faults: {
    Device: { parameter: ["PARAM", "device"], type: "string" },
    Channel: { parameter: ["PARAM", "channel"], type: "string" },
    Code: { parameter: ["PARAM", "code"], type: "string" },
    Retries: { parameter: ["PARAM", "retries"], type: "number" },
    Timestamp: { parameter: ["PARAM", "timestamp"], type: "timestamp" }
  },
  presets: {
    ID: { parameter: ["PARAM", "_id"], type: "string" },
    Channel: { parameter: ["PARAM", "channel"], type: "string" },
    Weight: { parameter: ["PARAM", "weight"], type: "number" }
  },
  provisions: {
    ID: { parameter: ["PARAM", "_id"], type: "string" }
  },
  virtualParameters: {
    ID: { parameter: ["PARAM", "_id"], type: "string" }
  }
};

for (let v of Object.values(config.ui.filters))
  resources.devices[v.label] = {
    parameter: expression.parse(v.parameter),
    type: (v.type || "").split(",").map(s => s.trim())
  };

function getLabels(resource) {
  if (!resources[resource]) return [];
  return Object.keys(resources[resource]);
}

function queryNumber(param, value) {
  let op = "=";
  for (let o of ["<>", "=", "<=", "<", ">=", ">"])
    if (value.startsWith(o)) {
      op = o;
      value = value.slice(o.length).trim();
      break;
    }

  let v = parseInt(value);
  if (v !== +value) return null;

  return [op, param, v];
}

function queryString(param, value) {
  return ["LIKE", ["FUNC", "LOWER", param], value.toLowerCase()];
}

function queryMac(param, value) {
  value = value.replace(/[^a-f0-9]/gi, "").toLowerCase();
  if (!value) return null;
  if (value.length === 12)
    return [
      "LIKE",
      ["FUNC", "LOWER", param],
      value.replace(/(..)(?!$)/g, "$1:")
    ];

  return [
    "OR",
    [
      "LIKE",
      ["FUNC", "LOWER", param],
      `%${value.replace(/(..)(?!$)/g, "$1:")}%`
    ],
    ["LIKE", ["FUNC", "LOWER", param], `%${value.replace(/(.)(.)/g, "$1:$2")}%`]
  ];
}

function unpack(resource, label, value) {
  if (!resources[resource]) return null;
  const type = resources[resource][label].type;
  value = value.trim();
  let res = ["OR"];

  if (type.length === 0 || type.includes("number")) {
    let q = queryNumber(resources[resource][label].parameter, value);
    if (q) res.push(q);
  }

  if (type.length === 0 || type.includes("string")) {
    let q = queryString(resources[resource][label].parameter, value);
    if (q) res.push(q);
  }

  if (type.includes("mac")) {
    let q = queryMac(resources[resource][label].parameter, value);
    if (q) res.push(q);
  }

  if (res.length <= 1) return null;
  else if (res.length === 2) return res[1];
  else return res;
}

export { getLabels, unpack };
