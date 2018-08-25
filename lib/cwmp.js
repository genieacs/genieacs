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
"use strict";

const zlib = require("zlib");
const crypto = require("crypto");
const fs = require("fs");
const config = require("./config");
const common = require("./common");
const soap = require("./soap");
const session = require("./session");
const query = require("./query");
const device = require("./device");
const cache = require("./cache");
const localCache = require("./local-cache");
const db = require("./db");
const logger = require("./logger");
const scheduling = require("./scheduling");

const MAX_CYCLES = 4;
const MAX_CONCURRENT_REQUESTS = config.get("MAX_CONCURRENT_REQUESTS");

const stats = {
  concurrentRequests: 0,
  totalRequests: 0,
  droppedRequests: 0,
  initiatedSessions: 0
};

function throwError(err, httpResponse) {
  if (httpResponse) {
    currentSessions.delete(httpResponse.connection);
    httpResponse.writeHead(500, { Connection: "close" });
    httpResponse.end(`${err.name}: ${err.message}`);
    stats.concurrentRequests -= 1;
  }
  throw err;
}

function writeResponse(sessionContext, res, close) {
  // Close connection after last request in session
  if (close) res.headers["Connection"] = "close";

  if (config.get("DEBUG", sessionContext.deviceId)) {
    const dump =
      `# RESPONSE ${new Date(Date.now())}\n` +
      JSON.stringify(res.headers) +
      "\n" +
      res.data +
      "\n\n";
    fs.appendFile(`./debug/${sessionContext.deviceId}.dump`, dump, err => {
      if (err) throwError(err);
    });
  }

  function finish() {
    stats.concurrentRequests -= 1;
    if (sessionContext.httpRequest.connection.destroyed) {
      logger.accessError({
        sessionContext: sessionContext,
        message: "Connection dropped"
      });
    } else if (close) {
      endSession(sessionContext, (err, isNew) => {
        if (err) return void throwError(err);

        if (isNew) {
          logger.accessInfo({
            sessionContext: sessionContext,
            message: "New device registered"
          });
        }
      });
    } else {
      sessionContext.lastActivity = Date.now();
      currentSessions.set(
        sessionContext.httpRequest.connection,
        sessionContext
      );
    }
  }

  let compress;
  // Respond using the same content-encoding as the request
  if (
    sessionContext.httpRequest.headers["content-encoding"] &&
    res.data.length > 0
  ) {
    switch (sessionContext.httpRequest.headers["content-encoding"]) {
      case "gzip":
        res.headers["Content-Encoding"] = "gzip";
        compress = zlib.gzip;
        break;
      case "deflate":
        res.headers["Content-Encoding"] = "deflate";
        compress = zlib.deflate;
    }
  }

  if (compress) {
    compress(res.data, (err, data) => {
      if (err) return void throwError(err, sessionContext.httpResponse);

      res.headers["Content-Length"] = data.length;
      sessionContext.httpResponse.writeHead(res.code, res.headers);
      sessionContext.httpResponse.end(data);
      finish();
    });
  } else {
    res.headers["Content-Length"] = res.data.length;
    sessionContext.httpResponse.writeHead(res.code, res.headers);
    sessionContext.httpResponse.end(res.data);
    finish();
  }
}

