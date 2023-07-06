import { Filter } from "mongodb";
import { EJSON } from "bson";
import {
  parse,
  stringify,
  parseList,
  parseLikePattern,
} from "./common/expression/parser";
import { Expression, Fault, Task } from "./types";
import { decodeTag, encodeTag } from "./common";
import {
  SynthContextBase,
  likeDisjoint,
  likeImplies,
} from "./common/expression/synth";
import normalize from "./common/expression/normalize";
import { Clause } from "./common/expression/synth";
import * as BI from "./common/expression/bigint";

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

type Minterm = number[];

function getParam(exp: Expression, collection: string): string {
  if (!Array.isArray(exp))
    throw new Error("Left-hand operand must be a parameter");

  if (exp[0] !== "PARAM")
    throw new Error("Left-hand operand must be a parameter");

  if (typeof exp[1] !== "string")
    throw new Error("Left-hand operand must be a parameter");

  const p = exp[1];
  if (collection === "devices") {
    if (p === "DeviceID.ID") return "_id";
    else if (p === "DeviceID") return "_deviceId";
    else if (p.startsWith("DeviceID.")) return "_deviceId._" + p.slice(9);
    else if (p === "Events.Inform") return "_lastInform";
    else if (p === "Events.Registered") return "_registered";
    else if (p === "Events.0_BOOTSTRAP") return "_lastBootstrap";
    else if (p === "Events.1_BOOT") return "_lastBoot";
    else if (!p.endsWith("._value") && !p.startsWith("Tags."))
      return `${p}._value`;
  }

  return p;
}

function getTypes(parameter: string, collection: string): string[] {
  if (collection === "devices") {
    if (parameter === "_id") return ["string"];
    if (parameter === "_lastInform") return ["date"];
    if (parameter === "_registered") return ["date"];
    if (parameter === "_lastBootstrap") return ["date"];
    if (parameter === "_lastBoot") return ["date"];
    if (parameter.startsWith("_deviceId.")) return ["string"];
    if (parameter === "Reboot._value") return ["date"];
    if (parameter === "FactoryReset._value") return ["date"];
    if (parameter.endsWith("_timestamp")) return ["date"];
    if (parameter.startsWith("Downloads.")) {
      if (parameter.endsWith("Download._value")) return ["date"];
      if (parameter.endsWith("Time._value")) return ["date"];
      if (parameter.endsWith("Name._value")) return ["string"];
      if (parameter.endsWith("Type._value")) return ["string"];
    }
    if (parameter.endsWith("_value"))
      return ["bool", "number", "date", "string"];
  } else if (collection === "tasks") {
    if (parameter === "_id") return ["oid"];
    if (parameter === "timestamp") return ["date"];
    if (parameter === "expiry") return ["date"];
    if (parameter === "name") return ["string"];
    if (parameter === "device") return ["string"];
  } else if (collection === "faults") {
    if (parameter === "_id") return ["string"];
    if (parameter === "timestamp") return ["date"];
    if (parameter === "expiry") return ["date"];
    if (parameter === "code") return ["string"];
    if (parameter === "retries") return ["number"];
    if (parameter === "channel") return ["string"];
    if (parameter === "device") return ["string"];
    if (parameter === "message") return ["string"];
  } else if (collection === "users") {
    if (parameter === "_id") return ["string"];
    if (parameter === "roles") return ["string"];
    else if (parameter === "password")
      throw new Error("Cannot query restricted parameters");
    else if (parameter === "salt")
      throw new Error("Cannot query restricted parameters");
  } else if (collection === "config") {
    if (parameter === "_id") return ["string"];
    else if (parameter === "value") return ["string"];
  } else if (collection === "files") {
    if (parameter === "_id") return ["string"];
    if (parameter === "metadata.fileType") return ["string"];
    if (parameter === "metadata.oui") return ["string"];
    if (parameter === "metadata.productClass") return ["string"];
    if (parameter === "metadata.version") return ["string"];
  } else if (collection === "permissions") {
    if (parameter === "_id") return ["string"];
    if (parameter === "role") return ["string"];
    if (parameter === "resource") return ["devices"];
    if (parameter === "access") return ["number"];
    if (parameter === "filter") return ["string"];
    if (parameter === "validate") return ["string"];
  } else if (collection === "presets") {
    if (parameter === "_id") return ["string"];
    if (parameter === "weight") return ["number"];
    if (parameter === "channel") return ["string"];
    if (parameter === "precondition") return ["string"];
    if (parameter.startsWith("events.")) return ["bool"];
  } else if (collection === "provisions") {
    if (parameter === "_id") return ["string"];
    if (parameter === "script") return ["string"];
  } else if (collection === "virtualParameters") {
    if (parameter === "_id") return ["string"];
    if (parameter === "script") return ["string"];
  }

  if (parameter === "_id") return ["oid", "string"];
  return ["bool", "number", "date", "string"];
}

