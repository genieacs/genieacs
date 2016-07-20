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
  var res = {};

  for (let sup of deviceData.paths.superset(path)) {
    for (let attrName in deviceData.timestamps) {
      let t = deviceData.timestamps[attrName].get(sup);
      if (t && !(t < res[sup]))
        res[attrName] = t;
    }
  }

  for (let i = path.length - 1; i > 0; -- i) {
    if (path.wildcard & ((2 << i) - 1) === 0)
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

  return allMatches;
}


function invalidateSuperset(deviceData, path, attributes) {
  throw new Error('Not implemented');
}


function normalizeAttributes(timestamps, values) {
  // TODO Consider moving implemention within set function
  if (!values)
    return;

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
  // TODO Optimize
  // TODO Allow overwriting attribute value with same timestamp
  path = deviceData.paths.add(path);

  if (!path.wildcard) {
    normalizeAttributes(timestamps, values);
    if (values.exist && path.length > 1)
      set(deviceData, path.slice(0, path.length - 1),
        {exist: timestamps.exist, object: timestamps.exist},
        {exist: 1, object: 1});
  }

  var current = inferTimestamps(deviceData, path);

  for (let c in current)
    if (current[c] > timestamps[c] || (current[c] == timestamps[c] && path.wildcard > 0))
      delete timestamps[c];

  if (timestamps.exist != null) {
    deviceData.timestamps.exist.set(path, timestamps.exist);
    if (values != null && values.exist != null)
      deviceData.values.exist.set(path, values.exist);
  }

  current = inferTimestamps(deviceData, path);

  for (let c in current)
    if (current[c] > timestamps[c] || (current[c] == timestamps[c] && path.wildcard > 0))
      delete timestamps[c];

  let toInvalidate = new Map();

  for (let sub of deviceData.paths.subset(path, 0)) {
    if (path.wildcard == sub.wildcard)
      continue;

    for (let attrName in timestamps) {
      if (deviceData.timestamps[attrName].get(sub) <= timestamps[attrName]) {

        if (sub.wildcard || !deviceData.values[attrName].has(sub))
          deviceData.timestamps[attrName].delete(sub);
        else if (deviceData.timestamps[attrName].get(sub) < timestamps[attrName]) {
          deviceData.timestamps[attrName].delete(sub);
          deviceData.values[attrName].delete(sub);
          let inv = toInvalidate.get(sub) || {};
          if (!timestamps[attrName] <= inv[attrName]) {
            inv[attrName] = timestamps[attrName];
            toInvalidate.set(sub, inv);
          }
        }
      }
    }
  }

  for (let attrName in timestamps) {
    let existing = deviceData.timestamps[attrName].get(path);

    if (existing == null || timestamps[attrName] >= existing) {
      deviceData.timestamps[attrName].set(path, timestamps[attrName]);
      let invalidate = false;
      if (values[attrName] != null) {
        if (!deviceData.values[attrName].has(path))
          invalidate = true;
        deviceData.values[attrName].set(path, values[attrName]);
      }
      else {
        if (deviceData.values[attrName].has(path))
          invalidate = true;
        deviceData.values[attrName].delete(path)
      }

      if (invalidate) {
        let inv = toInvalidate.get(path) || {};
        if (!timestamps[attrName] <= inv[attrName]) {
          inv[attrName] = timestamps[attrName];
          toInvalidate.set(sub, inv);
        }
      }
    }
  }

  toInvalidate.forEach(function(p, a) {
    invalidateSuperset(deviceData, p, a);
  });

  // TODO recalculate descendant superset
  // var depth = 0;
  // if (timestamps.exist != null)
  //   depth = 99;
  //
  // for (let sup of deviceData.paths.superset(path, depth)) {
  //   if ((sup.wildcard && (3 << path.length) - 1) != path.wildcard) {
  //     throw new Error('Not implemented');
  //   }
  // }
}


exports.sanitizeParameterValue = sanitizeParameterValue;
exports.getAliasDeclarations = getAliasDeclarations;
exports.inferTimestamps = inferTimestamps;
exports.unpack = unpack;
exports.set = set;
