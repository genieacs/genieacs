import { m as mContext } from "./components.ts";
import { createMithrilHost } from "./mithril-compat.ts";
import { navigate } from "./router.ts";
import { pageSize as PAGE_SIZE, index as indexConfig } from "./config.ts";
import { createFilter } from "./filter-component.ts";
import { createIndexTable } from "./index-table-component.ts";
import {
  pagedFetch,
  count as reactiveCount,
  invalidate,
} from "./reactive-store.ts";
import * as store from "./legacy-store.ts";
import { StateSignal } from "./signals.ts";
import { deleteResource, updateTags } from "./api-client.ts";
import { queueTask, stageDownload } from "./task-queue.ts";
import * as notifications from "./notifications.ts";
import Expression, { extractPaths } from "../lib/common/expression.ts";
import Path from "../lib/common/path.ts";
import * as smartQuery from "./smart-query.ts";
import { renderView } from "./views.ts";
import { div, h1, button, a } from "./dom.ts";

function getSortable(p: Expression): Path | null {
  const expressionParams = extractPaths(p);
  if (expressionParams.length === 1) return expressionParams[0];
  return null;
}

function getDownloadUrl(
  filter: Expression,
  indexParameters: { label: string; parameter: Expression }[],
): string {
  const columns: Record<string, string> = {};
  for (const p of indexParameters) columns[p.label] = p.parameter.toString();
  return `/api/devices.csv?${new URLSearchParams({
    filter: filter.toString(),
    columns: JSON.stringify(columns),
  }).toString()}`;
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
            "devices",
            e.args[0].value as string,
            e.args[1].value as string,
          );
        }
      }
    }
    return e;
  });
}

export function init(args: URLSearchParams): Promise<Attrs> {
  if (!window.authorizer.hasAccess("devices", 2)) {
    return Promise.reject(
      new Error("You are not authorized to view this page"),
    );
  }
  const filterStr = args.get("filter");
  const sortStr = args.get("sort");
  const indexParameters = indexConfig;
  if (!indexParameters.length) {
    indexParameters.push({
      label: "ID",
      parameter: Expression.parse("DeviceID.ID"),
      unsortable: false,
      raw: {},
    });
  }
  return Promise.resolve({
    filter: filterStr ? Expression.parse(filterStr) : undefined,
    sort: sortStr ? JSON.parse(sortStr) : undefined,
    indexParameters,
  });
}

function renderActions(selected: Set<string>): Node[] {
  const buttons: Node[] = [];

  buttons.push(
    button(
      {
        class:
          "px-4 py-2 border border-stone-300 shadow-xs text-sm font-medium rounded-md text-stone-700 bg-white hover:bg-stone-50 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed",
        title: "Reboot selected devices",
        disabled: !selected.size,
        onclick: () => {
          const tasks = [...selected].map((s) => ({
            name: "reboot",
            device: s,
          }));
          queueTask(...tasks);
        },
      },
      "Reboot",
    ),
  );

  buttons.push(
    button(
      {
        class:
          "px-4 py-2 border border-stone-300 shadow-xs text-sm font-medium rounded-md text-stone-700 bg-white hover:bg-stone-50 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed",
        title: "Factory reset selected devices",
        disabled: !selected.size,
        onclick: () => {
          const tasks = [...selected].map((s) => ({
            name: "factoryReset",
            device: s,
          }));
          queueTask(...tasks);
        },
      },
      "Reset",
    ),
  );

  buttons.push(
    button(
      {
        class:
          "px-4 py-2 border border-stone-300 shadow-xs text-sm font-medium rounded-md text-stone-700 bg-white hover:bg-stone-50 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed",
        title: "Push a firmware or a config file",
        disabled: !selected.size,
        onclick: () => {
          stageDownload({
            name: "download",
            devices: [...selected],
          });
        },
      },
      "Push file",
    ),
  );

  buttons.push(
    button(
      {
        class:
          "px-4 py-2 border border-stone-300 shadow-xs text-sm font-medium rounded-md text-stone-700 bg-white hover:bg-stone-50 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed",
        title: "Delete selected devices",
        disabled: !selected.size,
        onclick: () => {
          const ids = Array.from(selected);
          if (!confirm(`Deleting ${ids.length} devices. Are you sure?`)) return;

          const tasks = ids.map((id) =>
            deleteResource("devices", id)
              .then(() => notifications.push("success", `${id}: Deleted`))
              .catch((err) =>
                notifications.push("error", `${id}: ${err.message}`),
              ),
          );
          void Promise.allSettled(tasks).then(() => {
            store.setTimestamp(Date.now());
            invalidate(Date.now());
          });
        },
      },
      "Delete",
    ),
  );

  buttons.push(
    button(
      {
        class:
          "px-4 py-2 border border-stone-300 shadow-xs text-sm font-medium rounded-md text-stone-700 bg-white hover:bg-stone-50 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed",
        title: "Tag selected devices",
        disabled: !selected.size,
        onclick: () => {
          const ids = Array.from(selected);
          const tag = prompt(`Enter tag to assign to ${ids.length} devices:`);
          if (!tag) return;

          const tasks = ids.map((id) =>
            updateTags(id, { [tag]: true })
              .then(() => notifications.push("success", `${id}: Tags updated`))
              .catch((err) =>
                notifications.push("error", `${id}: ${err.message}`),
              ),
          );
          void Promise.allSettled(tasks).then(() => {
            store.setTimestamp(Date.now());
            invalidate(Date.now());
          });
        },
      },
      "Tag",
    ),
  );

  buttons.push(
    button(
      {
        class:
          "px-4 py-2 border border-stone-300 shadow-xs text-sm font-medium rounded-md text-stone-700 bg-white hover:bg-stone-50 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed",
        title: "Untag selected devices",
        disabled: !selected.size,
        onclick: () => {
          const ids = Array.from(selected);
          const tag = prompt(
            `Enter tag to unassign from ${ids.length} devices:`,
          );
          if (!tag) return;

          const tasks = ids.map((id) =>
            updateTags(id, { [tag]: false })
              .then(() => notifications.push("success", `${id}: Tags updated`))
              .catch((err) =>
                notifications.push("error", `${id}: ${err.message}`),
              ),
          );
          void Promise.allSettled(tasks).then(() => {
            store.setTimestamp(Date.now());
            invalidate(Date.now());
          });
        },
      },
      "Untag",
    ),
  );

  return buttons;
}

