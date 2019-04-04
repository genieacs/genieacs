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
        .postTasks(deviceId, tasks)
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
