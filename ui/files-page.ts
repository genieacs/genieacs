import { ClosureComponent, Component, Children } from "mithril";
import { m } from "./components.ts";
import { pageSize as PAGE_SIZE } from "./config.ts";
import filterComponent from "./filter-component.ts";
import * as store from "./store.ts";
import * as notifications from "./notifications.ts";
import memoize from "../lib/common/memoize.ts";
import putFormComponent from "./put-form-component.ts";
import indexTableComponent from "./index-table-component.ts";
import * as overlay from "./overlay.ts";
import * as smartQuery from "./smart-query.ts";
import Expression from "../lib/common/expression.ts";

const memoizedJsonParse = memoize(JSON.parse);

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

const unpackSmartQuery = memoize((query: Expression) => {
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
});

function upload(
  file: File,
  headers: Record<string, string>,
  abortSignal?: AbortSignal,
  progressListener?: (e: ProgressEvent) => void,
): Promise<void> {
  headers = Object.assign(
    {
      "Content-Type": "application/octet-stream",
    },
    headers,
  );
  return store.xhrRequest({
    method: "PUT",
    headers: headers,
    url: `api/files/${encodeURIComponent(file.name)}`,
    serialize: (body) => body, // Identity function to prevent JSON.parse on blob data
    body: file,
    config: (xhr) => {
      if (progressListener)
        xhr.upload.addEventListener("progress", progressListener);
      if (abortSignal) {
        if (abortSignal.aborted) xhr.abort();
        abortSignal.addEventListener("abort", () => xhr.abort());
      }
    },
  });
}

const getDownloadUrl = memoize((filter) => {
  const cols = {};
  for (const attr of attributes) cols[attr.label] = attr.id;
  return `api/files.csv?${m.buildQueryString({
    filter: filter.toString(),
    columns: JSON.stringify(cols),
  })}`;
});

export function init(
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!window.authorizer.hasAccess("files", 2)) {
    return Promise.reject(
      new Error("You are not authorized to view this page"),
    );
  }

  let filter: Expression = null;
  let sort: Record<string, number> = null;
  if (args.hasOwnProperty("filter"))
    filter = Expression.parse(args["filter"] as string);
  if (args.hasOwnProperty("sort")) sort = JSON.parse(args["sort"] as string);
  return Promise.resolve({ filter, sort });
}

export const component: ClosureComponent = (): Component => {
  return {
    view: (vnode) => {
      document.title = "Files - GenieACS";

      function showMore(): void {
        vnode.state["showCount"] =
          (vnode.state["showCount"] || PAGE_SIZE) + PAGE_SIZE;
        m.redraw();
      }

      function onFilterChanged(filter): void {
        const ops = {};
        if (!(filter instanceof Expression.Literal && filter.value))
          ops["filter"] = filter.toString();
        if (vnode.attrs["sort"]) ops["sort"] = vnode.attrs["sort"];
        m.route.set("/files", ops);
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
        m.route.set("/files", ops);
      }

      const filter = unpackSmartQuery(
        vnode.attrs["filter"] ?? new Expression.Literal(true),
      );

      const files = store.fetch("files", filter, {
        limit: vnode.state["showCount"] || PAGE_SIZE,
        sort: sort,
      });

      const count = store.count("files", filter);

      const downloadUrl = getDownloadUrl(filter);

      const attrs = {};
      attrs["attributes"] = attributes;
      attrs["data"] = files.value;
      attrs["total"] = count.value;
      attrs["showMoreCallback"] = showMore;
      attrs["sortAttributes"] = sortAttributes;
      attrs["onSortChange"] = onSortChange;
      attrs["downloadUrl"] = downloadUrl;
      attrs["recordActionsCallback"] = (file) => {
        return [
          m(
            "a.text-cyan-700 hover:text-cyan-900",
            { href: "api/blob/files/" + file["_id"] },
            "Download",
          ),
        ];
      };

      if (window.authorizer.hasAccess("files", 3)) {
        attrs["actionsCallback"] = (selected: Set<string>): Children => {
          return [
            m(
              "button.px-4 py-2 border border-stone-300 shadow-xs text-sm font-medium rounded-md text-stone-700 bg-white hover:bg-stone-50 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed",
              {
                title: "Create new file",
                onclick: () => {
                  let cb: () => Children = null;
                  const abortController = new AbortController();
                  let progress = -1;
                  const comp = m(
                    putFormComponent,
                    Object.assign(
                      {
                        actionHandler: async (action, obj) => {
                          if (action !== "save")
                            throw new Error("Undefined action");
                          const file = obj["file"]?.[0];

                          // nginx strips out headers with dot, so replace with dash
                          const headers = {
                            "metadata-fileType": obj["metadata.fileType"] || "",
                            "metadata-oui": obj["metadata.oui"] || "",
                            "metadata-productclass":
                              obj["metadata.productClass"] || "",
                            "metadata-version": obj["metadata.version"] || "",
                          };

                          if (!file) {
                            notifications.push("error", "File not selected");
                            return;
                          }

                          if (await store.resourceExists("files", file.name)) {
                            store.setTimestamp(Date.now());
                            notifications.push("error", "File already exists");
                            return;
                          }

                          const progressListener = (e: ProgressEvent): void => {
                            progress = e.loaded / e.total;
                            m.redraw();
                          };

                          progress = 0;
                          try {
                            await upload(
                              file,
                              headers,
                              abortController.signal,
                              progressListener,
                            );
                            store.setTimestamp(Date.now());
                            notifications.push("success", "File created");
                            overlay.close(cb);
                          } catch (err) {
                            notifications.push("error", err.message);
                          }
                          progress = -1;
                        },
                      },
                      formData,
                    ),
                  );
                  cb = () => {
                    if (progress < 0) return [null, comp];
                    return [
                      m(
                        "div.progress",
                        m("div.progress-bar", {
                          style: `width: ${Math.trunc(progress * 100)}%`,
                        }),
                      ),
                      comp,
                    ];
                  };
                  overlay.open(cb, () => {
                    if (
                      comp.state["current"]["modified"] &&
                      !confirm("You have unsaved changes. Close anyway?")
                    )
                      return false;
                    abortController.abort();
                    return true;
                  });
                },
              },
              "New",
            ),
            m(
              "button.px-4 py-2 border border-stone-300 shadow-xs text-sm font-medium rounded-md text-stone-700 bg-white hover:bg-stone-50 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed",
              {
                title: "Delete selected files",
                disabled: !selected.size,
                onclick: (e) => {
                  if (
                    !confirm(`Deleting ${selected.size} files. Are you sure?`)
                  )
                    return;

                  e.redraw = false;
                  e.target.disabled = true;
                  Promise.all(
                    Array.from(selected).map((id) =>
                      store.deleteResource("files", id),
                    ),
                  )
                    .then((res) => {
                      notifications.push(
                        "success",
                        `${res.length} files deleted`,
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
        resource: "files",
        filter: vnode.attrs["filter"],
        onChange: onFilterChanged,
      };

      return [
        m("h1.text-xl font-medium text-stone-900 mb-5", "Listing files"),
        m(filterComponent, filterAttrs),
        m(
          "loading",
          { queries: [files, count] },
          m(indexTableComponent, attrs),
        ),
      ];
    },
  };
};
