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

import * as stream from "stream";
import Router from "koa-router";
import * as db from "./db";
import * as apiFunctions from "./api-functions";
import { evaluate, and, extractParams } from "../common/expression";
import { parse } from "../common/expression-parser";
import * as logger from "../logger";
import { getConfig } from "../local-cache";
import { QueryOptions, Expression } from "../types";
import { generateSalt, hashPassword } from "../auth";
import { del } from "../cache";
import Authorizer from "../common/authorizer";
import { ping } from "../ping";
import * as url from "url";

const router = new Router();
export default router;

function logUnauthorizedWarning(log): void {
  log.message += " not authorized";
  logger.accessWarn(log);
}

const RESOURCE_DELETE = 1 << 0;
const RESOURCE_PUT = 1 << 1;

const RESOURCE_IDS = {
  devices: "DeviceID.ID",
  presets: "_id",
  provisions: "_id",
  files: "_id",
  virtualParameters: "_id",
  config: "_id",
  permissions: "_id",
  users: "_id",
  faults: "_id",
  tasks: "_id"
};

const resources = {
  devices: 0 | RESOURCE_DELETE,
  presets: 0 | RESOURCE_DELETE | RESOURCE_PUT,
  provisions: 0 | RESOURCE_DELETE | RESOURCE_PUT,
  files: 0 | RESOURCE_DELETE,
  virtualParameters: 0 | RESOURCE_DELETE | RESOURCE_PUT,
  config: 0 | RESOURCE_DELETE | RESOURCE_PUT,
  permissions: 0 | RESOURCE_DELETE | RESOURCE_PUT,
  users: 0 | RESOURCE_DELETE | RESOURCE_PUT,
  faults: 0 | RESOURCE_DELETE,
  tasks: 0
};

router.get(`/devices/:id.csv`, async ctx => {
  const authorizer: Authorizer = ctx.state.authorizer;
  const log = {
    message: "Query device (CSV)",
    context: ctx,
    id: ctx.params.id
  };

  const filter = and(authorizer.getFilter("devices", 2), [
    "=",
    ["PARAM", RESOURCE_IDS.devices],
    ctx.params.id
  ]);

  if (!authorizer.hasAccess("devices", 2)) {
    logUnauthorizedWarning(log);
    return void (ctx.status = 404);
  }

  const res = await db.query("devices", filter);
  if (!res[0]) return void (ctx.status = 404);

  ctx.type = "text/csv";
  ctx.attachment(
    `device-${ctx.params.id}-${new Date()
      .toISOString()
      .replace(/[:.]/g, "")}.csv`
  );

  ctx.body = new stream.PassThrough();
  ctx.body.write(
    "Parameter,Object,Object timestamp,Writable,Writable timestamp,Value,Value type,Value timestamp\n"
  );

  for (const k of Object.keys(res[0]).sort()) {
    const p = res[0][k];
    const row = [
      k,
      p.object,
      p.objectTimestamp,
      p.writable,
      p.writableTimestamp,
      p.value != null ? `"${p.value[0].toString().replace(/"/g, '""')}"` : "",
      p.value != null ? p.value[1] : "",
      p.valueTimestamp
    ];
    ctx.body.write(row.map(r => (r != null ? r : "")).join(",") + "\n");
  }
  ctx.body.end();
  logger.accessInfo(log);
});

