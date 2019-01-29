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

const config = require("./config");
const common = require("./common");
const db = require("./db");
const device = require("./device");
const sandbox = require("./sandbox");
const localCache = require("./local-cache");
const PathSet = require("./path-set");
const VersionedMap = require("./versioned-map");
const InstanceSet = require("./instance-set");
const defaultProvisions = require("./default-provisions");
const gpnHeuristic = require("./gpn-heuristic");

// Multiply by two because every iteration is two
// phases: read and update
const MAX_ITERATIONS = config.get("MAX_COMMIT_ITERATIONS") * 2;

function initDeviceData() {
  return {
    paths: new PathSet(),
    timestamps: new VersionedMap(),
    attributes: new VersionedMap(),
    loaded: new Map(),
    trackers: new Map(),
    changes: new Set()
  };
}

function init(deviceId, cwmpVersion, timeout, callback) {
  const timestamp = Date.now();
  const sessionContext = {
    timestamp: timestamp,
    deviceId: deviceId,
    deviceData: initDeviceData(),
    cwmpVersion: cwmpVersion,
    timeout: timeout,
    provisions: [],
    channels: {},
    virtualParameters: [],
    revisions: [0],
    rpcCount: 0,
    iteration: 0,
    cycle: 0,
    extensionsCache: {},
    declarations: []
  };

  localCache.getCurrentSnapshot((err, cacheSnapshot) => {
    if (err) return void callback(err);
    sessionContext.cacheSnapshot = cacheSnapshot;
    callback(null, sessionContext);
  });
}

function loadParameters(sessionContext, callback) {
  if (!sessionContext.toLoad || !sessionContext.toLoad.size)
    return void callback();

  const toLoad = Array.from(sessionContext.toLoad.entries());
  db.fetchDevice(
    sessionContext.deviceId,
    sessionContext.timestamp,
    toLoad,
    (err, parameters, loaded) => {
      if (err) return void callback(err);

      if (!parameters) {
        // Device not available in database, mark as new
        sessionContext.new = true;
        loaded = [
          [[], (1 << config.get("MAX_DEPTH", sessionContext.deviceId)) - 1]
        ];
        parameters = [];
      }

      for (const p of loaded) {
        const path = sessionContext.deviceData.paths.add(p[0]);
        if (p[1]) {
          const l = sessionContext.deviceData.loaded.get(path) | 0;
          sessionContext.deviceData.loaded.set(path, l | p[1]);
        }
      }

      for (const p of parameters) {
        const path = sessionContext.deviceData.paths.add(p[0]);
        sessionContext.deviceData.timestamps.set(path, p[1], 0);
        if (p[2]) sessionContext.deviceData.attributes.set(path, p[2], 0);
      }

      delete sessionContext.toLoad;
      callback();
    }
  );
}

function generateRpcId(sessionContext) {
  return (
    sessionContext.timestamp.toString(16) +
    ("0" + sessionContext.cycle.toString(16)).slice(-2) +
    ("0" + sessionContext.rpcCount.toString(16)).slice(-2)
  );
}

function inform(sessionContext, rpcReq, callback) {
  const timestamp = sessionContext.timestamp + sessionContext.iteration + 1;
  const params = [
    [
      ["DeviceID", "Manufacturer"],
      timestamp,
      {
        object: [timestamp, 0],
        writable: [timestamp, 0],
        value: [timestamp, [rpcReq.deviceId.Manufacturer, "xsd:string"]]
      }
    ],

    [
      ["DeviceID", "OUI"],
      timestamp,
      {
        object: [timestamp, 0],
        writable: [timestamp, 0],
        value: [timestamp, [rpcReq.deviceId.OUI, "xsd:string"]]
      }
    ],

    [
      ["DeviceID", "ProductClass"],
      timestamp,
      {
        object: [timestamp, 0],
        writable: [timestamp, 0],
        value: [timestamp, [rpcReq.deviceId.ProductClass, "xsd:string"]]
      }
    ],

    [
      ["DeviceID", "SerialNumber"],
      timestamp,
      {
        object: [timestamp, 0],
        writable: [timestamp, 0],
        value: [timestamp, [rpcReq.deviceId.SerialNumber, "xsd:string"]]
      }
    ]
  ];

  for (const p of rpcReq.parameterList) {
    const path = common.parsePath(p[0]);
    params.push([
      path,
      timestamp,
      {
        object: [timestamp, 0],
        value: [timestamp, p.slice(1)]
      }
    ]);
  }

  params.push([
    ["Events", "Inform"],
    timestamp,
    {
      object: [timestamp, 0],
      writable: [timestamp, 0],
      value: [timestamp, [sessionContext.timestamp, "xsd:dateTime"]]
    }
  ]);

  for (const e of rpcReq.event) {
    params.push([
      ["Events", e.replace(/\s+/g, "_")],
      timestamp,
      {
        object: [timestamp, 0],
        writable: [timestamp, 0],
        value: [timestamp, [sessionContext.timestamp, "xsd:dateTime"]]
      }
    ]);
  }

  // Preload DeviceID params
  loadPath(sessionContext, ["DeviceID", "*"]);

  for (const p of params) loadPath(sessionContext, p[0]);

  loadParameters(sessionContext, err => {
    if (err) return void callback(err);

    if (sessionContext.new) {
      params.push([
        ["DeviceID", "ID"],
        timestamp,
        {
          object: [timestamp, 0],
          writable: [timestamp, 0],
          value: [timestamp, [sessionContext.deviceId, "xsd:string"]]
        }
      ]);
      params.push([
        ["Events", "Registered"],
        timestamp,
        {
          object: [timestamp, 0],
          writable: [timestamp, 0],
          value: [timestamp, [sessionContext.timestamp, "xsd:dateTime"]]
        }
      ]);
    }

    sessionContext.deviceData.timestamps.revision = 1;
    sessionContext.deviceData.attributes.revision = 1;

    let toClear = null;
    for (const p of params) {
      // Don't need to clear wildcards for Events
      if (p[0][0] === "Events") {
        device.set(sessionContext.deviceData, p[0], p[1], p[2]);
      } else {
        toClear = device.set(
          sessionContext.deviceData,
          p[0],
          p[1],
          p[2],
          toClear
        );
      }
    }

    clear(sessionContext, toClear, err => {
      callback(err, { name: "InformResponse" });
    });
  });
}

function transferComplete(sessionContext, rpcReq, callback) {
  const revision =
    (sessionContext.revisions[sessionContext.revisions.length - 1] || 0) + 1;
  sessionContext.deviceData.timestamps.revision = revision;
  sessionContext.deviceData.attributes.revision = revision;
  const commandKey = rpcReq.commandKey;
  const operation = sessionContext.operations[commandKey];

  if (!operation)
    return void callback(null, { name: "TransferCompleteResponse" });

  const instance = operation.args.instance;

  delete sessionContext.operations[commandKey];
  if (!sessionContext.operationsTouched) sessionContext.operationsTouched = {};
  sessionContext.operationsTouched[commandKey] = 1;

  if (rpcReq.faultStruct && rpcReq.faultStruct.faultCode !== "0") {
    return void revertDownloadParameters(
      sessionContext,
      operation.args.instance,
      err => {
        const fault = {
          code: `cwmp.${rpcReq.faultStruct.faultCode}`,
          message: rpcReq.faultStruct.faultString,
          detail: rpcReq.faultStruct,
          timestamp: operation.timestamp
        };

        callback(err, { name: "TransferCompleteResponse" }, operation, fault);
      }
    );
  }

  loadPath(sessionContext, ["Downloads", instance, "*"]);

  loadParameters(sessionContext, err => {
    if (err) return void callback(err);

    let toClear = null;
    const timestamp = sessionContext.timestamp + sessionContext.iteration + 1;

    let p;

    p = sessionContext.deviceData.paths.add([
      "Downloads",
      instance,
      "LastDownload"
    ]);
    toClear = device.set(
      sessionContext.deviceData,
      p,
      timestamp,
      { value: [timestamp, [operation.timestamp, "xsd:dateTime"]] },
      toClear
    );

    p = sessionContext.deviceData.paths.add([
      "Downloads",
      instance,
      "LastFileType"
    ]);
    toClear = device.set(
      sessionContext.deviceData,
      p,
      timestamp,
      { value: [timestamp, [operation.args.fileType, "xsd:string"]] },
      toClear
    );

    p = sessionContext.deviceData.paths.add([
      "Downloads",
      instance,
      "LastFileName"
    ]);
    toClear = device.set(
      sessionContext.deviceData,
      p,
      timestamp,
      { value: [timestamp, [operation.args.fileName, "xsd:string"]] },
      toClear
    );

    p = sessionContext.deviceData.paths.add([
      "Downloads",
      instance,
      "LastTargetFileName"
    ]);
    toClear = device.set(
      sessionContext.deviceData,
      p,
      timestamp,
      { value: [timestamp, [operation.args.targetFileName, "xsd:string"]] },
      toClear
    );

    p = sessionContext.deviceData.paths.add([
      "Downloads",
      instance,
      "StartTime"
    ]);
    toClear = device.set(
      sessionContext.deviceData,
      p,
      timestamp,
      { value: [timestamp, [+rpcReq.startTime, "xsd:dateTime"]] },
      toClear
    );

    p = sessionContext.deviceData.paths.add([
      "Downloads",
      instance,
      "CompleteTime"
    ]);
    toClear = device.set(
      sessionContext.deviceData,
      p,
      timestamp,
      { value: [timestamp, [+rpcReq.completeTime, "xsd:dateTime"]] },
      toClear
    );

    clear(sessionContext, toClear, err => {
      callback(err, { name: "TransferCompleteResponse" }, operation);
    });
  });
}

