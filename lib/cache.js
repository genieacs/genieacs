/**
 * Copyright 2013-2017  Zaid Abdulla
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

const config = require("./config");

const MAX_CACHE_TTL = config.get("MAX_CACHE_TTL");

let redisClient;
let mongoDb;
let mongoCollection;
let mongoTimeOffset = 0;


function connect(callback) {
  const REDIS_HOST = config.get("REDIS_HOST");

  if (REDIS_HOST) {
    const redis = require("redis");
    const REDIS_PORT = config.get("REDIS_PORT");
    const REDIS_DB = config.get("REDIS_DB");
    redisClient = redis.createClient(REDIS_PORT, REDIS_HOST);
    redisClient.select(REDIS_DB, function(err) {
      exports.get = redisGet;
      exports.set = redisSet;
      exports.del = redisDel;
      exports.pop = redisPop;
      exports.lock = redisLock;
      callback(err);
    });
  }
  else {
    const mongodb = require("mongodb");
    const MONGODB_CONNECTION_URL = config.get("MONGODB_CONNECTION_URL");

    mongodb.MongoClient.connect(MONGODB_CONNECTION_URL, function(err, db) {
      if (err)
        return callback(err);

      mongoDb = db;
      mongoCollection = db.collection("cache");
      mongoCollection.ensureIndex({"expire": 1}, {expireAfterSeconds: 0});

      const now = Date.now();
      mongoDb.command({hostInfo: 1}, function(err, res) {
        if (err)
          return callback(err);
        mongoTimeOffset = res.system.currentTime.getTime() - now;
        exports.get = mongoGet;
        exports.set = mongoSet;
        exports.del = mongoDel;
        exports.pop = mongoPop;
        exports.lock = mongoLock;
        callback();
      });
    });
  }
}


function disconnect() {
  if (redisClient)
    redisClient.quit();

  if (mongoDb)
    mongoDb.close();
}


function redisGet(key, callback) {
  if (Array.isArray(key))
    redisClient.mget(key, callback);
  else
    redisClient.get(key, callback);
}


function redisDel(key, callback) {
  redisClient.del(key, callback);
}


function redisSet(key, value, ttl, callback) {
  if (!callback && typeof v === "function") {
    callback = ttl;
    ttl = null;
  }

  if (!ttl)
    ttl = MAX_CACHE_TTL;

  redisClient.setex(key, ttl, value, callback);
}


function redisPop(key, callback) {
  const POP_SCRIPT = "local v=redis.call(\"get\",KEYS[1]);redis.call(\"del\",KEYS[1]);return v;";
  redisClient.eval(POP_SCRIPT, 1, key, callback);
}


function redisLock(lockName, ttl, callback) {
  const UNLOCK_SCRIPT = "if redis.call(\"get\", KEYS[1]) == ARGV[1] then return redis.call(\"del\", KEYS[1]) else return 0 end";
  const EXTEND_SCRIPT = "if redis.call(\"get\", KEYS[1]) == ARGV[1] then return redis.call(\"pexpire\", KEYS[1], ARGV[2]) else return 0 end";
  const token = Math.random().toString(36).slice(2);

  function unlockOrExtend(ttl) {
    if (!ttl) {
      redisClient.eval(UNLOCK_SCRIPT, 1, lockName, token, function(err, res) {
        if (err || !res)
          throw err || new Error("Lock expired");
      });
    }
    else {
      redisClient.eval(EXTEND_SCRIPT, 1, lockName, token, ttl, function(err, res) {
        if (err || !res)
          throw err || new Error("Lock expired");
      });
    }
  }

  redisClient.set(lockName, token, "NX", "EX", ttl, function(err, res) {
    if (err || res)
      return callback(err, unlockOrExtend);

    setTimeout(function() {
      redisLock(lockName, ttl, callback);
    }, 200);
  });
}


function mongoGet(key, callback) {
  let expire = new Date(Date.now() - mongoTimeOffset);
  if (Array.isArray(key))
    mongoCollection.find({"_id": {"$in": key}}).toArray(function(err, res) {
      if (err)
        return callback(err);

      let indices = {};
      key.forEach(function(v, i) {
        indices[v] = i;
      });

      let values = [];
      res.forEach(function(r) {
        if (r["expire"] > expire)
          values[indices[r["_id"]]] = r["value"];
      });
      callback(null, values);
    });
  else
    mongoCollection.findOne({"_id": {"$in": [key]}}, function(err, res) {
      if (err || !res)
        return callback(err);

      if (res["expire"] > expire)
        return callback(null, res["value"]);

      callback();
    });
}


function mongoDel(key, callback) {
  if (Array.isArray(key))
    mongoCollection.remove({"_id": {"$in": key}}, callback);
  else
    mongoCollection.remove({"_id": key}, callback);
}


function mongoSet(key, value, ttl, callback) {
  if (!callback && typeof v === "function") {
    callback = ttl;
    ttl = null;
  }

  if (!ttl)
    ttl = MAX_CACHE_TTL;

  let expire = new Date((Date.now() - mongoTimeOffset) + (ttl * 1000));
  mongoCollection.save({"_id": key, "value": value, "expire": expire}, callback);
}


function mongoPop(key, callback) {
  mongoCollection.findAndModify({"_id": key}, null, null, {remove: true}, function(err, res) {
    if (err || !res["value"])
      return callback(err);

    if (res["value"]["expire"] > new Date(Date.now() - mongoTimeOffset))
      return callback(null, res["value"]["value"]);

    callback();
  });
}


function mongoLock(lockName, ttl, callback) {
  const token = Math.random().toString(36).slice(2);

  function unlockOrExtend(ttl) {
    if (!ttl) {
      mongoCollection.remove({"_id": lockName, "value": token}, function(err, res) {
        if (err || res["result"]["n"] !== 1)
          throw err || new Error("Lock expired");
      });
    }
    else {
      let expire = new Date((Date.now() - mongoTimeOffset) + (ttl * 1000));
      mongoCollection.update(
        {"_id": lockName, "value": token},
        {"expire": expire},
        function(err, res) {
          if (err || res["result"]["n"] !== 1)
            throw err | new Error("Lock expired");
        }
      );
    }
  }

  let expireTest = new Date(Date.now() - mongoTimeOffset);
  let expireSet = new Date((Date.now() - mongoTimeOffset) + (ttl * 1000));

  mongoCollection.update(
    {"_id": lockName, "expire": {"$lte": expireTest}},
    {"$set": {"value" : token, "expire": expireSet}},
    {upsert: true},
    function(err, res) {
      if (err && err.code === 11000)
        return setTimeout(function() {mongoLock(lockName, ttl, callback)}, 200);

      return callback(err, unlockOrExtend);
    }
  );
}


exports.connect = connect;
exports.disconnect = disconnect;
