import * as crypto from "node:crypto";
import * as config from "../config.ts";
import { collections } from "../db/db.ts";
import * as expression from "../common/expression/util.ts";
import { parse } from "../common/expression/parser.ts";
import { Expression, Users, Permissions, Config, UiConfig } from "../types.ts";
import { LocalCache } from "../local-cache.ts";

interface Snapshot {
  permissions: Permissions;
  users: Users;
  config: Config;
  ui: UiConfig;
}

async function fetchPermissions(): Promise<[string, Permissions]> {
  const perms = await collections.permissions.find().toArray();
  perms.sort((a, b) => (a._id > b._id ? 1 : -1));
  const h = crypto
    .createHash("md5")
    .update(JSON.stringify(perms))
    .digest("hex");
  const permissions: Permissions = {};

  for (const p of perms) {
    if (!permissions[p.role]) permissions[p.role] = {};
    if (!permissions[p.role][p.access]) permissions[p.role][p.access] = {};

    permissions[p.role][p.access][p.resource] = {
      access: p.access,
      filter: parse(p.filter || "true"),
    };
    if (p.validate)
      permissions[p.role][p.access][p.resource].validate = parse(p.validate);
  }

  return [h, permissions];
}

async function fetchUsers(): Promise<[string, Users]> {
  const _users = await collections.users.find().toArray();
  _users.sort((a, b) => (a._id > b._id ? 1 : -1));
  const h = crypto
    .createHash("md5")
    .update(JSON.stringify(_users))
    .digest("hex");
  const users = {};

  for (const user of _users) {
    users[user._id] = {
      password: user.password,
      salt: user.salt,
      roles: user.roles.split(",").map((s) => s.trim()),
    };
  }

  return [h, users];
}

async function fetchConfig(): Promise<[string, Config, UiConfig]> {
  const conf = await collections.config.find().toArray();
  conf.sort((a, b) => (a._id > b._id ? 1 : -1));
  const h = crypto.createHash("md5").update(JSON.stringify(conf)).digest("hex");

  const ui = {
    filters: {},
    device: {},
    deviceTabs: {},
    index: {},
    overview: {},
    pageSize: null,
  };

  const _config = {};

  for (const c of conf) {
    // Evaluate expressions to simplify them
    const val = expression.evaluate(parse(c.value));
    _config[c._id] = val;
    if (c._id.startsWith("ui.")) {
      const keys = c._id.split(".");
      if (!(keys[1] in ui)) continue;
      // remove the first key(ui)
      keys.shift();
      let ref = ui;
      while (keys.length > 1) {
        const k = keys.shift();
        if (ref[k] == null || typeof ref[k] !== "object") ref[k] = {};
        ref = ref[k];
      }
      ref[keys[0]] = val;
    }
  }

  return [h, _config, ui];
}

const localCache = new LocalCache<Snapshot>("ui-local-cache-hash", refresh);

async function refresh(): Promise<[string, Snapshot]> {
  const res = await Promise.all([
    fetchPermissions(),
    fetchUsers(),
    fetchConfig(),
  ]);

  const h = crypto.createHash("md5");
  for (const r of res) h.update(r[0]);

  const snapshot = {
    permissions: res[0][1],
    users: res[1][1],
    config: res[2][1],
    ui: res[2][2],
  };

  return [h.digest("hex"), snapshot];
}

export async function getRevision(): Promise<string> {
  return await localCache.getRevision();
}

export function getConfig(
  revision: string,
  key: string,
  context: Record<string, unknown>,
  now: number,
  cb?: (e: Expression) => Expression,
): string | number | boolean | null {
  const snapshot = localCache.get(revision);
  if (!snapshot) throw new Error("Cache snapshot does not exist");

  const oldOpts = {
    "cwmp.downloadTimeout": "DOWNLOAD_TIMEOUT",
    "cwmp.debug": "DEBUG",
    "cwmp.retryDelay": "RETRY_DELAY",
    "cwmp.sessionTimeout": "SESSION_TIMEOUT",
    "cwmp.connectionRequestTimeout": "CONNECTION_REQUEST_TIMEOUT",
    "cwmp.gpnNextLevel": "GPN_NEXT_LEVEL",
    "cwmp.gpvBatchSize": "GPV_BATCH_SIZE",
    "cwmp.cookiesPath": "COOKIES_PATH",
    "cwmp.datetimeMilliseconds": "DATETIME_MILLISECONDS",
    "cwmp.booleanLiteral": "BOOLEAN_LITERAL",
    "cwmp.connectionRequestAllowBasicAuth":
      "CONNECTION_REQUEST_ALLOW_BASIC_AUTH",
    "cwmp.maxCommitIterations": "MAX_COMMIT_ITERATIONS",
    "cwmp.deviceOnlineThreshold": "DEVICE_ONLINE_THRESHOLD",
    "cwmp.udpConnectionRequestPort": "UDP_CONNECTION_REQUEST_PORT",
  };

  if (!(key in snapshot.config)) {
    if (key in oldOpts) {
      let id;
      if (context?.["id"]) {
        id = context["id"];
      } else if (cb) {
        id = cb(["PARAM", "DeviceID.ID"]);
        if (Array.isArray(id)) id = null;
      }
      return config.get(oldOpts[key], id);
    }
    return null;
  }

  const v = expression.evaluate(snapshot.config[key], context, now, cb);
  return Array.isArray(v) ? null : v;
}

export function getConfigExpression(revision: string, key: string): Expression {
  const snapshot = localCache.get(revision);
  return snapshot.config[key];
}

export function getUsers(revision: string): Users {
  const snapshot = localCache.get(revision);
  return snapshot.users;
}

export function getPermissions(revision: string): Permissions {
  const snapshot = localCache.get(revision);
  return snapshot.permissions;
}

export function getUiConfig(revision: string): UiConfig {
  const snapshot = localCache.get(revision);
  return snapshot.ui;
}
