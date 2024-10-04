import { Readable } from "node:stream";
import Router from "@koa/router";
import { ObjectId } from "mongodb";
import * as db from "./db.ts";
import * as apiFunctions from "../api-functions.ts";
import { evaluate, and, extractParams } from "../common/expression/util.ts";
import { parse } from "../common/expression/parser.ts";
import * as logger from "../logger.ts";
import { getConfig } from "../ui/local-cache.ts";
import { Expression, Task } from "../types.ts";
import { generateSalt, hashPassword } from "../auth.ts";
import { del } from "../cache.ts";
import Authorizer from "../common/authorizer.ts";
import { ping } from "../ping.ts";
import { decodeTag } from "../util.ts";
import { stringify as yamlStringify } from "../common/yaml.ts";
import { ResourceLockedError } from "../common/errors.ts";
import { acquireLock, releaseLock } from "../lock.ts";
import { collections } from "../db/db.ts";

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
  tasks: "_id",
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
  tasks: 0,
};

function singleParam(p: string | string[]): string {
  return Array.isArray(p) ? p[p.length - 1] : p;
}

router.get(`/devices/:id.csv`, async (ctx) => {
  const authorizer: Authorizer = ctx.state.authorizer;
  const log = {
    message: "Query device (CSV)",
    context: ctx,
    id: ctx.params.id,
  };

  const filter = and(authorizer.getFilter("devices", 2), [
    "=",
    ["PARAM", RESOURCE_IDS.devices],
    ctx.params.id,
  ]);

  if (!authorizer.hasAccess("devices", 2)) {
    logUnauthorizedWarning(log);
    return void (ctx.status = 403);
  }

  const { value: device } = await db.query("devices", filter).next();
  if (!device) return void (ctx.status = 404);

  ctx.type = "text/csv";
  ctx.attachment(
    `device-${ctx.params.id}-${new Date()
      .toISOString()
      .replace(/[:.]/g, "")}.csv`,
  );

  const lines: string[] = [
    "Parameter,Object,Object timestamp,Writable,Writable timestamp,Value,Value type,Value timestamp,Notification,Notification timestamp,Access list,Access list timestamp",
  ];

  for (const k of Object.keys(device).sort()) {
    const p = device[k];
    let value = "";
    let type = "";
    if (p.value) {
      value = p.value[0];
      type = p.value[1];
      if (type === "xsd:dateTime" && typeof value === "number")
        value = new Date(value).toJSON();
    }

    const row = [
      k,
      p.object,
      new Date(p.objectTimestamp).toJSON(),
      p.writable,
      new Date(p.writableTimestamp).toJSON(),
      `"${String(value).replace(/"/g, '""')}"`,
      type,
      new Date(p.valueTimestamp).toJSON(),
      p.notification,
      new Date(p.notificationTimestamp).toJSON(),
      p.accessList ? p.accessList.join(", ") : "",
      new Date(p.accessListTimestamp).toJSON(),
    ];
    lines.push(row.map((r) => (r != null ? r : "")).join(","));
  }
  ctx.body = lines.join("\n");
  logger.accessInfo(log);
});

