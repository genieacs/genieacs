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

const NONEXISTENT = new Object();


function compareEquality(a, b) {
  var t = typeof a;
  if (t === 'number' || (a == null) || t === 'boolean' || t === 'string' || t === 'symbol')
    return a === b;

  return JSON.stringify(a) === JSON.stringify(b);
}


class VersionedMap {

  constructor() {
    this._sizeDiff = [0];
    this._revision = 0;
    this.map = new Map();
    this.dirty = 0;
  }


  get size() {
    return this.map.size + this._sizeDiff[this.revision];
  }


  get revision() {
    return this._revision;
  }


  set revision(rev) {
    for (let i = this._sizeDiff.length; i <= rev; ++ i)
      this._sizeDiff[i] = this._sizeDiff[i - 1];

    this._revision = rev;
  }


  get(key, rev) {
    if (rev == null)
      rev = this._revision

    var v = this.map.get(key);
    if (!v)
      return;

    for (let i = Math.min(v.length - 1, rev); i >= 0; -- i)
      if (i in v)
        if (v[i] === NONEXISTENT)
          return undefined;
        else
          return v[i];
  }


  has(key, rev) {
    if (rev == null)
      rev = this._revision

    var v = this.map.get(key);

    if (v == null)
      return false;

    for (let i = Math.min(v.length - 1, rev); i >= 0; -- i)
      if (i in v)
        if (v[i] === NONEXISTENT)
          return false;
        else
          return true;

    return false;
  }


  set(key, value, rev) {
    if (rev == null)
      rev = this._revision;

    var v = this.map.get(key);
    if (!v) {
      this.dirty |= 1 << rev;
      for (let i = 0; i < rev; ++ i)
        this._sizeDiff[i] -= 1;

      v = [];
      v[rev] = value;
      this.map.set(key, v);
      return this;
    }

    var old = v[Math.min(rev, v.length - 1)];

    if (rev < v.length - 1) {
      if (compareEquality(value, old))
        return
      else
        throw new Error('Cannot modify old revisions');
    }

    this.dirty |= 1 << rev;
    if (old === NONEXISTENT)
      ++ this._sizeDiff[rev];

    v[rev] = value;
  }


  delete(key, rev) {
    if (rev == null)
      rev = this._revision;

    var v = this.map.get(key);
    if (!v)
      return false;

    if (rev < v.length - 1)
      throw new Error('Cannot modify old revisions');

    var old = v[v.length - 1];
    if (old === NONEXISTENT)
      return false;

    this.dirty |= 1 << rev;
    -- this._sizeDiff[rev];
    v[rev] = NONEXISTENT;

    return true;
  }


  getRevisions(key) {
    var v = this.map.get(key);
    if (!v)
      return null;

    var res = {};

    for (let i in v)
      if (v[i] === NONEXISTENT)
        res.delete |= 1 << i;
      else
        res[i] = v[i];

    return res;
  }


  setRevisions(key, revisions) {
    var del = 0;
    var rev = [];
    var minKey = 999;
    for (let k in revisions) {
      if (k === 'delete')
        del = revisions[k];
      else {
        let r = parseInt(k);
        minKey = Math.min(minKey, r);
        for (let i = this._sizeDiff.length; i <= r; ++ i)
          this._sizeDiff[i] = this._sizeDiff[i - 1];

        this.dirty |= 1 << r;
        rev[r] = revisions[k];
      }
    }

    for (let i = 0; i < minKey; ++ i)
      -- this._sizeDiff[i];

    this.dirty |= del;

    for (let i = 0; del > 0; del >>= 1, ++ i)
      if (del & 1)
        rev[i] = NONEXISTENT;

    this.map.set(key, rev);
  }


  getDiff(key) {
    var revisions = this.map.get(key);
    if (!revisions)
      return [];

    var current = revisions[revisions.length - 1];
    if (current === NONEXISTENT) {
      if (0 in revisions)
        return [key, revisions[0]];
      else
        return [key];
    } else if (0 in revisions)
      return [key, revisions[0], current];
    else
      return [key, , current];
  }


  *diff() {
    for (let pair of this.map) {
      let current = pair[1][pair[1].length - 1];
      if (current === NONEXISTENT) {
        if (0 in pair[1])
          yield [pair[0], pair[1][0]];
        else
          yield [pair[0]];
      } else if (0 in pair[1])
        yield [pair[0], pair[1][0], current];
      else
        yield [pair[0], , current];
    }
  }


  collapse(revision) {
    if (this._sizeDiff.length <= revision)
      return;

    this._sizeDiff[revision] = this._sizeDiff[this._sizeDiff.length - 1];
    this._sizeDiff.splice(revision + 1, this._sizeDiff.length);

    let d = this.dirty >> revision;
    this.dirty = this.dirty ^ (d << revision);
    this.dirty |= (+!!d) << revision;

    for (let pair of this.map) {
      let k = pair[0];
      let v = pair[1];
      let last = v[v.length - 1];
      if (last === NONEXISTENT) {
        v.splice(revision, v.length);
        if (v.some(function(val) { return true; }))
          v[revision] = NONEXISTENT;
        else
          this.map.delete(k);
      }
      else {
        v[revision] = last;
        v.splice(revision + 1, v.length);
      }
    }
  }

}

module.exports = VersionedMap;
