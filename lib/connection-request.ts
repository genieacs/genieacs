import * as crypto from "node:crypto";
import * as dgram from "node:dgram";
import * as http from "node:http";
import Expression, { Value } from "./common/expression.ts";
import * as auth from "./auth.ts";
import * as extensions from "./extensions.ts";
import * as debug from "./debug.ts";
import XmppClient from "./xmpp-client.ts";
import * as config from "../lib/config.ts";
import { encodeEntities, parseAttrs, Element } from "./xml-parser.ts";
import * as logger from "../lib/logger.ts";
import * as dns from "node:dns/promises";
import * as net from "node:net";

function ipv4ToInt(ip: string): number {
  const p = ip.split(".");
  return ((+p[0] << 24) | (+p[1] << 16) | (+p[2] << 8) | +p[3]) >>> 0;
}

function ipv4InCidr(ipInt: number, network: string, bits: number): boolean {
  const netInt = ipv4ToInt(network);
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipInt & mask) === (netInt & mask);
}

function isReservedIPv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  return (
    ipv4InCidr(n, "0.0.0.0", 8) ||
    ipv4InCidr(n, "10.0.0.0", 8) ||
    ipv4InCidr(n, "100.64.0.0", 10) ||
    ipv4InCidr(n, "127.0.0.0", 8) ||
    ipv4InCidr(n, "169.254.0.0", 16) ||
    ipv4InCidr(n, "172.16.0.0", 12) ||
    ipv4InCidr(n, "192.168.0.0", 16)
  );
}

function isReservedIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isReservedIPv4(mapped[1]);
  if (lower === "::1" || lower === "::") return true;
  const firstHextet = parseInt(lower.split(":")[0] || "", 16);
  if (!Number.isNaN(firstHextet)) {
    if ((firstHextet & 0xfe00) === 0xfc00) return true; // fc00::/7 (ULA)
    if ((firstHextet & 0xffc0) === 0xfe80) return true; // fe80::/10 (link-local)
  }
  return false;
}

function isReservedAddress(ip: string): boolean {
  if (net.isIPv4(ip)) return isReservedIPv4(ip);
  if (net.isIPv6(ip)) return isReservedIPv6(ip);
  return true; // not a recognizable IP literal -> treat as unsafe
}

// Reject connection-request URLs whose host resolves to a loopback, link-local,
// or private address. This closes the SSRF + credential-leak primitive where
// the ACS answers Digest/Basic challenges from an attacker host using the
// device's stored connection-request credentials. DNS names are resolved and
// every returned address is checked. Set CONNECTION_REQUEST_ALLOW_PRIVATE=true
// to opt out (e.g. a management network where CPEs share the ACS's RFC1918
// range).
async function isConnectionRequestHostAllowed(
  hostname: string,
): Promise<boolean> {
  const allowPrivate = String(config.get("CONNECTION_REQUEST_ALLOW_PRIVATE"))
    .trim()
    .toLowerCase();
  if (allowPrivate === "true" || allowPrivate === "1") return true;
  let addresses: string[];
  if (net.isIP(hostname)) {
    addresses = [hostname];
  } else {
    try {
      const resolved = await dns.lookup(hostname, { all: true });
      addresses = resolved.map((r) => r.address);
    } catch {
      return false;
    }
    if (addresses.length === 0) return false;
  }
  return addresses.every((a) => !isReservedAddress(a));
}

async function extractAuth(
  exp: Expression,
  dflt: Value,
): Promise<[string | undefined, string | undefined, Expression]> {
  let username: string | undefined;
  let password: string | undefined;
  const _exp = await exp.evaluateAsync(
    async (e: Expression): Promise<Expression> => {
      if (e instanceof Expression.Parameter)
        return new Expression.Literal(null);
      if (e instanceof Expression.FunctionCall) {
        if (e.name === "NOW") return new Expression.Literal(0);
        if (!username) {
          if (e.name === "EXT") {
            if (!e.args.every((a) => a instanceof Expression.Literal))
              return new Expression.Literal(null);
            const args = e.args.map((a) => String(a.value));
            if (typeof args[0] !== "string" || typeof args[1] !== "string")
              return new Expression.Literal(null);

            const { fault, value } = await extensions.run(args);
            if (fault) return new Expression.Literal(null);
            return new Expression.Literal(value);
          } else if (e.name === "AUTH") {
            if (e.args.every((a) => a instanceof Expression.Literal)) {
              username = `${e.args[0].value ?? ""}`;
              password = `${e.args[1].value ?? ""}`;
            }
            return new Expression.Literal(dflt);
          }
        }
      }
      return e;
    },
  );
  return [username, password, _exp];
}

