import * as store from "./store.ts";
import { Task } from "../lib/types.ts";
import * as notifications from "./notifications.ts";

export interface QueueTask extends Task {
  status?: string;
  device: string;
}

export interface StageTask extends Task {
  devices: string[];
}

const MAX_QUEUE = 100;

const queue: Set<QueueTask> = new Set();
const staging: Set<StageTask> = new Set();

function canQueue(tasks: QueueTask[]): boolean {
  let count = queue.size;
  for (const task of tasks) if (!queue.has(task)) ++count;
  return count <= MAX_QUEUE;
}

export function queueTask(...tasks: QueueTask[]): void {
  if (!canQueue(tasks)) {
    notifications.push("error", "Too many tasks in queue");
    return;
  }

  for (const task of tasks) {
    task.status = "queued";
    queue.add(task);
  }
}

export function deleteTask(task: QueueTask): void {
  queue.delete(task);
}

export function getQueue(): Set<QueueTask> {
  return queue;
}

export function clear(): void {
  queue.clear();
}

export function getStaging(): Set<StageTask> {
  return staging;
}

export function clearStaging(): void {
  staging.clear();
}

export function stageSpv(task: StageTask): void {
  if (queue.size + task.devices.length > MAX_QUEUE) {
    notifications.push("error", "Too many tasks in queue");
    return;
  }
  staging.add(task);
}

export function stageDownload(task: StageTask): void {
  if (queue.size + task.devices.length > MAX_QUEUE) {
    notifications.push("error", "Too many tasks in queue");
    return;
  }
  staging.add(task);
}

export function commit(
  tasks: QueueTask[],
  callback: (
    deviceId: string,
    err: Error,
    conReqStatus: string,
    _tasks: QueueTask[],
  ) => void,
): Promise<void> {
  const devices: { [deviceId: string]: QueueTask[] } = {};

  if (!canQueue(tasks))
    return Promise.reject(new Error("Too many tasks in queue"));

  for (const t of tasks) {
    devices[t.device] = devices[t.device] || [];
    devices[t.device].push(t);
    t.status = "queued";
    queue.add(t);
  }

  return new Promise((resolve) => {
    let counter = 1;
    for (const [deviceId, tasks2] of Object.entries(devices)) {
      ++counter;
      store
        .postTasks(deviceId, tasks2)
        .then((connectionRequestStatus) => {
          for (const t of tasks2) {
            if (t.status === "pending") t.status = "stale";
            else if (t.status === "done") queue.delete(t);
          }
          callback(deviceId, null, connectionRequestStatus, tasks2);
          if (--counter === 0) resolve();
        })
        .catch((err) => {
          for (const t of tasks2) t.status = "stale";
          callback(deviceId, err, null, tasks2);
          if (--counter === 0) resolve();
        });
    }

    if (--counter === 0) resolve();
  });
}
