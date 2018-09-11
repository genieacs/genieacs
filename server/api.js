"use strict";

const zlib = require("zlib");
const Router = require("koa-router");
const config = require("./config");
const db = require("./db");
const apiFunctions = require("./api-functions");
const expression = require("../common/expression");
const logger = require("./logger");

const router = new Router();

function logUnauthorizedWarning(log) {
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
  virtual_parameters: "_id",
  faults: "_id",
  tasks: "_id"
};

const resources = {
  devices: 0 | RESOURCE_DELETE,
  presets: 0 | RESOURCE_DELETE | RESOURCE_PUT,
  provisions: 0 | RESOURCE_DELETE | RESOURCE_PUT,
  files: 0 | RESOURCE_DELETE,
  virtual_parameters: 0 | RESOURCE_DELETE,
  faults: 0 | RESOURCE_DELETE,
  tasks: 0
};

for (let [resource, flags] of Object.entries(resources)) {
  router.head(`/${resource}`, async (ctx, next) => {
    let filter = true;
    if (ctx.request.query.filter)
      filter = expression.parse(ctx.request.query.filter);

    const log = {
      message: `Count ${resource}`,
      context: ctx,
      filter: ctx.request.query.filter
    };

    if (!ctx.state.authorizer.hasAccess(resource, 1)) {
      logUnauthorizedWarning(log);
      return next();
    }

    // Exclude temporary tasks and faults
    if (resource === "tasks" || resource === "faults")
      filter = expression.and(filter, [
        "NOT",
        ["<", ["PARAM", "expiry"], Date.now() + 60000]
      ]);

    let count = await db.count(resource, filter);

    ctx.set("X-Total-Count", count);
    ctx.body = "";

    log.count = count;
    logger.accessInfo(log);
  });

  router.get(`/${resource}`, async (ctx, next) => {
    let options = {};
    let filter = true;
    if (ctx.request.query.filter)
      filter = expression.parse(ctx.request.query.filter);
    if (ctx.request.query.limit) options.limit = +ctx.request.query.limit;
    if (ctx.request.query.skip) options.skip = +ctx.request.query.skip;
    if (ctx.request.query.sort)
      options.sort = JSON.parse(ctx.request.query.sort);
    if (ctx.request.query.projection)
      options.projection = ctx.request.query.projection
        .split(",")
        .reduce((obj, k) => Object.assign(obj, { [k]: 1 }), {});

    const log = {
      message: `Query ${resource}`,
      context: ctx,
      filter: ctx.request.query.filter,
      limit: options.limit,
      skip: options.skip,
      sort: options.sort,
      projection: options.projection
    };

    if (!ctx.state.authorizer.hasAccess(resource, 2)) {
      logUnauthorizedWarning(log);
      return next();
    }

    // Exclude temporary tasks and faults
    if (resource === "tasks" || resource === "faults")
      filter = expression.and(filter, [
        "NOT",
        ["<", ["PARAM", "expiry"], Date.now() + 60000]
      ]);

    let stream;
    switch (ctx.acceptsEncodings("gzip", "deflate", "identity")) {
      case "gzip":
        stream = zlib.createGzip({ flush: zlib.constants.Z_SYNC_FLUSH });
        stream.pipe(ctx.res);
        ctx.set("Content-Encoding", "gzip");
        break;
      case "deflate":
        stream = zlib.createDeflate({ flush: zlib.constants.Z_SYNC_FLUSH });
        stream.pipe(ctx.res);
        ctx.set("Content-Encoding", "deflate");
        break;
      default:
        stream = ctx.res;
        break;
    }

    ctx.body = ctx.res;
    ctx.type = "application/json";

    let c = 0;
    stream.write("[\n");
    await db.query(resource, filter, options, obj => {
      stream.write((c++ ? "," : "") + JSON.stringify(obj) + "\n");
    });
    stream.end("]");

    logger.accessInfo(log);
  });

  // CSV download
  router.get(`/${resource}.csv`, async (ctx, next) => {
    let options = {};
    let filter = true;
    if (ctx.request.query.filter)
      filter = expression.parse(ctx.request.query.filter);
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
      sort: options.sort,
      projection: options.projection
    };

    if (!ctx.state.authorizer.hasAccess(resource, 2)) {
      logUnauthorizedWarning(log);
      return next();
    }

    const columns = JSON.parse(ctx.request.query.columns);
    const now = Date.now();
    for (let [k, v] of Object.entries(columns))
      columns[k] = expression.evaluate(
        expression.parse(v),
        null,
        now
      );

    // Exclude temporary tasks and faults
    if (resource === "tasks" || resource === "faults")
      filter = expression.and(filter, [
        "NOT",
        ["<", ["PARAM", "expiry"], Date.now() + 60000]
      ]);

    let stream;
    switch (ctx.acceptsEncodings("gzip", "deflate", "identity")) {
      case "gzip":
        stream = zlib.createGzip({ flush: zlib.constants.Z_SYNC_FLUSH });
        stream.pipe(ctx.res);
        ctx.set("Content-Encoding", "gzip");
        break;
      case "deflate":
        stream = zlib.createDeflate({ flush: zlib.constants.Z_SYNC_FLUSH });
        stream.pipe(ctx.res);
        ctx.set("Content-Encoding", "deflate");
        break;
      default:
        stream = ctx.res;
        break;
    }

    ctx.body = ctx.res;
    ctx.type = "text/csv";
    ctx.attachment(
      `${resource}-${new Date(now).toISOString().replace(/[:.]/g, "")}.csv`
    );

    stream.write(
      Object.keys(columns).map(k => `"${k.replace(/"/, '""')}"`) + "\n"
    );
    await db.query(resource, filter, options, obj => {
      let arr = Object.values(columns).map(exp => {
        let v = expression.evaluate(exp, obj, null, e => {
          if (Array.isArray(e))
            if (e[0] === "PARAM") {
              if (resource === "devices") {
                if (e[1] === "Tags") {
                  let tags = [];
                  for (let p in obj)
                    if (p.startsWith("Tags.")) tags.push(p.slice(5));

                  return tags.join(", ");
                }
              }
            } else if (e[0] === "FUNC") {
              if (e[1] === "DATE_STRING")
                if (e[2] && !Array.isArray(e[2]))
                  return new Date(e[2]).toISOString();
            }

          return e;
        });

        if (Array.isArray(v) || v == null) return "";
        if (typeof v === "string") return `"${v.replace(/"/g, '""')}"`;
        return v;
      });
      stream.write(arr.join(",") + "\n");
    });
    stream.end();

    logger.accessInfo(log);
  });

  router.head(`/${resource}/:id`, async (ctx, next) => {
    const log = {
      message: `Count ${resource}`,
      context: ctx,
      filter: `${RESOURCE_IDS[resource]} = "${ctx.params.id}"`
    };

    let filter = ["=", ["PARAM", RESOURCE_IDS[resource]], ctx.params.id];
    if (!ctx.state.authorizer.hasAccess(resource, 2)) {
      logUnauthorizedWarning(log);
      return next();
    }

    let res = await db.query(resource, filter);

    if (!res.length) return next();

    logger.accessInfo(log);
    ctx.body = "";
  });

  router.get(`/${resource}/:id`, async (ctx, next) => {
    const log = {
      message: `Query ${resource}`,
      context: ctx,
      filter: `${RESOURCE_IDS[resource]} = "${ctx.params.id}"`
    };

    let filter = ["=", ["PARAM", RESOURCE_IDS[resource]], ctx.params.id];
    if (!ctx.state.authorizer.hasAccess(resource, 2)) {
      logUnauthorizedWarning(log);
      return next();
    }

    let res = await db.query(resource, filter);

    if (!res.length) return next();

    logger.accessInfo(log);
    ctx.body = res[0];
  });

  // TODO add PUT, PATCH routes
  if (flags & RESOURCE_DELETE)
    router.delete(`/${resource}/:id`, async (ctx, next) => {
      const log = {
        message: `Delete ${resource}`,
        context: ctx,
        id: ctx.params.id
      };

      const authorizer = ctx.state.authorizer;
      let filter = ["=", ["PARAM", RESOURCE_IDS[resource]], ctx.params.id];
      if (!authorizer.hasAccess(resource, 2)) {
        logUnauthorizedWarning(log);
        return next();
      }
      let res = await db.query(resource, filter);
      if (!res.length) return next();

      const validate = authorizer.getValidator(resource, res[0]);
      if (!validate("delete")) {
        logUnauthorizedWarning(log);
        return (ctx.status = 403);
      }

      await apiFunctions.deleteResource(resource, ctx.params.id);

      logger.accessInfo(log);

      ctx.body = "";
    });

  if (flags & RESOURCE_PUT)
    router.put(`/${resource}/:id`, async (ctx, next) => {
      const id = ctx.params.id;

      const log = {
        message: `Put ${resource}`,
        context: ctx,
        id: id
      };

      const authorizer = ctx.state.authorizer;
      if (!authorizer.hasAccess(resource, 3)) {
        logUnauthorizedWarning(log);
        return next();
      }

      let obj = ctx.request.body;

      const validate = authorizer.getValidator(resource, obj);
      if (!validate("put")) {
        logUnauthorizedWarning(log);
        return (ctx.status = 403);
      }

      let err = await apiFunctions.putResource(resource, id, obj);

      if (err) {
        log.message += " failed";
        logger.accessWarn(log);
        ctx.body = err;
        return (ctx.status = 400);
      }

      logger.accessInfo(log);

      db.putAudit({
        username: ctx.state.user.username,
        action: "put",
        objectType: resource,
        objectId: id
      }).catch(err => {
        setTimeout(() => {
          throw err;
        }, 0);
      });

      ctx.body = "";
    });
}