for (const [resource, flags] of Object.entries(resources)) {
  router.head(`/${resource}`, async (ctx, next) => {
    const authorizer: Authorizer = ctx.state.authorizer;
    let filter: Expression = authorizer.getFilter(resource, 1);
    if (ctx.request.query.filter)
      filter = and(filter, parse(ctx.request.query.filter));

    const log = {
      message: `Count ${resource}`,
      context: ctx,
      filter: ctx.request.query.filter,
      count: null
    };

    if (!authorizer.hasAccess(resource, 1)) {
      logUnauthorizedWarning(log);
      return void next();
    }

    // Exclude temporary tasks and faults
    if (resource === "tasks" || resource === "faults") {
      filter = and(filter, [
        "NOT",
        ["<", ["PARAM", "expiry"], Date.now() + 60000]
      ]);
    }

    const count = await db.count(resource, filter);

    ctx.set("X-Total-Count", `${count}`);
    ctx.body = "";

    log.count = count;
    logger.accessInfo(log);
  });

  router.get(`/${resource}`, async (ctx, next) => {
    const authorizer: Authorizer = ctx.state.authorizer;
    const options: QueryOptions = {};
    let filter: Expression = authorizer.getFilter(resource, 2);
    if (ctx.request.query.filter)
      filter = and(filter, parse(ctx.request.query.filter));
    if (ctx.request.query.limit) options.limit = +ctx.request.query.limit;
    if (ctx.request.query.skip) options.skip = +ctx.request.query.skip;
    if (ctx.request.query.sort)
      options.sort = JSON.parse(ctx.request.query.sort);
    if (ctx.request.query.projection) {
      options.projection = ctx.request.query.projection
        .split(",")
        .reduce((obj, k) => Object.assign(obj, { [k]: 1 }), {});
    }

    const log = {
      message: `Query ${resource}`,
      context: ctx,
      filter: ctx.request.query.filter,
      limit: options.limit,
      skip: options.skip,
      sort: options.sort,
      projection: options.projection
    };

    if (!authorizer.hasAccess(resource, 2)) {
      logUnauthorizedWarning(log);
      return void next();
    }

    // Exclude temporary tasks and faults
    if (resource === "tasks" || resource === "faults") {
      filter = and(filter, [
        "NOT",
        ["<", ["PARAM", "expiry"], Date.now() + 60000]
      ]);
    }

    ctx.body = new stream.PassThrough();
    ctx.type = "application/json";

    let c = 0;
    ctx.body.write("[\n");
    await db.query(resource, filter, options, obj => {
      ctx.body.write((c++ ? "," : "") + JSON.stringify(obj) + "\n");
    });
    ctx.body.end("]");

    logger.accessInfo(log);
  });

  // CSV download
  router.get(`/${resource}.csv`, async (ctx, next) => {
    const authorizer: Authorizer = ctx.state.authorizer;
    const options: QueryOptions = { projection: {} };
    let filter: Expression = authorizer.getFilter(resource, 2);
    if (ctx.request.query.filter)
      filter = and(filter, parse(ctx.request.query.filter));
    if (ctx.request.query.limit) options.limit = +ctx.request.query.limit;
    if (ctx.request.query.skip) options.skip = +ctx.request.query.skip;
    if (ctx.request.query.sort)
      options.sort = JSON.parse(ctx.request.query.sort);

    const log = {
      message: `Query ${resource} (CSV)`,
      context: ctx,
      filter: ctx.request.query.filter,
      limit: options.limit,
      skip: options.skip,
      sort: options.sort
    };

    if (!authorizer.hasAccess(resource, 2)) {
      logUnauthorizedWarning(log);
      return void next();
    }

    const columns = JSON.parse(ctx.request.query.columns);
    const now = Date.now();

    for (const [k, v] of Object.entries(columns)) {
      const e = evaluate(parse(v as string), null, now);
      columns[k] = e;
      for (const p of extractParams(e))
        if (typeof p === "string") options.projection[p] = 1;
    }

    // Exclude temporary tasks and faults
    if (resource === "tasks" || resource === "faults") {
      filter = and(filter, [
        "NOT",
        ["<", ["PARAM", "expiry"], Date.now() + 60000]
      ]);
    }

    ctx.body = new stream.PassThrough();
    ctx.type = "text/csv";
    ctx.attachment(
      `${resource}-${new Date(now).toISOString().replace(/[:.]/g, "")}.csv`
    );

    ctx.body.write(
      Object.keys(columns).map(k => `"${k.replace(/"/, '""')}"`) + "\n"
    );
    await db.query(resource, filter, options, obj => {
      const arr = Object.values(columns).map(exp => {
        const v = evaluate(exp, obj, null, e => {
          if (Array.isArray(e)) {
            if (e[0] === "PARAM") {
              if (resource === "devices") {
                if (e[1] === "Tags") {
                  const tags = [];
                  for (const p in obj)
                    if (p.startsWith("Tags.")) tags.push(p.slice(5));

                  return tags.join(", ");
                }
              }
            } else if (e[0] === "FUNC") {
              if (e[1] === "DATE_STRING") {
                if (e[2] && !Array.isArray(e[2]))
                  return new Date(e[2]).toISOString();
              }
            }
          }

          return e;
        });

        if (Array.isArray(v) || v == null) return "";
        if (typeof v === "string") return `"${v.replace(/"/g, '""')}"`;
        return v;
      });
      ctx.body.write(arr.join(",") + "\n");
    });
    ctx.body.end();

    logger.accessInfo(log);
  });

  router.head(`/${resource}/:id`, async (ctx, next) => {
    const authorizer: Authorizer = ctx.state.authorizer;
    const log = {
      message: `Count ${resource}`,
      context: ctx,
      filter: `${RESOURCE_IDS[resource]} = "${ctx.params.id}"`
    };

    const filter = and(authorizer.getFilter(resource, 2), [
      "=",
      ["PARAM", RESOURCE_IDS[resource]],
      ctx.params.id
    ]);
    if (!authorizer.hasAccess(resource, 2)) {
      logUnauthorizedWarning(log);
      return void next();
    }

    const res = await db.query(resource, filter);

    if (!res.length) return void next();

    logger.accessInfo(log);
    ctx.body = "";
  });

  router.get(`/${resource}/:id`, async (ctx, next) => {
    const authorizer: Authorizer = ctx.state.authorizer;
    const log = {
      message: `Query ${resource}`,
      context: ctx,
      filter: `${RESOURCE_IDS[resource]} = "${ctx.params.id}"`
    };

    const filter = and(authorizer.getFilter(resource, 2), [
      "=",
      ["PARAM", RESOURCE_IDS[resource]],
      ctx.params.id
    ]);
    if (!authorizer.hasAccess(resource, 2)) {
      logUnauthorizedWarning(log);
      return void next();
    }

    const res = await db.query(resource, filter);

    if (!res.length) return void next();

    logger.accessInfo(log);
    ctx.body = res[0];
  });

  if (flags & RESOURCE_DELETE) {
    router.delete(`/${resource}/:id`, async (ctx, next) => {
      const authorizer: Authorizer = ctx.state.authorizer;
      const log = {
        message: `Delete ${resource}`,
        context: ctx,
        id: ctx.params.id
      };

      const filter = and(authorizer.getFilter(resource, 3), [
        "=",
        ["PARAM", RESOURCE_IDS[resource]],
        ctx.params.id
      ]);
      if (!authorizer.hasAccess(resource, 3)) {
        logUnauthorizedWarning(log);
        return void next();
      }
      const res = await db.query(resource, filter);
      if (!res.length) return void next();

      const validate = authorizer.getValidator(resource, res[0]);
      if (!validate("delete")) {
        logUnauthorizedWarning(log);
        return void (ctx.status = 403);
      }

      await apiFunctions.deleteResource(resource, ctx.params.id);

      logger.accessInfo(log);

      ctx.body = "";
    });
  }

  if (flags & RESOURCE_PUT) {
    router.put(`/${resource}/:id`, async (ctx, next) => {
      const authorizer: Authorizer = ctx.state.authorizer;
      const id = ctx.params.id;

      const log = {
        message: `Put ${resource}`,
        context: ctx,
        id: id
      };

      if (!authorizer.hasAccess(resource, 3)) {
        logUnauthorizedWarning(log);
        return void next();
      }

      const obj = ctx.request.body;

      const validate = authorizer.getValidator(resource, obj);
      if (!validate("put")) {
        logUnauthorizedWarning(log);
        return void (ctx.status = 403);
      }

      try {
        await apiFunctions.putResource(resource, id, obj);
      } catch (err) {
        log.message += " failed";
        logger.accessWarn(log);
        ctx.body = `${err.name}: ${err.message}`;
        return void (ctx.status = 400);
      }

      logger.accessInfo(log);

      ctx.body = "";
    });
  }
}

