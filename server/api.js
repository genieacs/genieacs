"use strict";

const Router = require("koa-router");

const apiFunctions = require("./api-functions");
const Filter = require("../common/filter");

const router = new Router();

const resources = {
  devices: true,
  presets: true,
  provisions: true,
  files: true,
  virtual_parameters: true,
  faults: true,
  tasks: false
};

for (let [resource, update] of Object.entries(resources)) {
  router.head(`/${resource}`, async (ctx, next) => {
    let filter, limit;
    if (ctx.request.query.filter) filter = new Filter(ctx.request.query.filter);
    if (ctx.request.query.limit) limit = +ctx.request.query.limit;

    if (!ctx.state.authorizer.hasAccess(resource, 1)) return next();

    // Exclude temporary tasks and faults
    if (resource === "tasks" || resource === "faults") {
      let f = new Filter(["NOT", ["<", "expiry", Date.now() + 60000]]);
      filter = f.and(filter);
    }

    let count = await apiFunctions.count(resource, filter, limit);
    ctx.set("X-Total-Count", count);
    ctx.body = "";
  });

  router.get(`/${resource}`, async (ctx, next) => {
    let filter, limit, skip;
    if (ctx.request.query.filter) filter = new Filter(ctx.request.query.filter);
    if (ctx.request.query.limit) limit = +ctx.request.query.limit;
    if (ctx.request.query.skip) skip = +ctx.request.query.skip;

    if (!ctx.state.authorizer.hasAccess(resource, 2)) return next();

    // Exclude temporary tasks and faults
    if (resource === "tasks" || resource === "faults") {
      let f = new Filter(["NOT", ["<", "expiry", Date.now() + 60000]]);
      filter = f.and(filter);
    }

    ctx.body = await apiFunctions.query(
      resource,
      filter,
      limit,
      skip,
      ctx.request.query.projection
    );
  });

  router.head(`/${resource}/:id`, async (ctx, next) => {
    let filter = new Filter(`DeviceID.ID = "${ctx.params.id}"`);
    if (!ctx.state.authorizer.hasAccess(resource, 2)) return next();

    let res = await apiFunctions.query(resource, filter);
    if (!res.length) return next();
    ctx.body = "";
  });

  router.get(`/${resource}/:id`, async (ctx, next) => {
    let filter = new Filter(`DeviceID.ID = "${ctx.params.id}"`);
    if (!ctx.state.authorizer.hasAccess(resource, 2)) return next();

    let res = await apiFunctions.query(resource, filter);
    if (!res.length) return next();
    ctx.body = res[0];
  });

  // TODO add PUT, PATCH routes
  if (update)
    router.delete(`/${resource}/:id`, async (ctx, next) => {
      const authorizer = ctx.state.authorizer;
      let filter = new Filter(`DeviceID.ID = "${ctx.params.id}"`);
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
  let filter = new Filter(`DeviceID.ID = "${ctx.params.id}"`);
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
  let filter = new Filter(`DeviceID.ID = "${ctx.params.id}"`);
  if (!authorizer.hasAccess("devices", 2)) return next();
  let res = await apiFunctions.query("devices", filter);
  if (!res.length) return next();

  const validate = authorizer.getValidator("devices", res[0]);
  if (!validate("tags", ctx.request.body)) return (ctx.status = 403);

  await apiFunctions.updateTags(ctx.params.id, ctx.request.body);
  ctx.body = "";
});

module.exports = router;
