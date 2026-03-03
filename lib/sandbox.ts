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

import * as vm from "vm";
import seedrandom from "seedrandom";
import * as device from "./device";
import * as extensions from "./extensions";
import * as logger from "./logger";
import * as scheduling from "./scheduling";
import Path from "./common/path";
import { Fault, SessionContext, ScriptResult } from "./types";
import { metricsExporter } from "./metrics";
import request from "request";

// Used for throwing to exit user script and commit
const COMMIT = Symbol();

// Used to execute extensions and restart
const EXT = Symbol();

// Used to skip provision if initilization conditions are not met
const SKIP = Symbol();

// Used to upgrade a device's firmware
const UPGRADE = Symbol();

const UNDEFINED = undefined;

const context = vm.createContext();

const FORCE_CUSTOM_SCRIPT_LOGGING =
  process.env.FLM_FORCE_CUSTOM_SCRIPT_LOGGING === 'true';
const FLASHMAN_PORT = process.env.FLM_WEB_PORT || 8000;
const FLASHMAN_URL =
  'http://'+(process.env.FLM_WEB_HOST || 'localhost') + `:${FLASHMAN_PORT}`;

let state;

const runningExtensions = new WeakMap<
  SessionContext,
  Map<string, Promise<Fault>>
>();
function runExtension(sessionContext, key, extCall): Promise<Fault> {
  let re = runningExtensions.get(sessionContext);
  if (!re) {
    re = new Map<string, Promise<Fault>>();
    runningExtensions.set(sessionContext, re);
  }

  let prom = re.get(key);
  if (!prom) {
    re.set(
      key,
      (prom = new Promise((resolve, reject) => {
        extensions
          .run(extCall)
          .then(({ fault, value }) => {
            re.delete(key);
            if (!fault) sessionContext.extensionsCache[key] = value;
            resolve(fault);
          })
          .catch(reject);
      }))
    );
  }

  return prom;
}

class SandboxDate {
  public constructor(
    ...argumentList: [
      number?,
      number?,
      number?,
      number?,
      number?,
      number?,
      number?
    ]
  ) {
    if (argumentList.length) return new Date(...argumentList);

    return new Date(state.sessionContext.timestamp);
  }

  public static now(intervalOrCron, variance): number {
    let t = state.sessionContext.timestamp;

    if (typeof intervalOrCron === "number") {
      if (variance == null) variance = intervalOrCron;

      let offset = 0;
      if (variance)
        offset = scheduling.variance(state.sessionContext.deviceId, variance);

      t = scheduling.interval(t, intervalOrCron, offset);
    } else if (typeof intervalOrCron === "string") {
      let offset = 0;
      if (variance)
        offset = scheduling.variance(state.sessionContext.deviceId, variance);
      const cron = scheduling.parseCron(intervalOrCron);
      t = scheduling.cron(t, cron, offset)[0];
    } else if (intervalOrCron) {
      throw new Error("Invalid Date.now() argument");
    }

    return t;
  }

  public static parse(dateString: string): number {
    return Date.parse(dateString);
  }

  public static UTC(
    ...args: [number, number?, number?, number?, number?, number?, number?]
  ): number {
    return Date.UTC(...args);
  }
}

function random(): number {
  if (!state.rng) state.rng = seedrandom(state.sessionContext.deviceId);

  return state.rng();
}

random.seed = function (s) {
  state.rng = seedrandom(s);
};

class ParameterWrapper {
  public constructor(path: Path, attributes, unpacked?, unpackedRevision?) {
    for (const attrName of attributes) {
      Object.defineProperty(this, attrName, {
        get: function () {
          if (state.uncommitted) commit();

          if (state.revision !== unpackedRevision) {
            unpackedRevision = state.revision;
            unpacked = device.unpack(
              state.sessionContext.deviceData,
              path,
              state.revision
            );
          }

          if (!unpacked.length) return UNDEFINED;

          const attr = state.sessionContext.deviceData.attributes.get(
            unpacked[0],
            state.revision
          )[attrName];

          if (!attr) return UNDEFINED;

          return attr[1];
        },
      });
    }

    Object.defineProperty(this, "path", {
      get: function () {
        if (state.uncommitted) commit();

        if (state.revision !== unpackedRevision) {
          unpackedRevision = state.revision;
          unpacked = device.unpack(
            state.sessionContext.deviceData,
            path,
            state.revision
          );
        }

        if (!unpacked.length) return UNDEFINED;

        return unpacked[0].toString();
      },
    });

    Object.defineProperty(this, "size", {
      get: function () {
        if (state.uncommitted) commit();

        if (state.revision !== unpackedRevision) {
          unpackedRevision = state.revision;
          unpacked = device.unpack(
            state.sessionContext.deviceData,
            path,
            state.revision
          );
        }

        if (!unpacked.length) return UNDEFINED;

        return unpacked.length;
      },
    });

    this[Symbol.iterator] = function* () {
      if (state.uncommitted) commit();

      if (state.revision !== unpackedRevision) {
        unpackedRevision = state.revision;
        unpacked = device.unpack(
          state.sessionContext.deviceData,
          path,
          state.revision
        );
      }

      for (const p of unpacked)
        yield new ParameterWrapper(p, attributes, [p], state.revision);
    };
  }
}

