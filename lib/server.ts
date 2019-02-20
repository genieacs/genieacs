/**
 * Copyright 2013-2018  Zaid Abdulla
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
    cb();
  });
}

export function start(
  port,
  networkInterface,
  ssl,
  _listener,
  onConnection?
): void {
  listener = _listener;

  if (ssl) {
    const options = {
      key: fs.readFileSync(ssl.key),
      cert: fs.readFileSync(ssl.cert),
      ca: null
    };

    try {
      // Use intermediate certificates if available
      options.ca = fs
        .readFileSync(ssl.ca)
        .toString()
        .match(/-+BEGIN CERTIFICATE-+[0-9a-zA-Z+\-/=\s]+?-+END CERTIFICATE-+/g);
    } catch (error) {
      // No intermediate certificate
    }
    server = https.createServer(options, listener);
    if (onConnection != null) server.on("secureConnection", onConnection);
  } else {
    server = http.createServer(listener);
    if (onConnection != null) server.on("connection", onConnection);
  }

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
