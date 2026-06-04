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
import { putResource, deleteResource, resourceExists } from "./api-client.ts";
import * as overlay from "./overlay.ts";
import * as notifications from "./notifications.ts";
import { createPutForm, type PutFormResult } from "./put-form-component.ts";
import * as smartQuery from "./smart-query.ts";
import Expression from "../lib/common/expression.ts";
import { div, h1, button, span, a, p } from "./dom.ts";

const attributes = [
  { id: "_id", label: "Name" },
  { id: "channel", label: "Channel" },
  { id: "weight", label: "Weight" },
  { id: "schedule", label: "Schedule" },
  { id: "events", label: "Events" },
  { id: "precondition", label: "Precondition", type: "textarea" },
  { id: "provision", label: "Provision", type: "combo" },
  { id: "provisionArgs", label: "Arguments", type: "textarea" },
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
            "presets",
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

      const errors: Record<string, string> = {};

      if (!id) errors["_id"] = "ID can not be empty";
      if (!object.provision) errors["provision"] = "Provision not selected";

      if (Object.keys(errors).length) return void resolve(errors);

      if (object.precondition) {
        try {
          object.precondition = Expression.parse(
            object.precondition as string,
          ).toString();
        } catch {
          return void resolve({
            precondition: "Precondition must be valid expression",
          });
        }
      }

      resourceExists("presets", id)
        .then((exists) => {
          if (exists && isNew) {
            invalidate(Date.now());
            return void resolve({ _id: "Preset already exists" });
          }

          if (!exists && !isNew) {
            invalidate(Date.now());
            return void resolve({ _id: "Preset does not exist" });
          }

          putResource("presets", id, object)
            .then(() => {
              notifications.push(
                "success",
                `Preset ${exists ? "updated" : "created"}`,
              );
              invalidate(Date.now());
              resolve(null);
            })
            .catch(reject);
        })
        .catch(reject);
    } else if (action === "delete") {
      if (!confirm("Deleting preset. Are you sure?")) return void resolve(null);

      deleteResource("presets", object["_id"] as string)
        .then(() => {
          notifications.push("success", "Preset deleted");
          invalidate(Date.now());
          resolve(null);
        })
        .catch((err) => {
          reject(err);
          invalidate(Date.now());
        });
    } else {
      reject(new Error("Undefined action"));
    }
  });
}

const formData = {
  resource: "presets",
  attributes: attributes,
};

function getDownloadUrl(filter: Expression): string {
  const cols: Record<string, string> = {};
  for (const attr of attributes) cols[attr.label] = attr.id;
  return `/api/presets.csv?${new URLSearchParams({
    filter: filter.toString(),
    columns: JSON.stringify(cols),
  }).toString()}`;
}

export interface Attrs {
  filter?: Expression;
  sort?: Record<string, number>;
}

