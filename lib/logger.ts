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

import * as fs from "fs";
import * as os from "os";

import * as config from "./config";
import { getRequestOrigin } from "./forwarded";
import {
  SessionContext,
  AcsRequest,
  CpeRequest,
  CpeFault,
  InformRequest,
  Fault,
} from "./types";

const REOPEN_EVERY = 60000;

const LOG_FORMAT = config.get("LOG_FORMAT");
const ACCESS_LOG_FORMAT = config.get("ACCESS_LOG_FORMAT") || LOG_FORMAT;

const defaultMeta: { [name: string]: any } = {};

let LOG_SYSTEMD = false;
let ACCESS_LOG_SYSTEMD = false;

let LOG_FILE, ACCESS_LOG_FILE;

declare global {
  /* eslint-disable-next-line @typescript-eslint/no-namespace */
  namespace NodeJS {
    export interface WritableStream {
      fd?: number;
    }
  }
}

declare module "fs" {
  interface WriteStream {
    fd?: number;
  }
}

let logStream = fs.createWriteStream(null, { fd: process.stderr.fd });
let logStat = fs.fstatSync(logStream.fd);
let accessLogStream = fs.createWriteStream(null, { fd: process.stdout.fd });
let accessLogStat = fs.fstatSync(accessLogStream.fd);

// Reopen if original files have been moved (e.g. logrotate)
function reopen(): void {
  let counter = 1;

  if (LOG_FILE) {
    ++counter;
    fs.stat(LOG_FILE, (err, stat) => {
      if (err && !err.message.startsWith("ENOENT:")) throw err;

      if (!(stat && stat.dev === logStat.dev && stat.ino === logStat.ino)) {
        logStream.end();
        logStream = fs.createWriteStream(null, {
          fd: fs.openSync(LOG_FILE, "a"),
        });
        logStat = fs.fstatSync(logStream.fd);
      }

      if (--counter === 0)
        setTimeout(reopen, REOPEN_EVERY - (Date.now() % REOPEN_EVERY)).unref();
    });
  }

  if (ACCESS_LOG_FILE) {
    ++counter;
    fs.stat(ACCESS_LOG_FILE, (err, stat) => {
      if (err && !err.message.startsWith("ENOENT:")) throw err;

      if (
        !(
          stat &&
          stat.dev === accessLogStat.dev &&
          stat.ino === accessLogStat.ino
        )
      ) {
        accessLogStream.end();
        accessLogStream = fs.createWriteStream(null, {
          fd: fs.openSync(ACCESS_LOG_FILE, "a"),
        });
        accessLogStat = fs.fstatSync(accessLogStream.fd);
      }

      if (--counter === 0)
        setTimeout(reopen, REOPEN_EVERY - (Date.now() % REOPEN_EVERY)).unref();
    });
  }

  if (--counter === 0)
    setTimeout(reopen, REOPEN_EVERY - (Date.now() % REOPEN_EVERY)).unref();
}

export function init(service: string, version: string): void {
  defaultMeta.hostname = os.hostname();
  defaultMeta.pid = process.pid;
  defaultMeta.name = `genieacs-${service}`;
  defaultMeta.version = version;

  LOG_FILE = config.get(`${service.toUpperCase()}_LOG_FILE`);
  ACCESS_LOG_FILE = config.get(`${service.toUpperCase()}_ACCESS_LOG_FILE`);

  if (LOG_FILE) {
    logStream = fs.createWriteStream(null, { fd: fs.openSync(LOG_FILE, "a") });
    logStat = fs.fstatSync(logStream.fd);
  }

  if (ACCESS_LOG_FILE) {
    accessLogStream = fs.createWriteStream(null, {
      fd: fs.openSync(ACCESS_LOG_FILE, "a"),
    });
    accessLogStat = fs.fstatSync(accessLogStream.fd);
  }

  // Determine if logs are going to journald
  const JOURNAL_STREAM = process.env["JOURNAL_STREAM"];

  if (JOURNAL_STREAM) {
    const [dev, inode] = JOURNAL_STREAM.split(":").map(parseInt);

    LOG_SYSTEMD = logStat.dev === dev && logStat.ino === inode;
    ACCESS_LOG_SYSTEMD =
      accessLogStat.dev === dev && accessLogStat.ino === inode;
  }

  if (LOG_FILE || ACCESS_LOG_FILE)
    // Can't use setInterval as we need all workers to cehck at the same time
    setTimeout(reopen, REOPEN_EVERY - (Date.now() % REOPEN_EVERY)).unref();
}

export function close(): void {
  accessLogStream.end();
  logStream.end();
}

