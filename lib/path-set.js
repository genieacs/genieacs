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

    if (!this.lengthIndex[path.length])
      this.lengthIndex[path.length] = new Set();

    this.lengthIndex[path.length].add(path);

    let wildcard = 0;
    for (let i = 0; i < path.length; ++i) {
      const fragment = path[i];
      if (fragment === "*") wildcard = wildcard | (1 << i);

      if (!this.fragmentIndex[i]) this.fragmentIndex[i] = {};

      if (!this.fragmentIndex[i][fragment])
        this.fragmentIndex[i][fragment] = new Set();

      this.fragmentIndex[i][fragment].add(path);
    }

    if (path.wildcard == null) {
      path.alias = 0;
      path.wildcard = wildcard;
      Object.freeze(path);
    }
    return path;
  }

  get(pattern) {
    if (!this.lengthIndex[pattern.length]) return null;

    if (this.lengthIndex[pattern.length].has(pattern)) return pattern;

    const sets = [];

    sets.push(this.lengthIndex[pattern.length]);

    for (let i = 0; i < pattern.length; ++i) {
      if (!this.fragmentIndex[i]) return null;

      const fragment = pattern[i];

      if (!this.fragmentIndex[i][fragment]) return null;

      sets.push(this.fragmentIndex[i][fragment]);
    }

    sets.sort((a, b) => {
      return a.size - b.size;
    });

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
      if (!this.fragmentIndex[i]) return res;

      const fragment = pattern[i];

      if (fragment === "*" && subset) continue;

      const g = [];

      if (this.fragmentIndex[i][fragment])
        g.push(this.fragmentIndex[i][fragment]);

      if (fragment !== "*" && superset && this.fragmentIndex[i]["*"])
        g.push(this.fragmentIndex[i]["*"]);

      if (!g.length) return res;

      groups.push(g);
    }

    groups.sort((a, b) => {
      return (
        a.reduce((prev, cur) => {
          return prev + cur.size;
        }, 0) -
        b.reduce((prev, cur) => {
          return prev + cur.size;
        }, 0)
      );
    });

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
