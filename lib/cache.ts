import { collections } from "./db/db.ts";
import * as config from "./config.ts";

const CLOCK_SKEW_TOLERANCE = 30000;
const MAX_CACHE_TTL = +config.get("MAX_CACHE_TTL");

export async function get(key: string): Promise<string> {
  const res = await collections.cache.findOne({ _id: key });
  return res?.value;
}

export async function del(key: string): Promise<void> {
  await collections.cache.deleteOne({ _id: key });
}

export async function set(
  key: string,
  value: string,
  ttl: number = MAX_CACHE_TTL,
): Promise<void> {
  const timestamp = new Date();
  const expire = new Date(
    timestamp.getTime() + CLOCK_SKEW_TOLERANCE + ttl * 1000,
  );
  await collections.cache.replaceOne(
    { _id: key },
    { value, expire, timestamp },
    { upsert: true },
  );
}

export async function pop(key: string): Promise<string> {
  const res = await collections.cache.findOneAndDelete({ _id: key });
  return res.value?.value;
}
