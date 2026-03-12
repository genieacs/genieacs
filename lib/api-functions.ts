import { ObjectId } from "mongodb";
import { collections } from "./db/db.ts";
import {
  deleteConfig,
  deleteFault as dbDeleteFault,
  deleteFile,
  deletePermission,
  deletePreset,
  deleteProvision,
  deleteTask,
  deleteUser,
  deleteVirtualParameter,
  putConfig,
  putPermission,
  putPreset,
  putProvision,
  putUser,
  putVirtualParameter,
} from "./ui/db.ts";
import * as common from "./util.ts";
import * as cache from "./cache.ts";
import { acquireLock, getToken, releaseLock } from "./lock.ts";
import {
  getRevision,
  getConfig,
  getConfigExpression,
  getUsers,
} from "./ui/local-cache.ts";
import {
  httpConnectionRequest,
  udpConnectionRequest,
  xmppConnectionRequest,
} from "./connection-request.ts";
import { Task } from "./types.ts";
import Expression, { Value } from "./common/expression.ts";
import { hashPassword } from "./auth.ts";
import { flattenDevice } from "./ui/db.ts";
import { ResourceLockedError } from "./common/errors.ts";
import * as config from "../lib/config.ts";

const XMPP_CONFIGURED = !!config.get("XMPP_JID");

export async function connectionRequest(
  deviceId: string,
  device?: Record<string, Value>,
): Promise<string> {
  if (!device) {
    const res = await collections.devices.findOne({ _id: deviceId });
    if (!res) throw new Error("No such device");
    device = flattenDevice(res);
  }

  let connectionRequestUrl,
    udpConnectionRequestAddress,
    stunEnable,
    connReqJabberId,
    username,
    password;

  if (device["InternetGatewayDevice.ManagementServer.ConnectionRequestURL"]) {
    connectionRequestUrl =
      device["InternetGatewayDevice.ManagementServer.ConnectionRequestURL"] ||
      "";
    udpConnectionRequestAddress =
      device[
        "InternetGatewayDevice.ManagementServer.UDPConnectionRequestAddress"
      ] || "";
    stunEnable =
      device["InternetGatewayDevice.ManagementServer.STUNEnable"] || "";
    connReqJabberId =
      device["InternetGatewayDevice.ManagementServer.ConnReqJabberID"] || "";
    username =
      device[
        "InternetGatewayDevice.ManagementServer.ConnectionRequestUsername"
      ] || "";
    password =
      device[
        "InternetGatewayDevice.ManagementServer.ConnectionRequestPassword"
      ] || "";
  } else {
    connectionRequestUrl =
      device["Device.ManagementServer.ConnectionRequestURL"] || "";
    udpConnectionRequestAddress =
      device["Device.ManagementServer.UDPConnectionRequestAddress"] || "";
    stunEnable = device["Device.ManagementServer.STUNEnable"] || "";
    connReqJabberId = device["Device.ManagementServer.ConnReqJabberID"] || "";
    username =
      device["Device.ManagementServer.ConnectionRequestUsername"] || "";
    password =
      device["Device.ManagementServer.ConnectionRequestPassword"] || "";
  }
  let remoteAddress;
  try {
    remoteAddress = new URL(connectionRequestUrl).hostname;
  } catch {
    return "Invalid connection request URL";
  }

  const snapshot = await getRevision();
  const now = Date.now();

  const evalCallback = (exp: Expression): Expression => {
    if (exp instanceof Expression.Parameter) {
      let name = exp.path.toString();
      if (name === "id") name = "DeviceID.ID";
      else if (name === "serialNumber") name = "DeviceID.SerialNumber";
      else if (name === "productClass") name = "DeviceID.ProductClass";
      else if (name === "oui") name = "DeviceID.OUI";
      else if (name === "remoteAddress")
        return new Expression.Literal(remoteAddress);
      else if (name === "username") return new Expression.Literal(username);
      else if (name === "password") return new Expression.Literal(password);
      return new Expression.Literal(device[name] ?? null);
    } else if (exp instanceof Expression.FunctionCall) {
      if (exp.name === "NOW") return new Expression.Literal(now);
      else if (exp.name === "REMOTE_ADDRESS")
        return new Expression.Literal(remoteAddress);
      else if (exp.name === "USERNAME") return new Expression.Literal(username);
      else if (exp.name === "PASSWORD") return new Expression.Literal(password);
    }
    return exp;
  };

  const configCallback = (exp: Expression): Expression.Literal => {
    const e = evalCallback(exp);
    if (e instanceof Expression.Literal) return e;
    return new Expression.Literal(null);
  };

  const UDP_CONNECTION_REQUEST_PORT = getConfig(
    snapshot,
    "cwmp.udpConnectionRequestPort",
    0,
    configCallback,
  );
  const CONNECTION_REQUEST_TIMEOUT = getConfig(
    snapshot,
    "cwmp.connectionRequestTimeout",
    2000,
    configCallback,
  );
  const CONNECTION_REQUEST_ALLOW_BASIC_AUTH = getConfig(
    snapshot,
    "cwmp.connectionRequestAllowBasicAuth",
    false,
    configCallback,
  );
  let authExp: Expression = getConfigExpression(
    snapshot,
    "cwmp.connectionRequestAuth",
  );

  if (!authExp) {
    authExp = new Expression.FunctionCall("AUTH", [
      new Expression.FunctionCall("USERNAME", []),
      new Expression.FunctionCall("PASSWORD", []),
    ]);
  }

  authExp = authExp.evaluate(evalCallback);

  const debug = getConfig(snapshot, "cwmp.debug", false, configCallback);

  let udpProm = Promise.resolve(false);
  if (udpConnectionRequestAddress && +stunEnable) {
    try {
      const u = new URL("udp://" + udpConnectionRequestAddress);
      udpProm = udpConnectionRequest(
        u.hostname,
        parseInt(u.port || "80"),
        authExp,
        UDP_CONNECTION_REQUEST_PORT,
        debug,
        deviceId,
      ).then(
        () => true,
        () => false,
      );
    } catch {
      // Ignore invalid address
    }
  }

  let status;

  if (connReqJabberId && XMPP_CONFIGURED) {
    status = await xmppConnectionRequest(
      connReqJabberId,
      authExp,
      CONNECTION_REQUEST_TIMEOUT,
      debug,
      deviceId,
    );
  } else {
    status = await httpConnectionRequest(
      connectionRequestUrl,
      authExp,
      CONNECTION_REQUEST_ALLOW_BASIC_AUTH,
      CONNECTION_REQUEST_TIMEOUT,
      debug,
      deviceId,
    );
  }

  if (await udpProm) return "";

  return status;
}

