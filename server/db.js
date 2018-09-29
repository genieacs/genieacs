"use strict";

const mongodb = require("mongodb");
const config = require("./config");
const mongodbFunctions = require("./mongodb-functions");
const expression = require("../common/expression");

let _clientPromise = null;

const RESOURCE_DB = {
  devices: "genieacs",
  faults: "genieacs",
  tasks: "genieacs",
  presets: "genieacs",
  provisions: "genieacs",
  virtualParameters: "genieacs",
  files: "genieacs"
};

const RESOURCE_COLLECTION = {
  files: "fs.files"
};

function getClient() {
  if (!_clientPromise)
    _clientPromise = new Promise((resolve, reject) => {
      const CONNECTION_URL = config.server.mongodbConnectionUrl;
      mongodb.MongoClient.connect(
        CONNECTION_URL,
        { useNewUrlParser: true },
        (err, client) => {
          if (err) return reject(err);
          resolve(client);
        }
      );
    });

  return _clientPromise;
}

function query(resource, filter, options, callback) {
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
        .db(RESOURCE_DB[resource])
        .collection(RESOURCE_COLLECTION[resource] || resource);
      const cursor = collection.find(q);
      if (options.projection)
        cursor.project(
          resource === "devices"
            ? mongodbFunctions.processDeviceProjection(options.projection)
            : options.projection
        );
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

      if (!callback)
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
      else
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
    });
  });
}

function count(resource, filter) {
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
        .db(RESOURCE_DB[resource])
        .collection(RESOURCE_COLLECTION[resource] || resource);
      collection.find(q).count((err, c) => {
        if (err) reject(err);
        else resolve(c);
      });
    });
  });
}

function disconnect() {
  if (_clientPromise)
    _clientPromise.then(client => {
      client.close();
    });
}

exports.query = query;
exports.count = count;
exports.disconnect = disconnect;