router.put("/files/:id", async (ctx, next) => {
  const authorizer: Authorizer = ctx.state.authorizer;
  const resource = "files";
  const id = ctx.params.id;

  const log = {
    message: `Upload ${resource}`,
    context: ctx,
    id: id,
    metadata: null
  };

  if (!authorizer.hasAccess(resource, 3)) {
    logUnauthorizedWarning(log);
    return void next();
  }

  const metadata = {
    fileType: ctx.request.headers["metadata.filetype"] || "",
    oui: ctx.request.headers["metadata.oui"] || "",
    productClass: ctx.request.headers["metadata.productclass"] || "",
    version: ctx.request.headers["metadata.version"] || ""
  };

  const validate = authorizer.getValidator(resource, metadata);
  if (!validate("put")) {
    logUnauthorizedWarning(log);
    return void (ctx.status = 403);
  }

  try {
    await db.deleteFile(id);
  } catch (err) {
    // File doesn't exist, ignore
  }

  await db.putFile(id, metadata, ctx.req);
  log.metadata = metadata;
  logger.accessInfo(log);

  ctx.body = "";
});

router.post("/devices/:id/tasks", async (ctx, next) => {
  const authorizer: Authorizer = ctx.state.authorizer;
  const log = {
    message: "Commit tasks",
    context: ctx,
    deviceId: ctx.params.id,
    tasks: null
  };

  const filter = and(authorizer.getFilter("devices", 3), [
    "=",
    ["PARAM", "DeviceID.ID"],
    ctx.params.id
  ]);
  if (!authorizer.hasAccess("devices", 3)) {
    logUnauthorizedWarning(log);
    return void next();
  }
  const devices = await db.query("devices", filter);
  if (!devices.length) return void next();
  const device = devices[0];

  const validate = authorizer.getValidator("devices", device);
  for (const t of ctx.request.body) {
    if (!validate("task", t)) {
      logUnauthorizedWarning(log);
      return void (ctx.status = 403);
    }
  }

  const onlineThreshold = getConfig(
    ctx.state.configSnapshot,
    "cwmp.deviceOnlineThreshold",
    {},
    Date.now(),
    exp => {
      if (!Array.isArray(exp)) return exp;
      if (exp[0] === "PARAM") {
        const p = device[exp[1]];
        if (p && p.value) return p.value[0];
      } else if (exp[0] === "FUNC") {
        if (exp[1] === "REMOTE_ADDRESS") {
          for (const root of ["InternetGatewayDevice", "Device"]) {
            const p = device[`${root}.ManagementServer.ConnectionRequestURL`];
            if (p && p.value) return url.parse(p.value[0]).host;
          }
          return null;
        }
      }
      return exp;
    }
  );

  const res = await apiFunctions.postTasks(
    ctx.params.id,
    ctx.request.body,
    onlineThreshold,
    device
  );

  log.tasks = res.tasks.map(t => t._id).join(",");

  logger.accessInfo(log);

  ctx.set("Connection-Request", res.connectionRequest);
  ctx.body = res.tasks;
});