export function flatten(
  details: Record<string, unknown>
): Record<string, unknown> {
  if (details.sessionContext) {
    const sessionContext = details.sessionContext as SessionContext;
    details.deviceId = sessionContext.deviceId;
    details.remoteAddress = getRequestOrigin(
      sessionContext.httpRequest
    ).remoteAddress;
    delete details.sessionContext;
  }

  if (details.exception) {
    const err = details.exception as Error;
    details.exceptionName = err.name;
    details.exceptionMessage = err.message;
    details.exceptionStack = err.stack;
    delete details.exception;
  }

  if (details.task) {
    details.taskId = details.task["_id"];
    delete details.task;
  }

  if (details.rpc) {
    const rpc = details.rpc as {
      id: string;
      acsRequest?: AcsRequest;
      cpeRequest?: CpeRequest;
      cpeFault?: CpeFault;
    };
    if (rpc.acsRequest) {
      details.acsRequestId = rpc.id;
      details.acsRequestName = rpc.acsRequest.name;
      if (rpc.acsRequest["commandKey"])
        details.acsRequestCommandKey = rpc.acsRequest["commandKey"];
    } else if (rpc.cpeRequest) {
      details.cpeRequestId = rpc.id;
      if (rpc.cpeRequest.name === "Inform") {
        details.informEvent = (rpc.cpeRequest as InformRequest).event.join(",");
        details.informRetryCount = (rpc.cpeRequest as InformRequest).retryCount;
      } else {
        details.cpeRequestName = rpc.cpeRequest.name;
        if (rpc.cpeRequest["commandKey"])
          details.cpeRequestCommandKey = rpc.cpeRequest["commandKey"];
      }
    } else if (rpc.cpeFault) {
      details.acsRequestId = rpc.id;
      details.cpeFaultCode = rpc.cpeFault.detail.faultCode;
      details.cpeFaultString = rpc.cpeFault.detail.faultString;
    }
    delete details.rpc;
  }

  if (details.fault) {
    const fault = details.fault as Fault;
    details.faultCode = fault.code;
    details.faultMessage = fault.message;
    delete details.fault;
  }

  // For genieacs-ui
  if (details.context) {
    details.remoteAddress = getRequestOrigin(
      details.context["req"]
    ).remoteAddress;
    if (details.context["state"].user)
      details.user = details.context["state"].user.username;
    delete details.context;
  }

  for (const [k, v] of Object.entries(details))
    if (v == null) delete details[k];

  return details;
}

function formatJson(
  details: Record<string, unknown>,
  systemd: boolean
): string {
  if (systemd) {
    let severity = "";
    if (details.severity === "info") severity = "<6>";
    else if (details.severity === "warn") severity = "<4>";
    else if (details.severity === "error") severity = "<3>";

    return `${severity}${JSON.stringify(flatten(details))}${os.EOL}`;
  }

  return `${JSON.stringify(flatten(details))}${os.EOL}`;
}

function formatSimple(
  details: Record<string, unknown>,
  systemd: boolean
): string {
  const skip = {
    user: true,
    remoteAddress: true,
    severity: true,
    timestamp: true,
    message: true,
    deviceId: !!details.sessionContext,
  };

  flatten(details);

  let remote = "";
  if (details.remoteAddress) {
    if (details.deviceId && skip["deviceId"])
      remote = `${details.remoteAddress} ${details.deviceId}: `;
    else if (details.user)
      remote = `${details.user}@${details.remoteAddress}: `;
    else remote = `${details.remoteAddress}: `;
  }

  const keys = Object.keys(details);

  let meta = "";

  const kv = [];
  for (const k of keys)
    if (!skip[k]) kv.push(`${k}=${JSON.stringify(details[k])}`);

  if (kv.length) meta = `; ${kv.join(" ")}`;

  if (systemd) {
    let severity = "";
    if (details.severity === "info") severity = "<6>";
    else if (details.severity === "warn") severity = "<4>";
    else if (details.severity === "error") severity = "<3>";

    return `${severity}${remote}${details.message}${meta}${os.EOL}`;
  }

  return `${
    details.timestamp
  } [${(details.severity as string).toUpperCase()}] ${remote}${
    details.message
  }${meta}${os.EOL}`;
}

function log(details: Record<string, unknown>): void {
  details.timestamp = new Date().toISOString();
  if (LOG_FORMAT === "json") {
    details = Object.assign({}, defaultMeta, details);
    logStream.write(formatJson(details, LOG_SYSTEMD));
  } else {
    logStream.write(formatSimple(details, LOG_SYSTEMD));
  }
}

export function info(details: Record<string, unknown>): void {
  details.severity = "info";
  log(details);
}

export function warn(details: Record<string, unknown>): void {
  details.severity = "warn";
  log(details);
}

export function error(details: Record<string, unknown>): void {
  details.severity = "error";
  log(details);
}

export function accessLog(details: Record<string, unknown>): void {
  details.timestamp = new Date().toISOString();
  if (ACCESS_LOG_FORMAT === "json") {
    Object.assign(details, defaultMeta);
    accessLogStream.write(formatJson(details, ACCESS_LOG_SYSTEMD));
  } else {
    accessLogStream.write(formatSimple(details, ACCESS_LOG_SYSTEMD));
  }
}

export function accessInfo(details: Record<string, unknown>): void {
  details.severity = "info";
  accessLog(details);
}

export function accessWarn(details: Record<string, unknown>): void {
  details.severity = "warn";
  accessLog(details);
}

export function accessError(details: Record<string, unknown>): void {
  details.severity = "error";
  accessLog(details);
}
