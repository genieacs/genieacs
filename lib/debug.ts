import { IncomingMessage, ServerResponse, ClientRequest } from "node:http";
import { Socket } from "node:net";
import { appendFileSync } from "node:fs";
import { stringify } from "./common/yaml.ts";
import * as config from "./config.ts";
import { getSocketEndpoints } from "./server.ts";

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
  body: string,
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
  body: string,
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
  body: string,
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
  err: Error,
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
  body: string,
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
  body: string,
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

export function outgoingXmppStanza(deviceId: string, body: string): void {
  if (!DEBUG_FILE) return;
  const now = new Date();
  const msg = {
    event: "outgoing XMPP stanza",
    timestamp: now,
    deviceId: deviceId,
    body: body,
  };

  if (DEBUG_FORMAT === "yaml")
    appendFileSync(DEBUG_FILE, "---\n" + stringify(msg));
  else if (DEBUG_FORMAT === "json")
    appendFileSync(DEBUG_FILE, JSON.stringify(msg) + "\n");
  else throw new Error(`Unrecognized DEBUG_FORMAT option`);
}

export function incomingXmppStanza(deviceId: string, body: string): void {
  if (!DEBUG_FILE) return;
  const now = new Date();
  const msg = {
    event: "incoming XMPP stanza",
    timestamp: now,
    deviceId: deviceId,
    body: body,
  };

  if (DEBUG_FORMAT === "yaml")
    appendFileSync(DEBUG_FILE, "---\n" + stringify(msg));
  else if (DEBUG_FORMAT === "json")
    appendFileSync(DEBUG_FILE, JSON.stringify(msg) + "\n");
  else throw new Error(`Unrecognized DEBUG_FORMAT option`);
}
