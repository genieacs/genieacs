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


class InstanceSet {

  constructor() {
    this.set = new Set();
  }

  add(instance) {
    this.set.add(instance);
  }

  delete(instance) {
    this.set.delete(instance);
  }

  superset(instance) {
    let res = [];
    for (let inst of this.set) {
      let match = true;
      for (let k in instance) {
        if (inst[k] !== instance[k]) {
          match = false;
          break;
        }
      }

      if (match)
        res.push(inst);
    }

    res.sort(function(a, b) {
      let keysA = Object.keys(a);
      let keysB = Object.keys(b);

      if (keysA.length != keysB.length)
        return keysB.length - keysA.length;

      keysA.sort();
      keysB.sort();

      for (let i = 0; i < keysA.length; ++ i) {
        if (keysA[i] > keysB[i])
          return 1;
        else if (keysA[i] < keysB[i])
          return -1;
        else if (a[keysA[i]] > b[keysB[i]])
          return 1;
        else if (a[keysA[i]] < b[keysB[i]])
          return -1;
      }

      return 0;
    });

    return res;
  }

  subset(instance) {
    let res = [];

    for (let inst of this.set) {
      let match = true;
      for (let k in inst) {
        if (inst[k] !== instance[k]) {
          match = false;
          break;
        }
      }

      if (match)
        res.push(inst);
    }

    res.sort(function(a, b) {
      let keysA = Object.keys(a);
      let keysB = Object.keys(b);

      if (keysA.length != keysB.length)
        return keysA.length - keysB.length;

      keysA.sort();
      keysB.sort();

      for (let i = 0; i < keysA.length; ++ i) {
        if (keysA[i] > keysB[i])
          return 1;
        else if (keysA[i] < keysB[i])
          return -1;
        else if (a[keysA[i]] > b[keysB[i]])
          return 1;
        else if (a[keysA[i]] < b[keysB[i]])
          return -1;
      }

      return 0;
    });

    return res;
  }

  forEach(callback) {
    return this.set.forEach(callback);
  }

  values() {
    return this.set.values();
  }

  clear() {
    this.set.clear();
  }

  get size() {
    return this.set.size;
  }
}

module.exports = InstanceSet;
