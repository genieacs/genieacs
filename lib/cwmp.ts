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

import * as zlib from "zlib";
import * as crypto from "crypto";
import * as fs from "fs";
import { Socket } from "net";
import * as auth from "./auth";
import * as config from "./config";
import * as common from "./common";
import * as soap from "./soap";
import * as session from "./session";
import { evaluateAsync, evaluate, extractParams } from "./common/expression";
import * as device from "./device";
import * as cache from "./cache";
import * as localCache from "./local-cache";
import * as db from "./db";
import * as logger from "./logger";
import * as scheduling from "./scheduling";
import Path from "./common/path";
import * as extensions from "./extensions";
import {
  SessionContext,
  AcsRequest,
  SetAcsRequest,
  SessionFault,
  Operation,
  Fault,
  Expression,
  Task,
  SoapMessage
} from "./types";
import { IncomingMessage, ServerResponse } from "http";
import { Readable } from "stream";
import { promisify } from "util";

const gzipPromisified = promisify(zlib.gzip);
const deflatePromisified = promisify(zlib.deflate);

const MAX_CYCLES = 4;
const MAX_CONCURRENT_REQUESTS = +config.get("MAX_CONCURRENT_REQUESTS");

const currentSessions = new WeakMap<Socket, SessionContext>();

const stats = {
  concurrentRequests: 0,
  totalRequests: 0,
  droppedRequests: 0,
  initiatedSessions: 0
};

async function authenticate(sessionContext: SessionContext): Promise<boolean> {
  const authExpression: Expression = localCache.getConfigExpression(
    sessionContext.cacheSnapshot,
    "cwmp.auth"
  );
  if (!authExpression) return true;

  let authentication;

  if (sessionContext.httpRequest.headers["authorization"]) {
    authentication = auth.parseAuthorizationHeader(
      sessionContext.httpRequest.headers["authorization"]
    );
  }

  const now = Date.now();
  const res = await evaluateAsync(
    authExpression,
    sessionContext.configContext,
    now,
    async (e: Expression): Promise<Expression> => {
      if (Array.isArray(e) && e[0] === "FUNC") {
        if (e[1] === "EXT") {
          if (typeof e[2] !== "string" || typeof e[3] !== "string") return null;

          for (let i = 4; i < e.length; i++)
            if (Array.isArray(e[i])) return null;

          const { fault, value } = await extensions.run(e.slice(2));
          return fault ? null : value;
        } else if (e[1] === "AUTH") {
          if (authentication && authentication["method"] === "Basic") {
            return (
              authentication["username"] === e[2] &&
              authentication["password"] === e[3]
            );
          } else {
            return false;
          }
        }
      }
      return e;
    }
  );

  if (res && !Array.isArray(res)) return true;

  return false;
}

async function writeResponse(
  sessionContext: SessionContext,
  res,
  close = false
): Promise<void> {
  // Close connection after last request in session
  if (close) res.headers["Connection"] = "close";

  if (sessionContext.debug) {
    const dump =
      `# RESPONSE ${new Date(Date.now())}\n` +
      JSON.stringify(res.headers) +
      "\n" +
      res.data +
      "\n\n";
    fs.appendFile(`./debug/${sessionContext.deviceId}.dump`, dump, err => {
      if (err) throw err;
    });
  }

  let data = res.data;

  // Respond using the same content-encoding as the request
  if (
    sessionContext.httpRequest.headers["content-encoding"] &&
    res.data.length > 0
  ) {
    switch (sessionContext.httpRequest.headers["content-encoding"]) {
      case "gzip":
        res.headers["Content-Encoding"] = "gzip";
        data = await gzipPromisified(data);
        break;
      case "deflate":
        res.headers["Content-Encoding"] = "deflate";
        data = await deflatePromisified(data);
    }
  }

  res.headers["Content-Length"] = data.length;
  sessionContext.httpResponse.writeHead(res.code, res.headers);
  sessionContext.httpResponse.end(data);

  if (sessionContext.httpRequest.connection.destroyed) {
    logger.accessError({
      sessionContext: sessionContext,
      message: "Connection dropped"
    });
  } else if (close) {
    const isNew = await endSession(sessionContext);
    if (isNew) {
      logger.accessInfo({
        sessionContext: sessionContext,
        message: "New device registered"
      });
    }
  } else {
    sessionContext.lastActivity = Date.now();
    currentSessions.set(sessionContext.httpRequest.connection, sessionContext);
  }
}

