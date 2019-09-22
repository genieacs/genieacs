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

import { MongoClient, GridFSBucket } from "mongodb";
import { Script } from "vm";
import * as config from "../config";
import * as mongodbFunctions from "../mongodb-functions";
import * as expression from "../common/expression";
import { QueryOptions } from "../types";

const CACHE_TTL = 300000;

let clientPromise: Promise<MongoClient>;

const RESOURCE_COLLECTION = {
  files: "fs.files"
};

function ensureIndexes(client): void {
  client
    .db()
    .collection("cache")
    .createIndex({ expire: 1 }, { expireAfterSeconds: 0 });
}

function getClient(): Promise<MongoClient> {
  if (!clientPromise) {
    clientPromise = new Promise((resolve, reject) => {
      const CONNECTION_URL = "" + config.get("MONGODB_CONNECTION_URL");
      MongoClient.connect(
        CONNECTION_URL,
        { useNewUrlParser: true },
        (err, client) => {
          if (err) return void reject(err);
          ensureIndexes(client);
          resolve(client);
        }
      );
    });
  }

  return clientPromise;
}

export function cache<T>(key, valueGetter: () => Promise<T>, ttl): Promise<T> {
  return new Promise((resolve, reject) => {
    getClient()
      .then(client => {
        const collection = client.db().collection("cache");
        collection.findOne({ _id: key }, (err, doc) => {
          if (err) return void reject(err);
          if (doc != null) return void resolve(JSON.parse(doc.value) as T);
          valueGetter()
            .then(res => {
              const expire = Date.now() + (ttl || CACHE_TTL);
              const cacheDoc = {
                _id: key,
                value: JSON.stringify(res),
                expire: new Date(expire)
              };
              collection.updateOne(
                { _id: key },
                { $set: cacheDoc },
                { upsert: true },
                err => {
                  if (err) reject(err);
                  else resolve(res);
                }
              );
            })
            .catch(reject);
        });
      })
      .catch(reject);
  });
}

export function query(
  resource,
  filter,
  options?: QueryOptions,
  callback?: (doc: any) => void
): Promise<any[]> {
  options = options || {};
  let q;
  filter = expression.evaluate(filter, null, Date.now());

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
  } else if (filter != null && !filter) {
    return Promise.resolve([]);
  }

  return new Promise((resolve, reject) => {
    getClient().then(client => {
      const collection = client
        .db()
        .collection(RESOURCE_COLLECTION[resource] || resource);
      const cursor = collection.find(q);
      if (options.projection) {
        let projection = options.projection;
        if (resource === "devices") {
          projection = mongodbFunctions.processDeviceProjection(
            options.projection
          );
        }

        if (resource === "presets") projection.configurations = 1;
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
            docs = docs.map(d => mongodbFunctions.flattenDevice(d));
          else if (resource === "faults")
            docs = docs.map(d => mongodbFunctions.flattenFault(d));
          else if (resource === "tasks")
            docs = docs.map(d => mongodbFunctions.flattenTask(d));
          else if (resource === "presets")
            docs = docs.map(d => mongodbFunctions.flattenPreset(d));
          else if (resource === "files")
            docs = docs.map(d => mongodbFunctions.flattenFile(d));
          return resolve(docs);
        });
      } else {
        cursor.forEach(
          doc => {
            if (resource === "devices")
              doc = mongodbFunctions.flattenDevice(doc);
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
          err => {
            if (err) reject(err);
            else resolve();
          }
        );
      }
    });
  });
}

export function count(resource, filter): Promise<number> {
  let q;
  filter = expression.evaluate(filter, null, Date.now());

  if (Array.isArray(filter)) {
    if (resource === "devices")
      filter = mongodbFunctions.processDeviceFilter(filter);
    else if (resource === "tasks")
      filter = mongodbFunctions.processTasksFilter(filter);
    else if (resource === "faults")
      filter = mongodbFunctions.processFaultsFilter(filter);
    q = mongodbFunctions.filterToMongoQuery(filter);
  } else if (filter != null && !filter) {
    return Promise.resolve(0);
  }

  return new Promise((resolve, reject) => {
    getClient().then(client => {
      const collection = client
        .db()
        .collection(RESOURCE_COLLECTION[resource] || resource);
      collection.find(q).count((err, c) => {
        if (err) reject(err);
        else resolve(c);
      });
    });
  });
}

