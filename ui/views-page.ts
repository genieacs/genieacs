import { ClosureComponent, Component, Children } from "mithril";
import { m } from "./components.ts";
import * as config from "./config.ts";
import filterComponent from "./filter-component.ts";
import * as store from "./store.ts";
import * as notifications from "./notifications.ts";
import memoize from "../lib/common/memoize.ts";
import putFormComponent from "./put-form-component.ts";
import indexTableComponent from "./index-table-component.ts";
import * as overlay from "./overlay.ts";
import * as smartQuery from "./smart-query.ts";
import Expression from "../lib/common/expression.ts";
import { loadCodeMirror } from "./dynamic-loader.ts";

const PAGE_SIZE = config.pageSize || 10;

const memoizedParse = memoize(Expression.parse);
const memoizedJsonParse = memoize(JSON.parse);

const attributes = [
  { id: "_id", label: "Name" },
  { id: "script", label: "Script", type: "code" },
];

const unpackSmartQuery = memoize((query: Expression) => {
  return query.map((e) => {
    if (
      e instanceof Expression.FunctionCall &&
      e.name === "Q" &&
      e.args.length >= 2
    ) {
      const arg0 =
        e.args[0] instanceof Expression.Literal ? e.args[0].value : null;
      const arg1 =
        e.args[1] instanceof Expression.Literal ? e.args[1].value : null;
      return smartQuery.unpack("views", arg0 as string, arg1 as string);
    }
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
        .resourceExists("views", id)
        .then((exists) => {
          if (exists && isNew) {
            store.setTimestamp(Date.now());
            return void resolve({ _id: "View already exists" });
          }

          if (!exists && !isNew) {
            store.setTimestamp(Date.now());
            return void resolve({ _id: "View does not exist" });
          }

          store
            .putResource("views", id, object)
            .then(() => {
              notifications.push(
                "success",
                `View ${exists ? "updated" : "created"}`,
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
      if (!confirm("Deleting view. Are you sure?")) return void resolve(null);
      store
        .deleteResource("views", object["_id"])
        .then(() => {
          notifications.push("success", "View deleted");
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
  resource: "views",
  attributes: attributes,
};

const getDownloadUrl = memoize((filter: Expression) => {
  const cols = {};
  for (const attr of attributes) cols[attr.label] = attr.id;
  return `api/views.csv?${m.buildQueryString({
    filter: filter.toString(),
    columns: JSON.stringify(cols),
  })}`;
});

export function init(
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!window.authorizer.hasAccess("views", 2)) {
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
      document.title = "Views - GenieACS";

      function showMore(): void {
        vnode.state["showCount"] =
          (vnode.state["showCount"] || PAGE_SIZE) + PAGE_SIZE;
        m.redraw();
      }

      function onFilterChanged(filter): void {
        const ops = { filter };
        if (vnode.attrs["sort"]) ops["sort"] = vnode.attrs["sort"];
        m.route.set("/views", ops);
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
        m.route.set("/views", ops);
      }

      let filter: Expression = vnode.attrs["filter"]
        ? memoizedParse(vnode.attrs["filter"])
        : new Expression.Literal(true);
      filter = unpackSmartQuery(filter);

      const views = store.fetch("views", filter, {
        limit: vnode.state["showCount"] || PAGE_SIZE,
        sort: sort,
      });

      const count = store.count("views", filter);

      const downloadUrl = getDownloadUrl(filter);

      const attrs = {};
      attrs["attributes"] = attributes;
      attrs["data"] = views.value;
      attrs["total"] = count.value;
      attrs["showMoreCallback"] = showMore;
      attrs["sortAttributes"] = sortAttributes;
      attrs["onSortChange"] = onSortChange;
      attrs["downloadUrl"] = downloadUrl;
      attrs["recordActionsCallback"] = (cmp) => {
        return [
          m(
            "button.text-cyan-700 hover:text-cyan-900 font-medium",
            {
              onclick: () => {
                let cb: () => Children = null;
                const comp = m(
                  putFormComponent,
                  Object.assign(
                    {
                      base: cmp,
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

      if (window.authorizer.hasAccess("views", 3)) {
        attrs["actionsCallback"] = (selected: Set<string>): Children => {
          return [
            m(
              "button.px-4 py-2 border border-stone-300 shadow-sm text-sm font-medium rounded-md text-stone-700 bg-white hover:bg-stone-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed",
              {
                title: "Create new view",
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
              "button.px-4 py-2 border border-stone-300 shadow-sm text-sm font-medium rounded-md text-stone-700 bg-white hover:bg-stone-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed",
              {
                title: "Delete selected views",
                disabled: !selected.size,
                onclick: (e) => {
                  if (
                    !confirm(`Deleting ${selected.size} views. Are you sure?`)
                  )
                    return;

                  e.redraw = false;
                  e.target.disabled = true;
                  Promise.all(
                    Array.from(selected).map((id) =>
                      store.deleteResource("views", id),
                    ),
                  )
                    .then((res) => {
                      notifications.push(
                        "success",
                        `${res.length} views deleted`,
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
        resource: "views",
        filter: vnode.attrs["filter"],
        onChange: onFilterChanged,
      };

      return [
        m("h1.text-xl font-medium text-stone-900 mb-5", "Listing views"),
        m(filterComponent, filterAttrs),
        m(
          "loading",
          { queries: [views, count] },
          m(indexTableComponent, attrs),
        ),
      ];
    },
  };
};
