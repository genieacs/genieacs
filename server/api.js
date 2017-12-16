"use strict";

const Router = require("koa-router");

const apiFunctions = require("./api-functions");

const router = new Router();

const resources = {
  devices: false,
  presets: true,
  provisions: true,
  files: true,
  virtual_parameters: true
};

for (let [resource, update] of Object.entries(resources)) {
  router.head(`/${resource}`, async ctx => {
    let filter, limit;
    if (ctx.request.query.filter)
      if (Array.isArray(ctx.request.query.filter))
        filter = ctx.request.query.query.map(q => JSON.parse(q));
      else {
        filter = JSON.parse(ctx.request.query.filter);
        if (!Array.isArray(filter)) filter = [filter];
      }

    if (ctx.request.query.limit) limit = +ctx.request.query.limit;

    let count = await apiFunctions.count(resource, filter, limit);
    ctx.set("X-Total-Count", count);
    ctx.body = "";
  });

  router.get(`/${resource}`, async ctx => {
    let filter, limit;
    if (ctx.request.query.filter)
      if (Array.isArray(ctx.request.query.filter))
        filter = ctx.request.query.query.map(q => JSON.parse(q));
      else {
        filter = JSON.parse(ctx.request.query.filter);
        if (!Array.isArray(filter)) filter = [filter];
      }

    if (ctx.request.query.limit) limit = +ctx.request.query.limit;

    ctx.body = await apiFunctions.query(resource, filter, limit);
  });

  router.head(`/${resource}/:id`, async (ctx, next) => {
    let filter = { _id: ctx.params.id };
    let res = await apiFunctions.query(resource, filter);
    if (!res.length) return next();
    ctx.body = "";
  });

  router.get(`/${resource}/:id`, async (ctx, next) => {
    let filter = { _id: ctx.params.id };
    let res = await apiFunctions.query(resource, filter);
    if (!res.length) return next();
    ctx.body = res[0];
  });

  if (update) {
    // TODO add PUT, PATCH, DELETE routes
  }
}

module.exports = router;
