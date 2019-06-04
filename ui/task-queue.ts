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

import * as store from "./store";

const queue = new Set();
const staging = new Set();

export function queueTask(task): void {
  staging.delete(task);
  task.status = "queued";
  queue.add(task);
}

export function deleteTask(task): void {
  staging.delete(task);
  queue.delete(task);
}

export function getQueue(): Set<{}> {
  return queue;
}

export function clear(): void {
  queue.clear();
}

export function getStaging(): Set<{}> {
  return staging;
}

export function clearStaging(): void {
  staging.clear();
}

export function stageSpv(task): void {
  staging.add(task);
}

export function stageDownload(task): void {
  staging.add(task);
}

export function commit(tasks, callback): Promise<void> {
  const devices: { [deviceId: string]: any[] } = {};
  for (const t of tasks) {
    devices[t.device] = devices[t.device] || [];
    devices[t.device].push(t);
    queueTask(t);
  }

  return new Promise(resolve => {
    let counter = 1;
    for (const [deviceId, tasks2] of Object.entries(devices)) {
      ++counter;
      store
        .postTasks(deviceId, tasks2)
        .then(connectionRequestStatus => {
          for (const t of tasks2) {
            if (t.status === "pending") t.status = "stale";
            else if (t.status === "done") queue.delete(t);
          }
          callback(deviceId, null, connectionRequestStatus, tasks2);
          if (--counter === 0) resolve();
        })
        .catch(err => {
          for (const t of tasks2) t.status = "stale";
          callback(deviceId, err, null, tasks2);
          if (--counter === 0) resolve();
        });
    }

    if (--counter === 0) resolve();
  });
}