function revertDownloadParameters(sessionContext, instance, callback) {
  loadPath(sessionContext, ["Downloads", instance, "*"]);

  loadParameters(sessionContext, err => {
    if (err) return void callback(err);

    const timestamp = sessionContext.timestamp + sessionContext.iteration + 1;

    let p;

    p = sessionContext.deviceData.paths.add([
      "Downloads",
      instance,
      "LastDownload"
    ]);

    const lastDownload = sessionContext.deviceData.attributes.get(p);

    p = sessionContext.deviceData.paths.add([
      "Downloads",
      instance,
      "Download"
    ]);

    const toClear = device.set(sessionContext.deviceData, p, timestamp, {
      value: [
        timestamp,
        [
          lastDownload && lastDownload.value[1] ? lastDownload.value[1][0] : 0,
          "xsd:dateTime"
        ]
      ]
    });

    clear(sessionContext, toClear, callback);
  });
}

function timeoutOperations(sessionContext, callback) {
  const revision =
    (sessionContext.revisions[sessionContext.revisions.length - 1] || 0) + 1;
  sessionContext.deviceData.timestamps.revision = revision;
  sessionContext.deviceData.attributes.revision = revision;
  const faults = [];
  const operations = [];
  let counter = 3;

  for (const [commandKey, operation] of Object.entries(operations)) {
    if (operation.name !== "Download") {
      return void callback(
        new Error(`Unknown operation name ${operation.name}`)
      );
    }

    const DOWNLOAD_TIMEOUT =
      config.get("DOWNLOAD_TIMEOUT", sessionContext.deviceId) * 1000;

    if (sessionContext.timestamp > operation.timestamp + DOWNLOAD_TIMEOUT) {
      delete sessionContext.operations[commandKey];
      if (!sessionContext.operationsTouched)
        sessionContext.operationsTouched = {};
      sessionContext.operationsTouched[commandKey] = 1;

      faults.push({
        code: "timeout",
        message: "Download operation timed out",
        timestamp: operation.timestamp
      });

      operations.push(operation);

      counter += 2;
      revertDownloadParameters(sessionContext, operation.args.instance, err => {
        if (err) {
          if (counter & 1) callback(err);
          return void (counter = 0);
        }
        if ((counter -= 2) === 1) callback(null, faults, operations);
      });
    }
  }
  if ((counter -= 2) === 1) callback(null, faults, operations);
}

function addProvisions(sessionContext, channel, provisions) {
  delete sessionContext.syncState;
  delete sessionContext.rpcRequest;
  sessionContext.declarations = [];
  sessionContext.provisionsRet = [];

  if (sessionContext.revisions[sessionContext.revisions.length - 1] > 0) {
    sessionContext.deviceData.timestamps.collapse(1);
    sessionContext.deviceData.attributes.collapse(1);
    sessionContext.revisions = [0];
    sessionContext.extensionsCache = {};
  }

  if (sessionContext.iteration !== sessionContext.cycle * MAX_ITERATIONS) {
    sessionContext.cycle += 1;
    sessionContext.rpcCount = 0;
    sessionContext.iteration = sessionContext.cycle * MAX_ITERATIONS;
  }

  sessionContext.channels[channel] |= 0;

  for (const provision of provisions) {
    const channels = [channel];
    // Remove duplicate provisions
    const provisionStr = JSON.stringify(provision);
    for (const [j, p] of sessionContext.provisions.entries()) {
      if (JSON.stringify(p) === provisionStr) {
        sessionContext.provisions.splice(j, 1);
        for (const c of Object.keys(sessionContext.channels)) {
          if (sessionContext.channels[c] & (1 << j)) channels.push(c);
          const a = sessionContext.channels[c] >> (j + 1);
          sessionContext.channels[c] &= (1 << j) - 1;
          sessionContext.channels[c] |= a << j;
        }
      }
    }

    for (const c of channels)
      sessionContext.channels[c] |= 1 << sessionContext.provisions.length;

    sessionContext.provisions.push(provision);
  }
}

function clearProvisions(sessionContext) {
  if (sessionContext.revisions[sessionContext.revisions.length - 1] > 0) {
    sessionContext.deviceData.timestamps.collapse(1);
    sessionContext.deviceData.attributes.collapse(1);
  }

  if (sessionContext.iteration !== sessionContext.cycle * MAX_ITERATIONS) {
    sessionContext.cycle += 1;
    sessionContext.rpcCount = 0;
    sessionContext.iteration = sessionContext.cycle * MAX_ITERATIONS;
  }

  delete sessionContext.syncState;
  delete sessionContext.rpcRequest;
  sessionContext.provisions = [];
  sessionContext.virtualParameters = [];
  sessionContext.channels = {};
  sessionContext.declarations = [];
  sessionContext.provisionsRet = [];
  sessionContext.revisions = [0];
  sessionContext.extensionsCache = {};
}

function runProvisions(
  sessionContext,
  provisions,
  startRevision,
  endRevision,
  callback
) {
  let done = true;
  let allDeclarations = [];
  let allClear = [];
  let counter = 3;
  const allProvisions = localCache.getProvisions(sessionContext.cacheSnapshot);

  for (const [j, provision] of provisions.entries()) {
    if (!allProvisions[provision[0]]) {
      allDeclarations[j] = [];
      allClear[j] = [];
      if (defaultProvisions[provision[0]]) {
        done =
          defaultProvisions[provision[0]](
            sessionContext,
            provision,
            allDeclarations[j],
            startRevision,
            endRevision
          ) && done;
      }

      continue;
    }
    counter += 2;

    sandbox.run(
      allProvisions[provision[0]].script,
      { args: provision.slice(1) },
      sessionContext,
      startRevision,
      endRevision,
      (err, _fault, _clear, _declarations, _done) => {
        if (err || _fault) {
          if (counter & 1) callback(err, _fault);
          return void (counter = 0);
        }
        done = done && _done;
        allDeclarations[j] = _declarations || [];
        allClear[j] = _clear || [];

        if ((counter -= 2) === 1) {
          allDeclarations = Array.prototype.concat.apply([], allDeclarations);
          if (done) for (const d of allDeclarations) d.defer = false;
          allClear = Array.prototype.concat.apply([], allClear);
          callback(null, null, done, allDeclarations, allClear);
        }
      }
    );
  }

  if ((counter -= 2) === 1) {
    allDeclarations = Array.prototype.concat.apply([], allDeclarations);
    if (done) for (const d of allDeclarations) d.defer = false;
    allClear = Array.prototype.concat.apply([], allClear);
    callback(null, null, done, allDeclarations, allClear);
  }
}

function runVirtualParameters(
  sessionContext,
  provisions,
  startRevision,
  endRevision,
  callback
) {
  let done = true;
  const virtualParameterUpdates = [];
  let allDeclarations = [];
  let allClear = [];
  let counter = 3;
  const allVirtualParameters = localCache.getVirtualParameters(
    sessionContext.cacheSnapshot
  );

  for (const [j, provision] of provisions.entries()) {
    counter += 2;
    const globals = {
      args: provision.slice(1)
    };

    sandbox.run(
      allVirtualParameters[provision[0]].script,
      globals,
      sessionContext,
      startRevision,
      endRevision,
      (err, _fault, _clear, _declarations, _done, _returnValue) => {
        if (err || _fault) {
          if (counter & 1) callback(err, _fault);
          return void (counter = 0);
        }

        done = done && _done;
        allDeclarations[j] = _declarations || [];
        allClear[j] = _clear || [];

        if (_done) {
          if (!_returnValue) {
            if (counter & 1) {
              callback(null, {
                code: "script",
                message: "Invalid virtual parameter return value"
              });
            }

            return void (counter = 0);
          }

          const ret = {};
          if (_returnValue.writable != null) {
            ret.writable = +!!_returnValue.writable;
          } else if (
            provision[1].writable != null ||
            provision[2].writable != null
          ) {
            if (counter & 1) {
              callback(null, {
                code: "script",
                message: "Virtual parameter must provide declared attributes"
              });
            }

            return void (counter = 0);
          }

          if (_returnValue.value != null) {
            if (!Array.isArray(_returnValue.value))
              _returnValue.value = [_returnValue.value];

            if (!_returnValue.value[1]) {
              if (typeof _returnValue.value[0] === "number")
                _returnValue.value[1] = "xsd:int";
              else if (typeof _returnValue.value[0] === "boolean")
                _returnValue.value[1] = "xsd:boolean";
              else if (_returnValue.value[0] instanceof Date)
                _returnValue.value[1] = "xsd:dateTime";
              else _returnValue.value[1] = "xsd:string";
            }

            const allowed = {
              "xsd:int": 1,
              "xsd:unsignedInt": 1,
              "xsd:boolean": 1,
              "xsd:string": 1,
              "xsd:dateTime": 1,
              "xsd:base64": 1,
              "xsd:hexBinary": 1
            };

            if (
              _returnValue.value[0] == null ||
              !allowed[_returnValue.value[1]]
            ) {
              if (counter & 1) {
                callback(null, {
                  code: "script",
                  message: "Invalid virtual parameter value attribute"
                });
              }

              return void (counter = 0);
            }
            ret.value = device.sanitizeParameterValue(_returnValue.value);
          } else if (provision[1].value != null || provision[2].value != null) {
            if (counter & 1) {
              callback(null, {
                code: "script",
                message: "Virtual parameter must provide declared attributes"
              });
            }

            return void (counter = 0);
          }
          virtualParameterUpdates[j] = ret;
        }

        if ((counter -= 2) === 1) {
          allDeclarations = Array.prototype.concat.apply([], allDeclarations);
          if (done) for (const d of allDeclarations) d.defer = false;
          allClear = Array.prototype.concat.apply([], allClear);
          callback(
            null,
            null,
            done ? virtualParameterUpdates : null,
            allDeclarations,
            allClear
          );
        }
      }
    );
  }

  if ((counter -= 2) === 1) {
    allDeclarations = Array.prototype.concat.apply([], allDeclarations);
    if (done) for (const d of allDeclarations) d.defer = false;
    allClear = Array.prototype.concat.apply([], allClear);
    callback(
      null,
      null,
      done ? virtualParameterUpdates : null,
      allDeclarations,
      allClear
    );
  }
}