function roundOid(oid: string, roundUp: boolean): string {
  const match = (oid.match(/^[0-9a-f]*/)?.[0] ?? "").slice(0, 24);
  let num = BI.BigInt("0x0" + match);
  let lastChar = 0;
  if (oid.length > match.length) lastChar += oid.charCodeAt(match.length);
  if (match.length < 24) lastChar -= 48;
  if (lastChar > 0 && roundUp) num++;
  num <<= BI.BigInt(4 * (24 - match.length));
  if (lastChar < 0 && !roundUp) --num;
  const str = num.toString(16);
  if (str.length > 24 || str.startsWith("-")) return null;
  return str.padStart(24, "0");
}

function groupBy<T, K>(
  input: T[],
  callback: (item: T) => K
): Iterable<[K, T[]]> {
  const groups = new Map<K, T[]>();
  for (const item of input) {
    const key = callback(item);
    let arr = groups.get(key);
    if (!arr) groups.set(key, (arr = []));
    arr.push(item);
  }

  return groups.entries();
}

abstract class MongoClause {
  abstract readonly parameter: string;
  abstract toQuery(truthy: boolean): Filter<unknown>;
  toString(): string {
    return JSON.stringify(this.toQuery(true));
  }
}

class MongoClauseArray extends MongoClause {
  constructor(
    public readonly parameter: string,
    public readonly value: string
  ) {
    super();
  }

  toQuery(truthy: boolean): Filter<unknown> {
    if (truthy) return { [this.parameter]: { $eq: this.value } };
    else return { [this.parameter]: { $ne: this.value } };
  }
}

class MongoClauseCompare<T> extends MongoClause {
  constructor(
    public readonly parameter: string,
    public readonly op: "$eq" | "$gt" | "$lt" | "$gte" | "$lte",
    public readonly value: T,
    public readonly type: "" | "bool" | "number" | "string" | "date" | "oid"
  ) {
    super();
  }

  toQuery(truthy: boolean): Filter<unknown> {
    let v: any = this.value;
    if (this.type === "date" && typeof v === "number")
      v = { $date: new Date(v).toISOString() };
    if (this.type === "oid" && typeof v === "string") v = { $oid: v };

    if (truthy) return { [this.parameter]: { [this.op]: v } };
    else if (this.op === "$eq") return { [this.parameter]: { $ne: v } };
    else return { [this.parameter]: { $not: { [this.op]: v } } };
  }
}

class MongoClauseType extends MongoClause {
  constructor(public readonly parameter: string, public readonly type: string) {
    super();
  }

  toQuery(truthy: boolean): Filter<unknown> {
    if (truthy) return { [this.parameter]: { $type: this.type } };
    else return { [this.parameter]: { $not: { $type: this.type } } };
  }
}

class MongoClauseLike extends MongoClause {
  readonly pattern: string[];
  constructor(
    public readonly parameter: string,
    pat: string,
    esc: string,
    public readonly caseSensitive: boolean
  ) {
    super();
    this.pattern = parseLikePattern(pat, esc);
  }

