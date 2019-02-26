/**
 * Copyright 2013-2019  Zaid Abdulla
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

  protected static parseAlias(
    pattern: string,
    index: number
  ): { index: number; alias: Alias } {
    const alias: Alias = [];
    while (index < pattern.length && pattern[index] !== "]") {
      const res = Path.parsePath(pattern, index);
      let j = (index = res.index + 1);
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

      alias.push([new Path(res.segments, res.wildcard, res.alias), value]);
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
  ): { index: number; segments: Segments; wildcard: number; alias: number } {
    const segments = [];
    let wildcard = 0;
    let alias = 0;
    // Colon separator is needed for parseAlias
    if (index < pattern.length && pattern[index] !== ":") {
      for (;;) {
        if (pattern[index] === "[") {
          const res = Path.parseAlias(pattern, index + 1);
          index = res.index + 1;
          alias |= 1 << segments.length;
          segments.push(res.alias);
        } else {
          const j = index;
          while (
            index < pattern.length &&
            pattern[index] !== ":" &&
            pattern[index] !== "."
          )
            ++index;
          const s = pattern.slice(j, index).trim();
          if (s === "*") wildcard |= 1 << segments.length;
          segments.push(s);
        }

        if (index >= pattern.length || pattern[index] === ":") break;
        else if (pattern[index] !== ".")
          throw new Error("Invalid alias expression");
        ++index;
      }
    }

    Object.freeze(segments);
    return { index, segments, wildcard, alias };
  }

  protected constructor(segments: Segments, wildcard: number, alias: number) {
    this.segments = segments;
    this.wildcard = wildcard;
    this.alias = alias;
    this._string = null;
  }

  public static parse(str: string): Path {
    let path = cache1.get(str);
    if (!path) {
      path = cache2.get(str);
      if (!path) {
        const res = Path.parsePath(str, 0);
        path = new Path(res.segments, res.wildcard, res.alias);
      }
      cache1.set(str, path);
    }
    return path;
  }

  public get length(): number {
    return this.segments.length;
  }

  public toString(): string {
    if (this._string == null) {
      this._string = this.segments
        .map(s => {
          if (Array.isArray(s)) {
            const parts = s.map(
              al => `${al[0].toString()}:${JSON.stringify(al[1])}`
            );
            return `[${parts.join(",")}]`;
          }
          return s;
        })
        .join(".");
    }
    return this._string;
  }

  public slice(start: number = 0, end: number = this.segments.length): Path {
    if (start < 0) start = Math.max(0, this.segments.length + start);
    if (end < 0) end = Math.max(0, this.segments.length + end);
    if (start >= end) return new Path([], 0, 0);
    const segments = this.segments.slice(start, end);
    const mask = (1 << (end - start)) - 1;
    const wildcard = (this.wildcard >> start) & mask;
    const alias = (this.alias >> start) & mask;
    return new Path(segments, wildcard, alias);
  }

  public concat(path: Path): Path {
    const segments = this.segments.concat(path.segments);
    const wildcard = this.wildcard | (path.wildcard << this.segments.length);
    const alias = this.alias | (path.alias << this.segments.length);
    return new Path(segments, wildcard, alias);
  }

  public stripAlias(): Path {
    if (!this.alias) return this;
    const segments = this.segments.map(s => (Array.isArray(s) ? "*" : s));
    return new Path(segments, this.wildcard | this.alias, 0);
  }
}

const interval = setInterval(() => {
  cache2 = cache1;
  cache1 = new Map();
}, 120000);

// Don't hold Node.js process
if (interval.unref) interval.unref();
