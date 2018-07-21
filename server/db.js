"use strict";

const mongodb = require("mongodb");
const config = require("./config");
const mongodbFunctions = require("./mongodb-functions");
const expression = require("../common/expression");

const _client = {};

const RESOURCE_DB = {
  devices: "genieacs",
  faults: "genieacs",
  tasks: "genieacs",
  presets: "genieacs",
  provisions: "genieacs",
  files: "genieacs"
};

function getClient(db) {
  if (_client[db]) return Promise.resolve(_client[db]);

  return new Promise((resolve, reject) => {
    const CONNECTION_URL = config.server.mongodbConnectionUrl;
    mongodb.MongoClient.connect(CONNECTION_URL, (err, client) => {
      if (err) return reject(err);
      resolve((_client[db] = client.db(db)));
    });
  });
}

function query(resource, filter, options, callback) {
  options = options || {};
  let q;
  filter = expression.evaluate(filter, null, null, Date.now());

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
    getClient(RESOURCE_DB[resource]).then(client => {
      const collection = client.collection(resource);
      let cursor = collection.find(
        q,
        resource === "Devices"
          ? mongodbFunctions.processDeviceProjection(options.projection)
          : options.projection
      );
      if (options.skip) cursor = cursor.skip(options.skip);
      if (options.limit) cursor = cursor.limit(options.limit);
      cursor = cursor.sort({ _id: 1 });

      if (!callback)
        cursor.toArray((err, docs) => {
          if (err) return reject(err);
          if (resource === "devices")
            docs = docs.map(d => mongodbFunctions.flattenDevice(d));
          return resolve(docs);
        });
      else
        cursor.forEach(
          doc => {
            if (resource === "devices")
              doc = mongodbFunctions.flattenDevice(doc);
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
  filter = expression.evaluate(filter, null, null, Date.now());

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
    getClient(RESOURCE_DB[resource]).then(client => {
      const collection = client.collection(resource);
      collection.find(q).count((err, c) => {
        if (err) reject(err);
        else resolve(c);
      });
    });
  });
}

exports.query = query;
exports.count = count;
