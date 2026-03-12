import Path from "./path.ts";

export default class PathSet {
  private paramSegmentIndex: Map<string, Set<Path>>[] = [];
  private attrSegmentIndex: Map<string, Set<Path>>[] = [];
  private stringIndex: Map<string, Path> = new Map();

  public constructor() {}

  public add(pathStr: string): Path {
    let path: Path = this.get(pathStr);
    if (path) return path;
    path = Path.parse(pathStr);
    if (path.alias) throw new Error("PathSet does not support aliased paths");

    this.stringIndex.set(path.toString(), path);

    while (this.paramSegmentIndex.length < path.paramLength)
      this.paramSegmentIndex.push(new Map());

    while (this.attrSegmentIndex.length < path.attrLength)
      this.attrSegmentIndex.push(new Map());

    for (let i = 0; i < path.length; ++i) {
      const fragment = path.segments[i] as string;
      const fragmentIndex =
        i < path.paramLength
          ? this.paramSegmentIndex[i]
          : this.attrSegmentIndex[i - path.paramLength];

      let fragmentIndexSet = fragmentIndex.get(fragment);
      if (!fragmentIndexSet) {
        fragmentIndexSet = new Set<Path>();
        fragmentIndex.set(fragment, fragmentIndexSet);
      }

      fragmentIndexSet.add(path);
    }

    return path;
  }

  public get(path: string): Path {
    return this.stringIndex.get(path);
  }

  public findCompat(
    path: Path,
    superset = false,
    subset = false,
    depth = path.length,
  ): Path[] {
    if (path.attrLength)
      throw new Error("findCompat() does not support attribute paths");

    depth = Math.min(31, depth);
    const paramMask = (1 << path.paramLength) - 1;
    let mask = ((0b10 << depth) - 1) & ~paramMask;
    if (superset) mask |= ~path.wildcard & paramMask;
    if (subset) mask |= path.wildcard;
    return this.find(path, mask, 1);
  }

  public find(path: Path, paramMask: number, attrMask: number): Path[] {
    if (path.alias) throw new Error("PathSet does not support aliased paths");
    if (path.paramLength > this.paramSegmentIndex.length) return [];
    if (path.attrLength > this.attrSegmentIndex.length) return [];

    const emptySet: Set<Path> = new Set();

    const indexes: [Set<Path>, Set<Path>][] = [];

    const paramLengthMask = (1 << path.paramLength) - 1;
    const attrLengthMask = (1 << path.attrLength) - 1;

    const mask = (paramMask & paramLengthMask) | (attrMask << path.paramLength);

    for (const [i, s] of path.segments.entries()) {
      const b = 1 << i;
      const m = mask & b;
      const w = b & path.wildcard;
      if (w && m) continue;
      const idxSet =
        i < path.paramLength
          ? this.paramSegmentIndex[i]
          : this.attrSegmentIndex[i - path.paramLength];
      const idx1 = idxSet.get(s as string) || emptySet;
      let idx2 = emptySet;
      if (m) idx2 = idxSet.get("*") || emptySet;
      indexes.push([idx1, idx2]);
    }

    indexes.sort((a, b) => a[0].size + a[1].size - (b[0].size + b[1].size));

    let res: Path[];

    if (!indexes.length) res = [...this.stringIndex.values()];
    else res = [...indexes[0][0], ...indexes[0][1]];

    const paramCover = ~paramLengthMask & paramMask;
    const attrCover = ~attrLengthMask & attrMask;

    res = res.filter(
      (p) =>
        (1 << p.paramLength) & paramCover && (1 << p.attrLength) & attrCover,
    );

    for (let i = 1; i < indexes.length; ++i) {
      const [idx1, idx2] = indexes[i];
      res = res.filter((p) => idx1.has(p) || idx2.has(p));
    }

    return res;
  }
}