function runDeclarations(sessionContext, declarations) {
  if (!sessionContext.syncState) {
    sessionContext.syncState = {
      refreshAttributes: {
        exist: new Set(),
        object: new Set(),
        writable: new Set(),
        value: new Set()
      },
      spv: new Map(),
      gpn: new Set(),
      gpnPatterns: new Map(),
      tags: new Map(),
      virtualParameterDeclarations: [],
      instancesToDelete: new Map(),
      instancesToCreate: new Map(),
      downloadsToDelete: new Set(),
      downloadsToCreate: new InstanceSet(),
      downloadsValues: new Map(),
      downloadsDownload: new Map()
    };
  }

  const allDeclareTimestamps = new Map();
  const allDeclareAttributeTimestamps = new Map();
  const allDeclareAttributeValues = new Map();

  const allVirtualParameters = localCache.getVirtualParameters(
    sessionContext.cacheSnapshot
  );

  function mergeAttributeTimestamps(p, attrs) {
    let cur = allDeclareAttributeTimestamps.get(p);
    if (!cur) {
      allDeclareAttributeTimestamps.set(p, attrs);
    } else {
      cur = Object.assign({}, cur);
      for (const [k, v] of Object.entries(attrs))
        cur[k] = Math.max(v, cur[k] || 0);
      allDeclareAttributeTimestamps.set(p, cur);
    }
  }

  function mergeAttributeValues(p, attrs, defer) {
    let cur = allDeclareAttributeValues.get(p);
    if (!cur) {
      if (!defer) allDeclareAttributeValues.set(p, attrs);
    } else {
      cur = Object.assign({}, cur, attrs);
      allDeclareAttributeValues.set(p, cur);
    }
  }

  for (const declaration of declarations) {
    let path = common.addPathMeta(declaration.path);
    let unpacked;

    if ((path.alias | path.wildcard) & 1 || path[0] === "VirtualParameters") {
      sessionContext.deviceData.paths.add(["VirtualParameters"]);
      if ((path.alias | path.wildcard) & 2) {
        sessionContext.deviceData.paths.add(["VirtualParameters", "*"]);
        for (const k of Object.keys(allVirtualParameters))
          sessionContext.deviceData.paths.add(["VirtualParameters", k]);
      }
    }

    if ((path.alias | path.wildcard) & 1 || path[0] === "Reboot")
      sessionContext.deviceData.paths.add(["Reboot"]);

    if ((path.alias | path.wildcard) & 1 || path[0] === "FactoryReset")
      sessionContext.deviceData.paths.add(["FactoryReset"]);

    if (path.alias) {
      const aliasDecs = device.getAliasDeclarations(
        path,
        declaration.pathGet || 1
      );
      for (const ad of aliasDecs) {
        const p = sessionContext.deviceData.paths.add(ad.path);
        allDeclareTimestamps.set(
          p,
          Math.max(ad.pathGet || 1, allDeclareTimestamps.get(p) || 0)
        );
        let attrTrackers;
        if (ad.attrGet) {
          attrTrackers = Object.keys(ad.attrGet);
          mergeAttributeTimestamps(p, ad.attrGet);
        }

        device.track(
          sessionContext.deviceData,
          p,
          "prerequisite",
          attrTrackers
        );
      }

      unpacked = device.unpack(sessionContext.deviceData, path);
      for (const u of unpacked) {
        allDeclareTimestamps.set(
          u,
          Math.max(declaration.pathGet || 1, allDeclareTimestamps.get(u) || 0)
        );
        if (declaration.attrGet)
          mergeAttributeTimestamps(u, declaration.attrGet);
      }
    } else {
      path = sessionContext.deviceData.paths.add(path);
      allDeclareTimestamps.set(
        path,
        Math.max(declaration.pathGet || 1, allDeclareTimestamps.get(path) || 0)
      );
      if (declaration.attrGet)
        mergeAttributeTimestamps(path, declaration.attrGet);
      device.track(sessionContext.deviceData, path, "prerequisite");
    }

    if (declaration.attrSet) {
      if (path.alias | path.wildcard) {
        if (!unpacked)
          unpacked = device.unpack(sessionContext.deviceData, path);

        for (const u of unpacked)
          mergeAttributeValues(u, declaration.attrSet, declaration.defer);
      } else {
        mergeAttributeValues(path, declaration.attrSet, declaration.defer);
      }
    }

    if (declaration.pathSet != null) {
      let minInstances, maxInstances;
      if (Array.isArray(declaration.pathSet)) {
        minInstances = declaration.pathSet[0];
        maxInstances = declaration.pathSet[1];
      } else {
        minInstances = maxInstances = declaration.pathSet;
      }

      let parent = common.addPathMeta(path.slice(0, -1));

      let keys;
      if (Array.isArray(path[path.length - 1])) {
        keys = {};
        for (let i = 0; i < path[path.length - 1].length; i += 2) {
          keys[path[path.length - 1][i].join(".")] =
            path[path.length - 1][i + 1];
        }
      } else if (path[path.length - 1] === "*") {
        keys = {};
      }

      if (
        ((path.wildcard | path.alias) & ((1 << (path.length - 1)) - 1)) ===
        0
      ) {
        parent = sessionContext.deviceData.paths.add(parent);
        if (!unpacked)
          unpacked = device.unpack(sessionContext.deviceData, path);

        processInstances(
          sessionContext,
          parent,
          unpacked,
          keys,
          minInstances,
          maxInstances,
          declaration.defer
        );
      } else {
        const parentsUnpacked = device.unpack(
          sessionContext.deviceData,
          parent
        );
        for (let par of parentsUnpacked) {
          par = sessionContext.deviceData.paths.add(par);
          processInstances(
            sessionContext,
            par,
            device.unpack(
              sessionContext.deviceData,
              common.addPathMeta(par.concat([path[par.length]]))
            ),
            keys,
            minInstances,
            maxInstances,
            declaration.defer
          );
        }
      }
    }
  }

  return processDeclarations(
    sessionContext,
    allDeclareTimestamps,
    allDeclareAttributeTimestamps,
    allDeclareAttributeValues
  );
}

