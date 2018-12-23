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
  for (let t of tasks) {
    t.status = "pending";
    queue.add(t);
  }

  return store.postTasks(tasks, (deviceId, connectionRequestStatus, tasks2) => {
    for (let t of tasks2)
      if (t.status === "pending") t.status = "stale";
      else if (t.status === "done") queue.delete(t);
    if (callback) callback(deviceId, connectionRequestStatus, tasks2);
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
