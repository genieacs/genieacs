import * as vm from "node:vm";
import * as crypto from "node:crypto";
import { collections } from "../db/db.ts";
import { convertOldPrecondition } from "../db/util.ts";
import * as logger from "../logger.ts";
import * as scheduling from "../scheduling.ts";
import Expression, { Value } from "../common/expression.ts";
import {
  Preset,
  Provisions,
  VirtualParameters,
  Files,
  Config,
} from "../types.ts";
import { LocalCache } from "../local-cache.ts";

interface Snapshot {
  presets: Preset[];
  provisions: Provisions;
  virtualParameters: VirtualParameters;
  files: Files;
  config: Config;
}

function flattenObject<T extends Record<keyof T, unknown>>(
  src: T,
  prefix = "",
  dst = {} as T,
): T {
  for (const k of Object.keys(src)) {
    const v = src[k];
    if (typeof v === "object" && !Array.isArray(v))
      flattenObject(v as T, `${prefix}${k}.`, dst);
    else dst[`${prefix}${k}`] = v;
  }
  return dst;
}

async function fetchPresets(): Promise<[string, Preset[]]> {
  const res = await collections.presets.find().toArray();
  let objects = await collections.objects.find().toArray();
  res.sort((a, b) => (a._id > b._id ? 1 : -1));
  objects.sort((a, b) => (a._id > b._id ? 1 : -1));
  const h = crypto
    .createHash("md5")
    .update(JSON.stringify(res))
    .update(JSON.stringify(objects))
    .digest("hex");

  objects = objects.map((obj) => {
    // Flatten object
    obj = flattenObject(obj);

    // If no keys are defined, consider all parameters as keys to keep the
    // same behavior from v1.0
    if (!obj["_keys"]?.length)
      obj["_keys"] = Object.keys(obj).filter((k) => !k.startsWith("_"));

    return obj;
  });

  res.sort((a, b) => {
    if (a["weight"] === b["weight"])
      return a["_id"] > b["_id"] ? 1 : a["_id"] < b["_id"] ? -1 : 0;
    else return a["weight"] - b["weight"];
  });

  const presets = [] as Preset[];
  for (const preset of res) {
    let schedule: { md5: string; duration: number; schedule: any } = null;
    if (preset["schedule"]) {
      const parts = preset["schedule"].trim().split(/\s+/);
      schedule = {
        md5: crypto.createHash("md5").update(preset["schedule"]).digest("hex"),
        duration: null,
        schedule: null,
      };

      try {
        schedule.duration = +parts.shift() * 1000;
        schedule.schedule = scheduling.parseCron(parts.join(" "));
      } catch {
        logger.warn({
          message: "Invalid preset schedule",
          preset: preset["_id"],
          schedule: preset["schedule"],
        });
        schedule.schedule = false;
      }
    }

    const events = preset["events"] || {};
    let precondition: Expression = new Expression.Literal(true);
    if (preset["precondition"]) {
      try {
        precondition = Expression.parse(preset["precondition"]);
      } catch {
        precondition = convertOldPrecondition(
          JSON.parse(preset["precondition"]),
        );
      }

      // Simplify expression
      precondition = precondition.evaluate((e) => e);
    }

    const _provisions: Preset["provisions"] = [];

    // Generate provisions from the old configuration format
    for (const c of preset.configurations) {
      switch (c.type) {
        case "age":
          _provisions.push([
            "refresh",
            new Expression.Literal(c.name),
            new Expression.Literal(+c.age),
          ]);
          break;

        case "value":
          _provisions.push([
            "value",
            new Expression.Literal(c.name),
            new Expression.Literal(c.value),
          ]);
          break;

        case "add_tag":
          _provisions.push([
            "tag",
            new Expression.Literal(c.tag),
            new Expression.Literal(true),
          ]);
          break;

        case "delete_tag":
          _provisions.push([
            "tag",
            new Expression.Literal(c.tag),
            new Expression.Literal(false),
          ]);
          break;

        case "provision":
          _provisions.push([
            c.name,
            ...(c.args || []).map((a) => Expression.parse(a)),
          ]);
          break;

        case "add_object":
          for (const obj of objects) {
            if (obj["_id"] === c.object) {
              const alias = obj["_keys"]
                .map((k) => `${k}:${JSON.stringify(obj[k])}`)
                .join(",");
              const p = `${c.name}.[${alias}]`;
              _provisions.push([
                "instances",
                new Expression.Literal(p),
                new Expression.Literal(1),
              ]);

              for (const k in obj) {
                if (!k.startsWith("_") && !(obj["_keys"].indexOf(k) !== -1))
                  _provisions.push([
                    "value",
                    new Expression.Literal(`${p}.${k}`),
                    new Expression.Literal(obj[k]),
                  ]);
              }
            }
          }

          break;

        case "delete_object":
          for (const obj of objects) {
            if (obj["_id"] === c.object) {
              const alias = obj["_keys"]
                .map((k) => `${k}:${JSON.stringify(obj[k])}`)
                .join(",");
              const p = `${c.name}.[${alias}]`;
              _provisions.push([
                "instances",
                new Expression.Literal(p),
                new Expression.Literal(0),
              ]);
            }
          }

          break;

        default: {
          const exhaustiveCheck: never = c;
          throw new Error(
            `Unknown configuration type ${exhaustiveCheck["type"]}`,
          );
        }
      }
    }

    presets.push({
      name: preset["_id"],
      channel: (preset["channel"] as string) || "default",
      schedule: schedule,
      events: events,
      precondition: precondition,
      provisions: _provisions,
    });
  }

  return [h, presets];
}

