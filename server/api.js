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
    let filters, limit;
    if (ctx.request.query.query)
      if (Array.isArray(ctx.request.query.query))
        filters = ctx.request.query.query.map(q => JSON.parse(q));
      else {
        filters = JSON.parse(ctx.request.query.query);
        if (!Array.isArray(filters)) filters = [filters];
      }

    if (ctx.request.query.limit) limit = +ctx.request.query.limit;

    let res = await apiFunctions.query(resource, filters, limit);
    ctx.set("X-Total-Count", res.length);
    ctx.body = "";
  });

  router.get(`/${resource}`, async ctx => {
    let filters, limit;
    if (ctx.request.query.query)
      if (Array.isArray(ctx.request.query.query))
        filters = ctx.request.query.query.map(q => JSON.parse(q));
      else {
        filters = JSON.parse(ctx.request.query.query);
        if (!Array.isArray(filters)) filters = [filters];
      }

    if (ctx.request.query.limit) limit = +ctx.request.query.limit;

    ctx.body = await apiFunctions.query(resource, filters, limit);
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
