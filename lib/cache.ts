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

import { collections } from "./db/db";
import * as config from "./config";

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
