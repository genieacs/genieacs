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

let cache1 = new Map();
let cache2 = new Map();
const keys = new WeakMap();

function getKey(obj): string {
  if (obj === null) return "null";
  else if (obj === undefined) return "undefined";

  const t = typeof obj;
  if (t === "number" || t === "boolean" || t === "string") return `${t}:${obj}`;
  if (t !== "function" && t !== "object")
    throw new Error(`Cannot memoize ${t} arguments`);

  let k = keys.get(obj);
  if (!k) {
    const rnd = Math.trunc(Math.random() * Number.MAX_SAFE_INTEGER);
    k = `${t}:${rnd.toString(36)}`;
    keys.set(obj, k);
  }
  return k;
}

export default function memoize<T extends Function>(func: T): T {
  const funcKey = getKey(func);
  return ((...args) => {
    const key = JSON.stringify(args.map(getKey)) + funcKey;

    if (cache1.has(key)) return cache1.get(key);

    let r;
    if (cache2.has(key)) r = cache2.get(key);
    else r = func(...args);
    cache1.set(key, r);
    return r;
  }) as any;
}

const interval = setInterval(() => {
  cache2 = cache1;
  cache1 = new Map();
}, 120000);

// Don't hold Node.js process
if (interval.unref) interval.unref();