function declare(
  path: string,
  timestamps: { [attr: string]: number },
  values: { [attr: string]: any }
): ParameterWrapper {
  state.uncommitted = true;
  if (!timestamps) timestamps = {};

  if (!values) values = {};

  const parsedPath = Path.parse(path);

  const declaration = {
    path: parsedPath,
    pathGet: 1,
    pathSet: null,
    attrGet: null,
    attrSet: null,
    defer: true,
  };

  const attrs = new Set();

  for (const [attrName, attrValue] of Object.entries(values)) {
    if (attrName === "path") {
      declaration.pathSet = attrValue;
    } else {
      attrs.add(attrName);
      if (!declaration.attrGet) declaration.attrGet = {};
      if (!declaration.attrSet) declaration.attrSet = {};
      declaration.attrGet[attrName] = 1;
      if (attrName === "value" && !Array.isArray(values.value))
        declaration.attrSet.value = [values.value];
      else declaration.attrSet[attrName] = values[attrName];
    }
  }

  for (const [attrName, attrTimestamp] of Object.entries(timestamps)) {
    if (!(attrTimestamp >= 1)) continue;
    if (attrName === "path") {
      declaration.pathGet = attrTimestamp;
    } else {
      attrs.add(attrName);
      if (!declaration.attrGet) declaration.attrGet = {};
      declaration.attrGet[attrName] = attrTimestamp;
    }
  }

  state.declarations.push(declaration);

  return new ParameterWrapper(parsedPath, attrs);
}

function clear(path: string, timestamp: number, attributes?): void {
  state.uncommitted = true;

  if (state.revision === state.maxRevision)
    state.clear.push([Path.parse(path), timestamp, attributes]);
}

function commit(): void {
  ++state.revision;
  state.uncommitted = false;

  if (state.revision === state.maxRevision + 1) {
    for (const d of state.declarations) d.defer = false;
    throw COMMIT;
  } else if (state.revision > state.maxRevision + 1) {
    throw new Error(
      "Declare function should not be called from within a try/catch block"
    );
  }
}

function ext(...args: unknown[]): any {
  ++state.extCounter;
  const extCall = args.map(String);
  const key = `${state.revision}: ${JSON.stringify(extCall)}`;

  if (key in state.sessionContext.extensionsCache)
    return state.sessionContext.extensionsCache[key];

  state.extensions[key] = extCall;
  throw EXT;
}

function log(msg: string, meta: Record<string, unknown>): void {
  if(logger.LOG_INFO_DATA) {
    if (state.revision === state.maxRevision && state.extCounter >= 0) {
      const details = Object.assign({}, meta, {
        sessionContext: state.sessionContext,
        message: `Script: ${msg}`,
      });

      delete details["hostname"];
      delete details["pid"];
      delete details["name"];
      delete details["version"];
      delete details["deviceId"];
      delete details["remoteAddress"];

      logger.accessInfo(details);
    }
  }
}

interface alertSchema {
  mac: string;
  genieID: string;
  oui: string;
  modelClass: string;
  modelName: string;
  isIGDModel: string;
  acsURL: string;
  connectionRequestURL: string;
  metric: {
    message: string,
    reason: string,
  };
}

function alert(schema: alertSchema):void {
  if (logger.LOG_WARN_DATA) {
    if (state.revision === state.maxRevision && state.extCounter >= 0) {
      const prefixArray: string[] = [];
      for (const [key, value] of Object.entries(schema)) {
        if (typeof value === 'string')
          prefixArray.push(`${key}: ${value}`);
      }
      const prefix = prefixArray.join(', ');
      const details = Object.assign({}, {
        sessionContext: state.sessionContext,
        message: `[${
          schema.metric.reason}] ${
          prefix} -> ${
          schema.metric.message}`,
      });
      logger.warn(details);
      metricsExporter.failedProvisions.labels({
        is_igd: schema.isIGDModel ?? 'unknown',
        reason: schema.metric.reason ?? 'unknown',
        model: schema.modelName ?? 'unknown',
      }).inc();
    }
  }
}

