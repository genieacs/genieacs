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

import cluster from "cluster";
import { cpus } from "os";
import * as logger from "./logger";

let respawnTimestamp = 0;
let crashes: number[] = [];

function fork(): cluster.Worker {
  const w = cluster.fork();
  w.on("error", (err: NodeJS.ErrnoException) => {
    // Avoid exception when attempting to kill the process just as it's exiting
    if (err.code !== "EPIPE") throw err;
    setTimeout(() => {
      if (!w.isDead()) throw err;
    }, 50);
  });
  return w;
}

function restartWorker(worker, code, signal): void {
  const msg = {
    message: "Worker died",
    pid: worker.process.pid,
    exitCode: null,
    signal: null
  };

  if (code != null) msg.exitCode = code;

  if (signal != null) msg.signal = signal;

  logger.error(msg);

  const now = Date.now();
  crashes.push(now);

  let min1 = 0,
    min2 = 0,
    min3 = 0;

  crashes = crashes.filter(n => {
    if (n > now - 60000) ++min1;
    else if (n > now - 120000) ++min2;
    else if (n > now - 180000) ++min3;
    else return false;
    return true;
  });

  if (min1 > 5 && min2 > 5 && min3 > 5) {
    process.exitCode = 1;
    cluster.removeListener("exit", restartWorker);
    for (const pid in cluster.workers) cluster.workers[pid].kill();

    logger.error({
      message: "Too many crashes, exiting",
      pid: process.pid
    });
    return;
  }

  respawnTimestamp = Math.max(now, respawnTimestamp + 2000);
  if (respawnTimestamp === now) {
    fork();
    return;
  }

  setTimeout(() => {
    if (process.exitCode) return;
    fork();
  }, respawnTimestamp - now);
}

export function start(workerCount, servicePort, serviceAddress): void {
  cluster.on("listening", (worker, address) => {
    if (
      (address.addressType === 4 || address.addressType === 6) &&
      address.address === serviceAddress &&
      address.port === servicePort
    ) {
      logger.info({
        message: "Worker listening",
        pid: worker.process.pid,
        address: address.address,
        port: address.port
      });
    }
  });

  cluster.on("exit", restartWorker);

  if (!workerCount) workerCount = Math.max(2, cpus().length);

  for (let i = 0; i < workerCount; ++i) fork();
}

export function stop(): void {
  cluster.removeListener("exit", restartWorker);
  for (const pid in cluster.workers) cluster.workers[pid].kill();
}

export const worker = cluster.worker;
