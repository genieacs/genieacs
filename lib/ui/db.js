"use strict";

import { MongoClient } from "mongodb";
import * as config from "../config";
import * as mongodbFunctions from "./mongodb-functions";
import * as expression from "../common/expression";

const CACHE_TTL = 300000;

let _clientPromise = null;

const RESOURCE_COLLECTION = {
  files: "fs.files"
};

function ensureIndexes(client) {
  client
    .db()
    .collection("cache")
    .createIndex({ expire: 1 }, { expireAfterSeconds: 0 });
}

function getClient() {
  if (!_clientPromise) {
    _clientPromise = new Promise((resolve, reject) => {
      const CONNECTION_URL = config.get("MONGODB_CONNECTION_URL");
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

  return _clientPromise;
}

export function cache(key, valueGetter, ttl) {
  return new Promise((resolve, reject) => {
    getClient()
      .then(client => {
        const collection = client.db().collection("cache");
        collection.findOne({ _id: key }, (err, doc) => {
          if (err) return void reject(err);
          if (doc != null) return void resolve(JSON.parse(doc.value));
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

export function query(resource, filter, options, callback) {
  options = options || {};
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
    return Promise.resolve([]);
  }

  return new Promise((resolve, reject) => {
    getClient().then(client => {
      const collection = client
        .db()
        .collection(RESOURCE_COLLECTION[resource] || resource);
      const cursor = collection.find(q);
      if (options.projection) {
        cursor.project(
          resource === "devices"
            ? mongodbFunctions.processDeviceProjection(options.projection)
            : options.projection
        );
      }
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

export function count(resource, filter) {
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

export function deleteConfig(id) {
  return new Promise((resolve, reject) => {
    getClient()
      .then(client => {
        const collection = client
          .db()
          .collection(RESOURCE_COLLECTION["config"] || "config");
        collection.deleteOne({ _id: id }, err => {
          if (err) return void reject(err);
          resolve();
        });
      })
      .catch(reject);
  });
}

export function putConfig(id, object) {
  return new Promise((resolve, reject) => {
    getClient()
      .then(client => {
        const collection = client
          .db()
          .collection(RESOURCE_COLLECTION["config"] || "config");
        collection.replaceOne({ _id: id }, object, { upsert: true }, err => {
          if (err) return void reject(err);
          resolve();
        });
      })
      .catch(reject);
  });
}

export function disconnect() {
  if (_clientPromise) {
    _clientPromise.then(client => {
      client.close();
    });
  }
}
