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
import { Children, ClosureComponent, Component } from "mithril";
import { getIcon } from "./icons";

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
      "users",
      "presets",
      "provisions",
      "virtualParameters"
    ]
  },
  { id: "filter", label: "Filter", type: "textarea" },
  {
    id: "access",
    label: "Access",
    type: "combo",
    options: ["1: count", "2: read", "3: write"]
  },
  { id: "validate", label: "Validate", type: "textarea" }
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

      if (object.filter) {
        try {
          object.filter = stringify(memoizedParse(object.filter));
        } catch (err) {
          return void resolve({
            filter: "Filter must be valid expression"
          });
        }
      }

      if (object.validate) {
        try {
          object.validate = stringify(memoizedParse(object.validate));
        } catch (err) {
          return void resolve({
            validate: "Validate must be valid expression"
          });
        }
      }

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
              notifications.push("success", "Permission created");
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
  const sort = args.hasOwnProperty("sort") ? "" + args["sort"] : "";
  const filter = args.hasOwnProperty("filter") ? "" + args["filter"] : "";
  return Promise.resolve({ filter, sort });
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
        m.route.set("/admin/permissions", ops);
      }

      const sort = vnode.attrs["sort"]
        ? memoizedJsonParse(vnode.attrs["sort"])
        : {};

      const sortAttributes = {};
      for (let i = 0; i < attributes.length; i++) {
        const attr = attributes[i];
        if (!(attr.id === "filter" || attr.id === "validate"))
          sortAttributes[i] = sort[attr.id] || 0;
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
        m.route.set("/admin/permissions", ops);
      }

      let filter = vnode.attrs["filter"]
        ? memoizedParse(vnode.attrs["filter"])
        : true;
      filter = unpackSmartQuery(filter);

      const permissions = store.fetch("permissions", filter, {
        limit: vnode.state["showCount"] || PAGE_SIZE,
        sort: sort
      });

      const count = store.count("permissions", filter);

      const downloadUrl = getDownloadUrl(filter);

      const valueCallback = (attr, permission): Children => {
        if (attr.id === "access") {
          const val = permission["access"];
          if (val === 1) return "1: count";
          else if (val === 2) return "2: read";
          else if (val === 3) return "3: write";
          return val;
        }

        return permission[attr.id];
      };

      const attrs = {};
      attrs["attributes"] = attributes;
      attrs["data"] = permissions.value;
      attrs["total"] = count.value;
      attrs["valueCallback"] = valueCallback;
      attrs["showMoreCallback"] = showMore;
      attrs["sortAttributes"] = sortAttributes;
      attrs["onSortChange"] = onSortChange;
      attrs["downloadUrl"] = downloadUrl;

      if (window.authorizer.hasAccess("permissions", 3)) {
        attrs["recordActionsCallback"] = permission => {
          return [
            m(
              "button",
              {
                title: "Delete permission",
                onclick: () => {
                  if (
                    !confirm(
                      `Deleting ${permission._id} permission. Are you sure?`
                    )
                  )
                    return;

                  putActionHandler("delete", permission).catch(err => {
                    notifications.push("error", err.message);
                  });
                }
              },
              getIcon("remove")
            )
          ];
        };

        attrs["actionsCallback"] = (selected): Children => {
          return [
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
            ),
            m(
              "button.primary",
              {
                title: "Delete selected permissions",
                disabled: !selected.size,
                onclick: e => {
                  if (
                    !confirm(
                      `Deleting ${selected.size} permissions. Are you sure?`
                    )
                  )
                    return;

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
        };
      }

      const filterAttrs = {};
      filterAttrs["resource"] = "permissions";
      filterAttrs["filter"] = vnode.attrs["filter"];
      filterAttrs["onChange"] = onFilterChanged;

      return [
        m("h1", "Listing permissions"),
        m(filterComponent, filterAttrs),
        m(indexTableComponent, attrs)
      ];
    }
  };
};
