import Expression, { Value } from "./common/expression.ts";
import Path from "./common/path.ts";
import {
  DeviceData,
  Declaration,
  Clear,
  AttributeTimestamps,
  Attributes,
} from "./types.ts";

const CHANGE_FLAGS = {
  object: 2,
  writable: 4,
  value: 8,
  notification: 16,
  accessList: 32,
};

function parseBool(v: unknown): boolean | null {
  v = "" + v;
  if (v === "true" || v === "TRUE" || v === "True" || v === "1") return true;
  else if (v === "false" || v === "FALSE" || v === "False" || v === "0")
    return false;
  else return null;
}

export function sanitizeParameterValue(
  parameterValue: [string | number | boolean | null, string],
): [string | number | boolean | null, string] {
  if (parameterValue[0] != null) {
    switch (parameterValue[1]) {
      case "xsd:boolean":
        if (typeof parameterValue[0] !== "boolean") {
          const b = parseBool(parameterValue[0]);
          if (b == null) parameterValue[0] = "" + parameterValue[0];
          else parameterValue[0] = b;
        }
        break;
      case "xsd:int":
      case "xsd:unsignedInt":
        if (typeof parameterValue[0] !== "number") {
          const i = parseInt(parameterValue[0] as string);
          if (isNaN(i)) parameterValue[0] = "" + parameterValue[0];
          else parameterValue[0] = i;
        }
        break;
      case "xsd:dateTime":
        if (typeof parameterValue[0] !== "number") {
          // Don't use parseInt because it reads date string as a number
          let i = +parameterValue[0];
          if (isNaN(i)) {
            i = Date.parse(parameterValue[0] as string);
            if (isNaN(i)) parameterValue[0] = "" + parameterValue[0];
            else parameterValue[0] = i;
          } else {
            parameterValue[0] = i;
          }
        }
        break;
      default:
        parameterValue[0] = "" + parameterValue[0];
        break;
    }
  }

  return parameterValue;
}

export function getAliasDeclarations(
  path: Path,
  timestamp: number,
  attrGet?: Declaration["attrGet"],
): Declaration[] {
  const stripped = path.stripAlias();
  let decs: Declaration[] = [
    {
      path: stripped,
      pathGet: timestamp,
      pathSet: undefined,
      attrGet: attrGet,
      attrSet: undefined,
      defer: true,
    },
  ];

  if (path.alias) {
    for (const [i, alias] of path.segments.entries()) {
      if (alias instanceof Expression) {
        const parent = stripped.slice(0, i + 1);
        for (const [p] of expressionToAlias(alias)) {
          decs = decs.concat(
            getAliasDeclarations(parent.concat(p), timestamp, {
              value: timestamp,
            }),
          );
        }
      }
    }
  }

  return decs;
}

export function expressionToAlias(exp: Expression): [Path, Value][] {
  if (exp instanceof Expression.Literal && exp.value === true) return [];
  if (exp instanceof Expression.Binary) {
    if (exp.operator === "AND")
      return [...expressionToAlias(exp.left), ...expressionToAlias(exp.right)];
    else if (exp.operator === "=") {
      if (
        exp.left instanceof Expression.Parameter &&
        exp.right instanceof Expression.Literal
      )
        return [[exp.left.path, exp.right.value]];
    }
  }
  throw new Error("Invalid alias expression");
}

