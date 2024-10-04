import { constants } from "node:zlib";
import Koa from "koa";
import Router from "@koa/router";
import * as jwt from "jsonwebtoken";
import koaSend from "koa-send";
import koaCompress from "koa-compress";
import koaBodyParser from "@koa/bodyparser";
import koaJwt from "koa-jwt";
import * as config from "./config.ts";
import api from "./ui/api.ts";
import Authorizer from "./common/authorizer.ts";
import * as logger from "./logger.ts";
import * as localCache from "./ui/local-cache.ts";
import { PermissionSet } from "./types.ts";
import { authLocal } from "./api-functions.ts";
import * as init from "./init.ts";
import { version as VERSION } from "../package.json";
import memoize from "./common/memoize.ts";
import { APP_JS, APP_CSS, FAVICON_PNG } from "../build/assets.ts";

const koa = new Koa();
const router = new Router();

const JWT_SECRET = "" + config.get("UI_JWT_SECRET");
const JWT_COOKIE = "genieacs-ui-jwt";

const getAuthorizer = memoize(
  (snapshot: string, rolesStr: string): Authorizer => {
    const roles: string[] = JSON.parse(rolesStr);
    const allPermissions = localCache.getPermissions(snapshot);
    const permissionSets: PermissionSet[] = roles.map((r) =>
      Object.values(allPermissions[r] || {}),
    );
    return new Authorizer(permissionSets);
  },
);

koa.on("error", (err, ctx) => {
  setTimeout(() => {
    // Ignored errors resulting from aborted requests
    if (ctx?.req.aborted) return;

    // Ignore client errors (e.g. malicious path)
    if (err.status === 400) return;

    throw err;
  });
});

koa.use(async (ctx, next) => {
  const configSnapshot = await localCache.getRevision();
  ctx.state.configSnapshot = configSnapshot;
  ctx.set("X-Config-Snapshot", configSnapshot);
  ctx.set("GenieACS-Version", VERSION);
  return next();
});

koa.use(
  koaJwt({
    secret: JWT_SECRET,
    passthrough: true,
    cookie: JWT_COOKIE,
    isRevoked: async (ctx, token) => {
      if (token["authMethod"] === "local") {
        return !localCache.getUsers(ctx.state.configSnapshot)[
          token["username"]
        ];
      }

      return true;
    },
  }),
);

koa.use(async (ctx, next) => {
  let roles: string[] = [];

  if (ctx.state.user?.username) {
    let user;
    if (ctx.state.user.authMethod === "local") {
      user = localCache.getUsers(ctx.state.configSnapshot)[
        ctx.state.user.username
      ];
    } else {
      throw new Error("Invalid auth method");
    }
    roles = user.roles || [];
  }

  ctx.state.authorizer = getAuthorizer(
    ctx.state.configSnapshot,
    JSON.stringify(roles),
  );

  return next();
});

router.post("/login", async (ctx) => {
  if (!JWT_SECRET) {
    ctx.status = 500;
    ctx.body = "UI_JWT_SECRET is not set";
    logger.error({ message: "UI_JWT_SECRET is not set" });
    return;
  }

  const username = ctx.request.body.username;
  const password = ctx.request.body.password;

  const log = {
    message: "Log in",
    context: ctx,
    username: username,
    method: null,
  };

  function success(authMethod): void {
    log.method = authMethod;
    const token = jwt.sign({ username, authMethod }, JWT_SECRET);
    ctx.cookies.set(JWT_COOKIE, token, { sameSite: "lax" });
    ctx.body = JSON.stringify(token);
    logger.accessInfo(log);
  }

  function failure(): void {
    ctx.status = 400;
    ctx.body = "Incorrect username or password";
    log.message += " failed";
    logger.accessWarn(log);
  }

  if (await authLocal(ctx.state.configSnapshot, username, password))
    return void success("local");

  failure();
});

router.post("/logout", async (ctx) => {
  ctx.cookies.set(JWT_COOKIE); // Delete cookie
  ctx.body = "";

  logger.accessInfo({
    message: "Log out",
    context: ctx,
  });
});

koa.use(async (ctx, next) => {
  if (ctx.request.type === "application/octet-stream")
    ctx.disableBodyParser = true;

  return next();
});