function recordFault(
  sessionContext: SessionContext,
  fault: Fault,
  provisions,
  channels
): void;
function recordFault(sessionContext: SessionContext, fault: Fault): void;
function recordFault(
  sessionContext: SessionContext,
  fault: Fault,
  provisions?,
  channels?
): void {
  if (!provisions) {
    provisions = sessionContext.provisions;
    channels = sessionContext.channels;
  }

  const faults = sessionContext.faults;
  for (const channel of Object.keys(channels)) {
    const provs = sessionContext.faults[channel]
      ? sessionContext.faults[channel].provisions
      : [];
    faults[channel] = Object.assign(
      { provisions: provs, timestamp: sessionContext.timestamp },
      fault
    ) as SessionFault;
    if (channel.startsWith("task_")) {
      const taskId = channel.slice(5);
      for (const t of sessionContext.tasks)
        if (t._id === taskId && t.expiry) faults[channel].expiry = t.expiry;
    }

    if (sessionContext.retries[channel] != null) {
      ++sessionContext.retries[channel];
    } else {
      sessionContext.retries[channel] = 0;
      if (Object.keys(channels).length !== 1) faults[channel].retryNow = true;
    }

    if (channels[channel] === 0) faults[channel].precondition = true;

    if (!sessionContext.faultsTouched) sessionContext.faultsTouched = {};
    sessionContext.faultsTouched[channel] = true;

    logger.accessWarn({
      sessionContext: sessionContext,
      message: "Channel has faulted",
      fault: fault,
      channel: channel,
      retries: sessionContext.retries[channel]
    });
  }

  for (let i = 0; i < provisions.length; ++i) {
    for (const channel of Object.keys(channels)) {
      if ((channels[channel] >> i) & 1)
        faults[channel].provisions.push(provisions[i]);
    }
  }

  for (const channel of Object.keys(channels)) {
    const provs = faults[channel].provisions;
    faults[channel].provisions = [];
    appendProvisions(faults[channel].provisions, provs);
  }

  session.clearProvisions(sessionContext);
}

async function inform(sessionContext: SessionContext, rpc): Promise<void> {
  const acsResponse = await session.inform(sessionContext, rpc.cpeRequest);
  sessionContext.state = 1;

  const res = soap.response({
    id: rpc.id,
    acsResponse: acsResponse,
    cwmpVersion: sessionContext.cwmpVersion
  });

  const cookiesPath = localCache.getConfig(
    sessionContext.cacheSnapshot,
    "cwmp.cookiesPath",
    sessionContext.configContext
  );

  if (cookiesPath) {
    res.headers["Set-Cookie"] = `session=${
      sessionContext.sessionId
    }; Path=${cookiesPath}`;
  } else {
    res.headers["Set-Cookie"] = `session=${sessionContext.sessionId}`;
  }

  return writeResponse(sessionContext, res);
}

async function transferComplete(sessionContext, rpc): Promise<void> {
  const { acsResponse, operation, fault } = await session.transferComplete(
    sessionContext,
    rpc.cpeRequest
  );

  if (!operation) {
    logger.accessWarn({
      sessionContext: sessionContext,
      message: "Unrecognized command key",
      rpc: rpc
    });
  }

  if (fault) {
    Object.assign(sessionContext.retries, operation.retries);
    recordFault(
      sessionContext,
      fault,
      operation.provisions,
      operation.channels
    );
  }

  const res = soap.response({
    id: rpc.id,
    acsResponse: acsResponse,
    cwmpVersion: sessionContext.cwmpVersion
  });

  return writeResponse(sessionContext, res);
}

// Append provisions and remove duplicates
function appendProvisions(original, toAppend): boolean {
  let modified = false;
  const stringified = new WeakMap();

  for (const p of original) stringified.set(p, JSON.stringify(p));

  for (let i = toAppend.length - 1; i >= 0; --i) {
    let p = toAppend[i];
    const s = JSON.stringify(p);
    for (let j = original.length - 1; j >= 0; --j) {
      const ss = stringified.get(original[j]);
      if (s === ss) {
        if (!p || j >= original.length - (toAppend.length - i)) {
          p = null;
        } else {
          original.splice(j, 1);
          modified = true;
        }
      }
    }

    if (p) {
      original.splice(original.length - (toAppend.length - i) + 1, 0, p);
      stringified.set(p, s);
      modified = true;
    }
  }

  return modified;
}

