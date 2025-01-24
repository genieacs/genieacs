import Path from "./common/path.ts";

const WILDCARD_MULTIPLIER = 2;
const UNDISCOVERED_DEPTH = 7;

// Simple heuristic to estimate GPN count given a set of patterns to be
// discovered. Used to decide whether to use nextLevel = false in GPN.
// gpnPatterns is [pattern, flags]
// pattern is a path (array)
// flags is an int where its bits mark the segments in the pattern that
// need refreshing. Leading 0s indicate that the pattern up to that
// point has been discovered.
export function estimateGpnCount(
  gpnPatterns: [Path, number][],
  depth = 0,
): number {
  const children: { [segment: string]: [Path, number][] } = {};
  const wildcardChildren: [Path, number][] = [];
  let wildcardDiscovered = false;
  let gpnCount = 0;

  for (const pattern of gpnPatterns) {
    const path = pattern[0];
    const flags = pattern[1] >> depth;

    const k = path.segments[depth] as string;

    if (!k) {
      if (flags & 1) gpnCount = 1;
      continue;
    }

    if (flags & 1) {
      gpnCount = 1;

      if (depth > UNDISCOVERED_DEPTH) continue;
    } else if (k === "*") {
      wildcardDiscovered = true;
    }

    if (k === "*") {
      wildcardChildren.push(pattern);
    } else {
      children[k] = children[k] || [];
      children[k].push(pattern);
    }
  }

  let wildcardGpnCount = 0;
  if (!wildcardDiscovered && wildcardChildren.length) {
    wildcardGpnCount +=
      estimateGpnCount(wildcardChildren, depth + 1) * WILDCARD_MULTIPLIER;
  }

  for (const k of Object.keys(children)) {
    const c = estimateGpnCount(children[k].concat(wildcardChildren), depth + 1);
    wildcardGpnCount -= c;
    gpnCount += c;
  }

  gpnCount += Math.max(0, wildcardGpnCount);

  return gpnCount;
}