export function unpack(
  deviceData: DeviceData,
  path: Path,
  revision?: number,
): Path[] {
  let allMatches: (Path | null)[] = [];
  if (!path.alias) {
    for (const p of deviceData.paths.findCompat(path, false, true))
      if (deviceData.attributes.has(p, revision)) allMatches.push(p);
  } else {
    const wildcardPath = path.stripAlias();

    for (const p of deviceData.paths.findCompat(wildcardPath, false, true))
      if (deviceData.attributes.has(p, revision)) allMatches.push(p);

    for (let i = path.length - 1; i >= 0; --i) {
      if (path.alias & (1 << i)) {
        for (const [param, val] of expressionToAlias(
          path.segments[i] as Expression,
        )) {
          const p = wildcardPath.slice(0, i + 1).concat(param);
          const unpacked = unpack(deviceData, p, revision);
          const filtered: Path[] = [];
          for (const up of unpacked) {
            const attributes = deviceData.attributes.get(up, revision);
            if (
              attributes &&
              attributes.value &&
              attributes.value[1] &&
              sanitizeParameterValue([val, attributes.value[1][1]])[0] ===
                attributes.value[1][0]
            ) {
              for (let m = 0; m < allMatches.length; ++m) {
                let k;
                const match = allMatches[m];
                if (!match) continue;
                for (k = i; k >= 0; --k)
                  if (match.segments[k] !== up.segments[k]) break;

                if (k < 0) {
                  filtered.push(match);
                  allMatches[m] = null;
                }
              }
            }
          }
          allMatches = filtered;
        }
      }
    }
  }

  const matches = allMatches as Path[];
  matches.sort((p1, p2) => {
    for (let i = 0; i < p1.length; ++i) {
      const a = p1.segments[i] as string;
      const b = p2.segments[i] as string;
      if (a !== b) {
        // Use numeric sorting for numbers
        const ia = parseInt(a);
        const ib = parseInt(b);

        if (ia === +a && ib === +b) return ia - ib;
        else if (a < b) return -1;
        else return 1;
      }
    }
    return 0;
  });

  return matches;
}

export function clear(
  deviceData: DeviceData,
  path: Path,
  timestamp: number,
  attributes: AttributeTimestamps | undefined,
  changeFlags = 0,
): void {
  const changeTrackers: Record<string, number> = {};

  timestamp = timestamp || 0;

  let descendantsTimestamp = timestamp;
  if (attributes?.object) {
    if (attributes.object > descendantsTimestamp)
      descendantsTimestamp = attributes.object;
    if (attributes.value == null || !(attributes.object <= attributes.value))
      attributes.value = attributes.object;
  }

  for (const p of deviceData.paths.findCompat(
    path,
    true,
    true,
    descendantsTimestamp ? 99 : path.length,
  )) {
    const tracker = deviceData.trackers.get(p);
    for (const k in tracker) changeTrackers[k] |= tracker[k];

    const currentTimestamp = deviceData.timestamps.get(p);
    if (currentTimestamp === undefined) continue;

    if (
      timestamp > currentTimestamp ||
      (descendantsTimestamp > currentTimestamp && p.length > path.length)
    ) {
      deviceData.timestamps.delete(p);
      deviceData.attributes.delete(p);
      changeFlags |= 1;
    } else if (attributes && p.length === path.length) {
      const currentAttributes = deviceData.attributes.get(p);
      if (currentAttributes) {
        let newAttrs: Attributes | undefined;
        for (const attrName in attributes) {
          const n = attrName as keyof Attributes;
          const cur = currentAttributes[n];
          if (cur && attributes[n]! > cur[0]) {
            changeFlags |= CHANGE_FLAGS[n];
            if (!newAttrs) {
              newAttrs = Object.assign({}, currentAttributes);
              deviceData.attributes.set(p, newAttrs);
            }
            delete newAttrs[n];
          }
        }
      }
    }
  }

  // Note: For performance, we're merging all changes together rather than
  // mark changes based the exact parameters affected.
  for (const k in changeTrackers)
    if (changeTrackers[k] & changeFlags) deviceData.changes.add(k);
}

function compareEquality(a: unknown, b: unknown): boolean {
  const t = typeof a;
  if (
    a === null ||
    a === undefined ||
    t === "number" ||
    t === "boolean" ||
    t === "string" ||
    t === "symbol"
  )
    return a === b;

  return JSON.stringify(a) === JSON.stringify(b);
}

