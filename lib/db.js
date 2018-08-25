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
"use strict";

const mongodb = require("mongodb");
const config = require("./config");
const common = require("./common");

let tasksCollection,
  devicesCollection,
  presetsCollection,
  objectsCollection,
  provisionsCollection,
  virtualParametersCollection,
  faultsCollection,
  filesCollection,
  operationsCollection;

function connect(callback) {
  let callbackCounter = 9;
  mongodb.MongoClient.connect(
    config.get("MONGODB_CONNECTION_URL"),
    (err, db) => {
      if (err) return void callback(err);

      exports.mongoDb = db;
      db.collection("tasks", (err, collection) => {
        exports.tasksCollection = tasksCollection = collection;
        if (collection != null)
          collection.ensureIndex({ device: 1, timestamp: 1 });

        if (--callbackCounter === 0 || err) {
          callbackCounter = 0;
          callback(err);
        }
      });
      db.collection("devices", (err, collection) => {
        exports.devicesCollection = devicesCollection = collection;
        if (--callbackCounter === 0 || err) {
          callbackCounter = 0;
          callback(err);
        }
      });
      db.collection("presets", (err, collection) => {
        exports.presetsCollection = presetsCollection = collection;
        if (--callbackCounter === 0 || err) {
          callbackCounter = 0;
          callback(err);
        }
      });
      db.collection("objects", (err, collection) => {
        exports.objectsCollection = objectsCollection = collection;
        if (--callbackCounter === 0 || err) {
          callbackCounter = 0;
          callback(err);
        }
      });
      db.collection("fs.files", (err, collection) => {
        exports.filesCollection = filesCollection = collection;
        if (--callbackCounter === 0 || err) {
          callbackCounter = 0;
          callback(err);
        }
      });
      db.collection("provisions", (err, collection) => {
        exports.provisionsCollection = provisionsCollection = collection;
        if (--callbackCounter === 0 || err) {
          callbackCounter = 0;
          callback(err);
        }
      });
      db.collection("virtualParameters", (err, collection) => {
        exports.virtualParametersCollection = virtualParametersCollection = collection;
        if (--callbackCounter === 0 || err) {
          callbackCounter = 0;
          callback(err);
        }
      });
      db.collection("faults", (err, collection) => {
        exports.faultsCollection = faultsCollection = collection;
        if (--callbackCounter === 0 || err) {
          callbackCounter = 0;
          callback(err);
        }
      });
      db.collection("operations", (err, collection) => {
        exports.operationsCollection = operationsCollection = collection;
        if (--callbackCounter === 0 || err) {
          callbackCounter = 0;
          callback(err);
        }
      });
    }
  );
}

function disconnect() {
  if (exports.mongoDb) exports.mongoDb.close();
}

// Optimize projection by removing overlaps
// This can modify the object
function optimizeProjection(obj) {
  if (obj[""]) return { "": obj[""] };

  const keys = Object.keys(obj).sort();
  if (keys.length <= 1) return obj;

  for (let i = 1; i < keys.length; ++i) {
    const a = keys[i - 1];
    const b = keys[i];
    if (b.startsWith(a)) {
      if (b.charAt(a.length) === "." || b.charAt(a.length - 1) === ".") {
        delete obj[b];
        keys.splice(i--, 1);
      }
    }
  }
  return obj;
}

