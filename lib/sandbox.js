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

const vm = require("vm");

const seedrandom = require("seedrandom");

const common = require("./common");
const device = require("./device");
const extensions = require("./extensions");
const logger = require("./logger");
const scheduling = require("./scheduling");

// Used for throwing to exit user script and commit
const COMMIT = Symbol();

// Used to execute extensions and restart
const EXT = Symbol();

const UNDEFINED = undefined;

const context = vm.createContext();

let state;

const runningExtensions = new WeakMap();
function runExtension(sessionContext, key, extCall, callback) {
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
  constructor() {
    if (arguments.length) return new Date(...arguments);

    return new Date(state.sessionContext.timestamp);
  }

  static now(intervalOrCron, variance) {
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

function random() {
  if (!state.rng) state.rng = seedrandom(state.sessionContext.deviceId);

  return state.rng();
}

random.seed = function(s) {
  state.rng = seedrandom(s);
};

class ParameterWrapper {
  constructor(path, attributes, unpacked, unpackedRevision) {
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

        return unpacked[0].join(".");
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

function declare(path, timestamps, values) {
  state.uncommitted = true;
  if (!timestamps) timestamps = {};

  if (!values) values = {};

  const parsedPath = common.parsePath(path);

  const declaration = [parsedPath, 1];
  const attrs = {};

  for (const attrName in values) {
    if (!timestamps[attrName]) timestamps[attrName] = 1;

    if (attrName === "path") {
      declaration[3] = values.path;
    } else {
      attrs[attrName] = 1;
      declaration[4] = declaration[4] || {};
      if (attrName === "value" && !Array.isArray(values.value))
        declaration[4].value = [values.value];
      else declaration[4][attrName] = values[attrName];
    }
  }

  for (const attrName in timestamps) {
    if (attrName === "path") {
      declaration[1] = timestamps.path;
    } else {
      attrs[attrName] = 1;
      declaration[2] = declaration[2] || {};
      declaration[2][attrName] = timestamps[attrName];
    }
  }

  state.declarations.push(declaration);

  return new ParameterWrapper(parsedPath, Object.keys(attrs));
}

function clear(path, timestamp, attributes) {
  state.uncommitted = true;

  if (state.revision === state.maxRevision)
    state.clear.push([common.parsePath(path), timestamp, attributes]);
}

function commit() {
  ++state.revision;
  state.uncommitted = false;

  if (state.revision === state.maxRevision + 1) {
    throw COMMIT;
  } else if (state.revision > state.maxRevision + 1) {
    throw new Error(
      "Declare function should not be called from within a try/catch block"
    );
  }
}

function ext() {
  ++state.extCounter;
  const extCall = Array.from(arguments).map(String);
  const key = `${state.revision}: ${JSON.stringify(extCall)}`;

  if (key in state.sessionContext.extensionsCache)
    return state.sessionContext.extensionsCache[key];

  state.extensions[key] = extCall;
  throw EXT;
}

function log(msg, meta) {
  if (state.revision === state.maxRevision && state.extCounter >= 0) {
    const details = Object.assign({}, meta, {
      sessionContext: state.sessionContext,
      message: `Script: ${msg}`
    });

    delete details.hostname;
    delete details.pid;
    delete details.name;
    delete details.version;
    delete details.deviceId;
    delete details.remoteAddress;

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

function errorToFault(err) {
  if (!err) return null;

  if (!err.name) return { code: "script", message: `${err}` };

  const fault = {
    code: `script.${err.name}`,
    message: err.message,
    detail: {
      name: err.name,
      message: err.message
    }
  };

  if (err.stack) {
    fault.detail.stack = err.stack;
    // Trim the stack trace at the self-executing anonymous wrapper function
    const stackTrimIndex = fault.detail.stack.match(
      /\s+at\s[^\s]+\s+at\s[^\s]+\s\(vm\.js.+\)/
    );
    if (stackTrimIndex)
      fault.detail.stack = fault.detail.stack.slice(0, stackTrimIndex.index);
  }

  return fault;
}

function run(
  script,
  globals,
  sessionContext,
  startRevision,
  maxRevision,
  callback,
  extCounter = 0
) {
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

exports.run = run;
