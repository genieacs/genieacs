import { navigate } from "./router.ts";
import { pageSize as PAGE_SIZE } from "./config.ts";
import { createFilter } from "./filter-component.ts";
import { createIndexTable } from "./index-table-component.ts";
import {
  fetch as reactiveFetch,
  count as reactiveCount,
  invalidate,
} from "./reactive-store.ts";
import { StateSignal } from "./signals.ts";
import { deleteResource, putResource, resourceExists } from "./api-client.ts";
import * as notifications from "./notifications.ts";
import { createPutForm, type PutFormResult } from "./put-form-component.ts";
import * as overlay from "./overlay.ts";
import * as smartQuery from "./smart-query.ts";
import Expression from "../lib/common/expression.ts";
import { loadCodeMirror } from "./dynamic-loader.ts";
import { div, h1, button } from "./dom.ts";

const attributes = [
  { id: "_id", label: "Name" },
  { id: "script", label: "Script", type: "code", mode: "jsx" },
];

function unpackSmartQuery(query: Expression): Expression {
  return query.evaluate((e) => {
    if (e instanceof Expression.FunctionCall) {
      if (e.name === "Q") {
        if (
          e.args[0] instanceof Expression.Literal &&
          e.args[1] instanceof Expression.Literal
        ) {
          return smartQuery.unpack(
            "views",
            e.args[0].value as string,
            e.args[1].value as string,
          );
        }
      }
    }
    return e;
  });
}

interface ValidationErrors {
  [prop: string]: string;
}

