/**
 * Copyright 2013-2019  GenieACS Inc.
 *
 * This file is part of GenieACS.
 *
 * GenieACS is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * GenieACS is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with GenieACS.  If not, see <http://www.gnu.org/licenses/>.
 */

import config from "./config";
import { Expression } from "../lib/types";

const resources = {
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
  },
  files: {
    ID: { parameter: ["PARAM", "_id"], type: "string" },
    Type: { parameter: ["PARAM", "metadata.fileType"], type: "string" },
    OUI: { parameter: ["PARAM", "metadata.oui"], type: "string" },
    "Product class": {
      parameter: ["PARAM", "metadata.productClass"],
      type: "string"
    },
    Version: { parameter: ["PARAM", "metadata.version"], type: "string" }
  },
  permissions: {
    Role: { parameter: ["PARAM", "role"], type: "string" },
    Resource: { parameter: ["PARAM", "resource"], type: "string" },
    Access: { parameter: ["PARAM", "access"], type: "number" }
  },
  users: { Username: { parameter: ["PARAM", "_id"], type: "string" } }
};

for (const v of Object.values(config.ui.filters as {
  label: string;
  parameter: string;
  type: string;
}[])) {
  resources.devices[v.label] = {
    parameter: v.parameter,
    type: (v.type || "").split(",").map(s => s.trim())
  };
}

export function getLabels(resource): string[] {
  if (!resources[resource]) return [];
  return Object.keys(resources[resource]);
}

function queryNumber(param, value): Expression {
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

function queryTimestamp(param, value): Expression {
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

function queryString(param, value): Expression {
  return ["LIKE", ["FUNC", "LOWER", param], value.toLowerCase()];
}

function queryMac(param, value): Expression {
  value = value.replace(/[^a-f0-9]/gi, "").toLowerCase();
  if (!value) return null;
  if (value.length === 12) {
    return [
      "LIKE",
      ["FUNC", "LOWER", param],
      value.replace(/(..)(?!$)/g, "$1:")
    ];
  }

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

export function unpack(resource, label, value): Expression {
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

  if (type.includes("mac")) {
    const q = queryMac(resources[resource][label].parameter, value);
    if (q) res.push(q);
  }

  if (res.length <= 1) return null;
  else if (res.length === 2) return res[1];
  else return res;
}
