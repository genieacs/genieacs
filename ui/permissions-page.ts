"use strict";

import { m } from "./components";

import config from "./config";
import * as store from "./store";
import * as notifications from "./notifications";
import memoize from "../lib/common/memoize";
import putFormComponent from "./put-form-component";
import * as overlay from "./overlay";
import * as smartQuery from "./smart-query";
import { validators } from "../lib/common/authorizer";
import { map, parse, stringify } from "../lib/common/expression-parser";
import filterComponent from "./filter-component";
import { Children, ClosureComponent, Component } from "mithril";

const PAGE_SIZE = config.ui.pageSize || 10;

const memoizedParse = memoize(parse);
const memoizedJsonParse = memoize(JSON.parse);

const attributes = [
  { id: "role", label: "Role" },
  {
    id: "resource",
    label: "Resource",
    type: "combo",
    options: [
      "config",
      "devices",
      "faults",
      "files",
      "permissions",
      "presets",
      "provisions",
      "virtualParameters"
    ]
  },
  { id: "filter", label: "Filter", unsortable: true },
  {
    id: "access",
    label: "Access",
    type: "combo",
    options: ["1: count", "2: read", "3: write"]
  },
  {
    id: "validate",
    label: "Validators",
    type: "multi",
    options: Object.keys(validators),
    unsortable: true
  }
];

const unpackSmartQuery = memoize(query => {
  return map(query, e => {
    if (Array.isArray(e) && e[0] === "FUNC" && e[1] === "Q")
      return smartQuery.unpack("permissions", e[2], e[3]);
    return e;
  });
});

interface ValidationErrors {
  [prop: string]: string;
}

function putActionHandler(action, _object): Promise<ValidationErrors> {
  return new Promise((resolve, reject) => {
    const object = Object.assign({}, _object);
    if (action === "save") {
      if (!object.role) return void resolve({ role: "Role can not be empty" });
      if (!object.resource)
        return void resolve({ resource: "Resource can not be empty" });
      if (!object.access)
        return void resolve({ access: "Access can not be empty" });

      if (object.access === "3: write") object.access = 3;
      else if (object.access === "2: read") object.access = 2;
      else if (object.access === "1: count") object.access = 1;
      else return void resolve({ access: "Invalid access level" });

      object.filter = object.filter || "";
      try {
        memoizedParse(object.filter);
      } catch (err) {
        return void resolve({
          filter: "Filter must be valid expression"
        });
      }

      object.validate = (object.validate || []).join(",");

      const id = `${object.role}:${object.resource}:${object.access}`;

      store
        .resourceExists("permissions", id)
        .then(exists => {
          if (exists) {
            store.fulfill(0, Date.now());
            return void resolve({ _id: "Permission already exists" });
          }

          store
            .putResource("permissions", id, object)
            .then(() => {
              notifications.push("success", `Permission created"}`);
              store.fulfill(0, Date.now());
              resolve();
            })
            .catch(reject);
        })
        .catch(reject);
    } else if (action === "delete") {
      store
        .deleteResource("permissions", object["_id"])
        .then(() => {
          notifications.push("success", "Permission deleted");
          store.fulfill(0, Date.now());
          resolve();
        })
        .catch(err => {
          store.fulfill(0, Date.now());
          reject(err);
        });
    } else {
      reject(new Error("Undefined action"));
    }
  });
}

const formData = {
  resource: "permissions",
  attributes: attributes
};

const getDownloadUrl = memoize(filter => {
  const cols = {};
  for (const attr of attributes) cols[attr.label] = attr.id;
  return `/api/permissions.csv?${m.buildQueryString({
    filter: stringify(filter),
    columns: JSON.stringify(cols)
  })}`;
});

export function init(args): Promise<{}> {
  if (!window.authorizer.hasAccess("permissions", 2)) {
    return Promise.reject(
      new Error("You are not authorized to view this page")
    );
  }
  const sort = args.sort;
  const filter = args.filter;
  return Promise.resolve({ filter, sort });
}

