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

import { resolve } from "path";
import { readFileSync, existsSync } from "fs";

// Find project root directory
export let ROOT_DIR = resolve(__dirname, "..");
while (!existsSync(`${ROOT_DIR}/package.json`)) {
  const d = resolve(ROOT_DIR, "..");
  if (d === ROOT_DIR) {
    ROOT_DIR = process.cwd();
    break;
  }
  ROOT_DIR = d;
}

// For compatibility with v1.1
let configDir, cwmpSsl, nbiSsl, fsSsl, uiSsl, fsHostname;

const options = {
  EXT_DIR: { type: "path", default: resolve(ROOT_DIR, "config/ext") },
  MONGODB_CONNECTION_URL: {
    type: "string",
    default: "mongodb://127.0.0.1/genieacs"
  },

  CWMP_WORKER_PROCESSES: { type: "int", default: 0 },
  CWMP_PORT: { type: "int", default: 7547 },
  CWMP_INTERFACE: { type: "string", default: "0.0.0.0" },
  CWMP_SSL_CERT: { type: "string", default: "" },
  CWMP_SSL_KEY: { type: "string", default: "" },
  CWMP_LOG_FILE: { type: "path", default: "" },
  CWMP_ACCESS_LOG_FILE: { type: "path", default: "" },

  NBI_WORKER_PROCESSES: { type: "int", default: 0 },
  NBI_PORT: { type: "int", default: 7557 },
  NBI_INTERFACE: { type: "string", default: "0.0.0.0" },
  NBI_SSL_CERT: { type: "string", default: "" },
  NBI_SSL_KEY: { type: "string", default: "" },
  NBI_LOG_FILE: { type: "path", default: "" },
  NBI_ACCESS_LOG_FILE: { type: "path", default: "" },

  FS_WORKER_PROCESSES: { type: "int", default: 0 },
  FS_PORT: { type: "int", default: 7567 },
  FS_INTERFACE: { type: "string", default: "0.0.0.0" },
  FS_SSL_CERT: { type: "string", default: "" },
  FS_SSL_KEY: { type: "string", default: "" },
  FS_URL_PREFIX: { type: "string", default: "" },
  FS_LOG_FILE: { type: "path", default: "" },
  FS_ACCESS_LOG_FILE: { type: "path", default: "" },

  UI_WORKER_PROCESSES: { type: "int", default: 0 },
  UI_PORT: { type: "int", default: 3000 },
  UI_INTERFACE: { type: "string", default: "0.0.0.0" },
  UI_SSL_CERT: { type: "string", default: "" },
  UI_SSL_KEY: { type: "string", default: "" },
  UI_LOG_FILE: { type: "path", default: "" },
  UI_ACCESS_LOG_FILE: { type: "path", default: "" },
  UI_JWT_SECRET: { type: "string", default: "" },

  UDP_CONNECTION_REQUEST_PORT: { type: "int", default: 0 },
  FORWARDED_HEADER: { type: "string", default: "" },

  DOWNLOAD_TIMEOUT: { type: "int", default: 3600 },
  EXT_TIMEOUT: { type: "int", default: 3000 },
  MAX_CACHE_TTL: { type: "int", default: 86400 },
  DEBUG_FILE: { type: "path", default: "" },
  DEBUG_FORMAT: { type: "string", default: "yaml" },
  DEBUG: { type: "bool", default: false },
  RETRY_DELAY: { type: "int", default: 300 },
  SESSION_TIMEOUT: { type: "int", default: 30 },
  CONNECTION_REQUEST_TIMEOUT: { type: "int", default: 2000 },
  GPN_NEXT_LEVEL: { type: "int", default: 0 },
  GPV_BATCH_SIZE: { type: "int", default: 32 },
  MAX_DEPTH: { type: "int", default: 16 },
  COOKIES_PATH: { type: "string" },
  LOG_FORMAT: { type: "string", default: "simple" },
  ACCESS_LOG_FORMAT: { type: "string", default: "" },
  MAX_CONCURRENT_REQUESTS: { type: "int", default: 20 },
  DATETIME_MILLISECONDS: { type: "bool", default: true },
  BOOLEAN_LITERAL: { type: "bool", default: true },
  CONNECTION_REQUEST_ALLOW_BASIC_AUTH: { type: "bool", default: false },
  MAX_COMMIT_ITERATIONS: { type: "int", default: 32 },

  // Should probably never be changed
  DEVICE_ONLINE_THRESHOLD: { type: "int", default: 4000 }
};

const allConfig: { [name: string]: string | number } = {};