export interface Attrs {
  indexParameters: typeof indexConfig;
  filter?: Expression;
  sort?: Record<string, number>;
}

export function createPage(attrs: Attrs): HTMLElement {
  document.title = "Devices - GenieACS";

  const showCount = new StateSignal(PAGE_SIZE);

  const attributes = attrs.indexParameters;
  const sort = attrs.sort || {};

  const filter = unpackSmartQuery(attrs.filter ?? new Expression.Literal(true));

  // Reactive data signals — the device list is limit-bounded so only the
  // visible page is ever fetched
  const devsQuery = (): { value: unknown[]; loading: boolean } =>
    pagedFetch("devices", filter, { sort, limit: showCount.get() });
  const countQuery = reactiveCount("devices", filter);

  const downloadUrl = getDownloadUrl(filter, attributes);

  const sortAttributes: Record<number, number> = {};
  for (let i = 0; i < attributes.length; i++) {
    const attr = attributes[i];
    if (attr.unsortable) continue;
    const param = getSortable(attr.parameter);
    if (param) sortAttributes[i] = sort[param.toString()] || 0;
  }

  function onFilterChanged(f: Expression): void {
    const ops: Record<string, string> = {};
    if (!(f instanceof Expression.Literal && f.value))
      ops["filter"] = f.toString();
    if (attrs.sort) ops["sort"] = JSON.stringify(attrs.sort);
    void navigate("/devices", ops);
  }

  function onSortChange(sortedAttrs: number[]): void {
    const _sort: Record<string, number> = {};
    for (const index of sortedAttrs) {
      const param = getSortable(attributes[Math.abs(index) - 1].parameter);
      if (param) _sort[param.toString()] = Math.sign(index);
    }
    const ops: Record<string, string> = { sort: JSON.stringify(_sort) };
    if (attrs.filter) ops["filter"] = attrs.filter.toString();
    void navigate("/devices", ops);
  }

  // Value callback — renders content into a DOM container
  const valueCallback = (attr: any, device: any): Node => {
    if (!attr.type && !attr.components && attr.component) {
      return div(
        {},
        renderView(attr.component, {
          ...attr,
          deviceId: device["DeviceID.ID"],
        }),
      );
    }
    return createMithrilHost(() => {
      return mContext.context(
        { device: device, parameter: attr.parameter },
        attr.type || "parameter",
        attr.raw,
      );
    });
  };

  // Record actions callback returns DOM node
  const recordActionsCallback = (device: any): Node[] => {
    return [
      a(
        {
          class: "text-cyan-700 hover:text-cyan-900",
          href: `/devices/${encodeURIComponent(device["DeviceID.ID"])}`,
        },
        "Show",
      ),
    ];
  };

  // Build DOM once — table updates itself via signals
  return div(
    {},
    h1({ class: "text-xl font-medium text-stone-900 mb-5" }, "Listing devices"),
    createFilter({
      resource: "devices",
      filter: attrs.filter,
      onChange: onFilterChanged,
    }),
    createIndexTable({
      attributes: attributes.map((attr) => ({
        ...attr,
        label: attr.label,
        type: attr.type,
      })),
      data: () => devsQuery().value as Record<string, unknown>[],
      total: () => countQuery.get().value,
      loading: () => devsQuery().loading,
      showMoreCallback: () => showCount.set(showCount.get() + PAGE_SIZE),
      sortAttributes,
      onSortChange,
      downloadUrl,
      valueCallback,
      recordActionsCallback,
      actionsCallback: window.authorizer.hasAccess("devices", 3)
        ? renderActions
        : undefined,
    }),
  );
}
