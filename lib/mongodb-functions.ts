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

import { ObjectID } from "mongodb";
import { map, parse, stringify } from "./common/expression-parser";
import { likePatternToRegExp, evaluate } from "./common/expression";
import { Expression, Fault, Task } from "./types";

const isArray = Array.isArray;

export function processDeviceFilter(filter): Expression {
  return map(filter, exp => {
    if (!isArray(exp)) return exp;

    if (exp[0] === "PARAM") {
      const p = exp[1];
      if (p === "DeviceID.ID") return ["PARAM", "_id"];
      else if (p === "DeviceID") return ["PARAM", "_deviceId"];
      else if (p.startsWith("DeviceID."))
        return ["PARAM", "_deviceId._" + p.slice(9)];
      else if (p === "Events.Inform") return ["PARAM", "_lastInform"];
      else if (p === "Events.Registered") return ["PARAM", "_registered"];
      else if (p === "Events.0_BOOTSTRAP") return ["PARAM", "_lastBootstrap"];
      else if (p === "Events.1_BOOT") return ["PARAM", "_lastBoot"];
    } else if (
      isArray(exp[1]) &&
      exp[1][0] === "PARAM" &&
      exp[1][1].startsWith("Tags.")
    ) {
      const t = exp[1][1].slice(5);
      if (exp[0] === "IS NULL") return ["<>", ["PARAM", "_tags"], t];
      else if (exp[0] === "IS NOT NULL") return ["=", ["PARAM", "_tags"], t];
      else if (exp[0] === "=" && exp[2] === true)
        return ["=", ["PARAM", "_tags"], t];
      else if (exp[0] === "<>" && exp[2] !== true)
        return ["=", ["PARAM", "_tags"], t];
    } else if (
      [
        "=",
        "<>",
        ">",
        ">=",
        "<",
        "<=",
        "LIKE",
        "NOT LIKE",
        "IS NULL",
        "IS NOT NULL"
      ].includes(exp[0])
    ) {
      let e = map(exp, ee => {
        if (
          isArray(ee) &&
          ee[0] === "PARAM" &&
          typeof ee[1] === "string" &&
          !ee[1].startsWith("_")
        )
          return ["PARAM", `${ee[1]}._value`];
        return ee;
      });

      if (typeof e[2] === "number") {
        const alt = (e as any[]).slice();
        alt[2] = new Date(e[2]);
        e = ["OR", e, alt];
      }
      return e;
    }
    return exp;
  });
}

export function processTasksFilter(filter): Expression {
  return map(filter, exp => {
    if (!isArray(exp)) return exp;
    if (["=", "<>", ">", ">=", "<", "<="].includes(exp[0])) {
      const e = exp.slice();
      if (e[1][0] === "PARAM" && e[1][1] === "_id") e[2] = new ObjectID(e[2]);
      else if (e[1][0] === "PARAM" && e[1][1] === "timestamp")
        e[2] = new Date(e[2]);
      else if (e[1][0] === "PARAM" && e[1][1] === "expiry")
        e[2] = new Date(e[2]);
      return e;
    }
    return exp;
  });
}

export function processFaultsFilter(filter): Expression {
  return map(filter, exp => {
    if (!isArray(exp)) return exp;
    if (["=", "<>", ">", ">=", "<", "<="].includes(exp[0])) {
      const e = exp.slice();
      if (e[1][0] === "PARAM" && e[1][1] === "timestamp") e[2] = new Date(e[2]);
      else if (e[1][0] === "PARAM" && e[1][1] === "expiry")
        e[2] = new Date(e[2]);
      return e;
    }
    return exp;
  });
}

