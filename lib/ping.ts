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

import { platform } from "os";
import { exec } from "child_process";
import { domainToASCII } from "url";

export interface PingResult {
  packetsTransmitted: number;
  packetsReceived: number;
  packetLoss: number;
  min: number;
  avg: number;
  max: number;
  mdev: number;
}

function isValidHost(host: string): boolean {
  // Valid chars in IPv4, IPv6, domain names
  if (/^[a-zA-Z0-9\-.:[\]-]+$/.test(host)) return true;

  // Check if input is an IDN convert to Punycode
  // Can't merge with above because domainToASCII doesn't accept IP addresses
  return /^[a-zA-Z0-9\-.:[\]-]+$/.test(domainToASCII(host));
}

export function parsePing(osPlatform: string, stdout: string): PingResult {
  let parseRegExp1: RegExp, parseRegExp2: RegExp, parsed: PingResult;
  switch (osPlatform) {
    case "linux":
      parseRegExp1 =
        /(\d+) packets transmitted, (\d+) .*received, ([\d.]+)% .*loss[^]*= ([\d.]+)\/([\d.]+)\/([\d.]+)\/([\d.]+)/;
      parseRegExp2 =
        /(\d+) packets transmitted, (\d+) .*received, ([\d.]+)% .*loss/;
      break;

    case "freebsd":
      parseRegExp1 =
        /(\d+) packets transmitted, (\d+) packets received, ([\d.]+)% packet loss\nround-trip min\/avg\/max\/stddev = ([\d.]+)\/([\d.]+)\/([\d.]+)\/([\d.]+) ms/;
      parseRegExp2 =
        /(\d+) packets transmitted, (\d+) packets received, ([\d.]+)% packet loss/;
      break;
  }

  const m1 = stdout.match(parseRegExp1);
  if (m1) {
    parsed = {
      packetsTransmitted: +m1[1],
      packetsReceived: +m1[2],
      packetLoss: +m1[3],
      min: +m1[4],
      avg: +m1[5],
      max: +m1[6],
      mdev: +m1[7],
    };
  } else {
    const m2 = stdout.match(parseRegExp2);
    if (m2) {
      parsed = {
        packetsTransmitted: +m2[1],
        packetsReceived: +m2[2],
        packetLoss: +m2[3],
        min: null,
        avg: null,
        max: null,
        mdev: null,
      };
    }
  }
  return parsed;
}

export function ping(
  host: string,
  callback: (err: Error, res?: PingResult, stdout?: string) => void
): void {
  // Validate input to prevent possible remote code execution
  // Credit to Alex Hordijk for reporting this vulnerability
  if (!isValidHost(host)) return callback(new Error("Invalid host"));
  host = host.replace("[", "").replace("]", "");
  let cmd: string;

  switch (platform()) {
    case "linux":
      cmd = `ping -w 1 -i 0.2 -c 3 ${host}`;
      break;
    case "freebsd":
      // Send a single packet because on FreeBSD only superuser can send
      // packets that are only 200 ms apart.
      cmd = `ping -t 1 -c 3 ${host}`;
      break;
    default:
      return callback(new Error("Platform not supported"));
  }

  exec(cmd, (err, stdout) => {
    if (err) return callback(err);
    const parsed: PingResult = parsePing(platform(), stdout);
    return callback(err, parsed, stdout);
  });
}
