"use strict";

import m from "mithril";

import * as config from "./config";
import filterComponent from "./filter-component";
import * as filterParser from "../common/filter-parser";
import Filter from "../common/filter";
import * as store from "./store";
import * as components from "./components";

function init(args) {
  return new Promise(resolve => {
    let filter = new Filter(args.filter);
    resolve({ filter: filter });
  });
}

function renderTable(devices, parameters, total, showMoreCallback) {
  let labels = [];
  for (let param of parameters) labels.push(m("th", param.label));
  labels.push(m("th"));

  let rows = [];
  for (let device of devices)
    rows.push(
      m(
        "tr",
        parameters
          .map(p => {
            const attrs = Object.assign({ device: device }, p);
            const comp = m(components.get("parameter"), attrs);
            return m("td", comp);
          })
          .concat(
            m(
              "td.table-row-links",
              m(
                "a",
                {
                  href: `#!/devices/${encodeURIComponent(
                    device["DeviceID.ID"].value[0]
                  )}`
                },
                "Show"
              )
            )
          )
      )
    );

  let footerElements = [`${devices.length}/${total}`];

  if (devices.length < total)
    footerElements.push(m("a", { onclick: showMoreCallback }, "Show more"));

  let tfoot = m(
    "tfoot",
    m("tr", m("td", { colspan: labels.length + 1 }, footerElements))
  );

  return m("table.table", [
    m("thead", m("tr", labels)),
    m("tbody", rows),
    tfoot
  ]);
}

const component = {
  view: vnode => {
    document.title = "Devices - GenieACS";

    function showMore() {
      vnode.state.showCount = (vnode.state.showCount || 10) + 10;
      m.redraw();
    }

    function onFilterChanged(filter) {
      let params = {};
      if (filter) params.filter = filterParser.stringify(filter);
      m.route.set("/devices", params);
    }

    let devs = store.fetch(
      "devices",
      vnode.attrs.filter,
      vnode.state.showCount || 10
    );
    let count = store.count("devices", vnode.attrs.filter);

    return [
      m("h1", "Listing devices"),
      m(filterComponent, {
        filter: vnode.attrs.filter ? vnode.attrs.filter.ast : null,
        onChange: onFilterChanged
      }),
      renderTable(
        devs.value,
        Object.values(config.get("ui.index")),
        count.value,
        showMore
      )
    ];
  }
};

export { init, component };
