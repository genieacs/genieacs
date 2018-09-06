"use strict";

import m from "mithril";

import config from "./config";
import filterComponent from "./filter-component";
import * as store from "./store";
import * as expression from "../common/expression";
import * as notifications from "./notifications";
import memoize from "../common/memoize";

const PAGE_SIZE = config.ui.pageSize || 10;

const memoizedParse = memoize(expression.parse);

const getDownloadUrl = memoize(filter => {
  return `/api/presets.csv?${m.buildQueryString({
    filter: filter,
    columns: JSON.stringify({
      Name: "_id",
      Channel: "channel",
      Weight: "weight",
      Schedule: "schedule",
      Events: "events",
      Precondition: "precondition",
      Provision: "provision",
      Arguments: "provisionArgs"
    })
  })}`;
});

function init(args) {
  if (!window.authorizer.hasAccess("presets", 2))
    return Promise.reject(
      new Error("You are not authorized to view this page")
    );

  const filter = args.filter;
  return Promise.resolve({ filter });
}

function renderTable(
  presetsResponse,
  total,
  selected,
  showMoreCallback,
  downloadUrl
) {
  const presets = presetsResponse.value;
  const selectAll = m("input", {
    type: "checkbox",
    checked: presets.length && selected.size === presets.length,
    onchange: e => {
      for (let preset of presets)
        if (e.target.checked) selected.add(preset["_id"]);
        else selected.delete(preset["_id"]);
    },
    disabled: !total
  });

  const labels = [
    selectAll,
    "Name",
    "Channel",
    "Weight",
    "Schedule",
    "Events",
    "Precondition",
    "Provision",
    "Arguments"
  ].map(l => m("th", l));

  let rows = [];
  for (let preset of presets) {
    let checkbox = m("input", {
      type: "checkbox",
      checked: selected.has(preset["_id"]),
      onchange: e => {
        if (e.target.checked) selected.add(preset["_id"]);
        else selected.delete(preset["_id"]);
      },
      onclick: e => {
        e.stopPropagation();
        e.redraw = false;
      }
    });

    let devicesUrl = "/#!/devices";
    if (preset["precondition"].length)
      devicesUrl += `?${m.buildQueryString({
        filter: preset["precondition"]
      })}`;

    rows.push(
      m(
        "tr",
        {
          onclick: e => {
            if (["INPUT", "BUTTON", "A"].includes(e.target.nodeName)) {
              e.redraw = false;
              return;
            }

            if (!selected.delete(preset["_id"])) selected.add(preset["_id"]);
          }
        },
        m("td", checkbox),
        m("td", preset["_id"]),
        m("td", preset["channel"]),
        m("td", preset["weight"]),
        m("td", preset["schedule"]),
        m("td", preset["events"]),
        m(
          "td",
          { title: preset["precondition"] },
          m("a", { href: devicesUrl }, preset["precondition"])
        ),
        m("td", preset["provision"]),
        m("td", preset["provisionArgs"])
      )
    );
  }

  if (!rows.length)
    rows.push(m("tr.empty", m("td", { colspan: labels.length }, "No presets")));

  let footerElements = [];
  if (total != null) footerElements.push(`${presets.length}/${total}`);
  else footerElements.push(`${presets.length}`);

  footerElements.push(
    m(
      "button",
      {
        title: "Show more presets",
        onclick: showMoreCallback,
        disabled: presets.length >= total || !presetsResponse.fulfilled
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

  const buttons = [
    m(
      "button.primary",
      {
        title: "Delete selected presets",
        disabled: !selected.size,
        onclick: e => {
          e.redraw = false;
          e.target.disabled = true;
          Promise.all(
            Array.from(selected).map(id => store.deleteResource("presets", id))
          )
            .then(res => {
              notifications.push("success", `${res.length} presets deleted`);
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
    document.title = "Presets - GenieACS";

    function showMore() {
      vnode.state.showCount = (vnode.state.showCount || PAGE_SIZE) + PAGE_SIZE;
      m.redraw();
    }

    function onFilterChanged(filter) {
      m.route.set("/presets", { filter });
    }

    const filter = vnode.attrs.filter
      ? memoizedParse(vnode.attrs.filter)
      : true;

    let presets = store.fetch("presets", filter, {
      limit: vnode.state.showCount || PAGE_SIZE
    });
    let count = store.count("presets", filter);

    let selected = new Set();
    if (vnode.state.selected)
      for (let preset of presets.value)
        if (vnode.state.selected.has(preset["_id"]))
          selected.add(preset["_id"]);
    vnode.state.selected = selected;

    const downloadUrl = getDownloadUrl(vnode.attrs.filter);

    return [
      m("h1", "Listing presets"),
      m(filterComponent, {
        predefined: [
          { parameter: "_id" },
          { parameter: "channel" },
          { parameter: "weight" }
        ],
        filter: vnode.attrs.filter,
        onChange: onFilterChanged
      }),
      renderTable(presets, count.value, selected, showMore, downloadUrl)
    ];
  }
};

export { init, component };
