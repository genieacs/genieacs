"use strict";

import m from "mithril";

import layout from "./layout";
import * as overviewPage from "./overview-page";
import * as devicesPage from "./devices-page";
import * as errorPage from "./error-page";

let state;

function pagify(pageName, page) {
  const component = {
    render: () => {
      if (state && state.error) return m(errorPage.component, state);
      else return m(layout, { page: pageName }, m(page.component, state));
    }
  };

  if (page.init)
    component.onmatch = args => {
      return new Promise(resolve => {
        page
          .init(args)
          .then(st => {
            if (!st) return m.route.set("/");
            state = st;
            resolve();
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
  "/devices": pagify("devices", devicesPage)
});