export function init(args: URLSearchParams): Promise<Attrs> {
  if (!window.authorizer.hasAccess("presets", 2)) {
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
  document.title = "Presets - GenieACS";

  const showCount = new StateSignal(PAGE_SIZE);

  const sort = attrs.sort ?? {};

  const filter = unpackSmartQuery(attrs.filter ?? new Expression.Literal(true));

  // Reactive data signals
  const presetsQuery = reactiveFetch("presets", filter, { sort });
  const countQuery = reactiveCount("presets", filter);
  const provisionsQuery = reactiveFetch(
    "provisions",
    new Expression.Literal(true),
  );

  const downloadUrl = getDownloadUrl(filter);

  const sortAttributes: Record<number, number> = {};
  for (let i = 0; i < attributes.length; i++) {
    const attr = attributes[i];
    if (
      !(
        attr.id === "events" ||
        attr.id === "precondition" ||
        attr.id === "provision" ||
        attr.id === "provisionArgs"
      )
    )
      sortAttributes[i] = sort[attr.id] || 0;
  }

  function onFilterChanged(f: Expression): void {
    const ops: Record<string, string> = {};
    if (!(f instanceof Expression.Literal && f.value))
      ops["filter"] = f.toString();
    if (attrs.sort) ops["sort"] = JSON.stringify(attrs.sort);
    void navigate("/presets", ops);
  }

  function onSortChange(sortAttrs: number[]): void {
    const _sort: Record<string, number> = {};
    for (const index of sortAttrs)
      _sort[attributes[Math.abs(index) - 1].id] = Math.sign(index);
    const ops: Record<string, string> = { sort: JSON.stringify(_sort) };
    if (attrs.filter) ops["filter"] = attrs.filter.toString();
    void navigate("/presets", ops);
  }

  // Record actions callback
  const recordActionsCallback = (preset: Record<string, unknown>): Node[] => {
    return [
      button(
        {
          class: "text-cyan-700 hover:text-cyan-900 font-medium",
          onclick: () => {
            let cb: (() => Node) | null = null;
            let formResult: PutFormResult | null = null;
            cb = (): Node => {
              if (!preset.provision) {
                return p(
                  { style: "margin:20px" },
                  "This UI only supports presets with a single 'provision' configuration. If this preset was originally created from the old UI (genieacs-gui), you must edit it there.",
                );
              }
              if (!formResult) {
                formResult = createPutForm({
                  base: preset,
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
  if (window.authorizer.hasAccess("presets", 3)) {
    actionsCallback = (selected: Set<string>): Node[] => {
      const newBtn = button(
        {
          class:
            "px-4 py-2 border border-stone-300 shadow-xs text-sm font-medium rounded-md text-stone-700 bg-white hover:bg-stone-50 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed",
          title: "Create new preset",
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
          title: "Delete selected presets",
          disabled: !selected.size,
          onclick: (e: MouseEvent) => {
            if (!confirm(`Deleting ${selected.size} presets. Are you sure?`))
              return;

            const btn = e.currentTarget as HTMLButtonElement;
            btn.disabled = true;
            Promise.all(
              Array.from(selected).map((id) => deleteResource("presets", id)),
            )
              .then((res) => {
                notifications.push("success", `${res.length} presets deleted`);
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

  // Value callback returns DOM nodes or strings
  const valueCallback = (
    attr: { id?: string; label: string },
    preset: Record<string, unknown>,
  ): Node | string => {
    if (!attr.id) return "";
    // Read provisions reactively to build user-defined set
    const provisions = provisionsQuery.get();
    const userDefinedProvisions: Set<string> = new Set();
    const provisionIds = new Set([
      "refresh",
      "value",
      "tag",
      "reboot",
      "reset",
      "download",
      "instances",
    ]);

    if (provisions.value) {
      for (const prov of provisions.value as Record<string, unknown>[]) {
        userDefinedProvisions.add(prov["_id"] as string);
        provisionIds.add(prov["_id"] as string);
      }
    }

    const provisionAttr = attributes.find(
      (attr2) => attr2.id === "provision",
    ) as {
      id: string;
      label: string;
      type?: string;
      options?: string[];
    };
    provisionAttr["options"] = Array.from(provisionIds);

    if (attr.id === "precondition") {
      let devicesUrl = "/devices";
      const precondition = preset["precondition"] as string;
      if (precondition.length) {
        devicesUrl += `?${new URLSearchParams({
          filter: precondition,
        }).toString()}`;
      }

      return a(
        {
          class: "text-cyan-700 hover:text-cyan-900 font-mono",
          href: devicesUrl,
          title: precondition,
        },
        getExcerpt(precondition, 80, 1)[0],
      );
    } else if (attr.id === "provisionArgs") {
      return span(
        {
          class: "font-mono",
          title: preset["provisionArgs"] as string,
        },
        getExcerpt(preset["provisionArgs"] as string, 80, 1)[0],
      );
    } else if (
      attr.id === "provision" &&
      userDefinedProvisions.has(preset[attr.id] as string)
    ) {
      return a(
        {
          class: "text-cyan-700 hover:text-cyan-900",
          href: `/provisions?${new URLSearchParams({
            filter: `Q("ID", "${preset["provision"]}")`,
          }).toString()}`,
        },
        preset["provision"] as string,
      );
    } else {
      return preset[attr.id] as string;
    }
  };

  // Build DOM once — table updates itself via signals
  return div(
    {},
    h1({ class: "text-xl font-medium text-stone-900 mb-5" }, "Listing presets"),
    createFilter({
      resource: "presets",
      filter: attrs.filter,
      onChange: onFilterChanged,
    }),
    createIndexTable({
      attributes,
      data: () => {
        // Track provisionsQuery from within the table's reactive data source
        // so the page holds a live subscription to it. valueCallback reads it
        // per-row inside renderRow (an untracked context), which on its own
        // would let this shared signal auto-dispose mid-navigation and then
        // throw "Cannot read disposed signal" on the next row re-render.
        provisionsQuery.get();
        return presetsQuery.get().value.slice(0, showCount.get()) as Record<
          string,
          unknown
        >[];
      },
      total: () => countQuery.get().value,
      loading: () => presetsQuery.get().loading,
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