function rpcRequest(sessionContext, _declarations, callback) {
  if (sessionContext.rpcRequest != null) {
    return void callback(
      null,
      null,
      generateRpcId(sessionContext),
      sessionContext.rpcRequest
    );
  }

  if (
    !sessionContext.virtualParameters.length &&
    !sessionContext.declarations.length &&
    !(_declarations && _declarations.length) &&
    !sessionContext.provisions.length
  )
    return void callback();

  if (
    sessionContext.declarations.length <=
    sessionContext.virtualParameters.length
  ) {
    const inception = sessionContext.declarations.length;
    const revision = (sessionContext.revisions[inception] || 0) + 1;
    sessionContext.deviceData.timestamps.revision = revision;
    sessionContext.deviceData.attributes.revision = revision;

    let run, provisions;
    if (inception === 0) {
      run = runProvisions;
      provisions = sessionContext.provisions;
    } else {
      run = runVirtualParameters;
      provisions = sessionContext.virtualParameters[inception - 1];
    }

    return void run(
      sessionContext,
      provisions,
      sessionContext.revisions[inception - 1] || 0,
      sessionContext.revisions[inception],
      (err, fault, ret, decs, toClear) => {
        if (err) return void callback(err);

        if (fault) {
          fault.timestamp = sessionContext.timestamp;
          return void callback(null, fault);
        }

        // Enforce max clear timestamp
        for (const c of toClear) {
          if (c[1] > sessionContext.timestamp) c[1] = sessionContext.timestamp;

          if (c[2]) {
            for (const [k, v] of Object.entries(c[2])) {
              if (v > sessionContext.timestamp)
                c[2][k] = sessionContext.timestamp;
            }
          }
        }

        sessionContext.declarations.push(decs);
        sessionContext.provisionsRet[inception] = ret;

        for (const d of decs) {
          // Enforce max timestamp
          if (d.pathGet > sessionContext.timestamp)
            d.pathGet = sessionContext.timestamp;

          if (d.attrGet) {
            for (const [k, v] of Object.entries(d.attrGet)) {
              if (v > sessionContext.timestamp)
                d.attrGet[k] = sessionContext.timestamp;
            }
          }

          for (const ad of device.getAliasDeclarations(d.path, 1))
            loadPath(sessionContext, ad.path);
        }

        clear(sessionContext, toClear, err => {
          if (err) return void callback(err);

          loadParameters(sessionContext, err => {
            if (err) return void callback(err);
            rpcRequest(sessionContext, _declarations, callback);
          });
        });
      }
    );
  }

  if (_declarations && _declarations.length) {
    delete sessionContext.syncState;
    if (!sessionContext.declarations[0]) sessionContext.declarations[0] = [];
    sessionContext.declarations[0] = sessionContext.declarations[0].concat(
      _declarations
    );

    for (const d of _declarations) {
      for (const ad of device.getAliasDeclarations(d.path, 1))
        loadPath(sessionContext, ad.path);
    }

    return void loadParameters(sessionContext, err => {
      if (err) return void callback(err);

      rpcRequest(sessionContext, null, callback);
    });
  }

  if (sessionContext.rpcCount >= 255) {
    return void callback(null, {
      code: "too_many_rpcs",
      message: "Too many RPC requests",
      timestamp: sessionContext.timestamp
    });
  }

  if (sessionContext.revisions.length >= 8) {
    return void callback(null, {
      code: "deeply_nested_vparams",
      message:
        "Virtual parameters are referencing other virtual parameters in a deeply nested manner",
      timestamp: sessionContext.timestamp
    });
  }

  if (sessionContext.cycle >= 255) {
    return void callback(null, {
      code: "too_many_cycles",
      message: "Too many provision cycles",
      timestamp: sessionContext.timestamp
    });
  }

  if (sessionContext.iteration >= MAX_ITERATIONS * (sessionContext.cycle + 1)) {
    return void callback(null, {
      code: "too_many_commits",
      message: "Too many commit iterations",
      timestamp: sessionContext.timestamp
    });
  }

  if (
    !(
      sessionContext.syncState &&
      sessionContext.syncState.virtualParameterDeclarations &&
      sessionContext.syncState.virtualParameterDeclarations.length >=
        sessionContext.declarations.length
    )
  ) {
    const inception =
      sessionContext.syncState &&
      sessionContext.syncState.virtualParameterDeclarations
        ? sessionContext.syncState.virtualParameterDeclarations.length
        : 0;

    // Avoid unnecessary increment of iteration when using vparams
    if (inception === sessionContext.declarations.length - 1)
      sessionContext.iteration += 2;

    let vpd = runDeclarations(
      sessionContext,
      sessionContext.declarations[inception]
    );
    const timestamp = sessionContext.timestamp + sessionContext.iteration;

    let toClear;

    const allVirtualParameters = localCache.getVirtualParameters(
      sessionContext.cacheSnapshot
    );

    vpd = vpd.filter(declaration => {
      if (Object.keys(allVirtualParameters).length) {
        if (declaration[0].length === 1) {
          // Avoid setting on every inform as "exist" timestamp
          // is not saved in DB
          if (!sessionContext.deviceData.attributes.has(declaration[0])) {
            toClear = device.set(
              sessionContext.deviceData,
              declaration[0],
              timestamp,
              { object: [timestamp, 1], writable: [timestamp, 0] },
              toClear
            );
          }

          return false;
        } else if (declaration[0].length === 2) {
          if (declaration[0][1] === "*") {
            for (const k of Object.keys(allVirtualParameters)) {
              toClear = device.set(
                sessionContext.deviceData,
                ["VirtualParameters", k],
                timestamp,
                {
                  object: [timestamp, 0]
                },
                toClear
              );
            }
            toClear = device.set(
              sessionContext.deviceData,
              declaration[0],
              timestamp,
              null,
              toClear
            );
            return false;
          } else if (allVirtualParameters[declaration[0][1]]) {
            // Avoid setting on every inform as "exist" timestamp
            // is not saved in DB
            if (!sessionContext.deviceData.attributes.has(declaration[0])) {
              toClear = device.set(
                sessionContext.deviceData,
                declaration[0],
                timestamp,
                { object: [timestamp, 0] },
                toClear
              );
            }

            return true;
          }
        }
      }

      for (const p of sessionContext.deviceData.paths.find(
        declaration[0],
        false,
        true
      )) {
        if (sessionContext.deviceData.attributes.has(p)) {
          if (!toClear) toClear = [];
          toClear.push([declaration[0], timestamp]);
          break;
        }
      }
      return false;
    });

    return void clear(sessionContext, toClear, err => {
      if (err) return void callback(err);
      sessionContext.syncState.virtualParameterDeclarations[inception] = vpd;
      rpcRequest(sessionContext, null, callback);
    });
  }

  if (!sessionContext.syncState) return void callback();

  const inception = sessionContext.declarations.length - 1;

  let provisions = generateGetVirtualParameterProvisions(
    sessionContext,
    sessionContext.syncState.virtualParameterDeclarations[inception]
  );

  if (!provisions) {
    sessionContext.rpcRequest = generateGetRpcRequest(sessionContext);
    if (!sessionContext.rpcRequest) {
      // Only check after read stage is complete to minimize reprocessing of
      // declarations especially during initial discovery of data model
      if (sessionContext.deviceData.changes.has("prerequisite")) {
        delete sessionContext.syncState;
        device.clearTrackers(sessionContext.deviceData, "prerequisite");
        return void rpcRequest(sessionContext, null, callback);
      }

      let toClear;
      const timestamp = sessionContext.timestamp + sessionContext.iteration + 1;

      // Update tags
      for (const [p, v] of sessionContext.syncState.tags) {
        const c = sessionContext.deviceData.attributes.get(p);
        if (v && !c) {
          toClear = device.set(
            sessionContext.deviceData,
            p,
            timestamp,
            {
              object: [timestamp, false],
              writable: [timestamp, true],
              value: [timestamp, [true, "xsd:boolean"]]
            },
            toClear
          );
        } else if (c && !v) {
          toClear = device.set(
            sessionContext.deviceData,
            p,
            timestamp,
            null,
            toClear
          );
        }
      }

      // Downloads
      let index;
      for (const instance of sessionContext.syncState.downloadsToCreate) {
        if (index == null) {
          index = 0;
          for (const p of sessionContext.deviceData.paths.find(
            ["Downloads", "*"],
            false,
            true
          )) {
            if (+p[1] > index && sessionContext.deviceData.attributes.has(p))
              index = +p[1];
          }
        }

        ++index;

        toClear = device.set(
          sessionContext.deviceData,
          ["Downloads"],
          timestamp,
          { object: [timestamp, 1], writable: [timestamp, 1] },
          toClear
        );

        toClear = device.set(
          sessionContext.deviceData,
          ["Downloads", "" + index],
          timestamp,
          { object: [timestamp, 1], writable: [timestamp, 1] },
          toClear
        );

        const params = {
          FileType: {
            writable: 1,
            value: [instance.FileType || "", "xsd:string"]
          },
          FileName: {
            writable: 1,
            value: [instance.FileName || "", "xsd:string"]
          },
          TargetFileName: {
            writable: 1,
            value: [instance.TargetFileName || "", "xsd:string"]
          },
          Download: {
            writable: 1,
            value: [instance.Download || 0, "xsd:dateTime"]
          },
          LastFileType: { writable: 0, value: ["", "xsd:string"] },
          LastFileName: { writable: 0, value: ["", "xsd:string"] },
          LastTargetFileName: { writable: 0, value: ["", "xsd:string"] },
          LastDownload: { writable: 0, value: [0, "xsd:dateTime"] },
          StartTime: { writable: 0, value: [0, "xsd:dateTime"] },
          CompleteTime: { writable: 0, value: [0, "xsd:dateTime"] }
        };

        for (const [k, v] of Object.entries(params)) {
          toClear = device.set(
            sessionContext.deviceData,
            ["Downloads", `${index}`, k],
            timestamp,
            {
              object: [timestamp, 0],
              writable: [timestamp, v.writable],
              value: [timestamp, v.value]
            },
            toClear
          );
        }

        toClear = device.set(
          sessionContext.deviceData,
          ["Downloads", `${index}`, "*"],
          timestamp,
          null,
          toClear
        );
      }

      sessionContext.syncState.downloadsToCreate.clear();

      for (const instance of sessionContext.syncState.downloadsToDelete) {
        toClear = device.set(
          sessionContext.deviceData,
          instance,
          timestamp,
          null,
          toClear
        );
        for (const p of sessionContext.syncState.downloadsValues.keys()) {
          if (p[1] === instance[1])
            sessionContext.syncState.downloadsValues.delete(p);
        }
      }

      sessionContext.syncState.downloadsToDelete.clear();

      for (const [p, v] of sessionContext.syncState.downloadsValues) {
        const attrs = sessionContext.deviceData.attributes.get(p);
        if (attrs) {
          if (attrs.writable && attrs.writable[1] && attrs.value) {
            const val = device.sanitizeParameterValue([v, attrs.value[1][1]]);
            if (val[0] !== attrs.value[1][0]) {
              toClear = device.set(
                sessionContext.deviceData,
                p,
                timestamp,
                { value: [timestamp, val] },
                toClear
              );
            }
          }
        }
      }

      if (toClear || sessionContext.deviceData.changes.has("prerequisite")) {
        return void clear(sessionContext, toClear, err => {
          if (err) return void callback(err);
          rpcRequest(sessionContext, null, callback);
        });
      }

      provisions = generateSetVirtualParameterProvisions(
        sessionContext,
        sessionContext.syncState.virtualParameterDeclarations[inception]
      );
      if (!provisions)
        sessionContext.rpcRequest = generateSetRpcRequest(sessionContext);
    }
  }

  if (provisions) {
    sessionContext.virtualParameters.push(provisions);
    sessionContext.revisions.push(sessionContext.revisions[inception]);
    return void rpcRequest(sessionContext, null, callback);
  }

  if (sessionContext.rpcRequest) {
    return void callback(
      null,
      null,
      generateRpcId(sessionContext),
      sessionContext.rpcRequest
    );
  }

  ++sessionContext.revisions[inception];
  sessionContext.declarations.pop();
  sessionContext.syncState.virtualParameterDeclarations.pop();

  const ret = sessionContext.provisionsRet.splice(inception)[0];
  if (!ret) return void rpcRequest(sessionContext, null, callback);

  sessionContext.revisions.pop();
  const rev =
    sessionContext.revisions[sessionContext.revisions.length - 1] || 0;
  sessionContext.deviceData.timestamps.collapse(rev + 1);
  sessionContext.deviceData.attributes.collapse(rev + 1);
  sessionContext.deviceData.timestamps.revision = rev + 1;
  sessionContext.deviceData.attributes.revision = rev + 1;

  for (const k of Object.keys(sessionContext.extensionsCache)) {
    if (rev < Number(k.split(":", 1)[0]))
      delete sessionContext.extensionsCache[k];
  }

  const vparams = sessionContext.virtualParameters.pop();
  if (!vparams) return void callback();

  const timestamp = sessionContext.timestamp + sessionContext.iteration;
  let toClear;
  for (const [i, vpu] of ret.entries()) {
    for (const [k, v] of Object.entries(vpu))
      vpu[k] = [timestamp + (vparams[i][2][k] != null ? 1 : 0), v];

    toClear = device.set(
      sessionContext.deviceData,
      ["VirtualParameters", vparams[i][0]],
      timestamp,
      vpu,
      toClear
    );
  }

  clear(sessionContext, toClear, err => {
    if (err) return void callback(err);
    rpcRequest(sessionContext, null, callback);
  });
}