  toQuery(truthy: boolean): Filter<unknown> {
    const convChars = {
      "-": "\\-",
      "/": "\\/",
      "\\": "\\/",
      "^": "\\^",
      $: "\\$",
      "*": "\\*",
      "+": "\\+",
      "?": "\\?",
      ".": "\\.",
      "(": "\\(",
      ")": "\\)",
      "|": "\\|",
      "[": "\\[",
      "]": "\\]",
      "{": "\\{",
      "}": "\\}",
      "\\%": ".*",
      "\\_": ".",
    };

    const chars = this.pattern.map((c) => convChars[c] ?? c);
    chars[0] = chars[0] === ".*" ? "" : "^" + chars[0];
    const l = chars.length - 1;
    chars[l] = [".*", ""].includes(chars[l]) ? "" : chars[l] + "$";
    const pattern = chars.join("");
    const options = this.caseSensitive ? "s" : "is";
    if (truthy) {
      return { [this.parameter]: { $regularExpression: { options, pattern } } };
    } else {
      return {
        [this.parameter]: {
          $not: { $regularExpression: { options, pattern } },
        },
      };
    }
  }
}

class MongoSynthContext extends SynthContextBase<Clause, MongoClause> {
  constructor(private readonly collection: string) {
    super();
  }

  getMinterms(clause: Clause, res: true | false | null): number[][] {
    const exp = clause.expression();
    if (!Array.isArray(exp)) throw new Error("Invalid query expression");

    if (res === null) {
      const minterms: number[][] = [];
      for (const dep of clause.getNullables()) {
        const e = dep.operand.expression();
        const param = getParam(e, this.collection);
        if (param.startsWith("Tags.") && this.collection === "devices") {
          const t = decodeTag(param.slice(5));
          const c = new MongoClauseArray("_tags", t);
          minterms.push([this.getVar(c) << 1]);
          continue;
        }
        const c = new MongoClauseCompare(param, "$eq", null, "");
        minterms.push([(this.getVar(c) << 1) ^ 1]);
      }
      return minterms;
    }

    if ([">", "<", "="].includes(exp[0])) {
      const param = getParam(exp[1], this.collection);

      let rhs = exp[2];
      if (typeof rhs === "boolean") rhs = +rhs;
      else if (typeof rhs !== "string" && typeof rhs !== "number")
        throw new Error(`Right-hand operand must be a literal value`);

      if (
        param.startsWith("Tags.") &&
        this.collection === "devices" &&
        exp[0] === "="
      ) {
        const t = decodeTag(param.slice(5));
        const c = new MongoClauseArray("_tags", t);
        if (typeof rhs === "string") rhs = 2;
        if (exp[0] === "=") {
          if ((rhs === 1) !== res) return [];
        } else if (exp[0] === ">") {
          if ((res && rhs >= 1) || (!res && rhs < 1)) return [];
        } else if (exp[0] === "<") {
          if ((res && rhs <= 1) || (!res && rhs > 1)) return [];
        }
        return [[(this.getVar(c) << 1) ^ 1]];
      }

      let op: "$gt" | "$lt" | "$eq" | "$gte" | "$lte";
      if (exp[0] === "=") op = "$eq";
      else if (exp[0] === ">") op = res ? "$gt" : "$lte";
      else if (exp[0] === "<") op = res ? "$lt" : "$gte";

      const possibleTypes = new Set(getTypes(param, this.collection));
      const clauses: MongoClause[] = [];

      if (typeof rhs === "number") {
        if (possibleTypes.has("number"))
          clauses.push(new MongoClauseCompare(param, op, rhs, "number"));

        if (possibleTypes.has("date"))
          clauses.push(new MongoClauseCompare(param, op, rhs, "date"));
        if (possibleTypes.has("bool") && (rhs === 0 || rhs === 1))
          clauses.push(new MongoClauseCompare(param, op, !!rhs, "bool"));
      } else if (typeof rhs === "string") {
        if (possibleTypes.has("string"))
          clauses.push(new MongoClauseCompare(param, op, rhs, "string"));

        if (possibleTypes.has("oid")) {
          const oid = roundOid(rhs, op === "$lt" || op === "$lte");
          if (oid && (op !== "$eq" || oid === rhs))
            clauses.push(new MongoClauseCompare(param, op, oid, "oid"));
        }
      }

      if (op === "$eq" && !res) {
        clauses.push(new MongoClauseCompare(param, "$eq", null, ""));
        return [clauses.map((c) => this.getVar(c) << 1)];
      }

      // In the following clauses we could use $type operator, but we want the
      // final query to use comparison operators to check for type because the
      // $type operator in MongoDB doesn't use indexes
      if (typeof rhs === "number") {
        if (possibleTypes.has("bool")) {
          if (
            (rhs > 1 && (op === "$lt" || op === "$lte")) ||
            (rhs < 0 && (op === "$gt" || op === "$gte"))
          )
            clauses.push(new MongoClauseCompare(param, "$gte", false, "bool"));
        }

        if (op === "$gt" || op === "$gte") {
          if (possibleTypes.has("string"))
            clauses.push(new MongoClauseCompare(param, "$gte", "", "string"));

          if (possibleTypes.has("oid")) {
            clauses.push(
              new MongoClauseCompare(
                param,
                "$gte",
                "000000000000000000000000",
                "oid"
              )
            );
          }
        }
      } else if (typeof rhs === "string") {
        if (op === "$lt" || op === "$lte") {
          if (possibleTypes.has("bool"))
            clauses.push(new MongoClauseCompare(param, "$gte", false, "bool"));

          if (possibleTypes.has("number")) {
            clauses.push(new MongoClauseCompare(param, "$gte", 0, "number"));
            clauses.push(new MongoClauseCompare(param, "$lt", 0, "number"));
          }
          if (possibleTypes.has("date")) {
            clauses.push(new MongoClauseCompare(param, "$gte", 0, "date"));
            clauses.push(new MongoClauseCompare(param, "$lt", 0, "date"));
          }
        }
      }

      return clauses.map((c) => [(this.getVar(c) << 1) ^ 1]);
    } else if (exp[0] === "LIKE") {
      const pat = exp[2];
      if (typeof pat !== "string")
        throw new Error("Right-hand operand of 'LIKE' must be a string");
      let p = exp[1];
      let caseSensitive = true;
      if (
        Array.isArray(p) &&
        p[0] === "FUNC" &&
        ["UPPER", "LOWER"].includes(p[1])
      ) {
        if (p[1] === "UPPER" && pat !== pat.toUpperCase())
          return res ? [] : [[]];
        if (p[1] === "LOWER" && pat !== pat.toLowerCase())
          return res ? [] : [[]];
        caseSensitive = false;
        p = p[2];
      }

      const param = getParam(p, this.collection);
      const c = new MongoClauseLike(param, pat, exp[3], caseSensitive);
      if (res) return [[(this.getVar(c) << 1) ^ 1]];
      const typeClase = new MongoClauseType(param, "string");
      const r = [[this.getVar(c) << 1, (this.getVar(typeClase) << 1) ^ 1]];
      return r;
    } else {
      throw new Error("Invalid query expression");
    }
  }

