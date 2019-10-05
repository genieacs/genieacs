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

export function start(
  port,
  networkInterface,
  ssl,
  _listener,
  onConnection?,
  keepAliveTimeout: number = -1
): void {
  listener = _listener;

  if (ssl && ssl.key && ssl.cert) {
    const options = {
      key: ssl.key
        .split(":")
        .map(f => fs.readFileSync(path.resolve(ROOT_DIR, f.trim()))),
      cert: ssl.cert
        .split(":")
        .map(f => fs.readFileSync(path.resolve(ROOT_DIR, f.trim())))
    };

    server = https.createServer(options, listener);
    if (onConnection != null) server.on("secureConnection", onConnection);
  } else {
    server = http.createServer(listener);
    if (onConnection != null) server.on("connection", onConnection);
  }

  if (keepAliveTimeout >= 0) server.keepAliveTimeout = keepAliveTimeout;
  server.listen(port, networkInterface);
}

export function stop(): Promise<void> {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      reject(new Error("Could not close server in a timely manner"));
    }, 30000).unref();
    closeServer(20000, resolve);
  });
}