function generateGetRpcRequest(sessionContext) {
  const syncState = sessionContext.syncState;
  if (!syncState) return null;

  for (const path of syncState.refreshAttributes.exist) {
    let found = false;
    for (const p of sessionContext.deviceData.paths.find(
      path,
      false,
      true,
      99
    )) {
      if (
        syncState.refreshAttributes.value.has(p) ||
        syncState.refreshAttributes.object.has(p) ||
        syncState.refreshAttributes.writable.has(p) ||
        syncState.gpn.has(p)
      ) {
        found = true;
        break;
      }
    }

    if (!found) {
      const p = sessionContext.deviceData.paths.add(path.slice(0, -1));
      syncState.gpn.add(p);
      const f = 1 << p.length;
      syncState.gpnPatterns.set(p, f | syncState.gpnPatterns.get(p));
    }
  }
  syncState.refreshAttributes.exist.clear();

  for (const path of syncState.refreshAttributes.object) {
    let found = false;
    for (const p of sessionContext.deviceData.paths.find(
      path,
      false,
      true,
      99
    )) {
      if (
        syncState.refreshAttributes.value.has(p) ||
        (p.length > path.length &&
          (syncState.refreshAttributes.object.has(p) ||
            syncState.refreshAttributes.writable.has(p)))
      ) {
        found = true;
        break;
      }
    }

    if (!found) {
      const p = sessionContext.deviceData.paths.add(path.slice(0, -1));
      syncState.gpn.add(p);
      const f = 1 << p.length;
      syncState.gpnPatterns.set(p, f | syncState.gpnPatterns.get(p));
    }
  }
  syncState.refreshAttributes.object.clear();

  for (const path of syncState.refreshAttributes.writable) {
    const p = sessionContext.deviceData.paths.add(path.slice(0, -1));
    syncState.gpn.add(p);
    const f = 1 << p.length;
    syncState.gpnPatterns.set(p, f | syncState.gpnPatterns.get(p));
  }
  syncState.refreshAttributes.writable.clear();

  if (syncState.gpn.size) {
    const GPN_NEXT_LEVEL = config.get(
      "GPN_NEXT_LEVEL",
      sessionContext.deviceId
    );
    const paths = Array.from(syncState.gpn.keys()).sort(
      (a, b) => b.length - a.length
    );
    let path = paths.pop();
    while (
      path &&
      path.length &&
      !sessionContext.deviceData.attributes.has(path)
    ) {
      syncState.gpn.delete(path);
      path = paths.pop();
    }

    if (path) {
      let nextLevel;
      let est = 0;
      if (path.length >= GPN_NEXT_LEVEL) {
        const patterns = [[path, 0]];
        for (const p of sessionContext.deviceData.paths.find(
          path,
          true,
          false,
          99
        )) {
          const v = syncState.gpnPatterns.get(p);
          if (v) patterns.push([p, (v >> path.length) << path.length]);
        }
        est = gpnHeuristic.estimateGpnCount(patterns);
      }

      if (est < Math.pow(2, Math.max(0, 8 - path.length))) {
        nextLevel = true;
        syncState.gpn.delete(path);
      } else {
        nextLevel = false;
        for (const p of sessionContext.deviceData.paths.find(
          path,
          false,
          true,
          99
        ))
          syncState.gpn.delete(p);
      }

      return {
        name: "GetParameterNames",
        parameterPath: path.concat("").join("."),
        nextLevel: nextLevel
      };
    }
  }

  if (syncState.refreshAttributes.value.size) {
    const GPV_BATCH_SIZE = config.get(
      "GPV_BATCH_SIZE",
      sessionContext.deviceId
    );
    const parameterNames = [];
    for (const path of syncState.refreshAttributes.value) {
      syncState.refreshAttributes.value.delete(path);
      // Need to check in case param is deleted or changed to object
      const attrs = sessionContext.deviceData.attributes.get(path);
      if (attrs && attrs.object && attrs.object[1] === 0) {
        parameterNames.push(path);
        if (parameterNames.length >= GPV_BATCH_SIZE) break;
      }
    }

    if (parameterNames.length) {
      return {
        name: "GetParameterValues",
        parameterNames: parameterNames.map(p => p.join("."))
      };
    }
  }
  return null;
}

function generateSetRpcRequest(sessionContext) {
  const syncState = sessionContext.syncState;
  if (!syncState) return null;

  const deviceData = sessionContext.deviceData;

  // Delete instance
  for (const instances of syncState.instancesToDelete.values()) {
    const instance = instances.values().next().value;
    if (instance && sessionContext.deviceData.attributes.has(instance)) {
      return {
        name: "DeleteObject",
        objectName: instance.concat("").join(".")
      };
    }
  }

  // Create instance
  for (const [param, instances] of syncState.instancesToCreate) {
    if (sessionContext.deviceData.attributes.has(param)) {
      const instance = instances.values().next().value;
      if (instance) {
        instances.delete(instance);
        return {
          name: "AddObject",
          objectName: param.concat("").join("."),
          instanceValues: instance,
          next: "getInstanceKeys"
        };
      }
    }
  }

  // Set values
  const GPV_BATCH_SIZE = config.get("GPV_BATCH_SIZE", sessionContext.deviceId);
  const DATETIME_MILLISECONDS = config.get(
    "DATETIME_MILLISECONDS",
    sessionContext.deviceId
  );
  const BOOLEAN_LITERAL = config.get(
    "BOOLEAN_LITERAL",
    sessionContext.deviceId
  );

  const parameterValues = [];
  for (const [k, v] of syncState.spv) {
    syncState.spv.delete(k);
    const attrs = sessionContext.deviceData.attributes.get(k);
    const curVal = attrs.value ? attrs.value[1] : null;
    if (curVal && attrs.writable && attrs.writable[1]) {
      const val = v.slice();
      if (!val[1]) val[1] = curVal[1];
      device.sanitizeParameterValue(val);

      // Strip milliseconds
      if (
        val[1] === "xsd:dateTime" &&
        !DATETIME_MILLISECONDS &&
        typeof val[0] === "number"
      )
        val[0] -= val[0] % 1000;

      if (val[0] !== curVal[0] || val[1] !== curVal[1])
        parameterValues.push([k, val[0], val[1]]);

      if (parameterValues.length >= GPV_BATCH_SIZE) break;
    }
  }

  if (parameterValues.length) {
    return {
      name: "SetParameterValues",
      parameterList: parameterValues.map(p => [p[0].join("."), p[1], p[2]]),
      DATETIME_MILLISECONDS: DATETIME_MILLISECONDS,
      BOOLEAN_LITERAL: BOOLEAN_LITERAL
    };
  }

  // Downloads
  for (const [p, t] of syncState.downloadsDownload) {
    const attrs = deviceData.attributes.get(p);
    if (!(attrs && attrs.value && t <= attrs.value[1][0])) {
      const fileTypeAttrs = deviceData.attributes.get(
        deviceData.paths.get(p.slice(0, -1).concat("FileType"))
      );
      const fileNameAttrs = deviceData.attributes.get(
        deviceData.paths.get(p.slice(0, -1).concat("FileName"))
      );
      const targetFileNameAttrs = deviceData.attributes.get(
        deviceData.paths.get(p.slice(0, -1).concat("TargetFileName"))
      );

      return {
        name: "Download",
        commandKey: generateRpcId(sessionContext),
        instance: p[1],
        fileType: fileTypeAttrs
          ? fileTypeAttrs.value
            ? fileTypeAttrs.value[1][0]
            : null
          : null,
        fileName: fileNameAttrs
          ? fileNameAttrs.value
            ? fileNameAttrs.value[1][0]
            : null
          : null,
        targetFileName: targetFileNameAttrs
          ? targetFileNameAttrs.value
            ? targetFileNameAttrs.value[1][0]
            : null
          : null
      };
    }
  }

  // Reboot
  if (syncState.reboot) {
    const p = sessionContext.deviceData.paths.get(["Reboot"]);
    const attrs = p ? sessionContext.deviceData.attributes.get(p) : null;
    if (!(attrs && attrs.value && attrs.value[1][0] >= syncState.reboot)) {
      delete syncState.reboot;
      return { name: "Reboot" };
    }
  }

  // Factory reset
  if (syncState.factoryReset) {
    const p = sessionContext.deviceData.paths.get(["FactoryReset"]);
    const attrs = p ? sessionContext.deviceData.attributes.get(p) : null;
    if (
      !(attrs && attrs.value && attrs.value[1][0] >= syncState.factoryReset)
    ) {
      delete syncState.factoryReset;
      return { name: "FactoryReset" };
    }
  }

  return null;
}

