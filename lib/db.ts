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

import { MongoClient, ObjectID } from "mongodb";
import { get } from "./config";
import { escapeRegExp } from "./common";
import { parse } from "./common/expression-parser";
import { DeviceData, Attributes } from "./types";
import Path from "./common/path";

export let tasksCollection,
  devicesCollection,
  presetsCollection,
  objectsCollection,
  provisionsCollection,
  virtualParametersCollection,
  faultsCollection,
  filesCollection,
  operationsCollection,
  configCollection;

export let client;

export function connect(callback): void {
  MongoClient.connect(
    "" + get("MONGODB_CONNECTION_URL"),
    { useNewUrlParser: true },
    (err, _client) => {
      if (err) return void callback(err);
      client = _client;
      const db = client.db();

      tasksCollection = db.collection("tasks");
      tasksCollection.createIndex({ device: 1, timestamp: 1 });

      devicesCollection = db.collection("devices");
      presetsCollection = db.collection("presets");
      objectsCollection = db.collection("objects");
      filesCollection = db.collection("fs.files");
      provisionsCollection = db.collection("provisions");
      virtualParametersCollection = db.collection("virtualParameters");
      faultsCollection = db.collection("faults");
      operationsCollection = db.collection("operations");
      configCollection = db.collection("config");

      callback();
    }
  );
}

export function disconnect(): void {
  if (client) client.close();
}

