import { postTasks } from "./api-client.ts";
import { StateSignal } from "./signals.ts";
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

// Signals that bump on every change — drawer reads these for reactive updates
// Use private counters to avoid calling .get() (which would register a spurious
// dependency if the bump happens inside a computed evaluation, e.g. doTask).
// TODO: replace the mutate-in-place + version-counter pattern with immutable
// updates through a signal holding the collection (as reactive-store does):
// status changes produce replacement task objects, and the API moves from
// object identity to task ids. Task identity then tracks content, the drawer
// can rely on each()'s identity-based re-render instead of version ticks, and
// its rerenderOnChange:false opt-out goes away.
let _qv = 0;
let _sv = 0;
export const queueVersion = new StateSignal(0);
export const stagingVersion = new StateSignal(0);

export function bumpQueueVersion(): void {
  queueVersion.set(++_qv);
}

export function bumpStagingVersion(): void {
  stagingVersion.set(++_sv);
}

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
  bumpQueueVersion();
}

export function deleteTask(task: QueueTask): void {
  queue.delete(task);
  bumpQueueVersion();
}

export function getQueue(): Set<QueueTask> {
  return queue;
}

export function clear(): void {
  queue.clear();
  bumpQueueVersion();
}

export function getStaging(): Set<StageTask> {
  return staging;
}

export function clearStaging(): void {
  staging.clear();
  bumpStagingVersion();
}

export function stageSpv(task: StageTask): void {
  if (queue.size + task.devices.length > MAX_QUEUE) {
    notifications.push("error", "Too many tasks in queue");
    return;
  }
  staging.add(task);
  bumpStagingVersion();
}

export function stageDownload(task: StageTask): void {
  if (queue.size + task.devices.length > MAX_QUEUE) {
    notifications.push("error", "Too many tasks in queue");
    return;
  }
  staging.add(task);
  bumpStagingVersion();
}

export function commit(
  tasks: QueueTask[],
  callback: (
    deviceId: string,
    err: Error | null,
    conReqStatus: string | null,
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
  bumpQueueVersion();

  return new Promise((resolve) => {
    let counter = 1;
    for (const [deviceId, tasks2] of Object.entries(devices)) {
      ++counter;
      postTasks(deviceId, tasks2)
        .then((connectionRequestStatus) => {
          for (const t of tasks2) {
            if (t.status === "pending") t.status = "stale";
            else if (t.status === "done") queue.delete(t);
          }
          bumpQueueVersion();
          callback(deviceId, null, connectionRequestStatus, tasks2);
          if (--counter === 0) resolve();
        })
        .catch((err) => {
          for (const t of tasks2) t.status = "stale";
          bumpQueueVersion();
          callback(deviceId, err, null, tasks2);
          if (--counter === 0) resolve();
        });
    }

    if (--counter === 0) resolve();
  });
}
