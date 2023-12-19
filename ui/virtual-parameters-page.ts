import { ClosureComponent, Component, Children } from "mithril";
import { m } from "./components.ts";
import config from "./config.ts";
import filterComponent from "./filter-component.ts";
import * as store from "./store.ts";
import * as notifications from "./notifications.ts";
import memoize from "../lib/common/memoize.ts";
import putFormComponent from "./put-form-component.ts";
import indexTableComponent from "./index-table-component.ts";
import * as overlay from "./overlay.ts";
import * as smartQuery from "./smart-query.ts";
import { map, parse, stringify } from "../lib/common/expression/parser.ts";
import { loadCodeMirror } from "./dynamic-loader.ts";

const PAGE_SIZE = config.ui.pageSize || 10;

const memoizedParse = memoize(parse);
const memoizedJsonParse = memoize(JSON.parse);

const attributes = [
  { id: "_id", label: "Name" },
  { id: "script", label: "Script", type: "code" },
];

const unpackSmartQuery = memoize((query) => {
  return map(query, (e) => {
    if (Array.isArray(e) && e[0] === "FUNC" && e[1] === "Q")
      return smartQuery.unpack("virtualParameters", e[2], e[3]);
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

      store
        .resourceExists("virtualParameters", id)
        .then((exists) => {
          if (exists && isNew) {
            store.setTimestamp(Date.now());
            return void resolve({ _id: "Virtual parameter already exists" });
          }

          if (!exists && !isNew) {
            store.setTimestamp(Date.now());
            return void resolve({ _id: "Virtual parameter does not exist" });
          }

          store
            .putResource("virtualParameters", id, object)
            .then(() => {
              notifications.push(
                "success",
                `Virtual parameter ${exists ? "updated" : "created"}`,
              );
              store.setTimestamp(Date.now());
              resolve(null);
            })
            .catch((err) => {
              if (err["code"] === 400 && err["response"]) {
                reject(new Error(err["response"]));
                return;
              }
              reject(err);
            });
        })
        .catch(reject);
    } else if (action === "delete") {
      store
        .deleteResource("virtualParameters", object["_id"])
        .then(() => {
          notifications.push("success", "Virtual parameter deleted");
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
  resource: "virtualParameters",
  attributes: attributes,
};

const getDownloadUrl = memoize((filter) => {
  const cols = {};
  for (const attr of attributes) cols[attr.label] = attr.id;
  return `api/virtualParameters.csv?${m.buildQueryString({
    filter: stringify(filter),
    columns: JSON.stringify(cols),
  })}`;
});

export function init(
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!window.authorizer.hasAccess("virtualParameters", 2)) {
    return Promise.reject(
      new Error("You are not authorized to view this page"),
    );
  }

  const sort = args.hasOwnProperty("sort") ? "" + args["sort"] : "";
  const filter = args.hasOwnProperty("filter") ? "" + args["filter"] : "";

  return new Promise((resolve, reject) => {
    loadCodeMirror()
      .then(() => {
        resolve({ filter, sort });
      })
      .catch(reject);
  });
}

export const component: ClosureComponent = (): Component => {
  return {
    view: (vnode) => {
      document.title = "Virtual Parameters - GenieACS";

      function showMore(): void {
        vnode.state["showCount"] =
          (vnode.state["showCount"] || PAGE_SIZE) + PAGE_SIZE;
        m.redraw();
      }

      function onFilterChanged(filter): void {
        const ops = { filter };
        if (vnode.attrs["sort"]) ops["sort"] = vnode.attrs["sort"];
        m.route.set("/admin/virtualParameters", ops);
      }

      const sort = vnode.attrs["sort"]
        ? memoizedJsonParse(vnode.attrs["sort"])
        : {};

      const sortAttributes = {};
      for (let i = 0; i < attributes.length; i++)
        sortAttributes[i] = sort[attributes[i].id] || 0;

      function onSortChange(sortAttrs): void {
        const _sort = {};
        for (const index of sortAttrs)
          _sort[attributes[Math.abs(index) - 1].id] = Math.sign(index);
        const ops = { sort: JSON.stringify(_sort) };
        if (vnode.attrs["filter"]) ops["filter"] = vnode.attrs["filter"];
        m.route.set("/admin/virtualParameters", ops);
      }

      let filter = vnode.attrs["filter"]
        ? memoizedParse(vnode.attrs["filter"])
        : true;
      filter = unpackSmartQuery(filter);

      const virtualParameters = store.fetch("virtualParameters", filter, {
        limit: vnode.state["showCount"] || PAGE_SIZE,
        sort: sort,
      });

      const count = store.count("virtualParameters", filter);

      const downloadUrl = getDownloadUrl(filter);

      const attrs = {};
      attrs["attributes"] = attributes;
      attrs["data"] = virtualParameters.value;
      attrs["total"] = count.value;
      attrs["showMoreCallback"] = showMore;
      attrs["sortAttributes"] = sortAttributes;
      attrs["onSortChange"] = onSortChange;
      attrs["downloadUrl"] = downloadUrl;
      attrs["recordActionsCallback"] = (virtualParameter) => {
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
                      base: virtualParameter,
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

      if (window.authorizer.hasAccess("virtualParameters", 3)) {
        attrs["actionsCallback"] = (selected: Set<string>): Children => {
          return [
            m(
              "button.primary",
              {
                title: "Create new virtual parameter",
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
                title: "Delete selected virtual parameters",
                disabled: !selected.size,
                onclick: (e) => {
                  if (
                    !confirm(
                      `Deleting ${selected.size} virtual parameters. Are you sure?`,
                    )
                  )
                    return;

                  e.redraw = false;
                  e.target.disabled = true;
                  Promise.all(
                    Array.from(selected).map((id) =>
                      store.deleteResource("virtualParameters", id),
                    ),
                  )
                    .then((res) => {
                      notifications.push(
                        "success",
                        `${res.length} virtual parameters deleted`,
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
        resource: "virtualParameters",
        filter: vnode.attrs["filter"],
        onChange: onFilterChanged,
      };

      return [
        m("h1", "Listing virtual parameters"),
        m(filterComponent, filterAttrs),
        m(
          "loading",
          { queries: [virtualParameters, count] },
          m(indexTableComponent, attrs),
        ),
      ];
    },
  };
};
