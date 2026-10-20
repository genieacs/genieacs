import { platform } from "node:os";
import { execFile } from "node:child_process";
import { domainToASCII, domainToUnicode } from "node:url";

export interface PingResult {
  packetsTransmitted: number;
  packetsReceived: number;
  packetLoss: number;
  min: number | null;
  avg: number | null;
  max: number | null;
  mdev: number | null;
}

function isValidHost(host: string): boolean {
  // Valid chars in IPv4, IPv6, domain names
  if (/^[a-zA-Z0-9\-.:[\]-]+$/.test(host)) return true;

  const lowercase = host.toLowerCase();
  const ascii = domainToASCII(lowercase);

  // Check if input is an IDN convert to Punycode
  // Can't merge with above because domainToASCII doesn't accept IP addresses
  if (!/^[a-zA-Z0-9\-.:[\]-]+$/.test(ascii)) return false;

  // Round-trip to ensure the original host matches its normalized form. This
  // rejects inputs that domainToASCII silently strips (e.g. "example.com/;id").
  return lowercase === domainToUnicode(ascii);
}

export function parsePing(
  osPlatform: string,
  stdout: string,
): PingResult | undefined {
  let parseRegExp1: RegExp | undefined,
    parseRegExp2: RegExp | undefined,
    parsed: PingResult | undefined;
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
    default:
      return undefined;
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
  callback: (err: Error | null, res?: PingResult, stdout?: string) => void,
): void {
  // Validate input to prevent possible remote code execution
  // Credit to Alex Hordijk for reporting this vulnerability
  // Credit to JuHwiSang for reporting a follow-up vulnerability
  if (!isValidHost(host)) return callback(new Error("Invalid host"));
  host = host.replace("[", "").replace("]", "");
  let args: string[];

  switch (platform()) {
    case "linux":
      // "--" terminates option parsing so a leading "-" in host cannot inject
      // ping flags (argument injection).
      args = ["-w", "1", "-i", "0.2", "-c", "3", "--", host];
      break;
    case "freebsd":
      // Send a single packet because on FreeBSD only superuser can send
      // packets that are only 200 ms apart.
      args = ["-t", "1", "-c", "3", "--", host];
      break;
    default:
      return callback(new Error("Platform not supported"));
  }

  // Use execFile instead of exec to avoid shell interpretation of the host
  execFile("ping", args, (err, stdout) => {
    if (err) return callback(err);
    const parsed = parsePing(platform(), stdout);
    return callback(err, parsed, stdout);
  });
}