async function applyPresets(sessionContext: SessionContext): Promise<void> {
  const deviceData = sessionContext.deviceData;
  const presets = localCache.getPresets(sessionContext.cacheSnapshot);

  // Filter presets based on existing faults
  const blackList = {};
  let whiteList = null;
  let whiteListProvisions = null;
  const RETRY_DELAY = +localCache.getConfig(
    sessionContext.cacheSnapshot,
    "cwmp.retryDelay",
    sessionContext.configContext
  );

  if (sessionContext.faults) {
    for (const [channel, fault] of Object.entries(sessionContext.faults)) {
      let retryTimestamp = 0;
      if (!fault.retryNow) {
        retryTimestamp =
          fault.timestamp +
          RETRY_DELAY * Math.pow(2, sessionContext.retries[channel]) * 1000;
      }

      if (retryTimestamp <= sessionContext.timestamp) {
        whiteList = channel;
        whiteListProvisions = fault.provisions;
        break;
      }

      blackList[channel] = fault.precondition ? 1 : 2;
    }
  }

  deviceData.timestamps.revision = 1;
  deviceData.attributes.revision = 1;

  const deviceEvents = {};
  for (const p of deviceData.paths.find(Path.parse("Events.*"), false, true)) {
    const attrs = deviceData.attributes.get(p);
    if (attrs && attrs.value && attrs.value[1][0] >= sessionContext.timestamp)
      deviceEvents[p.segments[1] as string] = true;
  }

  const parameters: { [name: string]: Path } = {};
  const filteredPresets = [];

  for (const preset of presets) {
    if (whiteList != null) {
      if (preset.channel !== whiteList) continue;
    } else if (blackList[preset.channel] === 1) {
      continue;
    }

    let eventsMatch = true;
    for (const [k, v] of Object.entries(preset.events)) {
      if (!v !== !deviceEvents[k.replace(/\s+/g, "_")]) {
        eventsMatch = false;
        break;
      }
    }

    if (!eventsMatch) continue;

    if (preset.schedule && preset.schedule.schedule) {
      const r = scheduling.cron(
        sessionContext.timestamp,
        preset.schedule.schedule
      );
      if (!(r[0] + preset.schedule.duration > sessionContext.timestamp))
        continue;
    }

    filteredPresets.push(preset);
    for (const k of extractParams(preset.precondition))
      parameters[k] = Path.parse(k);
  }

  const declarations = Object.values(parameters).map(v => ({
    path: v,
    pathGet: 1,
    pathSet: null,
    attrGet: { value: 1 },
    attrSet: null,
    defer: true
  }));

  const { fault: flt, rpcId: reqId, rpc: acsReq } = await session.rpcRequest(
    sessionContext,
    declarations
  );

  if (flt) {
    recordFault(sessionContext, flt);
    session.clearProvisions(sessionContext);
    return applyPresets(sessionContext);
  }

  if (acsReq) return sendAcsRequest(sessionContext, reqId, acsReq);

  session.clearProvisions(sessionContext);

  const parameterValues = {};
  for (const [k, v] of Object.entries(parameters)) {
    const unpacked = device.unpack(deviceData, v);
    if (!unpacked.length) continue;
    const attrs = deviceData.attributes.get(unpacked[0]);
    if (attrs && attrs.value && attrs.value[1])
      parameterValues[k] = attrs.value[1][0];
  }

  if (whiteList != null)
    session.addProvisions(sessionContext, whiteList, whiteListProvisions);

  const appendProvisionsToFaults = {};
  const now = Date.now();
  for (const p of filteredPresets) {
    if (evaluate(p.precondition, parameterValues, now)) {
      if (blackList[p.channel] === 2) {
        appendProvisionsToFaults[p.channel] = (
          appendProvisionsToFaults[p.channel] || []
        ).concat(p.provisions);
      } else {
        session.addProvisions(sessionContext, p.channel, p.provisions);
      }
    }
  }

  for (const [channel, provisions] of Object.entries(
    appendProvisionsToFaults
  )) {
    if (
      appendProvisions(sessionContext.faults[channel].provisions, provisions)
    ) {
      if (!sessionContext.faultsTouched) sessionContext.faultsTouched = {};
      sessionContext.faultsTouched[channel] = true;
    }
  }

  // Don't increment when processing a single channel (e.g. after fault)
  if (whiteList == null)
    sessionContext.presetCycles = (sessionContext.presetCycles || 0) + 1;

  if (sessionContext.presetCycles > MAX_CYCLES) {
    const fault = {
      code: "preset_loop",
      message: "The presets are stuck in an endless configuration loop",
      timestamp: sessionContext.timestamp
    };
    recordFault(sessionContext, fault);
    // No need to save retryNow
    for (const f of Object.values(sessionContext.faults)) delete f.retryNow;
    session.clearProvisions(sessionContext);
    return sendAcsRequest(sessionContext);
  }

  deviceData.timestamps.dirty = 0;
  deviceData.attributes.dirty = 0;
  const { fault: fault, rpcId: id, rpc: acsRequest } = await session.rpcRequest(
    sessionContext,
    null
  );

  if (fault) {
    recordFault(sessionContext, fault);
    session.clearProvisions(sessionContext);
    return applyPresets(sessionContext);
  }

  if (!acsRequest) {
    for (const channel of Object.keys(sessionContext.channels)) {
      if (sessionContext.faults[channel]) {
        delete sessionContext.faults[channel];
        if (!sessionContext.faultsTouched) sessionContext.faultsTouched = {};
        sessionContext.faultsTouched[channel] = true;
      }
    }

    if (whiteList != null) return applyPresets(sessionContext);

    if (
      sessionContext.deviceData.timestamps.dirty > 1 ||
      sessionContext.deviceData.attributes.dirty > 1
    )
      return applyPresets(sessionContext);
  }

  return sendAcsRequest(sessionContext, id, acsRequest);
}

