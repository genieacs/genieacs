import { ClosureComponent, Component, Children } from "mithril";
import { m } from "./components";

interface Attribute {
  id?: string;
  label: string;
  type?: string;
}

function renderTable(
  attributes: Attribute[],
  data: Record<string, any>[],
  total: number,
  showMoreCallback: () => void,
  selected: Set<string>,
  sortAttributes: Record<string, any>,
  onSortChange: (obj: Record<string, number>) => void,
  downloadUrl?: string,
  valueCallback?: (attr: Attribute, record: Record<string, any>) => Children,
  actionsCallback?: Children | ((selected: Set<string>) => Children),
  recordActionsCallback?: Children | ((record: Record<string, any>) => Children)
): Children {
  const records = data || [];
  const selectAll = m("input", {
    type: "checkbox",
    checked: records.length && selected.size === records.length,
    onchange: e => {
      for (const record of records) {
        const id = record["_id"] || record["DeviceID.ID"].value[0];
        if (e.target.checked) selected.add(id);
        else selected.delete(id);
      }
    },
    disabled: !total
  });

  // Table header
  const labels = [m("th", selectAll)];
  for (let i = 0; i < attributes.length; i++) {
    const attr = attributes[i];
    const label = attr.label;
    if (!sortAttributes.hasOwnProperty(i)) {
      labels.push(m("th", label));
      continue;
    }

    let direction = 1;

    let symbol = "\u2981";
    if (sortAttributes[i] > 0) symbol = "\u2bc6";
    else if (sortAttributes[i] < 0) symbol = "\u2bc5";

    const sortable = m(
      "button",
      {
        onclick: () => {
          if (sortAttributes[i] > 0) direction *= -1;
          return onSortChange({ [i]: direction });
        }
      },
      symbol
    );

    labels.push(m("th", [label, sortable]));
  }

  // Table rows
  const rows = [];
  for (const record of records) {
    const id = record["_id"] || record["DeviceID.ID"].value[0];
    const checkbox = m("input", {
      type: "checkbox",
      checked: selected.has(id),
      onchange: e => {
        if (e.target.checked) selected.add(id);
        else selected.delete(id);
      },
      onclick: e => {
        e.stopPropagation();
        e.redraw = false;
      }
    });

    const tds = [m("td", checkbox)];
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
          onclick: e => {
            if (["INPUT", "BUTTON", "A"].includes(e.target.nodeName)) {
              e.redraw = false;
              return;
            }

            if (!selected.delete(id)) selected.add(id);
          }
        },
        tds
      )
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
        disabled: !data.length || records.length >= total
      },
      "More"
    )
  );

  if (downloadUrl) {
    footerElements.push(
      m("a.download-csv", { href: downloadUrl, download: "" }, "Download")
    );
  }

  const tfoot = m(
    "tfoot",
    m("tr", m("td", { colspan: labels.length }, footerElements))
  );

  // Actions bar
  let buttons: Children = [];
  if (typeof actionsCallback === "function") {
    buttons = actionsCallback(selected);
    if (!Array.isArray(buttons)) buttons = [buttons];
  } else if (Array.isArray(actionsCallback)) {
    buttons = actionsCallback;
  }

  const children = [
    m(
      "table.table.highlight",
      m("thead", m("tr", labels)),
      m("tbody", rows),
      tfoot
    )
  ];

  if (buttons.length) children.push(m("div.actions-bar", buttons));
  return children;
}

const component: ClosureComponent = (): Component => {
  let selected = new Set();

  return {
    view: vnode => {
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

      const _selected = new Set();
      for (const record of data) {
        const id = record["_id"] || record["DeviceID.ID"].value[0];
        if (selected.has(id)) _selected.add(id);
      }
      selected = _selected;

      return renderTable(
        attributes,
        data,
        total,
        showMoreCallback,
        selected,
        sortAttributes,
        onSortChange,
        downloadUrl,
        valueCallback,
        actionsCallback,
        recordActionsCallback
      );
    }
  };
};

export default component;