/**
 * Flashman-Log!! Not the word "flog"!!
 * Send the provided message to Flashman for logging. This function will only
 * log if the sandbox is initialized and either in debug mode or if the
 * environment variable FORCE_CUSTOM_SCRIPT_LOGGING is set to true.
 *
 * @param {Array<any>} args - The arguments to log. Each argument will be
 * stringified and concatenated.
 */
export function flog(...args: any[]): void {
  // If not initialized, throw an error
  if (!state.sessionContext.customScriptInfo?.initialized)
    throw new Error("flog: Sandbox not initialized");

  // If no arguments were provided, do not log
  if (args.length === 0) return;

  // If not in debug mode, do not log
  if (
    !state.sessionContext.customScriptInfo?.isDebug &&
    !FORCE_CUSTOM_SCRIPT_LOGGING
  ) return;

  // Prepare the message to log
  const message = '[ INFO  ] ' + args
    .map((arg) => JSON.stringify(arg))
    .join(" ");
  
  // Send the message to Flashman
  request({
    url: `${FLASHMAN_URL}/api/v3/device/acs-id/` +
      `${state.sessionContext.deviceId}/script/` +
      `${state.sessionContext.customScriptInfo?.scriptTag}/log`,
    method: 'POST',
    json: {
      timestamp: new Date().toISOString(),
      type: 'log',
      message: message,
    }
  }).on('response', (response) => {
    if (response.statusCode < 200 || response.statusCode >= 300) {
      log(
        'Failed to log script to Flashman. ' +
        `Status code: ${response.statusCode}` +
        `Response body: ${JSON.stringify(response.body)}`,
        {}
      );
    }
  }).on('error', (err) => {
    // If there is an error sending the log to Flashman, log it to the console
    log('Failed to send log to Flashman: ' + JSON.stringify(err), {});
  });
}

/**
 * Flashman-Error!! Not the word "ferrou"!!
 * Send the provided message to Flashman for logging. This function will only
 * log if the sandbox is initialized and either in debug mode or if the
 * environment variable FORCE_CUSTOM_SCRIPT_LOGGING is set to true.
 *
 * @param {Array<any>} args - The arguments to log. Each argument will be
 * stringified and concatenated.
 */
export function ferror(...args: any[]): void {
  // If not initialized, throw an error
  if (!state.sessionContext.customScriptInfo?.initialized)
    throw new Error("ferror: Sandbox not initialized");

  // If no arguments were provided, do not log
  if (args.length === 0) return;

  // If not in debug mode, do not log
  if (
    !state.sessionContext.customScriptInfo?.isDebug &&
    !FORCE_CUSTOM_SCRIPT_LOGGING
  ) return;

  // Prepare the message to log
  const message = '[ ERROR ] ' + args
    .map((arg) => JSON.stringify(arg))
    .join(" ");
  
  // Send the message to Flashman
  request({
    url: `${FLASHMAN_URL}/api/v3/device/acs-id/` +
      `${state.sessionContext.deviceId}/script/` +
      `${state.sessionContext.customScriptInfo?.scriptTag}/log`,
    method: 'POST',
    json: {
      timestamp: new Date().toISOString(),
      type: 'error',
      message: message,
    }
  }).on('response', (response) => {
    if (response.statusCode < 200 || response.statusCode >= 300) {
      log(
        'Failed to log error script to Flashman. ' +
        `Status code: ${response.statusCode}` +
        `Response body: ${JSON.stringify(response.body)}`,
        {}
      );
    }
  }).on('error', (err) => {
    // If there is an error sending the log to Flashman, log it to the console
    log('Failed to send error log to Flashman: ' + JSON.stringify(err), {});
  });
}

enum ActionType {
  ADD_OBJECT = "addObject",
  DELETE_OBJECT = "deleteObject",
  SET_VALUE = "setValue",
}

