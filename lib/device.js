/**
 * Copyright 2013-2016  Zaid Abdulla
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


function sanitizeParameterValue(parameterValue) {
  if (parameterValue[0] != null) {
    switch (parameterValue[1]) {
      case 'xsd:boolean':
        if (typeof parameterValue[0] !== 'boolean') {
          parameterValue = parameterValue.slice();
          parameterValue[0] = !!JSON.parse(parameterValue[0]);
        }
        break;
      case 'xsd:string':
        if (typeof parameterValue[0] !== 'string') {
          parameterValue = parameterValue.slice();
          parameterValue[0] = '' + parameterValue[0];
        }
        break;
      case 'xsd:int':
      case 'xsd:unsignedInt':
        if (typeof parameterValue[0] !== 'number') {
          parameterValue = parameterValue.slice();
          parameterValue[0] = +parameterValue[0];
        }
        break;
      case 'xsd:dateTime':
        if (typeof parameterValue[0] !== 'number') {
          parameterValue = parameterValue.slice();
          if (parameterValue[0].getTime() != null)
            parameterValue[0] = parameterValue[0].getTime();
          else if (isNaN(parameterValue[0]))
            parameterValue[0] = Date.parse(parameterValue[0]);
          else
            parameterValue[0] = +parameterValue[0];
        }
        break;
      default:
        if (parameterValue[1] != null)
          throw new Error(`Parameter value type "${parameterValue[1]}" not recognized.`);

        parameterValue[0] = JSON.parse(JSON.stringify(parameterValue[0]));
    }
  }
  return parameterValue;
}


function inferTimestamps(deviceData, path) {
  common.addPathMeta(path);
  var res = {};

  for (let sup of deviceData.paths.superset(path)) {
    for (let attrName in deviceData.timestamps) {
      let t = deviceData.timestamps[attrName].get(sup);
      if (t && !(t < res[sup]))
        res[attrName] = t;
    }
  }

  for (let i = path.length - 1; i > 0; -- i) {
    if ((path.wildcard & ((1 << i) - 1)) == 0)
      break;

    let param = null;
    let ancestor = path.slice(0, i);
    let ancestorTimestamp = 0;
    for (let sup of deviceData.paths.superset(ancestor)) {
      if (!sup.wildcard)
        param = sup;

      let t = deviceData.timestamps.exist.get(sup);
      if (t > ancestorTimestamp)
        ancestorTimestamp = t;
    }

    if (param != null && deviceData.values.exist.get(param)) {
      if (deviceData.values.object.get(param) == 0) {
        let t = deviceData.timestamps.object.get(param);
        for (let attrName in deviceData.timestamps)
          if (!(t <= res[attrName]))
            res[attrName] = t;
      }
    }
    else if (ancestorTimestamp) {
      let newt = {};
      for (let attrName in deviceData.timestamps)
        newt[attrName] = ancestorTimestamp;

      for (let sub of deviceData.paths.subset(ancestor)) {
        if (sub.wildcard)
          continue;
        let subt = inferTimestamps(deviceData, sub.concat(path.slice(sub.length, path.length)));
        for (let attrName in newt) {
          if (!(attrName in subt))
            delete newt[attrName];
          else if (subt[attrName] < newt[attrName])
            newt[attrName] = subt[attrName];
        }
      }
      for (let attrName in newt)
        if (!(newt[attrName] <= res[attrName]))
          res[attrName] = newt[attrName];
    }
  }

  return res;
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
      decs.push([pattern, {exist: timestamp, value: timestamp}]);
    else
      decs.push([pattern, {exist: timestamp}]);
  }

  recursive(path, []);

  return decs;
}


function unpack(deviceData, path, revision) {
  let allMatches = [];
  if (path.alias == 0) {
    for (let p of deviceData.paths.subset(path, 0))
      if (deviceData.values.exist.get(p, revision))
        allMatches.push(p);
    return allMatches;
  }

  let wildcardPath = path.slice();
  wildcardPath.wildcard = path.wildcard;
  for (let i = 0; i < wildcardPath.length; ++ i)
    if (Array.isArray(wildcardPath[i])) {
      wildcardPath[i] = '*';
      wildcardPath.wildcard |= 1 << i;
    }

  for (let p of deviceData.paths.subset(wildcardPath, 0))
    if (deviceData.values.exist.get(p, revision))
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
          let v = deviceData.values.value.get(up, revision);
          if (v && sanitizeParameterValue([path[i][j + 1], v[1]])[0] == v[0]) {
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

  allMatches.sort(function(a, b) {
    for (let i = 0; i < a.length; ++ i) {
      if (a === b)
        continue;

      // Use numeric sorting for numbers
      let ia = parseInt(a), ib = parseInt(b);
      if (ia.toString() == a && ib.toString() == b) {
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


function invalidateSuperset(deviceData, path, attributes) {
  let depth = 0;
  if (attributes.exist != null)
    depth = 99;

  for (let sup of deviceData.paths.superset(path, 99)) {
    if (sup.wildcard == path.wildcard && sup.length == path.length)
      continue;

    for (let attrName in deviceData.timestamps) {
      let t = deviceData.timestamps[attrName].get(sup);
      if (t <= attributes[attrName] || t <= attributes.exist) {
        deviceData.timestamps[attrName].delete(sup);
        deviceData.values[attrName].delete(sup);
      }
    }
  }
}


function normalizeAttributes(timestamps, values) {
  if ('value' in values && timestamps.value >= (timestamps.object || 0)) {
    values.object = 0;
    timestamps.object = timestamps.value;
  }

  if (values.object && timestamps.object > (timestamps.value || 0)) {
    delete values.value;
    timestamps.value = timestamps.object;
  }

  if ('value' in values && timestamps.value >= (timestamps.exist || 0)) {
    values.exist = 1;
    timestamps.exist = timestamps.value;
  }

  if ('object' in values && timestamps.object >= (timestamps.exist || 0)) {
    values.exist = 1;
    timestamps.exist = timestamps.object;
  }

  if ('writable' in values && timestamps.writable >= (timestamps.exist || 0)) {
    values.exist = 1;
    timestamps.exist = timestamps.writable;
  }
}


function set(deviceData, path, timestamps, values) {
  path = deviceData.paths.add(path);
  if (path.wildcard || values == null)
    values = {};

  let toInvalidate = new Map();

  if (values.exist) {
    normalizeAttributes(timestamps, values);
    if (timestamps.exist && path.length > 1) {
      set(deviceData, path.slice(0, path.length - 1),
        {exist: timestamps.exist, object: timestamps.exist},
        {exist: 1, object: 1});
    }

    for (let attrName in timestamps) {
      if (deviceData.values[attrName].has(path) != (attrName in values)) {
        let inv = toInvalidate.get(path);
        if (inv == null)
          toInvalidate.set(path, inv = {});
        inv[attrName] = timestamps[attrName];
        if (!(attrName in values))
          deviceData.values[attrName].delete(path);
      }
    }
  }
  else {
    // Clear redundant timestamps
    let current = inferTimestamps(deviceData, path);
    for (let c in timestamps)
      if (timestamps[c] <= current[c])
        delete timestamps[c];
      else if (c != 'exist' &&
          (timestamps[c] <= timestamps.exist || timestamps[c] <= current.exist))
        delete timetamps[c];

    // Clear redundant subsets and deleted params
    for (let sub of deviceData.paths.subset(path)) {
      if (path.wildcard == sub.wildcard)
        continue;

      if (deviceData.values.exist.has(sub)) {
        let existTimestamp = deviceData.timestamps.exist.get(sub);
        for (let attrName in timestamps) {
          if (timestamps[attrName] > existTimestamp) {
            let inv = toInvalidate.get(sub);
            if (inv == null)
              toInvalidate.set(sub, inv = {});
            for (let attrName in deviceData.timestamps) {
              inv[attrName] = timestamps[attrName];
              deviceData.timestamps[attrName].delete(sub);
              deviceData.values[attrName].delete(sub);
            }
            break;
          }

          if (timestamps[attrName] > deviceData.timestamps[attrName].get(sub))
            if (deviceData.values[attrName].has(sub)) {
              let inv = toInvalidate.get(sub);
              if (inv == null)
                toInvalidate.set(sub, inv = {});
              inv[attrName] = timestamps[attrName];
              deviceData.values[attrName].delete(sub);
            }
        }
      }
      else {
        for (let attrName in timestamps) {
          if (attrName == 'exist') {
            for (let an in deviceData.timestamps)
              if (timestamps[attrName] > deviceData.timestamps[an].get(sub))
                deviceData.timestamps[an].delete(sub);
            continue;
          }

          if (timestamps[attrName] > deviceData.timestamps[attrName].get(sub))
            deviceData.timestamps[attrName].delete(sub);
        }
      }
    }
  }

  toInvalidate.forEach(function(a, p) {
    invalidateSuperset(deviceData, p, a);
  });

  for (let attrName in timestamps) {
    deviceData.timestamps[attrName].set(path, timestamps[attrName]);
    if (attrName in values)
      deviceData.values[attrName].set(path, values[attrName]);
  }
}


exports.sanitizeParameterValue = sanitizeParameterValue;
exports.getAliasDeclarations = getAliasDeclarations;
exports.inferTimestamps = inferTimestamps;
exports.unpack = unpack;
exports.set = set;
