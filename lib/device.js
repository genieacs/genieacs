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

const common = require('./common');


const CHANGE_FLAGS = {
  object: 2,
  writable: 4,
  value: 8
};


function parseBool(v) {
  v = "" + v;
  if (v === "true" || v === "TRUE" || v === "True" || v === "1")
    return true;
  else if (v === "false" || v === "FALSE" || v === "False" || v === "0")
    return false;
  else
    return null;
}


function sanitizeParameterValue(parameterValue) {
  if (parameterValue[0] != null) {
    switch (parameterValue[1]) {
      case 'xsd:boolean':
        if (typeof parameterValue[0] !== 'boolean') {
          let v = parseBool(parameterValue[0]);
          if (v == null)
            v = '' + parameterValue[0];
          parameterValue[0] = v;
        }
        break;
      case 'xsd:string':
      case 'xsd:base64':
      case 'xsd:hexBinary':
        if (typeof parameterValue[0] !== 'string') {
          parameterValue[0] = '' + parameterValue[0];
        }
        break;
      case 'xsd:int':
      case 'xsd:unsignedInt':
        if (typeof parameterValue[0] !== 'number') {
          let v = parseInt(parameterValue[0]);
          if (isNaN(v))
            v = '' + parameterValue[0];
          parameterValue[0] = v;
        }
        break;
      case 'xsd:dateTime':
        if (typeof parameterValue[0] !== 'number') {
          // Don't use parseInt because it reads date string as a number
          let v = +parameterValue[0];
          if (isNaN(v)) {
            v = Date.parse(parameterValue[0]);
            if (isNaN(v))
              v = '' + parameterValue[0];
          }
          parameterValue[0] = v;
        }
        break;
      default:
        if (parameterValue[1] != null)
          throw new Error(`Parameter value type "${parameterValue[1]}" not recognized.`);

        parameterValue[0] = JSON.parse(JSON.stringify(parameterValue[0]));
        break;
    }
  }
  return parameterValue;
}


function getAliasDeclarations(path, timestamp) {
  var decs = [];

  function recursive(pattern, prefix) {
    var pattern = prefix.concat(pattern);

    for (let i = prefix.length; i < pattern.length; ++ i) {
      if (Array.isArray(pattern[i])) {
        let pat = pattern[i];
        pattern[i] = '*';
        for (let j = 0; j < pat.length; j += 2)
          recursive(pat[j], pattern.slice(0, i + 1));
      }
    }

    if (prefix.length)
      decs.push([pattern, timestamp, {value: timestamp}]);
    else
      decs.push([pattern, timestamp]);
  }

  recursive(path, []);

  return decs;
}


function unpack(deviceData, path, revision) {
  let allMatches = [];
  if (!path.alias) {
    for (let p of deviceData.paths.find(path, false, true))
      if (deviceData.attributes.has(p, revision))
        allMatches.push(p);
  }
  else {
    let wildcardPath = path.slice();
    wildcardPath.wildcard = path.wildcard;
    for (let i = 0; i < wildcardPath.length; ++ i)
      if (Array.isArray(wildcardPath[i])) {
        wildcardPath[i] = '*';
        wildcardPath.wildcard |= 1 << i;
      }

    for (let p of deviceData.paths.find(wildcardPath, false, true))
      if (deviceData.attributes.has(p, revision))
        allMatches.push(p);

    for (let i = path.length - 1; i >= 0; -- i) {
      if (Array.isArray(path[i])) {
        for (let j = 0; j < path[i].length; j += 2) {
          let p = wildcardPath.slice(0, i + 1).concat(path[i][j]);
          p.alias = (wildcardPath.alias & ((1 << (i + 1)) - 1)) + path[i][j].alias << (i + 1);
          p.wildcard = (wildcardPath.wildcard & ((1 << (i + 1)) - 1)) + path[i][j].wildcard << (i + 1);
          let unpacked = unpack(deviceData, p, revision);
          let filtered = [];
          for (let up of unpacked) {
            let attributes = deviceData.attributes.get(up, revision);
            if (attributes && attributes.value && attributes.value[1] &&
                sanitizeParameterValue([path[i][j + 1], attributes.value[1][1]])[0] === attributes.value[1][0]) {
              for (let m = 0; m < allMatches.length; ++ m) {
                let k;
                for (k = i; k >= 0; -- k)
                  if (allMatches[m][k] != up[k])
                    break

                if (k < 0) {
                  filtered.push(allMatches[m]);
                  allMatches[m] = [];
                }
              }
            }
          }
          allMatches = filtered;
        }
      }
    }
  }

  allMatches.sort(function(a, b) {
    for (let i = 0; i < a.length; ++ i) {
      if (a === b)
        continue;

      // Use numeric sorting for numbers
      let ia = parseInt(a), ib = parseInt(b);
      if (ia.toString() === a && ib.toString() === b) {
        a = ia;
        b = ib;
      }

      if (a < b)
        return -1;
      else
        return 1;
    }
    return 0;
  });

  return allMatches;
}


