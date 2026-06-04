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
import { deleteResource, resourceExists, uploadFile } from "./api-client.ts";
import * as notifications from "./notifications.ts";
import { createPutForm, type PutFormResult } from "./put-form-component.ts";
import * as overlay from "./overlay.ts";
import * as smartQuery from "./smart-query.ts";
import Expression from "../lib/common/expression.ts";
import { div, h1, button, a } from "./dom.ts";

const attributes: {
  id: string;
  label: string;
  type?: string;
  options?: any;
}[] = [
  { id: "_id", label: "Name" },
  {
    id: "metadata.fileType",
    label: "Type",
    options: [
      "1 Firmware Upgrade Image",
      "2 Web Content",
      "3 Vendor Configuration File",
      "4 Tone File",
      "5 Ringer File",
    ],
  },
  { id: "metadata.oui", label: "OUI" },
  { id: "metadata.productClass", label: "Product Class" },
  { id: "metadata.version", label: "Version" },
];

const formData = {
  resource: "files",
  attributes: attributes
    .slice(1) // remove _id from new object form
    .concat([{ id: "file", label: "File", type: "file" }]),
};

function unpackSmartQuery(query: Expression): Expression {
  return query.evaluate((e) => {
    if (e instanceof Expression.FunctionCall) {
      if (e.name === "Q") {
        if (
          e.args[0] instanceof Expression.Literal &&
          e.args[1] instanceof Expression.Literal
        ) {
          return smartQuery.unpack(
            "files",
            e.args[0].value as string,
            e.args[1].value as string,
          );
        }
      }
    }
    return e;
  });
}

async function upload(
  file: File,
  headers: Record<string, string>,
  signal?: AbortSignal,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  await uploadFile(`/api/files/${encodeURIComponent(file.name)}`, file, {
    headers: { "Content-Type": "application/octet-stream", ...headers },
    signal,
    onProgress,
  });
}

function getDownloadUrl(filter: Expression): string {
  const cols: Record<string, string> = {};
  for (const attr of attributes) cols[attr.label] = attr.id;
  return `/api/files.csv?${new URLSearchParams({
    filter: filter.toString(),
    columns: JSON.stringify(cols),
  }).toString()}`;
}

export interface Attrs {
  filter?: Expression;
  sort?: Record<string, number>;
}

