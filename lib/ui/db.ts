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

import { Db, GridFSBucket, ObjectId } from "mongodb";
import { Script } from "vm";
import { onConnect, optimizeProjection } from "../db";
import * as mongodbFunctions from "../mongodb-functions";
import * as expression from "../common/expression";
import { QueryOptions, Expression } from "../types";
import { Readable, Writable } from "stream";
import { minimize } from "../common/boolean-expression";

const RESOURCE_COLLECTION = {
  files: "fs.files",
};

let db: Db;

onConnect(async (_db) => {
  db = _db;
});

export function query(
  resource: string,
  filter: Expression,
  options?: QueryOptions
): Promise<any[]>;
export function query(
  resource: string,
  filter: Expression,
  options: QueryOptions,
  callback: (doc: any) => void
): Promise<void>;
export function query(
  resource: string,
  filter: Expression,
  options?: QueryOptions,
  callback?: (doc: any) => void
): Promise<void | any[]> {
  options = options || {};
  let q;
  filter = expression.evaluate(filter, null, Date.now());
  filter = minimize(filter, true);

  if (Array.isArray(filter)) {
    if (resource === "devices") {
      filter = mongodbFunctions.processDeviceFilter(filter);
    } else if (resource === "tasks") {
      filter = mongodbFunctions.processTasksFilter(filter);
    } else if (resource === "faults") {
      filter = mongodbFunctions.processFaultsFilter(filter);
    } else if (resource === "users") {
      // Protect against brute force, and dictionary attacks
      const params = expression.extractParams(filter);
      if (params.includes("password") || params.includes("salt"))
        return Promise.reject(new Error("Invalid users filter"));
    }

    q = mongodbFunctions.filterToMongoQuery(filter);
  } else if (!filter) {
    return Promise.resolve([]);
  }

  return new Promise((resolve, reject) => {
    const collection = db.collection(RESOURCE_COLLECTION[resource] || resource);
    const cursor = collection.find(q);
    if (options.projection) {
      let projection = options.projection;
      if (resource === "devices") {
        projection = mongodbFunctions.processDeviceProjection(
          options.projection
        );
      }

      if (resource === "presets") projection.configurations = 1;
      projection = optimizeProjection(projection);
      cursor.project(projection);
    }

    if (resource === "users") cursor.project({ password: 0, salt: 0 });

    if (options.skip) cursor.skip(options.skip);
    if (options.limit) cursor.limit(options.limit);

    if (options.sort) {
      let s = Object.entries(options.sort)
        .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
        .reduce(
          (obj, [k, v]) =>
            Object.assign(obj, { [k]: Math.min(Math.max(v, -1), 1) }),
          {}
        );

      if (resource === "devices") s = mongodbFunctions.processDeviceSort(s);
      cursor.sort(s);
    }

    if (!callback) {
      cursor.toArray((err, docs) => {
        if (err) return reject(err);
        if (resource === "devices")
          docs = docs.map((d) => mongodbFunctions.flattenDevice(d));
        else if (resource === "faults")
          docs = docs.map((d) => mongodbFunctions.flattenFault(d));
        else if (resource === "tasks")
          docs = docs.map((d) => mongodbFunctions.flattenTask(d));
        else if (resource === "presets")
          docs = docs.map((d) => mongodbFunctions.flattenPreset(d));
        else if (resource === "files")
          docs = docs.map((d) => mongodbFunctions.flattenFile(d));
        return resolve(docs);
      });
    } else {
      cursor.forEach(
        (doc) => {
          if (resource === "devices") doc = mongodbFunctions.flattenDevice(doc);
          else if (resource === "faults")
            doc = mongodbFunctions.flattenFault(doc);
          else if (resource === "tasks")
            doc = mongodbFunctions.flattenTask(doc);
          else if (resource === "presets")
            doc = mongodbFunctions.flattenPreset(doc);
          else if (resource === "files")
            doc = mongodbFunctions.flattenFile(doc);
          callback(doc);
        },
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    }
  });
}

export function count(resource: string, filter: Expression): Promise<number> {
  let q;
  filter = expression.evaluate(filter, null, Date.now());
  filter = minimize(filter, true);

  if (Array.isArray(filter)) {
    if (resource === "devices")
      filter = mongodbFunctions.processDeviceFilter(filter);
    else if (resource === "tasks")
      filter = mongodbFunctions.processTasksFilter(filter);
    else if (resource === "faults")
      filter = mongodbFunctions.processFaultsFilter(filter);
    q = mongodbFunctions.filterToMongoQuery(filter);
  } else if (!filter) {
    return Promise.resolve(0);
  }

  return new Promise((resolve, reject) => {
    const collection = db.collection(RESOURCE_COLLECTION[resource] || resource);
    collection.find(q).count((err, c) => {
      if (err) reject(err);
      else resolve(c);
    });
  });
}

export async function updateDeviceTags(
  deviceId: string,
  tags: Record<string, boolean>
): Promise<void> {
  const add = [];
  const pull = [];

  for (let [tag, onOff] of Object.entries(tags)) {
    tag = tag.trim();
    if (onOff) add.push(tag);
    else pull.push(tag);
  }

  const collection = db.collection("devices");
  const object = {};

  if (add?.length) object["$addToSet"] = { _tags: { $each: add } };
  if (pull?.length) object["$pullAll"] = { _tags: pull };

  await collection.updateOne({ _id: deviceId }, object);
}

function putResource(resource, id, object): Promise<void> {
  return new Promise((resolve, reject) => {
    const collection = db.collection(RESOURCE_COLLECTION[resource] || resource);
    collection.replaceOne({ _id: id }, object, { upsert: true }, (err) => {
      if (err) return void reject(err);
      resolve();
    });
  });
}

function deleteResource(
  resource: string,
  id: string | ObjectId
): Promise<void> {
  return new Promise((resolve, reject) => {
    const collection = db.collection(RESOURCE_COLLECTION[resource] || resource);
    collection.deleteOne({ _id: id }, (err) => {
      if (err) return void reject(err);
      resolve();
    });
  });
}

export function putPreset(
  id: string,
  object: Record<string, unknown>
): Promise<void> {
  object = mongodbFunctions.preProcessPreset(object);
  return putResource("presets", id, object);
}

export function deletePreset(id: string): Promise<void> {
  return deleteResource("presets", id);
}

export function putProvision(
  id: string,
  object: Record<string, unknown>
): Promise<void> {
  if (!object.script) object.script = "";
  try {
    new Script(`"use strict";(function(){\n${object.script}\n})();`, {
      filename: id,
      lineOffset: -1,
    });
  } catch (err) {
    if (err.stack?.startsWith(`${id}:`)) {
      return Promise.reject(
        new Error(`${err.name} at ${err.stack.split("\n", 1)[0]}`)
      );
    }
    return Promise.reject(err);
  }
  return putResource("provisions", id, object);
}

export function deleteProvision(id: string): Promise<void> {
  return deleteResource("provisions", id);
}

export function putVirtualParameter(
  id: string,
  object: Record<string, unknown>
): Promise<void> {
  if (!object.script) object.script = "";
  try {
    new Script(`"use strict";(function(){\n${object.script}\n})();`, {
      filename: id,
      lineOffset: -1,
    });
  } catch (err) {
    if (err.stack?.startsWith(`${id}:`)) {
      return Promise.reject(
        new Error(`${err.name} at ${err.stack.split("\n", 1)[0]}`)
      );
    }
    return Promise.reject(err);
  }
  return putResource("virtualParameters", id, object);
}

export function deleteVirtualParameter(id: string): Promise<void> {
  return deleteResource("virtualParameters", id);
}

export function putConfig(
  id: string,
  object: Record<string, unknown>
): Promise<void> {
  return putResource("config", id, object);
}

export function deleteConfig(id: string): Promise<void> {
  return deleteResource("config", id);
}

export function putPermission(
  id: string,
  object: Record<string, unknown>
): Promise<void> {
  return putResource("permissions", id, object);
}

export function deletePermission(id: string): Promise<void> {
  return deleteResource("permissions", id);
}

export function putUser(
  id: string,
  object: Record<string, unknown>
): Promise<void> {
  return new Promise((resolve, reject) => {
    const collection = db.collection("users");
    // update instead of replace to keep the password if not set by user
    collection.updateOne(
      { _id: id },
      { $set: object },
      { upsert: true },
      (err) => {
        if (err) return void reject(err);
        resolve();
      }
    );
  });
}

export function deleteUser(id: string): Promise<void> {
  return deleteResource("users", id);
}

export function downloadFile(filename: string): Readable {
  const bucket = new GridFSBucket(db);
  return bucket.openDownloadStreamByName(filename);
}

export function putFile(
  filename: string,
  metadata: Record<string, string>,
  contentStream: Readable
): Promise<void> {
  return new Promise((resolve, reject) => {
    const bucket = new GridFSBucket(db);
    const uploadStream = bucket.openUploadStreamWithId(
      filename as unknown as ObjectId,
      filename,
      {
        metadata: metadata,
      }
    );
    uploadStream.on("error", reject);
    contentStream.on("error", reject);
    uploadStream.on("finish", resolve);
    contentStream.pipe(uploadStream as Writable);
  });
}

export function deleteFile(filename: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const bucket = new GridFSBucket(db);
    bucket.delete(filename as any, (err) => {
      if (err) return void reject(err);
      resolve();
    });
  });
}

export function deleteFault(id: string): Promise<void> {
  return deleteResource("faults", id);
}

export function deleteTask(id: ObjectId): Promise<void> {
  return deleteResource("tasks", id);
}