async function nextRpc(sessionContext: SessionContext): Promise<void> {
  const { fault: fault, rpcId: id, rpc: acsRequest } = await session.rpcRequest(
    sessionContext,
    null
  );

  if (fault) {
    recordFault(sessionContext, fault);
    session.clearProvisions(sessionContext);
    return nextRpc(sessionContext);
  }

  if (acsRequest) return sendAcsRequest(sessionContext, id, acsRequest);

  for (const [channel, flags] of Object.entries(sessionContext.channels)) {
    if (flags && sessionContext.faults[channel]) {
      delete sessionContext.faults[channel];
      if (!sessionContext.faultsTouched) sessionContext.faultsTouched = {};

      sessionContext.faultsTouched[channel] = true;
    }
    if (channel.startsWith("task_")) {
      const taskId = channel.slice(5);
      if (!sessionContext.doneTasks) sessionContext.doneTasks = [];
      sessionContext.doneTasks.push(taskId);

      for (let j = 0; j < sessionContext.tasks.length; ++j) {
        if (sessionContext.tasks[j]._id === taskId) {
          sessionContext.tasks.splice(j, 1);
          break;
        }
      }
    }
  }

  session.clearProvisions(sessionContext);

  // Clear expired tasks
  sessionContext.tasks = sessionContext.tasks.filter(task => {
    if (!(task.expiry <= sessionContext.timestamp)) return true;

    logger.accessInfo({
      sessionContext: sessionContext,
      message: "Task expired",
      task: task
    });

    if (!sessionContext.doneTasks) sessionContext.doneTasks = [];
    sessionContext.doneTasks.push(task._id);

    const channel = `task_${task._id}`;
    if (sessionContext.faults[channel]) {
      delete sessionContext.faults[channel];
      if (!sessionContext.faultsTouched) sessionContext.faultsTouched = {};
      sessionContext.faultsTouched[channel] = true;
    }

    return false;
  });

  const task = sessionContext.tasks.find(
    t => !sessionContext.faults[`task_${t._id}`]
  );

  if (!task) return applyPresets(sessionContext);

  let alias;

  switch (task.name) {
    case "getParameterValues":
      // Set channel in case params array is empty
      sessionContext.channels[`task_${task._id}`] = 0;
      for (const p of task.parameterNames) {
        session.addProvisions(sessionContext, `task_${task._id}`, [
          ["refresh", p]
        ]);
      }

      break;
    case "setParameterValues":
      // Set channel in case params array is empty
      sessionContext.channels[`task_${task._id}`] = 0;
      for (const p of task.parameterValues) {
        session.addProvisions(sessionContext, `task_${task._id}`, [
          ["value", p[0], p[1]]
        ]);
      }

      break;
    case "refreshObject":
      session.addProvisions(sessionContext, `task_${task._id}`, [
        ["refresh", task.objectName]
      ]);
      break;
    case "reboot":
      session.addProvisions(sessionContext, `task_${task._id}`, [["reboot"]]);
      break;
    case "factoryReset":
      session.addProvisions(sessionContext, `task_${task._id}`, [["reset"]]);
      break;
    case "download":
      session.addProvisions(sessionContext, `task_${task._id}`, [
        ["download", task.fileType, task.fileName, task.targetFileName]
      ]);
      break;
    case "addObject":
      alias = (task.parameterValues || [])
        .map(p => `${p[0]}:${JSON.stringify(p[1])}`)
        .join(",");
      session.addProvisions(sessionContext, `task_${task._id}`, [
        ["instances", `${task.objectName}.[${alias}]`, "+1"]
      ]);
      break;
    case "deleteObject":
      session.addProvisions(sessionContext, `task_${task._id}`, [
        ["instances", task.objectName, 0]
      ]);
      break;
    default:
      throw new Error("Task name not recognized");
  }

  return nextRpc(sessionContext);
}

