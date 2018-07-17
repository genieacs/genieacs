"use strict";

const Router = require("koa-router");

const db = require("./db");
const apiFunctions = require("./api-functions");
const expression = require("../common/expression");

const router = new Router();

const RESOURCE_DELETE = 1 << 0;
const RESOURCE_DB = 1 << 1;

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
  presets: 0 | RESOURCE_DELETE,
  provisions: 0 | RESOURCE_DELETE,
  files: 0 | RESOURCE_DELETE,
  virtual_parameters: 0 | RESOURCE_DELETE,
  faults: 0 | RESOURCE_DELETE,
  tasks: 0
};

for (let [resource, flags] of Object.entries(resources)) {
  router.head(`/${resource}`, async (ctx, next) => {
    let filter = true;
    let limit;
    if (ctx.request.query.filter)
      filter = expression.parse(ctx.request.query.filter);
    if (ctx.request.query.limit) limit = +ctx.request.query.limit;

    if (!ctx.state.authorizer.hasAccess(resource, 1)) return next();

    // Exclude temporary tasks and faults
    if (resource === "tasks" || resource === "faults")
      filter = expression.and(filter, [
        "NOT",
        ["<", ["PARAM", "expiry"], Date.now() + 60000]
      ]);

    let count;
    if (flags & RESOURCE_DB) count = await db.count(resource, filter, limit);
    else count = await apiFunctions.count(resource, filter, limit);

    ctx.set("X-Total-Count", count);
    ctx.body = "";
  });

  router.get(`/${resource}`, async (ctx, next) => {
    let filter = true;
    let limit, skip, projection;
    if (ctx.request.query.filter)
      filter = expression.parse(ctx.request.query.filter);
    if (ctx.request.query.limit) limit = +ctx.request.query.limit;
    if (ctx.request.query.skip) skip = +ctx.request.query.skip;
    if (ctx.request.query.projection) projection = ctx.request.query.projection;

    if (!ctx.state.authorizer.hasAccess(resource, 2)) return next();

    // Exclude temporary tasks and faults
    if (resource === "tasks" || resource === "faults")
      filter = expression.and(filter, [
        "NOT",
        ["<", ["PARAM", "expiry"], Date.now() + 60000]
      ]);

    let res;
    if (flags & RESOURCE_DB)
      res = await db.query(resource, filter, limit, skip);
    else
      res = await apiFunctions.query(resource, filter, limit, skip, projection);

    ctx.body = res;
  });

  router.head(`/${resource}/:id`, async (ctx, next) => {
    let filter = ["=", ["PARAM", RESOURCE_IDS[resource]], ctx.params.id];
    if (!ctx.state.authorizer.hasAccess(resource, 2)) return next();

    let res;
    if (flags & RESOURCE_DB) res = await db.query(resource, filter);
    else res = await apiFunctions.query(resource, filter);

    if (!res.length) return next();
    ctx.body = "";
  });

  router.get(`/${resource}/:id`, async (ctx, next) => {
    let filter = ["=", ["PARAM", RESOURCE_IDS[resource]], ctx.params.id];
    if (!ctx.state.authorizer.hasAccess(resource, 2)) return next();

    let res;
    if (flags & RESOURCE_DB) res = await db.query(resource, filter);
    else res = await apiFunctions.query(resource, filter);
    if (!res.length) return next();
    ctx.body = res[0];
  });

  // TODO add PUT, PATCH routes
  if (flags & RESOURCE_DELETE && !(flags & RESOURCE_DB))
    router.delete(`/${resource}/:id`, async (ctx, next) => {
      const authorizer = ctx.state.authorizer;
      let filter = ["=", ["PARAM", RESOURCE_IDS[resource]], ctx.params.id];
      if (!authorizer.hasAccess(resource, 2)) return next();
      let res = await apiFunctions.query(resource, filter);
      if (!res.length) return next();

      const validate = authorizer.getValidator(resource, res[0]);
      if (!validate("delete")) return (ctx.status = 403);

      await apiFunctions.deleteResource(resource, ctx.params.id);
      ctx.body = "";
    });
}

router.post("/devices/:id/tasks", async (ctx, next) => {
  const authorizer = ctx.state.authorizer;
  let filter = ["=", ["PARAM", "DeviceID.ID"], ctx.params.id];
  if (!authorizer.hasAccess("devices", 2)) return next();
  let devices = await apiFunctions.query("devices", filter);
  if (!devices.length) return next();

  const validate = authorizer.getValidator("devices", devices[0]);
  for (let t of ctx.request.body)
    if (!validate("task", t)) return (ctx.status = 403);

  let res = await apiFunctions.postTasks(ctx.params.id, ctx.request.body);
  ctx.set("Connection-Request", res.connectionRequest);
  ctx.body = res.tasks;
});

router.post("/devices/:id/tags", async (ctx, next) => {
  const authorizer = ctx.state.authorizer;
  let filter = ["=", ["PARAM", "DeviceID.ID"], ctx.params.id];
  if (!authorizer.hasAccess("devices", 2)) return next();
  let res = await apiFunctions.query("devices", filter);
  if (!res.length) return next();

  const validate = authorizer.getValidator("devices", res[0]);
  if (!validate("tags", ctx.request.body)) return (ctx.status = 403);

  await apiFunctions.updateTags(ctx.params.id, ctx.request.body);
  ctx.body = "";
});

router.get("/ping/:host", async ctx => {
  ctx.body = await apiFunctions.ping(ctx.params.host);
});

module.exports = router;
