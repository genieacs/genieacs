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


import * as config from "./config";
import * as redis from 'redis'
import * as logger from "./logger";

const redisClient = redis.createClient({
  url: config.get('REDIS_CONNECTION_URL') as string
});


redisClient.connect()
.then(()=>{
  logger.info({
    message:'Connected to redis server'
  })
})
.catch((reason) => {
  logger.error({
    message: reason
  })
});


const CLOCK_SKEW_TOLERANCE = 30000;
const MAX_CACHE_TTL = +config.get("MAX_CACHE_TTL");

export async function get(key: string): Promise<string> {
  return redisClient.get(key);
}

export async function del(key: string): Promise<void> {
  await redisClient.del(key);
}

export async function set(
  key: string,
  value: string,
  ttl_s: number = MAX_CACHE_TTL
): Promise<void> {
  //const timestamp = new Date();
  //const expire = new Date(
  //  timestamp.getTime() + CLOCK_SKEW_TOLERANCE + ttl * 1000
  //);
  //await cacheCollection.replaceOne(
  //  { _id: key },
  //  { value, expire, timestamp },
  //  { upsert: true }
  //);
  await redisClient
    .multi()
    .set(key, value)
    .expire(key, ttl_s + CLOCK_SKEW_TOLERANCE/1000)
    .exec()
}

export async function pop(key: string): Promise<string> {
  return redisClient.getDel(key)
}

export async function acquireLock(
  lockName: string,
  ttl_ms: number,
  timeout = 0,
  token = Math.random().toString(36).slice(2)
): Promise<string> {
  const key = `${lockName}@${token}`;
  let exists = ((await redisClient.exists(key)) === 1)
  
  while (exists && timeout>0 ) {
    const t = Date.now();
    const w = 50 + Math.random() * 50;
    await new Promise((resolve) => setTimeout(resolve, w));
    exists = ((await redisClient.exists(key)) === 1);
    timeout -= (Date.now() - t);
  }

  if (!(timeout >= 0)) return null;

  await set(key, token, Math.ceil(ttl_ms/1000) )

  return token;
}

export async function releaseLock(
  lockName: string,
  token: string
): Promise<void> {
  const key = `${lockName}@${token}`;
  const deletedCount = await redisClient.del(key);
  if (deletedCount !== 1) throw new Error(`Lock ${key} expired`);
}
