"use strict";

import { m } from "./components";

import config from "./config";
import * as store from "./store";
import * as notifications from "./notifications";
import memoize from "../lib/common/memoize";
import putFormComponent from "./put-form-component";
import * as overlay from "./overlay";
import * as smartQuery from "./smart-query";
import { map, parse, stringify } from "../lib/common/expression-parser";
import filterComponent from "./filter-component";
import { Children, ClosureComponent, Component } from "mithril";

const PAGE_SIZE = config.ui.pageSize || 10;

const memoizedParse = memoize(parse);
const memoizedJsonParse = memoize(JSON.parse);

const attributes = [
  { id: "_id", label: "Username" },
  { id: "password", label: "Password", type: "password", unsortable: true },
  {
    id: "roles",
    label: "Roles",
    type: "multi",
    options: [],
    unsortable: true
  }
];

const unpackSmartQuery = memoize(query => {
  return map(query, e => {
    if (Array.isArray(e) && e[0] === "FUNC" && e[1] === "Q")
      return smartQuery.unpack("users", e[2], e[3]);
    return e;
  });
});

interface ValidationErrors {
  [prop: string]: string;
}

function putActionHandler(action, _object, isNew): Promise<ValidationErrors> {
  return new Promise((resolve, reject) => {
    const object = Object.assign({}, _object);
    if (action === "save") {
      const id = object["_id"];
      delete object["_id"];

      if (!id) return void resolve({ _id: "ID can not be empty" });

      if (!Array.isArray(object.roles) || !object.roles.length)
        return void resolve({ roles: "Role(s) must be selected" });

      if (typeof object.password !== "string" || !object.password.length) {
        if (isNew)
          return void resolve({ password: "Password can not be empty" });
        else delete object.password;
      }

      object.roles = object.roles.join(",");

      store
        .resourceExists("users", id)
        .then(exists => {
          if (exists && isNew) {
            store.fulfill(0, Date.now());
            return void resolve({ _id: "User already exists" });
          }

          if (!exists && !isNew) {
            store.fulfill(0, Date.now());
            return void resolve({ _id: "User does not exist" });
          }

          store
            .putResource("users", id, object)
            .then(() => {
              notifications.push(
                "success",
                `User ${exists ? "updated" : "created"}`
              );
              store.fulfill(0, Date.now());
              resolve();
            })
            .catch(reject);
        })
        .catch(reject);
    } else if (action === "delete") {
      store
        .deleteResource("users", object["_id"])
        .then(() => {
          notifications.push("success", "User deleted");
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
  resource: "users",
  attributes: attributes
};

const getDownloadUrl = memoize(filter => {
  const cols = {};
  for (const attr of attributes)
    if (attr.id !== "password") cols[attr.label] = attr.id;

  return `/api/users.csv?${m.buildQueryString({
    filter: stringify(filter),
    columns: JSON.stringify(cols)
  })}`;
});

export function init(args): Promise<{}> {
  if (!window.authorizer.hasAccess("users", 2)) {
    return Promise.reject(
      new Error("You are not authorized to view this page")
    );
  }

  const sort = args.sort;
  const filter = args.filter;
  return Promise.resolve({ filter, sort });
}

function renderTable(
  usersResponse,
  total,
  selected,
  showMoreCallback,
  downloadUrl,
  sort,
  onSortChange
): Children {
  const users = usersResponse.value;
  const selectAll = m("input", {
    type: "checkbox",
    checked: users.length && selected.size === users.length,
    onchange: e => {
      for (const user of users) {
        if (e.target.checked) selected.add(user["_id"]);
        else selected.delete(user["_id"]);
      }
    },
    disabled: !total
  });

  const labels = [m("th", selectAll)];
  for (const attr of attributes) {
    if (attr.id === "password") continue;

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
  for (const user of users) {
    const checkbox = m("input", {
      type: "checkbox",
      checked: selected.has(user["_id"]),
      onchange: e => {
        if (e.target.checked) selected.add(user["_id"]);
        else selected.delete(user["_id"]);
      },
      onclick: e => {
        e.stopPropagation();
        e.redraw = false;
      }
    });

    const tds = [m("td", checkbox)];
    for (const attr of attributes)
      if (attr.id !== "password") tds.push(m("td", user[attr.id]));

    tds.push(
      m(
        "td.table-row-links",
        m(
          "a",
          {
            onclick: () => {
              const cb = (): Children => {
                return m(
                  putFormComponent,
                  Object.assign(
                    {
                      base: {
                        _id: user._id,
                        roles: user.roles.split(",")
                      },
                      actionHandler: (action, object) => {
                        return new Promise(resolve => {
                          putActionHandler(action, object, false)
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

            if (!selected.delete(user["_id"])) selected.add(user["_id"]);
          }
        },
        tds
      )
    );
  }

  if (!rows.length)
    rows.push(m("tr.empty", m("td", { colspan: labels.length }, "No users")));

  const footerElements = [];
  if (total != null) footerElements.push(`${users.length}/${total}`);
  else footerElements.push(`${users.length}`);

  footerElements.push(
    m(
      "button",
      {
        title: "Show more users",
        onclick: showMoreCallback,
        disabled: users.length >= total || !usersResponse.fulfilled
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
        title: "Delete selected users",
        disabled: !selected.size,
        onclick: e => {
          e.redraw = false;
          e.target.disabled = true;
          Promise.all(
            Array.from(selected).map(id => store.deleteResource("users", id))
          )
            .then(res => {
              notifications.push("success", `${res.length} users deleted`);
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

  if (window.authorizer.hasAccess("users", 3)) {
    buttons.push(
      m(
        "button.primary",
        {
          title: "Create new user",
          onclick: () => {
            const cb = (): Children => {
              return m(
                putFormComponent,
                Object.assign(
                  {
                    actionHandler: (action, object) => {
                      return new Promise(resolve => {
                        putActionHandler(action, object, true)
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
      document.title = "Users - GenieACS";

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

      const users = store.fetch("users", filter, {
        limit: vnode.state["showCount"] || PAGE_SIZE,
        sort: sort
      });

      const count = store.count("users", filter);

      // Getting the roles
      const permissions = store.fetch("permissions", true);
      if (permissions.fulfilled) {
        for (const attr of attributes) {
          if (attr.id === "roles")
            attr.options = [...new Set(permissions.value.map(p => p.role))];
        }
      }

      const selected = new Set();
      if (vnode.state["selected"]) {
        for (const user of users.value) {
          if (vnode.state["selected"].has(user["_id"]))
            selected.add(user["_id"]);
        }
      }
      vnode.state["selected"] = selected;

      const downloadUrl = getDownloadUrl(filter);

      const attrs = {};
      attrs["resource"] = "users";
      attrs["filter"] = vnode.attrs["filter"];
      attrs["onChange"] = onFilterChanged;

      return [
        m("h1", "Listing users"),
        m(filterComponent, attrs),
        renderTable(
          users,
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
