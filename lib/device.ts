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

import Path from "./common/path";
import { DeviceData, Declaration, Clear } from "./types";

const CHANGE_FLAGS = {
  object: 2,
  writable: 4,
  value: 8
};

function parseBool(v): boolean {
  v = "" + v;
  if (v === "true" || v === "TRUE" || v === "True" || v === "1") return true;
  else if (v === "false" || v === "FALSE" || v === "False" || v === "0")
    return false;
  else return null;
}

export function sanitizeParameterValue(
  parameterValue: [string | number | boolean, string]
): [string | number | boolean, string?] {
  if (parameterValue[0] != null) {
    switch (parameterValue[1]) {
      case "xsd:boolean":
        if (typeof parameterValue[0] !== "boolean") {
          const b = parseBool(parameterValue[0]);
          if (b == null) parameterValue[0] = "" + parameterValue[0];
          else parameterValue[0] = b;
        }
        break;
      case "xsd:string":
      case "xsd:base64":
      case "xsd:hexBinary":
        if (typeof parameterValue[0] !== "string")
          parameterValue[0] = "" + parameterValue[0];

        break;
      case "xsd:int":
      case "xsd:unsignedInt":
        if (typeof parameterValue[0] !== "number") {
          const i = parseInt(parameterValue[0] as string);
          if (isNaN(i)) parameterValue[0] = "" + parameterValue[0];
          else parameterValue[0] = i;
        }
        break;
      case "xsd:dateTime":
        if (typeof parameterValue[0] !== "number") {
          // Don't use parseInt because it reads date string as a number
          let i = +parameterValue[0];
          if (isNaN(i)) {
            i = Date.parse(parameterValue[0] as string);
            if (isNaN(i)) parameterValue[0] = "" + parameterValue[0];
            else parameterValue[0] = i;
          } else {
            parameterValue[0] = i;
          }
        }
        break;
      default:
        parameterValue[0] = JSON.parse(JSON.stringify(parameterValue[0]));
        break;
    }
  }

  return parameterValue;
}

export function getAliasDeclarations(
  path: Path,
  timestamp: number,
  attrGet = null
): Declaration[] {
  const stripped = path.stripAlias();
  let decs: Declaration[] = [
    {
      path: stripped,
      pathGet: timestamp,
      pathSet: null,
      attrGet: attrGet,
      attrSet: null,
      defer: true
    }
  ];

  if (path.alias) {
    for (const [i, alias] of path.segments.entries()) {
      if (Array.isArray(alias)) {
        const parent = stripped.slice(0, i + 1);
        for (const [p] of alias as [Path, string][]) {
          decs = decs.concat(
            getAliasDeclarations(parent.concat(p), timestamp, {
              value: timestamp
            })
          );
        }
      }
    }
  }

  return decs;
}

export function unpack(
  deviceData: DeviceData,
  path: Path,
  revision?: number
): Path[] {
  let allMatches = [] as Path[];
  if (!path.alias) {
    for (const p of deviceData.paths.find(path, false, true))
      if (deviceData.attributes.has(p, revision)) allMatches.push(p);
  } else {
    const wildcardPath = path.stripAlias();

    for (const p of deviceData.paths.find(wildcardPath, false, true))
      if (deviceData.attributes.has(p, revision)) allMatches.push(p);

    for (let i = path.length - 1; i >= 0; --i) {
      if (path.alias & (1 << i)) {
        for (const [param, val] of path.segments[i] as [Path, string][]) {
          const p = wildcardPath.slice(0, i + 1).concat(param);
          const unpacked = unpack(deviceData, p, revision);
          const filtered: Path[] = [];
          for (const up of unpacked) {
            const attributes = deviceData.attributes.get(up, revision);
            if (
              attributes &&
              attributes.value &&
              attributes.value[1] &&
              sanitizeParameterValue([val, attributes.value[1][1]])[0] ===
                attributes.value[1][0]
            ) {
              for (let m = 0; m < allMatches.length; ++m) {
                let k;
                const match = allMatches[m];
                if (!match) continue;
                for (k = i; k >= 0; --k)
                  if (match.segments[k] !== up.segments[k]) break;

                if (k < 0) {
                  filtered.push(match);
                  allMatches[m] = null;
                }
              }
            }
          }
          allMatches = filtered;
        }
      }
    }
  }

  allMatches.sort((p1, p2) => {
    for (let i = 0; i < p1.length; ++i) {
      const a = p1.segments[i] as string;
      const b = p2.segments[i] as string;
      if (a !== b) {
        // Use numeric sorting for numbers
        const ia = parseInt(a);
        const ib = parseInt(b);

        if (ia === +a && ib === +b) return ia - ib;
        else if (a < b) return -1;
        else return 1;
      }
    }
    return 0;
  });

  return allMatches;
}

