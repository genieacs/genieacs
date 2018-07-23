"use strict";

import m from "mithril";

import filterComponent from "./filter-component";
import * as store from "./store";
import * as notifications from "./notifications";
import * as expression from "../common/expression";

function init(args) {
  if (!window.authorizer.hasAccess("faults", 2))
    return Promise.reject(
      new Error("You are not authorized to view this page")
    );

  let filter = null;
  if (args.filter != null) filter = expression.parse(`${args.filter}`);
  return Promise.resolve({ filter: filter });
}

function renderTable(faultsResponse, total, selected, showMoreCallback) {
  const faults = faultsResponse.value;
  const selectAll = m("input", {
    type: "checkbox",
    checked: faults.length && selected.size === faults.length,
    onchange: e => {
      for (let f of faults)
        if (e.target.checked) selected.add(f["_id"]);
        else selected.delete(f["_id"]);
    },
    disabled: !total
  });

  const labels = [
    selectAll,
    "Device",
    "Channel",
    "Code",
    "Message",
    "Retries",
    "Timestamp"
  ].map(l => m("th", l));

  let rows = [];
  for (let f of faults) {
    let checkbox = m("input", {
      type: "checkbox",
      checked: selected.has(f["_id"]),
      onchange: e => {
        if (e.target.checked) selected.add(f["_id"]);
        else selected.delete(f["_id"]);
      },
      onclick: e => {
        e.stopPropagation();
        e.redraw = false;
      }
    });

    const deviceHref = `#!/devices/${encodeURIComponent(f["device"])}`;

    rows.push(
      m(
        "tr",
        {
          onclick: e => {
            if (["INPUT", "BUTTON", "A"].includes(e.target.nodeName)) {
              e.redraw = false;
              return;
            }

            if (!selected.delete(f["_id"])) selected.add(f["_id"]);
          }
        },
        m("td", checkbox),
        m("td", m("a", { href: deviceHref }, f["device"])),
        m("td", f["channel"]),
        m("td", f["code"]),
        m("td", f["message"]),
        m("td", f["retries"]),
        m("td", new Date(f["timestamp"]).toLocaleString())
      )
    );
  }

  if (!rows.length)
    rows.push(m("tr.empty", m("td", { colspan: 7 }, "No faults")));

  let footerElements = [];
  if (total != null) footerElements.push(`${faults.length}/${total}`);
  else footerElements.push(`${faults.length}`);

  footerElements.push(
    m(
      "button",
      {
        title: "Show more faults",
        onclick: showMoreCallback,
        disabled: faults.length >= total || !faultsResponse.fulfilled
      },
      "More"
    )
  );

  let tfoot = m(
    "tfoot",
    m("tr", m("td", { colspan: labels.length }, footerElements))
  );

  const buttons = [
    m(
      "button.primary",
      {
        title: "Delete selected faults",
        disabled: !selected.size,
        onclick: e => {
          e.redraw = false;
          e.target.disabled = true;
          Promise.all(
            Array.from(selected).map(id => store.deleteResource("faults", id))
          )
            .then(res => {
              notifications.push("success", `${res.length} faults deleted`);
              store.fulfill(0, Date.now());
            })
            .catch(err => {
              notifications.push("error", err.message);
            });
        }
      },
      "Delete"
    )
  ];

  return [
    m(
      "table.table.highlight",
      m("thead", m("tr", labels)),
      m("tbody", rows),
      tfoot
    ),
    buttons
  ];
}

const component = {
  view: vnode => {
    document.title = "Faults - GenieACS";

    function showMore() {
      vnode.state.showCount = (vnode.state.showCount || 10) + 10;
      m.redraw();
    }

    function onFilterChanged(filter) {
      let params = {};
      if (filter != null) params.filter = expression.stringify(filter);
      m.route.set("/faults", params);
    }

    let faults = store.fetch(
      "faults",
      vnode.attrs.filter == null ? true : vnode.attrs.filter,
      { limit: vnode.state.showCount || 10 }
    );
    let count = store.count(
      "faults",
      vnode.attrs.filter == null ? true : vnode.attrs.filter
    );

    let selected = new Set();
    if (vnode.state.selected)
      for (let f of faults.value)
        if (vnode.state.selected.has(f["_id"])) selected.add(f["_id"]);
    vnode.state.selected = selected;

    return [
      m("h1", "Listing faults"),
      m(filterComponent, {
        predefined: [
          { parameter: "device" },
          { parameter: "channel" },
          { parameter: "code" },
          { parameter: "retries" },
          { parameter: "timestamp" }
        ],
        filter: vnode.attrs.filter,
        onChange: onFilterChanged
      }),
      renderTable(faults, count.value, selected, showMore)
    ];
  }
};

export { init, component };