function generateGetVirtualParameterProvisions(
  sessionContext,
  virtualParameterDeclarations
) {
  let provisions;
  if (virtualParameterDeclarations) {
    for (const declaration of virtualParameterDeclarations) {
      if (declaration[1]) {
        const currentTimestamps = {};
        const currentValues = {};
        const dec = {};
        const attrs =
          sessionContext.deviceData.attributes.get(declaration[0]) || {};

        for (const [k, v] of Object.entries(declaration[1])) {
          if (k !== "value" && k !== "writable") continue;
          if (!attrs[k] || v > attrs[k][0]) dec[k] = v;
        }

        for (const [k, v] of Object.entries(attrs)) {
          currentTimestamps[k] = v[0];
          currentValues[k] = v[1];
        }

        if (Object.keys(dec).length) {
          if (!provisions) provisions = [];
          provisions.push([
            declaration[0][1],
            dec,
            {},
            currentTimestamps,
            currentValues
          ]);
        }
      }
    }
  }
  return provisions;
}

function generateSetVirtualParameterProvisions(
  sessionContext,
  virtualParameterDeclarations
) {
  let provisions;
  if (virtualParameterDeclarations) {
    for (const declaration of virtualParameterDeclarations) {
      if (declaration[2] && declaration[2].value != null) {
        const attrs = sessionContext.deviceData.attributes.get(declaration[0]);
        if (
          attrs &&
          attrs.writable &&
          attrs.writable[1] &&
          attrs.value &&
          attrs.value[1] != null
        ) {
          const val = declaration[2].value.slice();
          if (val[1] == null) val[1] = attrs.value[1][1];

          device.sanitizeParameterValue(val);

          if (val[0] !== attrs.value[1][0] || val[1] !== attrs.value[1][1]) {
            if (!provisions) provisions = [];
            const currentTimestamps = {};
            const currentValues = {};
            for (const [k, v] of Object.entries(attrs)) {
              currentTimestamps[k] = v[0];
              currentValues[k] = v[1];
            }

            provisions.push([
              declaration[0][1],
              {},
              { value: val },
              currentTimestamps,
              currentValues
            ]);
          }
        }
      }
    }
  }

  return provisions;
}

function processDeclarations(
  sessionContext,
  allDeclareTimestamps,
  allDeclareAttributeTimestamps,
  allDeclareAttributeValues
) {
  const deviceData = sessionContext.deviceData;
  const syncState = sessionContext.syncState;

  const root = sessionContext.deviceData.paths.add([]);
  const paths = deviceData.paths.find([], false, true, 99);
  paths.sort((a, b) =>
    a.wildcard === b.wildcard ? a.length - b.length : a.wildcard - b.wildcard
  );

  const virtualParameterDeclarations = [];

  function func(leafParam, leafIsObject, leafTimestamp, _paths) {
    const currentPath = _paths[0];
    const children = new Map();
    let declareTimestamp = 0;
    let declareAttributeTimestamps;
    let declareAttributeValues;

    let currentTimestamp = 0;
    let currentAttributes;
    if (currentPath.wildcard === 0)
      currentAttributes = deviceData.attributes.get(currentPath);

    for (const path of _paths) {
      if (path.length > currentPath.length) {
        const fragment = path[currentPath.length];
        let child = children.get(fragment);
        if (!child) {
          if (path.length > currentPath.length + 1) {
            // This is to ensure we don't descend more than one step at a time
            const p = common.addPathMeta(path.slice(0, currentPath.length + 1));
            child = [p];
          } else {
            child = [];
          }
          children.set(fragment, child);
        }
        child.push(path);
        continue;
      }

      currentTimestamp = Math.max(
        currentTimestamp,
        deviceData.timestamps.get(path) || 0
      );
      declareTimestamp = Math.max(
        declareTimestamp,
        allDeclareTimestamps.get(path) || 0
      );

      if (currentPath.wildcard === 0) {
        const attrs = allDeclareAttributeTimestamps.get(path);
        if (attrs) {
          if (declareAttributeTimestamps) {
            declareAttributeTimestamps = Object.assign(
              {},
              declareAttributeTimestamps
            );
            for (const [k, v] of Object.entries(attrs)) {
              declareAttributeTimestamps[k] = Math.max(
                v,
                declareAttributeTimestamps[k] || 0
              );
            }
          } else {
            declareAttributeTimestamps = attrs;
          }
        }

        declareAttributeValues =
          allDeclareAttributeValues.get(path) || declareAttributeValues;
      }
    }

    if (currentAttributes) {
      leafParam = currentPath;
      leafIsObject = currentAttributes.object
        ? currentAttributes.object[1]
        : null;
      // Possible V8 bug causes null === 0
      if (leafIsObject != null && leafIsObject === 0)
        leafTimestamp = Math.max(leafTimestamp, currentAttributes.object[0]);
    } else {
      leafTimestamp = Math.max(leafTimestamp, currentTimestamp);
    }

    switch (currentPath[0] !== "*" ? currentPath[0] : leafParam[0]) {
      case "Reboot":
        if (currentPath.length === 1) {
          if (declareAttributeValues && declareAttributeValues.value)
            syncState.reboot = +new Date(declareAttributeValues.value[0]);
        }
        break;
      case "FactoryReset":
        if (currentPath.length === 1) {
          if (declareAttributeValues && declareAttributeValues.value)
            syncState.factoryReset = +new Date(declareAttributeValues.value[0]);
        }
        break;
      case "Tags":
        if (
          currentPath.length === 2 &&
          currentPath.wildcard === 0 &&
          declareAttributeValues &&
          declareAttributeValues.value
        ) {
          syncState.tags.set(
            currentPath,
            device.sanitizeParameterValue([
              declareAttributeValues.value[0],
              "xsd:boolean"
            ])[0]
          );
        }

        break;
      case "Events":
      case "DeviceID":
        // Do nothing
        break;
      case "Downloads":
        if (
          currentPath.length === 3 &&
          currentPath.wildcard === 0 &&
          declareAttributeValues &&
          declareAttributeValues.value
        ) {
          if (currentPath[2] === "Download") {
            syncState.downloadsDownload.set(
              currentPath,
              declareAttributeValues.value[0]
            );
          } else {
            syncState.downloadsValues.set(
              currentPath,
              declareAttributeValues.value[0]
            );
          }
        }
        break;
      case "VirtualParameters":
        if (currentPath.length <= 2) {
          let d;
          if (!(declareTimestamp <= currentTimestamp)) d = [currentPath];

          if (currentPath.wildcard === 0) {
            if (declareAttributeTimestamps) {
              for (const [attrName, attrTimestamp] of Object.entries(
                declareAttributeTimestamps
              )) {
                if (
                  !(
                    currentAttributes &&
                    currentAttributes[attrName] &&
                    attrTimestamp <= currentAttributes[attrName][0]
                  )
                ) {
                  if (!d) d = [currentPath];
                  if (!d[1]) d[1] = {};
                  d[1][attrName] = attrTimestamp;
                }
              }
            }

            if (declareAttributeValues) {
              if (!d) d = [currentPath];
              d[2] = declareAttributeValues;
            }
          }

          if (d) virtualParameterDeclarations.push(d);
        }
        break;
      default:
        if (
          declareTimestamp > currentTimestamp &&
          declareTimestamp > leafTimestamp
        ) {
          if (currentPath === leafParam) {
            syncState.refreshAttributes.exist.add(leafParam);
          } else if (leafIsObject) {
            syncState.gpn.add(leafParam);
            if (leafTimestamp > 0) {
              const f = 1 << leafParam.length;
              syncState.gpnPatterns.set(
                leafParam,
                f | syncState.gpnPatterns.get(leafParam)
              );
            } else {
              const f =
                ((1 << currentPath.length) - 1) ^ ((1 << leafParam.length) - 1);
              syncState.gpnPatterns.set(
                currentPath,
                f | syncState.gpnPatterns.get(currentPath)
              );
            }
          } else {
            syncState.refreshAttributes.object.add(leafParam);
            if (leafIsObject == null) {
              const f =
                ((1 << syncState.gpnPatterns.length) - 1) ^
                ((1 << leafParam.length) - 1);
              syncState.gpnPatterns.set(
                currentPath,
                f | syncState.gpnPatterns.get(currentPath)
              );
            }
          }
        }

        if (currentAttributes) {
          if (declareAttributeTimestamps) {
            for (const [attrName, attrTimestamp] of Object.entries(
              declareAttributeTimestamps
            )) {
              if (
                !(
                  currentAttributes[attrName] &&
                  attrTimestamp <= currentAttributes[attrName][0]
                )
              ) {
                if (attrName === "value") {
                  if (
                    !(
                      currentAttributes.object &&
                      currentAttributes.object[1] != null
                    )
                  )
                    syncState.refreshAttributes.object.add(currentPath);
                  else if (currentAttributes.object[1] === 0)
                    syncState.refreshAttributes.value.add(currentPath);
                } else {
                  syncState.refreshAttributes[attrName].add(currentPath);
                }
              }
            }
          }
          if (declareAttributeValues && declareAttributeValues.value != null)
            syncState.spv.set(currentPath, declareAttributeValues.value);
        }
    }

    for (let [fragment, child] of children) {
      // This fine expression avoids duplicate visits, don't ask.
      if (
        ((currentPath.wildcard ^ child[0].wildcard) &
          ((1 << currentPath.length) - 1)) >>
          leafParam.length ===
        0
      ) {
        if (fragment !== "*") {
          const wildcardChild = children.get("*");
          if (wildcardChild) child = child.concat(wildcardChild);
        }
        func(leafParam, leafIsObject, leafTimestamp, child);
      }
    }
  }

  if (
    allDeclareTimestamps.size ||
    allDeclareAttributeTimestamps.size ||
    allDeclareAttributeValues.size
  )
    func(root, 1, 0, paths);

  return virtualParameterDeclarations;
}

