import { navigate } from "./router.ts";
import { pageSize as PAGE_SIZE } from "./config.ts";
import { createFilter } from "./filter-component.ts";
import { createIndexTable } from "./index-table-component.ts";
import {
  pagedFetch,
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
import { div, h1, button, span } from "./dom.ts";

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
      "uploads",
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

function unpackSmartQuery(query: Expression): Expression {
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
          object.filter = Expression.parse(object.filter as string).toString();
        } catch {
          return void resolve({
            filter: "Filter must be valid expression",
          });
        }
      }

      if (object.validate) {
        try {
          object.validate = Expression.parse(
            object.validate as string,
          ).toString();
        } catch {
          return void resolve({
            validate: "Validate must be valid expression",
          });
        }
      }

      const id = `${object.role}:${object.resource}:${object.access}`;

      resourceExists("permissions", id)
        .then((exists) => {
          if (exists && isNew) {
            invalidate(Date.now());
            return void resolve({ _id: "Permission already exists" });
          }
          if (!exists && !isNew) {
            invalidate(Date.now());
            return void resolve({ _id: "Permission does not exist" });
          }

          putResource("permissions", id, object)
            .then(() => {
              notifications.push(
                "success",
                `Permission ${exists ? "updated" : "created"}`,
              );
              invalidate(Date.now());
              resolve(null);
            })
            .catch(reject);
        })
        .catch(reject);
    } else if (action === "delete") {
      if (!confirm("Deleting permission. Are you sure?"))
        return void resolve(null);
      deleteResource("permissions", object["_id"] as string)
        .then(() => {
          notifications.push("success", "Permission deleted");
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
  resource: "permissions",
  attributes: attributes,
};

function getDownloadUrl(filter: Expression): string {
  const cols: Record<string, string> = {};
  for (const attr of attributes) cols[attr.label] = attr.id;
  return `/api/permissions.csv?${new URLSearchParams({
    filter: filter.toString(),
    columns: JSON.stringify(cols),
  }).toString()}`;
}

export interface Attrs {
  filter?: Expression;
  sort?: Record<string, number>;
}

export function init(args: URLSearchParams): Promise<Attrs> {
  if (!window.authorizer.hasAccess("permissions", 2)) {
    return Promise.reject(
      new Error("You are not authorized to view this page"),
    );
  }
  const filterStr = args.get("filter");
  const sortStr = args.get("sort");
  return Promise.resolve({
    filter: filterStr ? Expression.parse(filterStr) : undefined,
    sort: sortStr ? JSON.parse(sortStr) : undefined,
  });
}

export function createPage(attrs: Attrs): HTMLElement {
  document.title = "Permissions - GenieACS";

  const showCount = new StateSignal(PAGE_SIZE);

  const sort = attrs.sort ?? {};

  const filter = unpackSmartQuery(attrs.filter ?? new Expression.Literal(true));

  // Reactive data signals
  const permissionsQuery = (): { value: unknown[]; loading: boolean } =>
    pagedFetch("permissions", filter, { sort, limit: showCount.get() });
  const countQuery = reactiveCount("permissions", filter);

  const downloadUrl = getDownloadUrl(filter);

  const sortAttributes: Record<number, number> = {};
  for (let i = 0; i < attributes.length; i++) {
    const attr = attributes[i];
    if (!(attr.id === "filter" || attr.id === "validate"))
      sortAttributes[i] = sort[attr.id] || 0;
  }

  function onFilterChanged(f: Expression): void {
    const ops: Record<string, string> = {};
    if (!(f instanceof Expression.Literal && f.value))
      ops["filter"] = f.toString();
    if (attrs.sort) ops["sort"] = JSON.stringify(attrs.sort);
    void navigate("/permissions", ops);
  }

  function onSortChange(sortAttrs: number[]): void {
    const _sort: Record<string, number> = {};
    for (const index of sortAttrs)
      _sort[attributes[Math.abs(index) - 1].id] = Math.sign(index);
    const ops: Record<string, string> = { sort: JSON.stringify(_sort) };
    if (attrs.filter) ops["filter"] = attrs.filter.toString();
    void navigate("/permissions", ops);
  }

  // Value callback returns DOM nodes or strings
  const valueCallback = (
    attr: { id?: string; label: string },
    permission: Record<string, unknown>,
  ): Node | string => {
    if (attr.id === "access") {
      const val = permission["access"];
      if (val === 1) return "1: count";
      else if (val === 2) return "2: read";
      else if (val === 3) return "3: write";
      return val as string;
    } else if (attr.id === "validate" || attr.id === "filter") {
      const excerpt = getExcerpt(permission[attr.id] as string, 80, 1);
      return span(
        { class: "font-mono", title: permission[attr.id] as string },
        excerpt[0],
      );
    }

    return permission[attr.id as string] as string;
  };

  // Record actions callback
  let recordActionsCallback: ((permission: any) => Node[]) | undefined;
  let actionsCallback: ((selected: Set<string>) => Node[]) | undefined;

  if (window.authorizer.hasAccess("permissions", 3)) {
    recordActionsCallback = (permission: Record<string, unknown>): Node[] => {
      return [
        button(
          {
            class: "text-cyan-700 hover:text-cyan-900 font-medium",
            onclick: () => {
              const base = { ...permission };
              if (base["access"] === 1) base["access"] = "1: count";
              else if (base["access"] === 2) base["access"] = "2: read";
              else if (base["access"] === 3) base["access"] = "3: write";
              let cb: (() => Node) | null = null;
              let formResult: PutFormResult | null = null;
              cb = () => {
                if (!formResult) {
                  formResult = createPutForm({
                    base,
                    actionHandler: (action, object) => {
                      return new Promise<void>((resolve) => {
                        putActionHandler(
                          action,
                          object as Record<string, unknown>,
                          false,
                        )
                          .then((errors) => {
                            const errorList = errors
                              ? Object.values(errors)
                              : [];
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

                  // Disable identity fields when editing an existing permission
                  for (const name of ["role", "resource", "access"]) {
                    const el = formResult.element.querySelector<
                      HTMLInputElement | HTMLSelectElement
                    >(`[name='${name}']`);
                    if (el) el.disabled = true;
                  }
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

    actionsCallback = (selected: Set<string>): Node[] => {
      const newBtn = button(
        {
          class:
            "px-4 py-2 border border-stone-300 shadow-xs text-sm font-medium rounded-md text-stone-700 bg-white hover:bg-stone-50 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed",
          title: "Create new permission",
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
          title: "Delete selected permissions",
          disabled: !selected.size,
          onclick: (e: MouseEvent) => {
            if (
              !confirm(`Deleting ${selected.size} permissions. Are you sure?`)
            )
              return;

            const btn = e.currentTarget as HTMLButtonElement;
            btn.disabled = true;
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
    h1(
      { class: "text-xl font-medium text-stone-900 mb-5" },
      "Listing permissions",
    ),
    createFilter({
      resource: "permissions",
      filter: attrs.filter,
      onChange: onFilterChanged,
    }),
    createIndexTable({
      attributes,
      data: () => permissionsQuery().value as Record<string, unknown>[],
      total: () => countQuery.get().value,
      loading: () => permissionsQuery().loading,
      valueCallback,
      showMoreCallback: () => showCount.set(showCount.get() + PAGE_SIZE),
      sortAttributes,
      onSortChange,
      downloadUrl,
      recordActionsCallback,
      actionsCallback,
    }),
  );
}