function audit(actionType: ActionType, path: string, value?: any): void {
  // Send the request to Flashman for auditing
  request({
    url: `${FLASHMAN_URL}/api/v3/device/acs-id/` +
      `${state.sessionContext.deviceId}/script/` +
      `${state.sessionContext.customScriptInfo?.scriptTag}/audit`,
    method: 'POST',
    json: {
      timestamp: new Date().toISOString(),
      type: actionType,
      path: path,
      value: value,
    },
  }).on('response', (response) => {
    if (response.statusCode < 200 || response.statusCode >= 300) {
      log(
        'Failed to audit script to Flashman. ' +
        `Status code: ${response.statusCode}` +
        `Response body: ${JSON.stringify(response.body)}`,
        {}
      );
    }
  }).on('error', (err) => {
    // If there is an error sending the audit to Flashman, log it to the console
    log(
      'Failed to send audit to Flashman: ' + JSON.stringify(err) +
        ` for action ${actionType} on path ${path} with value ${value}`,
      {},
    );
  });
}

/**
 * Gets the value of a parameter at the specified path.
 *
 * @param {string} path - The path of the parameter to get.
 *
 * @return {boolean|number|string|undefined} The value of the parameter, or
 * undefined if not found.
 *
 * @throws {Error} If the sandbox is not initialized.
 */
export function getValue(path: string): boolean | number | string | undefined {
  // If not initialized, throw an error
  if (!state.sessionContext.customScriptInfo?.initialized)
    throw new Error("getValue: Sandbox not initialized");

  // If the path is not a string, return an error
  if (typeof path !== "string") {
    log(`[ERROR] getValue() called with a non-string path: ${path}`, {});
    return UNDEFINED;
  }

  // Trim whitespace from the path
  path = path.trim();

  // If the path is empty, return an error
  if (path.length === 0) {
    log("[ERROR] getValue() called with an empty path.", {});
    return UNDEFINED;
  }

  // If the path has trailing dot, remove it
  if (path.endsWith(".")) path = path.slice(0, -1);

  // Get the value
  const parameter = declare(
    path,
    { value: SandboxDate.now(null, null), path: SandboxDate.now(null, null) },
    null,
  ) as {
    value?: [boolean | number | string, string];
  };

  // If this is a valid parameter with a value, return it
  if (parameter?.value?.[0]) return parameter.value[0];

  return UNDEFINED;
}

/**
 * Sets the value of a parameter at the specified path.
 *
 * @param {string} path - The path of the parameter to set.
 * @param {boolean|number|string} value - The value to set.
 * @return {boolean} True if the value was set successfully, false otherwise.
 */
export function setValue(
  path: string,
  value: boolean | number | string
): boolean {
  // If not initialized, throw an error
  if (!state.sessionContext.customScriptInfo?.initialized)
    throw new Error("setValue: Sandbox not initialized");

  // If the path is not a string, return an error
  if (typeof path !== "string") {
    log(`[ERROR] setValue() called with a non-string path: ${path}`, {});
    return UNDEFINED;
  }

  // Trim whitespace from the path
  path = path.trim();

  // If the path is empty, return an error
  if (path.length === 0) {
    log("[ERROR] setValue() called with an empty path.", {});
    return UNDEFINED;
  }

  // If the path has trailing dot, remove it
  if (path.endsWith(".")) path = path.slice(0, -1);

  // Check if the value is of valid type
  if (
    typeof value !== "boolean" &&
    typeof value !== "number" &&
    typeof value !== "string"
  ) {
    log(
      `[ERROR] setValue() called with an invalid value type: ${typeof value}.`,
      {}
    );
    return false;
  }

  // Audit this setValue action before sending
  audit(ActionType.SET_VALUE, path, value);

  // Set the value
  declare(path, null, { value: value });

  return true;
}

/**
 * Adds objects at the specified path.
 *
 * @param {string} path - The path where the object should be added.
 * @return {number|undefined} The instance number of the added object, or
 * undefined if the operation failed.
 */
