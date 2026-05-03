import { Children, ClosureComponent, Component, VnodeDOM } from "mithril";
import { m } from "./components.ts";
import { pageSize as PAGE_SIZE } from "./config.ts";
import * as store from "./store.ts";
import { deleteResource, resourceExists, putResource } from "./api-client.ts";
import * as notifications from "./notifications.ts";
import memoize from "../lib/common/memoize.ts";
import { navigate } from "./router.ts";
import putFormComponent from "./put-form-component.ts";
import indexTableComponent, {
  IndexTableAttrs,
} from "./index-table-component.ts";
import * as overlay from "./overlay.ts";
import * as smartQuery from "./smart-query.ts";
import Expression from "../lib/common/expression.ts";
import filterComponent from "./filter-component.ts";

const memoizedParse = memoize((str) => Expression.parse(str));

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
      "views",
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

function getExcerpt(text: string, maxLength = 80, maxLines = 10): string[] {
  let lines: string[] = text?.split("\n", maxLines + 1) ?? [""];

  if (lines.length > maxLines) {
    lines.pop();
    lines[maxLines - 1] = "\ufe19";
  }

  lines = lines.map((l) => {
    if (l.length <= maxLength) return l;
    return l.slice(0, maxLength - 1) + "\u2026";
  });

  return lines;
}

const unpackSmartQuery = memoize((query: Expression) => {
  return query.evaluate((e) => {
    if (e instanceof Expression.FunctionCall) {
      if (e.name === "Q") {
        if (
          e.args[0] instanceof Expression.Literal &&
          e.args[1] instanceof Expression.Literal
        ) {
          return smartQuery.unpack(
            "permissions",
            e.args[0].value as string,
            e.args[1].value as string,
          );
        }
      }
    }
    return e;
  });
});

interface ValidationErrors {
  [prop: string]: string;
}

