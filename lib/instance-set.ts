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

interface Instance {
  [name: string]: string;
}

export default class InstanceSet {
  private set: Set<Instance>;

  public constructor() {
    this.set = new Set();
  }

  public add(instance: Instance): void {
    this.set.add(instance);
  }

  public delete(instance: Instance): void {
    this.set.delete(instance);
  }

  public superset(instance: Instance): Instance[] {
    const res = [];
    for (const inst of this.set) {
      let match = true;
      for (const k in instance) {
        if (inst[k] !== instance[k]) {
          match = false;
          break;
        }
      }

      if (match) res.push(inst);
    }

    res.sort((a, b) => {
      const keysA = Object.keys(a);
      const keysB = Object.keys(b);

      if (keysA.length !== keysB.length) return keysB.length - keysA.length;

      keysA.sort();
      keysB.sort();

      for (let i = 0; i < keysA.length; ++i) {
        if (keysA[i] > keysB[i]) return 1;
        else if (keysA[i] < keysB[i]) return -1;
        else if (a[keysA[i]] > b[keysB[i]]) return 1;
        else if (a[keysA[i]] < b[keysB[i]]) return -1;
      }

      return 0;
    });

    return res;
  }

  public subset(instance: Instance): Instance[] {
    const res = [];

    for (const inst of this.set) {
      let match = true;
      for (const k in inst) {
        if (inst[k] !== instance[k]) {
          match = false;
          break;
        }
      }

      if (match) res.push(inst);
    }

    res.sort((a, b) => {
      const keysA = Object.keys(a);
      const keysB = Object.keys(b);

      if (keysA.length !== keysB.length) return keysA.length - keysB.length;

      keysA.sort();
      keysB.sort();

      for (let i = 0; i < keysA.length; ++i) {
        if (keysA[i] > keysB[i]) return 1;
        else if (keysA[i] < keysB[i]) return -1;
        else if (a[keysA[i]] > b[keysB[i]]) return 1;
        else if (a[keysA[i]] < b[keysB[i]]) return -1;
      }

      return 0;
    });

    return res;
  }

  public [Symbol.iterator](): IterableIterator<Instance> {
    return this.set.values();
  }

  public forEach(callback: (instance: Instance) => void): void {
    this.set.forEach(callback);
  }

  public values(): IterableIterator<Instance> {
    return this.set.values();
  }

  public clear(): void {
    this.set.clear();
  }

  public get size(): number {
    return this.set.size;
  }
}
