"use strict";

const Koa = require("koa");
const Router = require("koa-router");
const koaStatic = require("koa-static");
const koaCompress = require("koa-compress");
const koaBodyParser = require("koa-bodyparser");
const koaJwt = require("koa-jwt");
const jwt = require("jsonwebtoken");

const config = require("./ui/config");
const api = require("./ui/api");
const Authorizer = require("./common/authorizer");
const expression = require("./common/expression");
const logger = require("./logger");

const koa = new Koa();
const router = new Router();

const JWT_SECRET = config.server.jwtSecret;
const JWT_COOKIE = "genieacs-ui-jwt";

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
            "provisions",
            "virtualParameters",
            "files"
          ].includes(k)
        ) {
          if (v.filter == null || v.filter === "") v.filter = true;
          else v.filter = expression.parse(v.filter);
        }
      }
      return p;
    });
  });
  return permissionSets;
}

function authSimple(username, password) {
  const user = config.auth.simple.users[username];
  if (user && user.password === password) {
    const roles = user.roles.split(",").map(s => s.trim());
    return Promise.resolve(roles);
  }
  return Promise.resolve(null);
}

koa.on("error", async err => {
  throw err;
});

koa.use(
  koaJwt({
    secret: JWT_SECRET,
    passthrough: true,
    cookie: JWT_COOKIE
  })
);

koa.use(async (ctx, next) => {
  if (ctx.state.user && ctx.state.user.roles) {
    ctx.state.authorizer = new Authorizer(
      getPermissionSets(ctx.state.user.roles)
    );
  } else {
    ctx.state.authorizer = new Authorizer([]);
  }

  return next();
});

router.post("/login", async ctx => {
  const username = ctx.request.body.username;
  const password = ctx.request.body.password;

  const log = {
    message: "Log in",
    context: ctx,
    username: username
  };

  function success(roles, method) {
    log.method = method;
    const token = jwt.sign({ username, roles }, JWT_SECRET);
    ctx.cookies.set(JWT_COOKIE, token);
    ctx.body = JSON.stringify(token);
    logger.accessInfo(log);
  }

  function failure() {
    ctx.status = 400;
    ctx.body = "Incorrect username or password";
    log.message += " failed";
    logger.accessWarn(log);
  }

  const roles = await authSimple(username, password);

  if (roles) return void success(roles, "simple");

  failure();
});

router.post("/logout", async ctx => {
  ctx.cookies.set(JWT_COOKIE); // Delete cookie
  ctx.body = "";

  logger.accessInfo({
    message: "Log out",
    context: ctx
  });
});

koa.use(async (ctx, next) => {
  if (ctx.request.type === "application/octet-stream")
    ctx.disableBodyParser = true;

  return next();
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

exports.listener = koa.callback();
