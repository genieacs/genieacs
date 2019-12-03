/**
 * Copyright 2013-2019  GenieACS Inc.
 *
 * This file is part of GenieACS.
 *
 * GenieACS is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * GenieACS is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with GenieACS.  If not, see <http://www.gnu.org/licenses/>.
 */

import { Z_SYNC_FLUSH } from "zlib";
import Koa from "koa";
import Router from "koa-router";
import * as jwt from "jsonwebtoken";
import koaStatic from "koa-static";
import koaCompress from "koa-compress";
import koaBodyParser from "koa-bodyparser";
import koaJwt from "koa-jwt";
import * as config from "./config";
import api from "./ui/api";
import Authorizer from "./common/authorizer";
import * as logger from "./logger";
import * as localCache from "./local-cache";
import { PermissionSet } from "./types";
import { authLocal } from "./ui/api-functions";
import * as init from "./init";
import { version as VERSION } from "../package.json";
import memoize from "./common/memoize";

declare module "koa" {
  interface Request {
    body: any;
  }
}

const koa = new Koa();
const router = new Router();

const JWT_SECRET = "" + config.get("UI_JWT_SECRET");
const JWT_COOKIE = "genieacs-ui-jwt";

const getAuthorizer = memoize(
  (snapshot: string, rolesStr: string): Authorizer => {
    const roles: string[] = JSON.parse(rolesStr);
    const allPermissions = localCache.getPermissions(snapshot);
    const permissionSets: PermissionSet[] = roles.map(r =>
      Object.values(allPermissions[r] || {})
    );
    return new Authorizer(permissionSets);
  }
);

koa.on("error", async err => {
  throw err;
});

koa.use(async (ctx, next) => {
  const configSnapshot = await localCache.getCurrentSnapshot();
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
    }
  })
);

koa.use(async (ctx, next) => {
  let roles: string[] = [];

  if (ctx.state.user && ctx.state.user.username) {
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
    JSON.stringify(roles)
  );

  return next();
});

router.post("/login", async ctx => {
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
    method: null
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

router.get("/status", ctx => {
  ctx.body = "OK";
});

router.get("/init", async ctx => {
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

router.post("/init", async ctx => {
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

router.get("/", async ctx => {
  const permissionSets: PermissionSet[] = ctx.state.authorizer.getPermissionSets();

  let wizard = "";
  if (!Object.keys(localCache.getUsers(ctx.state.configSnapshot)).length)
    wizard = '<script>window.location.hash = "#!/wizard";</script>';

  ctx.body = `
  <html>
    <head>
      <title>GenieACS</title>
      <link rel="shortcut icon" type="image/png" href="favicon.png" />
      <link rel="stylesheet" href="app.css">
    </head>
    <body>
    <noscript>GenieACS UI requires JavaScript to work. Please enable JavaScript in your browser.</noscript>
      <script>
        window.clientConfig = ${JSON.stringify({
          ui: localCache.getUiConfig(ctx.state.configSnapshot)
        })};
        window.configSnapshot = ${JSON.stringify(ctx.state.configSnapshot)};
        window.genieacsVersion = ${JSON.stringify(VERSION)};
        window.username = ${JSON.stringify(
          ctx.state.user ? ctx.state.user.username : ""
        )};
        window.permissionSets = ${JSON.stringify(permissionSets)};
      </script>
      <script src="app.js"></script>${wizard} 
    </body>
  </html>
  `;
});

koa.use(
  koaCompress({
    flush: Z_SYNC_FLUSH
  })
);

koa.use(router.routes());
koa.use(koaStatic(config.ROOT_DIR + "/public"));

export const listener = koa.callback();