export function addObject(
  path: string,
): number | undefined {
  // If not initialized, throw an error
  if (!state.sessionContext.customScriptInfo?.initialized)
    throw new Error("addObject: Sandbox not initialized");

  // If the path is not a string, return an error
  if (typeof path !== "string") {
    log(`[ERROR] addObject() called with a non-string path: ${path}`, {});
    return UNDEFINED;
  }

  // Trim whitespace from the path
  path = path.trim();

  // If the path is empty, return an error
  if (path.length === 0) {
    log("[ERROR] addObject() called with an empty path.", {});
    return UNDEFINED;
  }

  // If the path does not end with a * or [...], return an error
  if (!path.endsWith("*") && !(/\[[\w=\d]*\]$/).test(path)) {
    log(
      '[ERROR] addObject() called with a path that does not end with "*"' +
        `or [...]: ${path}.`,
      {}
    );
    return UNDEFINED;
  }

  // Get the amount of objects already present at the path
  const parameter = declare(
    path,
    { path: SandboxDate.now(null, null) },
    null,
  ) as { size?: number };
  const currentSize = parameter?.size ?? 0;

  // If currentSize is undefined, return an error
  if (typeof currentSize !== 'number') {
    log(
      '[ERROR] Unable to determine the current size of objects at path:' +
       ` ${path}.`,
      {}
    );
    return UNDEFINED;
  }

  // The new size will be current size plus 1 that we are creating
  const newSize = currentSize + 1;

  // Audit this addition
  audit(ActionType.ADD_OBJECT, path, newSize);

  // Create the new object
  const objectCreated = declare(
    path,
    { path: SandboxDate.now(null, null) },
    { path: newSize },
  ) as { path?: string };

  // The path of the new object added
  const newObjectPath = objectCreated.path;

  // If newObjectPath is undefined, return an error
  if (typeof newObjectPath !== 'string') {
    log(
      '[ERROR] Unable to determine the path of the newly added object at' +
        ` ${path}.`,
      {}
    );
    return UNDEFINED;
  }

  return parseInt(newObjectPath.split(".").pop() ?? "", 10);
}

/**
 * Deletes the last object at the specified path.
 *
 * @param {string} path - The path where the object should be deleted.
 * @return {boolean} True if the object was deleted successfully, false
 * otherwise.
 */
export function deleteObject(
  path: string,
): boolean {
  // If not initialized, throw an error
  if (!state.sessionContext.customScriptInfo?.initialized)
    throw new Error("deleteObject: Sandbox not initialized");

  // If the path is not a string, return an error
  if (typeof path !== "string") {
    ferror(`[ERROR] deleteObject() called with a non-string path: ${path}`);
    return false;
  }

  // Trim whitespace from the path
  path = path.trim();

  // If the path is empty, return an error
  if (path.length === 0) {
    ferror("[ERROR] deleteObject() called with an empty path.");
    return false;
  }

  // Get the amount of objects already present at the path
  const parameter = declare(
    path,
    { path: SandboxDate.now(null, null) },
    null,
  ) as { size?: number };
  const currentSize = parameter?.size ?? 1;

  // If currentSize is undefined, return an error
  if (typeof currentSize !== 'number') {
    ferror(
      '[ERROR] Unable to determine the current size of objects at path:' +
       ` ${path}.`,
      {}
    );
    return false;
  }

  // The new size will be current size minus 1 that we are deleting
  const newSize = currentSize - 1;

  // Audit this deletion
  audit(ActionType.DELETE_OBJECT, path, newSize);

  // Delete the last object
  declare(
    path,
    { path: SandboxDate.now(null, null) },
    { path: newSize },
  ) as { path?: string };

  return true;
}

/**
 * Get which firmware to update from Flashman and update the device accordingly.
 *
 * @param {string} version - The version to update the firmware to.
 * @throws {Error} If the sandbox is not initialized.
 * @throws {Error} If there is an error fetching firmware information from
 * flashman.
 * @throws {Error} If the firmware version for the device is not found in
 * Flashman.
 * @throws {UPGRADE} To skip the provision and execute the firmware upgrade
 * command on the device. 
 */
