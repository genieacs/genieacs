type Segments = (string | Alias)[];
type Alias = [Path, string][];

let cache1 = new Map<string, Path>();
let cache2 = new Map<string, Path>();

const CHAR_SPACE = 32;
const CHAR_BACKSLASH = 92;
const CHAR_COLON = 58;
const CHAR_QUOTE = 34;
const CHAR_OPEN_BRACKET = 91;
const CHAR_CLOSE_BRACKET = 93;
const CHAR_ASTERISK = 42;
const CHAR_COMMA = 44;
const CHAR_DOT = 46;

function charCodeAt(str: string, index: number): number {
  if (index >= str.length) return 0;
  return str.charCodeAt(index);
}

function legalChar(c: number): boolean {
  return (
    (c >= 97 && c <= 122) ||
    (c >= 65 && c <= 90) ||
    (c >= 48 && c <= 57) ||
    c === 95 ||
    c === 45
  );
}

export default class Path {
  public declare readonly segments: Segments;
  public declare readonly wildcard: number;
  public declare readonly alias: number;
  protected declare _string: string;
  protected declare _stringIndex: number[];

  protected static parseAliasValue(
    pattern: string,
    index: number,
  ): { index: number; value: string } {
    let i = index;
    while (charCodeAt(pattern, i) === CHAR_SPACE) ++i;
    if (charCodeAt(pattern, i) === CHAR_QUOTE) {
      for (let j = i + 1; j < pattern.length; ++j) {
        if (
          pattern.charCodeAt(j) === CHAR_QUOTE &&
          pattern.charCodeAt(j - 1) !== CHAR_BACKSLASH
        ) {
          try {
            ++j;
            const v = JSON.parse(pattern.slice(i, j));
            return { index: j, value: v };
          } catch {
            return { index, value: null };
          }
        }
      }
      return { index, value: null };
    }

    for (; i < pattern.length; ++i) {
      const c = pattern.charCodeAt(i);
      if (c === CHAR_CLOSE_BRACKET || c === CHAR_COMMA) break;
    }

    return { index: i, value: pattern.slice(index, i).trim() };
  }

  protected static parseAliasPath(
    pattern: string,
    index: number,
  ): { index: number; path: Path } {
    let i = index;
    while (charCodeAt(pattern, i) === CHAR_SPACE) ++i;
    const { index: idx, segments } = Path.parsePath(pattern, i);
    if (idx === i) return { index, path: null };
    i = idx;
    while (charCodeAt(pattern, i) === CHAR_SPACE) ++i;
    if (charCodeAt(pattern, i) !== CHAR_COLON) return { index, path: null };
    return { index: i + 1, path: new Path(segments) };
  }

  protected static parseAlias(
    pattern: string,
    index: number,
  ): { index: number; alias: Alias } {
    const alias: Alias = [];
    let i = index;
    for (;;) {
      let path: Path;
      let value: string;
      ({ index: i, path } = Path.parseAliasPath(pattern, i));
      if (!path) break;
      ({ index: i, value } = Path.parseAliasValue(pattern, i));
      if (value == null) break;
      alias.push([path, value]);
      index = i;

      if (charCodeAt(pattern, index) !== CHAR_COMMA) break;
      ++i;
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
    index: number,
  ): { index: number; segments: Segments } {
    const segments = [];

    let segStart = index;
    let wildcard = -1;
    for (let i = index; i <= pattern.length; ++i) {
      const c = charCodeAt(pattern, i);
      if (c === CHAR_OPEN_BRACKET && i === segStart) {
        const { index: idx, alias } = Path.parseAlias(pattern, i + 1);
        if (charCodeAt(pattern, idx) !== CHAR_CLOSE_BRACKET) break;
        segments.push(alias);
        index = i = idx + 1;
        segStart = i + 1;
      } else if (c === CHAR_ASTERISK && i === segStart) {
        wildcard = i + 1;
      } else if (!legalChar(c) || i === wildcard) {
        if (i === segStart) break;
        const s = pattern.slice(segStart, i);
        segments.push(s);
        index = i;
        if (c !== CHAR_DOT) break;
        segStart = i + 1;
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
          (al) => `${al[0].toString()}:${JSON.stringify(al[1])}`,
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
        const { index, segments } = Path.parsePath(str, 0);
        if (index < str.length) throw new Error("Invalid parameter path");
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

  public slice(start = 0, end: number = this.segments.length): Path {
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
    const segments = this.segments.map((s) => (Array.isArray(s) ? "*" : s));
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