function clear(deviceData, path, timestamp, attributes, changeFlags = 0) {
  let changeTrackers = {};

  timestamp = timestamp || 0;

  let descendantsTimestamp = timestamp;
  if (attributes && attributes.object) {
    if (attributes.object > descendantsTimestamp)
      descendantsTimestamp = attributes.object;
    if (!(attributes.object <= attributes.value))
      attributes.value = attributes.object;
  }

  for (let p of deviceData.paths.find(path, true, true, descendantsTimestamp ? 99 : path.length)) {
    let tracker = deviceData.trackers.get(p);
    for (let k in tracker)
      changeTrackers[k] |= tracker[k];

    let currentTimestamp = deviceData.timestamps.get(p);
    if (currentTimestamp === undefined)
      continue;

    if (timestamp > currentTimestamp ||
      (descendantsTimestamp > currentTimestamp && p.length > path.length)) {
      deviceData.timestamps.delete(p);
      deviceData.attributes.delete(p);
      changeFlags |= 1;
    }
    else if (attributes && p.length == path.length) {
      let currentAttributes = deviceData.attributes.get(p);
      if (currentAttributes) {
        let newAttrs;
        for (let attrName in attributes) {
          if (attrName in currentAttributes &&
              attributes[attrName] > currentAttributes[attrName][0]) {
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
  for (let k in changeTrackers) {
    if (changeTrackers[k] & changeFlags)
      deviceData.changes.add(k);
  }
}


function compareEquality(a, b) {
  var t = typeof a;
  if (a === null ||
      a === undefined ||
      t === 'number' ||
      t === 'boolean' ||
      t === 'string' ||
      t === 'symbol')
    return a === b;

  return JSON.stringify(a) === JSON.stringify(b);
}


function set(deviceData, path, timestamp, attributes, toClear) {
  path = deviceData.paths.add(path);

  let currentTimestamp = deviceData.timestamps.get(path);

  let currentAttributes;

  if (path.wildcard)
    attributes = undefined;
  else if (currentTimestamp)
    currentAttributes = deviceData.attributes.get(path);

  let changeFlags = 0;

  if (attributes) {
    if (attributes.value && attributes.value[1]
        && attributes.value[0] >= (attributes.object ? attributes.object[0] : 0))
      attributes.object = [attributes.value[0], 0];

    if (attributes.object && attributes.object[1]
      && attributes.object[0] >= (attributes.value ? attributes.value[0] : 0))
      attributes.value = [attributes.object[0]];

    let newAttributes = Object.assign({}, currentAttributes, attributes);

    if (currentAttributes) {
      for (let attrName in attributes) {
        timestamp = Math.max(timestamp, attributes[attrName][0]);
        if (!(attrName in currentAttributes))
          changeFlags |= CHANGE_FLAGS[attrName];
        else if (attributes[attrName][0] <= currentAttributes[attrName][0])
          newAttributes[attrName] = currentAttributes[attrName];
        else if (!compareEquality(attributes[attrName][1], currentAttributes[attrName][1]))
          changeFlags |= CHANGE_FLAGS[attrName];
      }
    }
    else
      changeFlags |= 1;

    deviceData.attributes.set(path, newAttributes);

    if (!(timestamp <= currentTimestamp)) {
      deviceData.timestamps.set(path, timestamp);
      if (path.length > 1)
        toClear = set(deviceData, path.slice(0, path.length - 1), timestamp,
          {object: [timestamp, 1]}, toClear);
    }
  }
  else if (!(timestamp <= currentTimestamp)) {
    deviceData.timestamps.set(path, timestamp);

    if (currentAttributes) {
      deviceData.attributes.delete(path);
      changeFlags |= 1;
    }
    else if (path.wildcard) {
      for (let p of deviceData.paths.find(path, false, true, path.length))
        if (timestamp > deviceData.timestamps.get(p)) {
          toClear = toClear || [];
          toClear.push([p, timestamp]);
        }
    }
  }

  if (changeFlags) {
    if (changeFlags & 1) {
      toClear = toClear || [];
      toClear.push([path, timestamp, null, changeFlags]);
    }
    else if (changeFlags & CHANGE_FLAGS.object) {
      toClear = toClear || [];
      toClear.push([path, 0, {object: attributes.object[0]}, changeFlags]);
    }
    else {
      for (let p of deviceData.paths.find(path, true, false, path.length)) {
        let tracker = deviceData.trackers.get(p);
        for (let k in tracker) {
          if (tracker[k] & changeFlags)
            deviceData.changes.add(k);
        }
      }
    }
  }

  return toClear;
}


function track(deviceData, path, marker, attributes) {
  path = deviceData.paths.add(path);
  let f = 1;

  if (attributes)
    for (let attrName of attributes)
      f |= CHANGE_FLAGS[attrName];

  let cur = deviceData.trackers.get(path);
  if (!cur) {
    cur = {};
    deviceData.trackers.set(path, cur);
  }

  cur[marker] |= f;
}


function clearTrackers(deviceData, tracker) {
  if (Array.isArray(tracker)) {
    deviceData.trackers.forEach(function(v, k) {
      for (let t of tracker)
        delete v[t];
    });
    for (let t of tracker)
      deviceData.changes.delete(t);
  }
  else {
    deviceData.trackers.forEach(function(v, k) {
      delete v[tracker];
    });
    deviceData.changes.delete(tracker);
  }
}


exports.sanitizeParameterValue = sanitizeParameterValue;
exports.getAliasDeclarations = getAliasDeclarations;
exports.unpack = unpack;
exports.set = set;
exports.clear = clear;
exports.track = track;
exports.clearTrackers = clearTrackers;
