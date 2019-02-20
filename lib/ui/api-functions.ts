import { exec } from "child_process";
import { ObjectID } from "mongodb";
import * as db from "./db";
import { del } from "../cache";
import {
  insertTasks,
  watchTask,
  connectionRequest,
  deleteDevice
} from "../api-functions";

function deleteFault(id): Promise<void> {
  const deviceId = id.split(":", 1)[0];
  const channel = id.slice(deviceId.length + 1);
  return new Promise((resolve, reject) => {
    Promise.all([
      db.deleteFault(id),
      channel.startsWith("task_")
        ? db.deleteTask(new ObjectID(channel.slice(5)))
        : null
    ])
      .then(() => {
        del(`${deviceId}_tasks_faults_operations`, err => {
          err ? reject(err) : resolve();
        });
      })
      .catch(reject);
  });
}

export function deleteResource(resource, id): Promise<void> {
  return new Promise((resolve, reject) => {
    let promise;

    switch (resource) {
      case "devices":
        promise = new Promise((res, rej) => {
          deleteDevice(id, err => {
            if (err) return void rej(err);
            res();
          });
        });
        break;

      case "files":
        promise = db.deleteFile(id);
        break;

      case "faults":
        promise = deleteFault(id);
        break;

      case "provisions":
        promise = db.deleteProvision(id);
        break;

      case "presets":
        promise = db.deletePreset(id);
        break;

      case "virtualParameters":
        promise = db.deleteVirtualParameter(id);
        break;

      case "config":
        promise = db.deleteConfig(id);
        break;
    }

    promise
      .then(() => {
        del("presets_hash", err => {
          if (err) return void reject(err);
          resolve();
        });
      })
      .catch(reject);
  });
}

export function postTasks(
  deviceId,
  tasks,
  timeout
): Promise<{ connectionRequest: string; tasks: any[] }> {
  return new Promise((resolve, reject) => {
    for (const task of tasks) task.device = deviceId;

    insertTasks(tasks, err => {
      if (err) return void reject(err);
      const statuses = tasks.map(t => {
        return { _id: t._id, status: "pending" };
      });
      del(`${deviceId}_tasks_faults_operations`, err => {
        if (err) return void reject(err);
        connectionRequest(deviceId, err => {
          if (err) {
            return void resolve({
              connectionRequest: err.message,
              tasks: statuses
            });
          }

          const sample = tasks[tasks.length - 1];

          // Waiting for session to finish or timeout
          watchTask(deviceId, sample._id, timeout, err => {
            if (err) return void reject(err);

            const promises2 = [];
            for (const s of statuses) {
              promises2.push(db.query("tasks", ["=", ["PARAM", "_id"], s._id]));
              promises2.push(
                db.query("faults", [
                  "=",
                  ["PARAM", "_id"],
                  `${deviceId}:task_${s._id}`
                ])
              );
            }

            Promise.all(promises2)
              .then(res => {
                for (const [i, r] of statuses.entries()) {
                  if (res[i * 2].length === 0) {
                    r.status = "done";
                  } else if (res[i * 2 + 1].length === 1) {
                    r.status = "fault";
                    r.fault = res[i * 2 + 1][0];
                  }
                  db.deleteTask(r._id);
                }

                resolve({ connectionRequest: "OK", tasks: statuses });
              })
              .catch(reject);
          });
        });
      });
    });
  });
}

interface PingResponse {
  packetsTransmitted: number;
  packetsReceived: number;
  packetLoss: string;
  min: number;
  avg: number;
  max: number;
  mdev: number;
}

export function ping(host): Promise<PingResponse> {
  return new Promise((resolve, reject) => {
    exec(`ping -w 1 -i 0.2 -c 3 ${host}`, (err, stdout) => {
      if (err) return void reject(err);

      const m = stdout.match(
        /(\d) packets transmitted, (\d) received, ([\d.%]+) packet loss[^]*([\d.]+)\/([\d.]+)\/([\d.]+)\/([\d.]+)/
      );
      if (!m) return void reject(new Error("Could not parse ping response"));

      resolve({
        packetsTransmitted: +m[1],
        packetsReceived: +m[2],
        packetLoss: m[3],
        min: +m[4],
        avg: +m[5],
        max: +m[6],
        mdev: +m[7]
      });
    });
  });
}

export function putResource(resource, id, data): Promise<void> {
  return new Promise((resolve, reject) => {
    let promise;

    if (resource === "presets") promise = db.putPreset(id, data);
    else if (resource === "provisions") promise = db.putProvision(id, data);
    else if (resource === "virtualParameters")
      promise = db.putVirtualParameter(id, data);
    else if (resource === "config") promise = db.putConfig(id, data);

    promise
      .then(() => {
        del("presets_hash", err => {
          if (err) return void reject(err);
          resolve();
        });
      })
      .catch(reject);
  });
}
