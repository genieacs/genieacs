/**
 * Copyright 2013-2019  Zaid Abdulla
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
import { evaluate } from "./common/expression";
import { Expression } from "./types";
import * as auth from "./auth";

function extractAuth(
  exp: Expression,
  context: {},
  now: number,
  dflt: any
): [string, string, Expression] {
  let username, password;
  exp = evaluate(exp, context, now, e => {
    if (!username && Array.isArray(e) && e[0] === "FUNC" && e[1] === "AUTH") {
      if (!Array.isArray(e[2]) && !Array.isArray(e[3])) {
        username = e[2];
        password = e[3];
      }
      return dflt;
    }
    return e;
  });

  return [username, password, exp];
}

function httpGet(
  options: {},
  timeout
): Promise<{ statusCode: number; headers: {} }> {
  return new Promise((resolve, reject) => {
    const req = http
      .get(options, res => {
        res.resume();
        resolve({ statusCode: res.statusCode, headers: res.headers });
      })
      .on("error", () => {
        req.abort();
        reject(new Error("Device is offline"));
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
  context: {},
  allowBasicAuth: boolean,
  timeout: number
): Promise<void> {
  const now = Date.now();
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
              Authorization: auth.digest(
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

    let res = await httpGet(opts, timeout);

    // Workaround for some devices unexpectedly closing the connection
    if (res.statusCode === 0 && authHeader) res = await httpGet(opts, timeout);
    if (res.statusCode === 0) throw new Error("Device is offline");
    if (res.statusCode === 200 || res.statusCode === 204) return;

    if (res.statusCode === 401 && res.headers["www-authenticate"]) {
      authHeader = auth.parseWwwAuthenticateHeader(
        res.headers["www-authenticate"]
      );
      [username, password, authExp] = extractAuth(authExp, context, now, false);
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
  context: {},
  sourcePort: number = 0
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

  [username, password, authExp] = extractAuth(authExp, context, now, null);
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
    const message = Buffer.from(
      `GET ${uri} HTTP/1.1\r\nHost: ${address}\r\n\r\n`
    );

    for (let i = 0; i < 3; ++i) {
      await new Promise((resolve, reject) => {
        client.send(message, 0, message.length, port, host, (err: Error) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }

    [username, password, authExp] = extractAuth(authExp, context, now, null);
  }
  client.close();
}
