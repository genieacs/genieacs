import { ClosureComponent, Component, Children } from "mithril";
import { m } from "./components.ts";
import { getIcon } from "./icons.ts";
import debounce from "../lib/common/debounce.ts";

interface Attribute {
  id?: string;
  label: string;
  type?: string;
}

const MAX_PAGE_SIZE = 200;

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
    const selectAll = m("input", {
      type: "checkbox",
      checked: records.length && selected.size === records.length,
      onchange: (e) => {
        for (const record of records) {
          const id = record["_id"] || record["DeviceID.ID"].value[0];
          if (e.target.checked) selected.add(id);
          else selected.delete(id);
        }
      },
      disabled: !total,
    });
    labels.push(m("th", selectAll));
  }

  for (let i = 0; i < attributes.length; i++) {
    const attr = attributes[i];
    const label = attr.label;
    if (!sortAttributes.hasOwnProperty(i)) {
      labels.push(m("th", label));
      continue;
    }

    let symbol = getIcon("unsorted");
    if (sortAttributes[i] > 0) symbol = getIcon("sorted-asc");
    else if (sortAttributes[i] < 0) symbol = getIcon("sorted-dsc");

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

    labels.push(m("th", [label, sortable]));
  }

  // Table rows
  const rows = [];
  for (const record of records) {
    const id = record["_id"] || record["DeviceID.ID"].value[0];
    const tds = [];
    if (buttons.length) {
      const checkbox = m("input", {
        type: "checkbox",
        checked: selected.has(id),
        onchange: (e) => {
          if (e.target.checked) selected.add(id);
          else selected.delete(id);
        },
        onclick: (e) => {
          e.stopPropagation();
          e.redraw = false;
        },
      });
      tds.push(m("td", checkbox));
    }

    for (const attr of attributes) {
      const attrs = {};
      let valueComponent;

      if (typeof valueCallback === "function") {
        valueComponent = valueCallback(attr, record);
      } else if (attr.type === "code") {
        const firstLines = record[attr.id].split("\n", 11);
        if (firstLines.length > 10) firstLines[10] = ["\ufe19"];
        if (attrs["title"] == null) attrs["title"] = firstLines.join("\n");
        valueComponent = firstLines[0] || "";
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

    for (const button of recordButtons)
      tds.push(m("td.table-row-links", button));

    rows.push(
      m(
        "tr",
        {
          onclick: (e) => {
            if (["INPUT", "BUTTON", "A"].includes(e.target.nodeName)) {
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

  if (!rows.length)
    rows.push(m("tr.empty", m("td", { colspan: labels.length }, "No records")));

  // Table footer
  const footerElements = [];
  if (total != null) footerElements.push(`${records.length}/${total}`);
  else footerElements.push(`${records.length}`);

  footerElements.push(
    m(
      "button",
      {
        title: "Show more records",
        onclick: showMoreCallback,
        disabled:
          !data.length || records.length >= Math.min(MAX_PAGE_SIZE, total),
      },
      "More",
    ),
  );

  if (downloadUrl) {
    footerElements.push(
      m("a.download-csv", { href: downloadUrl, download: "" }, "Download"),
    );
  }

  const tfoot = m(
    "tfoot",
    m("tr", m("td", { colspan: labels.length }, footerElements)),
  );

  const children = [
    m(
      "table.table.highlight",
      m("thead", m("tr", labels)),
      m("tbody", rows),
      tfoot,
    ),
  ];

  if (buttons.length) children.push(m("div.actions-bar", buttons));
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
        const id = record["_id"] || record["DeviceID.ID"].value[0];
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
