import { fetch as reactiveFetch, invalidate } from "./reactive-store.ts";
import { StateSignal } from "./signals.ts";
import { deleteResource, putResource, resourceExists } from "./api-client.ts";
import * as notifications from "./notifications.ts";
import { createPutForm, type PutFormResult } from "./put-form-component.ts";
import { createUiConfig, type UiConfigResult } from "./ui-config-component.ts";
import * as overlay from "./overlay.ts";
import Expression from "../lib/common/expression.ts";
import { loadCodeMirror, loadYaml } from "./dynamic-loader.ts";
import { div, h1, button, input, table, tbody, tr, td } from "./dom.ts";
import { createLongText } from "./long-text-component.ts";
import { createIcon } from "./icons.ts";

const attributes = [
  { id: "_id", label: "Key" },
  { id: "value", label: "Value", type: "textarea" },
];

interface ValidationErrors {
  [prop: string]: string;
}

function putActionHandler(
  action: string,
  _object: Record<string, unknown>,
  isNew?: boolean,
): Promise<ValidationErrors | null> {
  return new Promise((resolve, reject) => {
    const object = Object.assign({}, _object);
    if (action === "save") {
      let id = (object["_id"] as string) || "";
      delete object["_id"];

      const regex = /^[0-9a-zA-Z_.-]+$/;
      id = id.trim();
      if (!id.match(regex)) return void resolve({ _id: "Invalid ID" });

      try {
        object.value = Expression.parse(
          (object.value as string) || "",
        ).toString();
      } catch {
        return void resolve({
          value: "Config value must be valid expression",
        });
      }

      resourceExists("config", id)
        .then((exists) => {
          if (exists && isNew) {
            invalidate(Date.now());
            return void resolve({ _id: "Config already exists" });
          }

          if (!exists && !isNew) {
            invalidate(Date.now());
            return void resolve({ _id: "Config does not exist" });
          }

          putResource("config", id, object)
            .then(() => {
              notifications.push(
                "success",
                `Config ${exists ? "updated" : "created"}`,
              );
              invalidate(Date.now());
              resolve(null);
            })
            .catch(reject);
        })
        .catch(reject);
    } else if (action === "delete") {
      if (!confirm("Deleting config. Are you sure?")) return void resolve(null);
      deleteResource("config", object["_id"] as string)
        .then(() => {
          notifications.push("success", "Config deleted");
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
  resource: "config",
  attributes: attributes,
};

function escapeRegExp(str: string): string {
  return str.replace(/[-[\]/{}()*+?.\\^$|]/g, "\\$&");
}

export function init(): Promise<Attrs> {
  if (!window.authorizer.hasAccess("config", 2)) {
    return Promise.reject(
      new Error("You are not authorized to view this page"),
    );
  }
  return Promise.all([loadCodeMirror(), loadYaml()]).then(() => ({}) as Attrs);
}

function createTableRow(conf: Record<string, unknown>): HTMLTableRowElement {
  const editBtn = button(
    {
      title: "Edit config value",
      onclick: () => {
        let cb: (() => Node) | null = null;
        let formResult: PutFormResult | null = null;
        cb = () => {
          if (!formResult) {
            formResult = createPutForm({
              base: conf,
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
    createIcon({
      name: "edit",
      class: "inline h-4 w-4 ml-1 text-cyan-700 hover:text-cyan-900",
    }),
  );

  const deleteBtn = button(
    {
      title: "Delete config",
      onclick: () => {
        if (!confirm(`Deleting ${conf._id} config. Are you sure?`)) return;

        putActionHandler("delete", conf).catch((err) => {
          throw err;
        });
      },
    },
    createIcon({
      name: "remove",
      class: "inline h-4 w-4 ml-1 text-cyan-700 hover:text-cyan-900",
    }),
  );

  return tr(
    {},
    td(
      { class: "pl-4 pr-2 py-2 truncate" },
      createLongText({ text: conf._id as string }),
    ),
    td(
      { class: "px-2 py-2 text-right truncate" },
      createLongText({ text: `${conf.value}` }),
    ),
    td({ class: "pl-2 pr-4 py-2 w-max" }, editBtn, deleteBtn),
  );
}

function buildTableRows(
  confs: any[],
  searchStr: string,
): HTMLTableRowElement[] {
  const sortedConfs = [...confs].sort((a, b) => {
    return a._id < b._id ? -1 : 1;
  });

  if (!sortedConfs.length) {
    return [tr({}, td({ colspan: 3 }, "No config"))];
  }

  let regex: RegExp | undefined;
  if (searchStr) {
    const keywords = searchStr.split(" ").filter((s) => s);
    if (keywords.length)
      regex = new RegExp(keywords.map((s) => escapeRegExp(s)).join(".*"), "i");
  }

  return sortedConfs.map((conf) => {
    const row = createTableRow(conf);
    if (regex && !regex.test(conf._id) && !regex.test(conf.value)) {
      row.style.display = "none";
    }
    return row;
  });
}

function createNewConfigButton(): HTMLButtonElement {
  return button(
    {
      class:
        "mr-4 px-4 py-2 border border-stone-300 shadow-xs text-sm font-medium rounded-md text-stone-700 bg-white hover:bg-stone-50 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-cyan-500",
      title: "Create new config",
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
    "New config",
  );
}

function createSubConfigButton(sub: {
  name: string;
  prefix: string;
  data: any[];
}): HTMLButtonElement {
  return button(
    {
      class:
        "mr-4 px-4 py-2 border border-stone-300 shadow-xs text-sm font-medium rounded-md text-stone-700 bg-white hover:bg-stone-50 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-cyan-500",
      onclick: () => {
        let cb: (() => Node) | null = null;
        let configResult: UiConfigResult | null = null;
        cb = () => {
          if (!configResult) {
            configResult = createUiConfig({
              prefix: sub.prefix,
              name: sub.name,
              data: sub.data,
              onUpdate: (errs: Record<string, string> | null) => {
                const errors = errs ? Object.values(errs) : [];
                if (errors.length) {
                  for (const err of errors) notifications.push("error", err);
                } else {
                  notifications.push(
                    "success",
                    `${sub.name.replace(
                      /^[a-z]/,
                      sub.name[0].toUpperCase(),
                    )} config updated`,
                  );
                  overlay.close(cb!);
                }
                invalidate(Date.now());
              },
              onError: (err) => {
                notifications.push("error", err.message);
                invalidate(Date.now());
                overlay.close(cb!);
              },
            });
          }
          return configResult.element;
        };
        overlay.open(
          cb,
          () =>
            !configResult?.isModified() ||
            confirm("You have unsaved changes. Close anyway?"),
        );
      },
    },
    `Edit ${sub.name}`,
  );
}

export type Attrs = Record<string, never>;

export function createPage(): HTMLElement {
  document.title = "Config - GenieACS";

  const searchString = new StateSignal<string>("");
  let searchTimeout: ReturnType<typeof setTimeout> | null = null;

  // Reactive data signal
  const confsQuery = reactiveFetch("config", new Expression.Literal(true));

  // Search input is created once, outside the reactive child below: it only
  // *writes* searchString (debounced), and rebuilding it on each committed
  // keystroke would drop focus and caret. Its value is deliberately not a
  // reactive binding — nothing else writes searchString, and echoing the
  // committed value back would clobber keystrokes typed within the debounce
  // window.
  const searchInput = input({
    type: "text",
    class:
      "appearance-none block w-full px-3 py-2 border border-stone-300 placeholder-stone-500 text-stone-900 focus:ring-cyan-500 focus:border-cyan-500 sm:text-sm rounded-md mt-1 max-w-screen-sm shadow-sm mb-5",
    placeholder: "Search config",
    value: "",
    oninput: (e) => {
      const inputValue = (e.target as HTMLInputElement).value;
      if (searchTimeout) clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => searchString.set(inputValue), 250);
    },
  });

  // Build DOM once -- reactive child handles data updates
  return div(
    {},
    h1({ class: "text-xl font-medium text-stone-900 mb-5" }, "Listing config"),
    searchInput,
    // Reactive: rebuilds only this subtree when data signals change
    () => {
      const confs = confsQuery.get();
      const currentSearch = searchString.get();

      if (confs.loading && !confs.value.length) {
        return div({ class: "animate-pulse bg-stone-200 h-64 rounded-md" });
      }

      // Table rows
      const rows = buildTableRows(confs.value || [], currentSearch);

      const tableWrapper = div(
        {
          class:
            "shadow-sm overflow-hidden border-b border-stone-200 rounded-lg bg-white",
        },
        div(
          { class: "overflow-y-scroll h-96" },
          table(
            { class: "w-full table-fixed font-mono text-sm text-stone-700" },
            tbody({ class: "bg-white divide-y divide-stone-200" }, ...rows),
          ),
        ),
      );

      // Buttons section
      const buttons: Node[] = [];

      if (window.authorizer.hasAccess("config", 3)) {
        buttons.push(createNewConfigButton());

        const subsData = [
          {
            name: "overview",
            prefix: "ui.overview.groups.",
            data: [] as any[],
          },
          { name: "charts", prefix: "ui.overview.charts.", data: [] as any[] },
          { name: "filters", prefix: "ui.filters.", data: [] as any[] },
          { name: "index page", prefix: "ui.index.", data: [] as any[] },
          { name: "device page", prefix: "ui.device.", data: [] as any[] },
        ];

        for (const conf of confs.value as Array<Record<string, unknown>>) {
          for (const sub of subsData) {
            if ((conf["_id"] as string).startsWith(sub["prefix"])) {
              sub["data"].push(conf);
              break;
            }
          }
        }

        for (const sub of subsData) {
          buttons.push(createSubConfigButton(sub));
        }
      }

      return div({}, tableWrapper, div({ class: "mt-5" }, ...buttons));
    },
  );
}
