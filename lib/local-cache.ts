/**
 * Copyright 2013-2018  Zaid Abdulla
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

import * as vm from "vm";
import * as crypto from "crypto";
import * as config from "./config";
import * as db from "./db";
import * as cache from "./cache";
import { mongoQueryToFilter } from "./mongodb-functions";
import * as logger from "./logger";
import * as scheduling from "./scheduling";
import * as expression from "./common/expression";
import { parse } from "./common/expression-parser";
import { Preset, Expression } from "./types";

interface Permissions {
  [role: string]: {
    [access: number]: {
      [resource: string]: {
        access: number;
        filter: Expression;
        validate: { [validator: string]: boolean };
      };
    };
  };
}

const REFRESH = 3000;
const EVICT_TIMEOUT = 60000;

const snapshots = new Map();
let currentSnapshot = null;
let nextRefresh = 1;

function computeHash(snapshot): string {
  // MD5 hash for presets, provisions, virtual parameters for detecting changes
  const h = crypto.createHash("md5");
  for (const p of snapshot.presets) {
    h.update(JSON.stringify(p.name));
    h.update(JSON.stringify(p.channel));
    h.update(JSON.stringify(p.schedule));
    h.update(JSON.stringify(p.events));
    h.update(JSON.stringify(p.precondition));
    h.update(JSON.stringify(p.provisions));
  }

  let keys;

  keys = Object.keys(snapshot.provisions).sort();
  h.update(JSON.stringify(keys));
  for (const k of keys) h.update(snapshot.provisions[k].md5);

  keys = Object.keys(snapshot.virtualParameters).sort();
  h.update(JSON.stringify(keys));
  for (const k of keys) h.update(snapshot.virtualParameters[k].md5);

  keys = Object.keys(snapshot.config).sort();
  h.update(JSON.stringify(keys));
  for (const k of keys) h.update(JSON.stringify(snapshot.config[k]));

  keys = Object.keys(snapshot.files).sort();
  h.update(JSON.stringify(keys));
  for (const k of keys) h.update(JSON.stringify(snapshot.files[k]));

  keys = Object.keys(snapshot.users).sort();
  h.update(JSON.stringify(keys));
  for (const k of keys) h.update(JSON.stringify(snapshot.users[k]));

  const roles = Object.keys(snapshot.permissions).sort();
  h.update(JSON.stringify(roles));
  for (const r of roles) {
    const levels = Object.keys(snapshot.permissions[r]).sort();
    h.update(JSON.stringify(levels));
    for (const l of levels) {
      keys = Object.keys(snapshot.permissions[r][l]).sort();
      h.update(JSON.stringify(keys));
      for (const k of keys)
        h.update(JSON.stringify(snapshot.permissions[r][l][k]));
    }
  }

  return h.digest("hex");
}

function flattenObject(src, prefix = "", dst = {}): {} {
  for (const k of Object.keys(src)) {
    const v = src[k];
    if (typeof v === "object" && !Array.isArray(v))
      flattenObject(v, `${prefix}${k}.`, dst);
    else dst[`${prefix}${k}`] = v;
  }
  return dst;
}

function refresh(callback): void {
  if (!nextRefresh) {
    return void setTimeout(() => {
      refresh(callback);
    }, 20);
  }

  nextRefresh = 0;
  const now = Date.now();

  cache.get("presets_hash", (err, dbHash) => {
    if (err) return void callback(err);

    if (currentSnapshot && dbHash === currentSnapshot) {
      nextRefresh = now + (REFRESH - (now % REFRESH));
      return void callback();
    }

    cache.lock("presets_hash_lock", 3, (err, unlockOrExtend) => {
      if (err) return void callback(err);

      const promises = [];

      promises.push(
        new Promise((resolve, reject) => {
          db.getPresets((err, res) => {
            if (err) return void reject(err);

            db.getObjects((err, objects) => {
              if (err) return void reject(err);

              objects = objects.map(obj => {
                // Flatten object
                obj = flattenObject(obj);

                // If no keys are defined, consider all parameters as keys to keep the
                // same behavior from v1.0
                if (!obj["_keys"] || !obj["_keys"].length) {
                  obj["_keys"] = Object.keys(obj).filter(
                    k => !k.startsWith("_")
                  );
                }

                return obj;
              });

              res.sort((a, b) => {
                if (a.weight === b.weight) return a._id > b._id;
                else return a.weight - b.weight;
              });

              const presets = [] as Preset[];
              for (const preset of res) {
                let schedule = null;
                if (preset.schedule) {
                  const parts = preset.schedule.trim().split(/\s+/);
                  schedule = {
                    md5: crypto
                      .createHash("md5")
                      .update(preset.schedule)
                      .digest("hex")
                  };

                  try {
                    schedule.duration = +parts.shift() * 1000;
                    schedule.schedule = scheduling.parseCron(parts.join(" "));
                  } catch (err) {
                    logger.warn({
                      message: "Invalid preset schedule",
                      preset: preset._id,
                      schedule: preset.schedule
                    });
                    schedule.schedule = false;
                  }
                }

                const events = preset.events || {};
                let precondition;
                try {
                  precondition = parse(preset.precondition);
                } catch (error) {
                  precondition = mongoQueryToFilter(
                    JSON.parse(preset.precondition)
                  );
                }

                const _provisions = preset.provisions || [];

                // Generate provisions from the old configuration format
                for (const c of preset.configurations) {
                  switch (c.type) {
                    case "age":
                      _provisions.push(["refresh", c.name, c.age]);
                      break;

                    case "value":
                      _provisions.push(["value", c.name, c.value]);
                      break;

                    case "add_tag":
                      _provisions.push(["tag", c.tag, true]);
                      break;

                    case "delete_tag":
                      _provisions.push(["tag", c.tag, false]);
                      break;

                    case "provision":
                      _provisions.push([c.name].concat(c.args || []));
                      break;

                    case "add_object":
                      for (const obj of objects) {
                        if (obj["_id"] === c.object) {
                          const alias = obj["_keys"]
                            .map(k => `${k}:${JSON.stringify(obj[k])}`)
                            .join(",");
                          const p = `${c.name}.[${alias}]`;
                          _provisions.push(["instances", p, 1]);

                          for (const k in obj) {
                            if (
                              !k.startsWith("_") &&
                              !(obj["_keys"].indexOf(k) !== -1)
                            )
                              _provisions.push(["value", `${p}.${k}`, obj[k]]);
                          }
                        }
                      }

                      break;

                    case "delete_object":
                      for (const obj of objects) {
                        if (obj["_id"] === c.object) {
                          const alias = obj["_keys"]
                            .map(k => `${k}:${JSON.stringify(obj[k])}`)
                            .join(",");
                          const p = `${c.name}.[${alias}]`;
                          _provisions.push(["instances", p, 0]);
                        }
                      }

                      break;

                    default:
                      return void reject(
                        new Error(`Unknown configuration type ${c.type}`)
                      );
                  }
                }

                presets.push({
                  name: preset._id,
                  channel: preset.channel || "default",
                  schedule: schedule,
                  events: events,
                  precondition: precondition,
                  provisions: _provisions
                });
              }

              resolve(presets);
            });
          });
        })
      );

      promises.push(
        new Promise((resolve, reject) => {
          db.getProvisions((err, res) => {
            if (err) return void reject(err);

            const provisions = {};
            for (const r of res) {
              provisions[r._id] = {};
              provisions[r._id].md5 = crypto
                .createHash("md5")
                .update(r.script)
                .digest("hex");
              provisions[r._id].script = new vm.Script(
                `"use strict";(function(){\n${r.script}\n})();`,
                { filename: r._id, lineOffset: -1, timeout: 50 }
              );
            }

            resolve(provisions);
          });
        })
      );

      promises.push(
        new Promise((resolve, reject) => {
          db.getVirtualParameters((err, res) => {
            if (err) return void reject(err);

            const virtualParameters = {};
            for (const r of res) {
              virtualParameters[r._id] = {};
              virtualParameters[r._id].md5 = crypto
                .createHash("md5")
                .update(r.script)
                .digest("hex");
              virtualParameters[r._id].script = new vm.Script(
                `"use strict";(function(){\n${r.script}\n})();`,
                { filename: r._id, lineOffset: -1, timeout: 50 }
              );
            }

            resolve(virtualParameters);
          });
        })
      );

      promises.push(
        new Promise((resolve, reject) => {
          db.getFiles((err, res) => {
            if (err) return void reject(err);

            const files = {};
            for (const r of res) {
              const id = r.filename || r._id.toString();
              files[id] = {};
              files[id].length = r.length;
              files[id].md5 = r.md5;
              files[id].contentType = r.contentType;
            }

            resolve(files);
          });
        })
      );

      promises.push(
        new Promise((resolve, reject) => {
          db.getPermissions((err, perms) => {
            if (err) return void reject(err);
            const permissions: Permissions = {};
            for (const p of perms) {
              if (!permissions[p.role]) permissions[p.role] = {};
              if (!permissions[p.role][p.access])
                permissions[p.role][p.access] = {};

              const validate = {};
              permissions[p.role][p.access][p.resource] = {
                access: p.access,
                filter: parse(p.filter || "true"),
                validate: validate
              };

              for (const v of (p.validate || "").split(","))
                validate[v.trim()] = true;
            }

            resolve(permissions);
          });
        })
      );

      promises.push(
        new Promise((resolve, reject) => {
          db.getUsers((err, _users) => {
            if (err) return void reject(err);
            const users = {};
            for (const user of _users) {
              users[user._id] = {
                password: user.password,
                salt: user.salt,
                roles: user.roles.split(",").map(s => s.trim())
              };
            }
            resolve(users);
          });
        })
      );

      promises.push(
        new Promise((resolve, reject) => {
          db.getConfig((err, conf) => {
            if (err) return void reject(err);

            conf.sort((a, b) => (a.id > b.id ? 1 : a.id < b.id ? -1 : 0));

            const ui = {
              filters: {},
              device: {},
              index: {},
              overview: { charts: {}, groups: {} }
            };
            const _config = {};

            for (const c of conf) {
              // Evaluate expressions to simplify them
              const val = expression.evaluate(c.value);
              _config[c.id] = val;
              if (c.id.startsWith("ui.")) {
                const keys = c.id.split(".");
                // remove the first key(ui)
                keys.shift();
                let ref = ui;
                while (keys.length > 1) {
                  const k = keys.shift();
                  if (typeof ref[k] !== "object") ref[k] = {};
                  ref = ref[k];
                }
                ref[keys[0]] = val;
              }
            }

            if (!Object.keys(ui["index"]).length) {
              ui["index"] = {
                "0": {
                  label: "ID",
                  parameter: ["PARAM", "DeviceID.ID"]
                }
              };
            }

            resolve([_config, ui]);
          });
        })
      );

      Promise.all(promises)
        .then(res => {
          const snapshot = {
            presets: res[0],
            provisions: res[1],
            virtualParameters: res[2],
            files: res[3],
            permissions: res[4],
            users: res[5],
            config: res[6][0],
            ui: res[6][1]
          };

          if (currentSnapshot) {
            const h = currentSnapshot;
            const s = snapshots.get(h);
            setTimeout(() => {
              if (snapshots.get(h) === s) snapshots.delete(h);
            }, EVICT_TIMEOUT).unref();
          }

          currentSnapshot = computeHash(snapshot);
          snapshots.set(currentSnapshot, snapshot);
          cache.set("presets_hash", currentSnapshot, 300, err => {
            unlockOrExtend(0);
            if (err) return void callback(err);
            nextRefresh = now + (REFRESH - (now % REFRESH));
            callback();
          });
        })
        .catch(callback);
    });
  });
}

interface GetCurrentSnapshotCallback {
  (err: null, currentSnapshot: string): void;
  (err: Error, currentSnapshot?: null): void;
}

export function getCurrentSnapshot(callback: GetCurrentSnapshotCallback);
export function getCurrentSnapshot(): Promise<string>;
export function getCurrentSnapshot(
  callback?: GetCurrentSnapshotCallback
): Promise<string> | void {
  if (Date.now() < nextRefresh) {
    if (callback) return callback(null, currentSnapshot);
    return Promise.resolve(currentSnapshot);
  }

  if (callback) {
    return refresh(err => {
      callback(err, currentSnapshot);
    });
  }

  return new Promise((resolve, reject) => {
    refresh(err => {
      if (err) return void reject(err);
      resolve(currentSnapshot);
    });
  });
}

export function hasSnapshot(hash): boolean {
  return snapshots.has(hash);
}

export function getPresets(snapshotKey): Preset[] {
  const snapshot = snapshots.get(snapshotKey);
  if (!snapshot) throw new Error("Cache snapshot does not exist");
  return snapshot.presets;
}

export function getProvisions(
  snapshotKey
): { [name: string]: { md5: string; script: vm.Script } } {
  const snapshot = snapshots.get(snapshotKey);
  if (!snapshot) throw new Error("Cache snapshot does not exist");
  return snapshot.provisions;
}

export function getVirtualParameters(
  snapshotKey
): { [name: string]: { md5: string; script: vm.Script } } {
  const snapshot = snapshots.get(snapshotKey);
  if (!snapshot) throw new Error("Cache snapshot does not exist");
  return snapshot.virtualParameters;
}

export function getFiles(
  snapshotKey
): { [name: string]: { length: number; md5: string; contentType: string } } {
  const snapshot = snapshots.get(snapshotKey);
  if (!snapshot) throw new Error("Cache snapshot does not exist");
  return snapshot.files;
}

export function getConfig(
  snapshotKey,
  key,
  context?,
  now?
): string | number | boolean | null {
  const snapshot = snapshots.get(snapshotKey);
  if (!snapshot) throw new Error("Cache snapshot does not exist");

  const oldOpts = {
    "cwmp.downloadTimeout": "DOWNLOAD_TIMEOUT",
    "cwmp.debug": "DEBUG",
    "cwmp.retryDelay": "RETRY_DELAY",
    "cwmp.sessionTimeout": "SESSION_TIMEOUT",
    "cwmp.connectionRequestTimeout": "CONNECTION_REQUEST_TIMEOUT",
    "cwmp.gpnNextLevel": "GPN_NEXT_LEVEL",
    "cwmp.gpvBatchSize": "GPV_BATCH_SIZE",
    "cwmp.cookiesPath": "COOKIES_PATH",
    "cwmp.datetimeMilliseconds": "DATETIME_MILLISECONDS",
    "cwmp.booleanLiteral": "BOOLEAN_LITERAL",
    "cwmp.connectionRequestAllowBasicAuth":
      "CONNECTION_REQUEST_ALLOW_BASIC_AUTH",
    "cwmp.maxCommitIterations": "MAX_COMMIT_ITERATIONS",
    "cwmp.deviceOnlineThreshold": "DEVICE_ONLINE_THRESHOLD",
    "cwmp.udpConnectionRequestPort": "UDP_CONNECTION_REQUEST_PORT"
  };

  if (!(key in snapshot.config)) {
    if (key in oldOpts)
      return config.get(oldOpts[key], context ? context.id : null);
    else return null;
  }
  return expression.evaluate(snapshot.config[key], context, now || Date.now());
}

export function getConfigExpression(snapshotKey, key): Expression {
  const snapshot = snapshots.get(snapshotKey);
  if (!snapshot) throw new Error("Cache snapshot does not exist");

  return snapshot.config[key];
}

export function getUsers(snapshotKey): {} {
  const snapshot = snapshots.get(snapshotKey);
  if (!snapshot) throw new Error("Cache snapshot does not exist");

  return snapshot.users;
}

export function getPermissions(snapshotKey): {} {
  const snapshot = snapshots.get(snapshotKey);
  if (!snapshot) throw new Error("Cache snapshot does not exist");

  return snapshot.permissions;
}

export function getUiConfig(snapshotKey): {} {
  const snapshot = snapshots.get(snapshotKey);
  if (!snapshot) throw new Error("Cache snapshot does not exist");

  return snapshot.ui;
}
