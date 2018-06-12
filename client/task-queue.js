"use strict";

import * as store from "./store";

const queue = new Set();
const staging = new Set();

function queueTask(task) {
  staging.delete(task);
  task.status = "queued";
  queue.add(task);
}

function deleteTask(task) {
  staging.delete(task);
  queue.delete(task);
}

function getQueue() {
  return queue;
}

function clear() {
  queue.clear();
}

function getStaging() {
  return staging;
}

function clearStaging() {
  staging.clear();
}

function stageSpv(task) {
  staging.add(task);
}

function commit(tasks, callback) {
  let devices = {};
  for (let t of tasks) {
    devices[t.device] = devices[t.device] || [];
    devices[t.device].push(t);
    queueTask(t);
  }

  return new Promise(resolve => {
    let counter = 1;
    for (let [deviceId, tasks2] of Object.entries(devices)) {
      ++counter;
      store
        .postTasks(deviceId, tasks)
        .then(connectionRequestStatus => {
          for (let t of tasks2)
            if (t.status === "pending") t.status = "stale";
            else if (t.status === "done") queue.delete(t);
          callback(deviceId, null, connectionRequestStatus, tasks2);
          if (--counter === 0) resolve();
        })
        .catch(err => {
          for (let t of tasks2) t.status = "stale";
          callback(deviceId, err, null, tasks2);
          if (--counter === 0) resolve();
        });
    }

    if (--counter === 0) resolve();
  });
}

export {
  queueTask,
  deleteTask,
  clear,
  getQueue,
  getStaging,
  clearStaging,
  stageSpv,
  commit
};
