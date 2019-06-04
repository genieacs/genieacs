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

const NONEXISTENT = Symbol();
const UNDEFINED = undefined;

interface Revisions<V> {
  [rev: number]: V;
  delete?: number;
}

export default class VersionedMap<K, V> {
  private _sizeDiff: number[];
  private _revision: number;
  private map: Map<K, (V | symbol)[]>;
  public dirty: number;

  public constructor() {
    this._sizeDiff = [0];
    this._revision = 0;
    this.map = new Map();
    this.dirty = 0;
  }

  public get size(): number {
    return this.map.size + this._sizeDiff[this.revision];
  }

  public get revision(): number {
    return this._revision;
  }

  public set revision(rev) {
    for (let i = this._sizeDiff.length; i <= rev; ++i)
      this._sizeDiff[i] = this._sizeDiff[i - 1];

    this._revision = rev;
  }

  public get(key: K, rev = this._revision): V {
    const revisions = this.map.get(key);
    if (!revisions) return UNDEFINED;

    const v = revisions[Math.min(revisions.length - 1, rev)];
    if (v === NONEXISTENT) return UNDEFINED;
    return v as V;
  }

  public has(key: K, rev = this._revision): boolean {
    const revisions = this.map.get(key);
    if (!revisions) return false;

    const v = revisions[Math.min(revisions.length - 1, rev)];
    if (v === NONEXISTENT) return false;
    return true;
  }

  public set(key: K, value: V, rev = this._revision): this {
    let revisions = this.map.get(key);
    if (!revisions) {
      this.dirty |= 1 << rev;
      for (let i = 0; i < rev; ++i) this._sizeDiff[i] -= 1;

      revisions = [];
      for (let i = 0; i < rev; ++i) revisions[i] = NONEXISTENT;
      revisions[rev] = value;
      this.map.set(key, revisions);
      return this;
    }

    // Can't modify old revisions
    if (rev < revisions.length - 1) return null;

    const old = revisions[revisions.length - 1];

    this.dirty |= 1 << rev;
    if (old === NONEXISTENT) ++this._sizeDiff[rev];

    for (let i = revisions.length; i < rev; ++i) revisions[i] = old;
    revisions[rev] = value;

    return this;
  }

  public delete(key: K, rev = this._revision): boolean {
    const revisions = this.map.get(key);
    if (!revisions) return false;

    // Can't modify old revisions
    if (rev < revisions.length - 1) return null;

    const old = revisions[revisions.length - 1];
    if (old === NONEXISTENT) return false;

    this.dirty |= 1 << rev;
    --this._sizeDiff[rev];

    for (let i = revisions.length; i < rev; ++i) revisions[i] = old;
    revisions[rev] = NONEXISTENT;

    return true;
  }

  public getRevisions(key: K): Revisions<V> {
    const revisions = this.map.get(key);
    if (!revisions) return null;

    const res: Revisions<V> = {};

    let prev: V | symbol = NONEXISTENT;
    for (const [i, v] of revisions.entries()) {
      if (v === prev) continue;
      if (v === NONEXISTENT) res.delete |= 1 << i;
      else res[i] = v as V;
      prev = v;
    }

    return res;
  }

  public setRevisions(key: K, revisionsObj: Revisions<V>): void {
    const del = revisionsObj.delete || 0;
    const mutations = Object.keys(revisionsObj).reduce(
      (acc, cur) => (cur === "delete" ? acc : acc | (1 << +cur)),
      del
    );

    const revisions = [];

    let prev: V | symbol = NONEXISTENT;
    for (let i = 0; mutations >> i; ++i) {
      let v = prev;
      if (del & (1 << i)) v = NONEXISTENT;
      else if (i in revisionsObj) v = revisionsObj[i];
      if (v !== prev) this.dirty |= 1 << i;
      revisions[i] = v;
      prev = v;
    }

    this.map.set(key, revisions);
  }

  public getDiff(key: K): [V, V] {
    const revisions = this.map.get(key);
    if (!revisions) return [UNDEFINED, UNDEFINED];
    let first = revisions[0];
    if (first === NONEXISTENT) first = UNDEFINED;
    let last = revisions[revisions.length - 1];
    if (last === NONEXISTENT) last = UNDEFINED;
    return [first as V, last as V];
  }

  public *diff(): IterableIterator<[K, V, V]> {
    for (const [key, revisions] of this.map) {
      let first = revisions[0];
      let last = revisions[revisions.length - 1];
      if (first === NONEXISTENT && last === NONEXISTENT) continue;
      if (first === NONEXISTENT) first = UNDEFINED;
      if (last === NONEXISTENT) last = UNDEFINED;
      yield [key, first as V, last as V];
    }
  }

  public collapse(revision: number): void {
    if (this._sizeDiff.length <= revision) return;

    this._sizeDiff[revision] = this._sizeDiff[this._sizeDiff.length - 1];
    this._sizeDiff.splice(revision + 1, this._sizeDiff.length);

    const d = this.dirty >> revision;
    this.dirty = this.dirty ^ (d << revision);
    this.dirty |= +!!d << revision;

    for (const [k, v] of this.map) {
      const l = v.length - 1;
      if (l <= revision) continue;
      const last = v[l];
      v.splice(revision, l - revision);

      if (last === NONEXISTENT && !v.some(vv => vv !== NONEXISTENT))
        this.map.delete(k);
    }
  }
}
