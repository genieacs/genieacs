"use strict";

import m from "mithril";

import * as config from "./config";
import filterComponent from "./filter-component";
import * as filterParser from "../common/filter-parser";
import Filter from "../common/filter";
import * as store from "./store";
import * as components from "./components";
import * as taskQueue from "./task-queue";
import * as notifications from "./notifications";

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

function renderActions(selected) {
  const buttons = [];

  buttons.push(
    m(
      "button.primary",
      {
        title: "Reboot selected devices",
        disabled: !selected.size,
        onclick: () => {
          for (let d of selected)
            taskQueue.queueTask({
              name: "reboot",
              device: d
            });
        }
      },
      "Reboot"
    )
  );

  buttons.push(
    m(
      "button.critical",
      {
        title: "Factory reset selected devices",
        disabled: !selected.size,
        onclick: () => {
          for (let d of selected)
            taskQueue.queueTask({
              name: "factoryReset",
              device: d
            });
        }
      },
      "Reset"
    )
  );

  buttons.push(
    m(
      "button.primary",
      {
        title: "Delete selected devices",
        disabled: !selected.size,
        onclick: () => {
          const ids = Array.from(selected);
          if (!confirm(`Deleting ${ids.length} devices. Are you sure?`)) return;

          Promise.all(ids.map(id => store.deleteResource("devices", id)))
            .then(() => {
              notifications.push("success", `${ids.size} devices deleted`);
              store.fulfill(0, Date.now());
            })
            .catch(err => {
              notifications.push("error", err.message);
            });
        }
      },
      "Delete"
    )
  );

  buttons.push(
    m(
      "button.primary",
      {
        title: "Tag selected devices",
        disabled: !selected.size,
        onclick: () => {
          const ids = Array.from(selected);
          const tag = prompt(`Enter tag to assign to ${ids.length} devices:`);
          if (!tag) return;

          Promise.all(
            ids.map(id => {
              store.updateTags(id, { [tag]: true });
            })
          )
            .then(() => {
              notifications.push(
                "success",
                `Tag '${tag}' assigned to ${ids.length} devices`
              );
              store.fulfill(0, Date.now());
            })
            .catch(err => notifications.push("error", err.message));
        }
      },
      "Tag"
    )
  );

  buttons.push(
    m(
      "button.primary",
      {
        title: "Untag selected devices",
        disabled: !selected.size,
        onclick: () => {
          const ids = Array.from(selected);
          const tag = prompt(
            `Enter tag to unassign from ${ids.length} devices:`
          );
          if (!tag) return;

          Promise.all(
            ids.map(id => {
              store.updateTags(id, { [tag]: false });
            })
          )
            .then(() => {
              notifications.push(
                "success",
                `Tag '${tag}' unassigned from ${ids.length} devices`
              );
              store.fulfill(0, Date.now());
            })
            .catch(err => notifications.push("error", err.message));
        }
      },
      "Untag"
    )
  );

  return m(".device-actions", buttons);
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
      ),
      renderActions(selected)
    ];
  }
};

export { init, component };
