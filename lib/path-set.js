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


class PathSet {

  constructor() {
    this.lengthIndex = [];
    this.fragmentIndex = [];
  }


  get depth() {
    return this.lengthIndex.length;
  }


  add(path) {
    let sets;

    if (!this.lengthIndex[path.length])
      this.lengthIndex[path.length] = new Set();
    else if (this.lengthIndex[path.length].has(path))
      return path;
    else
      sets = [this.lengthIndex[path.length]];

    for (let i = 0; i < path.length; ++ i) {
      let fragment = path[i];

      if (!fragment)
        throw new Error('All array elements must be non-empty string');

      if (!this.fragmentIndex[i]) {
        sets = null;
        this.fragmentIndex[i] = {}
      }

      if (!this.fragmentIndex[i][fragment]) {
        sets = null;
        this.fragmentIndex[i][fragment] = new Set();
      }
      else if (sets)
        sets.push(this.fragmentIndex[i][fragment])
    }

    if (sets) {
      sets.sort(function(a, b) {
        return a.size - b.size;
      });

      var smallest = sets.shift();
      for (let p of smallest) {
        for (let set of sets) {
          if (!set.has(p)) {
            p = null;
            break;
          }
        }

        if (p)
          return p;
      }
    }

    var wildcard = 0;
    this.lengthIndex[path.length].add(path);
    for (let i = 0; i < path.length; ++ i) {
      let fragment = path[i];
      if (fragment === '*')
        wildcard |= 1 << i;

      this.fragmentIndex[i][fragment].add(path);
    }

    if (path.wildcard == null) {
      path.alias = 0;
      path.wildcard = wildcard;
      Object.freeze(path);
    }
    return path;
  }


  *subset(path, depth) {
    var p = path.slice();
    for (let i = 0; i < p.length; ++ i)
      if (p[i] === '*')
        p[i] = null;
    yield* this.find(p, depth || 0, false);
  }


  *superset(path, depth) {
    yield* this.find(path, depth || 0, true)
  }


  *all(path, depth) {
    var p = path.slice();
    for (let i = 0; i < p.length; ++ i)
      if (p[i] === '*')
        p[i] = null;
    yield* this.find(p, depth || 0, true);
  }


  *find(pattern, depth, wildcard) {
    var sets = [];

    var s = [];
    for (let i = pattern.length + depth; i >= pattern.length; -- i) {
      if (this.lengthIndex[i])
        s.push(this.lengthIndex[i]);
    }

    if (!s.length)
      return;

    sets.push(s);

    for (let i = 0; i < pattern.length; ++ i) {
      if (pattern[i]) {
        let fragment = pattern[i];
        let s = [];

        if (this.fragmentIndex[i]) {
          if (this.fragmentIndex[i][fragment])
            s.push(this.fragmentIndex[i][fragment]);

          if (wildcard && fragment != '*' && this.fragmentIndex[i]['*'])
            s.push(this.fragmentIndex[i]['*'])
        }

        if (!s.length)
          return;

        sets.push(s);
      }
    }

    sets.sort(function(a, b) {
      return a.reduce(function(prev, cur) {return prev + cur.size;}, 0) -
        b.reduce(function(prev, cur) {return prev + cur.size;}, 0);
    });

    var smallest = sets.shift();
    for (let pp of smallest) {
      for (let p of pp) {
        for (let ss of sets) {
          let found = false;
          for (let s of ss) {
            if (s.has(p)) {
              found = true;
              break;
            }
          }

          if (!found) {
            p = null;
            break;
          }
        }

        if (p)
          yield p;
      }
    }
  }

}


module.exports = PathSet;
