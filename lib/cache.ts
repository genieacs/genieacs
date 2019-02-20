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

import { MongoClient } from "mongodb";
import * as config from "./config";

const MAX_CACHE_TTL = +config.get("MAX_CACHE_TTL");

let mongoClient;
let mongoCollection;
let mongoTimeOffset = 0;

export function connect(callback): void {
  const MONGODB_CONNECTION_URL = "" + config.get("MONGODB_CONNECTION_URL");

  MongoClient.connect(
    MONGODB_CONNECTION_URL,
    { useNewUrlParser: true },
    (err, client) => {
      if (err) return void callback(err);

      const db = client.db();
      mongoClient = client;
      mongoCollection = db.collection("cache");
      mongoCollection.createIndex({ expire: 1 }, { expireAfterSeconds: 0 });

      const now = Date.now();
      db.command({ hostInfo: 1 }, (err, res) => {
        if (err) return void callback(err);
        mongoTimeOffset = res.system.currentTime.getTime() - now;
        callback();
      });
    }
  );
}

export function disconnect(): void {
  if (mongoClient) mongoClient.close();
}

export function get(key, callback): void {
  const expire = new Date(Date.now() - mongoTimeOffset);
  if (Array.isArray(key)) {
    mongoCollection.find({ _id: { $in: key } }).toArray((err, res) => {
      if (err) return void callback(err);

      const indices = {};
      key.forEach((v, i) => {
        indices[v] = i;
      });

      const values = [];
      res.forEach(r => {
        if (r["expire"] > expire) values[indices[r["_id"]]] = r["value"];
      });
      callback(null, values);
    });
  } else {
    mongoCollection.findOne({ _id: { $in: [key] } }, (err, res) => {
      if (err || !res) return void callback(err);

      if (res["expire"] > expire) return void callback(null, res["value"]);

      callback();
    });
  }
}

export function del(key, callback): void {
  if (Array.isArray(key))
    mongoCollection.deleteMany({ _id: { $in: key } }, callback);
  else mongoCollection.deleteOne({ _id: key }, callback);
}

export function set(
  key: string,
  value: string | number,
  callback: (err?: Error) => void
): void;
export function set(
  key: string,
  value: string | number,
  ttl: number,
  callback: (err?: Error) => void
): void;
export function set(
  key: string,
  value: string | number,
  ttl: number | ((err?: Error) => void),
  callback?: (err?: Error) => void
): void {
  if (!callback && typeof ttl === "function") {
    callback = ttl;
    ttl = null;
  }

  if (!ttl) ttl = MAX_CACHE_TTL;

  const expire = new Date(
    Date.now() - mongoTimeOffset + (ttl as number) * 1000
  );
  mongoCollection.replaceOne(
    { _id: key },
    { _id: key, value: value, expire: expire },
    { upsert: true },
    callback
  );
}

export function pop(key, callback): void {
  mongoCollection.findOneAndDelete({ _id: key }, (err, res) => {
    if (err || !res["value"]) return void callback(err);

    if (res["value"]["expire"] > new Date(Date.now() - mongoTimeOffset))
      return void callback(null, res["value"]["value"]);

    callback();
  });
}

export function lock(lockName, ttl, callback): void {
  const token = Math.random()
    .toString(36)
    .slice(2);

  function unlockOrExtend(extendTtl): void {
    if (!extendTtl) {
      mongoCollection.deleteOne({ _id: lockName, value: token }, (err, res) => {
        if (err || res["result"]["n"] !== 1)
          throw err || new Error("Lock expired");
      });
    } else {
      const expire = new Date(Date.now() - mongoTimeOffset + extendTtl * 1000);
      mongoCollection.updateOne(
        { _id: lockName, value: token },
        { expire: expire },
        (err, res) => {
          if (err || res["result"]["n"] !== 1)
            throw err || new Error("Lock expired");
        }
      );
    }
  }

  const expireTest = new Date(Date.now() - mongoTimeOffset);
  const expireSet = new Date(Date.now() - mongoTimeOffset + ttl * 1000);

  mongoCollection.updateOne(
    { _id: lockName, expire: { $lte: expireTest } },
    { $set: { value: token, expire: expireSet } },
    { upsert: true },
    err => {
      if (err && err.code === 11000) {
        return setTimeout(() => {
          lock(lockName, ttl, callback);
        }, 200);
      }

      return callback(err, unlockOrExtend);
    }
  );
}