router.post("/devices/:id/tasks", async (ctx, next) => {
  const log = {
    message: "Commit tasks",
    context: ctx,
    deviceId: ctx.params.id
  };

  const authorizer = ctx.state.authorizer;
  let filter = ["=", ["PARAM", "DeviceID.ID"], ctx.params.id];
  if (!authorizer.hasAccess("devices", 2)) {
    logUnauthorizedWarning(log);
    return next();
  }
  let devices = await db.query("devices", filter);
  if (!devices.length) return next();

  const validate = authorizer.getValidator("devices", devices[0]);
  for (let t of ctx.request.body)
    if (!validate("task", t)) {
      logUnauthorizedWarning(log);
      return (ctx.status = 403);
    }

  let res = await apiFunctions.postTasks(ctx.params.id, ctx.request.body);

  log.tasks = res.tasks.map(t => t._id).join(",");

  logger.accessInfo(log);

  ctx.set("Connection-Request", res.connectionRequest);
  ctx.body = res.tasks;
});

router.post("/devices/:id/tags", async (ctx, next) => {
  const log = {
    message: "Update tags",
    context: ctx,
    deviceId: ctx.params.id,
    tags: ctx.request.body
  };

  const authorizer = ctx.state.authorizer;
  let filter = ["=", ["PARAM", "DeviceID.ID"], ctx.params.id];
  if (!authorizer.hasAccess("devices", 2)) {
    logUnauthorizedWarning(log);
    return next();
  }
  let res = await db.query("devices", filter);
  if (!res.length) return next();

  const validate = authorizer.getValidator("devices", res[0]);
  if (!validate("tags", ctx.request.body)) {
    logUnauthorizedWarning(log);
    return (ctx.status = 403);
  }

  await apiFunctions.updateTags(ctx.params.id, ctx.request.body);

  logger.accessInfo(log);

  ctx.body = "";
});

router.get("/ping/:host", async ctx => {
  ctx.body = await apiFunctions.ping(ctx.params.host);
});

module.exports = router;
