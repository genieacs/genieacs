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

type Segments = (string | Alias)[];
type Alias = [Path, string][];

let cache1 = new Map<string, Path>();
let cache2 = new Map<string, Path>();

export default class Path {
  public readonly segments: Segments;
  public readonly wildcard: number;
  public readonly alias: number;
  protected _string: string;
  protected _stringIndex: number[];

  protected static parseAlias(
    pattern: string,
    index: number
  ): { index: number; alias: Alias } {
    const alias: Alias = [];
    while (index < pattern.length && pattern[index] !== "]") {
      const { index: idx, segments } = Path.parsePath(pattern, index);
      let j = (index = idx + 1);
      while (pattern[j] !== "]" && pattern[j] !== ",") {
        if (pattern[j] === '"' && index === j) {
          ++j;
          while (pattern[j] !== '"' || pattern[j - 1] === "\\") {
            if (++j >= pattern.length)
              throw new Error("Invalid alias expression");
          }
        }
        if (++j >= pattern.length) throw new Error("Invalid alias expression");
      }

      let value = pattern.slice(index, j).trim();
      index = j;
      if (value[0] === '"') {
        try {
          value = JSON.parse(value);
        } catch (error) {
          throw new Error("Invalid alias expression");
        }
      }

      alias.push([new Path(segments), value]);
      if (pattern[index] === ",") ++index;
    }

    // Ensure identical expressions have idential string representation
    alias.sort((a, b) => {
      if (a[0].toString() > b[0].toString()) return 1;
      else if (a[0].toString() < b[0].toString()) return -1;
      else if (a[1] > b[1]) return 1;
      else if (a[1] < b[1]) return -1;
      else return 0;
    });

    Object.freeze(alias);
    return { index, alias };
  }

  protected static parsePath(
    pattern: string,
    index: number
  ): { index: number; segments: Segments } {
    const segments = [];
    // Colon separator is needed for parseAlias
    if (index < pattern.length && pattern[index] !== ":") {
      for (;;) {
        if (pattern[index] === "[") {
          const { index: idx, alias } = Path.parseAlias(pattern, index + 1);
          index = idx + 1;
          segments.push(alias);
        } else {
          const j = index;
          while (
            index < pattern.length &&
            pattern[index] !== ":" &&
            pattern[index] !== "."
          )
            ++index;
          const s = pattern.slice(j, index).trim();
          if (!s) throw new Error("Invalid parameter path");
          segments.push(s);
        }

        if (index >= pattern.length || pattern[index] === ":") break;
        else if (pattern[index] !== ".")
          throw new Error("Invalid alias expression");
        ++index;
      }
    }

    Object.freeze(segments);
    return { index, segments };
  }

  protected constructor(segments: Segments) {
    let alias = 0;
    let wildcard = 0;
    const arr = segments.map((s, i) => {
      if (Array.isArray(s)) {
        alias |= 1 << i;
        const parts = s.map(
          al => `${al[0].toString()}:${JSON.stringify(al[1])}`
        );
        return `[${parts.join(",")}]`;
      } else if (s === "*") {
        wildcard |= 1 << i;
      }
      return s;
    });

    let offset = 0;
    const stringIndex = arr.map((s, i) => (offset += s.length) + i);

    this.segments = segments;
    this.wildcard = wildcard;
    this.alias = alias;
    this._string = arr.join(".");
    this._stringIndex = stringIndex;
  }

  public static parse(str: string): Path {
    let path = cache1.get(str);
    if (!path) {
      path = cache2.get(str);
      if (!path) {
        const { segments } = Path.parsePath(str, 0);
        path = new Path(segments);
        if (path.toString() !== str) cache1.set(path.toString(), path);
      }
      cache1.set(str, path);
    }
    return path;
  }

  public get length(): number {
    return this.segments.length;
  }

  public toString(): string {
    return this._string;
  }

  public slice(start: number = 0, end: number = this.segments.length): Path {
    if (start < 0) start = Math.max(0, this.segments.length + start);
    if (end < 0) end = Math.max(0, this.segments.length + end);

    let str;
    if (start >= end) {
      str = "";
    } else {
      const i1 = start > 0 ? this._stringIndex[start - 1] + 1 : 0;
      const i2 =
        end <= this.segments.length
          ? this._stringIndex[end - 1]
          : this._string.length;
      str = this._string.slice(i1, i2);
    }

    let path = cache1.get(str);
    if (!path) {
      path = cache2.get(str);
      if (!path) {
        const segments = this.segments.slice(start, end);
        Object.freeze(segments);
        path = new Path(segments);
      }
      cache1.set(str, path);
    }

    return path;
  }

  public concat(path2: Path): Path {
    if (!path2._string) return this;
    else if (!this._string) return path2;

    const str = `${this._string}.${path2._string}`;

    let path = cache1.get(str);
    if (!path) {
      path = cache2.get(str);
      if (!path) {
        const segments = this.segments.concat(path2.segments);
        Object.freeze(segments);
        path = new Path(segments);
      }
      cache1.set(str, path);
    }

    return path;
  }

  public stripAlias(): Path {
    if (!this.alias) return this;
    const segments = this.segments.map(s => (Array.isArray(s) ? "*" : s));
    const str = segments.join(".");

    let path = cache1.get(str);
    if (!path) {
      path = cache2.get(str);
      if (!path) {
        Object.freeze(segments);
        path = new Path(segments);
      }
      cache1.set(str, path);
    }

    return path;
  }
}

const interval = setInterval(() => {
  cache2 = cache1;
  cache1 = new Map();
}, 120000);

// Don't hold Node.js process
if (interval.unref) interval.unref();
