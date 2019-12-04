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

import { parse } from "url";
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
import { flattenDevice } from "./mongodb-functions";
import { evaluate } from "./common/expression";

export async function connectionRequest(
  deviceId: string,
  device?: {}
): Promise<void> {
  if (!device) {
    const res = await db.devicesCollection.findOne({ _id: deviceId });
    if (!res) throw new Error("No such device");
    device = flattenDevice(res);
  }

  let connectionRequestUrl, udpConnectionRequestAddress, username, password;

  if (device["InternetGatewayDevice.ManagementServer.ConnectionRequestURL"]) {
    connectionRequestUrl = (device[
      "InternetGatewayDevice.ManagementServer.ConnectionRequestURL"
    ].value || [""])[0];
    udpConnectionRequestAddress = ((
      device[
        "InternetGatewayDevice.ManagementServer.UDPConnectionRequestAddress"
      ] || {}
    ).value || [""])[0];
    username = ((
      device[
        "InternetGatewayDevice.ManagementServer.ConnectionRequestUsername"
      ] || {}
    ).value || [""])[0];
    password = ((
      device[
        "InternetGatewayDevice.ManagementServer.ConnectionRequestPassword"
      ] || {}
    ).value || [""])[0];
  } else {
    connectionRequestUrl = (device[
      "Device.ManagementServer.ConnectionRequestURL"
    ].value || [""])[0];
    udpConnectionRequestAddress = ((
      device["Device.ManagementServer.UDPConnectionRequestAddress"] || {}
    ).value || [""])[0];
    username = ((
      device["Device.ManagementServer.ConnectionRequestUsername"] || {}
    ).value || [""])[0];
    password = ((
      device["Device.ManagementServer.ConnectionRequestPassword"] || {}
    ).value || [""])[0];
  }

  const remoteAddress = parse(connectionRequestUrl).host;

  const evalCallback = (exp): Expression => {
    if (!Array.isArray(exp)) return exp;
    if (exp[0] === "PARAM") {
      let name = exp[1];
      if (name === "id") name = "DeviceID.ID";
      else if (name === "serialNumber") name = "DeviceID.SerialNumber";
      else if (name === "productClass") name = "DeviceID.ProductClass";
      else if (name === "oui") name = "DeviceID.OUI";
      else if (name === "remoteAddress") return remoteAddress;
      else if (name === "username") return username;
      else if (name === "password") return password;

      const p = device[name];
      if (p && p.value) return p.value[0];
    } else if (exp[0] === "FUNC") {
      if (exp[1] === "REMOTE_ADDRESS") return remoteAddress;
      else if (exp[1] === "USERNAME") return username;
      else if (exp[1] === "PASSWORD") return password;
    }
    return exp;
  };

  const snapshot = await getCurrentSnapshot();
  const now = Date.now();
  const UDP_CONNECTION_REQUEST_PORT = +getConfig(
    snapshot,
    "cwmp.udpConnectionRequestPort",
    {},
    now,
    evalCallback
  );
  const CONNECTION_REQUEST_TIMEOUT = +getConfig(
    snapshot,
    "cwmp.connectionRequestTimeout",
    {},
    now,
    evalCallback
  );
  const CONNECTION_REQUEST_ALLOW_BASIC_AUTH = !!getConfig(
    snapshot,
    "cwmp.connectionRequestAllowBasicAuth",
    {},
    now,
    evalCallback
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

  authExp = evaluate(authExp, {}, now, evalCallback);

  const debug = !!getConfig(snapshot, "cwmp.debug", {}, now, evalCallback);

  let udpProm;
  if (udpConnectionRequestAddress) {
    udpProm = udpConnectionRequest(
      udpConnectionRequestAddress,
      authExp,
      UDP_CONNECTION_REQUEST_PORT,
      debug,
      deviceId
    );
  }

  try {
    await httpConnectionRequest(
      connectionRequestUrl,
      authExp,
      CONNECTION_REQUEST_ALLOW_BASIC_AUTH,
      CONNECTION_REQUEST_TIMEOUT,
      debug,
      deviceId
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

  const validParamValue = (p): boolean => {
    if (
      !Array.isArray(p) ||
      p.length < 2 ||
      typeof p[0] !== "string" ||
      !p[0].length ||
      !["string", "boolean", "number"].includes(typeof p[1]) ||
      (p[2] != null && typeof p[2] !== "string")
    )
      return false;
    return true;
  };

  switch (task.name) {
    case "getParameterValues":
      if (!Array.isArray(task.parameterNames) || !task.parameterNames.length)
        throw new Error("Missing 'parameterNames' property");
      for (const p of task.parameterNames) {
        if (typeof p !== "string" || !p.length)
          throw new Error(`Invalid parameter name '${p}'`);
      }
      break;

    case "setParameterValues":
      if (!Array.isArray(task.parameterValues) || !task.parameterValues.length)
        throw new Error("Missing 'parameterValues' property");
      for (const p of task.parameterValues) {
        if (!validParamValue(p))
          throw new Error(`Invalid parameter value '${p}'`);
      }
      break;

    case "refreshObject":
    case "deleteObject":
      if (typeof task.objectName !== "string" || !task.objectName.length)
        throw new Error("Missing 'objectName' property");
      break;

    case "addObject":
      if (task.parameterValues != null) {
        if (!Array.isArray(task.parameterValues))
          throw new Error("Invalid 'parameterValues' property");
        for (const p of task.parameterValues) {
          if (!validParamValue(p))
            throw new Error(`Invalid parameter value '${p}'`);
        }
      }
      break;

    case "download":
      // genieacs-gui sends file ID instead of fileName and fileType
      if (!task.file) {
        if (typeof task.fileType !== "string" || !task.fileType.length)
          throw new Error("Missing 'fileType' property");

        if (typeof task.fileName !== "string" || !task.fileName.length)
          throw new Error("Missing 'fileName' property");
      }

      if (
        task.targetFileName != null &&
        typeof task.targetFileName !== "string"
      )
        throw new Error("Invalid 'targetFileName' property");
      break;
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
