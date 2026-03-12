import Expression from "./expression.ts";
import { Cursor, parsePath } from "./expression/parser.ts";

type Segments = (string | Expression)[];

let cache1 = new Map<string, Path>();
let cache2 = new Map<string, Path>();

export default class Path {
  declare public readonly segments: Segments;
  declare public readonly colon: number;
  declare public readonly wildcard: number;
  declare public readonly alias: number;
  declare protected _string: string;
  declare protected _stringIndex: number[];

  constructor(segments: Segments, colon: number) {
    if (!(colon <= segments.length)) throw new Error("Invalid path");
    if (segments.length > 32) throw new Error("Path too long");

    Object.freeze(segments);

    let alias = 0;
    let wildcard = 0;
    const arr = segments.map((s, i) => {
      if (s instanceof Expression) {
        alias |= 1 << i;
        return `[${s.toString()}]`;
      } else if (s === "*") {
        wildcard |= 1 << i;
      }
      return s;
    });

    let offset = 0;
    const stringIndex = arr.map((s, i) => (offset += s.length) + i);

    this.segments = segments;
    this.colon = colon;
    this.wildcard = wildcard;
    this.alias = alias;
    if (!colon) this._string = arr.join(".");
    else
      this._string =
        arr.slice(0, -colon).join(".") + ":" + arr.slice(-colon).join(".");
    this._stringIndex = stringIndex;
  }

  public static parse(input: string): Path {
    let path = cache1.get(input);
    if (!path) {
      path = cache2.get(input);
      if (!path) {
        const cursor = new Cursor(input);
        path = parsePath(cursor);
        if (cursor.charCode) throw new Error("Unexpected character");
        if (path.toString() !== input) cache1.set(path.toString(), path);
      }
      cache1.set(input, path);
    }
    return path;
  }

  public get length(): number {
    return this.segments.length;
  }

  public get paramLength(): number {
    return this.segments.length - this.colon;
  }

  public get attrLength(): number {
    return this.colon;
  }

  public toString(): string {
    return this._string;
  }

  public slice(start = 0, end: number = this.segments.length): Path {
    if (start < 0) start = Math.max(0, this.segments.length + start);
    if (end < 0) end = Math.max(0, this.segments.length + end);

    if (start >= end) return Path.root;

    let i1 = start > 0 ? this._stringIndex[start - 1] + 1 : 0;
    // Include the ":" when slicing exactly at the colon boundary
    if (this.colon && start === this.segments.length - this.colon) --i1;
    const i2 =
      end <= this.segments.length
        ? this._stringIndex[end - 1]
        : this._string.length;
    const str = this._string.slice(i1, i2);

    let path = cache1.get(str);
    if (!path) {
      path = cache2.get(str);
      if (!path) {
        const segments = this.segments.slice(start, end);
        const colon =
          start <= this.segments.length - this.colon
            ? Math.max(0, this.colon - this.segments.length + end)
            : 0;
        path = new Path(segments, colon);
      }
      cache1.set(str, path);
    }

    return path;
  }

  public concat(path2: Path): Path {
    if (!path2._string) return this;
    else if (!this._string) return path2;

    if (this.colon && path2.colon && path2.colon < path2.segments.length)
      throw new Error("Invalid path");

    const colon = this.colon ? this.colon + path2.segments.length : path2.colon;

    let str;
    if (this.colon && path2.colon === path2.segments.length) {
      // Right is all-colon; strip its ":" prefix and join with "."
      str = `${this._string}.${path2._string.slice(1)}`;
    } else if (path2.colon === path2.segments.length) {
      // Left has no colon; right is all-colon; concatenate directly
      str = `${this._string}${path2._string}`;
    } else {
      str = `${this._string}.${path2._string}`;
    }

    let path = cache1.get(str);
    if (!path) {
      path = cache2.get(str);
      if (!path) {
        const segments = this.segments.concat(path2.segments);
        path = new Path(segments, colon);
      }
      cache1.set(str, path);
    }

    return path;
  }

  public stripAlias(): Path {
    if (!this.alias) return this;
    const segments = this.segments.map((s) =>
      s instanceof Expression ? "*" : s,
    );
    let str: string;
    if (!this.colon) str = segments.join(".");
    else
      str =
        segments.slice(0, -this.colon).join(".") +
        ":" +
        segments.slice(-this.colon).join(".");

    let path = cache1.get(str);
    if (!path) {
      path = cache2.get(str);
      if (!path) {
        path = new Path(segments, this.colon);
      }
      cache1.set(str, path);
    }

    return path;
  }

  static root = new Path([], 0);
}

const interval = setInterval(() => {
  cache2 = cache1;
  cache1 = new Map();
}, 120000);

// Don't hold Node.js process
if (interval.unref) interval.unref();
