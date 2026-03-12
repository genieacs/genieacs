import { ClosureComponent, Component, Children } from "mithril";
import { m } from "./components.ts";
import { icon } from "./tailwind-utility-components.ts";
import debounce from "../lib/common/debounce.ts";

interface Attribute {
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

function renderTable(
  attributes: Attribute[],
  data: Record<string, any>[],
  total: number,
  showMoreCallback: () => void,
  selected: Set<string>,
  sortAttributes: Record<string, any>,
  onSort: (i: number) => void,
  downloadUrl?: string,
  valueCallback?: (attr: Attribute, record: Record<string, any>) => Children,
  actionsCallback?: Children | ((sel: Set<string>) => Children),
  recordActionsCallback?:
    | Children
    | ((record: Record<string, any>) => Children),
): Children {
  const records = data || [];

  // Actions bar
  let buttons: Children = [];
  if (typeof actionsCallback === "function") {
    buttons = actionsCallback(selected);
    if (!Array.isArray(buttons)) buttons = [buttons];
  } else if (Array.isArray(actionsCallback)) {
    buttons = actionsCallback;
  }

  // Table header
  const labels = [];
  if (buttons.length) {
    const selectAll = m(
      "input.focus:ring-cyan-500 h-4 w-4 text-cyan-700 border-stone-300 rounded-sm",
      {
        type: "checkbox",
        checked: records.length && selected.size === records.length,
        onchange: (e) => {
          for (const record of records) {
            const id = record["_id"] ?? record["DeviceID.ID"];
            if (e.target.checked) selected.add(id);
            else selected.delete(id);
          }
        },
        disabled: !total,
      },
    );
    labels.push(
      m(
        "th",
        { class: "px-6 py-3.5 w-0", scope: "col" },
        m("span.sr-only", "Select"),
        selectAll,
      ),
    );
  }

  for (const [i, attr] of attributes.entries()) {
    let padding: string;
    if (i === 0) padding = buttons.length ? "pr-3" : "pl-6 pr-3";
    else if (i === attributes.length - +!recordActionsCallback)
      padding = "pl-3 pr-6";
    else padding = "px-3";

    const label = attr.label;
    if (!sortAttributes.hasOwnProperty(i)) {
      labels.push(
        m(
          "th",
          {
            class:
              "py-3.5 text-left text-sm font-semibold text-stone-500 " +
              padding,
            scope: "col",
          },
          label,
        ),
      );
      continue;
    }

    let symbol: Children;
    if (sortAttributes[i] > 0) {
      symbol = m(icon, { name: "sorted-asc", class: "inline h-4 w-4 ml-1" });
    } else if (sortAttributes[i] < 0) {
      symbol = m(icon, { name: "sorted-dsc", class: "inline h-4 w-4 ml-1" });
    } else {
      symbol = m(icon, {
        name: "unsorted",
        class: "inline h-4 w-4 ml-1 opacity-50 hover:opacity-100",
      });
    }

    const sortable = m(
      "button",
      {
        onclick: (e) => {
          e.redraw = false;
          onSort(i);
        },
      },
      symbol,
    );

    labels.push(
      m(
        "th",
        {
          class:
            "py-3.5 text-left text-sm font-semibold text-stone-500 whitespace-nowrap " +
            padding,
          scope: "col",
        },
        [label, sortable],
      ),
    );
  }

  if (recordActionsCallback)
    labels.push(m("th", { class: "pl-3 pr-6 py-3.5 w-0", scope: "col" }));

  // Table rows
  const rows = [];
  for (const record of records) {
    const id = record["_id"] ?? record["DeviceID.ID"];
    const tds = [];
    const isSelected = selected.has(id);
    if (buttons.length) {
      const checkbox = m(
        "input.focus:ring-cyan-500 h-4 w-4 text-cyan-700 border-stone-300 rounded-sm",
        {
          type: "checkbox",
          checked: isSelected,
          onchange: (e) => {
            if (e.target.checked) selected.add(id);
            else selected.delete(id);
          },
          onclick: (e) => {
            e.stopPropagation();
            e.redraw = false;
          },
        },
      );
      tds.push(
        m("td.px-6 py-4 whitespace-nowrap text-sm text-stone-500", checkbox),
      );
    }

    for (const [i, attr] of attributes.entries()) {
      let padding: string;
      if (i === 0) padding = buttons.length ? "pr-3" : "pl-6 pr-3";
      else if (i === attributes.length - +!recordActionsCallback)
        padding = "pl-3 pr-6";
      else padding = "px-3";

      const attrs = {
        class: "py-4 whitespace-nowrap text-sm text-stone-900 " + padding,
      };
      let valueComponent;

      if (typeof valueCallback === "function") {
        valueComponent = valueCallback(attr, record);
      } else if (attr.type === "code") {
        const excerpt = getExcerpt(record[attr.id]);
        valueComponent = m(
          "span.font-mono",
          { title: excerpt.join("\n") },
          excerpt[0],
        );
      } else {
        valueComponent = record[attr.id];
      }
      // TODO automatically add long text component on long values

      tds.push(m("td", attrs, valueComponent));
    }

    let recordButtons: Children = [];
    if (typeof recordActionsCallback === "function") {
      recordButtons = recordActionsCallback(record);
      if (!Array.isArray(recordButtons)) recordButtons = [recordButtons];
    } else if (Array.isArray(recordActionsCallback)) {
      recordButtons = recordActionsCallback;
    }

    for (const button of recordButtons) {
      tds.push(
        m(
          "td.pl-3 pr-6 py-4 whitespace-nowrap text-right text-sm font-medium",
          button,
        ),
      );
    }

    rows.push(
      m(
        "tr",
        {
          class: isSelected ? "bg-stone-50" : "",
          onclick: (e) => {
            if (e.target.closest("input, button, a")) {
              e.redraw = false;
              return;
            }

            if (!selected.delete(id)) selected.add(id);
          },
        },
        tds,
      ),
    );
  }

  if (!rows.length) {
    rows.push(
      m(
        "tr",
        m(
          "td.bg-stripes text-sm font-medium text-center text-stone-500 p-4",
          { colspan: labels.length },
          "No records",
        ),
      ),
    );
  }

  // Table footer
  const pagination = [];
  if (total != null) pagination.push(`${records.length} / ${total}`);
  else pagination.push(`${records.length}`);

  pagination.push(
    m(
      "button.px-4 py-2 border border-stone-300 rounded-md text-stone-700 bg-white hover:bg-stone-50 ml-4 disabled:opacity-50 disabled:cursor-not-allowed",
      {
        title: "Show more records",
        onclick: showMoreCallback,
        disabled:
          !data.length || records.length >= Math.min(MAX_PAGE_SIZE, total),
      },
      "More",
    ),
  );

  let download: Children;
  if (downloadUrl) {
    download = m(
      "a.text-cyan-700 hover:text-cyan-900",
      { href: downloadUrl, download: "" },
      "Download",
    );
  }

  const tfoot = m(
    "tfoot.bg-white",
    m(
      "tr",
      m(
        "td.px-6 py-3 text-sm font-medium text-stone-700",
        { colspan: labels.length },
        m(
          "div.flex items-center justify-between",
          m("div", pagination),
          download,
        ),
      ),
    ),
  );

  const children = [
    m(
      "div.flex flex-col",
      m(
        "div.-my-2 overflow-x-auto sm:-mx-6 lg:-mx-8",
        m(
          "div.py-2 align-middle inline-block min-w-full sm:px-6 lg:px-8",
          m(
            "div.shadow-sm overflow-hidden border-b border-stone-200 sm:rounded-lg",
            m(
              "table.min-w-full divide-y divide-stone-200",
              m("thead.bg-stone-50", m("tr", labels)),
              m("tbody.bg-white divide-y divide-stone-200", rows),
              tfoot,
            ),
          ),
        ),
      ),
    ),
  ];

  if (buttons.length) children.push(m("div.flex gap-3 mt-4", buttons));
  return children;
}

const component: ClosureComponent = (): Component => {
  let selected = new Set<string>();
  let sortingfunction: (events: number[]) => void;
  const onSort = debounce((events: number[]) => {
    sortingfunction(events);
  }, 500);
  return {
    view: (vnode) => {
      const attributes = vnode.attrs["attributes"];
      const data = vnode.attrs["data"];
      const valueCallback = vnode.attrs["valueCallback"];
      const total = vnode.attrs["total"];
      const showMoreCallback = vnode.attrs["showMoreCallback"];
      const sortAttributes = vnode.attrs["sortAttributes"];
      const onSortChange = vnode.attrs["onSortChange"];
      const downloadUrl = vnode.attrs["downloadUrl"];
      const actionsCallback = vnode.attrs["actionsCallback"];
      const recordActionsCallback = vnode.attrs["recordActionsCallback"];

      const _selected = new Set<string>();
      for (const record of data) {
        const id = record["_id"] ?? record["DeviceID.ID"];
        if (selected.has(id)) _selected.add(id);
      }

      sortingfunction = (events) => {
        const sortArray = new Set(
          Object.keys(sortAttributes)
            .map((x) => (parseInt(x) + 1) * sortAttributes[x])
            .filter((x) => x),
        );
        for (const num of events) {
          if (sortArray.delete(num + 1)) sortArray.add(-(num + 1));
          else if (!sortArray.delete((num + 1) * -1)) sortArray.add(num + 1);
        }
        onSortChange(Array.from(sortArray).reverse());
      };

      selected = _selected;

      return renderTable(
        attributes,
        data,
        total,
        showMoreCallback,
        selected,
        sortAttributes,
        onSort,
        downloadUrl,
        valueCallback,
        actionsCallback,
        recordActionsCallback,
      );
    },
  };
};

export default component;
