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

import * as crypto from "crypto";
import * as dgram from "dgram";
import { parse } from "url";
import * as http from "http";
import { evaluateAsync } from "./common/expression";
import { Expression } from "./types";
import * as auth from "./auth";
import * as extensions from "./extensions";
import * as debug from "./debug";

async function extractAuth(
  exp: Expression,
  dflt: any
): Promise<[string, string, Expression]> {
  let username, password;
  const _exp = await evaluateAsync(
    exp,
    {},
    0,
    async (e: Expression): Promise<Expression> => {
      if (!username && Array.isArray(e) && e[0] === "FUNC") {
        if (e[1] === "EXT") {
          if (typeof e[2] !== "string" || typeof e[3] !== "string") return null;

          for (let i = 4; i < e.length; i++)
            if (Array.isArray(e[i])) return null;

          const { fault, value } = await extensions.run(e.slice(2));
          return fault ? null : value;
        } else if (e[1] === "AUTH") {
          if (!Array.isArray(e[2]) && !Array.isArray(e[3])) {
            username = e[2] || "";
            password = e[3] || "";
          }
          return dflt;
        }
      }
      return e;
    }
  );
  return [username, password, _exp];
}

function httpGet(
  options: http.RequestOptions,
  timeout,
  _debug: boolean,
  deviceId: string
): Promise<{ statusCode: number; headers: {} }> {
  return new Promise((resolve, reject) => {
    const req = http
      .get(options, res => {
        res.resume();
        resolve({ statusCode: res.statusCode, headers: res.headers });
        if (_debug) {
          debug.outgoingHttpRequest(req, deviceId, options, null);
          debug.incomingHttpResponse(res, deviceId, null);
        }
      })
      .on("error", err => {
        req.abort();
        reject(new Error("Device is offline"));
        if (_debug) debug.outgoingHttpRequestError(req, deviceId, options, err);
      })
      .on("socket", socket => {
        socket.setTimeout(timeout);
        socket.on("timeout", () => {
          req.abort();
        });
      });
  });
}

export async function httpConnectionRequest(
  address: string,
  authExp: Expression,
  allowBasicAuth: boolean,
  timeout: number,
  _debug: boolean,
  deviceId: string
): Promise<void> {
  const options: http.RequestOptions = parse(address);
  if (options.protocol !== "http:")
    throw new Error("Invalid connection request URL or protocol");

  options.agent = new http.Agent({
    maxSockets: 1,
    keepAlive: true
  });

  let authHeader: {};
  let username: string;
  let password: string;

  while (!authHeader || (username != null && password != null)) {
    let opts = options;
    if (authHeader) {
      if (authHeader["method"] === "Basic") {
        if (!allowBasicAuth)
          throw new Error("Basic HTTP authentication not allowed");

        opts = Object.assign(
          {
            headers: {
              Authorization: auth.basic(username || "", password || "")
            }
          },
          options
        );
      } else if (authHeader["method"] === "Digest") {
        opts = Object.assign(
          {
            headers: {
              Authorization: auth.solveDigest(
                username,
                password,
                options.path,
                "GET",
                null,
                authHeader
              )
            }
          },
          options
        );
      } else {
        throw new Error("Unrecognized auth method");
      }
    }

    let res = await httpGet(opts, timeout, _debug, deviceId);

    // Workaround for some devices unexpectedly closing the connection
    if (res.statusCode === 0 && authHeader)
      res = await httpGet(opts, timeout, _debug, deviceId);
    if (res.statusCode === 0) throw new Error("Device is offline");
    if (res.statusCode === 200 || res.statusCode === 204) return;

    if (res.statusCode === 401 && res.headers["www-authenticate"]) {
      authHeader = auth.parseWwwAuthenticateHeader(
        res.headers["www-authenticate"]
      );
      [username, password, authExp] = await extractAuth(authExp, false);
    } else {
      throw new Error(
        `Unexpected response code from device: ${res.statusCode}`
      );
    }
  }
  throw new Error("Incorrect connection request credentials");
}

export async function udpConnectionRequest(
  address: string,
  authExp: Expression,
  sourcePort: number = 0,
  _debug: boolean,
  deviceId: string
): Promise<void> {
  const [host, portStr] = address.split(":", 2);
  const port = portStr ? parseInt(portStr) : 80;
  const now = Date.now();

  const client = dgram.createSocket({ type: "udp4", reuseAddr: true });
  // When a device is NAT'ed, the UDP Connection Request must originate from
  // the same address and port used by the STUN server, in order to traverse
  // the firewall. This does require that the Genieacs NBI and STUN server
  // are allowed to bind to the same address and port. The STUN server needs
  // to open its UDP port with the SO_REUSEADDR option, allowing the NBI to
  // also bind to the same port.
  if (sourcePort) client.bind({ port: sourcePort, exclusive: true });

  let username: string;
  let password: string;

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
    const uri = `http://${address}?ts=${ts}&id=${id}&un=${username}&cn=${cn}&sig=${sig}`;
    const msg = `GET ${uri} HTTP/1.1\r\nHost: ${address}\r\n\r\n`;
    const message = Buffer.from(msg);

    for (let i = 0; i < 3; ++i) {
      await new Promise((resolve, reject) => {
        client.send(message, 0, message.length, port, host, (err: Error) => {
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
