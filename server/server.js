"use strict";

const http = require("http");
const cluster = require("cluster");
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
const db = require("./db");

const VERSION = require("../package.json")["version"];
logger.init("server", VERSION);

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

  let log = {
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

  let roles;
  roles = await authSimple(username, password);

  if (roles) return success(roles, "simple");

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

let server = http
  .createServer(koa.callback())
  .listen(config.server.port, config.server.interface);

function closeServer(timeout) {
  return new Promise(resolve => {
    setTimeout(() => {
      if (!resolve) return;
      // Ignore HTTP requests from alive connections
      server.removeListener("request", koa.callback());
      server.setTimeout(1);

      setTimeout(resolve, 1000);
    }, timeout).unref();

    // prevent new sockets to connect and close server eventually.
    server.close(resolve);
  });
}

function exit() {
  setTimeout(() => {
    process.exit(1);
  }, 30000).unref();

  closeServer(20000).then(() => {
    db.disconnect();
    if (cluster.worker) cluster.worker.disconnect();
    logger.close();
  });
}

process.on("unhandledRejection", err => {
  throw err;
});

process.on("uncaughtException", err => {
  logger.error({
    message: "Uncaught exception",
    exception: err,
    pid: process.pid
  });
  process.exitCode = 1;
  exit();
});

process.on("SIGINT", exit);
process.on("SIGTERM", exit);
