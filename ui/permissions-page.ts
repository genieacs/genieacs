import { Children, ClosureComponent, Component } from "mithril";
import { m } from "./components.ts";
import config from "./config.ts";
import * as store from "./store.ts";
import * as notifications from "./notifications.ts";
import memoize from "../lib/common/memoize.ts";
import putFormComponent from "./put-form-component.ts";
import indexTableComponent from "./index-table-component.ts";
import * as overlay from "./overlay.ts";
import * as smartQuery from "./smart-query.ts";
import { map, parse, stringify } from "../lib/common/expression/parser.ts";
import filterComponent from "./filter-component.ts";

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
      "virtualParameters",
    ],
  },
  { id: "filter", label: "Filter", type: "textarea" },
  {
    id: "access",
    label: "Access",
    type: "combo",
    options: ["1: count", "2: read", "3: write"],
  },
  { id: "validate", label: "Validate", type: "textarea" },
];

const unpackSmartQuery = memoize((query) => {
  return map(query, (e) => {
    if (Array.isArray(e) && e[0] === "FUNC" && e[1] === "Q")
      return smartQuery.unpack("permissions", e[2], e[3]);
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
            filter: "Filter must be valid expression",
          });
        }
      }

      if (object.validate) {
        try {
          object.validate = stringify(memoizedParse(object.validate));
        } catch (err) {
          return void resolve({
            validate: "Validate must be valid expression",
          });
        }
      }

      const id = `${object.role}:${object.resource}:${object.access}`;

      store
        .resourceExists("permissions", id)
        .then((exists) => {
          if (exists && isNew) {
            store.setTimestamp(Date.now());
            return void resolve({ _id: "Permission already exists" });
          }
          if (!exists && !isNew) {
            store.setTimestamp(Date.now());
            return void resolve({ _id: "Permission does not exist" });
          }

          store
            .putResource("permissions", id, object)
            .then(() => {
              notifications.push(
                "success",
                `Permission ${exists ? "updated" : "created"}`,
              );
              store.setTimestamp(Date.now());
              resolve(null);
            })
            .catch(reject);
        })
        .catch(reject);
    } else if (action === "delete") {
      store
        .deleteResource("permissions", object["_id"])
        .then(() => {
          notifications.push("success", "Permission deleted");
          store.setTimestamp(Date.now());
          resolve(null);
        })
        .catch((err) => {
          store.setTimestamp(Date.now());
          reject(err);
        });
    } else {
      reject(new Error("Undefined action"));
    }
  });
}

const formData = {
  resource: "permissions",
  attributes: attributes,
};

const getDownloadUrl = memoize((filter) => {
  const cols = {};
  for (const attr of attributes) cols[attr.label] = attr.id;
  return `api/permissions.csv?${m.buildQueryString({
    filter: stringify(filter),
    columns: JSON.stringify(cols),
  })}`;
});

export function init(
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!window.authorizer.hasAccess("permissions", 2)) {
    return Promise.reject(
      new Error("You are not authorized to view this page"),
    );
  }
  const sort = args.hasOwnProperty("sort") ? "" + args["sort"] : "";
  const filter = args.hasOwnProperty("filter") ? "" + args["filter"] : "";
  return Promise.resolve({ filter, sort });
}

export const component: ClosureComponent = (): Component => {
  return {
    view: (vnode) => {
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
        const _sort = {};
        for (const index of sortAttrs)
          _sort[attributes[Math.abs(index) - 1].id] = Math.sign(index);
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
        sort: sort,
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
        attrs["recordActionsCallback"] = (permission) => {
          const val = permission["access"];
          if (val === 1) permission["access"] = "1: count";
          if (val === 2) permission["access"] = "2: read";
          if (val === 3) permission["access"] = "3: write";
          return [
            m(
              "a",
              {
                onclick: () => {
                  let cb: () => Children = null;
                  const comp = m(
                    putFormComponent,
                    Object.assign(
                      {
                        base: permission,
                        oncreate: (_vnode) => {
                          _vnode.dom.querySelector(
                            "input[name='role']",
                          ).disabled = true;
                          _vnode.dom.querySelector(
                            "select[name='access']",
                          ).disabled = true;
                          _vnode.dom.querySelector(
                            "select[name='resource']",
                          ).disabled = true;
                        },
                        actionHandler: (action, object) => {
                          return new Promise<void>((resolve) => {
                            putActionHandler(action, object, false)
                              .then((errors) => {
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
                              .catch((err) => {
                                notifications.push("error", err.message);
                                resolve();
                              });
                          });
                        },
                      },
                      formData,
                    ),
                  );
                  cb = () => comp;
                  overlay.open(
                    cb,
                    () =>
                      !comp.state["current"]["modified"] ||
                      confirm("You have unsaved changes. Close anyway?"),
                  );
                },
              },
              "Show",
            ),
          ];
        };

        attrs["actionsCallback"] = (selected: Set<string>): Children => {
          return [
            m(
              "button.primary",
              {
                title: "Create new permission",
                onclick: () => {
                  let cb: () => Children = null;
                  const comp = m(
                    putFormComponent,
                    Object.assign(
                      {
                        actionHandler: (action, object) => {
                          return new Promise<void>((resolve) => {
                            putActionHandler(action, object, true)
                              .then((errors) => {
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
                              .catch((err) => {
                                notifications.push("error", err.message);
                                resolve();
                              });
                          });
                        },
                      },
                      formData,
                    ),
                  );
                  cb = () => comp;
                  overlay.open(
                    cb,
                    () =>
                      !comp.state["current"]["modified"] ||
                      confirm("You have unsaved changes. Close anyway?"),
                  );
                },
              },
              "New",
            ),
            m(
              "button.primary",
              {
                title: "Delete selected permissions",
                disabled: !selected.size,
                onclick: (e) => {
                  if (
                    !confirm(
                      `Deleting ${selected.size} permissions. Are you sure?`,
                    )
                  )
                    return;

                  e.redraw = false;
                  e.target.disabled = true;
                  Promise.all(
                    Array.from(selected).map((id) =>
                      store.deleteResource("permissions", id),
                    ),
                  )
                    .then((res) => {
                      notifications.push(
                        "success",
                        `${res.length} permissions deleted`,
                      );
                      store.setTimestamp(Date.now());
                    })
                    .catch((err) => {
                      notifications.push("error", err.message);
                      store.setTimestamp(Date.now());
                    });
                },
              },
              "Delete",
            ),
          ];
        };
      }

      const filterAttrs = {
        resource: "permissions",
        filter: vnode.attrs["filter"],
        onChange: onFilterChanged,
      };

      return [
        m("h1", "Listing permissions"),
        m(filterComponent, filterAttrs),
        m(
          "loading",
          { queries: [permissions, count] },
          m(indexTableComponent, attrs),
        ),
      ];
    },
  };
};
