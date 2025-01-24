import * as crypto from "node:crypto";
import * as later from "@breejs/later";

function md532(str): number {
  const digest = crypto.createHash("md5").update(str).digest();
  return (
    digest.readUInt32LE(0) ^
    digest.readUInt32LE(4) ^
    digest.readUInt32LE(8) ^
    digest.readUInt32LE(12)
  );
}

export function variance(deviceId: string, vrnc: number): number {
  return (md532(deviceId) >>> 0) % vrnc;
}

export function interval(
  timestamp: number,
  intrvl: number,
  offset = 0,
): number {
  return Math.trunc((timestamp + offset) / intrvl) * intrvl - offset;
}

export function parseCron(cronExp: string): any {
  const parts = cronExp.trim().split(/\s+/);
  if (parts.length === 5) parts.unshift("*");

  return later.schedule(later.parse.cron(parts.join(" "), true));
}

export function cron(
  timestamp: number,
  schedule: unknown,
  offset = 0,
): number[] {
  // TODO later.js doesn't throw erorr if expression is invalid!
  const ret = [0, 0];

  const prev = (schedule as any).prev(1, new Date(timestamp + offset));
  if (prev) ret[0] = prev.setMilliseconds(0) - offset;

  const next = (schedule as any).next(1, new Date(timestamp + offset + 1000));
  if (next) ret[1] = next.setMilliseconds(0) - offset;

  return ret;
}
