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
import { map, parse, stringify, parseList } from "./common/expression-parser";
import { likePatternToRegExp } from "./common/expression";
import { Expression, Fault, Task } from "./types";
import { decodeTag, encodeTag } from "./common";

const isArray = Array.isArray;

export function processDeviceFilter(filter: Expression): Expression {
  return map(filter, (exp) => {
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
      const t = decodeTag(exp[1][1].slice(5));
      if (exp[0] === "IS NULL") return ["_tags", t, false];
      else if (exp[0] === "IS NOT NULL") return ["_tags", t, true];
      else if (exp[0] === "=" && exp[2] === true) return ["_tags", t, true];
      else if (exp[0] === "<>" && exp[2] !== true) return ["_tags", t, true];
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
        "IS NOT NULL",
      ].includes(exp[0])
    ) {
      let e = map(exp, (ee) => {
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

export function processTasksFilter(filter: Expression): Expression {
  return map(filter, (exp) => {
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

export function processFaultsFilter(filter: Expression): Expression {
  return map(filter, (exp) => {
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

export function filterToMongoQuery(exp: Expression): Record<string, unknown> {
  function recursive(filter, negate): Record<string, unknown> {
    const op = filter[0];

    if (op === "AND") {
      filter = filter.filter((f) => f !== true);
      if (filter.length === 2) return recursive(filter[1], negate);
    }

    if (op === "OR") {
      filter = filter.filter((f) => f !== false);
      if (filter.length === 2) return recursive(filter[1], negate);
    }

    if ((!negate && op === "AND") || (negate && op === "OR"))
      return { $and: filter.slice(1).map((f) => recursive(f, negate)) };

    if ((!negate && op === "OR") || (negate && op === "AND"))
      return { $or: filter.slice(1).map((f) => recursive(f, negate)) };

    if (op === "NOT") return recursive(filter[1], !negate);

    if (isArray(filter[2]))
      throw new Error(`Invalid RHS operand of ${op} clause`);

    if (op === "LIKE" || op === "NOT LIKE") {
      if (op === "NOT LIKE") negate = !negate;
      let param;
      let flags;
      if (!Array.isArray(filter[1]))
        throw new Error(`Invalid LHS operand of ${op} clause`);
      if (filter[1][0] === "FUNC" && filter[1][1] === "UPPER") {
        if (filter[2] !== filter[2].toUpperCase())
          throw new Error(`Invalid RHS operand of ${op} clause`);
        param = filter[1][2][1];
        flags = "i";
      } else if (filter[1][0] === "FUNC" && filter[1][1] === "LOWER") {
        if (filter[2] !== filter[2].toLowerCase())
          throw new Error(`Invalid RHS operand of ${op} clause`);
        param = filter[1][2][1];
        flags = "i";
      } else if (filter[1][0] === "PARAM") {
        param = filter[1][1];
        flags = "";
      } else {
        throw new Error(`Invalid LHS operand of ${op} clause`);
      }
      const r = likePatternToRegExp(filter[2], filter[3], flags);
      if (negate) return { [param]: { $nin: [r, null] } };
      else return { [param]: r };
    }

    if (op === "_tags") {
      let t = filter[2];
      if (negate) t = !t;
      if (t) return { _tags: filter[1] };
      else return { _tags: { $ne: filter[1] } };
    }

    if (!isArray(filter[1]) || filter[1][0] !== "PARAM")
      throw new Error(`Invalid LHS operand of ${op} clause`);

    if (op === "IS NULL") {
      const p = filter[1][1];
      return { [p]: null };
    }

    if (op === "IS NOT NULL") {
      const p = filter[1][1];
      return { [p]: { $ne: null } };
    }

    if (isArray(filter[2]) || filter[2] == null)
      throw new Error(`Invalid RHS operand of ${op} clause`);

    if (op === "=") {
      const p = filter[1][1];
      const v = filter[2];
      if (!negate) return { [p]: v };
      else return { [p]: { $nin: [v, null] } };
    }

    if (op === "<>") {
      const p = filter[1][1];
      const v = filter[2];
      if (negate) return { [p]: v };
      else return { [p]: { $nin: [v, null] } };
    }

    if (op === ">") {
      const p = filter[1][1];
      const v = filter[2];
      if (negate) return { [p]: { $lte: v } };
      else return { [p]: { $gt: v } };
    }

    if (op === ">=") {
      const p = filter[1][1];
      const v = filter[2];
      if (negate) return { [p]: { $lt: v } };
      else return { [p]: { $gte: v } };
    }

    if (op === "<") {
      const p = filter[1][1];
      const v = filter[2];
      if (negate) return { [p]: { $gte: v } };
      else return { [p]: { $lt: v } };
    }

    if (op === "<=") {
      const p = filter[1][1];
      const v = filter[2];
      if (negate) return { [p]: { $gt: v } };
      else return { [p]: { $lte: v } };
    }

    throw new Error(`Unrecognized operator ${op}`);
  }

  if (!isArray(exp)) {
    if (exp === true) return {};
    throw new Error("Primitives are not valid queries");
  }

  return recursive(exp, false);
}

export function processDeviceProjection(
  projection: Record<string, 1>
): Record<string, 1> {
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

export function processDeviceSort(
  sort: Record<string, number>
): Record<string, number> {
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

function parseDate(d: Date): number | string {
  const n = +d;
  return isNaN(n) ? "" + d : n;
}

interface FlatAttributes {
  object?: boolean;
  objectTimestamp?: number;
  writable?: boolean;
  writableTimestamp?: number;
  value?: [string | number | boolean, string];
  valueTimestamp?: number;
  notification?: number;
  notificationTimestamp?: number;
  accessList?: string[];
  accessListTimestamp?: number;
}

interface FlatDevice {
  [param: string]: FlatAttributes;
}

export function flattenDevice(device: Record<string, unknown>): FlatDevice {
  function recursive(
    input,
    root: string,
    output: FlatDevice,
    timestamp: number
  ): void {
    for (const [name, tree] of Object.entries(input)) {
      if (!root) {
        if (name === "_lastInform") {
          output["Events.Inform"] = {
            value: [parseDate(tree as Date), "xsd:dateTime"],
            valueTimestamp: timestamp,
            writable: false,
            writableTimestamp: timestamp,
            object: false,
            objectTimestamp: timestamp,
          };
        } else if (name === "_registered") {
          output["Events.Registered"] = {
            value: [parseDate(tree as Date), "xsd:dateTime"],
            valueTimestamp: timestamp,
            writable: false,
            writableTimestamp: timestamp,
            object: false,
            objectTimestamp: timestamp,
          };
        } else if (name === "_lastBoot") {
          output["Events.1_BOOT"] = {
            value: [parseDate(tree as Date), "xsd:dateTime"],
            valueTimestamp: timestamp,
            writable: false,
            writableTimestamp: timestamp,
            object: false,
            objectTimestamp: timestamp,
          };
        } else if (name === "_lastBootstrap") {
          output["Events.0_BOOTSTRAP"] = {
            value: [parseDate(tree as Date), "xsd:dateTime"],
            valueTimestamp: timestamp,
            writable: false,
            writableTimestamp: timestamp,
            object: false,
            objectTimestamp: timestamp,
          };
        } else if (name === "_id") {
          output["DeviceID.ID"] = {
            value: [tree as string, "xsd:string"],
            valueTimestamp: timestamp,
            writable: false,
            writableTimestamp: timestamp,
            object: false,
            objectTimestamp: timestamp,
          };
        } else if (name === "_deviceId") {
          output["DeviceID.Manufacturer"] = {
            value: [tree["_Manufacturer"], "xsd:string"],
            valueTimestamp: timestamp,
            writable: false,
            writableTimestamp: timestamp,
            object: false,
            objectTimestamp: timestamp,
          };
          output["DeviceID.OUI"] = {
            value: [tree["_OUI"], "xsd:string"],
            valueTimestamp: timestamp,
            writable: false,
            writableTimestamp: timestamp,
            object: false,
            objectTimestamp: timestamp,
          };
          output["DeviceID.ProductClass"] = {
            value: [tree["_ProductClass"], "xsd:string"],
            valueTimestamp: timestamp,
            writable: false,
            writableTimestamp: timestamp,
            object: false,
            objectTimestamp: timestamp,
          };
          output["DeviceID.SerialNumber"] = {
            value: [tree["_SerialNumber"], "xsd:string"],
            valueTimestamp: timestamp,
            writable: false,
            writableTimestamp: timestamp,
            object: false,
            objectTimestamp: timestamp,
          };
        } else if (name === "_tags") {
          output["Tags"] = {
            writable: false,
            writableTimestamp: timestamp,
            object: true,
            objectTimestamp: timestamp,
          };

          for (const t of tree as string[]) {
            output[`Tags.${encodeTag(t)}`] = {
              value: [true, "xsd:boolean"],
              valueTimestamp: timestamp,
              writable: true,
              writableTimestamp: timestamp,
              object: false,
              objectTimestamp: timestamp,
            };
          }
        }
      }

      if (name.startsWith("_")) continue;

      let childrenTimestamp = timestamp;

      if (!root) childrenTimestamp = +(input["_timestamp"] || 1);
      else if (+input["_timestamp"] > timestamp)
        childrenTimestamp = +input["_timestamp"];

      const attrs: FlatAttributes = {};
      if (tree["_value"] != null) {
        attrs.value = [
          tree["_value"] instanceof Date ? +tree["_value"] : tree["_value"],
          tree["_type"],
        ];
        attrs.valueTimestamp = +(tree["_timestamp"] || childrenTimestamp);
        attrs.object = false;
        attrs.objectTimestamp = childrenTimestamp;
      } else if (tree["_object"] != null) {
        attrs.object = tree["_object"];
        attrs.objectTimestamp = childrenTimestamp;
      }

      if (tree["_writable"] != null) {
        attrs.writable = tree["_writable"];
        attrs.writableTimestamp = childrenTimestamp;
      }

      if (tree["_notification"] != null) {
        attrs.notification = tree["_notification"];
        attrs.notificationTimestamp = +tree["_attributesTimestamp"] || 1;
      }

      if (tree["_accessList"] != null) {
        attrs.accessList = tree["_accessList"];
        attrs.accessListTimestamp = +tree["_attributesTimestamp"] || 1;
      }

      const r = root ? `${root}.${name}` : name;
      output[r] = attrs;

      if (attrs.object || tree["object"] == null)
        recursive(tree, r, output, childrenTimestamp);
    }
  }

  const newDevice: FlatDevice = {};
  const timestamp = new Date((device["_lastInform"] as Date) || 1).getTime();
  recursive(device, "", newDevice, timestamp);
  return newDevice;
}

export function flattenFault(fault: unknown): Fault {
  const f = Object.assign({}, fault) as Fault;
  if (f.timestamp) f.timestamp = +f.timestamp;
  if (f["expiry"]) f["expiry"] = +f["expiry"];
  return f as Fault;
}

export function flattenTask(task: unknown): Task {
  const t = Object.assign({}, task) as Task;
  t._id = "" + t._id;
  if (t["timestamp"]) t["timestamp"] = +t["timestamp"];
  if (t.expiry) t.expiry = +t.expiry;
  return t;
}

export function convertOldPrecondition(
  query: Record<string, unknown>
): Expression {
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
        if (isArray(v)) throw new Error(`Invalid type`);

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
  if (!Object.keys(query).length) return true;

  return recursive(query);
}

export function flattenPreset(
  preset: Record<string, unknown>
): Record<string, unknown> {
  const p = Object.assign({}, preset);
  if (p.precondition) {
    try {
      // Try parse to check expression validity
      parse(p.precondition as string);
    } catch (error) {
      p.precondition = convertOldPrecondition(
        JSON.parse(p.precondition as string)
      );
      p.precondition = (p.precondition as string).length
        ? stringify(p.precondition as Expression)
        : "";
    }
  }

  if (p.events) {
    const e = [];
    for (const [k, v] of Object.entries(p.events)) e.push(v ? k : `-${k}`);
    p.events = e.join(", ");
  }

  const provision = p.configurations[0];
  if (
    (p.configurations as any[]).length === 1 &&
    provision.type === "provision" &&
    provision.name &&
    provision.name.length
  ) {
    p.provision = provision.name;
    p.provisionArgs = provision.args
      ? provision.args.map((a) => stringify(a)).join(", ")
      : "";
  }

  delete p.configurations;
  return p;
}

export function flattenFile(
  file: Record<string, unknown>
): Record<string, unknown> {
  const f = {};
  f["_id"] = file["_id"];
  if (file.metadata) {
    f["metadata.fileType"] = file["metadata"]["fileType"] || "";
    f["metadata.oui"] = file["metadata"]["oui"] || "";
    f["metadata.productClass"] = file["metadata"]["productClass"] || "";
    f["metadata.version"] = file["metadata"]["version"] || "";
  }
  return f;
}

export function preProcessPreset(
  data: Record<string, unknown>
): Record<string, unknown> {
  const preset = Object.assign({}, data);

  if (!preset.precondition) preset.precondition = "";
  // Try parse to check expression validity
  parse(preset.precondition as string);

  preset.weight = parseInt(preset.weight as string) || 0;

  const events = {};
  if (preset.events) {
    for (let e of (preset.events as string).split(",")) {
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
    args: null,
  };

  if (preset.provisionArgs)
    configuration.args = parseList(preset.provisionArgs as string);

  delete preset.provision;
  delete preset.provisionArgs;
  preset.configurations = [configuration];
  return preset;
}