async function endSession(sessionContext: SessionContext): Promise<boolean> {
  let saveCache = sessionContext.cacheUntil != null;

  const promises = [];

  promises.push(
    db.saveDevice(
      sessionContext.deviceId,
      sessionContext.deviceData,
      sessionContext.new,
      sessionContext.timestamp
    )
  );

  if (sessionContext.operationsTouched) {
    for (const k of Object.keys(sessionContext.operationsTouched)) {
      saveCache = true;
      if (sessionContext.operations[k]) {
        promises.push(
          db.saveOperation(
            sessionContext.deviceId,
            k,
            sessionContext.operations[k]
          )
        );
      } else {
        promises.push(db.deleteOperation(sessionContext.deviceId, k));
      }
    }
  }

  if (sessionContext.doneTasks && sessionContext.doneTasks.length) {
    saveCache = true;
    promises.push(
      db.clearTasks(sessionContext.deviceId, sessionContext.doneTasks)
    );
  }

  if (sessionContext.faultsTouched) {
    for (const k of Object.keys(sessionContext.faultsTouched)) {
      saveCache = true;
      if (sessionContext.faults[k]) {
        sessionContext.faults[k].retries = sessionContext.retries[k];
        promises.push(
          db.saveFault(sessionContext.deviceId, k, sessionContext.faults[k])
        );
      } else {
        promises.push(db.deleteFault(sessionContext.deviceId, k));
      }
    }
  }

  if (saveCache) {
    promises.push(
      cacheDueTasksAndFaultsAndOperations(
        sessionContext.deviceId,
        sessionContext.tasks,
        sessionContext.faults,
        sessionContext.operations,
        sessionContext.cacheUntil
      )
    );
  }

  await Promise.all(promises);
  return sessionContext.new;
}

async function sendAcsRequest(
  sessionContext: SessionContext,
  id?: string,
  acsRequest?: AcsRequest
): Promise<void> {
  if (!acsRequest)
    return writeResponse(sessionContext, soap.response(null), true);

  if (acsRequest.name === "Download") {
    const downloadRequest = acsRequest as SetAcsRequest;
    downloadRequest.fileSize = 0;
    if (!downloadRequest.url) {
      const FS_PORT = config.get("FS_PORT");
      const FS_HOSTNAME = config.get("FS_HOSTNAME");
      const FS_SSL = config.get("FS_SSL");
      downloadRequest.url = FS_SSL ? "https://" : "http://";
      downloadRequest.url += FS_HOSTNAME;
      if (FS_PORT !== 80) downloadRequest.url += ":" + FS_PORT;
      downloadRequest.url += "/" + encodeURI(downloadRequest.fileName);

      const files = localCache.getFiles(sessionContext.cacheSnapshot);
      if (files[downloadRequest.fileName])
        downloadRequest.fileSize = files[downloadRequest.fileName].length;
    }
  }

  const rpc = {
    id: id,
    acsRequest: acsRequest,
    cwmpVersion: sessionContext.cwmpVersion
  };

  logger.accessInfo({
    sessionContext: sessionContext,
    message: "ACS request",
    rpc: rpc
  });

  const res = soap.response(rpc);
  return writeResponse(sessionContext, res);
}

async function getSession(connection, sessionId): Promise<SessionContext> {
  const sessionContext = currentSessions.get(connection);
  if (sessionContext) {
    currentSessions.delete(connection);
    return sessionContext;
  }

  if (!sessionId) return null;

  await new Promise(resolve => setTimeout(resolve, 100));

  const sessionContextString = await cache.pop(`session_${sessionId}`);
  if (!sessionContextString) return null;
  return session.deserialize(sessionContextString);
}

// When socket closes, store active sessions in cache
export function onConnection(socket): void {
  // The property remoteAddress may be undefined after the connection is
  // closed, unless we read it at least once (caching?)
  socket.remoteAddress;

  socket.on("close", async () => {
    const sessionContext = currentSessions.get(socket);
    if (!sessionContext) return;
    currentSessions.delete(socket);
    const now = Date.now();

    const lastActivity = sessionContext.lastActivity;
    const timeoutMsg = logger.flatten({
      sessionContext: sessionContext,
      message: "Session timeout",
      sessionTimestamp: sessionContext.timestamp
    });

    const timeout =
      sessionContext.lastActivity + sessionContext.timeout * 1000 - now;
    if (timeout <= 0) return void logger.accessError(timeoutMsg);

    setTimeout(async () => {
      const sessionContextString = await cache.get(
        `session_${sessionContext.sessionId}`
      );
      if (!sessionContextString) return;
      const _sessionContext = await session.deserialize(sessionContextString);
      if (_sessionContext.lastActivity === lastActivity)
        logger.accessError(timeoutMsg);
    }, timeout + 1000).unref();

    if (sessionContext.state === 0) return;

    const sessionContextString = await session.serialize(sessionContext);
    await cache.set(
      `session_${sessionContext.sessionId}`,
      sessionContextString,
      Math.ceil(timeout / 1000) + 3
    );
  });
}