export function filterToMongoQuery(exp: Expression): {} {
  const ops = {
    OR: 0,
    AND: 0,
    NOT: 0,
    "=": 1,
    "<>": 1,
    ">": 1,
    ">=": 1,
    "<": 1,
    "<=": 1,
    LIKE: 1,
    "NOT LIKE": 1,
    "IS NULL": 1,
    "IS NOT NULL": 1
  };

  function recursive(filter, negate, res = {}): {} {
    const op = filter[0];

    if (ops[op] === 0) {
      for (let i = 1; i < filter.length; ++i) {
        if (!isArray(filter[i]) || ops[filter[i][0]] == null)
          throw new Error(`Invalid expression in ${op} clause`);
      }

      if ((!negate && op === "AND") || (negate && op === "OR")) {
        res["$and"] = res["$and"] || [];
        for (let i = 1; i < filter.length; ++i)
          res["$and"].push(recursive(filter[i], negate));
      } else if ((!negate && op === "OR") || (negate && op === "AND")) {
        res["$or"] = res["$or"] || [];

        for (let i = 1; i < filter.length; ++i)
          res["$or"].push(recursive(filter[i], negate));
      } else if (op === "NOT") {
        recursive(filter[1], !negate, res);
      }
    } else if (ops[op] === 1) {
      if (isArray(filter[2])) {
        throw new Error(`Right operand of ${op} clause is not a primitive`);
      } else if (
        ["LIKE", "NOT LIKE"].includes(op) &&
        isArray(filter[1]) &&
        filter[1][0] === "FUNC" &&
        ["UPPER", "LOWER"].includes(filter[1][1])
      ) {
        if (
          (filter[1][1] === "UPPER" && filter[2] !== filter[2].toUpperCase()) ||
          (filter[1][1] === "LOWER" && filter[2] !== filter[2].toLowerCase())
        ) {
          throw new Error(
            `Cannot compare ${
              filter[1][1]
            }() against non-${filter[1][1].toLowerCase()}case pattern`
          );
        }
      } else if (!isArray(filter[1]) || filter[1][0] !== "PARAM") {
        throw new Error(`Left operand of ${op} clause is not a parameter`);
      }

      if (op === "=") {
        const param = filter[1][1];
        const p = (res[param] = res[param] || {});
        if (negate) p["$ne"] = filter[2];
        else p["$eq"] = filter[2];
      } else if (op === "<>") {
        const param = filter[1][1];
        let p = (res[param] = res[param] || {});
        if (negate) p = p["$not"] = p["$not"] || {};
        p["$ne"] = filter[2];
        if (param !== "_tags") p["$exists"] = true;
      } else if (op === ">") {
        const param = filter[1][1];
        let p = (res[param] = res[param] || {});
        if (negate) p = p["$not"] = p["$not"] || {};
        p["$gt"] = filter[2];
      } else if (op === ">=") {
        const param = filter[1][1];
        let p = (res[param] = res[param] || {});
        if (negate) p = p["$not"] = p["$not"] || {};
        p["$gte"] = filter[2];
      } else if (op === "<") {
        const param = filter[1][1];
        let p = (res[param] = res[param] || {});
        if (negate) p = p["$not"] = p["$not"] || {};
        p["$lt"] = filter[2];
      } else if (op === "<=") {
        const param = filter[1][1];
        let p = (res[param] = res[param] || {});
        if (negate) p = p["$not"] = p["$not"] || {};
        p["$lte"] = filter[2];
      } else if (op === "IS NULL") {
        const param = filter[1][1];
        res[param] = { $exists: negate };
      } else if (op === "IS NOT NULL") {
        const param = filter[1][1];
        res[param] = { $exists: !negate };
      } else {
        if (op === "NOT LIKE") negate = !negate;
        let param;
        let flags;
        if (filter[1][0] === "FUNC" && filter[1][1] === "UPPER") {
          param = filter[1][2][1];
          flags = "i";
        } else if (filter[1][0] === "FUNC" && filter[1][1] === "LOWER") {
          param = filter[1][2][1];
          flags = "i";
        } else {
          param = filter[1][1];
          flags = "";
        }
        const r = likePatternToRegExp(filter[2], filter[3], flags);
        if (negate) res[param] = { $not: r };
        else res[param] = r;
      }
    } else {
      throw new Error(`Unrecognized operator ${op}`);
    }

    return res;
  }

  const _exp = evaluate(exp, null, Date.now());

  if (!isArray(_exp)) {
    if (_exp === true) return {};
    throw new Error("Primitives are not valid queries");
  }

  return recursive(_exp, false);
}

export function processDeviceProjection(projection: {}): {} {
  if (!projection) return projection;
  const p = {};
  for (const [k, v] of Object.entries(projection)) {
    if (k === "DeviceID.ID") {
      p["_id"] = 1;
    } else if (k.startsWith("DeviceID")) {
      p["_deviceId._SerialNumber"] = v;
      p["_deviceId._OUI"] = v;
      p["_deviceId._ProductClass"] = v;
      p["_deviceId._Manufacturer"] = v;
    } else if (k.startsWith("Tags")) {
      p["_tags"] = v;
    } else if (k.startsWith("Events")) {
      p["_lastInform"] = v;
      p["_registered"] = v;
      p["_lastBoot"] = v;
      p["_lastBootstrap"] = v;
    } else {
      p[k] = v;
    }
  }

  return p;
}

export function processDeviceSort(sort: {}): {} {
  if (!sort) return sort;
  const s = {};
  for (const [k, v] of Object.entries(sort)) {
    if (k === "DeviceID.ID") s["_id"] = v;
    else if (k.startsWith("DeviceID.")) s[`_deviceId._${k.slice(9)}`] = v;
    else if (k === "Events.Inform") s["_lastInform"] = v;
    else if (k === "Events.Registered") s["_registered"] = v;
    else if (k === "Events.1_BOOT") s["_lastBoot"] = v;
    else if (k === "Events.0_BOOTSTRAP") s["_lastBootstrap"] = v;
    else s[`${k}._value`] = v;
  }

  return s;
}