function putActionHandler(
  action: string,
  _object: Record<string, unknown>,
  isNew: boolean,
): Promise<ValidationErrors | null> {
  return new Promise((resolve, reject) => {
    const object = Object.assign({}, _object);
    if (action === "save") {
      const id = object["_id"] as string;
      delete object["_id"];

      if (!id) return void resolve({ _id: "ID can not be empty" });

      resourceExists("views", id)
        .then((exists) => {
          if (exists && isNew) {
            invalidate(Date.now());
            return void resolve({ _id: "View already exists" });
          }

          if (!exists && !isNew) {
            invalidate(Date.now());
            return void resolve({ _id: "View does not exist" });
          }

          putResource("views", id, object)
            .then(() => {
              notifications.push(
                "success",
                `View ${exists ? "updated" : "created"}`,
              );
              invalidate(Date.now());
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
      deleteResource("views", object["_id"] as string)
        .then(() => {
          notifications.push("success", "View deleted");
          invalidate(Date.now());
          resolve(null);
        })
        .catch((err) => {
          invalidate(Date.now());
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

function getDownloadUrl(filter: Expression): string {
  const cols: Record<string, string> = {};
  for (const attr of attributes) cols[attr.label] = attr.id;
  return `/api/views.csv?${new URLSearchParams({
    filter: filter.toString(),
    columns: JSON.stringify(cols),
  }).toString()}`;
}

export interface Attrs {
  filter?: Expression;
  sort?: Record<string, number>;
}

export function init(args: URLSearchParams): Promise<Attrs> {
  if (!window.authorizer.hasAccess("views", 2)) {
    return Promise.reject(
      new Error("You are not authorized to view this page"),
    );
  }
  const filterStr = args.get("filter");
  const sortStr = args.get("sort");
  const attrs: Attrs = {
    filter: filterStr ? Expression.parse(filterStr) : undefined,
    sort: sortStr ? JSON.parse(sortStr) : undefined,
  };
  return loadCodeMirror().then(() => attrs);
}

export function createPage(attrs: Attrs): HTMLElement {
  document.title = "Views - GenieACS";

  const showCount = new StateSignal(PAGE_SIZE);

  const sort = attrs.sort ?? {};

  const filter = unpackSmartQuery(attrs.filter ?? new Expression.Literal(true));

  // Reactive data signals
  const viewsQuery = reactiveFetch("views", filter, { sort });
  const countQuery = reactiveCount("views", filter);

  const downloadUrl = getDownloadUrl(filter);

  const sortAttributes: Record<number, number> = {};
  for (let i = 0; i < attributes.length; i++)
    sortAttributes[i] = sort[attributes[i].id] || 0;

  function onFilterChanged(f: Expression): void {
    const ops: Record<string, string> = {};
    if (!(f instanceof Expression.Literal && f.value))
      ops["filter"] = f.toString();
    if (attrs.sort) ops["sort"] = JSON.stringify(attrs.sort);
    void navigate("/views", ops);
  }

  function onSortChange(sortAttrs: number[]): void {
    const _sort: Record<string, number> = {};
    for (const index of sortAttrs)
      _sort[attributes[Math.abs(index) - 1].id] = Math.sign(index);
    const ops: Record<string, string> = { sort: JSON.stringify(_sort) };
    if (attrs.filter) ops["filter"] = attrs.filter.toString();
    void navigate("/views", ops);
  }

  // Record actions callback
  const recordActionsCallback = (cmp: Record<string, unknown>): Node[] => {
    return [
      button(
        {
          class: "text-cyan-700 hover:text-cyan-900 font-medium",
          onclick: () => {
            let cb: (() => Node) | null = null;
            let formResult: PutFormResult | null = null;
            cb = () => {
              if (!formResult) {
                formResult = createPutForm({
                  base: cmp,
                  actionHandler: (action, object) => {
                    return new Promise<void>((resolve) => {
                      putActionHandler(
                        action,
                        object as Record<string, unknown>,
                        false,
                      )
                        .then((errors) => {
                          const errorList = errors ? Object.values(errors) : [];
                          if (errorList.length) {
                            for (const err of errorList)
                              notifications.push("error", err);
                          } else {
                            overlay.close(cb!);
                          }
                          resolve();
                        })
                        .catch((err) => {
                          notifications.push("error", err.message);
                          resolve();
                        });
                    });
                  },
                  ...formData,
                });
              }
              return formResult.element;
            };
            overlay.open(
              cb,
              () =>
                !formResult?.isModified() ||
                confirm("You have unsaved changes. Close anyway?"),
            );
          },
        },
        "Show",
      ),
    ];
  };

  // Actions callback
  let actionsCallback: ((selected: Set<string>) => Node[]) | undefined;
  if (window.authorizer.hasAccess("views", 3)) {
    actionsCallback = (selected: Set<string>): Node[] => {
      const newBtn = button(
        {
          class:
            "px-4 py-2 border border-stone-300 shadow-xs text-sm font-medium rounded-md text-stone-700 bg-white hover:bg-stone-50 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed",
          title: "Create new view",
          onclick: () => {
            let cb: (() => Node) | null = null;
            let formResult: PutFormResult | null = null;
            cb = () => {
              if (!formResult) {
                formResult = createPutForm({
                  actionHandler: (action, object) => {
                    return new Promise<void>((resolve) => {
                      putActionHandler(
                        action,
                        object as Record<string, unknown>,
                        true,
                      )
                        .then((errors) => {
                          const errorList = errors ? Object.values(errors) : [];
                          if (errorList.length) {
                            for (const err of errorList)
                              notifications.push("error", err);
                          } else {
                            overlay.close(cb!);
                          }
                          resolve();
                        })
                        .catch((err) => {
                          notifications.push("error", err.message);
                          resolve();
                        });
                    });
                  },
                  ...formData,
                });
              }
              return formResult.element;
            };
            overlay.open(
              cb,
              () =>
                !formResult?.isModified() ||
                confirm("You have unsaved changes. Close anyway?"),
            );
          },
        },
        "New",
      );

      const deleteBtn = button(
        {
          class:
            "px-4 py-2 border border-stone-300 shadow-xs text-sm font-medium rounded-md text-stone-700 bg-white hover:bg-stone-50 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed",
          title: "Delete selected views",
          disabled: !selected.size,
          onclick: (e: MouseEvent) => {
            if (!confirm(`Deleting ${selected.size} views. Are you sure?`))
              return;

            const btn = e.currentTarget as HTMLButtonElement;
            btn.disabled = true;
            Promise.all(
              Array.from(selected).map((id) => deleteResource("views", id)),
            )
              .then((res) => {
                notifications.push("success", `${res.length} views deleted`);
                invalidate(Date.now());
              })
              .catch((err) => {
                notifications.push("error", err.message);
                invalidate(Date.now());
              });
          },
        },
        "Delete",
      );

      return [newBtn, deleteBtn];
    };
  }

  // Build DOM once — table updates itself via signals
  return div(
    {},
    h1({ class: "text-xl font-medium text-stone-900 mb-5" }, "Listing views"),
    createFilter({
      resource: "views",
      filter: attrs.filter,
      onChange: onFilterChanged,
    }),
    createIndexTable({
      attributes,
      data: () =>
        viewsQuery.get().value.slice(0, showCount.get()) as Record<
          string,
          unknown
        >[],
      total: () => countQuery.get().value,
      loading: () => viewsQuery.get().loading,
      showMoreCallback: () => showCount.set(showCount.get() + PAGE_SIZE),
      sortAttributes,
      onSortChange,
      downloadUrl,
      recordActionsCallback,
      actionsCallback,
    }),
  );
}