function loadPath(sessionContext, path, depth) {
  depth = depth || (1 << path.length) - 1;
  if (sessionContext.new || !depth) return true;

  if (!sessionContext.toLoad) sessionContext.toLoad = new Map();

  // Trim trailing wildcards
  let trimWildcard = path.length;
  while (trimWildcard && path[trimWildcard - 1] === "*") --trimWildcard;

  if (trimWildcard < path.length) path = path.slice(0, trimWildcard);

  for (let i = 0; i <= path.length; ++i) {
    const d = i === path.length ? 99 : i;
    for (const sup of sessionContext.deviceData.paths.find(
      path.slice(0, i),
      true,
      false,
      d
    )) {
      let v =
        sessionContext.deviceData.loaded.get(sup) |
        sessionContext.toLoad.get(sup);
      if (sup.length > i) v &= (1 << i) - 1;
      depth &= depth ^ v;
      if (depth === 0) return true;
    }
  }

  path = sessionContext.deviceData.paths.add(path);
  depth |= sessionContext.toLoad.get(path);
  sessionContext.toLoad.set(path, depth);
  return false;
}

function processInstances(
  sessionContext,
  parent,
  parameters,
  keys,
  minInstances,
  maxInstances,
  defer
) {
  let instancesToCreate, instancesToDelete;
  if (parent[0] === "Downloads") {
    if (parent.length !== 1) return;
    instancesToDelete = sessionContext.syncState.downloadsToDelete;
    instancesToCreate = sessionContext.syncState.downloadsToCreate;
  } else {
    instancesToDelete = sessionContext.syncState.instancesToDelete.get(parent);
    if (instancesToDelete == null) {
      instancesToDelete = new Set();
      sessionContext.syncState.instancesToDelete.set(parent, instancesToDelete);
    }

    instancesToCreate = sessionContext.syncState.instancesToCreate.get(parent);
    if (instancesToCreate == null) {
      instancesToCreate = new InstanceSet();
      sessionContext.syncState.instancesToCreate.set(parent, instancesToCreate);
    }
  }

  if (defer && instancesToCreate.size === 0 && instancesToDelete.size === 0)
    return;

  let counter = 0;
  for (const p of parameters) {
    ++counter;
    if (counter > maxInstances) instancesToDelete.add(p);
    else if (counter <= minInstances) instancesToDelete.delete(p);
  }

  // Key is null if deleting a particular instance rather than use alias
  if (!keys) return;

  for (const inst of instancesToCreate.superset(keys)) {
    ++counter;
    if (counter > maxInstances) instancesToCreate.delete(inst);
  }

  for (const inst of instancesToCreate.subset(keys)) {
    ++counter;
    if (counter <= minInstances) {
      instancesToCreate.delete(inst);
      instancesToCreate.add(JSON.parse(JSON.stringify(keys)));
    }
  }

  while (counter < minInstances) {
    ++counter;
    instancesToCreate.add(JSON.parse(JSON.stringify(keys)));
  }
}

function clear(sessionContext, toClear, callback) {
  if (!toClear || !toClear.length) return void callback();

  const MAX_DEPTH = config.get("MAX_DEPTH", sessionContext.deviceId);

  for (const c of toClear) {
    if (c[1]) {
      const p = c[0].slice(0, -1); // in order to include superset
      loadPath(
        sessionContext,
        p,
        ((1 << p.length) - 1) ^ ((1 << MAX_DEPTH) - 1)
      );
    } else if (c[2] && c[2].object) {
      loadPath(
        sessionContext,
        c[0],
        (((1 << c[0].length) - 1) >> 1) ^ ((1 << MAX_DEPTH) - 1)
      );
    } else {
      loadPath(sessionContext, c[0], (1 << c[0].length) >> 1);
    }
  }

  loadParameters(sessionContext, err => {
    if (err) return void callback(err);
    for (const c of toClear)
      device.clear(sessionContext.deviceData, c[0], c[1], c[2], c[3]);

    callback();
  });
}

