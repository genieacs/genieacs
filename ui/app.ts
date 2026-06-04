import { createLayout } from "./layout.ts";
import * as store from "./legacy-store.ts";
import { invalidate } from "./reactive-store.ts";
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
import Authorizer from "../lib/common/authorizer.ts";
import * as notifications from "./notifications.ts";
import { PermissionSet, UiConfig } from "../lib/types.ts";
import { createDrawer } from "./drawer-component.ts";
import { render as renderOverlay } from "./overlay.ts";
import Expression from "../lib/common/expression.ts";
import * as viewsPage from "./views-page.ts";
import { initRouter, redirect } from "./router.ts";
import { StateSignal } from "./signals.ts";
import { div } from "./dom.ts";

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

interface PageModule<T = unknown> {
  init?: (params: URLSearchParams) => Promise<T>;
  createPage: (attrs: T) => HTMLElement;
}

function definePage<T>(mod: PageModule<T>): PageModule<T> {
  return mod;
}

const pages: Record<string, PageModule<any>> = {
  "/overview": definePage(overviewPage),
  "/wizard": definePage(wizardPage),
  "/devices": definePage(devicesPage),
  "/devices/:id": definePage(devicePage),
  "/faults": definePage(faultsPage),
  "/presets": definePage(presetsPage),
  "/provisions": definePage(provisionsPage),
  "/virtualParameters": definePage(virtualParametersPage),
  "/files": definePage(filesPage),
  "/config": definePage(configPage),
  "/users": definePage(usersPage),
  "/permissions": definePage(permissionsPage),
  "/views": definePage(viewsPage),
  "/login": definePage(loginPage),
};

const routeSignal = new StateSignal<string>("");
const pageSignal = new StateSignal<HTMLElement | null>(null);
const rootSignal = new StateSignal<Node | null>(null);
let layout: HTMLElement | null = null;

document.body.append(
  div(() => rootSignal.get()),
  div(() => renderOverlay()),
  div(createDrawer()),
);

async function handleRoute(
  route: string,
  params: URLSearchParams,
  signal: AbortSignal,
): Promise<void> {
  const page = pages[route];
  if (!page) {
    redirect("/overview").catch(console.error);
    return;
  }

  // Captured before page.init so the incoming page's freshly-fetched data
  // (timestamped after this point) isn't treated as stale below.
  const now = Date.now();
  store.setTimestamp(now);

  // Refresh stale cached queries for the new view, deferred until after the
  // outgoing page has been swapped out (pageSignal/rootSignal set below) and
  // its query signals disposed. A macrotask runs only once the microtask queue
  // has fully drained, so it lands after the entire disposal chain (the content
  // slot's watchEffect render in dom.ts, then the signal's TrackedSinkSet
  // disposal in reactive-store.ts) regardless of how many microtask hops that
  // takes — unlike a fixed number of queueMicrotask()s, which would be coupled
  // to the exact hop count. Running it sooner would refetch the very queries we
  // are navigating away from. Uses the captured `now` so the incoming page's
  // just-fetched data isn't re-invalidated.
  const refreshNewView = (): void => {
    globalThis.setTimeout(() => invalidate(now), 0);
  };

  let pageEl: HTMLElement;
  try {
    let state: unknown;
    if (page.init) state = await page.init(params);
    if (signal.aborted) return;
    pageEl = page.createPage(state);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!window.username && message.indexOf("authorized") >= 0) {
      notifications.push("error", message);
      const requestedPath = location.pathname + location.search;
      redirect("/login", { continue: requestedPath }).catch(console.error);
      return;
    }
    if (signal.aborted) return;
    pageEl = errorPage.createPage({ error: message });
  }

  if (route === "/login") {
    layout = null;
    pageSignal.set(null);
    rootSignal.set(pageEl);
    refreshNewView();
    return;
  }

  if (!layout) layout = createLayout(routeSignal, pageSignal);
  routeSignal.set(route);
  pageSignal.set(pageEl);
  rootSignal.set(layout);
  refreshNewView();
}

initRouter(handleRoute);