export function init(args: URLSearchParams): Promise<Attrs> {
  if (!window.authorizer.hasAccess("files", 2)) {
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
  document.title = "Files - GenieACS";

  const showCount = new StateSignal(PAGE_SIZE);

  const sort = attrs.sort ?? {};

  const filter = unpackSmartQuery(attrs.filter ?? new Expression.Literal(true));

  // Reactive data signals
  const filesQuery = reactiveFetch("files", filter, { sort });
  const countQuery = reactiveCount("files", filter);

  const downloadUrl = getDownloadUrl(filter);

  const sortAttributes: Record<number, number> = {};
  for (let i = 0; i < attributes.length; i++)
    sortAttributes[i] = sort[attributes[i].id] || 0;

  function onFilterChanged(f: Expression): void {
    const ops: Record<string, string> = {};
    if (!(f instanceof Expression.Literal && f.value))
      ops["filter"] = f.toString();
    if (attrs.sort) ops["sort"] = JSON.stringify(attrs.sort);
    void navigate("/files", ops);
  }

  function onSortChange(sortAttrs: number[]): void {
    const _sort: Record<string, number> = {};
    for (const index of sortAttrs)
      _sort[attributes[Math.abs(index) - 1].id] = Math.sign(index);
    const ops: Record<string, string> = { sort: JSON.stringify(_sort) };
    if (attrs.filter) ops["filter"] = attrs.filter.toString();
    void navigate("/files", ops);
  }

  // Record actions callback returns DOM nodes
  const recordActionsCallback = (file: Record<string, unknown>): Node[] => {
    return [
      a(
        {
          href: "/api/blob/files/" + encodeURIComponent(file["_id"] as string),
          class: "text-cyan-700 hover:text-cyan-900",
        },
        "Download",
      ),
    ];
  };

  // Actions callback
  let actionsCallback: ((selected: Set<string>) => Node[]) | undefined;
  if (window.authorizer.hasAccess("files", 3)) {
    actionsCallback = (selected: Set<string>): Node[] => {
      const newBtn = button(
        {
          class:
            "px-4 py-2 border border-stone-300 shadow-xs text-sm font-medium rounded-md text-stone-700 bg-white hover:bg-stone-50 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed",
          title: "Create new file",
          onclick: () => {
            let cb: (() => Node) | null = null;
            const abortController = new AbortController();
            let progress = -1;
            let formResult: PutFormResult | null = null;
            let progressBar: HTMLDivElement | null = null;
            let formContainer: HTMLDivElement | null = null;

            cb = () => {
              if (!formResult) {
                formResult = createPutForm({
                  actionHandler: async (action, obj) => {
                    if (action !== "save") throw new Error("Undefined action");
                    const o = obj as Record<string, unknown>;
                    const file = (o["file"] as FileList)?.[0];

                    // nginx strips out headers with dot, so replace with dash
                    const headers = {
                      "metadata-fileType":
                        (o["metadata.fileType"] as string) || "",
                      "metadata-oui": (o["metadata.oui"] as string) || "",
                      "metadata-productclass":
                        (o["metadata.productClass"] as string) || "",
                      "metadata-version":
                        (o["metadata.version"] as string) || "",
                    };

                    if (!file) {
                      notifications.push("error", "File not selected");
                      return;
                    }

                    if (await resourceExists("files", file.name)) {
                      invalidate(Date.now());
                      notifications.push("error", "File already exists");
                      return;
                    }

                    const progressListener = (fraction: number): void => {
                      progress = fraction;
                      if (progressBar) {
                        progressBar.style.width = `${Math.trunc(progress * 100)}%`;
                        progressBar.style.display = "block";
                      }
                    };

                    progress = 0;
                    if (progressBar) {
                      progressBar.style.width = "0%";
                      progressBar.style.display = "block";
                    }
                    try {
                      await upload(
                        file,
                        headers,
                        abortController.signal,
                        progressListener,
                      );
                      invalidate(Date.now());
                      notifications.push("success", "File created");
                      overlay.close(cb!);
                    } catch (err) {
                      notifications.push("error", (err as Error).message);
                    }
                    progress = -1;
                    if (progressBar) {
                      progressBar.style.display = "none";
                    }
                  },
                  ...formData,
                });

                // Create container with progress bar
                progressBar = div({
                  class: "progress-bar bg-cyan-500 h-2 rounded transition-all",
                  style: "width: 0%; display: none;",
                }) as HTMLDivElement;

                formContainer = div(
                  {},
                  div(
                    {
                      class:
                        "progress mb-4 bg-stone-200 rounded h-2 overflow-hidden",
                    },
                    progressBar,
                  ),
                  formResult.element,
                ) as HTMLDivElement;
              }
              return formContainer!;
            };
            overlay.open(cb, () => {
              if (
                formResult?.isModified() &&
                !confirm("You have unsaved changes. Close anyway?")
              )
                return false;
              abortController.abort();
              return true;
            });
          },
        },
        "New",
      );

      const deleteBtn = button(
        {
          class:
            "px-4 py-2 border border-stone-300 shadow-xs text-sm font-medium rounded-md text-stone-700 bg-white hover:bg-stone-50 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed",
          title: "Delete selected files",
          disabled: !selected.size,
          onclick: (e) => {
            if (!confirm(`Deleting ${selected.size} files. Are you sure?`))
              return;

            const btn = e.currentTarget as HTMLButtonElement;
            btn.disabled = true;
            Promise.all(
              Array.from(selected).map((id) => deleteResource("files", id)),
            )
              .then((res) => {
                notifications.push("success", `${res.length} files deleted`);
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
    h1({ class: "text-xl font-medium text-stone-900 mb-5" }, "Listing files"),
    createFilter({
      resource: "files",
      filter: attrs.filter,
      onChange: onFilterChanged,
    }),
    createIndexTable({
      attributes,
      data: () =>
        filesQuery.get().value.slice(0, showCount.get()) as Record<
          string,
          unknown
        >[],
      total: () => countQuery.get().value,
      loading: () => filesQuery.get().loading,
      showMoreCallback: () => showCount.set(showCount.get() + PAGE_SIZE),
      sortAttributes,
      onSortChange,
      downloadUrl,
      recordActionsCallback,
      actionsCallback,
    }),
  );
}