function httpGet(
  url: URL,
  options: http.RequestOptions,
  _debug: boolean,
  deviceId: string,
): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const req = http
      .get(url, options, (res) => {
        res.resume();
        resolve({ statusCode: res.statusCode ?? 0, headers: res.headers });
        if (_debug) {
          debug.outgoingHttpRequest(req, deviceId, "GET", url, null);
          debug.incomingHttpResponse(res, deviceId, null);
        }
      })
      .on("error", (err) => {
        req.destroy();
        reject(err);
        if (_debug)
          debug.outgoingHttpRequestError(req, deviceId, "GET", url, err);
      })
      .on("timeout", () => {
        req.destroy();
      });
  });
}

export async function httpConnectionRequest(
  address: string,
  authExp: Expression,
  allowBasicAuth: boolean,
  timeout: number,
  _debug: boolean,
  deviceId: string,
): Promise<string> {
  const url = new URL(address);
  if (url.protocol !== "http:")
    return "Invalid connection request URL or protocol";

  if (!(await isConnectionRequestHostAllowed(url.hostname)))
    return "Connection request URL host not allowed";

  const options: http.RequestOptions = {
    agent: new http.Agent({ maxSockets: 1, keepAlive: true, timeout: timeout }),
  };

  let authHeader: Record<string, string> | undefined;
  let username: string | undefined;
  let password: string | undefined;

  while (!authHeader || (username != null && password != null)) {
    let opts = options;
    if (authHeader) {
      if (authHeader["method"] === "Basic") {
        if (!allowBasicAuth) return "Basic HTTP authentication not allowed";

        opts = Object.assign(
          {
            headers: {
              Authorization: auth.basic(username ?? "", password ?? ""),
            },
          },
          options,
        );
      } else if (authHeader["method"] === "Digest") {
        opts = Object.assign(
          {
            headers: {
              Authorization: auth.solveDigest(
                username ?? "",
                password ?? "",
                url.pathname + url.search,
                "GET",
                "",
                authHeader,
              ),
            },
          },
          options,
        );
      } else {
        return "Unrecognized auth method";
      }
    }

    let res: { statusCode: number; headers: http.IncomingHttpHeaders };
    try {
      res = await httpGet(url, opts, _debug, deviceId);
    } catch (err) {
      if (!(err instanceof Error)) throw err;
      // Workaround for some devices unexpectedly closing the connection
      if (authHeader) {
        try {
          res = await httpGet(url, opts, _debug, deviceId);
        } catch (err) {
          if (!(err instanceof Error)) throw err;
          return `Connection request error: ${err.message}`;
        }
      }

      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ECONNRESET" || code === "ECONNREFUSED")
        return "Device is offline";

      return `Connection request error: ${err.message}`;
    }

    if (res.statusCode === 200 || res.statusCode === 204) return "";

    // When a Connection Request is received for the Virtual CWMP Device and the Proxied
    // Device is offline the CPE Proxier MUST respond with an HTTP 503 failure
    if (res.statusCode === 503) return "Device is offline";

    if (res.statusCode === 401 && res.headers["www-authenticate"]) {
      try {
        authHeader = auth.parseWwwAuthenticateHeader(
          res.headers["www-authenticate"],
        );
      } catch {
        return "Connection request error: Error parsing www-authenticate header";
      }
      [username, password, authExp] = await extractAuth(authExp, false);
    } else {
      return `Connection request error: Unexpected status code ${res.statusCode}`;
    }
  }

  return "Connection request error: Incorrect connection request credentials";
}