export function clear(
  deviceData,
  path,
  timestamp,
  attributes,
  changeFlags = 0
): void {
  const changeTrackers = {};

  timestamp = timestamp || 0;

  let descendantsTimestamp = timestamp;
  if (attributes && attributes.object) {
    if (attributes.object > descendantsTimestamp)
      descendantsTimestamp = attributes.object;
    if (!(attributes.object <= attributes.value))
      attributes.value = attributes.object;
  }

  for (const p of deviceData.paths.find(
    path,
    true,
    true,
    descendantsTimestamp ? 99 : path.length
  )) {
    const tracker = deviceData.trackers.get(p);
    for (const k in tracker) changeTrackers[k] |= tracker[k];

    const currentTimestamp = deviceData.timestamps.get(p);
    if (currentTimestamp === undefined) continue;

    if (
      timestamp > currentTimestamp ||
      (descendantsTimestamp > currentTimestamp && p.length > path.length)
    ) {
      deviceData.timestamps.delete(p);
      deviceData.attributes.delete(p);
      changeFlags |= 1;
    } else if (attributes && p.length === path.length) {
      const currentAttributes = deviceData.attributes.get(p);
      if (currentAttributes) {
        let newAttrs;
        for (const attrName in attributes) {
          if (
            attrName in currentAttributes &&
            attributes[attrName] > currentAttributes[attrName][0]
          ) {
            changeFlags |= CHANGE_FLAGS[attrName];
            if (!newAttrs) {
              newAttrs = Object.assign({}, currentAttributes);
              deviceData.attributes.set(p, newAttrs);
            }
            delete newAttrs[attrName];
          }
        }
      }
    }
  }

  // Note: For performance, we're merging all changes together rather than
  // mark changes based the exact parameters affected.
  for (const k in changeTrackers)
    if (changeTrackers[k] & changeFlags) deviceData.changes.add(k);
}

function compareEquality(a, b): boolean {
  const t = typeof a;
  if (
    a === null ||
    a === undefined ||
    t === "number" ||
    t === "boolean" ||
    t === "string" ||
    t === "symbol"
  )
    return a === b;

  return JSON.stringify(a) === JSON.stringify(b);
}

export function set(
  deviceData: DeviceData,
  path: Path,
  timestamp,
  attributes,
  toClear?: Clear[]
): Clear[] {
  path = deviceData.paths.add(path);

  const currentTimestamp = deviceData.timestamps.get(path);

  let currentAttributes;

  if (path.wildcard) attributes = undefined;
  else if (currentTimestamp)
    currentAttributes = deviceData.attributes.get(path);

  let changeFlags = 0;

  if (attributes) {
    if (
      attributes.value &&
      attributes.value[1] &&
      attributes.value[0] >= (attributes.object ? attributes.object[0] : 0)
    )
      attributes.object = [attributes.value[0], 0];

    if (
      attributes.object &&
      attributes.object[1] &&
      attributes.object[0] >= (attributes.value ? attributes.value[0] : 0)
    )
      attributes.value = [attributes.object[0]];

    const newAttributes = Object.assign({}, currentAttributes, attributes);

    if (currentAttributes) {
      for (const attrName in attributes) {
        timestamp = Math.max(timestamp, attributes[attrName][0]);
        if (!(attrName in currentAttributes))
          changeFlags |= CHANGE_FLAGS[attrName];
        else if (attributes[attrName][0] <= currentAttributes[attrName][0])
          newAttributes[attrName] = currentAttributes[attrName];
        else if (
          !compareEquality(
            attributes[attrName][1],
            currentAttributes[attrName][1]
          )
        )
          changeFlags |= CHANGE_FLAGS[attrName];
      }
    } else {
      changeFlags |= 1;
    }

    deviceData.attributes.set(path, newAttributes);

    if (!(timestamp <= currentTimestamp)) {
      deviceData.timestamps.set(path, timestamp);
      if (path.length > 1) {
        toClear = set(
          deviceData,
          path.slice(0, path.length - 1),
          timestamp,
          { object: [timestamp, 1] },
          toClear
        );
      }
    }
  } else if (!(timestamp <= currentTimestamp)) {
    deviceData.timestamps.set(path, timestamp);

    if (currentAttributes) {
      deviceData.attributes.delete(path);
      changeFlags |= 1;
    } else if (path.wildcard) {
      for (const p of deviceData.paths.find(path, false, true, path.length)) {
        if (timestamp > deviceData.timestamps.get(p)) {
          toClear = toClear || [];
          toClear.push([p, timestamp]);
        }
      }
    }
  }

  if (changeFlags) {
    if (changeFlags & 1) {
      toClear = toClear || [];
      toClear.push([path, timestamp, null, changeFlags]);
    } else if (changeFlags & CHANGE_FLAGS.object) {
      toClear = toClear || [];
      toClear.push([path, 0, { object: attributes.object[0] }, changeFlags]);
    } else {
      for (const p of deviceData.paths.find(path, true, false, path.length)) {
        const tracker = deviceData.trackers.get(p);
        for (const k in tracker)
          if (tracker[k] & changeFlags) deviceData.changes.add(k);
      }
    }
  }

  return toClear;
}

export function track(
  deviceData: DeviceData,
  path: Path,
  marker: string,
  attributes?
): void {
  path = deviceData.paths.add(path);
  let f = 1;

  if (attributes)
    for (const attrName of attributes) f |= CHANGE_FLAGS[attrName];

  let cur = deviceData.trackers.get(path);
  if (!cur) {
    cur = {};
    deviceData.trackers.set(path, cur);
  }

  cur[marker] |= f;
}

export function clearTrackers(deviceData: DeviceData, tracker): void {
  if (Array.isArray(tracker)) {
    for (const v of deviceData.trackers.values())
      for (const t of tracker) delete v[t];
    for (const t of tracker) deviceData.changes.delete(t);
  } else {
    for (const v of deviceData.trackers.values()) delete v[tracker];
    deviceData.changes.delete(tracker);
  }
}
