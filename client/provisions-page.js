"use strict";

import m from "mithril";

import config from "./config";
import filterComponent from "./filter-component";
import * as store from "./store";
import * as expression from "../common/expression";
import * as notifications from "./notifications";
import memoize from "../common/memoize";
import putFormComponent from "./put-form-component";
import * as overlay from "./overlay";
import * as smartQuery from "./smart-query";
import * as expressionParser from "../common/expression-parser";
import { loadCodeMirror } from "./dynamic-loader";

const PAGE_SIZE = config.ui.pageSize || 10;

const memoizedParse = memoize(expression.parse);
const memoizedJsonParse = memoize(JSON.parse);

const attributes = [
  { id: "_id", label: "Name" },
  { id: "script", label: "Script", type: "code" }
];

const unpackSmartQuery = memoize(query => {
  return expressionParser.map(query, e => {
    if (Array.isArray(e) && e[0] === "FUNC" && e[1] === "Q")
      return smartQuery.unpack("provisions", e[2], e[3]);
    return e;
  });
});

function putActionHandler(action, object, isNew) {
  if (action === "save") {
    const id = object["_id"];
    delete object["_id"];

    if (!id) return void notifications.push("error", "ID can not be empty");

    store
      .resourceExists("provisions", id)
      .then(exists => {
        if (exists && isNew) {
          notifications.push("error", "Provision already exists");
          store.fulfill(0, Date.now());
          return;
        }

        if (!exists && !isNew) {
          notifications.push("error", "Provision already deleted");
          store.fulfill(0, Date.now());
          return;
        }

        store
          .putResource("provisions", id, object)
          .then(() => {
            notifications.push(
              "success",
              `Provision ${exists ? "updated" : "created"}`
            );
            store.fulfill(0, Date.now());
          })
          .catch(err => {
            notifications.push("error", err.message);
          });
      })
      .catch(err => {
        notifications.push("error", err.message);
      });
  } else if (action === "delete") {
    store
      .deleteResource("provisions", object["_id"])
      .then(() => {
        notifications.push("success", "Provision deleted");
        store.fulfill(0, Date.now());
      })
      .catch(err => {
        notifications.push("error", err.message);
        store.fulfill(0, Date.now());
      });
  } else {
    throw new Error("Undefined action");
  }
}

const formData = {
  resource: "provisions",
  attributes: attributes
};

const getDownloadUrl = memoize(filter => {
  const cols = {};
  for (const attr of attributes) cols[attr.label] = attr.id;
  return `/api/provisions.csv?${m.buildQueryString({
    filter: filter,
    columns: JSON.stringify(cols)
  })}`;
});

function init(args) {
  if (!window.authorizer.hasAccess("provisions", 2)) {
    return Promise.reject(
      new Error("You are not authorized to view this page")
    );
  }

  const sort = args.sort;
  const filter = args.filter;

  return new Promise((resolve, reject) => {
    loadCodeMirror()
      .then(() => {
        resolve({ filter, sort });
      })
      .catch(reject);
  });
}

