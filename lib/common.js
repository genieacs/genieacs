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
"use strict";

export const UNDEFINED_TYPE = "[object Undefined]";
export const NULL_TYPE = "[object Null]";
export const BOOLEAN_TYPE = "[object Boolean]";
export const NUMBER_TYPE = "[object Number]";
export const STRING_TYPE = "[object String]";
export const ARRAY_TYPE = "[object Array]";
export const OBJECT_TYPE = "[object Object]";
export const REGEXP_TYPE = "[object RegExp]";
export const DATE_TYPE = "[object Date]";

export const typeOf = obj => Object.prototype.toString.call(obj);

export function generateDeviceId(deviceIdStruct) {
  // Escapes everything except alphanumerics and underscore
  function esc(str) {
    return str.replace(/[^A-Za-z0-9_]/g, chr => {
      const buf = Buffer.from(chr, "utf8");
      let rep = "";
      for (const b of buf) rep += "%" + b.toString(16).toUpperCase();
      return rep;
    });
  }

  // Guaranteeing globally unique id as defined in TR-069
  if (deviceIdStruct["ProductClass"]) {
    return (
      esc(deviceIdStruct["OUI"]) +
      "-" +
      esc(deviceIdStruct["ProductClass"]) +
      "-" +
      esc(deviceIdStruct["SerialNumber"])
    );
  }
  return esc(deviceIdStruct["OUI"]) + "-" + esc(deviceIdStruct["SerialNumber"]);
}

export function parseAlias(pattern, start, res) {
  const aliases = [];
  let i = start;
  while (i < pattern.length && pattern[i] !== "]") {
    const alias = [];
    let j = (i = parsePath(pattern, i, alias) + 1);
    while (pattern[j] !== "]" && pattern[j] !== ",") {
      if (pattern[j] === '"' && i === j) {
        ++j;
        while (pattern[j] !== '"' || pattern[j - 1] === "\\") {
          if (++j >= pattern.length)
            throw new Error("Invalid alias expression");
        }
      }
      if (++j >= pattern.length) throw new Error("Invalid alias expression");
    }

    let value = pattern.slice(i, j).trim();
    i = j;
    if (value[0] === '"') {
      try {
        value = JSON.parse(value);
      } catch (error) {
        throw new Error("Invalid alias expression");
      }
    }

    alias.push(value);
    aliases.push(alias);
    if (pattern[i] === ",") ++i;
  }

  // Sort to ensure identical expressions have idential string representation
  function srt(a, b) {
    const jMax = Math.min(a.length, b.length);
    for (let j = 0; j < jMax; j += 2) {
      const kMax = Math.min(a[j].length, b[j].length);
      for (let k = 0; k < kMax; ++k) {
        if (Array.isArray(a[j][k])) {
          if (Array.isArray(b[j][k])) return srt(a[j][k], b[j][k]);
          else if (b[j][k] == null) return -1;
          else return 1;
        } else if (a[j][k] == null) {
          if (b[j][k] == null) return 0;
          else return 1;
        } else if (b[j][k] == null || Array.isArray(b[j][k])) {
          return -1;
        } else if (a[j][k] > b[j][k]) {
          return 1;
        } else if (a[j][k] < b[j][k]) {
          return -1;
        }
      }

      if (a[j].length > b[j].length) return -1;
      else if (a[j].length < b[j].length) return 1;

      if (a[j + 1] > b[j + 1]) return -1;
      else if (a[j + 1] < b[j + 1]) return 1;
    }

    if (a.length > b.length) return -1;
    else if (a.length < b.length) return 1;

    return 0;
  }

  aliases.sort(srt);
  res.push([].concat.apply([], aliases));
  return i;
}

export function parsePath(pattern, start, res) {
  const path = [];
  path.wildcard = 0;
  path.alias = 0;
  let i = start || 0;

  // Colon separator is needed for parseAlias
  if (i < pattern.length && pattern[i] !== ":") {
    for (;;) {
      if (pattern[i] === "[") {
        path.alias |= 1 << path.length;
        i = parseAlias(pattern, i + 1, path) + 1;
      } else {
        const j = i;
        while (i < pattern.length && pattern[i] !== ":" && pattern[i] !== ".")
          ++i;

        const n = pattern.slice(j, i);
        if (n === "*") path.wildcard |= 1 << path.length;
        path.push(n);
      }

      if (i >= pattern.length || pattern[i] === ":") break;
      else if (pattern[i] !== ".") throw new Error("Invalid alias expression");

      ++i;
    }
  }

  Object.freeze(path);

  if (res == null) return path;

  res.push(path);
  return i;
}

export function addPathMeta(path) {
  if (path.alias != null && path.wildcard != null) return path;

  path.alias = 0;
  path.wildcard = 0;

  for (const [i, p] of path.entries()) {
    if (Array.isArray(p)) {
      path.alias |= 1 << i;
      for (let j = 0; j < p.length; j += 2) addPathMeta(p[j]);
    } else if (p === "*") {
      path.wildcard |= 1 << i;
    }
  }

  Object.freeze(path);
  return path;
}

// Source: http://stackoverflow.com/a/6969486
export function escapeRegExp(str) {
  return str.replace(/[-[\]/{}()*+?.\\^$|]/g, "\\$&");
}