function setConfig(name, value, commandLineArgument = false): boolean {
  if (allConfig[name] != null) return true;

  // For compatibility with v1.1
  if (name === "CONFIG_DIR" || name === "config-dir")
    configDir = configDir || resolve(ROOT_DIR, value);

  if (name === "CWMP_SSL" || name === "cwmp-ssl") {
    cwmpSsl =
      cwmpSsl ||
      String(value)
        .toLowerCase()
        .trim();
  }

  if (name === "NBI_SSL" || name === "nbi-ssl") {
    nbiSsl =
      nbiSsl ||
      String(value)
        .toLowerCase()
        .trim();
  }

  if (name === "FS_SSL" || name === "fs-ssl") {
    fsSsl =
      fsSsl ||
      String(value)
        .toLowerCase()
        .trim();
  }

  if (name === "UI_SSL" || name === "ui-ssl") {
    uiSsl =
      uiSsl ||
      String(value)
        .toLowerCase()
        .trim();
  }

  if (name === "FS_HOSTNAME" || name === "fs-hostname")
    fsHostname = fsHostname || String(value).trim();

  // For compatibility with v1.0
  if (name === "PRESETS_CACHE_DURATION" || name === "presets-cache-duration")
    setConfig("MAX_CACHE_TTL", value);

  if (
    name === "GET_PARAMETER_NAMES_DEPTH_THRESHOLD" ||
    name === "get-parameter-names-depth-threshold"
  )
    setConfig("GPN_NEXT_LEVEL", value);

  if (
    name === "TASK_PARAMETERS_BATCH_SIZE" ||
    name === "task-parameters-batch-size"
  )
    setConfig("GPV_BATCH_SIZE", value);

  if (name === "FS_IP" || name === "fs-ip") setConfig("FS_HOSTNAME", value);

  function cast(val, type): string | number | boolean {
    switch (type) {
      case "int":
        return Number(val);
      case "bool":
        return ["true", "1"].includes(
          String(val)
            .trim()
            .toLowerCase()
        );
      case "string":
        return String(val);
      case "path":
        if (!val) return "";
        return resolve(val);
      default:
        return null;
    }
  }

  let _value = null;
  for (const [optionName, optionDetails] of Object.entries(options)) {
    let n = optionName;
    if (commandLineArgument) n = n.toLowerCase().replace(/_/g, "-");

    if (name === n) {
      _value = cast(value, optionDetails.type);
      n = optionName;
    } else if (name.startsWith(`${n}-`)) {
      _value = cast(value, optionDetails.type);
      n = `${optionName}-${name.slice(optionName.length + 1)}`;
    }

    if (_value != null) {
      allConfig[n] = _value;
      // Save as environmnet variable to pass on to any child process
      process.env[`GENIEACS_${n}`] = _value;
      return true;
    }
  }

  return false;
}

// Command line arguments
const argv = process.argv.slice(2);
while (argv.length) {
  const arg = argv.shift();
  if (arg[0] === "-") {
    const v = argv.shift();
    setConfig(arg.slice(2), v, true);
  }
}

// Environment variable
for (const [k, v] of Object.entries(process.env))
  if (k.startsWith("GENIEACS_")) setConfig(k.slice(9), v);

// Configuration file
const configFilename = configDir
  ? `${configDir}/config.json`
  : `${ROOT_DIR}/config/config.json`;

if (existsSync(configFilename)) {
  const configFile = JSON.parse(readFileSync(configFilename).toString());

  for (const [k, v] of Object.entries(configFile)) {
    if (!setConfig(k, v))
      // Pass as environment variable to be accessable by extensions
      process.env[`GENIEACS_${k}`] = `${v}`;
  }
}

if (configDir) setConfig("EXT_DIR", `${configDir}/ext`);

if (["true", "1"].includes(cwmpSsl)) {
  const d = configDir || `${ROOT_DIR}/config`;
  setConfig("CWMP_SSL_CERT", `${d}/cwmp.crt`);
  setConfig("CWMP_SSL_KEY", `${d}/cwmp.key`);
}

if (["true", "1"].includes(nbiSsl)) {
  const d = configDir || `${ROOT_DIR}/config`;
  setConfig("NBI_SSL_CERT", `${d}/cwmp.crt`);
  setConfig("NBI_SSL_KEY", `${d}/cwmp.key`);
}

if (["true", "1"].includes(fsSsl)) {
  const d = configDir || `${ROOT_DIR}/config`;
  setConfig("FS_SSL_CERT", `${d}/cwmp.crt`);
  setConfig("FS_SSL_KEY", `${d}/cwmp.key`);
}

if (["true", "1"].includes(uiSsl)) {
  const d = configDir || `${ROOT_DIR}/config`;
  setConfig("UI_SSL_CERT", `${d}/cwmp.crt`);
  setConfig("UI_SSL_KEY", `${d}/cwmp.key`);
}

if (fsHostname) {
  const FS_PORT = allConfig["FS_PORT"] || 7567;
  const FS_SSL = !!allConfig["FS_SSL_CERT"];
  setConfig(
    "FS_URL_PREFIX",
    (FS_SSL ? "https" : "http") + `://${fsHostname}:${FS_PORT}/`
  );
}

// Defaults
for (const [k, v] of Object.entries(options))
  if (v["default"] != null) setConfig(k, v["default"]);

export function get(
  optionName: string,
  deviceId?: string
): string | number | boolean {
  if (!deviceId) return allConfig[optionName];

  optionName = `${optionName}-${deviceId}`;
  let v = allConfig[optionName];
  if (v != null) return v;

  let i = optionName.lastIndexOf("-");
  v = allConfig[optionName.slice(0, i)];
  if (v != null) return v;

  i = optionName.lastIndexOf("-", i - 1);
  v = allConfig[optionName.slice(0, i)];
  if (v != null) return v;

  i = optionName.lastIndexOf("-", i - 1);
  v = allConfig[optionName.slice(0, i)];
  if (v != null) return v;

  i = optionName.lastIndexOf("-", i - 1);
  if (i > 0) {
    v = allConfig[optionName.slice(0, i)];
    if (v != null) return v;
  }

  return null;
}

export function getDefault(optionName): string | number | boolean {
  const option = options[optionName];
  if (!option) return null;

  let val = option["default"];
  if (val && option.type === "path") val = resolve(val);

  return val;
}
