import m, { RouteResolver } from "mithril";
import layout from "./layout.tsx";
import * as store from "./store.ts";
import * as wizardPage from "./wizard-page.ts";
import * as loginPage from "./login-page.tsx";
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
import { contextifyComponent } from "./components.ts";
import { PermissionSet, UiConfig } from "../lib/types.ts";
import drawerComponent from "./drawer-component.ts";
import { render as renderOverlay } from "./overlay.ts";
import Expression from "../lib/common/expression.ts";

declare global {
  interface Window {
    authorizer: Authorizer;
    permissionSets: {
      [resource: string]: { access: number; validate: string; filter: string };
    }[][];
    username: string;
    clientConfig: UiConfig;
    configSnapshot: string;
    genieacsVersion: string;
  }
}

const permissionSets: PermissionSet[] = window.permissionSets.map((p) =>
  p.map((s) =>
    Object.fromEntries(
      Object.entries(s).map(([resource, { access, validate, filter }]) => [
        resource,
        {
          access,
          validate: Expression.parse(validate),
          filter: Expression.parse(filter),
        },
      ]),
    ),
  ),
);

window.authorizer = new Authorizer(permissionSets);

let state;

function pagify(pageName, page): RouteResolver {
  const component: RouteResolver = {
    render: () => {
      const lastRenderTimestamp = Date.now();
      let p;
      if (state?.error) p = m(errorPage.component, state);
      else p = m(contextifyComponent(page.component), state);
      const attrs = {
        page: pageName,
        oncreate: () => {
          store.fulfill(lastRenderTimestamp);
        },
        onupdate: () => {
          store.fulfill(lastRenderTimestamp);
        },
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
          if (!window.username && err.message.indexOf("authorized") >= 0)
            m.route.set("/login", { continue: requestedPath });
          state = { error: err.message };
          resolve();
        });
    });
  };

  return component;
}

m.route(document.body, "/overview", {
  "/wizard": pagify("wizard", wizardPage),
  "/overview": pagify("overview", overviewPage),
  "/devices": pagify("devices", devicesPage),
  "/devices/:id": pagify("devices", devicePage),
  "/faults": pagify("faults", faultsPage),
  "/presets": pagify("presets", presetsPage),
  "/provisions": pagify("provisions", provisionsPage),
  "/virtualParameters": pagify("virtualParameters", virtualParametersPage),
  "/files": pagify("files", filesPage),
  "/config": pagify("config", configPage),
  "/users": pagify("users", usersPage),
  "/permissions": pagify("permissions", permissionsPage),
  "/login": {
    render: () => [m(loginPage.component), renderOverlay(), m(drawerComponent)],
  },
});
