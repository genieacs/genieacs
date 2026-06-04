import {
  div,
  table,
  thead,
  tbody,
  tfoot,
  tr,
  th,
  td,
  input,
  button,
  a,
  span,
  each,
} from "./dom.ts";
import { StateSignal } from "./signals.ts";
import { createIcon } from "./icons.ts";
import debounce from "../lib/common/debounce.ts";

export interface IndexTableAttribute {
  id?: string;
  label: string;
  type?: string;
}

const MAX_PAGE_SIZE = 200;

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

// Normalize callback results into a flat array suitable for spreading as children
function asChildren(content: unknown): (Node | string)[] {
  if (content == null) return [];
  if (Array.isArray(content)) return content as (Node | string)[];
  return [content] as (Node | string)[];
}

function getRecordId(record: Record<string, unknown>): string {
  return (record["_id"] ?? record["DeviceID.ID"]) as string;
}

export interface IndexTableAttrs {
  attributes: IndexTableAttribute[];
  data: () => Record<string, unknown>[];
  total: () => number | undefined;
  loading: () => boolean;
  showMoreCallback: () => void;
  sortAttributes: Record<number, number>;
  onSortChange: (events: number[]) => void;
  downloadUrl?: string;
  valueCallback?: (
    attr: IndexTableAttribute,
    record: Record<string, unknown>,
  ) => unknown;
  actionsCallback?: (sel: Set<string>) => unknown[];
  recordActionsCallback?: (record: Record<string, unknown>) => unknown[];
}