async function fetchProvisions(): Promise<[string, Provisions]> {
  const res = await collections.provisions.find().toArray();
  res.sort((a, b) => (a._id > b._id ? 1 : -1));
  const h = crypto.createHash("md5").update(JSON.stringify(res)).digest("hex");

  const provisions = {};
  for (const r of res) {
    provisions[r._id] = {};
    provisions[r._id].md5 = crypto
      .createHash("md5")
      .update(r.script)
      .digest("hex");
    provisions[r._id].script = new vm.Script(
      `"use strict";(function(){\n${r.script}\n})();`,
      { filename: r._id, lineOffset: -1 },
    );
  }

  return [h, provisions];
}

async function fetchVirtualParameters(): Promise<[string, VirtualParameters]> {
  const res = await collections.virtualParameters.find().toArray();
  res.sort((a, b) => (a._id > b._id ? 1 : -1));
  const h = crypto.createHash("md5").update(JSON.stringify(res)).digest("hex");

  const virtualParameters = {};
  for (const r of res) {
    virtualParameters[r._id] = {};
    virtualParameters[r._id].md5 = crypto
      .createHash("md5")
      .update(r.script)
      .digest("hex");
    virtualParameters[r._id].script = new vm.Script(
      `"use strict";(function(){\n${r.script}\n})();`,
      { filename: r._id, lineOffset: -1 },
    );
  }

  return [h, virtualParameters];
}

async function fetchFiles(): Promise<[string, Files]> {
  const res = await collections.files.find().toArray();
  res.sort((a, b) => (a._id > b._id ? 1 : -1));
  const h = crypto.createHash("md5").update(JSON.stringify(res)).digest("hex");
  const files = {};

  for (const r of res) {
    const id = r.filename || r._id.toString();
    files[id] = {};
    files[id].length = r.length;
  }

  return [h, files];
}

async function fetchConfig(): Promise<[string, Config]> {
  const conf = await collections.config.find().toArray();
  conf.sort((a, b) => (a._id > b._id ? 1 : -1));
  const h = crypto.createHash("md5").update(JSON.stringify(conf)).digest("hex");

  const _config = {};

  for (const c of conf) {
    // Evaluate expressions to simplify them
    _config[c._id] = Expression.parse(c.value).evaluate((e) => e);
  }

  return [h, _config];
}

const localCache = new LocalCache<Snapshot>("cwmp-local-cache-hash", refresh);

async function refresh(): Promise<[string, Snapshot]> {
  const res = await Promise.all([
    fetchPresets(),
    fetchProvisions(),
    fetchVirtualParameters(),
    fetchFiles(),
    fetchConfig(),
  ]);

  const h = crypto.createHash("md5");
  for (const r of res) h.update(r[0]);

  const snapshot = {
    presets: res[0][1],
    provisions: res[1][1],
    virtualParameters: res[2][1],
    files: res[3][1],
    config: res[4][1],
  };

  return [h.digest("hex"), snapshot];
}

export async function getRevision(): Promise<string> {
  return await localCache.getRevision();
}

export function getPresets(revision: string): Preset[] {
  return localCache.get(revision).presets;
}

export function getProvisions(revision: string): Provisions {
  return localCache.get(revision).provisions;
}

export function getVirtualParameters(revision: string): VirtualParameters {
  return localCache.get(revision).virtualParameters;
}

export function getFiles(revision: string): Files {
  return localCache.get(revision).files;
}

export function getConfig(
  revision: string,
  key: string,
  dflt: string,
  fn: (e: Expression) => Expression.Literal,
): string;
export function getConfig(
  revision: string,
  key: string,
  dflt: number,
  fn: (e: Expression) => Expression.Literal,
): number;
export function getConfig(
  revision: string,
  key: string,
  dflt: boolean,
  fn: (e: Expression) => Expression.Literal,
): boolean;
export function getConfig(
  revision: string,
  key: string,
  dflt: Value,
  fn: (e: Expression) => Expression.Literal,
): Value {
  const snapshot = localCache.get(revision);
  if (!snapshot) throw new Error("Cache snapshot does not exist");

  const e = snapshot.config[key];
  if (!e) return dflt;
  const v = e.evaluate(fn).value;
  if (typeof v !== typeof dflt) return dflt;
  return v;
}

export function getConfigExpression(
  snapshotKey: string,
  key: string,
): Expression {
  const snapshot = localCache.get(snapshotKey);
  return snapshot.config[key];
}
