import Path from "./common/path.ts";
import * as config from "./config.ts";
import * as device from "./device.ts";
import * as scheduling from "./scheduling.ts";
import { SessionContext, Declaration } from "./types.ts";

const MAX_DEPTH = +config.get("MAX_DEPTH");

export function refresh(
  sessionContext: SessionContext,
  provision: (string | number | boolean)[],
  declarations: Declaration[],
): boolean {
  if (
    (provision.length !== 2 || typeof provision[1] !== "string") &&
    (provision.length !== 3 ||
      typeof provision[1] !== "string" ||
      typeof provision[2] !== "number") &&
    (provision.length < 4 ||
      typeof provision[1] !== "string" ||
      typeof provision[2] !== "number" ||
      typeof provision[3] !== "boolean")
  )
    throw new Error("Invalid arguments");

  const every = 1000 * ((provision[2] as number) || 1);
  const offset = scheduling.variance(sessionContext.deviceId, every);
  const t = scheduling.interval(sessionContext.timestamp, every, offset);

  let attrGet;
  let refreshChildren;
  if (provision[3] == null) {
    refreshChildren = true;
    attrGet = { object: 1, writable: 1, value: t };
  } else {
    attrGet = {};
    refreshChildren = !!provision[3];
    for (const a of provision.slice(4)) attrGet[a as string] = t;
  }

  let path = Path.parse(provision[1]);
  let l = path.length;
  if (refreshChildren) {
    const segments = path.segments.slice();
    l = segments.length;
    segments.length = MAX_DEPTH;
    segments.fill("*", l);
    path = Path.parse(segments.join("."));
  }

  for (let i = l; i <= path.length; ++i) {
    declarations.push({
      path: path.slice(0, i),
      pathGet: t,
      pathSet: null,
      attrGet: attrGet,
      attrSet: null,
      defer: true,
    });
  }

  return true;
}

export function value(
  sessionContext: SessionContext,
  provision: (string | number | boolean)[],
  declarations: Declaration[],
): boolean {
  if (
    provision.length < 3 ||
    provision.length > 4 ||
    typeof provision[1] !== "string"
  )
    throw new Error("Invalid arguments");

  let attr: string, val: any;

  if (provision.length === 3) {
    attr = "value";
    val = provision[2];
  } else {
    attr = (provision[2] as string) || "";
    val = provision[3];
  }

  if (attr === "accessList") {
    val = (val || "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => !!s);
  } else if (attr === "value") {
    val = [val];
  }

  declarations.push({
    path: Path.parse(provision[1]),
    pathGet: 1,
    pathSet: null,
    attrGet: { [attr]: 1 },
    attrSet: { [attr]: val },
    defer: true,
  });

  return true;
}

export function tag(
  sessionContext: SessionContext,
  provision: (string | number | boolean)[],
  declarations: Declaration[],
): boolean {
  if (
    provision.length !== 3 ||
    typeof provision[1] !== "string" ||
    typeof provision[2] !== "boolean"
  )
    throw new Error("Invalid arguments");

  declarations.push({
    path: Path.parse(`Tags.${provision[1]}`),
    pathGet: 1,
    pathSet: null,
    attrGet: { value: 1 },
    attrSet: { value: [provision[2]] },
    defer: true,
  });

  return true;
}

export function reboot(
  sessionContext: SessionContext,
  provision: (string | number | boolean)[],
  declarations: Declaration[],
): boolean {
  if (provision.length !== 1) throw new Error("Invalid arguments");

  declarations.push({
    path: Path.parse("Reboot"),
    pathGet: 1,
    pathSet: null,
    attrGet: { value: 1 },
    attrSet: { value: [sessionContext.timestamp] },
    defer: true,
  });

  return true;
}

export function reset(
  sessionContext: SessionContext,
  provision: (string | number | boolean)[],
  declarations: Declaration[],
): boolean {
  if (provision.length !== 1) throw new Error("Invalid arguments");

  declarations.push({
    path: Path.parse("FactoryReset"),
    pathGet: 1,
    pathSet: null,
    attrGet: { value: 1 },
    attrSet: { value: [sessionContext.timestamp] },
    defer: true,
  });

  return true;
}

export function download(
  sessionContext: SessionContext,
  provision: (string | number | boolean)[],
  declarations: Declaration[],
): boolean {
  if (
    (provision.length !== 3 ||
      typeof provision[1] !== "string" ||
      typeof provision[2] !== "string") &&
    (provision.length !== 4 ||
      typeof provision[1] !== "string" ||
      typeof provision[2] !== "string" ||
      typeof provision[3] !== "string")
  )
    throw new Error("Invalid arguments");

  const alias = [
    `FileType:${JSON.stringify(provision[1] || "")}`,
    `FileName:${JSON.stringify(provision[2] || "")}`,
    `TargetFileName:${JSON.stringify(provision[3] || "")}`,
  ].join(",");

  declarations.push({
    path: Path.parse(`Downloads.[${alias}]`),
    pathGet: 1,
    pathSet: 1,
    attrGet: null,
    attrSet: null,
    defer: true,
  });

  declarations.push({
    path: Path.parse(`Downloads.[${alias}].Download`),
    pathGet: 1,
    pathSet: null,
    attrGet: { value: 1 },
    attrSet: { value: [sessionContext.timestamp] },
    defer: true,
  });

  return true;
}

export function instances(
  sessionContext: SessionContext,
  provision: (string | number | boolean)[],
  declarations: Declaration[],
  startRevision: number,
  endRevision: number,
): boolean {
  if (provision.length !== 3 || typeof provision[1] !== "string")
    throw new Error("Invalid arguments");

  let count = Number(provision[2]);

  if (Number.isNaN(count)) throw new Error("Invalid arguments");

  const path = Path.parse(provision[1]);

  if (provision[2][0] === "+" || provision[2][0] === "-") {
    declarations.push({
      path: path,
      pathGet: 1,
      pathSet: null,
      attrGet: null,
      attrSet: null,
      defer: true,
    });

    if (endRevision === startRevision) return false;

    const unpacked = device.unpack(
      sessionContext.deviceData,
      path,
      startRevision + 1,
    );
    count = Math.max(0, unpacked.length + count);
  }

  declarations.push({
    path: path,
    pathGet: 1,
    pathSet: count,
    attrGet: null,
    attrSet: null,
    defer: true,
  });

  return true;
}