export function createIndexTable(attrs: IndexTableAttrs): HTMLElement {
  const {
    attributes,
    data,
    total,
    loading,
    showMoreCallback,
    sortAttributes,
    onSortChange,
    downloadUrl,
    valueCallback,
    actionsCallback,
    recordActionsCallback,
  } = attrs;

  // Selection state — plain Set with a version counter for reactivity
  const selected = new Set<string>();
  const selVer = new StateSignal(0);

  function notifySelection(): void {
    selVer.set(selVer.get() + 1);
  }

  const hasActions = typeof actionsCallback === "function";

  // Sorting
  const onSort = debounce((args: number[]) => {
    const sortArray = new Set(
      Object.keys(sortAttributes)
        .map((x) => (parseInt(x) + 1) * sortAttributes[parseInt(x)])
        .filter((x) => x),
    );
    for (const i of args) {
      if (sortArray.delete(i + 1)) sortArray.add(-(i + 1));
      else if (!sortArray.delete(-(i + 1))) sortArray.add(i + 1);
    }
    onSortChange(Array.from(sortArray).reverse());
  }, 500);

  // Column count for colspan
  const colCount =
    attributes.length + (hasActions ? 1 : 0) + (recordActionsCallback ? 1 : 0);

  // --- Row renderer (called once per new record by each()) ---
  function renderRow(record: Record<string, unknown>): Node {
    const id = getRecordId(record);
    const cells: Node[] = [];

    if (hasActions) {
      cells.push(
        td(
          { class: "px-6 py-4 whitespace-nowrap text-sm text-stone-500" },
          input({
            type: "checkbox",
            class:
              "focus:ring-cyan-500 h-4 w-4 text-cyan-700 border-stone-300 rounded-sm",
            checked: () => {
              selVer.get();
              return selected.has(id);
            },
            onchange: (e) => {
              if ((e.target as HTMLInputElement).checked) selected.add(id);
              else selected.delete(id);
              notifySelection();
            },
            onclick: (e) => e.stopPropagation(),
          }),
        ),
      );
    }

    for (const [i, attr] of attributes.entries()) {
      let padding: string;
      if (i === 0) padding = hasActions ? "pr-3" : "pl-6 pr-3";
      else if (i === attributes.length - (recordActionsCallback ? 0 : 1))
        padding = "pl-3 pr-6";
      else padding = "px-3";

      let content: unknown;
      if (typeof valueCallback === "function") {
        content = valueCallback(attr, record);
      } else if (attr.type === "code" && attr.id) {
        const excerpt = getExcerpt(record[attr.id] as string);
        content = span(
          { class: "font-mono", title: excerpt.join("\n") },
          excerpt[0],
        );
      } else if (attr.id) {
        content = record[attr.id];
      }

      cells.push(
        td(
          { class: "py-4 whitespace-nowrap text-sm text-stone-900 " + padding },
          ...asChildren(content),
        ),
      );
    }

    if (typeof recordActionsCallback === "function") {
      const recordButtons = recordActionsCallback(record);
      const buttonList = Array.isArray(recordButtons)
        ? recordButtons
        : [recordButtons];
      for (const btn of buttonList) {
        cells.push(
          td(
            {
              class:
                "pl-3 pr-6 py-4 whitespace-nowrap text-right text-sm font-medium",
            },
            ...asChildren(btn),
          ),
        );
      }
    }

    return tr(
      {
        class: () => {
          selVer.get();
          return selected.has(id) ? "bg-stone-50" : "";
        },
        onclick: (e) => {
          if ((e.target as HTMLElement).closest("input, button, a")) return;
          if (!selected.delete(id)) selected.add(id);
          notifySelection();
        },
      },
      ...cells,
    );
  }

  // --- Header (static — sort state comes from URL, fixed per page) ---
  const headerCells: Node[] = [];

  if (hasActions) {
    headerCells.push(
      th(
        { class: "px-6 py-3.5 w-0", scope: "col" },
        span({ class: "sr-only" }, "Select"),
        input({
          type: "checkbox",
          class:
            "focus:ring-cyan-500 h-4 w-4 text-cyan-700 border-stone-300 rounded-sm",
          checked: () => {
            selVer.get();
            const records = data();
            return records.length > 0 && selected.size === records.length;
          },
          disabled: () => !total(),
          onchange: (e) => {
            const checked = (e.target as HTMLInputElement).checked;
            for (const record of data()) {
              const id = getRecordId(record);
              if (checked) selected.add(id);
              else selected.delete(id);
            }
            notifySelection();
          },
        }),
      ),
    );
  }

  for (const [i, attr] of attributes.entries()) {
    let padding: string;
    if (i === 0) padding = hasActions ? "pr-3" : "pl-6 pr-3";
    else if (i === attributes.length - (recordActionsCallback ? 0 : 1))
      padding = "pl-3 pr-6";
    else padding = "px-3";

    if (!sortAttributes.hasOwnProperty(i)) {
      headerCells.push(
        th(
          {
            class:
              "py-3.5 text-left text-sm font-semibold text-stone-500 " +
              padding,
            scope: "col",
          },
          attr.label,
        ),
      );
      continue;
    }

    let iconName: string;
    let iconClass = "inline h-4 w-4 ml-1";
    if (sortAttributes[i] > 0) iconName = "sorted-asc";
    else if (sortAttributes[i] < 0) iconName = "sorted-dsc";
    else {
      iconName = "unsorted";
      iconClass += " opacity-50 hover:opacity-100";
    }

    headerCells.push(
      th(
        {
          class:
            "py-3.5 text-left text-sm font-semibold text-stone-500 whitespace-nowrap " +
            padding,
          scope: "col",
        },
        attr.label,
        button(
          { onclick: () => onSort(i) },
          createIcon({ name: iconName, class: iconClass }),
        ),
      ),
    );
  }

  if (recordActionsCallback) {
    headerCells.push(th({ class: "pl-3 pr-6 py-3.5 w-0", scope: "col" }));
  }

  // --- Table (created once, children update via signals) ---
  const tableEl = table(
    { class: "min-w-full divide-y divide-stone-200" },
    thead({ class: "bg-stone-50" }, tr(...headerCells)),
    tbody(
      { class: "bg-white divide-y divide-stone-200" },
      // Keyed rows — each() handles add/remove/reorder
      each(data, (record) => getRecordId(record), renderRow),
      // Empty / loading state (shows only when data is empty)
      () => {
        if (data().length > 0) return null;
        if (loading()) {
          return tr(
            td(
              {
                class: "text-sm font-medium text-center text-stone-500 p-4",
                colspan: colCount,
              },
              "Loading\u2026",
            ),
          );
        }
        return tr(
          td(
            {
              class:
                "bg-stripes text-sm font-medium text-center text-stone-500 p-4",
              colspan: colCount,
            },
            "No records",
          ),
        );
      },
    ),
    tfoot(
      { class: "bg-white" },
      tr(
        td(
          {
            class: "px-6 py-3 text-sm font-medium text-stone-700",
            colspan: colCount,
          },
          div(
            { class: "flex items-center justify-between" },
            div(
              {},
              // Reactive pagination text
              () => {
                const t = total();
                const len = data().length;
                return t != null ? `${len} / ${t}` : `${len}`;
              },
              button(
                {
                  class:
                    "px-4 py-2 border border-stone-300 rounded-md text-stone-700 bg-white hover:bg-stone-50 ml-4 disabled:opacity-50 disabled:cursor-not-allowed",
                  title: "Show more records",
                  disabled: () => {
                    const records = data();
                    const t = total();
                    return (
                      !records.length ||
                      records.length >= Math.min(MAX_PAGE_SIZE, t ?? 0)
                    );
                  },
                  onclick: showMoreCallback,
                },
                "More",
              ),
            ),
            downloadUrl
              ? a(
                  {
                    class: "text-cyan-700 hover:text-cyan-900",
                    href: downloadUrl,
                    download: "",
                  },
                  "Download",
                )
              : null,
          ),
        ),
      ),
    ),
  );

  // --- Assemble ---
  return div(
    { class: "flex flex-col" },
    div(
      { class: "-my-2 overflow-x-auto sm:-mx-6 lg:-mx-8" },
      div(
        { class: "py-2 align-middle inline-block min-w-full sm:px-6 lg:px-8" },
        div(
          {
            class:
              "shadow-sm overflow-hidden border-b border-stone-200 sm:rounded-lg",
          },
          tableEl,
        ),
      ),
    ),
    // Reactive actions bar
    hasActions
      ? () => {
          selVer.get();
          // Clean stale selections; notify so other reactives (e.g. select-all
          // checkbox) re-evaluate against the pruned set.
          const dataIds = new Set(data().map(getRecordId));
          let pruned = false;
          for (const id of selected) {
            if (!dataIds.has(id)) {
              selected.delete(id);
              pruned = true;
            }
          }
          if (pruned) notifySelection();
          const buttons = (actionsCallback as (sel: Set<string>) => unknown[])(
            selected,
          );
          return div({ class: "flex gap-3 mt-4" }, ...asChildren(buttons));
        }
      : null,
  );
}