router.post("/devices/:id/tags", async (ctx, next) => {
  const authorizer: Authorizer = ctx.state.authorizer;
  const log = {
    message: "Update tags",
    context: ctx,
    deviceId: ctx.params.id,
    tags: ctx.request.body
  };

  const filter = and(authorizer.getFilter("devices", 3), [
    "=",
    ["PARAM", "DeviceID.ID"],
    ctx.params.id
  ]);
  if (!authorizer.hasAccess("devices", 3)) {
    logUnauthorizedWarning(log);
    return void next();
  }
  const res = await db.query("devices", filter);
  if (!res.length) return void next();

  const validate = authorizer.getValidator("devices", res[0]);
  if (!validate("tags", ctx.request.body)) {
    logUnauthorizedWarning(log);
    return void (ctx.status = 403);
  }

  try {
    await db.updateDeviceTags(ctx.params.id, ctx.request.body);
  } catch (error) {
    log.message += " failed";
    logger.accessWarn(log);
    ctx.body = error.message;
    return void (ctx.status = 400);
  }

  logger.accessInfo(log);

  ctx.body = "";
});

router.get("/ping/:host", async ctx => {
  return new Promise(resolve => {
    ping(ctx.params.host, (err, parsed) => {
      if (parsed) {
        ctx.body = parsed;
      } else {
        ctx.status = 500;
        ctx.body = `${err.name}: ${err.message}`;
      }
      resolve();
    });
  });
});

router.put("/users/:id/password", async (ctx, next) => {
  const authorizer: Authorizer = ctx.state.authorizer;
  const username = ctx.params.id;
  const log = {
    message: "Change password",
    context: ctx,
    username: username
  };

  if (!ctx.state.user) {
    // User not logged in
    if (
      !(await apiFunctions.authLocal(
        ctx.state.configSnapshot,
        username,
        ctx.request.body.authPassword
      ))
    ) {
      logUnauthorizedWarning(log);
      ctx.status = 401;
      ctx.body = "Authentication failed, check your username and password";
      return;
    }
  } else if (!authorizer.hasAccess("users", 3)) {
    logUnauthorizedWarning(log);
    return void next();
  }

  const filter = and(authorizer.getFilter("users", 3), [
    "=",
    ["PARAM", RESOURCE_IDS.users],
    username
  ]);
  const res = await db.query("users", filter);
  if (!res.length) return void next();

  const newPassword = ctx.request.body.newPassword;
  if (ctx.state.user) {
    const validate = authorizer.getValidator("users", res[0]);
    if (!validate("password", { password: newPassword })) {
      logUnauthorizedWarning(log);
      return void (ctx.status = 403);
    }
  }

  const salt = await generateSalt(64);
  const password = await hashPassword(newPassword, salt);
  await db.putUser(username, { password, salt });

  await del("presets_hash");

  logger.accessInfo(log);
  ctx.body = "";
});