for (const [resource, flags] of Object.entries(resources)) {
  router.head(`/${resource}`, async (ctx) => {
    const authorizer: Authorizer = ctx.state.authorizer;
    let filter: Expression = authorizer.getFilter(resource, 1);
    if (ctx.request.query.filter)
      filter = and(filter, parse(singleParam(ctx.request.query.filter)));

    const log = {
      message: `Count ${resource}`,
      context: ctx,
      filter: ctx.request.query.filter,
      count: null,
    };

    if (!authorizer.hasAccess(resource, 1)) {
      logUnauthorizedWarning(log);
      return void (ctx.status = 403);
    }

    // Exclude temporary tasks and faults
    if (resource === "tasks" || resource === "faults") {
      filter = and(filter, [
        "OR",
        [">=", ["PARAM", "expiry"], Date.now() + 60000],
        ["IS NULL", ["PARAM", "expiry"]],
      ]);
    }

    const count = await db.count(resource, filter);

    ctx.set("X-Total-Count", `${count}`);
    ctx.body = "";

    log.count = count;
    logger.accessInfo(log);
  });

  router.get(`/${resource}`, async (ctx) => {
    const authorizer: Authorizer = ctx.state.authorizer;
    const options: Parameters<typeof db.query>[2] = {};
    let filter: Expression = authorizer.getFilter(resource, 2);
    if (ctx.request.query.filter)
      filter = and(filter, parse(singleParam(ctx.request.query.filter)));
    if (ctx.request.query.limit) options.limit = +ctx.request.query.limit;
    if (ctx.request.query.skip) options.skip = +ctx.request.query.skip;
    if (ctx.request.query.sort)
      options.sort = JSON.parse(singleParam(ctx.request.query.sort));
    if (ctx.request.query.projection) {
      options.projection = singleParam(ctx.request.query.projection)
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
      projection: options.projection,
    };

    if (!authorizer.hasAccess(resource, 2)) {
      logUnauthorizedWarning(log);
      return void (ctx.status = 403);
    }

    // Exclude temporary tasks and faults
    if (resource === "tasks" || resource === "faults") {
      filter = and(filter, [
        "OR",
        [">=", ["PARAM", "expiry"], Date.now() + 60000],
        ["IS NULL", ["PARAM", "expiry"]],
      ]);
    }

    logger.accessInfo(log);
    ctx.type = "application/json";
    ctx.body = Readable.from(
      (async function* () {
        let c = 0;
        yield "[\n";
        for await (const obj of db.query(resource, filter, options))
          yield (c++ ? "," : "") + JSON.stringify(obj) + "\n";
        yield "]";
      })(),
    );
  });

  // CSV download
  router.get(`/${resource}.csv`, async (ctx) => {
    const authorizer: Authorizer = ctx.state.authorizer;
    const options: Parameters<typeof db.query>[2] = { projection: {} };
    let filter: Expression = authorizer.getFilter(resource, 2);
    if (ctx.request.query.filter)
      filter = and(filter, parse(singleParam(ctx.request.query.filter)));
    if (ctx.request.query.limit) options.limit = +ctx.request.query.limit;
    if (ctx.request.query.skip) options.skip = +ctx.request.query.skip;
    if (ctx.request.query.sort)
      options.sort = JSON.parse(singleParam(ctx.request.query.sort));

    const log = {
      message: `Query ${resource} (CSV)`,
      context: ctx,
      filter: ctx.request.query.filter,
      limit: options.limit,
      skip: options.skip,
      sort: options.sort,
    };

    if (!authorizer.hasAccess(resource, 2)) {
      logUnauthorizedWarning(log);
      return void (ctx.status = 403);
    }

    const columns: Record<string, Expression> = JSON.parse(
      singleParam(ctx.request.query.columns),
    );
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
        "OR",
        [">=", ["PARAM", "expiry"], Date.now() + 60000],
        ["IS NULL", ["PARAM", "expiry"]],
      ]);
    }

    logger.accessInfo(log);
    ctx.type = "text/csv";
    ctx.attachment(
      `${resource}-${new Date(now).toISOString().replace(/[:.]/g, "")}.csv`,
    );

    ctx.body = Readable.from(
      (async function* () {
        yield Object.keys(columns).map((k) => `"${k.replace(/"/, '""')}"`) +
          "\n";
        for await (const obj of db.query(resource, filter, options)) {
          const arr = Object.values(columns).map((exp) => {
            const v = evaluate(exp, obj, null, (e) => {
              if (Array.isArray(e)) {
                if (e[0] === "PARAM") {
                  if (resource === "devices") {
                    if (e[1] === "Tags") {
                      const tags = [];
                      for (const p in obj)
                        if (p.startsWith("Tags."))
                          tags.push(decodeTag(p.slice(5)));

                      return tags.join(", ");
                    }
                    if (e === exp) {
                      const p = obj[e[1]];
                      if (
                        p &&
                        p.value &&
                        p.value[1] === "xsd:dateTime" &&
                        typeof p.value[0] === "number"
                      )
                        return new Date(p.value[0]).toJSON();
                    }
                  } else if (resource === "faults") {
                    if (e[1] === "detail") return yamlStringify(obj["detail"]);
                  }
                } else if (e[0] === "FUNC") {
                  if (e[1] === "DATE_STRING") {
                    if (e[2] && !Array.isArray(e[2]))
                      return new Date(e[2]).toJSON();
                  }
                }
              }

              return e;
            });

            if (Array.isArray(v) || v == null) return "";
            if (typeof v === "string") return `"${v.replace(/"/g, '""')}"`;
            return v;
          });
          yield arr.join(",") + "\n";
        }
      })(),
    );
  });

  router.head(`/${resource}/:id`, async (ctx) => {
    const authorizer: Authorizer = ctx.state.authorizer;
    const log = {
      message: `Count ${resource}`,
      context: ctx,
      filter: `${RESOURCE_IDS[resource]} = "${ctx.params.id}"`,
    };

    const filter = and(authorizer.getFilter(resource, 2), [
      "=",
      ["PARAM", RESOURCE_IDS[resource]],
      ctx.params.id,
    ]);
    if (!authorizer.hasAccess(resource, 2)) {
      logUnauthorizedWarning(log);
      return void (ctx.status = 403);
    }

    const count = await db.count(resource, filter);

    if (!count) return void (ctx.status = 404);

    logger.accessInfo(log);
    ctx.body = "";
  });

  router.get(`/${resource}/:id`, async (ctx) => {
    const authorizer: Authorizer = ctx.state.authorizer;
    const log = {
      message: `Query ${resource}`,
      context: ctx,
      filter: `${RESOURCE_IDS[resource]} = "${ctx.params.id}"`,
    };

    const filter = and(authorizer.getFilter(resource, 2), [
      "=",
      ["PARAM", RESOURCE_IDS[resource]],
      ctx.params.id,
    ]);
    if (!authorizer.hasAccess(resource, 2)) {
      logUnauthorizedWarning(log);
      return void (ctx.status = 403);
    }

    const { value: res } = await db.query(resource, filter).next();

    if (!res) return void (ctx.status = 404);

    logger.accessInfo(log);
    ctx.body = res;
  });

  if (flags & RESOURCE_DELETE) {
    router.delete(`/${resource}/:id`, async (ctx) => {
      const authorizer: Authorizer = ctx.state.authorizer;
      const log = {
        message: `Delete ${resource}`,
        context: ctx,
        id: ctx.params.id,
      };

      const filter = and(authorizer.getFilter(resource, 3), [
        "=",
        ["PARAM", RESOURCE_IDS[resource]],
        ctx.params.id,
      ]);
      if (!authorizer.hasAccess(resource, 3)) {
        logUnauthorizedWarning(log);
        return void (ctx.status = 403);
      }
      const { value: res } = await db.query(resource, filter).next();
      if (!res) return void (ctx.status = 404);

      const validate = authorizer.getValidator(resource, res);
      if (!validate("delete")) {
        logUnauthorizedWarning(log);
        return void (ctx.status = 403);
      }

      try {
        await apiFunctions.deleteResource(resource, ctx.params.id);
      } catch (err) {
        if (err instanceof ResourceLockedError) {
          log.message += " failed";
          logger.accessWarn(log);
          ctx.status = 503;
          ctx.body = err.message;
          return;
        }
        throw err;
      }

      logger.accessInfo(log);

      ctx.body = "";
    });
  }

  if (flags & RESOURCE_PUT) {
    router.put(`/${resource}/:id`, async (ctx) => {
      const authorizer: Authorizer = ctx.state.authorizer;
      const id = ctx.params.id;

      const log = {
        message: `Put ${resource}`,
        context: ctx,
        id: id,
      };

      if (!authorizer.hasAccess(resource, 3)) {
        logUnauthorizedWarning(log);
        return void (ctx.status = 403);
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

router.get("/blob/files/:id", async (ctx) => {
  const authorizer: Authorizer = ctx.state.authorizer;
  const resource = "files";
  const id = ctx.params.id;

  const log = {
    message: `Download ${resource}`,
    context: ctx,
    id: id,
  };

  const filter = and(authorizer.getFilter(resource, 2), [
    "=",
    ["PARAM", RESOURCE_IDS[resource]],
    ctx.params.id,
  ]);

  if (!authorizer.hasAccess(resource, 2)) {
    logUnauthorizedWarning(log);
    return void (ctx.status = 403);
  }

  const count = await db.count(resource, filter);
  if (!count) return void (ctx.status = 404);

  logger.accessInfo(log);
  ctx.body = db.downloadFile(id);
  ctx.attachment(id);
});

router.put("/files/:id", async (ctx) => {
  const authorizer: Authorizer = ctx.state.authorizer;
  const resource = "files";
  const id = ctx.params.id;

  const log = {
    message: `Upload ${resource}`,
    context: ctx,
    id: id,
    metadata: null,
  };

  if (!authorizer.hasAccess(resource, 3)) {
    logUnauthorizedWarning(log);
    return void (ctx.status = 403);
  }

  const metadata = {
    fileType: singleParam(ctx.request.headers["metadata-filetype"]) || "",
    oui: singleParam(ctx.request.headers["metadata-oui"]) || "",
    productClass:
      singleParam(ctx.request.headers["metadata-productclass"]) || "",
    version: singleParam(ctx.request.headers["metadata-version"]) || "",
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

router.post("/devices/:id/tasks", async (ctx) => {
  const deviceId = ctx.params.id;
  const authorizer: Authorizer = ctx.state.authorizer;
  const log = {
    message: "Commit tasks",
    context: ctx,
    deviceId: deviceId,
    tasks: null,
  };

  if (!authorizer.hasAccess("devices", 3)) {
    logUnauthorizedWarning(log);
    return void (ctx.status = 403);
  }

  const socketTimeout: number = ctx.socket.timeout;

  // Extend socket timeout while waiting for session
  if (socketTimeout) ctx.socket.setTimeout(300000);

  const token = await acquireLock(`cwmp_session_${deviceId}`, 5000, 30000);
  if (!token) {
    log.message += " failed";
    logger.accessWarn(log);
    ctx.body = "Device is in session";
    ctx.status = 503;
    // Restore socket timeout
    if (socketTimeout) ctx.socket.setTimeout(socketTimeout);
    return;
  }

  let device;

  let statuses: { _id: string; status: string }[];

  try {
    const filter = and(authorizer.getFilter("devices", 3), [
      "=",
      ["PARAM", "DeviceID.ID"],
      deviceId,
    ]);
    device = (await db.query("devices", filter).next()).value;
    if (!device) return void (ctx.status = 404);

    const validate = authorizer.getValidator("devices", device);
    for (const t of ctx.request.body) {
      if (!validate("task", t)) {
        logUnauthorizedWarning(log);
        return void (ctx.status = 403);
      }
    }

    let tasks = ctx.request.body as Task[];

    for (const task of tasks) {
      delete task._id;
      task["device"] = deviceId;
    }

    tasks = await apiFunctions.insertTasks(tasks);

    statuses = tasks.map((t) => ({ _id: t._id, status: "pending" }));
  } finally {
    await releaseLock(`cwmp_session_${deviceId}`, token);
  }

  const onlineThreshold = getConfig(
    ctx.state.configSnapshot,
    "cwmp.deviceOnlineThreshold",
    {},
    Date.now(),
    (exp) => {
      if (!Array.isArray(exp)) return exp;
      if (exp[0] === "PARAM") {
        const p = device[exp[1]];
        if (p?.value) return p.value[0];
      } else if (exp[0] === "FUNC") {
        if (exp[1] === "REMOTE_ADDRESS") {
          for (const root of ["InternetGatewayDevice", "Device"]) {
            const p = device[`${root}.ManagementServer.ConnectionRequestURL`];
            if (p?.value) return new URL(p.value[0]).hostname;
          }
          return null;
        }
      }
      return exp;
    },
  ) as number;

  const lastInform = device["Events.Inform"].value[0] as number;

  let status = await apiFunctions.connectionRequest(deviceId, device);
  if (!status) {
    const sessionStarted = await apiFunctions.awaitSessionStart(
      deviceId,
      lastInform,
      onlineThreshold,
    );
    if (!sessionStarted) {
      status = "No contact from CPE";
    } else {
      const sessionEnded = await apiFunctions.awaitSessionEnd(deviceId, 120000);
      if (!sessionEnded) status = "Session took too long to complete";
    }
  }

  if (!status) {
    const promises = statuses.map((t) =>
      collections.faults.count({ _id: `${deviceId}:task_${t._id}` }),
    );

    const res = await Promise.all(promises);
    for (const [i, r] of statuses.entries())
      r.status = res[i] ? "fault" : "done";
  }

  await Promise.all(statuses.map((t) => db.deleteTask(new ObjectId(t._id))));

  // Restore socket timeout
  if (socketTimeout) ctx.socket.setTimeout(socketTimeout);

  log.tasks = statuses.map((t) => t._id).join(",");
  logger.accessInfo(log);

  ctx.set("Connection-Request", status || "OK");
  ctx.body = statuses;
});

router.post("/devices/:id/tags", async (ctx) => {
  const authorizer: Authorizer = ctx.state.authorizer;
  const log = {
    message: "Update tags",
    context: ctx,
    deviceId: ctx.params.id,
    tags: ctx.request.body,
  };

  const filter = and(authorizer.getFilter("devices", 3), [
    "=",
    ["PARAM", "DeviceID.ID"],
    ctx.params.id,
  ]);
  if (!authorizer.hasAccess("devices", 3)) {
    logUnauthorizedWarning(log);
    return void (ctx.status = 403);
  }
  const { value: res } = await db.query("devices", filter).next();
  if (!res) return void (ctx.status = 404);

  const validate = authorizer.getValidator("devices", res);
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

router.get("/ping/:host", async (ctx) => {
  if (!ctx.state.user) return void (ctx.status = 401);
  return new Promise<void>((resolve) => {
    ping(ctx.params.host, (err, parsed) => {
      if (parsed) {
        ctx.body = parsed;
      } else {
        ctx.status = 500;
        ctx.body = err ? `${err.name}: ${err.message}` : "Unknown error";
      }
      resolve();
    });
  });
});

router.put("/users/:id/password", async (ctx) => {
  const authorizer: Authorizer = ctx.state.authorizer;
  const username = ctx.params.id;
  const log = {
    message: "Change password",
    context: ctx,
    username: username,
  };

  if (!ctx.state.user) {
    // User not logged in
    if (
      !(await apiFunctions.authLocal(
        ctx.state.configSnapshot,
        username,
        ctx.request.body.authPassword,
      ))
    ) {
      logUnauthorizedWarning(log);
      ctx.status = 401;
      ctx.body = "Authentication failed, check your username and password";
      return;
    }
  } else if (!authorizer.hasAccess("users", 3)) {
    logUnauthorizedWarning(log);
    return void (ctx.status = 403);
  }

  const newPassword = ctx.request.body.newPassword;

  if (ctx.state.user) {
    const filter = and(authorizer.getFilter("users", 3), [
      "=",
      ["PARAM", RESOURCE_IDS.users],
      username,
    ]);
    const { value: res } = await db.query("users", filter).next();
    if (!res) return void (ctx.status = 404);
    const validate = authorizer.getValidator("users", res);
    if (!validate("password", { password: newPassword })) {
      logUnauthorizedWarning(log);
      return void (ctx.status = 403);
    }
  }

  const salt = await generateSalt(64);
  const password = await hashPassword(newPassword, salt);
  await db.putUser(username, { password, salt });

  await del("ui-local-cache-hash");

  logger.accessInfo(log);
  ctx.body = "";
});