koa.use(koaBodyParser());
router.use("/api", api.routes(), api.allowedMethods());

router.get("/status", (ctx) => {
  ctx.body = "OK";
});

router.get("/init", async (ctx) => {
  const status = await init.getStatus();
  if (Object.keys(localCache.getUsers(ctx.state.configSnapshot)).length) {
    if (!ctx.state.authorizer.hasAccess("users", 3)) status["users"] = false;
    if (!ctx.state.authorizer.hasAccess("permissions", 3))
      status["users"] = false;
    if (!ctx.state.authorizer.hasAccess("config", 3)) {
      status["filters"] = false;
      status["device"] = false;
      status["index"] = false;
      status["overview"] = false;
    }
    if (!ctx.state.authorizer.hasAccess("presets", 3))
      status["presets"] = false;
    if (!ctx.state.authorizer.hasAccess("provisions", 3))
      status["presets"] = false;
  }

  ctx.body = status;
});

router.post("/init", async (ctx) => {
  const status = ctx.request.body;
  if (Object.keys(localCache.getUsers(ctx.state.configSnapshot)).length) {
    if (!ctx.state.authorizer.hasAccess("users", 3)) status["users"] = false;
    if (!ctx.state.authorizer.hasAccess("permissions", 3))
      status["users"] = false;
    if (!ctx.state.authorizer.hasAccess("config", 3)) {
      status["filters"] = false;
      status["device"] = false;
      status["index"] = false;
      status["overview"] = false;
    }
    if (!ctx.state.authorizer.hasAccess("presets", 3))
      status["presets"] = false;
    if (!ctx.state.authorizer.hasAccess("provisions", 3))
      status["presets"] = false;
  }
  await init.seed(status);
  ctx.body = "";
});

router.get("/", async (ctx) => {
  // koa-router seems to tolerate double slashes in the URL but that can
  // be problematic when using relatives asset paths in HTML
  if (ctx.path.endsWith("//")) return;

  const permissionSets: PermissionSet[] =
    ctx.state.authorizer.getPermissionSets();

  let wizard = "";
  if (!Object.keys(localCache.getUsers(ctx.state.configSnapshot)).length)
    wizard = '<script>window.location.hash = "#!/wizard";</script>';

  ctx.body = `<!DOCTYPE html>
  <html>
    <head>
      <title>GenieACS</title>
      <link rel="shortcut icon" type="image/png" href="${FAVICON_PNG}" />
      <link rel="stylesheet" href="${APP_CSS}">
    </head>
    <body>
    <noscript>GenieACS UI requires JavaScript to work. Please enable JavaScript in your browser.</noscript>
      <script>
        window.clientConfig = ${JSON.stringify({
          ui: localCache.getUiConfig(ctx.state.configSnapshot),
        })};
        window.configSnapshot = ${JSON.stringify(ctx.state.configSnapshot)};
        window.genieacsVersion = ${JSON.stringify(VERSION)};
        window.username = ${JSON.stringify(
          ctx.state.user ? ctx.state.user.username : "",
        )};
        window.permissionSets = ${JSON.stringify(permissionSets)};
      </script>
      <script type="module" src="${APP_JS}"></script>${wizard} 
    </body>
  </html>
  `;
});

koa.use(
  koaCompress({
    gzip: {
      flush: constants.Z_SYNC_FLUSH,
    },
    deflate: {
      flush: constants.Z_SYNC_FLUSH,
    },
    br: {
      flush: constants.BROTLI_OPERATION_FLUSH,
      params: {
        [constants.BROTLI_PARAM_QUALITY]: 5,
      },
    },
  }),
);

koa.use(router.routes());
koa.use(async (ctx, next) => {
  await next();
  if (ctx.method !== "HEAD" && ctx.method !== "GET") return;
  if (ctx.body != null || ctx.status !== 404) return;
  if (/(?:^|[\\/])\.\.(?:[\\/]|$)/.test(ctx.path)) return;

  try {
    await koaSend(ctx, ctx.path, { root: config.ROOT_DIR + "/public" });
  } catch (err) {
    if (err.status !== 404) throw err;
  }
});

export const listener = koa.callback();
