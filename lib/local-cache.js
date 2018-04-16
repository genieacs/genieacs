/**
 * Copyright 2013-2017  Zaid Abdulla
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
"use strict";

const vm = require("vm");
const crypto = require("crypto");

const db = require("./db");
const cache = require("./cache");
const query = require("./query");
const logger = require("./logger");
const scheduling = require("./scheduling");

const REFRESH = 3000;

let nextRefresh = 1;
let hash = null;
let presets, provisions, virtualParameters, files;


function computeHash() {
  // MD5 hash for presets, provisions, virtual parameters for detecting changes
  let h = crypto.createHash("md5");
  for (let p of presets) {
    h.update(JSON.stringify(p.name));
    h.update(JSON.stringify(p.channel));
    h.update(JSON.stringify(p.schedule));
    h.update(JSON.stringify(p.events));
    h.update(JSON.stringify(p.precondition));
    h.update(JSON.stringify(p.provisions));
  }

  let keys;

  keys = Object.keys(provisions).sort();
  h.update(JSON.stringify(keys));
  for (let k of keys)
    h.update(provisions[k].md5);

  keys = Object.keys(virtualParameters).sort();
  h.update(JSON.stringify(keys));
  for (let k of keys)
    h.update(virtualParameters[k].md5);

  hash = h.digest("hex");
}

function flattenObject(src, prefix = "", dst = {}) {
  for (let k of Object.keys(src)) {
    let v = src[k];
    if (typeof v === "object" && !Array.isArray(v))
      flattenObject(v, `${prefix}${k}.`, dst);
    else
      dst[`${prefix}${k}`] = v;
  }
  return dst;
}

function refresh(callback) {
  if (!nextRefresh)
    return setTimeout(function() {refresh(callback);}, 20);

  nextRefresh = 0;
  const now = Date.now();

  cache.get("presets_hash", function(err, res) {
    if (err)
      return callback(err);

    if (hash && res === hash) {
      nextRefresh = now + (REFRESH - (now % REFRESH));
      return callback();
    }

    cache.lock("presets_hash_lock", 3, function(err, unlockOrExtend) {
      if (err)
        return callback(err);

      let counter = 3;

      counter += 2;
      db.getPresets(function(err, res) {
        if (err) {
          if (counter & 1)
            callback(err);
          return counter = 0;
        }

        db.getObjects(function(err, objects) {
          if (err) {
            if (counter & 1)
              callback(err);
            return counter = 0;
          }

          objects = objects.map(obj => {
            // Flatten object
            obj = flattenObject(obj);

            // If no keys are defined, consider all parameters as keys to keep the
            // same behavior from v1.0
            if (!obj["_keys"] || !obj["_keys"].length)
              obj["_keys"] = Object.keys(obj).filter(k => !k.startsWith("_"));

            return obj
          })

          res.sort((a, b) => {
            if (a.weight === b.weight)
              return a._id > b._id;
            else
              return a.weight - b.weight;
          });

          presets = [];
          for (let preset of res) {
            let schedule = null;
            if (preset.schedule) {
              let parts = preset.schedule.trim().split(/\s+/);
              schedule = {
                md5: crypto.createHash("md5").update(preset.schedule).digest("hex")
              };

              try {
                schedule.duration = +(parts.shift()) * 1000;
                schedule.schedule = scheduling.parseCron(parts.join(" "));
              }
              catch (err) {
                logger.warn({
                  message: "Invalid preset schedule",
                  preset: preset._id,
                  schedule: preset.schedule
                });
                schedule.schedule = false;
              }
            }

            let events = preset.events || {};
            let precondition = query.convertMongoQueryToFilters(JSON.parse(preset.precondition));
            let _provisions = preset.provisions || [];

            // Generate provisions from the old configuration format
            for (let c of preset.configurations) {
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
                  for (let obj of objects) {
                    if (obj["_id"] === c.object) {
                      let alias = obj["_keys"].map((k) => `${k}:${JSON.stringify(obj[k])}`).join(",");
                      let p = `${c.name}.[${alias}]`;
                      _provisions.push(["instances", p, 1]);

                      for (let k in obj)
                        if (!k.startsWith("_") && !(obj["_keys"].indexOf(k) !== -1))
                          _provisions.push(["value", `${p}.${k}`, obj[k]]);
                    }
                  }
                  break;

                case "delete_object":
                  for (let obj of objects) {
                    if (obj["_id"] === c.object) {
                      let alias = obj["_keys"].map((k) => `${k}:${JSON.stringify(obj[k])}`).join(",");
                      let p = `${c.name}.[${alias}]`;
                      _provisions.push(["instances", p, 0]);
                    }
                  }
                  break;

                default:
                  if (counter & 1)
                    callback(new Error(`Unknown configuration type ${c.type}`));
                  return counter = 0;
                  break;
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

          if ((counter -= 2) === 1) {
            computeHash();
            cache.set("presets_hash", hash, 300, function(err) {
              unlockOrExtend(0);
              nextRefresh = now + (REFRESH - (now % REFRESH));
              callback(err);
            });
          }
        });
      });

      counter += 2;
      db.getProvisions(function(err, res) {
        if (err) {
          if (counter & 1)
            callback(err);
          return counter = 0;
        }

        provisions = {};
        for (let r of res) {
          provisions[r._id] = {};
          provisions[r._id].md5 = crypto.createHash("md5").update(r.script).digest("hex");
          provisions[r._id].script = new vm.Script(`"use strict";(function(){\n${r.script}\n})();`, {filename: r._id, lineOffset: -1, timeout: 50});
        }

        if ((counter -= 2) === 1) {
          computeHash();
          cache.set("presets_hash", hash, 300, function(err) {
            unlockOrExtend(0);
            nextRefresh = now + (REFRESH - (now % REFRESH));
            callback(err);
          });
        }
      });

      counter += 2;
      db.getVirtualParameters(function(err, res) {
        if (err) {
          if (counter & 1)
            callback(err);
          return counter = 0;
        }

        virtualParameters = {};
        for (let r of res) {
          virtualParameters[r._id] = {}
          virtualParameters[r._id].md5 = crypto.createHash("md5").update(r.script).digest("hex");
          virtualParameters[r._id].script = new vm.Script(`"use strict";(function(){\n${r.script}\n})();`, {filename: r._id, lineOffset: -1, timeout: 50});
        }

        if ((counter -= 2) === 1) {
          computeHash();
          cache.set("presets_hash", hash, 300, function(err) {
            unlockOrExtend(0);
            nextRefresh = now + (REFRESH - (now % REFRESH));
            callback(err);
          });
        }
      });

      counter += 2;
      db.getFiles(function(err, res) {
        if (err) {
          if (counter & 1)
            callback(err);
          return counter = 0;
        }

        files = {};
        for (let r of res) {
          const id = r.filename || r._id.toString();
          files[id] = {};
          files[id].length = r.length;
          files[id].md5 = r.md5;
          files[id].contentType = r.contentType;
        }

        if ((counter -= 2) === 1) {
          computeHash();
          cache.set("presets_hash", hash, 300, function(err) {
            unlockOrExtend(0);
            nextRefresh = now + (REFRESH - (now % REFRESH));
            callback(err);
          });
        }
      });

      if ((counter -= 2) === 1) {
        computeHash();
        cache.set("presets_hash", hash, 300, function(err) {
          unlockOrExtend(0);
          nextRefresh = now + (REFRESH - (now % REFRESH));
          callback(err);
        });
      }
    });
  });
}


function getPresets(callback) {
  if (Date.now() < nextRefresh)
    return callback(null, hash, presets);

  refresh(function(err) {
    callback(err, hash, presets);
  });
}


function getFiles(callback) {
  if (Date.now() < nextRefresh)
    return callback(null, hash, files);

  refresh(function(err) {
    callback(err, hash, files);
  })
}


function getProvisionsAndVirtualParameters(callback) {
  if (Date.now() < nextRefresh)
    return callback(null, hash, provisions, virtualParameters);

  refresh(function(err) {
    callback(err, hash, provisions, virtualParameters);
  });
}


exports.getPresets = getPresets;
exports.getFiles = getFiles;
exports.getProvisionsAndVirtualParameters = getProvisionsAndVirtualParameters;