export async function updateFirmware(version: string): Promise<void> {
  // If not initialized, throw an error
  if (!state.sessionContext.customScriptInfo?.initialized)
    throw new Error("updateFirmware: Sandbox not initialized");

  const acsId = state.sessionContext.deviceId;
  const productClass = declare('DeviceID.ProductClass', {value: 1}, null);

  // Get the firmware filename from Flashman. Cannot be async as we must execute
  // it in the same session
  let firmwareNameResponse;
  try {
    firmwareNameResponse = await fetch(
      `${FLASHMAN_URL}/acs/firmwares?version=${version}&model=${productClass}`,
      { method: 'GET' }
    );
  } catch (error) {
    ferror(
      `Error fetching firmware information from Flashman: ${error.message}`,
    );
    throw new Error(
      `Error fetching firmware information from Flashman: ${error.message}`,
    );
  }

  // If no firmware in Flashman throw the error and return
  if (
    firmwareNameResponse.status === 404 ||
    !firmwareNameResponse.body?.filename
  ) {
    ferror(
      `Firmware version ${version} for device ${acsId} not found in Flashman.`
    );
    throw new Error(
      `Firmware version ${version} for device ${acsId} not found in Flashman.`
    );
  }

  // If the request failed for any other reason, throw an error
  if (!firmwareNameResponse.ok) {
    ferror(
      'Failed to fetch firmware information from Flashman. ' +
      `Status: ${firmwareNameResponse.status}, ` +
      `Body: ${JSON.stringify(firmwareNameResponse.body)}`
    );
    throw new Error(
      'Failed to fetch firmware information from Flashman. ' +
      `Status: ${firmwareNameResponse.status}, ` +
      `Body: ${JSON.stringify(firmwareNameResponse.body)}`
    );
  }

  // Send the firmware update command to the device
  flog(
    'Initiating firmware update to version', version,
    'with firmware file', firmwareNameResponse.body.filename,
    'for device', acsId + '.',
    'Exiting script to execute firmware upgrade command on the device.'
  );
  declare(
    'Downloads.[FileType:1 Firmware Upgrade Image]',
    {path: 1},
    {path: 1},
  );
  declare(
    'Downloads.[FileType:1 Firmware Upgrade Image].FileName',
    {value: 1},
    {value: firmwareNameResponse.body.filename},
  );
  declare(
    'Downloads.[FileType:1 Firmware Upgrade Image].Download',
    {value: 1},
    {value: SandboxDate.now(null, null)},
  );

  throw UPGRADE;
}

/**
 * Sends a request to Flashman to inform that a script with the provided tag has
 * been run.
 *
 * @param {string} scriptTag - The tag of the script that has been run
 * (scriptId). 
 * @param {{fault?: Fault, started?: boolean}} runInfo - If any fault happened
 * and if the script just started running
 * @returns {Promise<void>} A promise that resolves when the request is
 * successful, or rejects with an error if the request fails.
 */
function sendScriptRunInfoToFlashman(
  scriptTag: string,
  runInfo: {fault?: Fault, started?: boolean} = {},
): void {
  request({
    url: `${FLASHMAN_URL}/api/v3/device/acs-id/` +
      `${state.sessionContext.deviceId}/script/${scriptTag}/run`,
    method: 'POST',
    json: {
      mac: state.sessionContext.customScriptInfo?.mac ?? '',
      success: !runInfo?.fault,
      started: runInfo?.started ?? false,
      timestamp: new Date().toISOString(),
      error: runInfo?.fault?.message ?? null,
    },
  }).on('response', (response) => {
    if (response.statusCode < 200 || response.statusCode >= 300) {
      log(
        'Failed to send script run info to Flashman. ' +
        `Status code: ${response.statusCode}`,
        {}
      );
    }
  }).on('error', (err) => {
    log(
      `Error sending script run info to Flashman: ${err.message}`,
      {}
    );
  });
}

/**
 * Gets the MAC address of the device. This function should call the EXT
 * function to retrieve the MAC address field from Flashman.
 */
function getMACAddress(): string | null {
  const genieIDDeclare = declare('DeviceID.ID', {value: 1}, null) as {
    value?: [boolean | number | string, string];
  };
  const ouiDeclare = declare('DeviceID.OUI', {value: 1}, null) as {
    value?: [boolean | number | string, string];
  };
  const modelClassDeclare = declare(
    'DeviceID.ProductClass',
    {value: 1},
    null,
  ) as {
    value?: [boolean | number | string, string];
  };

  // Detect TR-098 or TR-181 data model based on database value
  const isIGDModel = (declare(
    'InternetGatewayDevice.ManagementServer.URL',
    {value: 1},
    null,
  ) as {
    value?: [boolean | number | string, string];
  }).value;
  const prefix = (isIGDModel) ? 'InternetGatewayDevice' : 'Device';

  const modelNameDeclare = declare(
    prefix + '.DeviceInfo.ModelName',
    {value: 1},
    null,
  ) as {
    value?: [boolean | number | string, string];
  };
  const firmwareVersionDeclare = declare(
    prefix + '.DeviceInfo.SoftwareVersion',
    {value: 1},
    null,
  ) as {
    value?: [boolean | number | string, string];
  };
  const hardwareVersionDeclare = declare(
    prefix + '.DeviceInfo.HardwareVersion',
    {value: 1},
    null,
  ) as {
    value?: [boolean | number | string, string];
  };
  const trType = isIGDModel ? 'tr098' : 'tr181';

  const genieID = genieIDDeclare.value?.[0];
  const oui = ouiDeclare.value?.[0];
  const modelClass = modelClassDeclare.value?.[0];
  const modelName = modelNameDeclare.value?.[0];
  const firmwareVersion = firmwareVersionDeclare.value?.[0];
  const hardwareVersion = hardwareVersionDeclare.value?.[0];

  const hashIndex = SandboxDate.now(null, null).toString() + genieID;

  const flashmanArguments = {
    oui: oui,
    model: modelClass,
    modelName: modelName,
    firmwareVersion: firmwareVersion,
    hardwareVersion: hardwareVersion,
    trType: trType,
    acs_id: genieID,
  };

  // Call the EXT function to get the MAC address field from Flashman
  const macFieldResponse = ext(
    'flashman-api',
    'getMACField',
    JSON.stringify(flashmanArguments),
    hashIndex,
  );

  // Get the MAC address from the CPE
  let mac: string | null = null;
  if (macFieldResponse.success && macFieldResponse.macField) {
    // Query and add the MAC address in Fargs
    const macDeclare = declare(macFieldResponse.macField, {value: 1}, null) as {
      value?: [boolean | number | string, string];
    };

    if (
      macDeclare && macDeclare.value && macDeclare.value[0] &&
      typeof macDeclare.value[0] === 'string'
    ) mac = macDeclare.value[0].toUpperCase();
  }

  // Return the MAC address
  return mac;
}