function renderTable(
  provisionsResponse,
  total,
  selected,
  showMoreCallback,
  downloadUrl,
  sort,
  onSortChange
) {
  const provisions = provisionsResponse.value;
  const selectAll = m("input", {
    type: "checkbox",
    checked: provisions.length && selected.size === provisions.length,
    onchange: e => {
      for (const provision of provisions) {
        if (e.target.checked) selected.add(provision["_id"]);
        else selected.delete(provision["_id"]);
      }
    },
    disabled: !total
  });

  const labels = [m("th", selectAll)];
  for (const attr of attributes) {
    const label = attr.label;

    let direction = 1;

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
  for (const provision of provisions) {
    const checkbox = m("input", {
      type: "checkbox",
      checked: selected.has(provision["_id"]),
      onchange: e => {
        if (e.target.checked) selected.add(provision["_id"]);
        else selected.delete(provision["_id"]);
      },
      onclick: e => {
        e.stopPropagation();
        e.redraw = false;
      }
    });

    const tds = [m("td", checkbox)];
    for (const attr of attributes) {
      if (attr.id == "script") {
        const firstLines = provision[attr.id].split("\n", 11);
        if (firstLines.length > 10) firstLines[10] = ["\ufe19"];
        tds.push(
          m("td", { title: firstLines.join("\n") }, firstLines[0] || "")
        );
      } else {
        tds.push(m("td", provision[attr.id]));
      }
    }

    tds.push(
      m(
        "td.table-row-links",
        m(
          "a",
          {
            onclick: () => {
              const cb = () => {
                return m(
                  putFormComponent,
                  Object.assign(
                    {
                      base: provision,
                      actionHandler: (action, object) => {
                        overlay.close(cb);
                        putActionHandler(action, object, false);
                      }
                    },
                    formData
                  )
                );
              };
              overlay.open(cb);
            }
          },
          "Show"
        )
      )
    );

    rows.push(
      m(
        "tr",
        {
          onclick: e => {
            if (["INPUT", "BUTTON", "A"].includes(e.target.nodeName)) {
              e.redraw = false;
              return;
            }

            if (!selected.delete(provision["_id"]))
              selected.add(provision["_id"]);
          }
        },
        tds
      )
    );
  }

  if (!rows.length) {
    rows.push(
      m("tr.empty", m("td", { colspan: labels.length }, "No provisions"))
    );
  }

  const footerElements = [];
  if (total != null) footerElements.push(`${provisions.length}/${total}`);
  else footerElements.push(`${provisions.length}`);

  footerElements.push(
    m(
      "button",
      {
        title: "Show more provisions",
        onclick: showMoreCallback,
        disabled: provisions.length >= total || !provisionsResponse.fulfilled
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
        title: "Delete selected provisions",
        disabled: !selected.size,
        onclick: e => {
          e.redraw = false;
          e.target.disabled = true;
          Promise.all(
            Array.from(selected).map(id =>
              store.deleteResource("provisions", id)
            )
          )
            .then(res => {
              notifications.push("success", `${res.length} provisions deleted`);
              store.fulfill(0, Date.now());
            })
            .catch(err => {
              notifications.push("error", err.message);
              store.fulfill(0, Date.now());
            });
        }
      },
      "Delete"
    )
  ];

  if (window.authorizer.hasAccess("provisions", 3)) {
    buttons.push(
      m(
        "button.primary",
        {
          title: "Create new provision",
          onclick: () => {
            const cb = () => {
              return m(
                putFormComponent,
                Object.assign(
                  {
                    actionHandler: (action, object) => {
                      putActionHandler(action, object, true);
                      overlay.close(cb);
                    }
                  },
                  formData
                )
              );
            };
            overlay.open(cb);
          }
        },
        "New"
      )
    );
  }

  return [
    m(
      "table.table.highlight",
      m("thead", m("tr", labels)),
      m("tbody", rows),
      tfoot
    ),
    m("div.actions-bar", buttons)
  ];
}

const component = {
  view: vnode => {
    document.title = "Provisions - GenieACS";

    function showMore() {
      vnode.state.showCount = (vnode.state.showCount || PAGE_SIZE) + PAGE_SIZE;
      m.redraw();
    }

    function onFilterChanged(filter) {
      const ops = { filter };
      if (vnode.attrs.sort) ops.sort = vnode.attrs.sort;
      m.route.set(m.route.get(), ops);
    }

    function onSortChange(sort) {
      const ops = { sort };
      if (vnode.attrs.filter) ops.filter = vnode.attrs.filter;
      m.route.set(m.route.get(), ops);
    }

    const sort = vnode.attrs.sort ? memoizedJsonParse(vnode.attrs.sort) : {};
    let filter = vnode.attrs.filter ? memoizedParse(vnode.attrs.filter) : true;
    filter = unpackSmartQuery(filter);

    const provisions = store.fetch("provisions", filter, {
      limit: vnode.state.showCount || PAGE_SIZE,
      sort: sort
    });

    const count = store.count("provisions", filter);

    const selected = new Set();
    if (vnode.state.selected) {
      for (const provision of provisions.value) {
        if (vnode.state.selected.has(provision["_id"]))
          selected.add(provision["_id"]);
      }
    }
    vnode.state.selected = selected;

    const downloadUrl = getDownloadUrl(vnode.attrs.filter);

    return [
      m("h1", "Listing provisions"),
      m(filterComponent, {
        resource: "provisions",
        filter: vnode.attrs.filter,
        onChange: onFilterChanged
      }),
      renderTable(
        provisions,
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