function parseDate(d): number | string {
  const n = +d;
  return isNaN(n) ? "" + d : n;
}

interface FlatDevice {
  [param: string]: {
    object: boolean;
    objectTimestamp: number;
    writable: boolean;
    writableTimestamp: number;
    value: [string | number | boolean, string];
    valueTimestamp: number;
  };
}

export function flattenDevice(device): FlatDevice {
  function recursive(input, root, output, timestamp): void {
    for (const [name, tree] of Object.entries(input)) {
      if (!root) {
        if (name === "_lastInform") {
          output["Events.Inform"] = {
            value: [parseDate(tree), "xsd:dateTime"],
            valueTimestamp: timestamp,
            writable: false,
            writableTimestamp: timestamp,
            object: false,
            objectTimestamp: timestamp
          };
        } else if (name === "_registered") {
          output["Events.Registered"] = {
            value: [parseDate(tree), "xsd:dateTime"],
            valueTimestamp: timestamp,
            writable: false,
            writableTimestamp: timestamp,
            object: false,
            objectTimestamp: timestamp
          };
        } else if (name === "_lastBoot") {
          output["Events.1_BOOT"] = {
            value: [parseDate(tree), "xsd:dateTime"],
            valueTimestamp: timestamp,
            writable: false,
            writableTimestamp: timestamp,
            object: false,
            objectTimestamp: timestamp
          };
        } else if (name === "_lastBootstrap") {
          output["Events.0_BOOTSTRAP"] = {
            value: [parseDate(tree), "xsd:dateTime"],
            valueTimestamp: timestamp,
            writable: false,
            writableTimestamp: timestamp,
            object: false,
            objectTimestamp: timestamp
          };
        } else if (name === "_id") {
          output["DeviceID.ID"] = {
            value: [tree, "xsd:string"],
            valueTimestamp: timestamp,
            writable: false,
            writableTimestamp: timestamp,
            object: false,
            objectTimestamp: timestamp
          };
        } else if (name === "_deviceId") {
          output["DeviceID.Manufacturer"] = {
            value: [tree["_Manufacturer"], "xsd:string"],
            valueTimestamp: timestamp,
            writable: false,
            writableTimestamp: timestamp,
            object: false,
            objectTimestamp: timestamp
          };
          output["DeviceID.OUI"] = {
            value: [tree["_OUI"], "xsd:string"],
            valueTimestamp: timestamp,
            writable: false,
            writableTimestamp: timestamp,
            object: false,
            objectTimestamp: timestamp
          };
          output["DeviceID.ProductClass"] = {
            value: [tree["_ProductClass"], "xsd:string"],
            valueTimestamp: timestamp,
            writable: false,
            writableTimestamp: timestamp,
            object: false,
            objectTimestamp: timestamp
          };
          output["DeviceID.SerialNumber"] = {
            value: [tree["_SerialNumber"], "xsd:string"],
            valueTimestamp: timestamp,
            writable: false,
            writableTimestamp: timestamp,
            object: false,
            objectTimestamp: timestamp
          };
        } else if (name === "_tags") {
          output["Tags"] = {
            writable: false,
            writableTimestamp: timestamp,
            object: true,
            objectTimestamp: timestamp
          };

          for (const t of tree as string[]) {
            output[`Tags.${t}`] = {
              value: [true, "xsd:boolean"],
              valueTimestamp: timestamp,
              writable: true,
              writableTimestamp: timestamp,
              object: false,
              objectTimestamp: timestamp
            };
          }
        }
      }

      if (name.startsWith("_")) continue;

      let childrenTimestamp = timestamp;

      if (!root) childrenTimestamp = +(input["_timestamp"] || 1);
      else if (+input["_timestamp"] > timestamp)
        childrenTimestamp = +input["_timestamp"];

      const attrs = {};
      if (tree["_value"] != null) {
        attrs["value"] = [
          tree["_value"] instanceof Date ? +tree["_value"] : tree["_value"],
          tree["_type"]
        ];
        attrs["valueTimestamp"] = +(tree["_timestamp"] || childrenTimestamp);
        attrs["object"] = false;
        attrs["objectTimestamp"] = childrenTimestamp;
      } else if (tree["_object"] != null) {
        attrs["object"] = tree["_object"];
        attrs["objectTimestamp"] = childrenTimestamp;
      }

      if (tree["_writable"] != null) {
        attrs["writable"] = tree["_writable"];
        attrs["writableTimestamp"] = childrenTimestamp;
      }

      const r = root ? `${root}.${name}` : name;
      output[r] = attrs;

      if (attrs["object"] || tree["object"] == null)
        recursive(tree, r, output, childrenTimestamp);
    }
  }

  const newDevice = {};
  const timestamp = new Date(device["_lastInform"] || 1).getTime();
  recursive(device, "", newDevice, timestamp);
  return newDevice;
}