export async function udpConnectionRequest(
  host: string,
  port: number,
  authExp: Expression,
  sourcePort = 0,
  _debug: boolean,
  deviceId: string,
): Promise<void> {
  const now = Date.now();

  const client = dgram.createSocket({ type: "udp4", reuseAddr: true });
  // When a device is NAT'ed, the UDP Connection Request must originate from
  // the same address and port used by the STUN server, in order to traverse
  // the firewall. This does require that the Genieacs NBI and STUN server
  // are allowed to bind to the same address and port. The STUN server needs
  // to open its UDP port with the SO_REUSEADDR option, allowing the NBI to
  // also bind to the same port.
  if (sourcePort) client.bind({ port: sourcePort, exclusive: true });

  let username: string | undefined;
  let password: string | undefined;

  [username, password, authExp] = await extractAuth(authExp, null);

  if (username == null) username = "";
  if (password == null) password = "";
  while (username != null && password != null) {
    const ts = Math.trunc(now / 1000);
    const id = Math.trunc(Math.random() * 4294967295);
    const cn = crypto.randomBytes(8).toString("hex");
    const sig = crypto
      .createHmac("sha1", password)
      .update(`${ts}${id}${username}${cn}`)
      .digest("hex");
    const uri = `http://${host}:${port}?ts=${ts}&id=${id}&un=${username}&cn=${cn}&sig=${sig}`;
    const msg = `GET ${uri} HTTP/1.1\r\nHost: ${host}:${port}\r\n\r\n`;
    const message = Buffer.from(msg);

    for (let i = 0; i < 3; ++i) {
      await new Promise<void>((resolve, reject) => {
        client.send(message, 0, message.length, port, host, (err) => {
          if (err) reject(err);
          else resolve();
          if (_debug) debug.outgoingUdpMessage(host, deviceId, port, msg);
        });
      });
    }

    [username, password, authExp] = await extractAuth(authExp, null);
  }
  client.close();
}

const XMPP_JID = config.get("XMPP_JID") as string;
const XMPP_PASSWORD = config.get("XMPP_PASSWORD") as string;
const XMPP_RESOURCE = crypto.randomBytes(8).toString("hex");

let xmppClient: XmppClient | null;

function xmppClientOnError(err: Error): void {
  xmppClient = null;
  logger.error({
    message: "XMPP exception",
    exception: err,
    pid: process.pid,
  });
}

function xmppClientOnClose(): void {
  xmppClient = null;
}

export async function xmppConnectionRequest(
  jid: string,
  authExp: Expression,
  timeout: number,
  _debug: boolean,
  deviceId: string,
): Promise<string> {
  if (!xmppClient) {
    const [host, username] = XMPP_JID.split("@").reverse();
    xmppClient = await XmppClient.connect({
      host,
      username,
      resource: XMPP_RESOURCE,
      password: XMPP_PASSWORD,
      timeout: 120000,
    });
    xmppClient.on("error", xmppClientOnError);
    xmppClient.on("close", xmppClientOnClose);
    xmppClient.unref();
  }

  let username: string | undefined;
  let password: string | undefined;

  [username, password, authExp] = await extractAuth(authExp, null);
  while (username != null && password != null) {
    const msg = `<connectionRequest xmlns="urn:broadband-forum-org:cwmp:xmppConnReq-1-0"><username>${encodeEntities(
      username,
    )}</username><password>${encodeEntities(
      password,
    )}</password></connectionRequest>`;
    let res: Element, rawRes: string, rawReq: string;
    try {
      ({ res, rawRes, rawReq } = await xmppClient.sendIqStanza(
        XMPP_JID,
        jid,
        "get",
        msg,
        timeout,
      ));
    } catch (err) {
      if (!(err instanceof Error)) throw err;
      return err.message;
    }
    if (_debug) {
      debug.outgoingXmppStanza(deviceId, rawReq);
      debug.incomingXmppStanza(deviceId, rawRes);
    }
    const attrs = parseAttrs(res.attrs);
    const type = attrs.find((a) => a.name === "type");
    if (type && type.value === "result") return "";
    const error = res.children.find((c) => c.name === "error");
    if (!error || !error.children[0])
      return "Unexpected XMPP connection request response";
    if (error.children[0].name === "service-unavailable")
      return "Device is offline";
    if (error.children[0].name !== "not-authorized")
      return "Unexpected XMPP connection request response";
    [username, password, authExp] = await extractAuth(authExp, null);
  }
  return "Incorrect connection request credentials";
}
