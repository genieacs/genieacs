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

import Path from "./path";

export default class PathSet {
  private lengthIndex: Set<Path>[];
  private fragmentIndex: Map<string, Set<Path>>[];

  public constructor() {
    this.lengthIndex = [];
    this.fragmentIndex = [];
  }

  public get depth(): number {
    return this.lengthIndex.length;
  }

  public add(path: Path): Path {
    if (path.alias) throw new Error("PathSet does not support aliased paths");
    const p = this.get(path);

    if (p) return p;

    while (this.lengthIndex.length <= path.length) {
      this.lengthIndex.push(new Set());
      this.fragmentIndex.push(new Map());
    }

    const lengthIndex = this.lengthIndex[path.length];
    lengthIndex.add(path);

    for (let i = 0; i < path.length; ++i) {
      const fragment = path.segments[i] as string;
      const fragmentIndex = this.fragmentIndex[i];

      let fragmentIndexSet = fragmentIndex.get(fragment);
      if (!fragmentIndexSet) {
        fragmentIndexSet = new Set<Path>();
        fragmentIndex.set(fragment, fragmentIndexSet);
      }

      fragmentIndexSet.add(path);
    }

    return path;
  }

  public get(path: Path): Path {
    if (path.alias) throw new Error("PathSet does not support aliased paths");
    const lengthIndex = this.lengthIndex[path.length];
    if (!lengthIndex || !lengthIndex.size) return null;

    if (lengthIndex.has(path)) return path;

    const sets = [lengthIndex];

    for (let i = 0; i < path.length; ++i) {
      const fragmentIndex = this.fragmentIndex[i];
      if (!fragmentIndex || !fragmentIndex.size) return null;

      const fragment = path.segments[i] as string;

      const fragmentIndexSet = fragmentIndex.get(fragment);
      if (!fragmentIndexSet) return null;

      sets.push(fragmentIndexSet);
    }

    sets.sort((a, b) => a.size - b.size);

    const smallestSet = sets.shift();
    for (let p of smallestSet) {
      for (const s of sets) {
        if (!s.has(p)) {
          p = null;
          break;
        }
      }

      if (p) return p;
    }

    return null;
  }

  public find(
    path: Path,
    superset: boolean = false,
    subset: boolean = false,
    depth: number = path.length
  ): Path[] {
    if (path.alias) throw new Error("PathSet does not support aliased paths");
    const res = [];
    const groups = [[]];

    for (let i = path.length; i <= depth; ++i)
      if (this.lengthIndex[i]) groups[0].push(this.lengthIndex[i]);

    if (!groups[0].length) return res;

    for (let i = 0; i < path.length; ++i) {
      const fragmentIndex = this.fragmentIndex[i];
      if (!fragmentIndex) return res;

      const fragment = path.segments[i] as string;

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
      for (let p of set) {
        for (const group of groups) {
          let found = false;
          for (const s of group) {
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
        if (p) res.push(p);
      }
    }
    return res;
  }
}
