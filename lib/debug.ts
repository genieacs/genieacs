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

import { IncomingMessage, ServerResponse, ClientRequest } from "http";
import { Socket } from "net";
import { appendFileSync } from "fs";
import { stringify } from "./common/yaml";
import * as config from "./config";
import { getSocketEndpoints } from "./server";

const DEBUG_FILE = "" + config.get("DEBUG_FILE");
const DEBUG_FORMAT = "" + config.get("DEBUG_FORMAT");

const connectionTimestamps = new WeakMap<Socket, Date>();

function getConnectionTimestamp(connection: Socket): Date {
  let t = connectionTimestamps.get(connection);
  if (!t) {
    t = new Date();
    connectionTimestamps.set(connection, t);
  }
  return t;
}

export function incomingHttpRequest(
  httpRequest: IncomingMessage,
  deviceId: string,
  body: string
): void {
  if (!DEBUG_FILE) return;
  const now = new Date();
  const con = httpRequest.socket;
  const socketEndpoints = getSocketEndpoints(con);
  const msg = {
    event: "incoming HTTP request",
    timestamp: now,
    remoteAddress: socketEndpoints.remoteAddress,
    deviceId: deviceId,
    connection: getConnectionTimestamp(con),
    localPort: socketEndpoints.localPort,
    method: httpRequest.method,
    url: httpRequest.url,
    headers: httpRequest.headers,
    body: body,
  };

  if (DEBUG_FORMAT === "yaml")
    appendFileSync(DEBUG_FILE, "---\n" + stringify(msg));
  else if (DEBUG_FORMAT === "json")
    appendFileSync(DEBUG_FILE, JSON.stringify(msg) + "\n");
  else throw new Error(`Unrecognized DEBUG_FORMAT option`);
}

export function outgoingHttpResponse(
  httpResponse: ServerResponse,
  deviceId: string,
  body: string
): void {
  if (!DEBUG_FILE) return;
  const now = new Date();
  const con = httpResponse.socket;
  const socketEndpoints = getSocketEndpoints(con);
  const msg = {
    event: "outgoing HTTP response",
    timestamp: now,
    remoteAddress: socketEndpoints.remoteAddress,
    deviceId: deviceId,
    connection: getConnectionTimestamp(con),
    statusCode: httpResponse.statusCode,
    headers: httpResponse.getHeaders(),
    body: body,
  };

  if (DEBUG_FORMAT === "yaml")
    appendFileSync(DEBUG_FILE, "---\n" + stringify(msg));
  else if (DEBUG_FORMAT === "json")
    appendFileSync(DEBUG_FILE, JSON.stringify(msg) + "\n");
  else throw new Error(`Unrecognized DEBUG_FORMAT option`);
}

export function outgoingHttpRequest(
  httpRequest: ClientRequest,
  deviceId: string,
  method: "GET" | "PUT" | "POST" | "DELETE",
  url: URL,
  body: string
): void {
  if (!DEBUG_FILE) return;
  const now = new Date();
  const con = httpRequest.socket;
  const msg = {
    event: "outgoing HTTP request",
    timestamp: now,
    remoteAddress: con.remoteAddress,
    deviceId: deviceId,
    connection: getConnectionTimestamp(con),
    remotePort: url.port,
    method: method,
    url: url.pathname + url.search,
    headers: httpRequest.getHeaders(),
    body: body,
  };

  if (DEBUG_FORMAT === "yaml")
    appendFileSync(DEBUG_FILE, "---\n" + stringify(msg));
  else if (DEBUG_FORMAT === "json")
    appendFileSync(DEBUG_FILE, JSON.stringify(msg) + "\n");
  else throw new Error(`Unrecognized DEBUG_FORMAT option`);
}

export function outgoingHttpRequestError(
  httpRequest: ClientRequest,
  deviceId: string,
  method: "GET" | "PUT" | "POST" | "DELETE",
  url: URL,
  err: Error
): void {
  if (!DEBUG_FILE) return;
  const now = new Date();
  const msg = {
    event: "outgoing HTTP request",
    timestamp: now,
    remoteAddress: url.hostname,
    deviceId: deviceId,
    connection: null,
    remotePort: url.port,
    method: method,
    url: url.pathname + url.search,
    headers: httpRequest.getHeaders(),
    error: err.message,
  };

  if (DEBUG_FORMAT === "yaml")
    appendFileSync(DEBUG_FILE, "---\n" + stringify(msg));
  else if (DEBUG_FORMAT === "json")
    appendFileSync(DEBUG_FILE, JSON.stringify(msg) + "\n");
  else throw new Error(`Unrecognized DEBUG_FORMAT option`);
}

export function incomingHttpResponse(
  httpResponse: IncomingMessage,
  deviceId: string,
  body: string
): void {
  if (!DEBUG_FILE) return;
  const now = new Date();
  const con = httpResponse.socket;
  const msg = {
    event: "incoming HTTP response",
    timestamp: now,
    remoteAddress: con.remoteAddress,
    deviceId: deviceId,
    connection: getConnectionTimestamp(httpResponse.socket),
    statusCode: httpResponse.statusCode,
    headers: httpResponse.headers,
    body: body,
  };

  if (DEBUG_FORMAT === "yaml")
    appendFileSync(DEBUG_FILE, "---\n" + stringify(msg));
  else if (DEBUG_FORMAT === "json")
    appendFileSync(DEBUG_FILE, JSON.stringify(msg) + "\n");
  else throw new Error(`Unrecognized DEBUG_FORMAT option`);
}

export function outgoingUdpMessage(
  remoteAddress: string,
  deviceId: string,
  remotePort: number,
  body: string
): void {
  if (!DEBUG_FILE) return;
  const now = new Date();
  const msg = {
    event: "outgoing UDP message",
    timestamp: now,
    remoteAddress: remoteAddress,
    deviceId: deviceId,
    remotePort: remotePort,
    body: body,
  };

  if (DEBUG_FORMAT === "yaml")
    appendFileSync(DEBUG_FILE, "---\n" + stringify(msg));
  else if (DEBUG_FORMAT === "json")
    appendFileSync(DEBUG_FILE, JSON.stringify(msg) + "\n");
  else throw new Error(`Unrecognized DEBUG_FORMAT option`);
}

export function clientError(remoteAddress: string, err: Error): void {
  if (!DEBUG_FILE) return;
  const now = new Date();
  const msg = {
    event: "client error",
    timestamp: now,
    remoteAddress: remoteAddress,
    error: err.message,
  };

  if (DEBUG_FORMAT === "yaml")
    appendFileSync(DEBUG_FILE, "---\n" + stringify(msg));
  else if (DEBUG_FORMAT === "json")
    appendFileSync(DEBUG_FILE, JSON.stringify(msg) + "\n");
  else throw new Error(`Unrecognized DEBUG_FORMAT option`);
}
