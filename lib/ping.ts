import { platform } from "node:os";
import { exec } from "node:child_process";
import { domainToASCII } from "node:url";

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
        /(\d+) packets transmitted, (\d+) .*received, ([\d.]+)% .*loss[^]*= ([\d.]+)\/([\d.]+)\/([\d.]+)\/?([\d.]+)/;
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
  callback: (err: Error, res?: PingResult, stdout?: string) => void,
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