export function set(
  deviceData: DeviceData,
  pathStr: string,
  timestamp: number,
  attributes: Attributes | undefined,
  toClear: Clear[] = [],
): Clear[] {
  const path = deviceData.paths.add(pathStr);

  const currentTimestamp = deviceData.timestamps.get(path);

  let currentAttributes;

  if (path.wildcard) attributes = undefined;
  else if (currentTimestamp)
    currentAttributes = deviceData.attributes.get(path);

  let changeFlags = 0;

  if (attributes) {
    if (
      attributes.value &&
      attributes.value[1] &&
      attributes.value[0] >= (attributes.object ? attributes.object[0] : 0)
    )
      attributes.object = [attributes.value[0], 0];

    if (
      attributes.object &&
      attributes.object[1] &&
      attributes.object[0] >= (attributes.value ? attributes.value[0] : 0)
    ) {
      // TODO: tombstone needed by per-attribute timestamp merge below to reject
      // stale value writes; not restored on DB reload (cwmp/db.ts), so the
      // canonical representation is inconsistent. Revisit: either restore on
      // load, or drop the tombstone and use object[0] as the floor in merge.
      attributes.value = [
        attributes.object[0],
        null as unknown as [string | number | boolean, string],
      ];
    }

    const newAttributes = Object.assign({}, currentAttributes, attributes);

    if (currentAttributes) {
      for (const attrName in attributes) {
        const n = attrName as keyof Attributes;
        const a = attributes[n]!;
        timestamp = Math.max(timestamp, a[0]);
        const cur = currentAttributes[n];
        if (!cur) changeFlags |= CHANGE_FLAGS[n];
        else if (a[0] <= cur[0]) (newAttributes[n] as unknown) = cur;
        else if (!compareEquality(a[1], cur[1])) changeFlags |= CHANGE_FLAGS[n];
      }
    } else {
      changeFlags |= 1;
    }

    deviceData.attributes.set(path, newAttributes);

    if (currentTimestamp == null || timestamp > currentTimestamp) {
      deviceData.timestamps.set(path, timestamp);
      if (path.length > 1) {
        toClear = set(
          deviceData,
          path.slice(0, path.length - 1).toString(),
          timestamp,
          { object: [timestamp, 1] },
          toClear,
        );
      }
    }
  } else if (currentTimestamp == null || timestamp > currentTimestamp) {
    deviceData.timestamps.set(path, timestamp);

    if (currentAttributes) {
      deviceData.attributes.delete(path);
      changeFlags |= 1;
    } else if (path.wildcard) {
      for (const p of deviceData.paths.findCompat(
        path,
        false,
        true,
        path.length,
      )) {
        if (timestamp > deviceData.timestamps.get(p)!)
          toClear.push([p, timestamp]);
      }
    }
  }

  if (changeFlags) {
    if (changeFlags & 1) {
      toClear.push([path, timestamp, undefined, changeFlags]);
    } else if (changeFlags & CHANGE_FLAGS.object && attributes?.object) {
      toClear.push([path, 0, { object: attributes.object[0] }, changeFlags]);
    } else {
      for (const p of deviceData.paths.findCompat(
        path,
        true,
        false,
        path.length,
      )) {
        const tracker = deviceData.trackers.get(p);
        for (const k in tracker)
          if (tracker[k] & changeFlags) deviceData.changes.add(k);
      }
    }
  }

  return toClear;
}

export function track(
  deviceData: DeviceData,
  pathStr: string,
  marker: string,
  attributes?: string[],
): void {
  const path = deviceData.paths.add(pathStr);
  let f = 1;

  if (attributes)
    for (const attrName of attributes)
      f |= CHANGE_FLAGS[attrName as keyof typeof CHANGE_FLAGS];

  let cur = deviceData.trackers.get(path);
  if (!cur) {
    cur = {};
    deviceData.trackers.set(path, cur);
  }

  cur[marker] |= f;
}

export function clearTrackers(
  deviceData: DeviceData,
  tracker: string | string[],
): void {
  if (Array.isArray(tracker)) {
    for (const v of deviceData.trackers.values())
      for (const t of tracker) delete v[t];
    for (const t of tracker) deviceData.changes.delete(t);
  } else {
    for (const v of deviceData.trackers.values()) delete v[tracker];
    deviceData.changes.delete(tracker);
  }
}
