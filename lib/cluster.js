/**
 * Copyright 2013-2017  Zaid Abdulla
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

const cluster = require("cluster");
const logger = require("./logger");
const config = require("./config");

const VERSION = require("../package.json").version;

let respawnTimestamp = 0;
let tooManyCrashesTimestamp = 0;

function getDependencyVersions() {
  let dependencies = [`node@${process.versions.node}`];
  try {
    let npmls = JSON.parse(require("child_process").execSync("npm ls --prod --json --depth 0"));

    for (let k in npmls.dependencies)
      dependencies.push(`${k}@${npmls.dependencies[k].version}`);
  } catch (err) {}

  return dependencies.join(",");
}


function getConfig() {
  let conf = [];
  const keys = Object.keys(process.env);
  for (let k of keys)
    if (k.startsWith("GENIEACS_")) {
      const name = k.slice(9);
      const value = process.env[k];
      const def = config.getDefault(name);
      if (def == null || value !== `${def}`)
        conf.push(`${name}=${value}`);
    }

  return conf.join(",");
}


function restartWorker(worker, code, signal) {
  let msg = {
    message: "Worker died",
    pid: worker.process.pid
  };

  if (code != null)
    msg.exitCode = code;

  if (signal != null)
    msg.signal = signal;

  logger.error(msg);

  const now = Date.now();
  respawnTimestamp = Math.max(now, respawnTimestamp + 2000);
  if (respawnTimestamp === now) {
    tooManyCrashesTimestamp = now;
    cluster.fork();
    return
  }

  if (now - tooManyCrashesTimestamp > 60000) {
    process.exitCode = 1;
    cluster.removeListener("exit", restartWorker);
    for (let pid in cluster.workers)
      cluster.workers[pid].kill();

    logger.error({
      message: "Too many crashes, exiting",
      pid: process.pid
    });
    return;
  }

  setTimeout(function() {
    if (process.exitCode) return;
    cluster.fork();
  }, respawnTimestamp - now);
}


function start(service) {
  logger.init(service, VERSION);
  const config = require("./config");
  const SERVICE_ADDRESS = config.get(`${service.toUpperCase()}_INTERFACE`)
  const SERVICE_PORT = config.get(`${service.toUpperCase()}_PORT`)

  logger.info({
    message: `GenieACS (genieacs-${service}) starting`,
    pid: process.pid,
    version: VERSION,
    dependencies: getDependencyVersions(),
    config: getConfig()
  });

  cluster.on("listening", function(worker, address) {
    if ((address.addressType === 4 || address.addressType === 6) &&
        address.address === SERVICE_ADDRESS && address.port === SERVICE_PORT) {
      logger.info({
        message: "Worker listening",
        pid: worker.process.pid,
        address: address.address,
        port: address.port
      });
    }
  });

  cluster.on("exit", restartWorker);

  process.on("SIGINT", function() {
    logger.info({
      message: "Received signal SIGINT, exiting",
      pid: process.pid
    });

    cluster.removeListener("exit", restartWorker);
  });

  process.on("SIGTERM", function() {
    logger.info({
      message: "Received signal SIGTERM, exiting",
      pid: process.pid
    });

    cluster.removeListener("exit", restartWorker);
    for (let pid in cluster.workers)
      cluster.workers[pid].kill();
  });

  cluster.setupMaster({
    exec: "lib/server",
    args: [service]
  });

  let workerCount = config.get(`${service.toUpperCase()}_WORKER_PROCESSES`);

  if (!workerCount)
    workerCount = Math.max(2, require("os").cpus().length);

  for (let i = 0; i < workerCount; ++ i)
    cluster.fork();
}


process.on("uncaughtException", function(err) {
  logger.error({
    message: "Uncaught exception in master process, exiting",
    exception: err,
    pid: process.pid
  });
  process.exitCode = 1;
  cluster.removeListener("exit", restartWorker);
  for (let pid in cluster.workers)
    cluster.workers[pid].kill();
});


exports.start = start;
