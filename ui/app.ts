import m, { RouteResolver } from "mithril";
import layout from "./layout.ts";
import * as store from "./store.ts";
import * as wizardPage from "./wizard-page.ts";
import * as loginPage from "./login-page.ts";
import * as overviewPage from "./overview-page.ts";
import * as devicesPage from "./devices-page.ts";
import * as devicePage from "./device-page.ts";
import * as errorPage from "./error-page.ts";
import * as faultsPage from "./faults-page.ts";
import * as presetsPage from "./presets-page.ts";
import * as provisionsPage from "./provisions-page.ts";
import * as virtualParametersPage from "./virtual-parameters-page.ts";
import * as filesPage from "./files-page.ts";
import * as configPage from "./config-page.ts";
import * as permissionsPage from "./permissions-page.ts";
import * as usersPage from "./users-page.ts";
import Authorizer from "../lib//common/authorizer.ts";
import * as notifications from "./notifications.ts";
import { contextifyComponent } from "./components.ts";
import { PermissionSet, UiConfig } from "../lib/types.ts";

declare global {
  interface Window {
    authorizer: Authorizer;
    permissionSets: PermissionSet[];
    username: string;
    clientConfig: { ui: UiConfig };
    configSnapshot: string;
    genieacsVersion: string;
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
  "permissions",
];

let state;

function pagify(pageName, page): RouteResolver {
  const component: RouteResolver = {
    render: () => {
      const lastRenderTimestamp = Date.now();
      let p;
      if (state?.error) p = m(errorPage.component, state);
      else p = m(contextifyComponent(page.component), state);
      const attrs = {};
      attrs["page"] = pageName;
      attrs["oncreate"] = attrs["onupdate"] = () => {
        store.fulfill(lastRenderTimestamp);
      };
      return m(layout, attrs, p);
    },
    onmatch: null,
  };

  component.onmatch = (args, requestedPath) => {
    store.setTimestamp(Date.now());
    if (!page.init) {
      state = null;
      return null;
    }

    return new Promise<void>((resolve) => {
      page
        .init(args)
        .then((st) => {
          if (!st) return void m.route.set("/");
          state = st;
          resolve();
        })
        .catch((err) => {
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
    },
  };
  return component;
}

m.route(document.body, "/overview", {
  "/wizard": pagify("wizard", wizardPage),
  "/login": pagify("login", loginPage),
  "/overview": pagify("overview", overviewPage),
  "/devices": pagify("devices", devicesPage),
  "/devices/:id": pagify("devices", devicePage),
  "/devices/:id/:tab": pagify("devices", devicePage),
  "/faults": pagify("faults", faultsPage),
  "/admin": redirectAdminPage(),
  "/admin/presets": pagify("presets", presetsPage),
  "/admin/provisions": pagify("provisions", provisionsPage),
  "/admin/virtualParameters": pagify(
    "virtualParameters",
    virtualParametersPage,
  ),
  "/admin/files": pagify("files", filesPage),
  "/admin/config": pagify("config", configPage),
  "/admin/users": pagify("users", usersPage),
  "/admin/permissions": pagify("permissions", permissionsPage),
});
