"use strict";

const Koa = require("koa");
const Router = require("koa-router");
const koaStatic = require("koa-static");
const koaCompress = require("koa-compress");
const koaBodyParser = require("koa-bodyparser");
const koaJwt = require("koa-jwt");
const jwt = require("jsonwebtoken");

const config = require("./config");
const api = require("./api");
const Authorizer = require("../common/authorizer");
const expression = require("../common/expression");
const logger = require("./logger");

const koa = new Koa();
const router = new Router();

const JWT_SECRET = config.server.jwtSecret;
const JWT_COOKIE = "genieacs-ui-jwt";

const VERSION = require("../package.json")["version"];

logger.info({
  message: "GenieACS UI starting",
  pid: process.pid,
  version: VERSION
});

function getPermissionSets(roles) {
  const allPermissions = config.permissions;
  const permissionSets = roles.map(role => {
    return Object.values(allPermissions[role] || {}).map(p => {
      p = Object.assign({}, p);
      for (let [k, v] of Object.entries(p)) {
        p[k] = v = Object.assign({}, v);
        if (
          [
            "devices",
            "faults",
            "presets",
            "files"
          ].includes(k)
        )
          if (v.filter == null || v.filter === "") v.filter = true;
          else {
            v.filter = expression.parse(v.filter);
          }
      }
      return p;
    });
  });
  return permissionSets;
}

koa.use(
  koaJwt({
    secret: JWT_SECRET,
    passthrough: true,
    cookie: JWT_COOKIE
  })
);

koa.use(async (ctx, next) => {
  if (ctx.state.user && ctx.state.user.roles)
    ctx.state.authorizer = new Authorizer(
      getPermissionSets(ctx.state.user.roles)
    );
  else ctx.state.authorizer = new Authorizer([]);

  return next();
});

router.post("/login", async ctx => {
  const username = ctx.request.body.username;
  const password = ctx.request.body.password;

  const user = config.auth.simple.users[username];

  let log = {
    message: "Log in",
    context: ctx,
    username: username
  };

  if (!user || user.password !== password) {
    ctx.status = 400;
    ctx.body = "Incorrect username or password";
    log.message += " - invalid credentials";
    logger.accessWarn(log);
    return;
  }

  let token = jwt.sign(
    { username: username, roles: user.roles.split(",") },
    JWT_SECRET
  );
  ctx.cookies.set(JWT_COOKIE, token);
  ctx.body = JSON.stringify(token);

  logger.accessInfo(log);
});

router.post("/logout", async ctx => {
  ctx.cookies.set(JWT_COOKIE); // Delete cookie
  ctx.body = "";

  logger.accessInfo({
    message: "Log out",
    context: ctx
  });
});

koa.use(koaBodyParser());
router.use("/api", api.routes(), api.allowedMethods());

router.get("/", async ctx => {
  let permissionSets = [];
  if (ctx.state.user && ctx.state.user.roles)
    permissionSets = getPermissionSets(ctx.state.user.roles);

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
        window.username = ${JSON.stringify(
          ctx.state.user ? ctx.state.user.username : ""
        )};
        window.permissionSets = ${JSON.stringify(permissionSets)};
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

koa.listen(config.server.port, "0.0.0.0", () => {
  logger.info({
    message: "Worker litening",
    port: config.server.port,
    pid: process.pid
  });
});
