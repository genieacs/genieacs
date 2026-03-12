import * as crypto from "node:crypto";
import { collections } from "../db/db.ts";
import Expression, { Value } from "../common/expression.ts";
import { Users, Permissions, Config, UiConfig } from "../types.ts";
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

    let validate: Expression;
    if (p.validate) validate = Expression.parse(p.validate);
    else validate = new Expression.Literal(true);
    permissions[p.role][p.access][p.resource] = {
      access: p.access,
      filter: Expression.parse(p.filter || "true"),
      validate,
    };
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

  const ui: UiConfig = {};

  const _config = {};

  for (const c of conf) {
    if (c._id.startsWith("ui.")) {
      ui[c._id.slice(3)] = c.value;
      continue;
    }
    // Evaluate expressions to simplify them
    const val = Expression.parse(c.value).evaluate((e) => e);
    _config[c._id] = val;
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
  dflt: string,
  fn: (e: Expression) => Expression.Literal,
): string;
export function getConfig(
  revision: string,
  key: string,
  dflt: number,
  fn: (e: Expression) => Expression.Literal,
): number;
export function getConfig(
  revision: string,
  key: string,
  dflt: boolean,
  fn: (e: Expression) => Expression.Literal,
): boolean;
export function getConfig(
  revision: string,
  key: string,
  dflt: Value,
  fn: (e: Expression) => Expression.Literal,
): Value {
  const snapshot = localCache.get(revision);
  if (!snapshot) throw new Error("Cache snapshot does not exist");

  const e = snapshot.config[key];
  if (!e) return dflt;
  const v = e.evaluate(fn).value;
  if (typeof v !== typeof dflt) return dflt;
  return v;
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
