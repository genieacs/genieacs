"use strict";

import m from "mithril";
import config from "./config";
import filterComponent from "./filter-component";
import * as store from "./store";
import * as notifications from "./notifications";
import * as expression from "../common/expression";
import memoize from "../common/memoize";
import * as smartQuery from "./smart-query";
import * as expressionParser from "../common/expression-parser";

const PAGE_SIZE = config.ui.pageSize || 10;

const memoizedParse = memoize(expression.parse);
const memoizedJsonParse = memoize(JSON.parse);

const attributes = [
  { id: "device", label: "Device" },
  { id: "channel", label: "Channel" },
  { id: "code", label: "Code" },
  { id: "retries", label: "Retries" },
  { id: "timestamp", label: "Timestamp" }
];

const getDownloadUrl = memoize(filter => {
  let cols = {};
  for (let attr of attributes)
    cols[attr.label] =
      attr.id === "timestamp" ? `DATE_STRING(${attr.id})` : attr.id;

  return `/api/faults.csv?${m.buildQueryString({
    filter: filter,
    columns: JSON.stringify(cols)
  })}`;
});

const unpackSmartQuery = memoize(query => {
  return expressionParser.map(query, e => {
    if (Array.isArray(e) && e[0] === "FUNC" && e[1] === "Q")
      return smartQuery.unpack("faults", e[2], e[3]);
    return e;
  });
});

function init(args) {
  if (!window.authorizer.hasAccess("faults", 2))
    return Promise.reject(
      new Error("You are not authorized to view this page")
    );

  const sort = args.sort;
  const filter = args.filter;
  return Promise.resolve({ filter, sort });
}

function renderTable(
  faultsResponse,
  total,
  selected,
  showMoreCallback,
  downloadUrl,
  sort,
  onSortChange
) {
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

  const labels = [m("th", selectAll)];
  for (let attr of attributes) {
    let label = attr.label;

    let direction = 1;

    let symbol = "\u2981";
    if (sort[attr.id] > 0) symbol = "\u2bc6";
    else if (sort[attr.id] < 0) symbol = "\u2bc5";

    let sortable = m(
      "button",
      {
        onclick: () => {
          if (sort[attr.id] > 0) direction *= -1;
          return onSortChange(JSON.stringify({ [attr.id]: direction }));
        }
      },
      symbol
    );

    labels.push(m("th", [label, sortable]));
  }

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

    let tds = [m("td", checkbox)];
    for (let attr of attributes)
      if (attr.id === "device")
        tds.push(m("a", { href: deviceHref }, f[attr.id]));
      else if (attr.id === "timestamp")
        tds.push(m("td", new Date(f[attr.id]).toLocaleString()));
      else tds.push(m("td", f[attr.id]));

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
        tds
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
      vnode.state.showCount = (vnode.state.showCount || PAGE_SIZE) + PAGE_SIZE;
      m.redraw();
    }

    function onFilterChanged(filter) {
      let ops = { filter };
      if (vnode.attrs.sort) ops.sort = vnode.attrs.sort;
      m.route.set("/faults", ops);
    }

    function onSortChange(sort) {
      let ops = { sort };
      if (vnode.attrs.filter) ops.filter = vnode.attrs.filter;
      m.route.set("/faults", ops);
    }

    const sort = vnode.attrs.sort ? memoizedJsonParse(vnode.attrs.sort) : {};
    let filter = vnode.attrs.filter ? memoizedParse(vnode.attrs.filter) : true;
    filter = unpackSmartQuery(filter);

    let faults = store.fetch("faults", filter, {
      limit: vnode.state.showCount || PAGE_SIZE,
      sort: sort
    });
    let count = store.count("faults", filter);

    let selected = new Set();
    if (vnode.state.selected)
      for (let f of faults.value)
        if (vnode.state.selected.has(f["_id"])) selected.add(f["_id"]);
    vnode.state.selected = selected;

    const downloadUrl = getDownloadUrl(vnode.attrs.filter);

    return [
      m("h1", "Listing faults"),
      m(filterComponent, {
        resource: "faults",
        filter: vnode.attrs.filter,
        onChange: onFilterChanged
      }),
      renderTable(
        faults,
        count.value,
        selected,
        showMore,
        downloadUrl,
        sort,
        onSortChange
      )
    ];
  }
};

export { init, component };