function fetchDevice(id, timestamp, patterns, callback) {
  const MAX_DEPTH = config.get("MAX_DEPTH", id);

  if (!patterns || !patterns.length) patterns = [[[], (1 << MAX_DEPTH) - 1]];

  let projection = {};
  const projectionTree = {};
  function func(path, pats, projTree) {
    const children = {};
    for (let pat of pats) {
      const fragment = pat[0][path.length] || "*";
      if (fragment === "*") {
        if (pat[1] << path.length) projection[path.join(".")] = 1;
        return;
      }

      if (!projTree[fragment]) projTree[fragment] = {};

      if (pat[1] & (1 << path.length)) {
        projection[path.concat("_timestamp").join(".")] = 1;
        projection[path.concat("_object").join(".")] = 1;
        projection[path.concat("_instance").join(".")] = 1;
        projection[path.concat([fragment, "_timestamp"]).join(".")] = 1;
        projection[path.concat([fragment, "_value"]).join(".")] = 1;
        projection[path.concat([fragment, "_type"]).join(".")] = 1;
        projection[path.concat([fragment, "_object"]).join(".")] = 1;
        projection[path.concat([fragment, "_instance"]).join(".")] = 1;
        projection[path.concat([fragment, "_writable"]).join(".")] = 1;
        projection[path.concat([fragment, "_orig"]).join(".")] = 1;
      }

      if (pat[1] >> (path.length + 1)) {
        if (!children[fragment]) children[fragment] = [];
        children[fragment].push(pat);
      }
    }

    for (let [k, v] of Object.entries(children))
      func(path.concat(k), v, projTree[k]);
  }

  func([], patterns, projectionTree);

  delete projectionTree["DeviceID"];
  delete projectionTree["Events"];
  delete projectionTree["Tags"];

  const res = [];
  const loaded = [];

  projection = optimizeProjection(projection);

  for (let k of Object.keys(projection)) {
    if (k === "" || k === "Events" || k.startsWith("Events.")) {
      if (k === "" || k === "Events" || k === "Events._writable") {
        res.push([
          ["Events"],
          timestamp,
          { object: [timestamp, 1], writable: [timestamp, 0] }
        ]);
        if (k === "Events._writable") loaded.push([["Events"], 1]);
      }
      if (k === "Events") {
        projection["_lastInform"] = 1;
        projection["_lastBoot"] = 1;
        projection["_lastBootstrap"] = 1;
        projection["_registered"] = 1;
        loaded.push([["Events"], (1 << MAX_DEPTH) - 1]);
      } else if (k === "Events.Inform._writable" || k === "Events.Inform") {
        projection["_lastInform"] = 1;
        loaded.push([["Events", "Inform"], 1 ^ ((1 << MAX_DEPTH) - 1)]);
      } else if (k === "Events.1_BOOT._writable" || k === "Events.1_BOOT") {
        projection["_lastBoot"] = 1;
        loaded.push([["Events", "1_BOOT"], 1 ^ ((1 << MAX_DEPTH) - 1)]);
      } else if (
        k === "Events.0_BOOTSTRAP._writable" ||
        k === "Events.0_BOOTSTRAP"
      ) {
        projection["_lastBootstrap"] = 1;
        loaded.push([["Events", "0_BOOTSTRAP"], 1 ^ ((1 << MAX_DEPTH) - 1)]);
      } else if (
        k === "Events.Registered._writable" ||
        k === "Events.Registered"
      ) {
        projection["_registered"] = 1;
        loaded.push([["Events", "Registered"], 1 ^ ((1 << MAX_DEPTH) - 1)]);
      } else if (k.endsWith("._writable") && k !== "Events._writable") {
        loaded.push([k.split(".").slice(0, 2), 1 ^ ((1 << MAX_DEPTH) - 1)]);
      }
      if (k !== "") delete projection[k];
    }

    if (k === "" || k === "DeviceID" || k.startsWith("DeviceID.")) {
      if (k === "" || k === "DeviceID" || k === "DeviceID._writable") {
        res.push([
          ["DeviceID"],
          timestamp,
          { object: [timestamp, 1], writable: [timestamp, 0] }
        ]);
        if (k === "DeviceID._writable") loaded.push([["DeviceID"], 1]);
      }
      if (k === "DeviceID") {
        projection["_id"] = 1;
        projection["_deviceId"] = 1;
        loaded.push([["DeviceID"], (1 << MAX_DEPTH) - 1]);
      } else if (k === "DeviceID.ID._writable" || k === "DeviceID.ID") {
        projection["_id"] = 1;
        loaded.push([["DeviceID", "ID"], 1 ^ ((1 << MAX_DEPTH) - 1)]);
      } else if (
        k === "DeviceID.Manufacturer._writable" ||
        k === "DeviceID.DeManufacturer"
      ) {
        projection["_deviceId._Manufacturer"] = 1;
        loaded.push([["DeviceID", "Manufacturer"], 1 ^ ((1 << MAX_DEPTH) - 1)]);
      } else if (
        k === "DeviceID.ProductClass._writable" ||
        k === "DeviceID.ProductClass"
      ) {
        projection["_deviceId._ProductClass"] = 1;
        loaded.push([["DeviceID", "ProductClass"], 1 ^ ((1 << MAX_DEPTH) - 1)]);
      } else if (k === "DeviceID.OUI._writable" || k === "DeviceID.OUI") {
        projection["_deviceId._OUI"] = 1;
        loaded.push([["DeviceID", "ProductClass"], 1 ^ ((1 << MAX_DEPTH) - 1)]);
      } else if (
        k === "DeviceID.SerialNumber._writable" ||
        k === "DeviceID.SerialNumber"
      ) {
        projection["_deviceId._SerialNumber"] = 1;
        loaded.push([["DeviceID", "SerialNumber"], 1 ^ ((1 << MAX_DEPTH) - 1)]);
      } else if (k.endsWith("._writable") && k !== "DeviceID._writable") {
        loaded.push([k.split(".").slice(0, 2), 1 ^ ((1 << MAX_DEPTH) - 1)]);
      }
      if (k !== "") delete projection[k];
    }

    if (k === "Tags" || k.startsWith("Tags.")) {
      if (!projection["_tags"]) {
        projection["_tags"] = 1;
        loaded.push([["Tags"], (1 << MAX_DEPTH) - 1]);
      }
      delete projection[k];
    }
  }

  let proj;
  if (projection[""]) proj = {};
  else if (!Object.keys(projection).length) proj = { _id: 1 };
  else proj = projection;

  devicesCollection.findOne({ _id: id }, proj, (err, device) => {
    if (err || !device) return void callback(err);

    function storeParams(obj, path, ts, descendantsFetched, projTree) {
      let thisFetched = false;
      if (descendantsFetched) {
        thisFetched = true;
      } else if (projection[path.join(".")]) {
        descendantsFetched = true;
        if (
          path.length &&
          projection[
            path
              .slice(0, -1)
              .concat("_timestamp")
              .join(".")
          ]
        ) {
          thisFetched = true;
          loaded.push([
            path,
            ((1 << (path.length - 1)) - 1) ^ ((1 << MAX_DEPTH) - 1)
          ]);
        } else {
          loaded.push([
            path,
            ((1 << path.length) - 1) ^ ((1 << MAX_DEPTH) - 1)
          ]);
        }
      } else if (projection[path.concat("_writable").join(".")]) {
        loaded.push([path, 1 << (path.length - 1)]);
        thisFetched = true;
      }

      if (obj["_timestamp"]) obj["_timestamp"] = +obj["_timestamp"];

      // For compatibility with v1.0 database
      if (obj["_instance"] && obj["_object"] == null) obj["_object"] = true;

      if (thisFetched) {
        const attrs = {};
        let t = obj["_timestamp"] || 1;
        if (ts > t) t = ts;

        if (obj["_value"] != null) {
          attrs.value = [obj["_timestamp"] || 1, [obj["_value"], obj["_type"]]];
          if (obj["_type"] === "xsd:dateTime")
            attrs.value[1][0] = +attrs.value[1][0];

          obj["_object"] = false;
        }
        if (obj["_writable"] != null)
          attrs.writable = [ts || 1, obj["_writable"] ? 1 : 0];

        if (obj["_object"] != null) attrs.object = [t, obj["_object"] ? 1 : 0];

        res.push([path, t, attrs]);
      }

      for (let [k, v] of Object.entries(obj)) {
        if (!k.startsWith("_")) {
          obj["_object"] = true;
          storeParams(
            v,
            path.concat(k),
            obj["_timestamp"],
            descendantsFetched,
            projTree ? projTree[k] : null
          );
          if (projTree) delete projTree[k];
        }
      }

      if (!descendantsFetched) {
        for (let k of Object.keys(projTree)) {
          const p = path.concat(k);
          loaded.push([p, ((1 << path.length) - 1) ^ ((1 << MAX_DEPTH) - 1)]);
          if ((obj["_object"] || !path.length) && obj["_timestamp"])
            res.push([p, obj["_timestamp"]]);
        }
      } else if ((obj["_object"] || !path.length) && obj["_timestamp"]) {
        res.push([path.concat("*"), obj["_timestamp"]]);
      }
    }

    for (let [k, v] of Object.entries(device)) {
      switch (k) {
        case "_lastInform":
          res.push([
            ["Events", "Inform"],
            +v,
            {
              object: [+v, 0],
              writable: [+v, 0],
              value: [+v, [+v, "xsd:dateTime"]]
            }
          ]);
          delete device[k];
          break;
        case "_lastBoot":
          res.push([
            ["Events", "1_BOOT"],
            +v,
            {
              object: [+v, 0],
              writable: [+v, 0],
              value: [+v, [+v, "xsd:dateTime"]]
            }
          ]);
          delete device[k];
          break;
        case "_lastBootstrap":
          res.push([
            ["Events", "0_BOOTSTRAP"],
            +v,
            {
              object: [+v, 0],
              writable: [+v, 0],
              value: [+v, [+v, "xsd:dateTime"]]
            }
          ]);
          delete device[k];
          break;
        case "_registered":
          // Use current timestamp for registered event attribute timestamps
          res.push([
            ["Events", "Registered"],
            timestamp,
            {
              object: [timestamp, 0],
              writable: [timestamp, 0],
              value: [timestamp, [+v, "xsd:dateTime"]]
            }
          ]);
          delete device[k];
          break;
        case "_id":
          if (projection[""] || projection["_id"]) {
            res.push([
              ["DeviceID", "ID"],
              timestamp,
              {
                object: [timestamp, 0],
                writable: [timestamp, 0],
                value: [timestamp, [v, "xsd:string"]]
              }
            ]);
          }

          delete device[k];
          break;
        case "_tags":
          if (v.length) {
            res.push([
              ["Tags"],
              timestamp,
              { object: [timestamp, 1], writable: [timestamp, 0] }
            ]);
          }

          for (let t of v) {
            t = t.replace(/[^a-zA-Z0-9-]+/g, "_");
            res.push([
              ["Tags", t],
              timestamp,
              {
                object: [timestamp, 0],
                writable: [timestamp, 1],
                value: [timestamp, [true, "xsd:boolean"]]
              }
            ]);
          }
          delete device[k];
          break;
        case "_deviceId":
          if (v["_Manufacturer"] != null) {
            res.push([
              ["DeviceID", "Manufacturer"],
              timestamp,
              {
                object: [timestamp, 0],
                writable: [timestamp, 0],
                value: [timestamp, [v["_Manufacturer"], "xsd:string"]]
              }
            ]);
          }

          if (v["_OUI"] != null) {
            res.push([
              ["DeviceID", "OUI"],
              timestamp,
              {
                object: [timestamp, 0],
                writable: [timestamp, 0],
                value: [timestamp, [v["_OUI"], "xsd:string"]]
              }
            ]);
          }

          if (v["_ProductClass"] != null) {
            res.push([
              ["DeviceID", "ProductClass"],
              timestamp,
              {
                object: [timestamp, 0],
                writable: [timestamp, 0],
                value: [timestamp, [v["_ProductClass"], "xsd:string"]]
              }
            ]);
          }

          if (v["_SerialNumber"] != null) {
            res.push([
              ["DeviceID", "SerialNumber"],
              timestamp,
              {
                object: [timestamp, 0],
                writable: [timestamp, 0],
                value: [timestamp, [v["_SerialNumber"], "xsd:string"]]
              }
            ]);
          }

          delete device[k];
      }
    }

    storeParams(device, [], 0, false, projectionTree);
    callback(null, res, loaded);
  });
}

