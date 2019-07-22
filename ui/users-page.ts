/**
 * Copyright 2013-2019  GenieACS Inc.
 *
 * This file is part of GenieACS.
 *
 * GenieACS is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * GenieACS is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with GenieACS.  If not, see <http://www.gnu.org/licenses/>.
 */

import { m } from "./components";
import config from "./config";
import * as store from "./store";
import * as notifications from "./notifications";
import memoize from "../lib/common/memoize";
import putFormComponent from "./put-form-component";
import indexTableComponent from "./index-table-component";
import * as overlay from "./overlay";
import * as smartQuery from "./smart-query";
import { map, parse, stringify } from "../lib/common/expression-parser";
import filterComponent from "./filter-component";
import changePasswordComponent from "./change-password-component";
import { Children, ClosureComponent, Component } from "mithril";

const PAGE_SIZE = config.ui.pageSize || 10;

const memoizedParse = memoize(parse);
const memoizedJsonParse = memoize(JSON.parse);

const attributes = [
  { id: "_id", label: "Username" },
  { id: "roles", label: "Roles", type: "multi", options: [] }
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
      const password = object["password"];
      const confirm = object["confirm"];
      delete object["_id"];
      delete object["password"];
      delete object["confirm"];

      if (!id) return void resolve({ _id: "ID can not be empty" });

      if (isNew) {
        if (!password) {
          return void resolve({ password: "Password can not be empty" });
        } else if (password !== confirm) {
          return void resolve({
            confirm: "Confirm password doesn't match password"
          });
        }
      }

      if (!Array.isArray(object.roles) || !object.roles.length)
        return void resolve({ roles: "Role(s) must be selected" });

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
              if (isNew) {
                store
                  .changePassword(id, password)
                  .then(() => {
                    notifications.push("success", "User created");
                    store.fulfill(0, Date.now());
                    resolve();
                  })
                  .catch(reject);
              } else {
                notifications.push("success", "User updated");
                store.fulfill(0, Date.now());
                resolve();
              }
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

const getDownloadUrl = memoize(filter => {
  const cols = {};
  for (const attr of attributes) cols[attr.label] = attr.id;

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

  const sort = args.hasOwnProperty("sort") ? "" + args["sort"] : "";
  const filter = args.hasOwnProperty("filter") ? "" + args["filter"] : "";
  return Promise.resolve({ filter, sort });
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
        m.route.set("/admin/users", ops);
      }

      const sort = vnode.attrs["sort"]
        ? memoizedJsonParse(vnode.attrs["sort"])
        : {};

      const sortAttributes = {};
      for (let i = 0; i < attributes.length; i++) {
        const attr = attributes[i];
        if (attr.id !== "roles")
          sortAttributes[i] = sort[attributes[i].id] || 0;
      }

      function onSortChange(sortAttrs): void {
        const _sort = Object.assign({}, sort);
        for (const [index, direction] of Object.entries(sortAttrs)) {
          // Changing the priority of columns
          delete _sort[attributes[index].id];
          _sort[attributes[index].id] = direction;
        }

        const ops = { sort: JSON.stringify(_sort) };
        if (vnode.attrs["filter"]) ops["filter"] = vnode.attrs["filter"];
        m.route.set("/admin/users", ops);
      }

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

      const downloadUrl = getDownloadUrl(filter);

      const canWrite = window.authorizer.hasAccess("users", 3);

      const attrs = {};
      attrs["attributes"] = attributes;
      attrs["data"] = users.value;
      attrs["total"] = count.value;
      attrs["showMoreCallback"] = showMore;
      attrs["sortAttributes"] = sortAttributes;
      attrs["onSortChange"] = onSortChange;
      attrs["downloadUrl"] = downloadUrl;
      attrs["recordActionsCallback"] = user => {
        return [
          m(
            "a",
            {
              onclick: () => {
                const cb = (): Children => {
                  const children = [
                    m(
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
                        {
                          resource: "users",
                          attributes: attributes
                        }
                      )
                    )
                  ];

                  if (canWrite) {
                    children.push(m("hr"));
                    const _attrs = {
                      noAuth: true,
                      username: user._id,
                      onPasswordChange: () => {
                        overlay.close(cb);
                        m.redraw();
                      }
                    };
                    children.push(m(changePasswordComponent, _attrs));
                  }

                  return children;
                };
                overlay.open(cb);
              }
            },
            "Show"
          )
        ];
      };

      if (canWrite) {
        const formData = {
          resource: "users",
          attributes: [
            attributes[0],
            { id: "password", label: "Password", type: "password" },
            { id: "confirm", label: "Confirm password", type: "password" },
            attributes[1]
          ]
        };
        attrs["actionsCallback"] = (selected): Children => {
          return [
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
            ),
            m(
              "button.primary",
              {
                title: "Delete selected users",
                disabled: !selected.size,
                onclick: e => {
                  if (
                    !confirm(`Deleting ${selected.size} users. Are you sure?`)
                  )
                    return;

                  e.redraw = false;
                  e.target.disabled = true;
                  Promise.all(
                    Array.from(selected).map(id =>
                      store.deleteResource("users", id)
                    )
                  )
                    .then(res => {
                      notifications.push(
                        "success",
                        `${res.length} users deleted`
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
        };
      }

      const filterAttrs = {};
      filterAttrs["resource"] = "users";
      filterAttrs["filter"] = vnode.attrs["filter"];
      filterAttrs["onChange"] = onFilterChanged;

      return [
        m("h1", "Listing users"),
        m(filterComponent, filterAttrs),
        m(indexTableComponent, attrs)
      ];
    }
  };
};
