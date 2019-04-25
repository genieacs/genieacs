import m, { RouteResolver } from "mithril";
import layout from "./layout";
import * as store from "./store";
import * as loginPage from "./login-page";
import * as overviewPage from "./overview-page";
import * as devicesPage from "./devices-page";
import * as devicePage from "./device-page";
import * as errorPage from "./error-page";
import * as faultsPage from "./faults-page";
import * as presetsPage from "./presets-page";
import * as provisionsPage from "./provisions-page";
import * as virtualParametersPage from "./virtual-parameters-page";
import * as filesPage from "./files-page";
import * as configPage from "./config-page";
import * as permissionsPage from "./permissions-page";
import * as usersPage from "./users-page";
import Authorizer from "../lib//common/authorizer";
import * as notifications from "./notifications";
import { contextifyComponent } from "./components";

declare global {
  interface Window {
    authorizer: Authorizer;
    permissionSets: any;
    username: string;
    clientConfig: any;
    configSnapshot: string;
  }
}

window.authorizer = new Authorizer(window.permissionSets);

const adminPages = [
  "presets",
  "provisions",
  "virtualParameters",
  "files",
  "config",
  "users",
  "permissions"
];

let state;

let lastRenderTimestamp = 0;
let pageVisitTimestamp = 0;
let fulfillTimeout = null;

function fulfill(): void {
  clearTimeout(fulfillTimeout);
  fulfillTimeout = setTimeout(() => {
    store.fulfill(lastRenderTimestamp, pageVisitTimestamp).then(updated => {
      if (updated) m.redraw();
    });
  }, 100);
}

function pagify(pageName, page): RouteResolver {
  const component: RouteResolver = {
    render: () => {
      lastRenderTimestamp = Date.now();
      let p;
      if (state && state.error) p = m(errorPage.component, state);
      else p = m(contextifyComponent(page.component), state);
      fulfill();
      const attrs = {};
      attrs["page"] = pageName;
      return m(layout, attrs, p);
    },
    onmatch: null
  };

  component.onmatch = (args, requestedPath) => {
    pageVisitTimestamp = Date.now();
    if (!page.init) {
      state = null;
      fulfill();
      return null;
    }

    return new Promise(resolve => {
      page
        .init(args)
        .then(st => {
          if (!st) return void m.route.set("/");
          state = st;
          resolve();
          fulfill();
        })
        .catch(err => {
          if (!window.username && err.message.indexOf("authorized") >= 0) {
            notifications.push("error", err.message);
            m.route.set("/login", { continue: requestedPath });
          }
          state = { error: err.message };
          resolve();
        });
    });
  };

  return component;
}

function redirectAdminPage(): RouteResolver {
  const component: RouteResolver = {
    onmatch: () => {
      for (const page of adminPages) {
        if (window.authorizer.hasAccess(page, 2)) {
          m.route.set(`/admin/${page}`);
          return null;
        }
      }
      return null;
    }
  };
  return component;
}

m.route(document.body, "/overview", {
  "/login": pagify("login", loginPage),
  "/overview": pagify("overview", overviewPage),
  "/devices": pagify("devices", devicesPage),
  "/devices/:id": pagify("devices", devicePage),
  "/faults": pagify("faults", faultsPage),
  "/admin": redirectAdminPage(),
  "/admin/presets": pagify("presets", presetsPage),
  "/admin/provisions": pagify("provisions", provisionsPage),
  "/admin/virtualParameters": pagify(
    "virtualParameters",
    virtualParametersPage
  ),
  "/admin/files": pagify("files", filesPage),
  "/admin/config": pagify("config", configPage),
  "/admin/users": pagify("users", usersPage),
  "/admin/permissions": pagify("permissions", permissionsPage)
});
