"use strict";

const MongoClient = require("mongodb").MongoClient;
const config = require("./config");
const apiFunctions = require("./api-functions");

let _client = null;

function getClient() {
  if (_client) return Promise.resolve(_client);

  return new Promise((resolve, reject) => {
    const CONNECTION_URL = config.server.mongodbConnectionUrl;
    MongoClient.connect(CONNECTION_URL, (err, client) => {
      if (err) return reject(err);
      resolve((_client = client.db("genieacs-ui")));
    });
  });
}

function query(resource, filter, limit, skip, callback) {
  let q;
  if (filter && filter.ast) q = apiFunctions.filterToMongoQuery(filter.ast);

  return new Promise((resolve, reject) => {
    getClient().then(client => {
      const collection = client.collection(resource);
      if (!callback)
        collection
          .find(q)
          .skip(skip || 0)
          .limit(limit || 0)
          .toArray((err, docs) => {
            if (err) return reject(err);
            return resolve(docs);
          });
      else
        collection.find(q).forEach(
          doc => {
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
  if (filter && filter.ast) q = apiFunctions.filterToMongoQuery(filter.ast);

  return new Promise((resolve, reject) => {
    getClient().then(client => {
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