export async function awaitSessionStart(
  deviceId: string,
  lastInform: number,
  timeout: number,
): Promise<boolean> {
  const now = Date.now();
  const device = await collections.devices.findOne(
    { _id: deviceId },
    { projection: { _lastInform: 1 } },
  );
  const li = (device["_lastInform"] as Date).getTime();
  if (li > lastInform) return true;
  const token = await getToken(`cwmp_session_${deviceId}`);
  if (token?.startsWith("cwmp_session_")) return true;
  if (timeout < 500) return false;
  await new Promise((resolve) => setTimeout(resolve, 500));
  timeout -= Date.now() - now;
  return awaitSessionStart(deviceId, lastInform, timeout);
}

export async function awaitSessionEnd(
  deviceId: string,
  timeout: number,
): Promise<boolean> {
  const now = Date.now();
  const token = await getToken(`cwmp_session_${deviceId}`);
  if (!token?.startsWith("cwmp_session_")) return true;
  if (timeout < 500) return false;
  await new Promise((resolve) => setTimeout(resolve, 500));
  timeout -= Date.now() - now;
  return awaitSessionEnd(deviceId, timeout);
}

function sanitizeTask(task): void {
  task.timestamp = new Date(task.timestamp || Date.now());
  if (task.expiry) {
    if (task.expiry instanceof Date || isNaN(task.expiry))
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
      if (typeof task.objectName !== "string")
        throw new Error("Missing 'objectName' property");
      break;

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

    case "provisions":
      if (
        !Array.isArray(task.provisions) ||
        !task.provisions.every((arr) =>
          arr.every(
            (s) =>
              s == null || ["boolean", "number", "string"].includes(typeof s),
          ),
        )
      )
        throw new Error("Invalid 'provisions' property");
      break;

    case "reboot":
      break;

    case "factoryReset":
      break;

    default:
      throw new Error("Invalid task name");
  }

  return task;
}