/**
 * Initializes the sandbox environment. This function should be called before
 * running any custom scripts. It checks if the script configured to run 
 * matches the script tag provided in the arguments and sets up the context
 * accordingly.
 *
 * @throws {Error} If the sandbox is not initialized or if the script tag is not
 * set in the arguments.
 * @throws {SKIP} If it is debug and already ran once with the same script tag,
 * so it should not run again.
 */
function init(): void {
  let scriptInfo;
  try {
    scriptInfo = JSON.parse(context.args[1]);
  } catch (error) {
    log('Failed to parse script info from arguments, using default values. ' +
      `Error: ${error.message}, Arguments: ${context.args[1]}`, {});
    throw new Error(
      'Failed to parse script info from arguments: ' +
      error.message
    );
  }

  // If the script tag was not set, throw an error
  if (!scriptInfo?.scriptTag)
    throw new Error("Script tag not set");

  const scriptTag = scriptInfo?.scriptTag;

  // If we must run the script in debug mode, check if the script tag matches or
  // not, if so, throw SKIP to not run the script
  const tagValue = declare(
    'Tags.' + scriptTag,
    { value: SandboxDate.now(null, null) },
    null,
  ) as {
    value?: [boolean | number | string, string];
  };
  if (
    scriptInfo?.isDebug &&
    tagValue?.value?.[0] !== true
  ) throw SKIP;

  // Remove the script tag in Tags to avoid running again in debug mode
  declare('Tags.' + scriptInfo?.scriptTag, null, {value: false});

  // Get the MAC address of the device
  const mac = getMACAddress();

  // Set the debug mode, tag and initilization flag
  if (!state.sessionContext.customScriptInfo)
    state.sessionContext.customScriptInfo = {};
  state.sessionContext.customScriptInfo.isDebug = !!scriptInfo?.isDebug;
  state.sessionContext.customScriptInfo.scriptTag = scriptInfo?.scriptTag;
  state.sessionContext.customScriptInfo.mac = mac;

  // Send the script initialization info to Flashman for monitoring
  sendScriptRunInfoToFlashman(scriptInfo.scriptTag, {started: true});

  // Set the initialized flag
  state.sessionContext.customScriptInfo.initialized = true;

  // Log the script initialization
  flog(
    `Script ${scriptInfo?.scriptTag} ` +
    `initialized in ${
      state.sessionContext.customScriptInfo.isDebug ? 'debug' : 'normal'
    } mode.`,
  );

}

Object.defineProperty(context, "Date", { value: SandboxDate });
Object.defineProperty(context, "declare", { value: declare });
Object.defineProperty(context, "clear", { value: clear });
Object.defineProperty(context, "commit", { value: commit });
Object.defineProperty(context, "ext", { value: ext });
Object.defineProperty(context, "log", { value: log });
Object.defineProperty(context, "alert", { value: alert });
Object.defineProperty(context, "flog", { value: flog });
Object.defineProperty(context, "ferror", { value: ferror });
Object.defineProperty(context, "getValue", { value: getValue });
Object.defineProperty(context, "setValue", { value: setValue });
Object.defineProperty(context, "addObject", { value: addObject });
Object.defineProperty(context, "deleteObject", { value: deleteObject });
Object.defineProperty(context, "init", { value: init });

