import { IncomingMessage } from "node:http";
import { TLSSocket } from "node:tls";
import { parseCIDR, parse, IPv6, IPv4 } from "ipaddr.js";
import * as config from "./config.ts";
import { getSocketEndpoints } from "./server.ts";

interface RequestOrigin {
  localAddress: string;
  localPort: number;
  remoteAddress: string;
  remotePort: number;
  host: string;
  encrypted: boolean;
}

const FORWARDED_HEADER = "" + config.get("FORWARDED_HEADER");
const cache = new WeakMap<IncomingMessage, RequestOrigin>();
const cidrs: [IPv4 | IPv6, number][] = [];

for (const str of FORWARDED_HEADER.split(",").map((s) => s.trim())) {
  try {
    cidrs.push(parseCIDR(str));
  } catch (err) {
    // Not a valid CIDR format, try parsing as IP
    try {
      const ip = parse(str);
      cidrs.push([ip, ip.toByteArray().length * 8]);
    } catch (err) {
      // Not a valid IP either, ignore
    }
  }
}

function parseForwardedHeader(str: string): { [name: string]: string } {
  str = str.toLowerCase();
  const res: { [name: string]: string } = {};
  let keyIdx = 0;
  let valueIdx = -1;
  let key: string;
  for (let i = 0; i < str.length; ++i) {
    const char = str.charCodeAt(i);
    if (char === 61 /* = */) {
      if (keyIdx >= 0) {
        key = str.slice(keyIdx, i).trim();
        keyIdx = -1;
        valueIdx = i + 1;
      }
    } else if (char === 59 /* ; */) {
      if (valueIdx >= 0) res[key] = str.slice(valueIdx, i).trim();
      valueIdx = -1;
      keyIdx = i + 1;
    } else if (char === 44 /* , */) {
      if (valueIdx >= 0) res[key] = str.slice(valueIdx, i).trim();
      return res;
    } else if (char === 34 /* " */) {
      if (valueIdx >= 0) {
        const quoteIdx = i;
        if (!str.slice(valueIdx, quoteIdx).trim()) {
          for (i = i + 1; i < str.length; ++i) {
            const c = str.charCodeAt(i);
            if (c === 92 /* \ */) ++i;
            if (c === 34 /* " */) {
              res[key] = JSON.parse(str.slice(quoteIdx, i + 1).trim());
              valueIdx = -1;
              keyIdx = i + 1;
              break;
            }
          }
        }
      }
    }
  }

  if (valueIdx >= 0) res[key] = str.slice(valueIdx).trim();

  return res;
}

export function getRequestOrigin(request: IncomingMessage): RequestOrigin {
  let origin = cache.get(request);
  if (!origin) {
    const soc = request.socket;
    const socketEndpoints = getSocketEndpoints(soc);
    origin = {
      localAddress: socketEndpoints.localAddress,
      localPort: socketEndpoints.localPort,
      remoteAddress: socketEndpoints.remoteAddress,
      remotePort: socketEndpoints.remotePort,
      host: request.headers["host"],
      encrypted: !!(request.socket as TLSSocket).encrypted,
    };

    const header = request.headers["forwarded"];
    if (header) {
      const ip = parse(socketEndpoints.remoteAddress);
      if (
        cidrs.some((cidr) => ip.kind() === cidr[0].kind() && ip.match(cidr))
      ) {
        const parsed = parseForwardedHeader(header);

        if (parsed["proto"] === "https") {
          origin.encrypted = true;
          origin.localPort = 443;
        } else if (parsed["proto"] === "http") {
          origin.encrypted = false;
          origin.localPort = 80;
        }

        if (parsed["host"]) {
          origin.host = parsed["host"];
          const [, port] = parsed["host"].split(":", 2);
          origin.localPort = +port || origin.localPort;
        }

        if (parsed["for"]) {
          if (parsed["for"].startsWith("[")) {
            const i = parsed["for"].lastIndexOf("]");
            if (i >= 0) {
              origin.remoteAddress = parsed["for"].slice(1, i);
              origin.remotePort =
                parseInt(parsed["for"].slice(i + 2)) || origin.remotePort;
            }
          } else {
            const i = parsed["for"].lastIndexOf(":");
            if (i >= 0) {
              origin.remoteAddress = parsed["for"].slice(0, i);
              origin.remotePort =
                parseInt(parsed["for"].slice(i + 1)) || origin.remotePort;
            } else {
              origin.remoteAddress = parsed["for"];
            }
          }
        }

        if (parsed["by"]) {
          if (parsed["by"].startsWith("[")) {
            const i = parsed["by"].lastIndexOf("]");
            if (i >= 0) {
              origin.localAddress = parsed["by"].slice(1, i);
              origin.localPort =
                parseInt(parsed["by"].slice(i + 2)) || origin.localPort;
            }
          } else {
            const i = parsed["by"].lastIndexOf(":");
            if (i >= 0) {
              origin.localAddress = parsed["by"].slice(0, i);
              origin.localPort =
                parseInt(parsed["by"].slice(i + 1)) || origin.localPort;
            } else {
              origin.localAddress = parsed["by"];
            }
          }
        }
      }
    }

    cache.set(request, origin);
  }
  return origin;
}
