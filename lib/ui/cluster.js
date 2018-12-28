"use strict";

const cluster = require("cluster");
const config = require("./config");
const logger = require("./logger");

const VERSION = require("../../package.json")["version"];

let respawnTimestamp = 0;
let tooManyCrashesTimestamp = 0;

function restartWorker(worker, code, signal) {
  const msg = {
    message: "Worker died",
    pid: worker.process.pid
  };

  if (code != null) msg.exitCode = code;

  if (signal != null) msg.signal = signal;

  logger.error(msg);

  const now = Date.now();
  respawnTimestamp = Math.max(now, respawnTimestamp + 2000);
  if (respawnTimestamp === now) {
    tooManyCrashesTimestamp = now;
    cluster.fork();
    return;
  }

  if (now - tooManyCrashesTimestamp > 60000) {
    process.exitCode = 1;
    cluster.removeListener("exit", restartWorker);
    for (const pid in cluster.workers) cluster.workers[pid].kill();

    logger.error({
      message: "Too many crashes, exiting",
      pid: process.pid
    });
    return;
  }

  setTimeout(() => {
    if (process.exitCode) return;
    cluster.fork();
  }, respawnTimestamp - now);
}

function start() {
  logger.init(VERSION);

  logger.info({
    message: "GenieACS UI starting",
    pid: process.pid,
    version: VERSION
  });

  cluster.on("listening", (worker, address) => {
    logger.info({
      message: "Worker listening",
      pid: worker.process.pid,
      address: address.address,
      port: address.port
    });
  });

  cluster.on("exit", restartWorker);

  process.on("SIGINT", () => {
    logger.info({
      message: "Received signal SIGINT, exiting",
      pid: process.pid
    });

    cluster.removeListener("exit", restartWorker);
  });

  process.on("SIGTERM", () => {
    logger.info({
      message: "Received signal SIGTERM, exiting",
      pid: process.pid
    });

    cluster.removeListener("exit", restartWorker);
    for (const pid in cluster.workers) cluster.workers[pid].kill();
  });

  cluster.setupMaster({ exec: "./server" });

  let workerCount = config.server.workers;

  if (!workerCount) workerCount = Math.max(2, require("os").cpus().length);

  for (let i = 0; i < workerCount; ++i) cluster.fork();
}

process.on("uncaughtException", err => {
  logger.error({
    message: "Uncaught exception in master process, exiting",
    exception: err,
    pid: process.pid
  });
  process.exitCode = 1;
  cluster.removeListener("exit", restartWorker);
  for (const pid in cluster.workers) cluster.workers[pid].kill();
});

// Starting GenieACS UI
start();
