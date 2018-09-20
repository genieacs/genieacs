"use strict";

import m from "mithril";

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
import Authorizer from "../common/authorizer";
import * as notifications from "./notifications";

window.authorizer = new Authorizer(window.permissionSets);

let state;

let lastRenderTimestamp = 0;
let pageVisitTimestamp = 0;
let fulfillTimeout = null;

function fulfill() {
  clearTimeout(fulfillTimeout);
  fulfillTimeout = setTimeout(() => {
    store.fulfill(lastRenderTimestamp, pageVisitTimestamp).then(updated => {
      if (updated) m.redraw();
    });
  }, 100);
}

function pagify(pageName, page) {
  const component = {
    render: () => {
      lastRenderTimestamp = Date.now();
      let p;
      if (state && state.error) p = m(errorPage.component, state);
      else p = m(page.component, state);
      fulfill();
      return m(layout, { page: pageName }, p);
    }
  };

  component.onmatch = (args, requestedPath) => {
    pageVisitTimestamp = Date.now();
    if (!page.init) {
      state = null;
      fulfill();
      return;
    }

    return new Promise(resolve => {
      page
        .init(args)
        .then(st => {
          if (!st) return m.route.set("/");
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

m.route(document.body, "/overview", {
  "/login": pagify("login", loginPage),
  "/overview": pagify("overview", overviewPage),
  "/devices": pagify("devices", devicesPage),
  "/devices/:id": pagify("devices", devicePage),
  "/faults": pagify("faults", faultsPage),
  "/presets": pagify("presets", presetsPage),
  "/provisions": pagify("provisions", provisionsPage),
  "/virtualParameters": pagify("virtualParameters", virtualParametersPage)
});
