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
import { deleteResource } from "./api-client.ts";
import * as notifications from "./notifications.ts";
import * as smartQuery from "./smart-query.ts";
import { stringify as yamlStringify } from "../lib/common/yaml.ts";
import Expression from "../lib/common/expression.ts";
import { div, h1, button, a } from "./dom.ts";
import { createLongText } from "./long-text-component.ts";

const attributes = [
  { id: "device", label: "Device" },
  { id: "channel", label: "Channel" },
  { id: "code", label: "Code" },
  { id: "message", label: "Message" },
  { id: "detail", label: "Detail" },
  { id: "retries", label: "Retries" },
  { id: "timestamp", label: "Timestamp" },
];

function getDownloadUrl(filter: Expression): string {
  const cols: Record<string, string> = {};
  for (const attr of attributes) {
    cols[attr.label] =
      attr.id === "timestamp" ? `DATE_STRING(${attr.id})` : attr.id;
  }

  return `/api/faults.csv?${new URLSearchParams({
    filter: filter.toString(),
    columns: JSON.stringify(cols),
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
            "faults",
            e.args[0].value as string,
            e.args[1].value as string,
          );
        }
      }
    }
    return e;
  });
}

async function deleteFaults(faults: Iterable<string>): Promise<void> {
  const proms: Map<string, Promise<void>> = new Map();
  for (const f of faults) {
    const deviceId = f.split(":", 1)[0];
    let p = proms.get(deviceId);
    if (p == null) p = deleteResource("faults", f);
    else p = p.then(() => deleteResource("faults", f));
    proms.set(deviceId, p);
  }
  await Promise.all(proms.values());
}

export interface Attrs {
  filter?: Expression;
  sort?: Record<string, number>;
}

export function init(args: URLSearchParams): Promise<Attrs> {
  if (!window.authorizer.hasAccess("faults", 2)) {
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
  document.title = "Faults - GenieACS";

  const showCount = new StateSignal(PAGE_SIZE);

  const sort = attrs.sort ?? {};

  const filter = unpackSmartQuery(attrs.filter ?? new Expression.Literal(true));

  // Reactive data signals
  const faultsQuery = reactiveFetch("faults", filter, { sort });
  const countQuery = reactiveCount("faults", filter);

  const downloadUrl = getDownloadUrl(filter);

  const sortAttributes: Record<number, number> = {};
  for (let i = 0; i < attributes.length; i++) {
    const attr = attributes[i];
    if (attr.id !== "detail") sortAttributes[i] = sort[attr.id] || 0;
  }

  function onFilterChanged(f: Expression): void {
    const ops: Record<string, string> = {};
    if (!(f instanceof Expression.Literal && f.value))
      ops["filter"] = f.toString();
    if (attrs.sort) ops["sort"] = JSON.stringify(attrs.sort);
    void navigate("/faults", ops);
  }

  function onSortChange(sortAttrs: number[]): void {
    const _sort: Record<string, number> = {};
    for (const index of sortAttrs)
      _sort[attributes[Math.abs(index) - 1].id] = Math.sign(index);
    const ops: Record<string, string> = { sort: JSON.stringify(_sort) };
    if (attrs.filter) ops["filter"] = attrs.filter.toString();
    void navigate("/faults", ops);
  }

  // Value callback returns DOM nodes or primitives
  const valueCallback = (
    attr: { id?: string; label: string },
    fault: Record<string, unknown>,
  ): Node | string => {
    if (attr.id === "device") {
      return a(
        {
          href: `/devices/${encodeURIComponent(fault["device"] as string)}`,
          class: "text-cyan-700 hover:text-cyan-900 font-medium",
        },
        fault["device"] as string,
      );
    }

    if (attr.id === "message") {
      return createLongText({
        text: fault["message"] as string,
        class: "max-w-xs",
      });
    }

    if (attr.id === "detail") {
      return createLongText({
        text: yamlStringify(fault["detail"] as Record<string, unknown> | null),
        class: "max-w-xs",
      });
    }

    if (attr.id === "timestamp")
      return new Date(fault["timestamp"] as string | number).toLocaleString();

    return fault[attr.id as string] as string;
  };

  // Actions callback returns DOM nodes
  let actionsCallback: ((selected: Set<string>) => Node[]) | undefined;
  if (window.authorizer.hasAccess("faults", 3)) {
    actionsCallback = (selected: Set<string>): Node[] => {
      return [
        button(
          {
            class:
              "px-4 py-2 border border-stone-300 shadow-xs text-sm font-medium rounded-md text-stone-700 bg-white hover:bg-stone-50 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed",
            disabled: selected.size === 0,
            title: "Delete selected faults",
            onclick: (e: MouseEvent) => {
              const btn = e.currentTarget as HTMLButtonElement;
              btn.disabled = true;

              if (!confirm(`Deleting ${selected.size} faults. Are you sure?`)) {
                btn.disabled = selected.size === 0;
                return;
              }

              const c = selected.size;
              deleteFaults(selected)
                .then(() => {
                  notifications.push("success", `${c} faults deleted`);
                  invalidate(Date.now());
                })
                .catch((err) => {
                  notifications.push("error", err.message);
                  invalidate(Date.now());
                });
            },
          },
          "Delete",
        ),
      ];
    };
  }

  // Build DOM once — table updates itself via signals
  return div(
    {},
    h1({ class: "text-xl font-medium text-stone-900 mb-5" }, "Listing faults"),
    createFilter({
      resource: "faults",
      filter: attrs.filter,
      onChange: onFilterChanged,
    }),
    createIndexTable({
      attributes,
      data: () =>
        faultsQuery.get().value.slice(0, showCount.get()) as Record<
          string,
          unknown
        >[],
      total: () => countQuery.get().value,
      loading: () => faultsQuery.get().loading,
      valueCallback,
      showMoreCallback: () => showCount.set(showCount.get() + PAGE_SIZE),
      sortAttributes,
      onSortChange,
      downloadUrl,
      actionsCallback,
    }),
  );
}