  getDcSet(minterms: Minterm[]): number[][] {
    const dcSet: number[][] = [];

    const vars = new Set(minterms.flat().map((l) => l >> 1));
    const clauses = Array.from(vars).map((v) => this.getClause(v));

    for (const [parameter, clauses2] of groupBy(clauses, (c) => c.parameter)) {
      const comparisons = clauses2.filter(
        (c) => c instanceof MongoClauseCompare && c.value !== null
      ) as MongoClauseCompare<unknown>[];

      for (const [type, clauses3] of groupBy(comparisons, (c) => c.type)) {
        const isType = this.getVar(new MongoClauseType(parameter, type));
        const values = new Set(clauses3.map((c) => c.value));
        const valuesSorted = Array.from(values).sort((a, b) =>
          a > b ? 1 : -1
        );
        for (const [i, v] of valuesSorted.entries()) {
          const eq = this.getVar(
            new MongoClauseCompare(parameter, "$eq", v, type)
          );
          const gt = this.getVar(
            new MongoClauseCompare(parameter, "$gt", v, type)
          );
          const lt = this.getVar(
            new MongoClauseCompare(parameter, "$lt", v, type)
          );
          const gte = this.getVar(
            new MongoClauseCompare(parameter, "$gte", v, type)
          );
          const lte = this.getVar(
            new MongoClauseCompare(parameter, "$lte", v, type)
          );

          if (type === "bool") {
            if (v === false) dcSet.push([(lt << 1) ^ 1]);
            else if (v === true) dcSet.push([(gt << 1) ^ 1]);
          } else if (type === "string") {
            if (v === "") dcSet.push([(lt << 1) ^ 1]);
          } else if (type === "oid") {
            if (v < "000000000000000000000000") dcSet.push([(lte << 1) ^ 1]);
            else if (v === "000000000000000000000000")
              dcSet.push([(lt << 1) ^ 1]);
            else if (v > "ffffffffffffffffffffffff")
              dcSet.push([(gte << 1) ^ 1]);
            else if (v === "ffffffffffffffffffffffff")
              dcSet.push([(gt << 1) ^ 1]);
          }
          dcSet.push([(lt << 1) ^ 1, (gte << 1) ^ 1]);
          dcSet.push([(gt << 1) ^ 1, (gte << 1) ^ 0]);
          dcSet.push([(eq << 1) ^ 0, (lt << 1) ^ 0, (lte << 1) ^ 1]);
          dcSet.push([(eq << 1) ^ 1, (gte << 1) ^ 0]);
          dcSet.push([(eq << 1) ^ 1, (gt << 1) ^ 1]);

          if (i === 0) {
            dcSet.push([(isType << 1) ^ 0, (gte << 1) ^ 1]);
            dcSet.push([(isType << 1) ^ 0, (lt << 1) ^ 1]);
          } else {
            const gt2 = this.getVar(
              new MongoClauseCompare(
                parameter,
                "$gt",
                valuesSorted[i - 1],
                type
              )
            );
            const lte2 = this.getVar(
              new MongoClauseCompare(
                parameter,
                "$lte",
                valuesSorted[i - 1],
                type
              )
            );
            dcSet.push([(gt2 << 1) ^ 0, (gte << 1) ^ 1]);
            dcSet.push([(gt2 << 1) ^ 0, (lte2 << 1) ^ 0, (lt << 1) ^ 1]);
          }

          if (i === valuesSorted.length - 1)
            dcSet.push([(isType << 1) ^ 1, (gt << 1) ^ 0, (lte << 1) ^ 0]);
        }
      }

      const likes = clauses2.filter(
        (c) => c instanceof MongoClauseLike
      ) as MongoClauseLike[];
      if (likes.length) {
        const isType = this.getVar(new MongoClauseType(parameter, "string"));
        for (let i1 = 0; i1 < likes.length; ++i1) {
          const l1 = likes[i1];
          let p1 = l1.pattern;
          dcSet.push([(this.getVar(l1) << 1) ^ 1, (isType << 1) ^ 0]);
          for (let i2 = i1 + 1; i2 < likes.length; ++i2) {
            const l2 = likes[i2];
            let p2 = l2.pattern;
            if (!l1.caseSensitive || !l2.caseSensitive) {
              p1 = p1.map((c) => c.toLowerCase());
              p2 = p2.map((c) => c.toLowerCase());
            }
            if (likeDisjoint(p1, p2)) {
              dcSet.push([
                (this.getVar(l1) << 1) ^ 1,
                (this.getVar(l2) << 1) ^ 1,
              ]);
            } else if (
              (!l1.caseSensitive || l2.caseSensitive) &&
              likeImplies(p1, p2)
            ) {
              dcSet.push([
                (this.getVar(l1) << 1) ^ 0,
                (this.getVar(l2) << 1) ^ 1,
              ]);
            } else if (
              (!l2.caseSensitive || l1.caseSensitive) &&
              likeImplies(p2, p1)
            ) {
              dcSet.push([
                (this.getVar(l1) << 1) ^ 1,
                (this.getVar(l2) << 1) ^ 0,
              ]);
            }
          }
        }
      }

      const isNull = this.getVar(
        new MongoClauseCompare(parameter, "$eq", null, "")
      );

      const types = getTypes(parameter, this.collection).map((t) =>
        this.getVar(new MongoClauseType(parameter, t))
      );

      dcSet.push([(isNull << 1) ^ 0, ...types.map((t) => (t << 1) ^ 0)]);
      for (let i = 0; i < types.length; ++i) {
        const t1 = types[i];
        dcSet.push([(t1 << 1) ^ 1, (isNull << 1) ^ 1]);
        for (let j = i + 1; j < types.length; ++j) {
          const t2 = types[j];
          dcSet.push([(t1 << 1) ^ 1, (t2 << 1) ^ 1]);
        }
      }

      if (parameter === "_id") dcSet.push([(isNull << 1) ^ 1]);
    }
    return dcSet;
  }