function recordFault(sessionContext, fault, provisions, channels) {
  if (!provisions) {
    provisions = sessionContext.provisions;
    channels = sessionContext.channels;
  }

  const faults = sessionContext.faults;
  for (const channel of Object.keys(channels)) {
    const provs = sessionContext.faults[channel]
      ? sessionContext.faults[channel].provisions
      : [];
    faults[channel] = Object.assign({ provisions: provs }, fault);
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

function inform(sessionContext, rpc) {
  session.inform(sessionContext, rpc.cpeRequest, (err, acsResponse) => {
    if (err) return void throwError(err, sessionContext.httpResponse);

    const res = soap.response({
      id: rpc.id,
      acsResponse: acsResponse,
      cwmpVersion: sessionContext.cwmpVersion
    });

    const cookiesPath = config.get("COOKIES_PATH", sessionContext.deviceId);
    if (cookiesPath) {
      res.headers["Set-Cookie"] = `session=${
        sessionContext.sessionId
      }; Path=${cookiesPath}`;
    } else {
      res.headers["Set-Cookie"] = `session=${sessionContext.sessionId}`;
    }

    writeResponse(sessionContext, res);
  });
}

function transferComplete(sessionContext, rpc) {
  session.transferComplete(
    sessionContext,
    rpc.cpeRequest,
    (err, acsResponse, operation, fault) => {
      if (err) return void throwError(err, sessionContext.httpResponse);

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

      writeResponse(sessionContext, res);
    }
  );
}

// Append providions and remove duplicates
function appendProvisions(original, toAppend) {
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

function applyPresets(sessionContext) {
  const deviceData = sessionContext.deviceData;
  localCache.getPresets((err, presetsHash, presets) => {
    if (err) return void throwError(err, sessionContext.httpResponse);

    // Filter presets based on existing faults
    const blackList = {};
    let whiteList = null;
    let whiteListProvisions = null;
    const RETRY_DELAY = config.get("RETRY_DELAY", sessionContext.deviceId);

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
    for (const p of deviceData.paths.find(["Events", "*"], false, true)) {
      const attrs = deviceData.attributes.get(p);
      if (attrs && attrs.value && attrs.value[1][0] >= sessionContext.timestamp)
        deviceEvents[p[1]] = true;
    }

    const parameters = {};
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
      for (const k of Object.keys(preset.precondition)) {
        sessionContext.channels[preset.channel] = 0;
        const p = k.split(/([^a-zA-Z0-9\-_.].*)/, 1)[0];
        parameters[p] = common.parsePath(p);
      }
    }

    const declarations = [];
    for (const v of Object.values(parameters))
      declarations.push([v, 1, { value: 1 }]);

    session.rpcRequest(
      sessionContext,
      declarations,
      (err, flt, reqId, acsReq) => {
        if (err) return void throwError(err, sessionContext.httpResponse);

        if (flt) {
          recordFault(sessionContext, flt);
          session.clearProvisions(sessionContext);
          return void applyPresets(sessionContext);
        }

        if (acsReq) return void sendAcsRequest(sessionContext, reqId, acsReq);

        session.clearProvisions(sessionContext);

        const parameterValues = {};
        for (const [k, v] of Object.entries(parameters)) {
          const unpacked = device.unpack(deviceData, v);
          if (!unpacked[0]) continue;
          const attrs = deviceData.attributes.get(unpacked[0]);
          if (attrs && attrs.value && attrs.value[1])
            parameterValues[k] = attrs.value[1][0];
        }

        if (whiteList != null)
          session.addProvisions(sessionContext, whiteList, whiteListProvisions);

        const appendProvisionsToFaults = {};
        for (const p of filteredPresets) {
          if (query.testFilter(parameterValues, p.precondition)) {
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
            appendProvisions(
              sessionContext.faults[channel].provisions,
              provisions
            )
          ) {
            if (!sessionContext.faultsTouched)
              sessionContext.faultsTouched = {};
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
          for (const f of Object.values(sessionContext.faults))
            delete f.retryNow;
          session.clearProvisions(sessionContext);
          return void sendAcsRequest(sessionContext);
        }

        deviceData.timestamps.dirty = 0;
        deviceData.attributes.dirty = 0;
        session.rpcRequest(
          sessionContext,
          null,
          (err, fault, id, acsRequest) => {
            if (err) return void throwError(err, sessionContext.httpResponse);

            if (fault) {
              recordFault(sessionContext, fault);
              session.clearProvisions(sessionContext);
              return void applyPresets(sessionContext);
            }

            if (!acsRequest) {
              for (const channel of Object.keys(sessionContext.channels)) {
                if (sessionContext.faults[channel]) {
                  delete sessionContext.faults[channel];
                  if (!sessionContext.faultsTouched)
                    sessionContext.faultsTouched = {};
                  sessionContext.faultsTouched[channel] = true;
                }
              }

              if (whiteList != null) return void applyPresets(sessionContext);

              if (
                sessionContext.deviceData.timestamps.dirty > 1 ||
                sessionContext.deviceData.attributes.dirty > 1
              )
                return void applyPresets(sessionContext);
            }

            sendAcsRequest(sessionContext, id, acsRequest);
          }
        );
      }
    );
  });
}

function nextRpc(sessionContext) {
  session.rpcRequest(sessionContext, null, (err, fault, id, acsRequest) => {
    if (err) return void throwError(err, sessionContext.httpResponse);

    if (fault) {
      recordFault(sessionContext, fault);
      session.clearProvisions(sessionContext);
      return void nextRpc(sessionContext);
    }

    if (acsRequest) return void sendAcsRequest(sessionContext, id, acsRequest);

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

    if (!task) return void applyPresets(sessionContext);

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
        return void throwError(
          new Error("Task name not recognized"),
          sessionContext.httpResponse
        );
    }
    nextRpc(sessionContext);
  });
}

function endSession(sessionContext, callback) {
  let saveCache = sessionContext.cacheUntil != null;
  let counter = 3;

  counter += 2;
  db.saveDevice(
    sessionContext.deviceId,
    sessionContext.deviceData,
    sessionContext.new,
    sessionContext.timestamp,
    err => {
      if (err) {
        if (counter & 1) callback(err);
        return void (counter = 0);
      }
      if ((counter -= 2) === 1) callback(null, sessionContext.new);
    }
  );

  if (sessionContext.operationsTouched) {
    for (const k of Object.keys(sessionContext.operationsTouched)) {
      counter += 2;
      saveCache = true;
      if (sessionContext.operations[k]) {
        db.saveOperation(
          sessionContext.deviceId,
          k,
          sessionContext.operations[k],
          err => {
            if (err) {
              if (counter & 1) callback(err);
              return void (counter = 0);
            }
            if ((counter -= 2) === 1) callback(null, sessionContext.new);
          }
        );
      } else {
        db.deleteOperation(sessionContext.deviceId, k, err => {
          if (err) {
            if (counter & 1) callback(err);
            return void (counter = 0);
          }
          if ((counter -= 2) === 1) callback(null, sessionContext.new);
        });
      }
    }
  }

  if (sessionContext.doneTasks && sessionContext.doneTasks.length) {
    counter += 2;
    saveCache = true;
    db.clearTasks(sessionContext.deviceId, sessionContext.doneTasks, err => {
      if (err) {
        if (counter & 1) callback(err);
        return void (counter = 0);
      }
      if ((counter -= 2) === 1) callback(null, sessionContext.new);
    });
  }

  if (sessionContext.faultsTouched) {
    for (const k of Object.keys(sessionContext.faultsTouched)) {
      counter += 2;
      saveCache = true;
      if (sessionContext.faults[k]) {
        sessionContext.faults[k].retries = sessionContext.retries[k];
        db.saveFault(
          sessionContext.deviceId,
          k,
          sessionContext.faults[k],
          err => {
            if (err) {
              if (counter & 1) callback(err);
              return void (counter = 0);
            }
            if ((counter -= 2) === 1) callback(null, sessionContext.new);
          }
        );
      } else {
        db.deleteFault(sessionContext.deviceId, k, err => {
          if (err) {
            if (counter & 1) callback(err);
            return void (counter = 0);
          }
          if ((counter -= 2) === 1) callback(null, sessionContext.new);
        });
      }
    }
  }

  if (saveCache) {
    counter += 2;
    cacheDueTasksAndFaultsAndOperations(
      sessionContext.deviceId,
      sessionContext.tasks,
      sessionContext.faults,
      sessionContext.operations,
      sessionContext.cacheUntil,
      err => {
        if (err) {
          if (counter & 1) callback(err);
          return void (counter = 0);
        }
        if ((counter -= 2) === 1) callback(null, sessionContext.new);
      }
    );
  }
  if ((counter -= 2) === 1) callback(null, sessionContext.new);
}

function sendAcsRequest(sessionContext, id, acsRequest) {
  if (!acsRequest)
    return void writeResponse(sessionContext, soap.response(null), true);

  if (acsRequest.name === "Download") {
    if (!acsRequest.url) {
      const FS_PORT = config.get("FS_PORT");
      const FS_HOSTNAME = config.get("FS_HOSTNAME");
      const FS_SSL = config.get("FS_SSL");
      acsRequest.url = FS_SSL ? "https://" : "http://";
      acsRequest.url += FS_HOSTNAME;
      if (FS_PORT !== 80) acsRequest.url += ":" + FS_PORT;
      acsRequest.url += "/" + encodeURI(acsRequest.fileName);
    }

    if (acsRequest.fileSize == null) {
      return void localCache.getFiles((err, hash, files) => {
        if (err) return void throwError(err, sessionContext.httpResponse);

        if (files[acsRequest.fileName])
          acsRequest.fileSize = files[acsRequest.fileName].length;
        else acsRequest.fileSize = 0;

        sendAcsRequest(sessionContext, id, acsRequest);
      });
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
  writeResponse(sessionContext, res);
}

function getSession(connection, sessionId, callback) {
  const sessionContext = currentSessions.get(connection);
  if (sessionContext) {
    currentSessions.delete(connection);
    return void callback(null, sessionContext);
  }

  if (!sessionId) return void callback();

  setTimeout(() => {
    cache.pop(`session_${sessionId}`, (err, sessionContextString) => {
      if (err || !sessionContextString) return void callback(err);
      session.deserialize(sessionContextString, callback);
    });
  }, 100);
}

const currentSessions = new WeakMap();

// When socket closes, store active sessions in cache
function onConnection(socket) {
  // The property remoteAddress may be undefined after the connection is
  // closed, unless we read it at least once (caching?)
  socket.remoteAddress;

  socket.on("close", () => {
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

    setTimeout(() => {
      cache.get(
        `session_${sessionContext.sessionId}`,
        (err, sessionContextString) => {
          if (err) return void throwError(err);

          if (!sessionContextString) return;

          session.deserialize(sessionContextString, (err, _sessionContext) => {
            if (err) return void throwError(err);
            if (_sessionContext.lastActivity === lastActivity)
              logger.accessError(timeoutMsg);
          });
        }
      );
    }, timeout + 1000).unref();

    session.serialize(sessionContext, (err, sessionContextString) => {
      if (err) return void throwError(err);
      cache.set(
        `session_${sessionContext.sessionId}`,
        sessionContextString,
        Math.ceil(timeout / 1000) + 3,
        err => {
          if (err) return void throwError(err);
        }
      );
    });
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

function getDueTasksAndFaultsAndOperations(deviceId, timestamp, callback) {
  cache.get(`${deviceId}_tasks_faults_operations`, (err, res) => {
    if (err) return void callback(err);

    if (res) {
      res = JSON.parse(res);
      return void callback(
        null,
        res.tasks || [],
        res.faults || {},
        res.operations || {}
      );
    }

    let faults, tasks, operations, cacheUntil;

    db.getFaults(deviceId, (err, _faults) => {
      if (err) {
        if (callback) callback(err);
        return void (callback = null);
      }
      faults = _faults;
      if (tasks && operations)
        callback(null, tasks, faults, operations, cacheUntil);
    });

    db.getDueTasks(deviceId, timestamp, (err, dueTasks, nextTimestamp) => {
      if (err) {
        if (callback) callback(err);
        return void (callback = null);
      }
      tasks = dueTasks;
      cacheUntil = nextTimestamp || 0;
      if (faults && operations)
        callback(null, tasks, faults, operations, cacheUntil);
    });

    db.getOperations(deviceId, (err, _operations) => {
      if (err) {
        if (callback) callback(err);
        return void (callback = null);
      }
      operations = _operations;
      if (faults && tasks)
        callback(null, tasks, faults, operations, cacheUntil);
    });

    if (faults && tasks && operations)
      callback(null, tasks, faults, operations, cacheUntil);
  });
}

function cacheDueTasksAndFaultsAndOperations(
  deviceId,
  tasks,
  faults,
  operations,
  cacheUntil,
  callback
) {
  const v = {};
  if (tasks.length) v.tasks = tasks;
  if (Object.keys(faults).length) v.faults = faults;
  if (Object.keys(operations).length) v.operations = operations;

  let ttl;
  if (cacheUntil) ttl = Math.trunc((Date.now() - cacheUntil) / 1000);
  else ttl = config.get("MAX_CACHE_TTL", deviceId);

  cache.set(
    `${deviceId}_tasks_faults_operations`,
    JSON.stringify(v),
    ttl,
    callback
  );
}

function processRequest(sessionContext, rpc) {
  if (rpc.cpeRequest) {
    if (rpc.cpeRequest.name === "Inform") {
      logger.accessInfo({
        sessionContext: sessionContext,
        message: "Inform",
        rpc: rpc
      });
      inform(sessionContext, rpc);
    } else if (rpc.cpeRequest.name === "TransferComplete") {
      logger.accessInfo({
        sessionContext: sessionContext,
        message: "CPE request",
        rpc: rpc
      });
      transferComplete(sessionContext, rpc);
    } else if (rpc.cpeRequest.name === "GetRPCMethods") {
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
      writeResponse(sessionContext, res);
    } else {
      return void throwError(
        new Error("ACS method not supported"),
        sessionContext.httpResponse
      );
    }
  } else if (rpc.cpeResponse) {
    session.rpcResponse(sessionContext, rpc.id, rpc.cpeResponse, err => {
      if (err) return void throwError(err, sessionContext.httpResponse);
      nextRpc(sessionContext);
    });
  } else if (rpc.cpeFault) {
    logger.accessWarn({
      sessionContext: sessionContext,
      message: "CPE fault",
      rpc: rpc
    });

    session.rpcFault(sessionContext, rpc.id, rpc.cpeFault, (err, fault) => {
      if (err) return void throwError(err, sessionContext.httpResponse);
      if (fault) {
        recordFault(sessionContext, fault);
        session.clearProvisions(sessionContext);
      }
      nextRpc(sessionContext);
    });
  } else {
    // CPE sent empty response
    session.timeoutOperations(sessionContext, (err, faults, operations) => {
      if (err) return void throwError(err, sessionContext.httpResponse);

      for (const i of faults) {
        for (const [k, v] of Object.entries(operations[i].retries))
          sessionContext.retries[k] = v;

        recordFault(
          sessionContext,
          faults[i],
          operations[i].provisions,
          operations[i].channels
        );
      }

      nextRpc(sessionContext);
    });
  }
}

function listener(httpRequest, httpResponse) {
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

  let stream = httpRequest;
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

  stats.concurrentRequests += 1;
  httpRequest.on("aborted", () => {
    stats.concurrentRequests -= 1;
    // In some cases event end can be emitted after aborted event
    httpRequest.removeAllListeners("end");
  });

  const chunks = [];
  let bytes = 0;
  stream.on("data", chunk => {
    chunks.push(chunk);
    bytes += chunk.length;
  });

  stream.on("end", () => {
    const body = Buffer.allocUnsafe(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      chunk.copy(body, offset, 0, chunk.length);
      offset += chunk.length;
    }

    function parsedRpc(sessionContext, rpc, parseWarnings) {
      for (const w of parseWarnings) {
        w.sessionContext = sessionContext;
        w.rpc = rpc;
        logger.accessWarn(w);
      }

      if (config.get("DEBUG", sessionContext.deviceId)) {
        const dump =
          `# REQUEST ${new Date(Date.now())}\n` +
          JSON.stringify(httpRequest.headers) +
          "\n" +
          body +
          "\n\n";
        fs.appendFile(`./debug/${sessionContext.deviceId}.dump`, dump, err => {
          if (err) return void throwError(err);
        });
      }

      processRequest(sessionContext, rpc);
    }

    getSession(httpRequest.connection, sessionId, (err, sessionContext) => {
      if (err) return void throwError(err, httpResponse);

      if (sessionContext) {
        sessionContext.httpRequest = httpRequest;
        sessionContext.httpResponse = httpResponse;
        if (
          sessionContext.sessionId !== sessionId ||
          sessionContext.lastActivity + sessionContext.timeout * 1000 <
            Date.now()
        ) {
          logger.accessError({
            message: "Invalid session",
            sessionContext: sessionContext
          });

          httpResponse.writeHead(400, { Connection: "close" });
          httpResponse.end("Invalid session");
          stats.concurrentRequests -= 1;
          return;
        }
      } else if (stats.concurrentRequests > MAX_CONCURRENT_REQUESTS) {
        // Check again just in case device included old session ID
        // from the previous session
        httpResponse.writeHead(503, { "Retry-after": 60, Connection: "close" });
        httpResponse.end("503 Service Unavailable");
        stats.droppedRequests += 1;
        stats.concurrentRequests -= 1;
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
        stats.concurrentRequests -= 1;
        return;
      }

      if (sessionContext) {
        if (
          (rpc.cpeRequest && rpc.cpeRequest.name === "Inform") ||
          !sessionContext.rpcRequest ^ !(rpc.cpeResponse || rpc.cpeFault)
        ) {
          logger.accessError({
            message: "Bad session state",
            sessionContext: sessionContext
          });
          httpResponse.writeHead(400, { Connection: "close" });
          httpResponse.end("Bad session state");
          stats.concurrentRequests -= 1;
          return;
        }
        return void parsedRpc(sessionContext, rpc, parseWarnings);
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
        stats.concurrentRequests -= 1;
        return;
      }

      stats.initiatedSessions += 1;
      const deviceId = common.generateDeviceId(rpc.cpeRequest.deviceId);

      session.init(
        deviceId,
        rpc.cwmpVersion,
        rpc.sessionTimeout || config.get("SESSION_TIMEOUT", deviceId),
        (err, _sessionContext) => {
          if (err) return void throwError(err, httpResponse);

          _sessionContext.httpRequest = httpRequest;
          _sessionContext.httpResponse = httpResponse;
          _sessionContext.sessionId = crypto.randomBytes(8).toString("hex");
          httpRequest.connection.setTimeout(_sessionContext.timeout * 1000);

          getDueTasksAndFaultsAndOperations(
            deviceId,
            _sessionContext.timestamp,
            (err, dueTasks, faults, operations, cacheUntil) => {
              if (err) return void throwError(err, httpResponse);

              _sessionContext.tasks = dueTasks;
              _sessionContext.operations = operations;
              _sessionContext.cacheUntil = cacheUntil;
              _sessionContext.faults = faults;
              _sessionContext.retries = {};
              for (const [k, v] of Object.entries(_sessionContext.faults)) {
                if (v.expiry >= _sessionContext.timestamp) {
                  // Delete expired faults
                  delete _sessionContext.faults[k];
                  if (!_sessionContext.faultsTouched)
                    _sessionContext.faultsTouched = {};
                  _sessionContext.faultsTouched[k] = true;
                } else {
                  _sessionContext.retries[k] = v.retries;
                }
              }
              parsedRpc(_sessionContext, rpc, parseWarnings);
            }
          );
        }
      );
    });
  });
}

exports.listener = listener;
exports.onConnection = onConnection;