// Optimize projection by removing overlaps
// This can modify the object
function optimizeProjection(obj: {}): {} {
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

export function fetchDevice(
  id: string,
  timestamp: number,
  patterns: [Path, number][],
  callback
): void {
  const MAX_DEPTH = +get("MAX_DEPTH", id);

  if (!patterns || !patterns.length)
    patterns = [[Path.parse(""), (1 << MAX_DEPTH) - 1]];

  let projection = {};
  const projectionTree = {};
  function func(
    path: string,
    pathLength: number,
    pats: [Path, number][],
    projTree
  ): void {
    const children: { [fragment: string]: [Path, number][] } = {};
    for (const pat of pats) {
      const fragment = (pat[0].segments[pathLength] as string) || "*";
      if (fragment === "*") {
        if (pat[1] << pathLength) projection[path.slice(0, -1)] = 1;
        return;
      }

      if (!projTree[fragment]) projTree[fragment] = {};

      if (pat[1] & (1 << pathLength)) {
        projection[path + "_timestamp"] = 1;
        projection[path + "_object"] = 1;
        projection[path + "_instance"] = 1;
        projection[path + fragment + "._timestamp"] = 1;
        projection[path + fragment + "._value"] = 1;
        projection[path + fragment + "._type"] = 1;
        projection[path + fragment + "._object"] = 1;
        projection[path + fragment + "._instance"] = 1;
        projection[path + fragment + "._writable"] = 1;
        projection[path + fragment + "._orig"] = 1;
      }

      if (pat[1] >> (pathLength + 1)) {
        if (!children[fragment]) children[fragment] = [];
        children[fragment].push(pat);
      }
    }

    for (const [k, v] of Object.entries(children))
      func(path + k + ".", pathLength + 1, v, projTree[k]);
  }

  func("", 0, patterns, projectionTree);

  delete projectionTree["DeviceID"];
  delete projectionTree["Events"];
  delete projectionTree["Tags"];

  const res: [Path, number, Attributes?][] = [];
  const loaded: [Path, number][] = [];

  projection = optimizeProjection(projection);

  for (const k of Object.keys(projection)) {
    if (k === "" || k === "Events" || k.startsWith("Events.")) {
      if (k === "" || k === "Events" || k === "Events._writable") {
        res.push([
          Path.parse("Events"),
          timestamp,
          { object: [timestamp, 1], writable: [timestamp, 0] }
        ]);
        if (k === "Events._writable") loaded.push([Path.parse("Events"), 1]);
      }
      if (k === "Events") {
        projection["_lastInform"] = 1;
        projection["_lastBoot"] = 1;
        projection["_lastBootstrap"] = 1;
        projection["_registered"] = 1;
        loaded.push([Path.parse("Events"), (1 << MAX_DEPTH) - 1]);
      } else if (k === "Events.Inform._writable" || k === "Events.Inform") {
        projection["_lastInform"] = 1;
        loaded.push([Path.parse("Events.Inform"), 1 ^ ((1 << MAX_DEPTH) - 1)]);
      } else if (k === "Events.1_BOOT._writable" || k === "Events.1_BOOT") {
        projection["_lastBoot"] = 1;
        loaded.push([Path.parse("Events.1_BOOT"), 1 ^ ((1 << MAX_DEPTH) - 1)]);
      } else if (
        k === "Events.0_BOOTSTRAP._writable" ||
        k === "Events.0_BOOTSTRAP"
      ) {
        projection["_lastBootstrap"] = 1;
        loaded.push([
          Path.parse("Events.0_BOOTSTRAP"),
          1 ^ ((1 << MAX_DEPTH) - 1)
        ]);
      } else if (
        k === "Events.Registered._writable" ||
        k === "Events.Registered"
      ) {
        projection["_registered"] = 1;
        loaded.push([
          Path.parse("Events.Registered"),
          1 ^ ((1 << MAX_DEPTH) - 1)
        ]);
      } else if (k.endsWith("._writable") && k !== "Events._writable") {
        loaded.push([
          Path.parse(k.split(".", 2).join(".")),
          1 ^ ((1 << MAX_DEPTH) - 1)
        ]);
      }
      if (k !== "") delete projection[k];
    }

    if (k === "" || k === "DeviceID" || k.startsWith("DeviceID.")) {
      if (k === "" || k === "DeviceID" || k === "DeviceID._writable") {
        res.push([
          Path.parse("DeviceID"),
          timestamp,
          { object: [timestamp, 1], writable: [timestamp, 0] }
        ]);
        if (k === "DeviceID._writable")
          loaded.push([Path.parse("DeviceID"), 1]);
      }
      if (k === "DeviceID") {
        projection["_id"] = 1;
        projection["_deviceId"] = 1;
        loaded.push([Path.parse("DeviceID"), (1 << MAX_DEPTH) - 1]);
      } else if (k === "DeviceID.ID._writable" || k === "DeviceID.ID") {
        projection["_id"] = 1;
        loaded.push([Path.parse("DeviceID.ID"), 1 ^ ((1 << MAX_DEPTH) - 1)]);
      } else if (
        k === "DeviceID.Manufacturer._writable" ||
        k === "DeviceID.DeManufacturer"
      ) {
        projection["_deviceId._Manufacturer"] = 1;
        loaded.push([
          Path.parse("DeviceID.Manufacturer"),
          1 ^ ((1 << MAX_DEPTH) - 1)
        ]);
      } else if (
        k === "DeviceID.ProductClass._writable" ||
        k === "DeviceID.ProductClass"
      ) {
        projection["_deviceId._ProductClass"] = 1;
        loaded.push([
          Path.parse("DeviceID.ProductClass"),
          1 ^ ((1 << MAX_DEPTH) - 1)
        ]);
      } else if (k === "DeviceID.OUI._writable" || k === "DeviceID.OUI") {
        projection["_deviceId._OUI"] = 1;
        loaded.push([
          Path.parse("DeviceID.ProductClass"),
          1 ^ ((1 << MAX_DEPTH) - 1)
        ]);
      } else if (
        k === "DeviceID.SerialNumber._writable" ||
        k === "DeviceID.SerialNumber"
      ) {
        projection["_deviceId._SerialNumber"] = 1;
        loaded.push([
          Path.parse("DeviceID.SerialNumber"),
          1 ^ ((1 << MAX_DEPTH) - 1)
        ]);
      } else if (k.endsWith("._writable") && k !== "DeviceID._writable") {
        loaded.push([
          Path.parse(k.split(".", 2).join(".")),
          1 ^ ((1 << MAX_DEPTH) - 1)
        ]);
      }
      if (k !== "") delete projection[k];
    }

    if (k === "Tags" || k.startsWith("Tags.")) {
      if (!projection["_tags"]) {
        projection["_tags"] = 1;
        loaded.push([Path.parse("Tags"), (1 << MAX_DEPTH) - 1]);
      }
      delete projection[k];
    }
  }

  let options;
  if (!projection[""]) {
    if (!Object.keys(projection).length) options = { projection: { _id: 1 } };
    else options = { projection: projection };
  }

  devicesCollection.findOne({ _id: id }, options, (err, device) => {
    if (err || !device) return void callback(err);

    function storeParams(
      obj,
      path: string,
      pathLength: number,
      ts,
      descendantsFetched,
      projTree
    ): void {
      let thisFetched = false;
      if (descendantsFetched) {
        thisFetched = true;
      } else if (projection[path.slice(0, -1)]) {
        descendantsFetched = true;
        if (
          pathLength &&
          projection[
            path.slice(0, path.lastIndexOf(".", path.length - 2) + 1) +
              "_timestamp"
          ]
        ) {
          thisFetched = true;
          loaded.push([
            Path.parse(path.slice(0, -1)),
            ((1 << (pathLength - 1)) - 1) ^ ((1 << MAX_DEPTH) - 1)
          ]);
        } else {
          loaded.push([
            Path.parse(path.slice(0, -1)),
            ((1 << pathLength) - 1) ^ ((1 << MAX_DEPTH) - 1)
          ]);
        }
      } else if (projection[path + "_writable"]) {
        loaded.push([Path.parse(path.slice(0, -1)), 1 << (pathLength - 1)]);
        thisFetched = true;
      }

      if (obj["_timestamp"]) obj["_timestamp"] = +obj["_timestamp"];

      // For compatibility with v1.0 database
      if (obj["_instance"] && obj["_object"] == null) obj["_object"] = true;

      if (thisFetched) {
        const attrs: Attributes = {};
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

        res.push([Path.parse(path.slice(0, -1)), t, attrs]);
      }

      for (const [k, v] of Object.entries(obj)) {
        if (!k.startsWith("_")) {
          obj["_object"] = true;
          storeParams(
            v,
            path + k + ".",
            pathLength + 1,
            obj["_timestamp"],
            descendantsFetched,
            projTree ? projTree[k] : null
          );
          if (projTree) delete projTree[k];
        }
      }

      if (!descendantsFetched) {
        if (projTree) {
          for (const k of Object.keys(projTree)) {
            const p = Path.parse(path + k);
            loaded.push([p, ((1 << pathLength) - 1) ^ ((1 << MAX_DEPTH) - 1)]);
            if ((obj["_object"] || !pathLength) && obj["_timestamp"])
              res.push([p, obj["_timestamp"]]);
          }
        }
      } else if ((obj["_object"] || !pathLength) && obj["_timestamp"]) {
        res.push([Path.parse(path + "*"), obj["_timestamp"]]);
      }
    }

    for (const [k, v] of Object.entries(device)) {
      switch (k) {
        case "_lastInform":
          res.push([
            Path.parse("Events.Inform"),
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
            Path.parse("Events.1_BOOT"),
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
            Path.parse("Events.0_BOOTSTRAP"),
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
            Path.parse("Events.Registered"),
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
              Path.parse("DeviceID.ID"),
              timestamp,
              {
                object: [timestamp, 0],
                writable: [timestamp, 0],
                value: [timestamp, [v as string, "xsd:string"]]
              }
            ]);
          }

          delete device[k];
          break;
        case "_tags":
          if ((v as string[]).length) {
            res.push([
              Path.parse("Tags"),
              timestamp,
              { object: [timestamp, 1], writable: [timestamp, 0] }
            ]);
          }

          for (let t of v as string[]) {
            t = t.replace(/[^a-zA-Z0-9-]+/g, "_");
            res.push([
              Path.parse("Tags." + t),
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
              Path.parse("DeviceID.Manufacturer"),
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
              Path.parse("DeviceID.OUI"),
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
              Path.parse("DeviceID.ProductClass"),
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
              Path.parse("DeviceID.SerialNumber"),
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

    storeParams(device, "", 0, 0, false, projectionTree);
    callback(null, res, loaded);
  });
}

export function saveDevice(
  deviceId: string,
  deviceData: DeviceData,
  isNew: boolean,
  sessionTimestamp: number,
  callback
): void {
  const update = { $set: {}, $unset: {}, $addToSet: {}, $pull: {} };

  for (const diff of deviceData.timestamps.diff()) {
    if (diff[0].wildcard !== 1 << (diff[0].length - 1)) continue;

    if (
      diff[0].segments[0] === "Events" ||
      diff[0].segments[0] === "DeviceID" ||
      diff[0].segments[0] === "Tags"
    )
      continue;

    const parent = deviceData.paths.get(diff[0].slice(0, -1));

    // Param timestamps may be greater than session timestamp to track revisions
    if (diff[2] > sessionTimestamp) diff[2] = sessionTimestamp;

    if (diff[2] == null && diff[1] != null) {
      update["$unset"][
        parent.length ? parent.toString() + "._timestamp" : "_timestamp"
      ] = 1;
    } else {
      if (parent && (!parent.length || deviceData.attributes.has(parent))) {
        update["$set"][
          parent.length ? parent.toString() + "._timestamp" : "_timestamp"
        ] = new Date(diff[2]);
      }
    }
  }

  for (const diff of deviceData.attributes.diff()) {
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

    switch (path.segments[0]) {
      case "Events":
        if (path.length === 2 && value2 !== value1) {
          if (!diff[2]) {
            switch (path.segments[1]) {
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
            const t = new Date(diff[2].value[1][0] as number);
            switch (path.segments[1]) {
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
          switch (path.segments[1]) {
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
            update["$addToSet"]["_tags"]["$each"].push(path.segments[1]);
          } else {
            if (!update["$pull"]["_tags"]) {
              update["$pull"]["_tags"] = {
                $in: []
              };
            }
            update["$pull"]["_tags"]["$in"].push(path.segments[1]);
          }
        }

        break;
      default:
        if (!diff[2]) {
          update["$unset"][path.toString()] = 1;
          continue;
        }

        for (const attrName of Object.keys(diff[2])) {
          // Param timestamps may be greater than session timestamp to track revisions
          if (diff[2][attrName][0] > sessionTimestamp)
            diff[2][attrName][0] = sessionTimestamp;

          if (diff[2][attrName][1] != null) {
            switch (attrName) {
              case "value":
                if (value2 !== value1) {
                  if (
                    valueType2 === "xsd:dateTime" &&
                    Number.isInteger(value2 as number)
                  ) {
                    update["$set"][path.toString() + "._value"] = new Date(
                      value2 as number
                    );
                  } else {
                    update["$set"][path.toString() + "._value"] = value2;
                  }
                }

                if (valueType2 !== valueType1)
                  update["$set"][path.toString() + "._type"] = valueType2;

                if (valueTimestamp2 !== valueTimestamp1) {
                  update["$set"][path.toString() + "._timestamp"] = new Date(
                    valueTimestamp2
                  );
                }

                break;
              case "object":
                if (!diff[1] || !diff[1].object || object2 !== object1) {
                  update["$set"][
                    path.length ? path.toString() + "._object" : "_object"
                  ] = !!object2;
                }

                break;
              case "writable":
                if (!diff[1] || !diff[1].writable || writable2 !== writable1) {
                  update["$set"][
                    path.length ? path.toString() + "._writable" : "_writable"
                  ] = !!writable2;
                }
            }
          }
        }

        if (diff[1]) {
          for (const attrName of Object.keys(diff[1])) {
            if (
              diff[1][attrName][1] != null &&
              (!diff[2] || !diff[2][attrName] || diff[2][attrName][1] == null)
            ) {
              const p = path.length ? path.toString() + "." : "";
              update["$unset"][`${p}_${attrName}`] = 1;
              if (attrName === "value") {
                update["$unset"][p + "_type"] = 1;
                update["$unset"][p + "_timestamp"] = 1;
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
  for (const k of Object.keys(update["$unset"]))
    if (update["$set"][k] != null) delete update["$unset"][k];

  // Remove empty keys
  for (const [k, v] of Object.entries(update)) {
    if (k === "$addToSet") {
      for (const [kk, vv] of Object.entries(v))
        if (!vv["$each"].length) delete v[kk];
    } else if (k === "$pull") {
      for (const [kk, vv] of Object.entries(v))
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

  devicesCollection.updateOne(
    { _id: deviceId },
    update,
    { upsert: isNew },
    (err, result) => {
      if (err || result.result.n !== 1) {
        return void callback(
          err || new Error(`Device ${deviceId} not found in database`)
        );
      }

      if (update2) {
        return void devicesCollection.updateOne(
          { _id: deviceId },
          update2,
          callback
        );
      }

      callback();
    }
  );
}

export function getFaults(deviceId, callback): void {
  faultsCollection
    .find({ _id: { $regex: `^${escapeRegExp(deviceId)}\\:` } })
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

export function saveFault(deviceId, channel, fault, callback): void {
  const id = `${deviceId}:${channel}`;
  fault = Object.assign({}, fault);
  fault._id = id;
  fault.device = deviceId;
  fault.channel = channel;
  fault.timestamp = new Date(fault.timestamp);
  fault.provisions = JSON.stringify(fault.provisions);
  faultsCollection.replaceOne({ _id: id }, fault, { upsert: true }, callback);
}

export function deleteFault(deviceId, channel, callback): void {
  faultsCollection.deleteOne({ _id: `${deviceId}:${channel}` }, callback);
}

export function getDueTasks(deviceId, timestamp, callback): void {
  const cur = tasksCollection.find({ device: deviceId }).sort(["timestamp"]);
  const tasks = [];

  let f;
  cur.next(
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
        if (ObjectID.isValid(task.file))
          q = { _id: { $in: [task.file, new ObjectID(task.file)] } };
        else q = { _id: task.file };

        filesCollection.find(q).toArray((err, res) => {
          if (err) return void callback(err);

          if (res[0]) {
            if (!task.fileType) task.fileType = res[0].metadata.fileType;

            if (!task.fileName)
              task.fileName = res[0].filename || res[0]._id.toString();
          }

          cur.next(f);
        });
      } else {
        cur.next(f);
      }
    })
  );
}

export function clearTasks(deviceId, taskIds, callback): void {
  tasksCollection.deleteMany(
    { _id: { $in: taskIds.map(id => new ObjectID(id)) } },
    callback
  );
}

export function getOperations(deviceId, callback): void {
  operationsCollection
    .find({ _id: { $regex: `^${escapeRegExp(deviceId)}\\:` } })
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

export function saveOperation(deviceId, commandKey, operation, callback): void {
  const id = `${deviceId}:${commandKey}`;
  operation = Object.assign({}, operation);
  operation._id = id;
  operation.timestamp = new Date(operation.timestamp);
  operation.provisions = JSON.stringify(operation.provisions);
  operation.retries = JSON.stringify(operation.retries);
  operation.args = JSON.stringify(operation.args);
  operationsCollection.replaceOne(
    { _id: id },
    operation,
    { upsert: true },
    callback
  );
}

export function deleteOperation(deviceId, commandKey, callback): void {
  operationsCollection.deleteOne(
    { _id: `${deviceId}:${commandKey}` },
    callback
  );
}

export function getPresets(callback): void {
  presetsCollection.find().toArray(callback);
}

export function getObjects(callback): void {
  objectsCollection.find().toArray(callback);
}

export function getProvisions(callback): void {
  provisionsCollection.find().toArray(callback);
}

export function getVirtualParameters(callback): void {
  virtualParametersCollection.find().toArray(callback);
}

export function getFiles(callback): void {
  filesCollection.find().toArray(callback);
}

export function getConfig(callback): void {
  configCollection.find().toArray((err, res) => {
    if (err) return void callback(err);

    callback(
      null,
      res.map(c => ({
        id: c["_id"],
        value: parse(c["value"])
      }))
    );
  });
}
