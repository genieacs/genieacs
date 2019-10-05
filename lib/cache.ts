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

import { MongoClient, Collection } from "mongodb";
import * as config from "./config";

const MAX_CACHE_TTL = +config.get("MAX_CACHE_TTL");

let clientPromise: Promise<MongoClient>;
let mongoCollection: Collection;
let mongoTimeOffset = 0;

export async function connect(): Promise<void> {
  const MONGODB_CONNECTION_URL = "" + config.get("MONGODB_CONNECTION_URL");
  clientPromise = MongoClient.connect(MONGODB_CONNECTION_URL, {
    useNewUrlParser: true
  });
  const db = (await clientPromise).db();
  mongoCollection = db.collection("cache");
  await mongoCollection.createIndex({ expire: 1 }, { expireAfterSeconds: 0 });
  const now = Date.now();
  const res = await db.command({ hostInfo: 1 });
  mongoTimeOffset = res.system.currentTime.getTime() - now;
}

export async function disconnect(): Promise<void> {
  if (clientPromise) await (await clientPromise).close();
}

export async function get(key): Promise<any> {
  const expire = new Date(Date.now() - mongoTimeOffset);
  if (Array.isArray(key)) {
    const res = await mongoCollection.find({ _id: { $in: key } }).toArray();

    const indices = {};
    key.forEach((v, i) => {
      indices[v] = i;
    });

    const values = [];
    res.forEach(r => {
      if (r["expire"] > expire) values[indices[r["_id"]]] = r["value"];
    });

    return values;
  } else {
    const res = await mongoCollection.findOne({ _id: { $in: [key] } });
    if (res && res["expire"] > expire) return res["value"];
    return null;
  }
}

export async function del(key): Promise<void> {
  if (Array.isArray(key))
    await mongoCollection.deleteMany({ _id: { $in: key } });
  else await mongoCollection.deleteOne({ _id: key });
}

export async function set(
  key: string,
  value: string | number,
  ttl: number = MAX_CACHE_TTL
): Promise<void> {
  const expire = new Date(Date.now() - mongoTimeOffset + ttl * 1000);
  await mongoCollection.replaceOne(
    { _id: key },
    { _id: key, value: value, expire: expire },
    { upsert: true }
  );
}

export async function pop(key): Promise<any> {
  const res = await mongoCollection.findOneAndDelete({ _id: key });

  if (
    res &&
    res["value"] &&
    +res["value"]["expire"] - (Date.now() - mongoTimeOffset)
  )
    return res["value"]["value"];

  return null;
}

export async function lock(lockName, ttl): Promise<Function> {
  const token = Math.random()
    .toString(36)
    .slice(2);

  async function unlockOrExtend(extendTtl): Promise<void> {
    if (!extendTtl) {
      const res = await mongoCollection.deleteOne({
        _id: lockName,
        value: token
      });
      if (res["result"]["n"] !== 1) throw new Error("Lock expired");
    } else {
      const expire = new Date(Date.now() - mongoTimeOffset + extendTtl * 1000);
      const res = await mongoCollection.updateOne(
        { _id: lockName, value: token },
        { expire: expire }
      );
      if (res["result"]["n"] !== 1) throw new Error("Lock expired");
    }
  }

  const expireTest = new Date(Date.now() - mongoTimeOffset);
  const expireSet = new Date(Date.now() - mongoTimeOffset + ttl * 1000);

  try {
    await mongoCollection.updateOne(
      { _id: lockName, expire: { $lte: expireTest } },
      { $set: { value: token, expire: expireSet } },
      { upsert: true }
    );
  } catch (err) {
    if (err && err.code === 11000) {
      await new Promise(resolve => setTimeout(resolve, 200));
      return lock(lockName, ttl);
    }
  }

  return unlockOrExtend;
}
