"use strict";

const Koa = require("koa");
const Router = require("koa-router");
const koaStatic = require("koa-static");

const config = require("./config");
const api = require("./api");

const koa = new Koa();
const router = new Router();

router.use("/api", api.routes(), api.allowedMethods());

koa.use(router.routes());
koa.use(koaStatic("./public"));

koa.listen(config.PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Server listening on port ${config.PORT}`);
});