function rpcResponse(sessionContext, id, rpcRes, callback) {
  if (id !== generateRpcId(sessionContext))
    return void callback(new Error("Request ID not recognized"));

  ++sessionContext.rpcCount;

  const rpcReq = sessionContext.rpcRequest;

  if (!rpcReq.next) {
    sessionContext.rpcRequest = null;
  } else if (rpcReq.next === "getInstanceKeys") {
    const parameterNames = [];
    const instanceValues = {};
    for (const [k, v] of Object.entries(rpcReq.instanceValues)) {
      const n = `${rpcReq.objectName}${rpcRes.instanceNumber}.${k}`;
      parameterNames.push(n);
      instanceValues[n] = v;
    }

    if (!parameterNames.length) {
      sessionContext.rpcRequest = null;
    } else {
      sessionContext.rpcRequest = {
        name: "GetParameterValues",
        parameterNames: parameterNames,
        next: "setInstanceKeys",
        instanceValues: instanceValues
      };
    }
  } else if (rpcReq.next === "setInstanceKeys") {
    const parameterList = [];
    for (const p of rpcRes.parameterList) {
      if (p[1] !== rpcReq.instanceValues[p[0]]) {
        parameterList.push(
          [p[0]].concat(
            device.sanitizeParameterValue([rpcReq.instanceValues[p[0]], p[2]])
          )
        );
      }
    }

    if (!parameterList.length) {
      sessionContext.rpcRequest = null;
    } else {
      sessionContext.rpcRequest = {
        name: "SetParameterValues",
        parameterList: parameterList
      };
    }
  }

  const timestamp = sessionContext.timestamp + sessionContext.iteration;

  const revision =
    (sessionContext.revisions[sessionContext.revisions.length - 1] || 0) + 1;
  sessionContext.deviceData.timestamps.revision = revision;
  sessionContext.deviceData.attributes.revision = revision;

  let toClear, root, missing, params;

  switch (rpcRes.name) {
    case "GetParameterValuesResponse":
      if (rpcReq.name !== "GetParameterValues") {
        return void callback(
          new Error("Response name does not match request name")
        );
      }

      for (const p of rpcRes.parameterList) {
        toClear = device.set(
          sessionContext.deviceData,
          common.parsePath(p[0]),
          timestamp,
          { object: [timestamp, 0], value: [timestamp, p.slice(1)] },
          toClear
        );
      }

      break;
    case "GetParameterNamesResponse":
      if (rpcReq.name !== "GetParameterNames") {
        return void callback(
          new Error("Response name does not match request name")
        );
      }

      if (rpcReq.parameterPath.endsWith("."))
        root = common.parsePath(rpcReq.parameterPath.slice(0, -1));
      else root = common.parsePath(rpcReq.parameterPath);

      params = [[root.concat("*"), timestamp]];

      // Some clients don't report all ancestors explicitly
      missing = {};

      for (const p of rpcRes.parameterList) {
        let i = p[0].length - 1;
        while ((i = p[0].lastIndexOf(".", i - 1)) > rpcReq.parameterPath.length)
          missing[p[0].slice(0, i)] |= 0;

        if (p[0].endsWith(".")) {
          missing[p[0].slice(0, -1)] |= 1;
          const path = common.parsePath(p[0].slice(0, -1));
          if (!rpcReq.nextLevel) params.push([path.concat("*"), timestamp]);

          params.push([
            path,
            timestamp,
            { object: [timestamp, 1], writable: [timestamp, p[1] ? 1 : 0] }
          ]);
        } else {
          missing[p[0]] |= 1;
          params.push([
            common.parsePath(p[0]),
            timestamp,
            { object: [timestamp, 0], writable: [timestamp, p[1] ? 1 : 0] }
          ]);
        }
      }

      for (const [k, v] of Object.entries(missing)) {
        if (v === 0) {
          // TODO consider showing a warning
          const path = common.parsePath(k);
          params.push([
            path,
            timestamp,
            { object: [timestamp, 1], writable: [timestamp, 0] }
          ]);
          params.push([path.concat("*"), timestamp]);
        }
      }

      // Sort such that:
      // - Longer params come first in order to work around client issue
      //   where object paths can have no trailing dot.
      // - Parameters come before wildcard paths.
      params.sort((a, b) => {
        let al = a[0].length;
        let bl = b[0].length;
        if (b[0][bl - 1] === "*") bl *= -1;
        if (a[0][al - 1] === "*") al *= -1;
        return bl - al;
      });

      if (rpcReq.nextLevel) {
        loadPath(sessionContext, root, (1 << (root.length + 1)) - 1);
      } else {
        const MAX_DEPTH = config.get("MAX_DEPTH", sessionContext.deviceId);
        loadPath(sessionContext, root, (1 << MAX_DEPTH) - 1);
      }

      loadParameters(sessionContext, err => {
        if (err) return void callback(err);

        if (!root.length) {
          for (const n of [
            "DeviceID",
            "Events",
            "Tags",
            "Reboot",
            "FactoryReset",
            "VirtualParameters",
            "Downloads"
          ]) {
            const p = sessionContext.deviceData.paths.get([n]);
            if (p && sessionContext.deviceData.attributes.has(p))
              sessionContext.deviceData.timestamps.set(p, timestamp);
          }
        }

        for (const p of params) {
          toClear = device.set(
            sessionContext.deviceData,
            p[0],
            p[1],
            p[2],
            toClear
          );
        }

        clear(sessionContext, toClear, callback);
      });
      return;
    case "SetParameterValuesResponse":
      if (rpcReq.name !== "SetParameterValues") {
        return void callback(
          new Error("Response name does not match request name")
        );
      }

      for (const p of rpcReq.parameterList) {
        toClear = device.set(
          sessionContext.deviceData,
          common.parsePath(p[0]),
          timestamp + 1,
          {
            object: [timestamp + 1, 0],
            writable: [timestamp + 1, 1],
            value: [timestamp + 1, p.slice(1)]
          },
          toClear
        );
      }

      break;
    case "AddObjectResponse":
      toClear = device.set(
        sessionContext.deviceData,
        common.parsePath(rpcReq.objectName + rpcRes.instanceNumber),
        timestamp + 1,
        { object: [timestamp + 1, 1] },
        toClear
      );
      break;
    case "DeleteObjectResponse":
      toClear = device.set(
        sessionContext.deviceData,
        common.parsePath(rpcReq.objectName.slice(0, -1)),
        timestamp + 1,
        null,
        toClear
      );
      break;
    case "RebootResponse":
      toClear = device.set(
        sessionContext.deviceData,
        common.parsePath("Reboot"),
        timestamp + 1,
        { value: [timestamp + 1, [sessionContext.timestamp, "xsd:dateTime"]] },
        toClear
      );
      break;
    case "FactoryResetResponse":
      toClear = device.set(
        sessionContext.deviceData,
        common.parsePath("FactoryReset"),
        timestamp + 1,
        { value: [timestamp + 1, [sessionContext.timestamp, "xsd:dateTime"]] },
        toClear
      );
      break;
    case "DownloadResponse":
      toClear = device.set(
        sessionContext.deviceData,
        ["Downloads", rpcReq.instance, "Download"],
        timestamp + 1,
        { value: [timestamp + 1, [sessionContext.timestamp, "xsd:dateTime"]] },
        toClear
      );

      if (rpcRes.status === 0) {
        toClear = device.set(
          sessionContext.deviceData,
          ["Downloads", rpcReq.instance, "LastDownload"],
          timestamp + 1,
          {
            value: [timestamp + 1, [sessionContext.timestamp, "xsd:dateTime"]]
          },
          toClear
        );

        toClear = device.set(
          sessionContext.deviceData,
          ["Downloads", rpcReq.instance, "LastFileType"],
          timestamp + 1,
          { value: [timestamp + 1, [rpcReq.fileType, "xsd:string"]] },
          toClear
        );

        toClear = device.set(
          sessionContext.deviceData,
          ["Downloads", rpcReq.instance, "LastFileName"],
          timestamp + 1,
          { value: [timestamp + 1, [rpcReq.fileType, "xsd:string"]] },
          toClear
        );

        toClear = device.set(
          sessionContext.deviceData,
          ["Downloads", rpcReq.instance, "LastTargetFileName"],
          timestamp + 1,
          { value: [timestamp + 1, [rpcReq.fileType, "xsd:string"]] },
          toClear
        );

        toClear = device.set(
          sessionContext.deviceData,
          ["Downloads", rpcReq.instance, "StartTime"],
          timestamp + 1,
          { value: [timestamp + 1, [+rpcRes.startTime, "xsd:dateTime"]] },
          toClear
        );

        toClear = device.set(
          sessionContext.deviceData,
          ["Downloads", rpcReq.instance, "CompleteTime"],
          timestamp + 1,
          { value: [timestamp + 1, [+rpcRes.completeTime, "xsd:dateTime"]] },
          toClear
        );
      } else {
        const operation = {
          name: "Download",
          timestamp: sessionContext.timestamp,
          provisions: sessionContext.provisions,
          channels: sessionContext.channels,
          retries: {},
          args: {
            instance: rpcReq.instance,
            fileType: rpcReq.fileType,
            fileName: rpcReq.fileName,
            targetFileName: rpcReq.targetFileName
          }
        };

        for (const channel of Object.keys(sessionContext.channels)) {
          if (sessionContext.retries[channel] != null)
            operation.retries[channel] = sessionContext.retries[channel];
        }

        sessionContext.operations[rpcReq.commandKey] = operation;
        if (!sessionContext.operationsTouched)
          sessionContext.operationsTouched = {};
        sessionContext.operationsTouched[rpcReq.commandKey] = 1;
      }
      break;
    default:
      return void callback(new Error("Response name not recognized"));
  }
  clear(sessionContext, toClear, callback);
}

function rpcFault(sessionContext, id, faultResponse, callback) {
  const rpcReq = sessionContext.rpcRequest;
  delete sessionContext.syncState;
  delete sessionContext.rpcRequest;
  ++sessionContext.rpcCount;

  // Recover from invalid parameter name faults
  if (faultResponse.detail.faultCode === "9005") {
    const timestamp = sessionContext.timestamp + sessionContext.iteration;
    const revision =
      (sessionContext.revisions[sessionContext.revisions.length - 1] || 0) + 1;
    sessionContext.deviceData.timestamps.revision = revision;
    sessionContext.deviceData.attributes.revision = revision;

    let toClear;
    if (rpcReq.name === "GetParameterNames") {
      if (rpcReq.parameterPath) {
        toClear = [
          [rpcReq.parameterPath.replace(/\.$/, "").split("."), timestamp]
        ];
      }
    } else if (rpcReq.name === "GetParameterValues") {
      toClear = rpcReq.parameterNames.map(p => [
        p.replace(/\.$/, "").split("."),
        timestamp
      ]);
    } else if (rpcReq.name === "SetParameterValues") {
      toClear = rpcReq.parameterList.map(p => [
        p[0].replace(/\.$/, "").split("."),
        timestamp
      ]);
    } else if (rpcReq.name === "AddObject") {
      toClear = [[rpcReq.objectName.replace(/\.$/, "").split("."), timestamp]];
    } else if (rpcReq.name === "DeleteObject") {
      toClear = [[rpcReq.objectName.replace(/\.$/, "").split("."), timestamp]];
    }

    if (toClear) return void clear(sessionContext, toClear, callback);
  }

  const fault = {
    code: `cwmp.${faultResponse.detail.faultCode}`,
    message: faultResponse.detail.faultString,
    detail: faultResponse.detail,
    timestamp: sessionContext.timestamp
  };

  callback(null, fault);
}

function deserialize(sessionContextString, callback) {
  const sessionContext = JSON.parse(sessionContextString);

  for (const decs of sessionContext.declarations)
    for (const d of decs) common.addPathMeta(d.path);

  const deviceData = initDeviceData();
  for (const r of sessionContext.deviceData) {
    const path = deviceData.paths.add(r[0]);

    if (r[1]) deviceData.loaded.set(path, r[1]);

    if (r[2]) deviceData.trackers.set(path, r[2]);

    if (r[3]) {
      deviceData.timestamps.setRevisions(path, r[3]);
      if (r[4]) deviceData.attributes.setRevisions(path, r[4]);
    }
  }

  sessionContext.deviceData = deviceData;
  // Ensure cache is populated
  localCache.getCurrentSnapshot(err => {
    callback(err, sessionContext);
  });
}

function serialize(sessionContext, callback) {
  const deviceData = [];

  for (const path of sessionContext.deviceData.paths.find(
    [],
    false,
    false,
    99
  )) {
    const e = [path];
    e[1] = sessionContext.deviceData.loaded.get(path) || 0;
    e[2] = sessionContext.deviceData.trackers.get(path) || null;
    e[3] = sessionContext.deviceData.timestamps.getRevisions(path) || null;
    e[4] = sessionContext.deviceData.attributes.getRevisions(path) || null;
    deviceData.push(e);
  }

  sessionContext = Object.assign({}, sessionContext);
  sessionContext.deviceData = deviceData;
  delete sessionContext.syncState;
  delete sessionContext.toLoad;
  delete sessionContext.httpRequest;
  delete sessionContext.httpResponse;

  const sessionContextString = JSON.stringify(sessionContext);

  callback(null, sessionContextString);
}

exports.init = init;
exports.timeoutOperations = timeoutOperations;
exports.inform = inform;
exports.transferComplete = transferComplete;
exports.addProvisions = addProvisions;
exports.clearProvisions = clearProvisions;
exports.rpcRequest = rpcRequest;
exports.rpcResponse = rpcResponse;
exports.rpcFault = rpcFault;
exports.serialize = serialize;
exports.deserialize = deserialize;