function putActionHandler(
  action: string,
  _object: Record<string, any>,
  isNew: boolean,
): Promise<ValidationErrors | null> {
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
          object.filter = memoizedParse(object.filter).toString();
        } catch {
          return void resolve({
            filter: "Filter must be valid expression",
          });
        }
      }

      if (object.validate) {
        try {
          object.validate = memoizedParse(object.validate).toString();
        } catch {
          return void resolve({
            validate: "Validate must be valid expression",
          });
        }
      }

      const id = `${object.role}:${object.resource}:${object.access}`;

      resourceExists("permissions", id)
        .then((exists): void => {
          if (exists && isNew) {
            store.setTimestamp(Date.now());
            return void resolve({ _id: "Permission already exists" });
          }
          if (!exists && !isNew) {
            store.setTimestamp(Date.now());
            return void resolve({ _id: "Permission does not exist" });
          }

          putResource("permissions", id, object)
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
      if (!confirm("Deleting permission. Are you sure?"))
        return void resolve(null);
      deleteResource("permissions", object["_id"])
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

const getDownloadUrl = memoize((filter: Expression) => {
  const cols: Record<string, string> = {};
  for (const attr of attributes) cols[attr.label] = attr.id;
  return `/api/permissions.csv?${m.buildQueryString({
    filter: filter.toString(),
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
  let filter: Expression | undefined;
  let sort: Record<string, number> | undefined;
  if (args.hasOwnProperty("filter"))
    filter = Expression.parse(args["filter"] as string);
  if (args.hasOwnProperty("sort")) sort = JSON.parse(args["sort"] as string);
  return Promise.resolve({ filter, sort });
}

interface Attrs {
  filter?: Expression;
  sort?: Record<string, number>;
}

export const component: ClosureComponent<Attrs> = (): Component<Attrs> => {
  let showCount: number;

  return {
    view: (vnode) => {
      document.title = "Permissions - GenieACS";

      function showMore(): void {
        showCount = (showCount || PAGE_SIZE) + PAGE_SIZE;
        m.redraw();
      }

      function onFilterChanged(filter: Expression): void {
        const ops: Record<string, string> = {};
        if (!(filter instanceof Expression.Literal && filter.value))
          ops["filter"] = filter.toString();
        if (vnode.attrs.sort) ops["sort"] = JSON.stringify(vnode.attrs.sort);
        navigate("/permissions", ops).catch(console.error);
      }

      const sort = vnode.attrs.sort || {};

      const sortAttributes: Record<number, number> = {};
      for (let i = 0; i < attributes.length; i++) {
        const attr = attributes[i];
        if (!(attr.id === "filter" || attr.id === "validate"))
          sortAttributes[i] = sort[attr.id] || 0;
      }

      function onSortChange(sortAttrs: number[]): void {
        const _sort: Record<string, number> = {};
        for (const index of sortAttrs)
          _sort[attributes[Math.abs(index) - 1].id] = Math.sign(index);
        const ops: Record<string, string> = { sort: JSON.stringify(_sort) };
        if (vnode.attrs.filter) ops["filter"] = vnode.attrs.filter.toString();
        navigate("/permissions", ops).catch(console.error);
      }

      const filter = unpackSmartQuery(
        vnode.attrs.filter ?? new Expression.Literal(true),
      );

      const permissions = store.fetch("permissions", filter, {
        limit: showCount || PAGE_SIZE,
        sort: sort,
      });

      const count = store.count("permissions", filter);

      const downloadUrl = getDownloadUrl(filter);

      const valueCallback = (
        attr: (typeof attributes)[number],
        permission: Record<string, any>,
      ): Children => {
        if (attr.id === "access") {
          const val = permission["access"];
          if (val === 1) return "1: count";
          else if (val === 2) return "2: read";
          else if (val === 3) return "3: write";
          return val;
        } else if (attr.id === "validate" || attr.id === "filter") {
          const except = getExcerpt(permission[attr.id], 80, 1);
          return m("span.font-mono", { title: permission[attr.id] }, except[0]);
        }

        return permission[attr.id];
      };

      const attrs: IndexTableAttrs = {
        attributes,
        data: permissions.value,
        total: count.value,
        valueCallback,
        showMoreCallback: showMore,
        sortAttributes,
        onSortChange,
        downloadUrl,
      };

      if (window.authorizer.hasAccess("permissions", 3)) {
        attrs.recordActionsCallback = (permission: Record<string, any>) => {
          const val = permission["access"];
          if (val === 1) permission["access"] = "1: count";
          if (val === 2) permission["access"] = "2: read";
          if (val === 3) permission["access"] = "3: write";
          return [
            m(
              "button.text-cyan-700 hover:text-cyan-900 font-medium",
              {
                onclick: () => {
                  let cb: (() => Children) | null = null;
                  const comp = m(
                    putFormComponent,
                    Object.assign(
                      {
                        base: permission,
                        oncreate: (_vnode: VnodeDOM<any, any>) => {
                          const dom = _vnode.dom as HTMLElement;
                          dom.querySelector<HTMLInputElement>(
                            "input[name='role']",
                          )!.disabled = true;
                          dom.querySelector<HTMLSelectElement>(
                            "select[name='access']",
                          )!.disabled = true;
                          dom.querySelector<HTMLSelectElement>(
                            "select[name='resource']",
                          )!.disabled = true;
                        },
                        actionHandler: (
                          action: string,
                          object: Record<string, any>,
                        ) => {
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
                      !(comp.state as any)["current"]["modified"] ||
                      confirm("You have unsaved changes. Close anyway?"),
                  );
                },
              },
              "Show",
            ),
          ];
        };

        attrs.actionsCallback = (selected: Set<string>): Children => {
          return [
            m(
              "button.px-4 py-2 border border-stone-300 shadow-xs text-sm font-medium rounded-md text-stone-700 bg-white hover:bg-stone-50 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed",
              {
                title: "Create new permission",
                onclick: () => {
                  let cb: (() => Children) | null = null;
                  const comp = m(
                    putFormComponent,
                    Object.assign(
                      {
                        actionHandler: (
                          action: string,
                          object: Record<string, any>,
                        ) => {
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
                      !(comp.state as any)["current"]["modified"] ||
                      confirm("You have unsaved changes. Close anyway?"),
                  );
                },
              },
              "New",
            ),
            m(
              "button.px-4 py-2 border border-stone-300 shadow-xs text-sm font-medium rounded-md text-stone-700 bg-white hover:bg-stone-50 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed",
              {
                title: "Delete selected permissions",
                disabled: !selected.size,
                onclick: (e: Event) => {
                  if (
                    !confirm(
                      `Deleting ${selected.size} permissions. Are you sure?`,
                    )
                  )
                    return;

                  e.redraw = false;
                  (e.target as HTMLButtonElement).disabled = true;
                  Promise.all(
                    Array.from(selected).map((id) =>
                      deleteResource("permissions", id),
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
        resource: "permissions" as const,
        filter: vnode.attrs.filter,
        onChange: onFilterChanged,
      };

      return [
        m("h1.text-xl font-medium text-stone-900 mb-5", "Listing permissions"),
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
