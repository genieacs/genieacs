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

import { Collection } from "mongodb";
import { onConnect } from "./db";
import * as config from "./config";

const CLOCK_SKEW_TOLERANCE = 30000;
const MAX_CACHE_TTL = +config.get("MAX_CACHE_TTL");

let cacheCollection: Collection;

onConnect(async (db) => {
  cacheCollection = db.collection("cache");
  await cacheCollection.createIndex({ expire: 1 }, { expireAfterSeconds: 0 });
});

export async function get(key: string): Promise<string> {
  const res = await cacheCollection.findOne({ _id: key });
  if (res) return res["value"];
  return null;
}

export async function del(key: string): Promise<void> {
  await cacheCollection.deleteOne({ _id: key });
}

export async function set(
  key: string,
  value: string,
  ttl: number = MAX_CACHE_TTL
): Promise<void> {
  const timestamp = new Date();
  const expire = new Date(
    timestamp.getTime() + CLOCK_SKEW_TOLERANCE + ttl * 1000
  );
  await cacheCollection.replaceOne(
    { _id: key },
    { _id: key, value, expire, timestamp },
    { upsert: true }
  );
}

export async function pop(key: string): Promise<any> {
  const res = await cacheCollection.findOneAndDelete({ _id: key });
  if (res && res["value"]) return res["value"]["value"];
  return null;
}

export async function acquireLock(
  lockName: string,
  ttl: number,
  timeout = 0,
  token = Math.random().toString(36).slice(2)
): Promise<string> {
  try {
    const now = Date.now();
    const r = await cacheCollection.findOneAndUpdate(
      { _id: lockName, token },
      {
        $set: {
          value: token,
          expire: new Date(now + ttl + CLOCK_SKEW_TOLERANCE),
        },
        $currentDate: { timestamp: true },
      },
      { upsert: true, returnOriginal: false }
    );
    const v = r.value;
    if (Math.abs(v["timestamp"].getTime() - now) > CLOCK_SKEW_TOLERANCE)
      throw new Error("Database clock skew too great");
  } catch (err) {
    if (err.code === 11000) {
      if (timeout > 0) {
        return new Promise((resolve, reject) => {
          const w = 50 + Math.random() * 50;
          setTimeout(() => {
            acquireLock(lockName, ttl, timeout - w, token).then(
              resolve,
              reject
            );
          }, w);
        });
      }
      throw new Error("Failed to acquire lock");
    }
    throw err;
  }

  return token;
}

export async function releaseLock(
  lockName: string,
  token: string
): Promise<void> {
  const res = await cacheCollection.deleteOne({
    _id: lockName,
    value: token,
  });
  if (res["result"]["n"] !== 1) throw new Error("Lock expired");
}