export function updateDeviceTags(deviceId, tags): Promise<void> {
  return new Promise((resolve, reject) => {
    const add = [];
    const pull = [];

    const regex = /^[0-9a-zA-Z_]+$/;
    for (let [tag, onOff] of Object.entries(tags)) {
      tag = tag.trim();
      if (onOff) {
        if (!tag.match(regex))
          return void reject(new Error(`Invalid tag '${tag}'`));
        add.push(tag);
      } else {
        pull.push(tag);
      }
    }
    getClient()
      .then(client => {
        const collection = client.db().collection("devices");

        const object = {};
        if (add && add.length) object["$addToSet"] = { _tags: { $each: add } };
        if (pull && pull.length) object["$pullAll"] = { _tags: pull };
        collection.updateOne({ _id: deviceId }, object, err => {
          if (err) return void reject(err);
          resolve();
        });
      })
      .catch(reject);
  });
}

function putResource(resource, id, object): Promise<void> {
  return new Promise((resolve, reject) => {
    getClient()
      .then(client => {
        const collection = client
          .db()
          .collection(RESOURCE_COLLECTION[resource] || resource);
        collection.replaceOne({ _id: id }, object, { upsert: true }, err => {
          if (err) return void reject(err);
          resolve();
        });
      })
      .catch(reject);
  });
}

function deleteResource(resource, id): Promise<void> {
  return new Promise((resolve, reject) => {
    getClient()
      .then(client => {
        const collection = client
          .db()
          .collection(RESOURCE_COLLECTION[resource] || resource);
        collection.deleteOne({ _id: id }, err => {
          if (err) return void reject(err);
          resolve();
        });
      })
      .catch(reject);
  });
}

export function putPreset(id, object): Promise<void> {
  object = mongodbFunctions.preProcessPreset(object);
  return putResource("presets", id, object);
}

export function deletePreset(id): Promise<void> {
  return deleteResource("presets", id);
}

export function putProvision(id, object): Promise<void> {
  if (!object.script) object.script = "";
  try {
    new Script(`"use strict";(function(){\n${object.script}\n})();`);
  } catch (error) {
    return Promise.reject(error);
  }
  return putResource("provisions", id, object);
}

export function deleteProvision(id): Promise<void> {
  return deleteResource("provisions", id);
}

export function putVirtualParameter(id, object): Promise<void> {
  if (!object.script) object.script = "";
  try {
    new Script(`"use strict";(function(){\n${object.script}\n})();`);
  } catch (error) {
    return Promise.reject(error);
  }
  return putResource("virtualParameters", id, object);
}

export function deleteVirtualParameter(id): Promise<void> {
  return deleteResource("virtualParameters", id);
}

export function putConfig(id, object): Promise<void> {
  return putResource("config", id, object);
}

export function deleteConfig(id): Promise<void> {
  return deleteResource("config", id);
}

export function putPermission(id, object): Promise<void> {
  return putResource("permissions", id, object);
}

export function deletePermission(id): Promise<void> {
  return deleteResource("permissions", id);
}

export function putUser(id, object): Promise<void> {
  return new Promise((resolve, reject) => {
    getClient()
      .then(client => {
        const collection = client.db().collection("users");
        // update instead of replace to keep the password if not set by user
        collection.updateOne(
          { _id: id },
          { $set: object },
          { upsert: true },
          err => {
            if (err) return void reject(err);
            resolve();
          }
        );
      })
      .catch(reject);
  });
}

export function deleteUser(id): Promise<void> {
  return deleteResource("users", id);
}

export function putFile(filename, metadata, contentStream): Promise<void> {
  return new Promise((resolve, reject) => {
    getClient()
      .then(client => {
        const bucket = new GridFSBucket(client.db());
        const uploadStream = bucket.openUploadStreamWithId(filename, filename, {
          metadata: metadata
        });
        uploadStream.on("error", reject);
        contentStream.on("error", reject);
        uploadStream.on("finish", resolve);
        contentStream.pipe(uploadStream);
      })
      .catch(reject);
  });
}

export function deleteFile(filename): Promise<void> {
  return new Promise((resolve, reject) => {
    getClient()
      .then(client => {
        const bucket = new GridFSBucket(client.db());
        bucket.delete(filename, err => {
          if (err) return void reject(err);
          resolve();
        });
      })
      .catch(reject);
  });
}

export function deleteFault(id): Promise<void> {
  return deleteResource("faults", id);
}

export function deleteTask(id): Promise<void> {
  return deleteResource("tasks", id);
}

export async function disconnect(): Promise<void> {
  if (clientPromise) await (await clientPromise).close();
}
