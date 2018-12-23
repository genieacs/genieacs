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
    let indexParameters = Object.values(config.get("ui.index")).map(p =>
      Object.assign({}, p, {
        parameter: filterParser.parseParameter(p.parameter)
      })
    );
    resolve({ filter: filter, indexParameters: indexParameters });
  });
}

function renderTable(
  devicesResponse,
  parameters,
  total,
  selected,
  showMoreCallback
) {
  const devices = devicesResponse.value;
  const selectAll = m("input", {
    type: "checkbox",
    checked: devices.length && selected.size === devices.length,
    onchange: e => {
      for (let d of devices)
        if (e.target.checked) selected.add(d["DeviceID.ID"].value[0]);
        else selected.delete(d["DeviceID.ID"].value[0]);
    },
    disabled: !total
  });

  let labels = [m("th", selectAll)];
  for (let param of parameters) labels.push(m("th", param.label));

  let rows = [];
  for (let device of devices) {
    let checkbox = m("input", {
      type: "checkbox",
      checked: selected.has(device["DeviceID.ID"].value[0]),
      onchange: e => {
        if (e.target.checked) selected.add(device["DeviceID.ID"].value[0]);
        else selected.delete(device["DeviceID.ID"].value[0]);
      }
    });

    rows.push(
      m(
        "tr",
        {
          onclick: e => {
            if (["INPUT", "BUTTON", "A"].includes(e.target.nodeName)) {
              e.redraw = false;
              return;
            }

            if (!selected.delete(device["DeviceID.ID"].value[0]))
              selected.add(device["DeviceID.ID"].value[0]);
          }
        },
        m("td", checkbox),
        parameters.map(p => {
          const attrs = Object.assign({}, p, {
            device: device,
            parameter: store.evaluateExpression(p.parameter, device)
          });
          const comp = m(components.get(attrs.type || "parameter"), attrs);
          return m("td", comp);
        }),
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
    );
  }

  if (!rows.length)
    rows.push(
      m("tr.empty", m("td", { colspan: parameters.length + 1 }, "No devices"))
    );

  let footerElements = [];
  if (total != null) footerElements.push(`${devices.length}/${total}`);
  else footerElements.push(`${devices.length}`);

  footerElements.push(
    m(
      "button",
      {
        title: "Show more devices",
        onclick: showMoreCallback,
        disabled: devices.length >= total || !devicesResponse.fulfilled
      },
      "More"
    )
  );

  let tfoot = m(
    "tfoot",
    m("tr", m("td", { colspan: labels.length }, footerElements))
  );

  return m("table.table.highlight", [
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

    let selected = new Set();
    if (vnode.state.selected)
      for (let d of devs.value)
        if (vnode.state.selected.has(d["DeviceID.ID"].value[0]))
          selected.add(d["DeviceID.ID"].value[0]);
    vnode.state.selected = selected;

    return [
      m("h1", "Listing devices"),
      m(filterComponent, {
        predefined: Object.values(config.get("ui.filters")),
        filter: vnode.attrs.filter ? vnode.attrs.filter.ast : null,
        onChange: onFilterChanged
      }),
      renderTable(
        devs,
        vnode.attrs.indexParameters,
        count.value,
        selected,
        showMore
      )
    ];
  }
};

export { init, component };