setInterval(() => {
  if (stats.droppedRequests) {
    logger.warn({
      message: "Worker overloaded",
      droppedRequests: stats.droppedRequests,
      totalRequests: stats.totalRequests,
      initiatedSessions: stats.initiatedSessions,
      pid: process.pid
    });
  }

  stats.totalRequests = 0;
  stats.droppedRequests = 0;
  stats.initiatedSessions = 0;
}, 10000).unref();

async function getDueTasksAndFaultsAndOperations(
  deviceId,
  timestamp
): Promise<{
  tasks: Task[];
  faults: { [channel: string]: SessionFault };
  operations: { [commandKey: string]: Operation };
  ttl: number;
}> {
  const res = await cache.get(`${deviceId}_tasks_faults_operations`);
  if (res) {
    const resParsed = JSON.parse(res);
    return {
      tasks: resParsed.tasks || [],
      faults: resParsed.faults || {},
      operations: resParsed.operations || {},
      ttl: 0
    };
  }

  const res2 = await Promise.all([
    db.getDueTasks(deviceId, timestamp),
    db.getFaults(deviceId),
    db.getOperations(deviceId)
  ]);
  return {
    tasks: res2[0][0],
    faults: res2[1],
    operations: res2[2],
    ttl: res2[0][1] || 0
  };
}

async function cacheDueTasksAndFaultsAndOperations(
  deviceId,
  tasks,
  faults,
  operations,
  cacheUntil
): Promise<void> {
  const v = {
    tasks: null,
    faults: null,
    operations: null
  };
  if (tasks.length) v.tasks = tasks;
  if (Object.keys(faults).length) v.faults = faults;
  if (Object.keys(operations).length) v.operations = operations;

  let ttl;
  if (cacheUntil) ttl = Math.trunc((Date.now() - cacheUntil) / 1000);
  else ttl = config.get("MAX_CACHE_TTL", deviceId);

  await cache.set(
    `${deviceId}_tasks_faults_operations`,
    JSON.stringify(v),
    ttl
  );
}

function reportBadState(sessionContext: SessionContext): void {
  logger.accessError({
    message: "Bad session state",
    sessionContext: sessionContext
  });
  currentSessions.delete(sessionContext.httpResponse.connection);
  sessionContext.httpResponse.writeHead(400, { Connection: "close" });
  sessionContext.httpResponse.end("Bad session state");
}

async function processRequest(
  sessionContext: SessionContext,
  rpc: SoapMessage
): Promise<void> {
  if (rpc.cpeRequest) {
    if (rpc.cpeRequest.name === "Inform") {
      if (sessionContext.state !== 0)
        return void reportBadState(sessionContext);

      logger.accessInfo({
        sessionContext: sessionContext,
        message: "Inform",
        rpc: rpc
      });
      return inform(sessionContext, rpc);
    } else if (rpc.cpeRequest.name === "TransferComplete") {
      if (sessionContext.state !== 1)
        return void reportBadState(sessionContext);

      logger.accessInfo({
        sessionContext: sessionContext,
        message: "CPE request",
        rpc: rpc
      });
      return transferComplete(sessionContext, rpc);
    } else if (rpc.cpeRequest.name === "GetRPCMethods") {
      if (sessionContext.state !== 1) return reportBadState(sessionContext);

      logger.accessInfo({
        sessionContext: sessionContext,
        message: "CPE request",
        rpc: rpc
      });
      const res = soap.response({
        id: rpc.id,
        acsResponse: {
          name: "GetRPCMethodsResponse",
          methodList: ["Inform", "GetRPCMethods", "TransferComplete"]
        },
        cwmpVersion: sessionContext.cwmpVersion
      });
      return writeResponse(sessionContext, res);
    } else {
      if (sessionContext.state !== 1)
        return void reportBadState(sessionContext);

      throw new Error("ACS method not supported");
    }
  } else if (rpc.cpeResponse) {
    if (sessionContext.state !== 2) return void reportBadState(sessionContext);

    await session.rpcResponse(sessionContext, rpc.id, rpc.cpeResponse);
    return nextRpc(sessionContext);
  } else if (rpc.cpeFault) {
    if (sessionContext.state !== 2) return void reportBadState(sessionContext);

    logger.accessWarn({
      sessionContext: sessionContext,
      message: "CPE fault",
      rpc: rpc
    });

    const fault = await session.rpcFault(sessionContext, rpc.id, rpc.cpeFault);
    if (fault) {
      recordFault(sessionContext, fault);
      session.clearProvisions(sessionContext);
    }
    return nextRpc(sessionContext);
  } else {
    // CPE sent empty response
    if (sessionContext.state !== 1) return void reportBadState(sessionContext);

    sessionContext.state = 2;
    const { faults, operations } = await session.timeoutOperations(
      sessionContext
    );

    for (const [i, f] of faults.entries()) {
      for (const [k, v] of Object.entries(operations[i].retries))
        sessionContext.retries[k] = v;

      recordFault(
        sessionContext,
        f,
        operations[i].provisions,
        operations[i].channels
      );
    }

    return nextRpc(sessionContext);
  }
}