function renderTable(
  permissionsResponse,
  total,
  selected,
  showMoreCallback,
  downloadUrl,
  sort,
  onSortChange
): Children {
  const permissions = permissionsResponse.value;
  const selectAll = m("input", {
    type: "checkbox",
    checked: permissions.length && selected.size === permissions.length,
    onchange: e => {
      for (const permission of permissions) {
        if (e.target.checked) selected.add(permission["_id"]);
        else selected.delete(permission["_id"]);
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
  for (const permission of permissions) {
    const checkbox = m("input", {
      type: "checkbox",
      checked: selected.has(permission["_id"]),
      onchange: e => {
        if (e.target.checked) selected.add(permission["_id"]);
        else selected.delete(permission["_id"]);
      },
      onclick: e => {
        e.stopPropagation();
        e.redraw = false;
      }
    });

    const tds = [m("td", checkbox)];
    for (const attr of attributes) {
      let val = permission[attr.id];
      if (attr.id === "access") {
        if (val === 1) val = "1: count";
        else if (val === 2) val = "2: read";
        else if (val === 3) val = "3: write";
      }
      tds.push(m("td", val));
    }

    tds.push(
      m(
        "td.table-row-links",
        m(
          "button",
          {
            title: "Delete permission",
            onclick: () => {
              if (
                !confirm(`Deleting ${permission._id} permission. Are you sure?`)
              )
                return;

              putActionHandler("delete", permission).catch(err => {
                throw err;
              });
            }
          },
          "✕"
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

            if (!selected.delete(permission["_id"]))
              selected.add(permission["_id"]);
          }
        },
        tds
      )
    );
  }

  if (!rows.length) {
    rows.push(
      m("tr.empty", m("td", { colspan: labels.length }, "No permissions"))
    );
  }

  const footerElements = [];
  if (total != null) footerElements.push(`${permissions.length}/${total}`);
  else footerElements.push(`${permissions.length}`);

  footerElements.push(
    m(
      "button",
      {
        title: "Show more permissions",
        onclick: showMoreCallback,
        disabled: permissions.length >= total || !permissionsResponse.fulfilled
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
        title: "Delete selected permissions",
        disabled: !selected.size,
        onclick: e => {
          e.redraw = false;
          e.target.disabled = true;
          Promise.all(
            Array.from(selected).map(id =>
              store.deleteResource("permissions", id)
            )
          )
            .then(res => {
              notifications.push(
                "success",
                `${res.length} permissions deleted`
              );
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

  if (window.authorizer.hasAccess("permissions", 3)) {
    buttons.push(
      m(
        "button.primary",
        {
          title: "Create new permission",
          onclick: () => {
            const cb = (): Children => {
              return m(
                putFormComponent,
                Object.assign(
                  {
                    actionHandler: (action, object) => {
                      return new Promise(resolve => {
                        putActionHandler(action, object)
                          .then(errors => {
                            const errorList = errors
                              ? Object.values(errors)
                              : [];
                            if (errorList.length) {
                              for (const err of errorList)
                                notifications.push("error", err);
                            } else {
                              overlay.close(cb);
                            }
                            resolve();
                          })
                          .catch(err => {
                            notifications.push("error", err.message);
                            resolve();
                          });
                      });
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

export const component: ClosureComponent = (): Component => {
  return {
    view: vnode => {
      document.title = "Permissions - GenieACS";

      function showMore(): void {
        vnode.state["showCount"] =
          (vnode.state["showCount"] || PAGE_SIZE) + PAGE_SIZE;
        m.redraw();
      }

      function onFilterChanged(filter): void {
        const ops = { filter };
        if (vnode.attrs["sort"]) ops["sort"] = vnode.attrs["sort"];
        m.route.set(m.route.get(), ops);
      }

      function onSortChange(sort): void {
        const ops = { sort };
        if (vnode.attrs["filter"]) ops["filter"] = vnode.attrs["filter"];
        m.route.set(m.route.get(), ops);
      }

      const sort = vnode.attrs["sort"]
        ? memoizedJsonParse(vnode.attrs["sort"])
        : {};
      let filter = vnode.attrs["filter"]
        ? memoizedParse(vnode.attrs["filter"])
        : true;
      filter = unpackSmartQuery(filter);

      const permissions = store.fetch("permissions", filter, {
        limit: vnode.state["showCount"] || PAGE_SIZE,
        sort: sort
      });

      const count = store.count("permissions", filter);

      const selected = new Set();
      if (vnode.state["selected"]) {
        for (const permission of permissions.value) {
          if (vnode.state["selected"].has(permission["_id"]))
            selected.add(permission["_id"]);
        }
      }
      vnode.state["selected"] = selected;

      const downloadUrl = getDownloadUrl(filter);

      const attrs = {};
      attrs["resource"] = "permissions";
      attrs["filter"] = vnode.attrs["filter"];
      attrs["onChange"] = onFilterChanged;

      return [
        m("h1", "Listing permissions"),
        m(filterComponent, attrs),
        renderTable(
          permissions,
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
};
