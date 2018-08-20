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
"use strict";

const service = process.argv[2];

if (service == null)
  throw new Error("Missing argument cwmp, fs, or nbi");

const cluster = require("cluster");
const path = require("path");
const fs = require("fs");
const http = require("http");
const https = require("https");
const logger = require("./logger");
logger.init(service, require("../package.json").version);
const config = require("./config");
const db = require("./db");
const cache = require("./cache");
const extensions = require("./extensions");

const networkInterface = config.get(`${service.toUpperCase()}_INTERFACE`);
const port = config.get(`${service.toUpperCase()}_PORT`);
const useHttps = config.get(`${service.toUpperCase()}_SSL`);

const {listener, onConnection} = require(`./${service}`);

let server;

function closeServer(timeout, callback) {
  if (!server)
    return callback();

  setTimeout(() => {
    if (!callback)
      return;

    // Ignore HTTP requests from connection that may still be open
    server.removeListener("request", listener);
    server.setTimeout(1);

    let cb = callback;
    callback = null;
    setTimeout(cb, 1000);
  }, timeout).unref();

  server.close(function() {
    if (!callback)
      return;

    let cb = callback;
    callback = null;
    cb();
  });
}

function exit() {
  setTimeout(() => {
    extensions.killAll(() => {
      process.exit(1);
    });
  }, 30000).unref();

  closeServer(20000, () => {
    db.disconnect();
    cache.disconnect();
    extensions.killAll();
    if (cluster.worker)
      cluster.worker.disconnect();
  });
}

process.on("uncaughtException", (err) => {
  logger.error({
    message: "Uncaught exception",
    exception: err,
    pid: process.pid
  });
  exit();
});

if (useHttps) {
  const httpsKey = path.resolve(config.get("CONFIG_DIR"), `${service}.key`);
  const httpsCert = path.resolve(config.get("CONFIG_DIR"), `${service}.crt`);
  const httpsCa = path.resolve(config.get("CONFIG_DIR"), `${service}.ca-bundle`);
  const options = {
    key: fs.readFileSync(httpsKey),
    cert: fs.readFileSync(httpsCert)
  };

  try {
    // Use intermediate certificates if available
    options.ca = fs.readFileSync(httpsCa).toString().match(/\-+BEGIN CERTIFICATE\-+[0-9a-zA-Z\+\-\/\=\s]+?\-+END CERTIFICATE\-+/g);
  } catch (error) {}
  server = https.createServer(options, listener);
  if (onConnection != null)
    server.on("secureConnection", onConnection);
} else {
  server = http.createServer(listener);
  if (onConnection != null)
    server.on("connection", onConnection);
}

db.connect((err) => {
  if (err)
    throw err;

  cache.connect(function(err) {
    if (err)
      throw err;

    server.listen(port, networkInterface);
  });
});

process.on("SIGINT", exit);
process.on("SIGTERM", exit);