export function listener(
  httpRequest: IncomingMessage,
  httpResponse: ServerResponse
): void {
  stats.concurrentRequests += 1;
  listenerAsync(httpRequest, httpResponse)
    .then(() => {
      stats.concurrentRequests -= 1;
    })
    .catch(err => {
      currentSessions.delete(httpResponse.connection);
      httpResponse.writeHead(500, { Connection: "close" });
      httpResponse.end(`${err.name}: ${err.message}`);
      stats.concurrentRequests -= 1;
      setTimeout(() => {
        throw err;
      });
    });
}

async function listenerAsync(
  httpRequest: IncomingMessage,
  httpResponse: ServerResponse
): Promise<void> {
  stats.totalRequests += 1;

  if (httpRequest.method !== "POST") {
    httpResponse.writeHead(405, {
      Allow: "POST",
      Connection: "close"
    });
    httpResponse.end("405 Method Not Allowed");
    return;
  }

  let sessionId;
  // Separation by comma is important as some devices don't comform to standard
  const COOKIE_REGEX = /\s*([a-zA-Z0-9\-_]+?)\s*=\s*"?([a-zA-Z0-9\-_]*?)"?\s*(,|;|$)/g;
  let match;
  while ((match = COOKIE_REGEX.exec(httpRequest.headers.cookie)))
    if (match[1] === "session") sessionId = match[2];

  // If overloaded, ask CPE to retry in 60 seconds
  if (!sessionId && stats.concurrentRequests > MAX_CONCURRENT_REQUESTS) {
    httpResponse.writeHead(503, {
      "Retry-after": 60,
      Connection: "close"
    });
    httpResponse.end("503 Service Unavailable");
    stats.droppedRequests += 1;
    return;
  }

  let stream: Readable = httpRequest;
  if (httpRequest.headers["content-encoding"]) {
    switch (httpRequest.headers["content-encoding"]) {
      case "gzip":
        stream = httpRequest.pipe(zlib.createGunzip());
        break;
      case "deflate":
        stream = httpRequest.pipe(zlib.createInflate());
        break;
      default:
        httpResponse.writeHead(415, { Connection: "close" });
        httpResponse.end("415 Unsupported Media Type");
        return;
    }
  }

  const body = await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;

    stream.on("data", chunk => {
      chunks.push(chunk);
      bytes += chunk.length;
    });

    stream.on("end", () => {
      const _body = Buffer.allocUnsafe(bytes);
      let offset = 0;
      for (const chunk of chunks) {
        chunk.copy(_body, offset, 0, chunk.length);
        offset += chunk.length;
      }
      resolve(_body);
    });

    stream.on("error", reject);

    httpRequest.on("aborted", () => {
      resolve(null);
    });
  });

  // Request aborted
  if (!body) return;

  async function parsedRpc(sessionContext, rpc, parseWarnings): Promise<void> {
    for (const w of parseWarnings) {
      w.sessionContext = sessionContext;
      w.rpc = rpc;
      logger.accessWarn(w);
    }

    if (sessionContext.debug) {
      const dump =
        `# REQUEST ${new Date(Date.now())}\n` +
        JSON.stringify(httpRequest.headers) +
        "\n" +
        body +
        "\n\n";
      fs.appendFile(`./debug/${sessionContext.deviceId}.dump`, dump, err => {
        if (err) throw err;
      });
    }

    return processRequest(sessionContext, rpc);
  }

  const sessionContext = await getSession(httpRequest.connection, sessionId);

  if (sessionContext) {
    sessionContext.httpRequest = httpRequest;
    sessionContext.httpResponse = httpResponse;
    if (
      sessionContext.sessionId !== sessionId ||
      sessionContext.lastActivity + sessionContext.timeout * 1000 < Date.now()
    ) {
      logger.accessError({
        message: "Invalid session",
        sessionContext: sessionContext
      });

      httpResponse.writeHead(400, { Connection: "close" });
      httpResponse.end("Invalid session");
      return;
    }
  } else if (stats.concurrentRequests > MAX_CONCURRENT_REQUESTS) {
    // Check again just in case device included old session ID
    // from the previous session
    httpResponse.writeHead(503, { "Retry-after": 60, Connection: "close" });
    httpResponse.end("503 Service Unavailable");
    stats.droppedRequests += 1;
    return;
  }

  const parseWarnings = [];
  let rpc;
  try {
    rpc = soap.request(
      body,
      sessionContext ? sessionContext.cwmpVersion : null,
      parseWarnings
    );
  } catch (error) {
    logger.accessError({
      message: "XML parse error",
      parseError: error.message.trim(),
      sessionContext: sessionContext || {
        httpRequest: httpRequest,
        httpResponse: httpResponse
      }
    });
    httpResponse.writeHead(400, { Connection: "close" });
    httpResponse.end(error.message);
    return;
  }

  if (sessionContext) {
    const authenticated =
      sessionContext.state === 0 ? await authenticate(sessionContext) : true;

    if (!authenticated) {
      logger.accessError({
        message: "Authentication failure",
        sessionContext: sessionContext
      });

      httpResponse.writeHead(401);
      httpResponse.end("Unauthorized");
      currentSessions.set(httpRequest.connection, sessionContext);
      return;
    }
    return parsedRpc(sessionContext, rpc, parseWarnings);
  }

  if (!(rpc.cpeRequest && rpc.cpeRequest.name === "Inform")) {
    logger.accessError({
      message: "Invalid session",
      sessionContext: sessionContext || {
        httpRequest: httpRequest,
        httpResponse: httpResponse
      }
    });
    httpResponse.writeHead(400, { Connection: "close" });
    httpResponse.end("Invalid session");
    return;
  }

  stats.initiatedSessions += 1;
  const deviceId = common.generateDeviceId(rpc.cpeRequest.deviceId);

  const cacheSnapshot = await localCache.getCurrentSnapshot();

  const configContext = {
    id: deviceId,
    serialNumber: rpc.cpeRequest.deviceId["SerialNumber"],
    productClass: rpc.cpeRequest.deviceId["ProductClass"],
    oui: rpc.cpeRequest.deviceId["OUI"]
  };

  const sessionTimeout =
    rpc.sessionTimeout ||
    localCache.getConfig(cacheSnapshot, "cwmp.sessionTimeout", configContext);

  const _sessionContext = session.init(
    deviceId,
    rpc.cwmpVersion,
    sessionTimeout
  );

  _sessionContext.cacheSnapshot = cacheSnapshot;
  _sessionContext.configContext = configContext;
  _sessionContext.debug = !!localCache.getConfig(
    cacheSnapshot,
    "cwmp.debug",
    configContext
  );

  _sessionContext.httpRequest = httpRequest;
  _sessionContext.httpResponse = httpResponse;
  _sessionContext.sessionId = crypto.randomBytes(8).toString("hex");
  httpRequest.connection.setTimeout(_sessionContext.timeout * 1000);

  const {
    tasks: dueTasks,
    faults,
    operations,
    ttl: cacheUntil
  } = await getDueTasksAndFaultsAndOperations(
    deviceId,
    _sessionContext.timestamp
  );

  _sessionContext.tasks = dueTasks;
  _sessionContext.operations = operations;
  _sessionContext.cacheUntil = cacheUntil;
  _sessionContext.faults = faults;
  _sessionContext.retries = {};
  for (const [k, v] of Object.entries(_sessionContext.faults)) {
    if (v.expiry >= _sessionContext.timestamp) {
      // Delete expired faults
      delete _sessionContext.faults[k];
      if (!_sessionContext.faultsTouched) _sessionContext.faultsTouched = {};
      _sessionContext.faultsTouched[k] = true;
    } else {
      _sessionContext.retries[k] = v.retries;
    }
  }

  const authenticated = await authenticate(_sessionContext);
  if (!authenticated) {
    logger.accessError({
      message: "Authentication failure",
      sessionContext: _sessionContext
    });

    httpResponse.writeHead(401);
    httpResponse.end("Unauthorized");
    currentSessions.set(httpRequest.connection, _sessionContext);
    return;
  }

  parsedRpc(_sessionContext, rpc, parseWarnings);
}
