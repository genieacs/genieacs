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

import { MongoClient, ObjectID, Collection } from "mongodb";
import { get } from "./config";
import { escapeRegExp } from "./common";
import { parse } from "./common/expression-parser";
import {
  DeviceData,
  Attributes,
  SessionFault,
  Task,
  Operation,
  Expression
} from "./types";
import Path from "./common/path";

export let tasksCollection: Collection,
  devicesCollection: Collection,
  presetsCollection: Collection,
  objectsCollection: Collection,
  provisionsCollection: Collection,
  virtualParametersCollection: Collection,
  faultsCollection: Collection,
  filesCollection: Collection,
  operationsCollection: Collection,
  permissionsCollection: Collection,
  usersCollection: Collection,
  configCollection: Collection;

let clientPromise: Promise<MongoClient>;
export let client: MongoClient;

export async function connect(): Promise<void> {
  clientPromise = MongoClient.connect("" + get("MONGODB_CONNECTION_URL"), {
    useNewUrlParser: true
  });

  client = await clientPromise;
  const db = client.db();

  tasksCollection = db.collection("tasks");
  await tasksCollection.createIndex({ device: 1, timestamp: 1 });

  devicesCollection = db.collection("devices");
  presetsCollection = db.collection("presets");
  objectsCollection = db.collection("objects");
  filesCollection = db.collection("fs.files");
  provisionsCollection = db.collection("provisions");
  virtualParametersCollection = db.collection("virtualParameters");
  faultsCollection = db.collection("faults");
  operationsCollection = db.collection("operations");
  permissionsCollection = db.collection("permissions");
  usersCollection = db.collection("users");
  configCollection = db.collection("config");
}

export async function disconnect(): Promise<void> {
  if (clientPromise) await (await clientPromise).close();
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

export async function fetchDevice(
  id: string,
  timestamp: number
): Promise<[Path, number, Attributes?][]> {
  const res: [Path, number, Attributes?][] = [
    [
      Path.parse("Events"),
      timestamp,
      { object: [timestamp, 1], writable: [timestamp, 0] }
    ],
    [
      Path.parse("DeviceID"),
      timestamp,
      { object: [timestamp, 1], writable: [timestamp, 0] }
    ]
  ];

  const device = await devicesCollection.findOne({ _id: id });
  if (!device) return null;

  function storeParams(obj, path: string, pathLength: number, ts): void {
    if (obj["_timestamp"]) obj["_timestamp"] = +obj["_timestamp"];

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

    for (const [k, v] of Object.entries(obj)) {
      if (!k.startsWith("_")) {
        obj["_object"] = true;
        storeParams(v, path + k + ".", pathLength + 1, obj["_timestamp"]);
      }
    }

    if ((obj["_object"] || !pathLength) && obj["_timestamp"])
      res.push([Path.parse(path + "*"), obj["_timestamp"]]);
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
        break;
      case "_id":
        res.push([
          Path.parse("DeviceID.ID"),
          timestamp,
          {
            object: [timestamp, 0],
            writable: [timestamp, 0],
            value: [timestamp, [v as string, "xsd:string"]]
          }
        ]);
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
    }
  }

  storeParams(device, "", 0, 0);
  return res;
}

export async function saveDevice(
  deviceId: string,
  deviceData: DeviceData,
  isNew: boolean,
  sessionTimestamp: number
): Promise<void> {
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

  if (!Object.keys(update).length) return;

  // Mongo doesn't allow $addToSet and $pull at the same time
  let update2;
  if (update["$addToSet"] && update["$pull"]) {
    update2 = { $pull: update["$pull"] };
    delete update["$pull"];
  }

  const result = await devicesCollection.updateOne({ _id: deviceId }, update, {
    upsert: isNew
  });

  if (result.result.n !== 1)
    throw new Error(`Device ${deviceId} not found in database`);

  if (update2) {
    await devicesCollection.updateOne({ _id: deviceId }, update2);
    return;
  }
}

export async function getFaults(
  deviceId
): Promise<{ [channel: string]: SessionFault }> {
  const res = await faultsCollection
    .find({ _id: { $regex: `^${escapeRegExp(deviceId)}\\:` } })
    .toArray();

  const faults: { [channel: string]: SessionFault } = {};
  for (const r of res) {
    const channel = r._id.slice(deviceId.length + 1);
    delete r._id;
    delete r.channel;
    delete r.device;
    r.timestamp = +r.timestamp;
    r.provisions = JSON.parse(r.provisions);
    faults[channel] = r;
  }

  return faults;
}

