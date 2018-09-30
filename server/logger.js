"use strict";

const fs = require("fs");
const os = require("os");

const config = require("../config");

const REOPEN_EVERY = 60000;

const LOG_FORMAT = config.logger.logFormat;
const ACCESS_LOG_FORMAT = config.logger.accessLogFormat || LOG_FORMAT;

const defaultMeta = {};

let LOG_SYSTEMD = false;
let ACCESS_LOG_SYSTEMD = false;

let LOG_FILE, ACCESS_LOG_FILE;

let logStream = fs.createWriteStream(null, { fd: process.stderr.fd });
let logStat = fs.fstatSync(logStream.fd);
let accessLogStream = fs.createWriteStream(null, { fd: process.stdout.fd });
let accessLogStat = fs.fstatSync(accessLogStream.fd);

// Reopen if original files have been moved (e.g. logrotate)
function reopen() {
  let counter = 1;

  if (LOG_FILE) {
    ++counter;
    fs.stat(LOG_FILE, (err, stat) => {
      if (err && !err.message.startsWith("ENOENT:")) throw err;

      if (!(stat && stat.dev === logStat.dev && stat.ino === logStat.ino)) {
        logStream.end();
        logStream = fs.createWriteStream(null, {
          fd: fs.openSync(LOG_FILE, "a")
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
          fd: fs.openSync(ACCESS_LOG_FILE, "a")
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

function init(version) {
  defaultMeta.hostname = os.hostname();
  defaultMeta.pid = process.pid;
  defaultMeta.name = "genieacs-ui";
  defaultMeta.version = version;

  LOG_FILE = config.logger.logFile;
  ACCESS_LOG_FILE = config.logger.accessLogFile;

  if (LOG_FILE) {
    logStream = fs.createWriteStream(null, { fd: fs.openSync(LOG_FILE, "a") });
    logStat = fs.fstatSync(logStream.fd);
  }

  if (ACCESS_LOG_FILE) {
    accessLogStream = fs.createWriteStream(null, {
      fd: fs.openSync(ACCESS_LOG_FILE, "a")
    });
    accessLogStat = fs.fstatSync(accessLogStream.fd);
  }

  // Determine if logs are going to journald
  const JOURNAL_STREAM = process.env["JOURNAL_STREAM"];

  if (JOURNAL_STREAM) {
    let [dev, inode] = JOURNAL_STREAM.split(":");
    dev = parseInt(dev);
    inode = parseInt(inode);

    LOG_SYSTEMD = logStat.dev === dev && logStat.ino === inode;
    ACCESS_LOG_SYSTEMD =
      accessLogStat.dev === dev && accessLogStat.ino === inode;
  }

  if (LOG_FILE || ACCESS_LOG_FILE)
    setTimeout(reopen, REOPEN_EVERY - (Date.now() % REOPEN_EVERY)).unref();
}

function close() {
  accessLogStream.end();
  logStream.end();
}

function flatten(details) {
  if (details.exception) {
    details.exceptionName = details.exception.name;
    details.exceptionMessage = details.exception.message;
    details.exceptionStack = details.exception.stack;
    delete details.exception;
  }

  if (details.context) {
    details.remoteAddress = details.context.request.ip;
    if (details.context.state.user)
      details.user = details.context.state.user.username;
    delete details.context;
  }

  for (const [k, v] of Object.entries(details))
    if (v == null) delete details[k];

  return details;
}

function formatJson(details, systemd) {
  if (systemd) {
    let severity = "";
    if (details.severity === "info") severity = "<6>";
    else if (details.severity === "warn") severity = "<4>";
    else if (details.severity === "error") severity = "<3>";

    return `${severity}${JSON.stringify(flatten(details))}${os.EOL}`;
  }

  return `${JSON.stringify(flatten(details))}${os.EOL}`;
}

function formatSimple(details, systemd) {
  flatten(details);

  let remote = "";
  if (details.remoteAddress) {
    if (details.user) remote = `${details.user}@${details.remoteAddress}: `;
    else remote = `${details.remoteAddress}: `;
  }

  const keys = Object.keys(details);
  const skip = {
    user: 1,
    remoteAddress: 1,
    severity: 1,
    timestamp: 1,
    message: 1
  };

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

  return `${details.timestamp} [${details.severity.toUpperCase()}] ${remote}${
    details.message
  }${meta}${os.EOL}`;
}

function log(details) {
  details.timestamp = new Date().toISOString();
  if (LOG_FORMAT === "json") {
    details = Object.assign({}, defaultMeta, details);
    logStream.write(formatJson(details, LOG_SYSTEMD));
  } else {
    logStream.write(formatSimple(details, LOG_SYSTEMD));
  }
}

function info(details) {
  details.severity = "info";
  log(details);
}

function warn(details) {
  details.severity = "warn";
  log(details);
}

function error(details) {
  details.severity = "error";
  log(details);
}

function accessLog(details) {
  details.timestamp = new Date().toISOString();
  if (ACCESS_LOG_FORMAT === "json") {
    Object.assign(details, defaultMeta);
    accessLogStream.write(formatJson(details, ACCESS_LOG_SYSTEMD));
  } else {
    accessLogStream.write(formatSimple(details, ACCESS_LOG_SYSTEMD));
  }
}

function accessInfo(details) {
  details.severity = "info";
  accessLog(details);
}

function accessWarn(details) {
  details.severity = "warn";
  accessLog(details);
}

function accessError(details) {
  details.severity = "error";
  accessLog(details);
}

exports.init = init;
exports.close = close;
exports.info = info;
exports.warn = warn;
exports.error = error;
exports.accessInfo = accessInfo;
exports.accessWarn = accessWarn;
exports.accessError = accessError;
