"use strict";

import m from "mithril";

import config from "./config";
import filterComponent from "./filter-component";
import * as store from "./store";
import * as expression from "../common/expression";
import * as notifications from "./notifications";
import memoize from "../common/memoize";
import putForm from "./components/put-form";
import * as overlay from "./overlay";

const PAGE_SIZE = config.ui.pageSize || 10;

const memoizedParse = memoize(expression.parse);

const attributes = [
  { id: "_id", label: "Name" },
  { id: "script", label: "Script", type: "code" }
];

function putActoinHandler(action, object, isNew) {
  if (action === "save") {
    let id = object["_id"];
    delete object["_id"];

    if (!id) return notifications.push("error", "ID can not be empty");

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
      });
  } else {
    throw new Error("Undefined action");
  }
}

let formData = {
  resource: "provisions",
  attributes: attributes
};

const getDownloadUrl = memoize(filter => {
  let cols = {};
  for (let attr of attributes) cols[attr.label] = attr.id;
  return `/api/provisions.csv?${m.buildQueryString({
    filter: filter,
    columns: JSON.stringify(cols)
  })}`;
});

function init(args) {
  if (!window.authorizer.hasAccess("provisions", 2))
    return Promise.reject(
      new Error("You are not authorized to view this page")
    );

  const filter = args.filter;
  return Promise.resolve({ filter });
}

function renderTable(
  provisionsResponse,
  total,
  selected,
  showMoreCallback,
  downloadUrl
) {
  const provisions = provisionsResponse.value;
  const selectAll = m("input", {
    type: "checkbox",
    checked: provisions.length && selected.size === provisions.length,
    onchange: e => {
      for (let provision of provisions)
        if (e.target.checked) selected.add(provision["_id"]);
        else selected.delete(provision["_id"]);
    },
    disabled: !total
  });

  const labels = [selectAll]
    .concat(attributes.map(elem => elem.label))
    .map(l => m("th", l));

  let rows = [];
  for (let provision of provisions) {
    let checkbox = m("input", {
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

    let tds = [m("td", checkbox)];
    for (let attr of attributes)
      if (attr.id == "script")
        tds.push(m("td", { title: provision[attr.id] }, provision[attr.id]));
      else tds.push(m("td", provision[attr.id]));

    tds.push(
      m(
        "td.table-row-links",
        m(
          "a",
          {
            onclick: () => {
              let cb = () => {
                return m(
                  putForm,
                  Object.assign(
                    {
                      base: provision,
                      actionHandler: (action, object) => {
                        overlay.close(cb);
                        putActoinHandler(action, object, false);
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

  if (!rows.length)
    rows.push(
      m("tr.empty", m("td", { colspan: labels.length }, "No provisions"))
    );

  let footerElements = [];
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
            });
        }
      },
      "Delete"
    )
  ];

  if (window.authorizer.hasAccess("provisions", 3))
    buttons.push(
      m(
        "button.primary",
        {
          title: "Create new provision",
          onclick: () => {
            let cb = () => {
              return m(
                putForm,
                Object.assign(
                  {
                    actionHandler: (action, object) => {
                      putActoinHandler(action, object, true);
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
      m.route.set("/provisions", { filter });
    }

    const filter = vnode.attrs.filter
      ? memoizedParse(vnode.attrs.filter)
      : true;

    let provisions = store.fetch("provisions", filter, {
      limit: vnode.state.showCount || PAGE_SIZE
    });

    let count = store.count("provisions", filter);

    let selected = new Set();
    if (vnode.state.selected)
      for (let provision of provisions.value)
        if (vnode.state.selected.has(provision["_id"]))
          selected.add(provision["_id"]);
    vnode.state.selected = selected;

    const downloadUrl = getDownloadUrl(vnode.attrs.filter);

    return [
      m("h1", "Listing provisions"),
      m(filterComponent, {
        predefined: [{ parameter: "_id" }],
        filter: vnode.attrs.filter,
        onChange: onFilterChanged
      }),
      renderTable(provisions, count.value, selected, showMore, downloadUrl)
    ];
  }
};

export { init, component };
