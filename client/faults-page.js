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
import { loadYaml, yaml } from "./dynamic-loader";
import longTextComponent from "./long-text-component";

const PAGE_SIZE = config.ui.pageSize || 10;

const memoizedParse = memoize(expression.parse);
const memoizedJsonParse = memoize(JSON.parse);

const attributes = [
  { id: "device", label: "Device" },
  { id: "channel", label: "Channel" },
  { id: "code", label: "Code" },
  { id: "message", label: "Message" },
  { id: "detail", label: "Detail", unsortable: true },
  { id: "retries", label: "Retries" },
  { id: "timestamp", label: "Timestamp" }
];

const getDownloadUrl = memoize(filter => {
  const cols = {};
  for (const attr of attributes) {
    cols[attr.label] =
      attr.id === "timestamp" ? `DATE_STRING(${attr.id})` : attr.id;
  }

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
  if (!window.authorizer.hasAccess("faults", 2)) {
    return Promise.reject(
      new Error("You are not authorized to view this page")
    );
  }

  const sort = args.sort;
  const filter = args.filter;
  return new Promise((resolve, reject) => {
    loadYaml()
      .then(() => {
        resolve({ filter, sort });
      })
      .catch(reject);
  });
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
      for (const f of faults) {
        if (e.target.checked) selected.add(f["_id"]);
        else selected.delete(f["_id"]);
      }
    },
    disabled: !total
  });

  const labels = [m("th", selectAll)];
  for (const attr of attributes) {
    const label = attr.label;

    if (attr.unsortable) {
      labels.push(m("th", label));
      continue;
    }

    // Offset direction by 1 since sort["_id"] = -1
    let direction = 2;

    let symbol = "\u2981";
    if (sort[attr.id] > 0) symbol = "\u2bc6";
    else if (sort[attr.id] < 0) symbol = "\u2bc5";

    const sortable = m(
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

  const rows = [];
  for (const f of faults) {
    const checkbox = m("input", {
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

    const tds = [m("td", checkbox)];
    for (const attr of attributes) {
      if (attr.id === "device") {
        tds.push(m("td", m("a", { href: deviceHref }, f[attr.id])));
      } else if (attr.id === "timestamp") {
        tds.push(m("td", new Date(f[attr.id]).toLocaleString()));
      } else if (attr.id === "detail") {
        tds.push(
          m("td", m(longTextComponent, { text: yaml.stringify(f[attr.id]) }))
        );
      } else {
        tds.push(m("td", f[attr.id]));
      }
    }

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

  const footerElements = [];
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

  if (downloadUrl) {
    footerElements.push(
      m("a.download-csv", { href: downloadUrl, download: "" }, "Download")
    );
  }

  const tfoot = m(
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
      const ops = { filter };
      if (vnode.attrs.sort) ops.sort = vnode.attrs.sort;
      m.route.set("/faults", ops);
    }

    function onSortChange(sort) {
      const ops = { sort };
      if (vnode.attrs.filter) ops.filter = vnode.attrs.filter;
      m.route.set("/faults", ops);
    }

    const sort = vnode.attrs.sort ? memoizedJsonParse(vnode.attrs.sort) : {};
    let filter = vnode.attrs.filter ? memoizedParse(vnode.attrs.filter) : true;
    filter = unpackSmartQuery(filter);

    const faults = store.fetch("faults", filter, {
      limit: vnode.state.showCount || PAGE_SIZE,
      sort: sort
    });
    const count = store.count("faults", filter);

    const selected = new Set();
    if (vnode.state.selected) {
      for (const f of faults.value)
        if (vnode.state.selected.has(f["_id"])) selected.add(f["_id"]);
    }
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