// Monkey-patch Math.random() to make it deterministic
context.random = random;
vm.runInContext("Math.random = random;", context);
delete context.random;

function errorToFault(err: Error): Fault {
  if (!err) return null;

  if (!err.name) return { code: "script", message: `${err}` };

  const fault: Fault = {
    code: `script.${err.name}`,
    message: err.message,
    detail: {
      name: err.name,
      message: err.message,
    },
  };

  if (err.stack) {
    fault.detail["stack"] = err.stack;
    // Trim the stack trace at the self-executing anonymous wrapper function
    const stackTrimIndex = fault.detail["stack"].match(
      /\s+at\s[^\s]+\s+at\s[^\s]+\s\(vm\.js.+\)/
    );
    if (stackTrimIndex) {
      fault.detail["stack"] = fault.detail["stack"].slice(
        0,
        stackTrimIndex.index
      );
    }
  }

  return fault;
}

export async function run(
  script: vm.Script,
  globals: Record<string, unknown>,
  sessionContext: SessionContext,
  startRevision: number,
  maxRevision: number,
  extCounter,
  name?:string,
): Promise<ScriptResult> {
  state = {
    sessionContext: sessionContext,
    revision: startRevision,
    maxRevision: maxRevision,
    uncommitted: false,
    declarations: [],
    extensions: {},
    clear: [],
    rng: null,
    extCounter: extCounter,
    globals: globals,
  };

  const endTimer = 
    metricsExporter.provisionDuration.
    labels({name:name??'unknown', ext_counter:extCounter})
    .startTimer()
  
  for (const n of Object.keys(context)) delete context[n];

  Object.assign(context, globals);

  let ret, status;

  // args: Array<string>
  // [0]: "PERIODIC"/"BOOTSTRAP"/"BOOT"
  // [1]: {
  //   isDebug: boolean,
  //   scriptTag: string,
  // }
  // Try parsing the second argument as JSON, if it fails, throw an error
  // But only for scripts that come with scriptInfo in arguments
  try {
    ret = script.runInContext(context, { displayErrors: false });
    status = 0;
    // Send a request to Flashman to inform that this script already finished
    // running
    if (state.sessionContext?.customScriptInfo?.scriptTag) {
      sendScriptRunInfoToFlashman(
        state.sessionContext.customScriptInfo.scriptTag,
      );
    }
  } catch (err) {
    if (err === COMMIT) {
      status = 1;
    } else if (err === EXT) {
      status = 2;
    } else if (err === SKIP) {
      // If we must skip this provision, just return
      endTimer();
      return {
        fault: null,
        clear: state.clear,
        declare: state.declarations,
        done: true,
        returnValue: ret,
      };
    } else if (err === UPGRADE) {
      // Send a request to Flashman to inform that this script run the firmware
      if (state.sessionContext?.customScriptInfo?.scriptTag) {
        sendScriptRunInfoToFlashman(
          state.sessionContext.customScriptInfo.scriptTag,
        );
      }
      endTimer();
      return {
        fault: null,
        clear: state.clear,
        declare: state.declarations,
        done: true,
        returnValue: ret,
      };
    } else {
      // For any other error, convert it to a fault and return it
      const fault = errorToFault(err);
      if (state.sessionContext?.customScriptInfo?.scriptTag) {
        sendScriptRunInfoToFlashman(
          state.sessionContext.customScriptInfo.scriptTag,
          {fault},
        );
      }
      return {
        fault: fault,
        clear: null,
        declare: null,
        done: false,
        returnValue: null,
      };
    }
  }

  const _state = state;
  let fault;

  await Promise.all(
    Object.entries(_state.extensions).map(async ([k, v]) => {
      fault = (await runExtension(_state.sessionContext, k, v)) || fault;
    })
  );

  if (fault) {
    return {
      fault: fault,
      clear: null,
      declare: null,
      done: false,
      returnValue: null,
    };
  }

  if (status === 2) {
    return run(
      script,
      globals,
      sessionContext,
      startRevision,
      maxRevision,
      extCounter - _state.extCounter,
      name
    );
  }

  endTimer();

  return {
    fault: null,
    clear: _state.clear,
    declare: _state.declarations,
    done: status === 0,
    returnValue: ret,
  };
}