function saveDevice(deviceId, deviceData, isNew, sessionTimestamp, callback) {
  const update = { $set: {}, $unset: {}, $addToSet: {}, $pull: {} };

  for (let diff of deviceData.timestamps.diff()) {
    if (diff[0].wildcard !== 1 << (diff[0].length - 1)) continue;

    if (
      diff[0][0] === "Events" ||
      diff[0][0] === "DeviceID" ||
      diff[0][0] === "Tags"
    )
      continue;

    // Param timestamps may be greater than session timestamp to track revisions
    if (diff[2] > sessionTimestamp) diff[2] = sessionTimestamp;

    if (diff[2] == null && diff[1] != null) {
      update["$unset"][
        diff[0]
          .slice(0, -1)
          .concat("_timestamp")
          .join(".")
      ] = 1;
    } else if (diff[2] !== diff[1]) {
      const parent = deviceData.paths.get(diff[0].slice(0, -1));
      if (parent && (!parent.length || deviceData.attributes.has(parent))) {
        update["$set"][
          diff[0]
            .slice(0, -1)
            .concat("_timestamp")
            .join(".")
        ] = new Date(diff[2]);
      }
    }
  }

  for (let diff of deviceData.attributes.diff()) {
    if (diff[1] === diff[2]) continue;

    const path = diff[0];
    const value1 = (((diff[1] || {}).value || [])[1] || [])[0];
    const value2 = (((diff[2] || {}).value || [])[1] || [])[0];
    const valueType1 = (((diff[1] || {}).value || [])[1] || [])[1];
    const valueType2 = (((diff[2] || {}).value || [])[1] || [])[1];
    const valueTimestamp1 = ((diff[1] || {}).value || [])[0];
    const valueTimestamp2 = ((diff[2] || {}).value || [])[0];
    const object1 = ((diff[1] || {}).object || [])[1];
    const object2 = ((diff[2] || {}).object || [])[1];
    const writable2 = ((diff[2] || {}).writable || [])[1];
    const writable1 = ((diff[1] || {}).writable || [])[1];

    switch (path[0]) {
      case "Events":
        if (diff[0].length === 2 && value2 !== value1) {
          if (!diff[2]) {
            switch (path[1]) {
              case "Inform":
                update["$unset"]["_lastInform"] = 1;
                break;
              case "1_BOOT":
                update["$unset"]["_lastBoot"] = 1;
                break;
              case "0_BOOTSTRAP":
                update["$unset"]["_lastBootstrap"] = 1;
                break;
              case "Registered":
                update["$unset"]["_registered"] = 1;
            }
          } else {
            const t = new Date(diff[2].value[1][0]);
            switch (path[1]) {
              case "Inform":
                update["$set"]["_lastInform"] = t;
                break;
              case "1_BOOT":
                update["$set"]["_lastBoot"] = t;
                break;
              case "0_BOOTSTRAP":
                update["$set"]["_lastBootstrap"] = t;
                break;
              case "Registered":
                update["$set"]["_registered"] = t;
            }
          }
        }

        break;
      case "DeviceID":
        if (value2 !== value1) {
          const v = diff[2].value[1][0];
          switch (path[1]) {
            case "ID":
              update["$set"]["_id"] = v;
              break;
            case "Manufacturer":
              update["$set"]["_deviceId._Manufacturer"] = v;
              break;
            case "OUI":
              update["$set"]["_deviceId._OUI"] = v;
              break;
            case "ProductClass":
              update["$set"]["_deviceId._ProductClass"] = v;
              break;
            case "SerialNumber":
              update["$set"]["_deviceId._SerialNumber"] = v;
          }
        }
        break;
      case "Tags":
        if (value2 !== value1) {
          if (value2 != null) {
            if (!update["$addToSet"]["_tags"])
              update["$addToSet"]["_tags"] = { $each: [] };
            update["$addToSet"]["_tags"]["$each"].push(diff[0][1]);
          } else {
            if (!update["$pull"]["_tags"]) {
              update["$pull"]["_tags"] = {
                $in: []
              };
            }
            update["$pull"]["_tags"]["$in"].push(diff[0][1]);
          }
        }

        break;
      default:
        if (!diff[2]) {
          update["$unset"][diff[0].join(".")] = 1;
          continue;
        }

        for (let attrName of Object.keys(diff[2])) {
          // Param timestamps may be greater than session timestamp to track revisions
          if (diff[2][attrName][0] > sessionTimestamp)
            diff[2][attrName][0] = sessionTimestamp;

          if (diff[2][attrName][1] != null) {
            switch (attrName) {
              case "value":
                if (value2 !== value1) {
                  if (
                    valueType2 === "xsd:dateTime" &&
                    Number.isInteger(value2)
                  ) {
                    update["$set"][path.concat("_value").join(".")] = new Date(
                      value2
                    );
                  } else {
                    update["$set"][path.concat("_value").join(".")] = value2;
                  }
                }

                if (valueType2 !== valueType1)
                  update["$set"][path.concat("_type").join(".")] = valueType2;

                if (valueTimestamp2 !== valueTimestamp1) {
                  update["$set"][
                    path.concat("_timestamp").join(".")
                  ] = new Date(valueTimestamp2);
                }

                break;
              case "object":
                if (!diff[1] || !diff[1].object || object2 !== object1)
                  update["$set"][path.concat("_object").join(".")] = !!object2;

                break;
              case "writable":
                if (!diff[1] || !diff[1].writable || writable2 !== writable1) {
                  update["$set"][
                    path.concat("_writable").join(".")
                  ] = !!writable2;
                }
            }
          }
        }

        if (diff[1]) {
          for (let attrName of Object.keys(diff[1])) {
            if (
              diff[1][attrName][1] != null &&
              (!diff[2] || !diff[2][attrName] || !diff[2][attrName][1])
            ) {
              update["$unset"][path.concat(`_${attrName}`).join(".")] = 1;
              if (attrName === "value") {
                update["$unset"][path.concat("_type").join(".")] = 1;
                update["$unset"][path.concat("_timestamp").join(".")] = 1;
              }
            }
          }
        }
    }
  }

  update["$unset"] = optimizeProjection(update["$unset"]);

  // Remove overlap possibly caused by parameters changing from objects
  // to regular parameters or vice versa. Reason being that _timestamp
  // represents two different things depending on whether the parameter
  // is an object or not.
  for (let k of Object.keys(update["$unset"]))
    if (update["$set"][k] != null) delete update["$unset"][k];

  // Remove empty keys
  for (let [k, v] of Object.entries(update)) {
    if (k === "$addToSet") {
      for (let [kk, vv] of Object.entries(v))
        if (!vv["$each"].length) delete v[kk];
    } else if (k === "$pull") {
      for (let [kk, vv] of Object.entries(v))
        if (!vv["$in"].length) delete v[kk];
    }
    if (!Object.keys(v).length) delete update[k];
  }

  if (!Object.keys(update).length) return void callback();

  // Mongo doesn't allow $addToSet and $pull at the same time
  let update2;
  if (update["$addToSet"] && update["$pull"]) {
    update2 = { $pull: update["$pull"] };
    delete update["$pull"];
  }

  devicesCollection.update(
    { _id: deviceId },
    update,
    { upsert: isNew },
    (err, result) => {
      if (!err && result.result.n !== 1) {
        return void callback(
          new Error(`Device ${deviceId} not found in database`)
        );
      }

      if (update2) {
        return void devicesCollection.update(
          { _id: deviceId },
          update2,
          callback
        );
      }

      callback(err);
    }
  );
}

