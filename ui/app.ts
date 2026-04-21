import m, { ClosureComponent } from "mithril";
import layout from "./layout.tsx";
import * as store from "./store.ts";
import { invalidate } from "./reactive-store.ts";
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
import Authorizer from "../lib/common/authorizer.ts";
import * as notifications from "./notifications.ts";
import { contextifyComponent } from "./components.ts";
import { PermissionSet, UiConfig } from "../lib/types.ts";
import drawerComponent from "./drawer-component.ts";
import { render as renderOverlay } from "./overlay.ts";
import Expression from "../lib/common/expression.ts";
import * as viewsPage from "./views-page.ts";
import { initRouter, redirect } from "./router.ts";

export { ViewNode } from "./views.ts";
export { Signal } from "./signals.ts";

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
    clockSkew: number;
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

interface PageModule {
  init?: (params: Record<string, string>) => Promise<any>;
  component: ClosureComponent<any>;
}

const pages: Record<string, PageModule> = {
  "/overview": overviewPage,
  "/wizard": wizardPage,
  "/devices": devicesPage,
  "/devices/:id": devicePage,
  "/faults": faultsPage,
  "/presets": presetsPage,
  "/provisions": provisionsPage,
  "/virtualParameters": virtualParametersPage,
  "/files": filesPage,
  "/config": configPage,
  "/users": usersPage,
  "/permissions": permissionsPage,
  "/views": viewsPage,
  "/login": loginPage,
};

// Current render state
let currentRoute: string = "";
let currentComponent: ClosureComponent<any>;
let currentState: any;

// Root component mounted via m.mount
const root = {
  view: () => {
    if (!currentComponent) return null;

    if (currentComponent === loginPage.component) {
      return [
        m(currentComponent, currentState),
        renderOverlay(),
        m(drawerComponent),
      ];
    }

    const lastRenderTimestamp = Date.now();

    return m(
      layout,
      {
        route: currentRoute,
        oncreate: () => {
          store.fulfill(lastRenderTimestamp);
        },
        onupdate: () => {
          store.fulfill(lastRenderTimestamp);
        },
      },
      m(contextifyComponent(currentComponent), currentState),
    );
  },
};

m.mount(document.body, root);

async function handleRoute(
  route: string,
  params: URLSearchParams,
  signal: AbortSignal,
): Promise<void> {
  try {
    const page = pages[route];
    if (!page) return redirect("/overview").catch(console.error);

    store.setTimestamp(Date.now());
    invalidate(Date.now());

    let state: typeof currentState = {};

    if (page.init) {
      try {
        state = await page.init(Object.fromEntries(params));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (!window.username && message.indexOf("authorized") >= 0) {
          notifications.push("error", message);
          const requestedPath = location.pathname + location.search;
          redirect("/login", { continue: requestedPath }).catch(console.error);
          return;
        }
        throw err;
      }
    }

    if (signal.aborted) return;

    currentRoute = route;
    currentComponent = page.component;
    currentState = state;

    m.redraw();
  } catch (err) {
    if (signal.aborted) return;
    console.error(err);
    currentRoute = route;
    currentComponent = errorPage.component;
    currentState = {
      error: err instanceof Error ? err.message : String(err),
    };
    m.redraw();
  }
}

initRouter(handleRoute);