  canRaise(i: number, s: Set<number>): boolean {
    if (!(i & 1)) return true;
    const c = this.getClause(i >> 1);
    if (c instanceof MongoClauseCompare) {
      for (const j of s) {
        if (j === i) continue;
        const c2 = this.getClause(j >> 1);
        if (c2.parameter !== c.parameter) continue;
        if (!(j & 1)) return false;
        if (c2 instanceof MongoClauseType) return false;
      }
    }
    return true;
  }

  toQuery(minterms: Minterm[]): Filter<unknown> {
    const or = [];

    for (const minterm of minterms) {
      const query = {};
      loop: for (const clause of minterm) {
        if (!minterm.length) return {};
        const negate = !!(clause & 1);
        const c = this.getClause(clause >> 1);
        const q = c.toQuery(negate);
        if (Object.keys(q).length !== 1)
          throw new Error("Invalid query expression");
        const [param, value] = Object.entries(q)[0];
        if (Object.getPrototypeOf(value).constructor !== Object)
          throw new Error("Invalid query expression");
        const dests = [query, ...(query["$and"] ?? [])];
        for (const dest of dests) {
          if (!(param in dest)) {
            dest[param] = value;
            continue loop;
          }

          let src = value;
          let dst = dest[param];

          if (src["$not"] && dst["$not"]) {
            src = src["$not"];
            dst = dst["$not"];
          }

          if (!Object.keys(src).some((k) => k in dst)) {
            Object.assign(dst, src);
            continue loop;
          }
        }

        query["$and"] ??= [];
        query["$and"].push({ [param]: value });
      }
      or.push(query);
    }

    if (or.length === 1) return or[0];
    return { $or: or };
  }
}

export function toMongoQuery(
  exp: Expression,
  resource: string
): Filter<unknown> | false {
  exp = normalize(exp);
  const clause = Clause.fromExpression(normalize(exp));
  const context = new MongoSynthContext(resource);
  const minterms = clause.true(context);
  const minimized = context.minimize(minterms);
  if (!minimized.length) return false;
  return EJSON.deserialize(context.toQuery(minimized));
}

export function validQuery(exp: Expression, resource: string): void {
  const clause = Clause.fromExpression(normalize(exp));
  const context = new MongoSynthContext(resource);
  clause.true(context);
}