function getFaults(deviceId, callback) {
  faultsCollection
    .find({ _id: { $regex: `^${common.escapeRegExp(deviceId)}\\:` } })
    .toArray((err, res) => {
      if (err) return callback(err);

      const faults = {};
      for (const r of res) {
        const channel = r._id.slice(deviceId.length + 1);
        delete r._id;
        delete r.channel;
        delete r.device;
        r.timestamp = +r.timestamp;
        r.provisions = JSON.parse(r.provisions);
        faults[channel] = r;
      }

      return callback(err, faults);
    });
}

function saveFault(deviceId, channel, fault, callback) {
  fault = Object.assign({}, fault);
  fault._id = `${deviceId}:${channel}`;
  fault.device = deviceId;
  fault.channel = channel;
  fault.timestamp = new Date(fault.timestamp);
  fault.provisions = JSON.stringify(fault.provisions);
  faultsCollection.save(fault, callback);
}

function deleteFault(deviceId, channel, callback) {
  faultsCollection.remove({ _id: `${deviceId}:${channel}` }, callback);
}

function getDueTasks(deviceId, timestamp, callback) {
  const cur = tasksCollection.find({ device: deviceId }).sort(["timestamp"]);
  const tasks = [];

  let f;
  cur.nextObject(
    (f = (err, task) => {
      if (err) return void callback(err);

      if (!task) return void callback(null, tasks, null);

      if (task.timestamp) task.timestamp = +task.timestamp;
      if (task.expiry) task.expiry = +task.expiry;
      if (task.timestamp >= timestamp)
        return void callback(null, tasks, +task.timestamp);
      task._id = String(task._id);

      tasks.push(task);

      // For API compatibility
      if (task.name === "download" && task.file) {
        let q;
        if (mongodb.ObjectID.isValid(task.file))
          q = { _id: { $in: [task.file, new mongodb.ObjectID(task.file)] } };
        else q = { _id: task.file };

        filesCollection.find(q).toArray((err, res) => {
          if (err) return void callback(err);

          if (res[0]) {
            if (!task.fileType) task.fileType = res[0].metadata.fileType;

            if (task.fileName)
              task.fileName = res[0].filename || res[0]._id.toString();
          }

          cur.nextObject(f);
        });
      } else {
        cur.nextObject(f);
      }
    })
  );
}

