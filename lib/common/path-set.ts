import Path from "./path.ts";

function lowBits(n: number): number {
  return n <= 0 ? 0 : -1 >>> (32 - n);
}

export default class PathSet {
  private paramSegmentIndex: Map<string, Set<Path>>[] = [];
  private attrSegmentIndex: Map<string, Set<Path>>[] = [];
  private stringIndex: Map<string, Path> = new Map();

  public constructor() {}

  public add(pathStr: string): Path {
    let path = this.get(pathStr);
    if (path) return path;
    path = Path.parse(pathStr);
    if (path.alias) throw new Error("PathSet does not support aliased paths");
    if (!path.paramLength)
      throw new Error("PathSet does not support attribute-only paths");

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

  public get(path: string): Path | undefined {
    return this.stringIndex.get(path);
  }

  // findCompat() does not support attribute paths
  public findCompat(
    path: Path,
    superset = false,
    subset = false,
    depth = path.paramLength,
  ): Path[] {
    if (path.attrLength) return [];

    const segmentMask = lowBits(path.paramLength);

    let laxity = 0;
    if (superset) laxity |= ~path.wildcard & segmentMask;
    if (subset) laxity |= path.wildcard;

    const lo = Math.max(1, path.paramLength);
    const hi = Math.min(32, depth);
    const paramMask = lowBits(hi - lo + 1) << (lo - 1);

    return this.find(path, laxity, paramMask);
  }

  public find(
    path: Path,
    laxity: number, // bit i: pattern segment i matches by wildcard as well
    paramMask = -1, // bit i admits candidates with param length i + 1
    attrMask = 1, // bit i admits candidates with attr length i
  ): Path[] {
    if (path.alias) throw new Error("PathSet does not support aliased paths");
    if (path.paramLength > this.paramSegmentIndex.length) return [];
    if (path.attrLength > this.attrSegmentIndex.length) return [];

    const emptySet: Set<Path> = new Set();

    const indexes: [Set<Path>, Set<Path>][] = [];

    for (const [i, s] of path.segments.entries()) {
      const b = 1 << i;
      const m = laxity & b;
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

    res = res.filter(
      (p) =>
        (1 << (p.paramLength - 1)) & paramMask &&
        (1 << p.attrLength) & attrMask,
    );

    for (let i = 1; i < indexes.length; ++i) {
      const [idx1, idx2] = indexes[i];
      res = res.filter((p) => idx1.has(p) || idx2.has(p));
    }

    return res;
  }
}
