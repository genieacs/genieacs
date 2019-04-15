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

import * as db from "./db";
import * as common from "./common";
import * as cache from "./cache";
import {
  getCurrentSnapshot,
  getConfig,
  getConfigExpression
} from "./local-cache";
import {
  httpConnectionRequest,
  udpConnectionRequest
} from "./connection-request";
import { Expression, Task } from "./types";

export async function connectionRequest(deviceId): Promise<void> {
  const options = {
    projection: {
      _deviceId: 1,
      "Device.ManagementServer.ConnectionRequestURL._value": 1,
      "Device.ManagementServer.UDPConnectionRequestAddress._value": 1,
      "Device.ManagementServer.ConnectionRequestUsername._value": 1,
      "Device.ManagementServer.ConnectionRequestPassword._value": 1,
      "InternetGatewayDevice.ManagementServer.ConnectionRequestURL._value": 1,
      "InternetGatewayDevice.ManagementServer.UDPConnectionRequestAddress._value": 1,
      "InternetGatewayDevice.ManagementServer.ConnectionRequestUsername._value": 1,
      "InternetGatewayDevice.ManagementServer.ConnectionRequestPassword._value": 1
    }
  };

  const device = await db.devicesCollection.findOne({ _id: deviceId }, options);
  if (!device) throw new Error("No such device");

  let managementServer,
    connectionRequestUrl,
    udpConnectionRequestAddress,
    username,
    password;
  if (device.Device)
    // TR-181 data model
    managementServer = device.Device.ManagementServer;
  // TR-098 data model
  else managementServer = device.InternetGatewayDevice.ManagementServer;

  if (managementServer.ConnectionRequestURL)
    connectionRequestUrl = managementServer.ConnectionRequestURL._value;
  if (managementServer.UDPConnectionRequestAddress) {
    udpConnectionRequestAddress =
      managementServer.UDPConnectionRequestAddress._value;
  }
  if (managementServer.ConnectionRequestUsername)
    username = managementServer.ConnectionRequestUsername._value;
  if (managementServer.ConnectionRequestPassword)
    password = managementServer.ConnectionRequestPassword._value;

  const context = {
    id: device["_id"],
    serialNumber: device["_deviceId"]["SerialNumber"],
    productClass: device["_deviceId"]["ProductClass"],
    oui: device["_deviceId"]["OUI"],
    username: username || "",
    password: password || ""
  };

  const snapshot = await getCurrentSnapshot();
  const now = Date.now();
  const UDP_CONNECTION_REQUEST_PORT = +getConfig(
    snapshot,
    "cwmp.udpConnectionRequestAuth",
    context,
    now
  );
  const CONNECTION_REQUEST_TIMEOUT = +getConfig(
    snapshot,
    "cwmp.connectionRequestTimeout",
    context,
    now
  );
  const CONNECTION_REQUEST_ALLOW_BASIC_AUTH = !!getConfig(
    snapshot,
    "cwmp.connectionRequestAllowBasicAuth",
    context,
    now
  );
  let authExp: Expression = getConfigExpression(
    snapshot,
    "cwmp.connectionRequestAuth"
  );

  if (authExp === undefined) {
    authExp = [
      "FUNC",
      "AUTH",
      ["PARAM", "username"],
      ["PARAM", "password"]
    ] as Expression;
  }

  let udpProm;
  if (udpConnectionRequestAddress) {
    udpProm = udpConnectionRequest(
      udpConnectionRequestAddress,
      authExp,
      context,
      UDP_CONNECTION_REQUEST_PORT
    );
  }

  try {
    await httpConnectionRequest(
      connectionRequestUrl,
      authExp,
      context,
      CONNECTION_REQUEST_ALLOW_BASIC_AUTH,
      CONNECTION_REQUEST_TIMEOUT
    );
  } catch (err) {
    if (!udpProm) throw err;
    await udpProm;
  }
}

export async function watchTask(deviceId, taskId, timeout): Promise<string> {
  await new Promise(resolve => setTimeout(resolve, 500));

  const task = await db.tasksCollection.findOne(
    { _id: taskId },
    { projection: { _id: 1 } }
  );
  if (!task) return "completed";

  const q = { _id: `${deviceId}:task_${taskId}` };
  const fault = await db.faultsCollection.findOne(q, {
    projection: { _id: 1 }
  });
  if (fault) return "fault";

  if ((timeout -= 500) <= 0) return "timeout";

  return watchTask(deviceId, taskId, timeout);
}

function sanitizeTask(task): void {
  task.timestamp = new Date(task.timestamp || Date.now());
  if (task.expiry) {
    if (common.typeOf(task.expiry) === common.DATE_TYPE || isNaN(task.expiry))
      task.expiry = new Date(task.expiry);
    else task.expiry = new Date(task.timestamp.getTime() + +task.expiry * 1000);
  }

  return task;
}

export async function insertTasks(tasks): Promise<Task[]> {
  if (tasks && common.typeOf(tasks) !== common.ARRAY_TYPE) tasks = [tasks];
  else if (!tasks || tasks.length === 0) return tasks || [];

  for (const task of tasks) {
    sanitizeTask(task);
    if (task.uniqueKey) {
      await db.tasksCollection.deleteOne({
        device: task.device,
        uniqueKey: task.uniqueKey
      });
    }
  }
  await db.tasksCollection.insertMany(tasks);
  return tasks;
}

export async function deleteDevice(deviceId): Promise<void> {
  await Promise.all([
    db.tasksCollection.deleteMany({ device: deviceId }),
    db.devicesCollection.deleteOne({ _id: deviceId }),
    db.faultsCollection.deleteMany({
      _id: {
        $regex: `^${common.escapeRegExp(deviceId)}\\:`
      }
    }),
    db.operationsCollection.deleteMany({
      _id: {
        $regex: `^${common.escapeRegExp(deviceId)}\\:`
      }
    }),
    cache.del(`${deviceId}_tasks_faults_operations`)
  ]);
}