function clearTasks(deviceId, taskIds, callback) {
  tasksCollection.remove(
    { _id: { $in: taskIds.map(id => new mongodb.ObjectID(id)) } },
    callback
  );
}

function getOperations(deviceId, callback) {
  operationsCollection
    .find({ _id: { $regex: `^${common.escapeRegExp(deviceId)}\\:` } })
    .toArray((err, res) => {
      if (err) return void callback(err);

      const operations = {};
      for (const r of res) {
        const commandKey = r._id.slice(deviceId.length + 1);
        delete r._id;
        r.timestamp = +r.timestamp;
        if (r.args) r.args = JSON.parse(r.args);
        r.provisions = JSON.parse(r.provisions);
        r.retries = JSON.parse(r.retries);
        operations[commandKey] = r;
      }

      callback(err, operations);
    });
}

function saveOperation(deviceId, commandKey, operation, callback) {
  operation = Object.assign({}, operation);
  operation._id = `${deviceId}:${commandKey}`;
  operation.timestamp = new Date(operation.timestamp);
  operation.provisions = JSON.stringify(operation.provisions);
  operation.retries = JSON.stringify(operation.retries);
  operation.args = JSON.stringify(operation.args);
  operationsCollection.save(operation, callback);
}

function deleteOperation(deviceId, commandKey, callback) {
  operationsCollection.remove({ _id: `${deviceId}:${commandKey}` }, callback);
}

function getPresets(callback) {
  presetsCollection.find().toArray(callback);
}

function getObjects(callback) {
  objectsCollection.find().toArray(callback);
}

function getProvisions(callback) {
  provisionsCollection.find().toArray(callback);
}

function getVirtualParameters(callback) {
  virtualParametersCollection.find().toArray(callback);
}

function getFiles(callback) {
  filesCollection.find().toArray(callback);
}

exports.connect = connect;
exports.disconnect = disconnect;
exports.fetchDevice = fetchDevice;
exports.saveDevice = saveDevice;
exports.getFaults = getFaults;
exports.saveFault = saveFault;
exports.deleteFault = deleteFault;
exports.clearTasks = clearTasks;
exports.saveOperation = saveOperation;
exports.deleteOperation = deleteOperation;
exports.getPresets = getPresets;
exports.getObjects = getObjects;
exports.getProvisions = getProvisions;
exports.getVirtualParameters = getVirtualParameters;
exports.getFiles = getFiles;
exports.getDueTasks = getDueTasks;
exports.getOperations = getOperations;
