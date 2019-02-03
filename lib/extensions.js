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

import { spawn } from "child_process";
import crypto from "crypto";
import * as config from "./config";

const TIMEOUT = config.get("EXT_TIMEOUT");

const processes = {};
const jobs = new Map();

function messageHandler(message) {
  const func = jobs.get(message[0]);
  if (func) {
    jobs.delete(message[0]);
    func(null, message[1], message[2]);
  }
}

export function run(args, callback) {
  const scriptName = args[0];

  const id = crypto.randomBytes(8).toString("hex");
  jobs.set(id, callback);

  if (!processes[scriptName]) {
    const p = spawn("bin/genieacs-ext", [scriptName], {
      stdio: ["inherit", "inherit", "inherit", "ipc"]
    });
    processes[scriptName] = p;

    p.on("error", err => {
      if (processes[scriptName] === p) {
        if (jobs.delete(id))
          callback(null, { code: err.name, message: err.message });

        kill(processes[scriptName]);
        delete processes[scriptName];
      }
    });

    p.on("disconnect", () => {
      if (processes[scriptName] === p) {
        kill(processes[scriptName]);
        delete processes[scriptName];
      }
    });

    p.on("message", messageHandler);
  }

  setTimeout(() => {
    if (jobs.delete(id))
      callback(null, { code: "timeout", message: "Extension timed out" });
  }, TIMEOUT);

  if (!processes[scriptName].connected) return false;

  return processes[scriptName].send([id, args.slice(1)]);
}

function kill(process, callback) {
  if (process.signalCode !== null || process.exitCode !== null) return;

  const timeToKill = Date.now() + 5000;

  process.kill();

  const t = setInterval(() => {
    if (process.signalCode !== null || process.exitCode !== null) {
      clearInterval(t);
      if (callback) callback();
    } else if (Date.now() > timeToKill) {
      process.kill("SIGKILL");
      clearInterval(t);
      if (callback) callback();
    }
  }, 100);
}

export function killAll(callback) {
  let counter = 1;
  for (const n in processes) {
    ++counter;
    kill(processes[n], () => {
      if (--counter === 0 && callback) callback();
    });
    delete processes[n];
  }
  if (--counter === 0 && callback) callback();
}
