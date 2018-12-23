"use strict";

const Koa = require("koa");
const Router = require("koa-router");
const koaStatic = require("koa-static");
const koaCompress = require("koa-compress");
const koaBody = require("koa-body");

const config = require("./config");
const api = require("./api");

const koa = new Koa();
const router = new Router();

koa.use(koaBody());
router.use("/api", api.routes(), api.allowedMethods());

router.get("/", async ctx => {
  ctx.body = `
  <html>
    <head>
      <title>GenieACS</title>
      <link rel="shortcut icon" type="image/png" href="favicon.png" />
      <link rel="stylesheet" href="app.css">
    </head>
    <body>
      <script>
        window.clientConfig = ${JSON.stringify(config.getClientConfig())};
      </script>
      <script src="app.js"></script>
    </body>
  </html>
  `;
});

koa.use(
  koaCompress({
    flush: require("zlib").Z_SYNC_FLUSH
  })
);
koa.use(router.routes());
koa.use(koaStatic("./public"));

koa.listen(config.get("server.port"), () => {
  // eslint-disable-next-line no-console
  console.log(`Server listening on port ${config.get("server.port")}`);
});