export async function saveFault(deviceId, channel, fault): Promise<void> {
  const id = `${deviceId}:${channel}`;
  fault = Object.assign({}, fault);
  fault._id = id;
  fault.device = deviceId;
  fault.channel = channel;
  fault.timestamp = new Date(fault.timestamp);
  fault.provisions = JSON.stringify(fault.provisions);
  await faultsCollection.replaceOne({ _id: id }, fault, { upsert: true });
}

export async function deleteFault(deviceId, channel): Promise<void> {
  await faultsCollection.deleteOne({ _id: `${deviceId}:${channel}` });
}

export async function getDueTasks(
  deviceId,
  timestamp
): Promise<[Task[], number]> {
  const cur = tasksCollection.find({ device: deviceId }).sort(["timestamp"]);
  const tasks = [] as Task[];

  for await (const task of cur) {
    if (task.timestamp) task.timestamp = +task.timestamp;
    if (task.expiry) task.expiry = +task.expiry;
    if (task.timestamp >= timestamp) return [tasks, +task.timestamp];
    task._id = String(task._id);

    tasks.push(task);

    // For API compatibility
    if (task.name === "download" && task.file) {
      let q;
      if (ObjectID.isValid(task.file))
        q = { _id: { $in: [task.file, new ObjectID(task.file)] } };
      else q = { _id: task.file };

      const res = await filesCollection.find(q).toArray();

      if (res[0]) {
        if (!task.fileType) task.fileType = res[0].metadata.fileType;

        if (!task.fileName)
          task.fileName = res[0].filename || res[0]._id.toString();
      }
    }
  }
  return [tasks, null];
}

export async function clearTasks(deviceId, taskIds): Promise<void> {
  await tasksCollection.deleteMany({
    _id: { $in: taskIds.map(id => new ObjectID(id)) }
  });
}

export async function getOperations(
  deviceId
): Promise<{ [commandKey: string]: Operation }> {
  const res = await operationsCollection
    .find({ _id: { $regex: `^${escapeRegExp(deviceId)}\\:` } })
    .toArray();

  const operations: { [commandKey: string]: Operation } = {};
  for (const r of res) {
    const commandKey = r._id.slice(deviceId.length + 1);
    delete r._id;
    r.timestamp = +r.timestamp;
    if (r.args) r.args = JSON.parse(r.args);
    r.provisions = JSON.parse(r.provisions);
    r.retries = JSON.parse(r.retries);
    operations[commandKey] = r;
  }
  return operations;
}

export async function saveOperation(
  deviceId,
  commandKey,
  operation
): Promise<void> {
  const id = `${deviceId}:${commandKey}`;
  operation = Object.assign({}, operation);
  operation._id = id;
  operation.timestamp = new Date(operation.timestamp);
  operation.provisions = JSON.stringify(operation.provisions);
  operation.retries = JSON.stringify(operation.retries);
  operation.args = JSON.stringify(operation.args);
  await operationsCollection.replaceOne({ _id: id }, operation, {
    upsert: true
  });
}

export async function deleteOperation(deviceId, commandKey): Promise<void> {
  await operationsCollection.deleteOne({ _id: `${deviceId}:${commandKey}` });
}

export async function getPresets(): Promise<{}[]> {
  return presetsCollection.find().toArray();
}

export async function getObjects(): Promise<{}[]> {
  return objectsCollection.find().toArray();
}

export async function getProvisions(): Promise<{}[]> {
  return provisionsCollection.find().toArray();
}

export async function getVirtualParameters(): Promise<{}[]> {
  return virtualParametersCollection.find().toArray();
}

export function getFiles(): Promise<{}[]> {
  return filesCollection.find().toArray();
}

export async function getConfig(): Promise<
  { id: string; value: Expression }[]
> {
  const res = await configCollection.find().toArray();
  return res.map(c => ({
    id: c["_id"],
    value: parse(c["value"])
  }));
}

interface Permission {
  role: string;
  resource: string;
  access: number;
  filter: string;
  validate: string;
}

export async function getPermissions(): Promise<Permission[]> {
  return permissionsCollection.find().toArray();
}

interface User {
  _id: string;
  password: string;
  salt: string;
  roles: string;
}

export async function getUsers(): Promise<User[]> {
  return usersCollection.find().toArray();
}
