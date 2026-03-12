import { Readable } from "node:stream";
import Router from "@koa/router";
import { ObjectId } from "mongodb";
import * as db from "./db.ts";
import * as apiFunctions from "../api-functions.ts";
import Expression, { extractPaths } from "../common/expression.ts";
import Path from "../common/path.ts";
import * as logger from "../logger.ts";
import { getConfig } from "../ui/local-cache.ts";
import { Task } from "../types.ts";
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

  const filter = Expression.and(
    authorizer.getFilter("devices", 2),
    new Expression.Binary(
      "=",
      new Expression.Parameter(Path.parse(RESOURCE_IDS.devices)),
      new Expression.Literal(ctx.params.id),
    ),
  );

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
    "Parameter,Object,Writable,Value,Value type,Timestamp,Value timestamp,Notification,Access list,Attributes timestamp",
  ];

  const keys = Object.keys(device).sort();
  let prevParam = "";
  let attrs: Record<string, string | number | boolean | null> = {};

  function flushRow(): void {
    if (!prevParam) return;
    let value: string | number | boolean | null = attrs["value"] ?? "";
    if (attrs["type"] === "xsd:dateTime" && typeof value === "number")
      value = new Date(value).toJSON();

    const row = [
      prevParam,
      attrs["object"] ?? "",
      attrs["writable"] ?? "",
      `"${String(value).replace(/"/g, '""')}"`,
      attrs["type"] ?? "",
      attrs["timestamp"] != null ? new Date(+attrs["timestamp"]).toJSON() : "",
      attrs["valueTimestamp"] != null
        ? new Date(+attrs["valueTimestamp"]).toJSON()
        : "",
      attrs["notification"] ?? "",
      attrs["accessList"] ?? "",
      attrs["attributesTimestamp"] != null
        ? new Date(+attrs["attributesTimestamp"]).toJSON()
        : "",
    ];
    lines.push(row.map((r) => (r != null ? r : "")).join(","));
  }

  for (const k of keys) {
    const colonIdx = k.lastIndexOf(":");
    const param = colonIdx === -1 ? k : k.slice(0, colonIdx);
    const attr = colonIdx === -1 ? "value" : k.slice(colonIdx + 1);

    if (param !== prevParam) {
      flushRow();
      prevParam = param;
      attrs = {};
    }
    attrs[attr] = device[k];
  }
  flushRow();
  ctx.body = lines.join("\n");
  logger.accessInfo(log);
});

