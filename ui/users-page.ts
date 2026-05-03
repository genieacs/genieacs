import { Children, ClosureComponent, Component } from "mithril";
import { m } from "./components.ts";
import { pageSize as PAGE_SIZE } from "./config.ts";
import * as store from "./store.ts";
import { navigate } from "./router.ts";
import {
  deleteResource,
  resourceExists,
  putResource,
  changePassword,
} from "./api-client.ts";
import * as notifications from "./notifications.ts";
import memoize from "../lib/common/memoize.ts";
import putFormComponent from "./put-form-component.ts";
import indexTableComponent, {
  IndexTableAttrs,
} from "./index-table-component.ts";
import * as overlay from "./overlay.ts";
import * as smartQuery from "./smart-query.ts";
import Expression from "../lib/common/expression.ts";
import filterComponent from "./filter-component.ts";
import changePasswordComponent from "./change-password-component.ts";

const attributes = [
  { id: "_id", label: "Username" },
  { id: "roles", label: "Roles", type: "multi", options: [] as string[] },
];

const unpackSmartQuery = memoize((query: Expression) => {
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
            confirm: "Confirm password doesn't match password",
          });
        }
      }

      if (!Array.isArray(object.roles) || !object.roles.length)
        return void resolve({ roles: "Role(s) must be selected" });

      object.roles = object.roles.join(",");

      resourceExists("users", id)
        .then((exists): void => {
          if (exists && isNew) {
            store.setTimestamp(Date.now());
            return void resolve({ _id: "User already exists" });
          }

          if (!exists && !isNew) {
            store.setTimestamp(Date.now());
            return void resolve({ _id: "User does not exist" });
          }

          putResource("users", id, object)
            .then(() => {
              if (isNew) {
                changePassword(id, password)
                  .then(() => {
                    notifications.push("success", "User created");
                    store.setTimestamp(Date.now());
                    resolve(null);
                  })
                  .catch(reject);
              } else {
                notifications.push("success", "User updated");
                store.setTimestamp(Date.now());
                resolve(null);
              }
            })
            .catch(reject);
        })
        .catch(reject);
    } else if (action === "delete") {
      if (!confirm("Deleting user. Are you sure?")) return void resolve(null);
      deleteResource("users", object["_id"])
        .then(() => {
          notifications.push("success", "User deleted");
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

const getDownloadUrl = memoize((filter: Expression) => {
  const cols: Record<string, string> = {};
  for (const attr of attributes) cols[attr.label] = attr.id;

  return `/api/users.csv?${m.buildQueryString({
    filter: filter.toString(),
    columns: JSON.stringify(cols),
  })}`;
});

export function init(
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!window.authorizer.hasAccess("users", 2)) {
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
      document.title = "Users - GenieACS";

      function showMore(): void {
        showCount = (showCount || PAGE_SIZE) + PAGE_SIZE;
        m.redraw();
      }

      function onFilterChanged(filter: Expression): void {
        const ops: Record<string, string> = {};
        if (!(filter instanceof Expression.Literal && filter.value))
          ops["filter"] = filter.toString();
        if (vnode.attrs.sort) ops["sort"] = JSON.stringify(vnode.attrs.sort);
        navigate("/users", ops).catch(console.error);
      }

      const sort = vnode.attrs.sort || {};

      const sortAttributes: Record<number, number> = {};
      for (let i = 0; i < attributes.length; i++) {
        const attr = attributes[i];
        if (attr.id !== "roles")
          sortAttributes[i] = sort[attributes[i].id] || 0;
      }

      function onSortChange(sortAttrs: number[]): void {
        const _sort: Record<string, number> = {};
        for (const index of sortAttrs)
          _sort[attributes[Math.abs(index) - 1].id] = Math.sign(index);
        const ops: Record<string, string> = { sort: JSON.stringify(_sort) };
        if (vnode.attrs.filter) ops["filter"] = vnode.attrs.filter.toString();
        navigate("/users", ops).catch(console.error);
      }

      const filter = unpackSmartQuery(
        vnode.attrs.filter ?? new Expression.Literal(true),
      );

      const users = store.fetch("users", filter, {
        limit: showCount || PAGE_SIZE,
        sort: sort,
      });

      const count = store.count("users", filter);

      // Getting the roles
      const permissions = store.fetch(
        "permissions",
        new Expression.Literal(true),
      );
      if (permissions.fulfilled) {
        for (const attr of attributes) {
          if (attr.id === "roles") {
            const roles = new Set<string>();
            for (const p of permissions.value) roles.add(p.role);
            attr.options = [...roles];
          }
        }
      }

      const downloadUrl = getDownloadUrl(filter);

      const canWrite = window.authorizer.hasAccess("users", 3);

      const attrs: IndexTableAttrs = {
        attributes,
        data: users.value,
        total: count.value,
        showMoreCallback: showMore,
        sortAttributes,
        onSortChange,
        downloadUrl,
      };
      attrs.recordActionsCallback = (user: Record<string, any>) => {
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
                      base: {
                        _id: user._id,
                        roles: user.roles.split(","),
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
                    {
                      resource: "users",
                      attributes: attributes,
                    },
                  ),
                );

                cb = () => {
                  const children: Children = [comp];
                  if (canWrite) {
                    children.push(m("hr"));
                    const _attrs = {
                      noAuth: true,
                      username: user._id,
                      onPasswordChange: () => {
                        overlay.close(cb);
                        m.redraw();
                      },
                    };
                    children.push(m(changePasswordComponent, _attrs));
                  }

                  return children;
                };

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

      if (canWrite) {
        const formData = {
          resource: "users",
          attributes: [
            attributes[0],
            { id: "password", label: "Password", type: "password" },
            { id: "confirm", label: "Confirm password", type: "password" },
            attributes[1],
          ],
        };
        attrs.actionsCallback = (selected: Set<string>): Children => {
          return [
            m(
              "button.px-4 py-2 border border-stone-300 shadow-xs text-sm font-medium rounded-md text-stone-700 bg-white hover:bg-stone-50 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed",
              {
                title: "Create new user",
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
                title: "Delete selected users",
                disabled: !selected.size,
                onclick: (e: Event) => {
                  if (
                    !confirm(`Deleting ${selected.size} users. Are you sure?`)
                  )
                    return;

                  e.redraw = false;
                  (e.target as HTMLButtonElement).disabled = true;
                  Promise.all(
                    Array.from(selected).map((id) =>
                      deleteResource("users", id),
                    ),
                  )
                    .then((res) => {
                      notifications.push(
                        "success",
                        `${res.length} users deleted`,
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
        resource: "users" as const,
        filter: vnode.attrs.filter,
        onChange: onFilterChanged,
      };

      return [
        m("h1.text-xl font-medium text-stone-900 mb-5", "Listing users"),
        m(filterComponent, filterAttrs),
        m(
          "loading",
          { queries: [users, count] },
          m(indexTableComponent, attrs),
        ),
      ];
    },
  };
};
