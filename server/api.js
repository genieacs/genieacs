"use strict";

const Router = require("koa-router");

const apiFunctions = require("./api-functions");
const Filter = require("../common/filter");

const router = new Router();

const resources = {
  devices: false,
  presets: true,
  provisions: true,
  files: true,
  virtual_parameters: true,
  tasks: false
};

for (let [resource, update] of Object.entries(resources)) {
  router.head(`/${resource}`, async ctx => {
    let filter, limit;
    if (ctx.request.query.filter) filter = new Filter(ctx.request.query.filter);
    if (ctx.request.query.limit) limit = +ctx.request.query.limit;

    let count = await apiFunctions.count(resource, filter, limit);
    ctx.set("X-Total-Count", count);
    ctx.body = "";
  });

  router.get(`/${resource}`, async ctx => {
    let filter, limit, skip;
    if (ctx.request.query.filter) filter = new Filter(ctx.request.query.filter);
    if (ctx.request.query.limit) limit = +ctx.request.query.limit;
    if (ctx.request.query.skip) skip = +ctx.request.query.skip;

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
    let res = await apiFunctions.query(resource, filter);
    if (!res.length) return next();
    ctx.body = "";
  });

  router.get(`/${resource}/:id`, async (ctx, next) => {
    let filter = new Filter(`DeviceID.ID = "${ctx.params.id}"`);
    let res = await apiFunctions.query(resource, filter);
    if (!res.length) return next();
    ctx.body = res[0];
  });

  if (update) {
    // TODO add PUT, PATCH, DELETE routes
  }
}

router.post("/devices/:id/tasks", async ctx => {
  let res = await apiFunctions.postTasks(ctx.params.id, ctx.request.body);
  // TODO 404 if no such device
  ctx.set("Connection-Request", res.connectionRequest);
  ctx.body = res.tasks;
});

module.exports = router;
