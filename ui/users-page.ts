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
import {
  deleteResource,
  putResource,
  resourceExists,
  changePassword,
} from "./api-client.ts";
import * as notifications from "./notifications.ts";
import { createPutForm, type PutFormResult } from "./put-form-component.ts";
import * as overlay from "./overlay.ts";
import * as smartQuery from "./smart-query.ts";
import Expression from "../lib/common/expression.ts";
import { renderChangePasswordForm } from "./change-password-component.ts";
import { div, h1, button, hr } from "./dom.ts";

const attributes = [
  { id: "_id", label: "Username" },
  { id: "roles", label: "Roles" },
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
            "users",
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
      const password = object["password"] as string;
      const confirmPwd = object["confirm"];
      delete object["_id"];
      delete object["password"];
      delete object["confirm"];

      if (!id) return void resolve({ _id: "ID can not be empty" });

      if (isNew) {
        if (!password) {
          return void resolve({ password: "Password can not be empty" });
        } else if (password !== confirmPwd) {
          return void resolve({
            confirm: "Confirm password doesn't match password",
          });
        }
      }

      if (!Array.isArray(object.roles) || !object.roles.length)
        return void resolve({ roles: "Role(s) must be selected" });

      object.roles = object.roles.join(",");

      resourceExists("users", id)
        .then((exists) => {
          if (exists && isNew) {
            invalidate(Date.now());
            return void resolve({ _id: "User already exists" });
          }

          if (!exists && !isNew) {
            invalidate(Date.now());
            return void resolve({ _id: "User does not exist" });
          }

          putResource("users", id, object)
            .then(() => {
              if (isNew) {
                changePassword(id, password)
                  .then(() => {
                    notifications.push("success", "User created");
                    invalidate(Date.now());
                    resolve(null);
                  })
                  .catch(reject);
              } else {
                notifications.push("success", "User updated");
                invalidate(Date.now());
                resolve(null);
              }
            })
            .catch(reject);
        })
        .catch(reject);
    } else if (action === "delete") {
      if (!confirm("Deleting user. Are you sure?")) return void resolve(null);
      deleteResource("users", object["_id"] as string)
        .then(() => {
          notifications.push("success", "User deleted");
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

function getDownloadUrl(filter: Expression): string {
  const cols: Record<string, string> = {};
  for (const attr of attributes) cols[attr.label] = attr.id;

  return `/api/users.csv?${new URLSearchParams({
    filter: filter.toString(),
    columns: JSON.stringify(cols),
  }).toString()}`;
}

export interface Attrs {
  filter?: Expression;
  sort?: Record<string, number>;
}

export function init(args: URLSearchParams): Promise<Attrs> {
  if (!window.authorizer.hasAccess("users", 2)) {
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
  document.title = "Users - GenieACS";

  const showCount = new StateSignal(PAGE_SIZE);

  const sort = attrs.sort ?? {};

  const filter = unpackSmartQuery(attrs.filter ?? new Expression.Literal(true));

  // Reactive data signals
  const usersQuery = reactiveFetch("users", filter, { sort });
  const countQuery = reactiveCount("users", filter);

  // Fetch permissions for role options
  const permissionsQuery = reactiveFetch(
    "permissions",
    new Expression.Literal(true),
  );

  function getRoleOptions(): string[] {
    const permissions = permissionsQuery.get();
    if (permissions.loading || !(permissions.value as unknown[]).length)
      return [];
    return [
      ...new Set(
        (permissions.value as Record<string, unknown>[]).map(
          (p) => p.role as string,
        ),
      ),
    ];
  }

  const downloadUrl = getDownloadUrl(filter);

  const sortAttributes: Record<number, number> = {};
  for (let i = 0; i < attributes.length; i++) {
    const attr = attributes[i];
    if (attr.id !== "roles") sortAttributes[i] = sort[attributes[i].id] || 0;
  }

  function onFilterChanged(f: Expression): void {
    const ops: Record<string, string> = {};
    if (!(f instanceof Expression.Literal && f.value))
      ops["filter"] = f.toString();
    if (attrs.sort) ops["sort"] = JSON.stringify(attrs.sort);
    void navigate("/users", ops);
  }

  function onSortChange(sortAttrs: number[]): void {
    const _sort: Record<string, number> = {};
    for (const index of sortAttrs)
      _sort[attributes[Math.abs(index) - 1].id] = Math.sign(index);
    const ops: Record<string, string> = { sort: JSON.stringify(_sort) };
    if (attrs.filter) ops["filter"] = attrs.filter.toString();
    void navigate("/users", ops);
  }

  const canWrite = window.authorizer.hasAccess("users", 3);

  // Record actions callback
  const recordActionsCallback = (user: Record<string, unknown>): Node[] => {
    return [
      button(
        {
          class: "text-cyan-700 hover:text-cyan-900 font-medium",
          onclick: () => {
            let cb: (() => Node) | null = null;
            let formResult: PutFormResult | null = null;
            let formContainer: HTMLDivElement | null = null;

            cb = () => {
              if (!formResult) {
                formResult = createPutForm({
                  base: {
                    _id: user._id,
                    roles: (user.roles as string).split(","),
                  },
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
                  resource: "users",
                  attributes: [
                    { id: "_id", label: "Username" },
                    {
                      id: "roles",
                      label: "Roles",
                      type: "multi",
                      // Passed as a function: the form's multi field resolves
                      // it reactively, so roles populate even if the form is
                      // opened before the permissions fetch settles.
                      options: getRoleOptions,
                    },
                  ],
                });

                formContainer = div(
                  {},
                  formResult.element,
                  ...(canWrite
                    ? [
                        hr({}),
                        renderChangePasswordForm({
                          noAuth: true,
                          username: user._id as string,
                          onPasswordChange: () => {
                            overlay.close(cb!);
                          },
                        }),
                      ]
                    : []),
                ) as HTMLDivElement;
              }
              return formContainer!;
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
  if (canWrite) {
    actionsCallback = (selected: Set<string>): Node[] => {
      const newBtn = button(
        {
          class:
            "px-4 py-2 border border-stone-300 shadow-xs text-sm font-medium rounded-md text-stone-700 bg-white hover:bg-stone-50 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed",
          title: "Create new user",
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
                  resource: "users",
                  attributes: [
                    { id: "_id", label: "Username" },
                    { id: "password", label: "Password", type: "password" },
                    {
                      id: "confirm",
                      label: "Confirm password",
                      type: "password",
                    },
                    {
                      id: "roles",
                      label: "Roles",
                      type: "multi",
                      options: getRoleOptions,
                    },
                  ],
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
          title: "Delete selected users",
          disabled: !selected.size,
          onclick: (e: MouseEvent) => {
            if (!confirm(`Deleting ${selected.size} users. Are you sure?`))
              return;

            const btn = e.currentTarget as HTMLButtonElement;
            btn.disabled = true;
            Promise.all(
              Array.from(selected).map((id) => deleteResource("users", id)),
            )
              .then((res) => {
                notifications.push("success", `${res.length} users deleted`);
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
    h1({ class: "text-xl font-medium text-stone-900 mb-5" }, "Listing users"),
    createFilter({
      resource: "users",
      filter: attrs.filter,
      onChange: onFilterChanged,
    }),
    createIndexTable({
      attributes,
      data: () => {
        // Track permissionsQuery from within the table's reactive data source
        // so the page holds a live subscription to it: the fetch starts at
        // page load (instead of on first form open), and the shared signal
        // can't auto-dispose between form opens and then throw "Cannot read
        // disposed signal" (getRoleOptions alone reads it from the form's
        // reactive subtree, which unsubscribes when the overlay closes).
        permissionsQuery.get();
        return usersQuery.get().value.slice(0, showCount.get()) as Record<
          string,
          unknown
        >[];
      },
      total: () => countQuery.get().value,
      loading: () => usersQuery.get().loading,
      showMoreCallback: () => showCount.set(showCount.get() + PAGE_SIZE),
      sortAttributes,
      onSortChange,
      downloadUrl,
      recordActionsCallback,
      actionsCallback,
    }),
  );
}