for (const [resource, flags] of Object.entries(resources)) {
  router.head(`/${resource}`, async (ctx) => {
    const authorizer: Authorizer = ctx.state.authorizer;
    let filter: Expression = authorizer.getFilter(resource, 1);
    if (ctx.request.query.filter)
      filter = Expression.and(
        filter,
        Expression.parse(singleParam(ctx.request.query.filter)),
      );

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
      const p = new Expression.Parameter(Path.parse("expiry"));
      filter = Expression.and(
        filter,
        Expression.or(
          new Expression.Binary(
            ">=",
            p,
            new Expression.Literal(Date.now() + 60000),
          ),
          new Expression.Unary("IS NULL", p),
        ),
      );
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
      filter = Expression.and(
        filter,
        Expression.parse(singleParam(ctx.request.query.filter)),
      );
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
      const p = new Expression.Parameter(Path.parse("expiry"));
      filter = Expression.and(
        filter,
        Expression.or(
          new Expression.Binary(
            ">=",
            p,
            new Expression.Literal(Date.now() + 60000),
          ),
          new Expression.Unary("IS NULL", p),
        ),
      );
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
      filter = Expression.and(
        filter,
        Expression.parse(singleParam(ctx.request.query.filter)),
      );
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

    const columnsStr: Record<string, string> = JSON.parse(
      singleParam(ctx.request.query.columns),
    );

    const now = Date.now();
    const columns: Record<string, Expression> = Object.fromEntries(
      Object.entries(columnsStr).map(([k, v]) => {
        let exp = Expression.parse(v);
        exp = exp.evaluate((e) => {
          if (e instanceof Expression.FunctionCall && e.name === "NOW")
            return new Expression.Literal(now);
          return e;
        });
        for (const p of extractPaths(exp)) options.projection[p.toString()] = 1;
        return [k, exp];
      }),
    );

    // Exclude temporary tasks and faults
    if (resource === "tasks" || resource === "faults") {
      const p = new Expression.Parameter(Path.parse("expiry"));
      filter = Expression.and(
        filter,
        Expression.or(
          new Expression.Binary(
            ">=",
            p,
            new Expression.Literal(Date.now() + 60000),
          ),
          new Expression.Unary("IS NULL", p),
        ),
      );
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
            return exp.evaluate((e) => {
              if (e instanceof Expression.Literal) return e;
              else if (e instanceof Expression.FunctionCall) {
                if (e.name === "NOW") return new Expression.Literal(now);
                if (e.name === "DATE_STRING") {
                  if (e.args[0] instanceof Expression.Literal)
                    return new Expression.Literal(
                      new Date(e.args[0].value as number).toJSON(),
                    );
                }
              } else if (e instanceof Expression.Parameter) {
                let v = obj[e.path.toString()];
                if (resource === "devices") {
                  if (e.path.toString() === "Tags") {
                    const tags = [];
                    for (const p in obj)
                      if (p.startsWith("Tags.") && p.lastIndexOf(":") === -1)
                        tags.push(decodeTag(p.slice(5)));
                    v = tags.join(", ");
                  }
                  if (e === exp) {
                    const type = obj[e.path.toString() + ":type"];
                    if (type === "xsd:dateTime" && typeof v === "number")
                      v = new Date(v).toJSON();
                  }
                } else if (resource === "faults") {
                  if (e.path.toString() === "detail") v = yamlStringify(v);
                }

                if (typeof v === "string") v = `"${v.replace(/"/g, '""')}"`;
                if (v != null) return new Expression.Literal(v);
              }
              return new Expression.Literal(null);
            }).value;
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

    const filter = Expression.and(
      authorizer.getFilter(resource, 2),
      new Expression.Binary(
        "=",
        new Expression.Parameter(Path.parse(RESOURCE_IDS[resource])),
        new Expression.Literal(ctx.params.id),
      ),
    );

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

    const filter = Expression.and(
      authorizer.getFilter(resource, 2),
      new Expression.Binary(
        "=",
        new Expression.Parameter(Path.parse(RESOURCE_IDS[resource])),
        new Expression.Literal(ctx.params.id),
      ),
    );
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

      const filter = Expression.and(
        authorizer.getFilter(resource, 3),
        new Expression.Binary(
          "=",
          new Expression.Parameter(Path.parse(RESOURCE_IDS[resource])),
          new Expression.Literal(ctx.params.id),
        ),
      );
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

  const filter = Expression.and(
    authorizer.getFilter(resource, 2),
    new Expression.Binary(
      "=",
      new Expression.Parameter(Path.parse(RESOURCE_IDS[resource])),
      new Expression.Literal(ctx.params.id),
    ),
  );

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
  } catch {
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
    const filter = Expression.and(
      authorizer.getFilter("devices", 3),
      new Expression.Binary(
        "=",
        new Expression.Parameter(Path.parse(RESOURCE_IDS["devices"])),
        new Expression.Literal(ctx.params.id),
      ),
    );
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

  const now = Date.now();

  const onlineThreshold = getConfig(
    ctx.state.configSnapshot,
    "cwmp.deviceOnlineThreshold",
    4000,
    (exp) => {
      if (exp instanceof Expression.Literal) return exp;
      else if (exp instanceof Expression.Parameter) {
        const p = device[exp.path.toString()];
        if (p != null) return new Expression.Literal(p);
      } else if (exp instanceof Expression.FunctionCall) {
        if (exp.name === "NOW") return new Expression.Literal(now);
        if (exp.name === "REMOTE_ADDRESS") {
          for (const root of ["InternetGatewayDevice", "Device"]) {
            const p = device[`${root}.ManagementServer.ConnectionRequestURL`];
            if (p != null) return new Expression.Literal(new URL(p).hostname);
          }
        }
      }
      return new Expression.Literal(null);
    },
  );

  const lastInform = device["Events.Inform"] as number;

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

  const filter = Expression.and(
    authorizer.getFilter("devices", 3),
    new Expression.Binary(
      "=",
      new Expression.Parameter(Path.parse(RESOURCE_IDS["devices"])),
      new Expression.Literal(ctx.params.id),
    ),
  );
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
    const filter = Expression.and(
      authorizer.getFilter("users", 3),
      new Expression.Binary(
        "=",
        new Expression.Parameter(Path.parse(RESOURCE_IDS["users"])),
        new Expression.Literal(username),
      ),
    );
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
