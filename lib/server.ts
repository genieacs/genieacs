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

import * as fs from "fs";
import * as http from "http";
import * as https from "https";
import { Socket } from "net";
import * as path from "path";
import { ROOT_DIR } from "./config";

let server: http.Server | https.Server;
let listener: (...args) => void;

function closeServer(timeout, callback): void {
  if (!server) return void callback();

  setTimeout(() => {
    if (!callback) return;

    // Ignore HTTP requests from connection that may still be open
    server.removeListener("request", listener);
    server.setTimeout(1);

    const cb = callback;
    callback = null;
    setTimeout(cb, 1000);
  }, timeout).unref();

  server.close(() => {
    if (!callback) return;

    const cb = callback;
    callback = null;
    // Allow some time for connection close events to fire
    setTimeout(cb, 50);
  });
}

interface ServerOptions {
  port?: number;
  host?: string;
  ssl?: { key: string; cert: string };
  timeout?: number;
  keepAliveTimeout?: number;
  onConnection?: (socket: Socket) => void;
  onClientError?: (err: Error, socket: Socket) => void;
}

interface SocketEndpoint {
  localAddress: string;
  localPort: number;
  remoteAddress: string;
  remotePort: number;
  remoteFamily: "IPv4" | "IPv6";
}

// Save this info as they're not accessible after a socket has been closed
const socketEndpoints: WeakMap<Socket, SocketEndpoint> = new WeakMap();

export function start(
  options: ServerOptions,
  _listener: http.RequestListener
): void {
  listener = _listener;

  if (options.ssl) {
    const opts = {
      key: options.ssl.key
        .split(":")
        .map((f) => fs.readFileSync(path.resolve(ROOT_DIR, f.trim()))),
      cert: options.ssl.cert
        .split(":")
        .map((f) => fs.readFileSync(path.resolve(ROOT_DIR, f.trim()))),
    };

    server = https.createServer(opts, listener);
    if (options.onConnection)
      server.on("secureConnection", options.onConnection);
  } else {
    server = http.createServer(listener);
    if (options.onConnection) server.on("connection", options.onConnection);
  }

  server.on("connection", (socket: Socket) => {
    socketEndpoints.set(socket, {
      localAddress: socket.localAddress,
      localPort: socket.localPort,
      remoteAddress: socket.remoteAddress,
      remotePort: socket.remotePort,
      remoteFamily: socket.remoteFamily as "IPv4" | "IPv6",
    });
  });

  if (options.onClientError) {
    server.on("clientError", (err, socket: Socket) => {
      if (err["code"] !== "ECONNRESET" && socket.writable)
        socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");

      // As per Node docs: This event is guaranteed to be passed an instance
      // of the <net.Socket> class
      options.onClientError(err, socket as Socket);
    });
  }

  server.timeout = options.timeout || 0;
  if (options.keepAliveTimeout != null)
    server.keepAliveTimeout = options.keepAliveTimeout;
  server.listen({ port: options.port, host: options.host });
}

export function stop(): Promise<void> {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      reject(new Error("Could not close server in a timely manner"));
    }, 30000).unref();
    closeServer(20000, resolve);
  });
}

export function getSocketEndpoints(socket: Socket): SocketEndpoint {
  // TLSSocket keeps a reference to the raw TCP socket in _parent
  return socketEndpoints.get(socket["_parent"] ?? socket);
}
