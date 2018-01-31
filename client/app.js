"use strict";

import m from "mithril";

import layout from "./layout";
import * as store from "./store";
import * as overviewPage from "./overview-page";
import * as devicesPage from "./devices-page";
import * as devicePage from "./device-page";
import * as errorPage from "./error-page";

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
      let c;
      if (state && state.error) c = m(errorPage.component, state);
      else c = m(layout, { page: pageName }, m(page.component, state));
      fulfill();
      return c;
    }
  };

  component.onmatch = args => {
    pageVisitTimestamp = Date.now();
    if (!page.init) {
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
          state = { error: err.message };
          resolve();
        });
    });
  };

  return component;
}

m.route(document.body, "/overview", {
  "/overview": pagify("overview", overviewPage),
  "/devices": pagify("devices", devicesPage),
  "/devices/:id": pagify("devices", devicePage)
});
