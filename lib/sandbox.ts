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

import * as vm from "vm";
import seedrandom from "seedrandom";
import * as device from "./device";
import * as extensions from "./extensions";
import * as logger from "./logger";
import * as scheduling from "./scheduling";
import Path from "./common/path";
import { Fault, SessionContext } from "./types";

// Used for throwing to exit user script and commit
const COMMIT = Symbol();

// Used to execute extensions and restart
const EXT = Symbol();

const UNDEFINED = undefined;

const context = vm.createContext();

let state;

const runningExtensions = new WeakMap();
function runExtension(sessionContext, key, extCall, callback): void {
  let re = runningExtensions.get(sessionContext);
  if (!re) {
    re = {};
    runningExtensions.set(sessionContext, re);
  }

  if (re[key]) {
    re[key].push(callback);
  } else {
    re[key] = [callback];
    extensions.run(extCall, (err, fault, res) => {
      const callbacks = re[key];
      delete re[key];
      if (!err && !fault) sessionContext.extensionsCache[key] = res;
      for (const c of callbacks) c(err, fault);
    });
  }
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
}

function random(): number {
  if (!state.rng) state.rng = seedrandom(state.sessionContext.deviceId);

  return state.rng();
}

random.seed = function(s) {
  state.rng = seedrandom(s);
};

class ParameterWrapper {
  public constructor(path: Path, attributes, unpacked?, unpackedRevision?) {
    for (const attrName of attributes) {
      Object.defineProperty(this, attrName, {
        get: function() {
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
        }
      });
    }

    Object.defineProperty(this, "path", {
      get: function() {
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
      }
    });

    Object.defineProperty(this, "size", {
      get: function() {
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
      }
    });

    this[Symbol.iterator] = function*() {
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
    defer: true
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

function ext(): any {
  ++state.extCounter;
  const extCall = Array.from(arguments).map(String);
  const key = `${state.revision}: ${JSON.stringify(extCall)}`;

  if (key in state.sessionContext.extensionsCache)
    return state.sessionContext.extensionsCache[key];

  state.extensions[key] = extCall;
  throw EXT;
}

function log(msg: string, meta: {}): void {
  if (state.revision === state.maxRevision && state.extCounter >= 0) {
    const details = Object.assign({}, meta, {
      sessionContext: state.sessionContext,
      message: `Script: ${msg}`
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

Object.defineProperty(context, "Date", { value: SandboxDate });
Object.defineProperty(context, "declare", { value: declare });
Object.defineProperty(context, "clear", { value: clear });
Object.defineProperty(context, "commit", { value: commit });
Object.defineProperty(context, "ext", { value: ext });
Object.defineProperty(context, "log", { value: log });

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
      message: err.message
    }
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

export function run(
  script: vm.Script,
  globals,
  sessionContext: SessionContext,
  startRevision: number,
  maxRevision: number,
  callback,
  extCounter = 0
): void {
  state = {
    sessionContext: sessionContext,
    revision: startRevision,
    maxRevision: maxRevision,
    uncommitted: false,
    declarations: [],
    extensions: {},
    clear: [],
    rng: null,
    extCounter: extCounter
  };

  for (const n of Object.keys(context)) delete context[n];

  Object.assign(context, globals);

  let ret, status;

  try {
    ret = script.runInContext(context, { displayErrors: false });
    status = 0;
  } catch (err) {
    if (err === COMMIT) status = 1;
    else if (err === EXT) status = 2;
    else return void callback(null, errorToFault(err));
  }

  const _state = state;
  const args = Array.from(arguments);

  // Need to maintain a counter of ext() calls to avoid calling certain
  // functions (e.g. log()) multiple times as calling ext() results in
  // re-execution of script without revision being incremented.
  args[6] = 0 - (state.extCounter - extCounter);

  let counter = 3;
  for (const key of Object.keys(_state.extensions)) {
    counter += 2;
    runExtension(
      _state.sessionContext,
      key,
      _state.extensions[key],
      (err, fault) => {
        if (err || fault) {
          if (counter & 1) callback(err, fault);
          return void (counter = 0);
        }
        if ((counter -= 2) === 1) {
          if (status === 2) {
            return void run.apply(null, args);
          } else {
            return void callback(
              null,
              null,
              _state.clear,
              _state.declarations,
              status === 0,
              ret
            );
          }
        }
      }
    );
  }

  if ((counter -= 2) === 1) {
    if (status === 2) {
      run.apply(null, args);
    } else {
      callback(
        null,
        null,
        _state.clear,
        _state.declarations,
        status === 0,
        ret
      );
    }
  }
}
