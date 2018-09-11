"use strict";

import m from "mithril";

import config from "./config";
import filterComponent from "./filter-component";
import * as store from "./store";
import * as components from "./components";
import * as taskQueue from "./task-queue";
import * as notifications from "./notifications";
import * as expression from "../common/expression";
import memoize from "../common/memoize";

const PAGE_SIZE = config.ui.pageSize || 10;

const memoizedParse = memoize(expression.parse);
const memoizedJsonParse = memoize(JSON.parse);
const memoizedGetSortable = memoize(str => {
  let expressionParams = expression.extractParams(
    expression.parse(str)
  );
  if (expressionParams.length === 1) {
    let param = expression.evaluate(expressionParams[0]);
    if (typeof param === "string") return param;
  }
  return null;
});

const getDownloadUrl = memoize((filter, indexParameters) => {
  const columns = {};
  for (const p of indexParameters) columns[p.label] = p.parameter;
  return `/api/devices.csv?${m.buildQueryString({
    filter: filter,
    columns: JSON.stringify(columns)
  })}`;
});

const getChildAttrs = memoize((attrs, device) =>
  Object.assign({}, attrs, { device: device })
);

function init(args) {
  return new Promise((resolve, reject) => {
    if (!window.authorizer.hasAccess("devices", 2))
      return reject(new Error("You are not authorized to view this page"));

    const filter = args.filter;
    const sort = args.sort;
    const indexParameters = Object.values(config.ui.index);
    resolve({ filter, indexParameters, sort });
  });
}

function renderTable(
  devicesResponse,
  parameters,
  total,
  selected,
  showMoreCallback,
  downloadUrl,
  sort,
  onSortChange
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
  for (let param of parameters) {
    let label = param.label;
    let _param;
    if (!param.unsortable && (_param = memoizedGetSortable(param.parameter))) {
      let direction = 1;

      let symbol = "\u21f3";
      if (sort[_param] > 0) symbol = "\u2b07";
      else if (sort[_param] < 0) symbol = "\u2b06";

      let sortable = m(
        "button",
        {
          onclick: () => {
            if (sort[_param] > 0) direction *= -1;
            return onSortChange(JSON.stringify({ [_param]: direction }));
          }
        },
        symbol
      );

      labels.push(m("th", [label, sortable]));
    } else {
      labels.push(m("th", label));
    }
  }

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
          const attrs = getChildAttrs(p, device);
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

  if (downloadUrl)
    footerElements.push(
      m("a.download-csv", { href: downloadUrl, download: "" }, "Download")
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

          let counter = 1;
          for (let id of ids) {
            ++counter;
            store
              .deleteResource("devices", id)
              .then(() => {
                notifications.push("success", `${id}: Deleted`);
                if (--counter === 0) store.fulfill(0, Date.now());
              })
              .catch(err => {
                notifications.push("error", `${id}: ${err.message}`);
                if (--counter === 0) store.fulfill(0, Date.now());
              });
          }
          if (--counter === 0) store.fulfill(0, Date.now());
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

          let counter = 1;
          for (let id of ids) {
            ++counter;
            store
              .updateTags(id, { [tag]: true })
              .then(() => {
                notifications.push("success", `${id}: Tags updated`);
                if (--counter === 0) store.fulfill(0, Date.now());
              })
              .catch(err => {
                notifications.push("error", `${id}: ${err.message}`);
                if (--counter === 0) store.fulfill(0, Date.now());
              });
          }
          if (--counter === 0) store.fulfill(0, Date.now());
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

          let counter = 1;
          for (let id of ids) {
            ++counter;
            store
              .updateTags(id, { [tag]: false })
              .then(() => {
                notifications.push("success", `${id}: Tags updated`);
                if (--counter === 0) store.fulfill(0, Date.now());
              })
              .catch(err => {
                notifications.push("error", `${id}: ${err.message}`);
                if (--counter === 0) store.fulfill(0, Date.now());
              });
          }
          if (--counter === 0) store.fulfill(0, Date.now());
        }
      },
      "Untag"
    )
  );

  return m(".actions-bar", buttons);
}

const component = {
  view: vnode => {
    document.title = "Devices - GenieACS";

    function showMore() {
      vnode.state.showCount = (vnode.state.showCount || PAGE_SIZE) + PAGE_SIZE;
      m.redraw();
    }

    function onFilterChanged(filter) {
      let ops = { filter };
      if (vnode.attrs.sort) ops.sort = vnode.attrs.sort;
      m.route.set("/devices", ops);
    }

    function onSortChange(sort) {
      let ops = { sort };
      if (vnode.attrs.filter) ops.filter = vnode.attrs.filter;
      m.route.set("/devices", ops);
    }

    const sort = vnode.attrs.sort ? memoizedJsonParse(vnode.attrs.sort) : {};
    const filter = vnode.attrs.filter
      ? memoizedParse(vnode.attrs.filter)
      : true;

    let devs = store.fetch("devices", filter, {
      limit: vnode.state.showCount || PAGE_SIZE,
      sort: sort
    });
    let count = store.count("devices", filter);

    let selected = new Set();
    if (vnode.state.selected)
      for (let d of devs.value)
        if (vnode.state.selected.has(d["DeviceID.ID"].value[0]))
          selected.add(d["DeviceID.ID"].value[0]);
    vnode.state.selected = selected;

    const downloadUrl = getDownloadUrl(
      vnode.attrs.filter,
      vnode.attrs.indexParameters
    );

    return [
      m("h1", "Listing devices"),
      m(filterComponent, {
        predefined: Object.values(config.ui.filters),
        filter: vnode.attrs.filter,
        onChange: onFilterChanged
      }),
      renderTable(
        devs,
        vnode.attrs.indexParameters,
        count.value,
        selected,
        showMore,
        downloadUrl,
        sort,
        onSortChange
      ),
      renderActions(selected)
    ];
  }
};

export { init, component };