export function flattenFault(fault): Fault {
  const f = Object.assign({}, fault);
  if (f.timestamp) f.timestamp = +f.timestamp;
  if (f.expiry) f.expiry = +f.expiry;
  return f;
}

export function flattenTask(task): Task {
  const t = Object.assign({}, task);
  t._id = "" + t._id;
  if (t.timestamp) t.timestamp = +t.timestamp;
  if (t.expiry) t.expiry = +t.expiry;
  return t;
}

export function mongoQueryToFilter(query): Expression {
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
          if (isArray(v)) throw new Error(`Invalid type`);

          if (v.hasOwnProperty("$ne"))
            expressions.push(["IS NULL", ["PARAM", `Tags.${v["$ne"]}`]]);
          else if (v.hasOwnProperty("$eq"))
            expressions.push(["IS NOT NULL", ["PARAM", `Tags.${v["$eq"]}`]]);
          else throw new Error(`Invalid tag query`);
        } else {
          expressions.push(["IS NOT NULL", ["PARAM", `Tags.${v}`]]);
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
        if (isArray(v)) throw new Error(`Invalid type`);

        const exps: Expression[] = [];
        for (const [kk, vv] of Object.entries(v)) {
          let op;
          switch (kk) {
            case "$eq":
              op = "=";
              break;
            case "$ne":
              op = "<>";
              break;
            case "$lt":
              op = "<";
              break;
            case "$lte":
              op = "<=";
              break;
            case "$gt":
              op = ">";
              break;
            case "$gte":
              op = ">=";
              break;
            default:
              throw new Error(`Operator ${kk} not supported`);
          }
          exps.push([op, ["PARAM", k], vv]);
        }
        if (exps.length === 1) {
          expressions.push(exps[0]);
        } else {
          const and: Expression = ["AND"];
          expressions.push(and.concat(exps));
        }
      } else {
        expressions.push(["=", ["PARAM", k], v]);
      }
    }
    if (expressions.length === 1) return expressions[0];
    const and: Expression = ["AND"];
    return and.concat(expressions);
  }

  // empty filter
  if (!Object.keys(query).length) return true;

  return recursive(query);
}

export function flattenPreset(preset): {} {
  const p = Object.assign({}, preset);
  if (p.precondition) {
    try {
      // Try parse to check expression validity
      parse(p.precondition);
    } catch (error) {
      p.precondition = mongoQueryToFilter(JSON.parse(p.precondition));
      p.precondition = p.precondition.length ? stringify(p.precondition) : "";
    }
  }

  if (p.events) {
    const e = [];
    for (const [k, v] of Object.entries(p.events)) e.push(v ? k : `-${k}`);
    p.events = e.join(", ");
  }

  const provision = p.configurations[0];
  if (
    p.configurations.length === 1 &&
    provision.type === "provision" &&
    provision.name &&
    provision.name.length
  ) {
    p.provision = provision.name;
    p.provisionArgs = provision.args
      ? JSON.stringify(provision.args).slice(1, -1)
      : "";
  }

  delete p.configurations;
  return p;
}

export function flattenFile(file): {} {
  const f = {};
  f["_id"] = file["_id"];
  if (file.metadata) {
    f["metadata.fileType"] = file.metadata.fileType || "";
    f["metadata.oui"] = file.metadata.oui || "";
    f["metadata.productClass"] = file.metadata.productClass || "";
    f["metadata.version"] = file.metadata.version || "";
  }
  return f;
}

export function preProcessPreset(data): {} {
  const preset = Object.assign({}, data);

  if (!preset.precondition) preset.precondition = "";
  // Try parse to check expression validity
  parse(preset.precondition);

  preset.weight = parseInt(preset.weight) || 0;

  const events = {};
  if (preset.events) {
    for (let e of preset.events.split(",")) {
      let v = true;
      e = e.trim();
      if (e.startsWith("-")) {
        v = false;
        e = e.slice(1).trim();
      }
      if (e) events[e] = v;
    }
  }

  preset.events = events;

  if (!preset.provision) throw new Error("Invalid preset provision");

  const configuration = {
    type: "provision",
    name: preset.provision,
    args: null
  };

  if (preset.provisionArgs)
    configuration.args = JSON.parse(`[${preset.provisionArgs}]`);

  delete preset.provision;
  delete preset.provisionArgs;
  preset.configurations = [configuration];
  return preset;
}
