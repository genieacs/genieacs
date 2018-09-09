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

class PathSet {
  constructor() {
    this.lengthIndex = [];
    this.fragmentIndex = [];
  }

  get depth() {
    return this.lengthIndex.length;
  }

  add(path) {
    const p = this.get(path);

    if (p) return p;

    while (this.lengthIndex.length <= path.length) {
      this.lengthIndex.push(new Set());
      this.fragmentIndex.push(new Map());
    }

    const lengthIndex = this.lengthIndex[path.length];
    lengthIndex.add(path);

    let wildcard = 0;
    for (let i = 0; i < path.length; ++i) {
      const fragment = path[i];
      if (fragment === "*") wildcard = wildcard | (1 << i);

      const fragmentIndex = this.fragmentIndex[i];

      let fragmentIndexSet = fragmentIndex.get(fragment);
      if (!fragmentIndexSet) {
        fragmentIndexSet = new Set();
        fragmentIndex.set(fragment, fragmentIndexSet);
      }

      fragmentIndexSet.add(path);
    }

    if (path.wildcard == null) {
      path.alias = 0;
      path.wildcard = wildcard;
      Object.freeze(path);
    }
    return path;
  }

  get(pattern) {
    const lengthIndex = this.lengthIndex[pattern.length];
    if (!lengthIndex || !lengthIndex.size) return null;

    if (lengthIndex.has(pattern)) return pattern;

    const sets = [lengthIndex];

    for (let i = 0; i < pattern.length; ++i) {
      const fragmentIndex = this.fragmentIndex[i];
      if (!fragmentIndex || !fragmentIndex.size) return null;

      const fragment = pattern[i];

      const fragmentIndexSet = fragmentIndex.get(fragment);
      if (!fragmentIndexSet) return null;

      sets.push(fragmentIndexSet);
    }

    sets.sort((a, b) => a.size - b.size);

    const smallestSet = sets.shift();
    for (let path of smallestSet) {
      for (const s of sets) {
        if (!s.has(path)) {
          path = null;
          break;
        }
      }

      if (path) return path;
    }

    return null;
  }

  find(pattern, superset = false, subset = false, depth = pattern.length) {
    const res = [];
    const groups = [[]];

    for (let i = pattern.length; i <= depth; ++i)
      if (this.lengthIndex[i]) groups[0].push(this.lengthIndex[i]);

    if (!groups[0].length) return res;

    for (let i = 0; i < pattern.length; ++i) {
      const fragmentIndex = this.fragmentIndex[i];
      if (!fragmentIndex) return res;

      const fragment = pattern[i];

      if (fragment === "*" && subset) continue;

      const g = [];

      const s = fragmentIndex.get(fragment);
      if (s) g.push(s);

      if (fragment !== "*" && superset && fragmentIndex.has("*"))
        g.push(fragmentIndex.get("*"));

      if (!g.length) return res;

      groups.push(g);
    }

    groups.sort(
      (a, b) =>
        a.reduce((prev, cur) => prev + cur.size, 0) -
        b.reduce((prev, cur) => prev + cur.size, 0)
    );

    const smallestGroup = groups.shift();
    for (const set of smallestGroup) {
      for (let path of set) {
        for (const group of groups) {
          let found = false;
          for (const s of group) {
            if (s.has(path)) {
              found = true;
              break;
            }
          }

          if (!found) {
            path = null;
            break;
          }
        }
        if (path) res.push(path);
      }
    }
    return res;
  }
}

module.exports = PathSet;