export async function insertTasks(tasks: any[]): Promise<Task[]> {
  if (tasks && !Array.isArray(tasks)) tasks = [tasks];
  else if (!tasks?.length) return tasks || [];

  for (const task of tasks) {
    sanitizeTask(task);
    if (task.uniqueKey) {
      await collections.tasks.deleteOne({
        device: task.device,
        uniqueKey: task.uniqueKey,
      });
    }
  }
  await collections.tasks.insertMany(tasks);
  for (const task of tasks) task._id = task._id.toString();
  return tasks;
}

export async function deleteDevice(deviceId: string): Promise<void> {
  const token = await acquireLock(`cwmp_session_${deviceId}`, 5000);
  if (!token) throw new ResourceLockedError("Device is in session");
  try {
    await Promise.all([
      collections.tasks.deleteMany({ device: deviceId }),
      collections.devices.deleteOne({ _id: deviceId }),
      collections.faults.deleteMany({
        _id: {
          $regex: `^${common.escapeRegExp(deviceId)}\\:`,
        },
      }),
      collections.operations.deleteMany({
        _id: {
          $regex: `^${common.escapeRegExp(deviceId)}\\:`,
        },
      }),
    ]);
  } finally {
    await releaseLock(`cwmp_session_${deviceId}`, token);
  }
}

export async function deleteFault(id: string): Promise<void> {
  const deviceId = id.split(":", 1)[0];
  const channel = id.slice(deviceId.length + 1);
  const token = await acquireLock(`cwmp_session_${deviceId}`, 5000);
  if (!token) throw new ResourceLockedError("Device is in session");
  try {
    const proms = [dbDeleteFault(id)];
    if (channel.startsWith("task_"))
      proms.push(deleteTask(new ObjectId(channel.slice(5))));
    await Promise.all(proms);
  } finally {
    await releaseLock(`cwmp_session_${deviceId}`, token);
  }
}

export async function deleteResource(
  resource: string,
  id: string,
): Promise<void> {
  if (resource === "devices") {
    await deleteDevice(id);
  } else if (resource === "files") {
    await deleteFile(id);
    await cache.del("cwmp-local-cache-hash");
  } else if (resource === "faults") {
    await deleteFault(id);
  } else if (resource === "provisions") {
    await deleteProvision(id);
    await cache.del("cwmp-local-cache-hash");
  } else if (resource === "presets") {
    await deletePreset(id);
    await cache.del("cwmp-local-cache-hash");
  } else if (resource === "virtualParameters") {
    await deleteVirtualParameter(id);
    await cache.del("cwmp-local-cache-hash");
  } else if (resource === "config") {
    await deleteConfig(id);
    await Promise.all([
      cache.del("ui-local-cache-hash"),
      cache.del("cwmp-local-cache-hash"),
    ]);
  } else if (resource === "permissions") {
    await deletePermission(id);
    await cache.del("ui-local-cache-hash");
  } else if (resource === "users") {
    await deleteUser(id);
    await cache.del("ui-local-cache-hash");
  } else {
    throw new Error(`Unknown resource ${resource}`);
  }
}

// TODO Implement validation
export async function putResource(
  resource: string,
  id: string,
  data: any,
): Promise<void> {
  if (resource === "presets") {
    await putPreset(id, data);
    await cache.del("cwmp-local-cache-hash");
  } else if (resource === "provisions") {
    await putProvision(id, data);
    await cache.del("cwmp-local-cache-hash");
  } else if (resource === "virtualParameters") {
    await putVirtualParameter(id, data);
    await cache.del("cwmp-local-cache-hash");
  } else if (resource === "config") {
    await putConfig(id, data);
    await Promise.all([
      cache.del("ui-local-cache-hash"),
      cache.del("cwmp-local-cache-hash"),
    ]);
  } else if (resource === "permissions") {
    await putPermission(id, data);
    await cache.del("ui-local-cache-hash");
  } else if (resource === "users") {
    delete data["password"];
    delete data["salt"];
    await putUser(id, data);
    await cache.del("ui-local-cache-hash");
  } else {
    throw new Error(`Unknown resource ${resource}`);
  }
}

export function authLocal(
  snapshot: string,
  username: string,
  password: string,
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const users = getUsers(snapshot);
    const user = users[username];
    if (!user?.password) return void resolve(null);
    hashPassword(password, user.salt)
      .then((hash) => {
        if (hash === user.password) resolve(true);
        else resolve(false);
      })
      .catch(reject);
  });
}
