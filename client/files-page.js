"use strict";

import m from "mithril";

import config from "./config";
import filterComponent from "./filter-component";
import * as store from "./store";
import * as expression from "../common/expression";
import * as notifications from "./notifications";
import memoize from "../common/memoize";
import putFormComponent from "./put-form-component";
import * as overlay from "./overlay";
import * as smartQuery from "./smart-query";
import * as expressionParser from "../common/expression-parser";

const PAGE_SIZE = config.ui.pageSize || 10;

const memoizedParse = memoize(expression.parse);
const memoizedJsonParse = memoize(JSON.parse);

const attributes = [
  { id: "_id", label: "Name" },
  {
    id: "metadata.fileType",
    label: "Type",
    type: "combo",
    options: [
      "1 Firmware Upgrade Image",
      "2 Web Content",
      "3 Vendor Configuration File",
      "4 Tone File",
      "5 Ringer File"
    ]
  },
  { id: "metadata.oui", label: "OUI" },
  { id: "metadata.productClass", label: "Product Class" },
  { id: "metadata.version", label: "Version" }
];

const formData = {
  resource: "files",
  attributes: attributes
    .slice(1) // remove _id from new object form
    .concat([{ id: "file", label: "File", type: "file" }])
};

const unpackSmartQuery = memoize(query => {
  return expressionParser.map(query, e => {
    if (Array.isArray(e) && e[0] === "FUNC" && e[1] === "Q")
      return smartQuery.unpack("files", e[2], e[3]);
    return e;
  });
});

function putActionHandler(action, object) {
  return new Promise((resolve, reject) => {
    if (action === "save") {
      const file = object["file"] ? object["file"][0] : null;
      delete object["file"];

      if (!file) return void reject(new Error("File not selected"));

      const id = file.name;

      store
        .resourceExists("files", id)
        .then(exists => {
          if (exists) {
            store.fulfill(0, Date.now());
            return void reject(new Error("File already exists"));
          }
          const headers = Object.assign(
            {
              "Content-Type": "application/octet-stream",
              Accept: "application/octet-stream"
            },
            object
          );

          m.request({
            method: "PUT",
            headers: headers,
            url: `/api/files/${encodeURIComponent(id)}`,
            serialize: body => body, // Identity function to prevent JSON.parse on blob data
            data: file
          })
            .then(() => {
              notifications.push(
                "success",
                `File ${exists ? "updated" : "created"}`
              );
              store.fulfill(0, Date.now());
              resolve();
            })
            .catch(reject);
        })
        .catch(reject);
    } else {
      reject(new Error("Undefined action"));
    }
  });
}

const getDownloadUrl = memoize(filter => {
  const cols = {};
  for (const attr of attributes) cols[attr.label] = attr.id;
  return `/api/files.csv?${m.buildQueryString({
    filter: filter,
    columns: JSON.stringify(cols)
  })}`;
});

function init(args) {
  if (!window.authorizer.hasAccess("files", 2)) {
    return Promise.reject(
      new Error("You are not authorized to view this page")
    );
  }

  const sort = args.sort;
  const filter = args.filter;
  return Promise.resolve({ filter, sort });
}

function renderTable(
  filesResponse,
  total,
  selected,
  showMoreCallback,
  downloadUrl,
  sort,
  onSortChange
) {
  const files = filesResponse.value;
  const selectAll = m("input", {
    type: "checkbox",
    checked: files.length && selected.size === files.length,
    onchange: e => {
      for (const file of files) {
        if (e.target.checked) selected.add(file["_id"]);
        else selected.delete(file["_id"]);
      }
    },
    disabled: !total
  });

  const labels = [m("th", selectAll)];
  for (const attr of attributes) {
    const label = attr.label;

    let direction = 1;

    let symbol = "\u2981";
    if (sort[attr.id] > 0) symbol = "\u2bc6";
    else if (sort[attr.id] < 0) symbol = "\u2bc5";

    const sortable = m(
      "button",
      {
        onclick: () => {
          if (sort[attr.id] > 0) direction *= -1;
          return onSortChange(JSON.stringify({ [attr.id]: direction }));
        }
      },
      symbol
    );

    labels.push(m("th", [label, sortable]));
  }

  const rows = [];
  for (const file of files) {
    const checkbox = m("input", {
      type: "checkbox",
      checked: selected.has(file["_id"]),
      onchange: e => {
        if (e.target.checked) selected.add(file["_id"]);
        else selected.delete(file["_id"]);
      },
      onclick: e => {
        e.stopPropagation();
        e.redraw = false;
      }
    });

    const tds = [m("td", checkbox)];
    for (const attr of attributes) {
      if (attr.id == "script")
        tds.push(m("td", { title: file[attr.id] }, file[attr.id]));
      else tds.push(m("td", file[attr.id]));
    }

    rows.push(
      m(
        "tr",
        {
          onclick: e => {
            if (["INPUT", "BUTTON", "A"].includes(e.target.nodeName)) {
              e.redraw = false;
              return;
            }

            if (!selected.delete(file["_id"])) selected.add(file["_id"]);
          }
        },
        tds
      )
    );
  }

  if (!rows.length)
    rows.push(m("tr.empty", m("td", { colspan: labels.length }, "No files")));

  const footerElements = [];
  if (total != null) footerElements.push(`${files.length}/${total}`);
  else footerElements.push(`${files.length}`);

  footerElements.push(
    m(
      "button",
      {
        title: "Show more files",
        onclick: showMoreCallback,
        disabled: files.length >= total || !filesResponse.fulfilled
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

  const buttons = [
    m(
      "button.primary",
      {
        title: "Delete selected files",
        disabled: !selected.size,
        onclick: e => {
          e.redraw = false;
          e.target.disabled = true;
          Promise.all(
            Array.from(selected).map(id => store.deleteResource("files", id))
          )
            .then(res => {
              notifications.push("success", `${res.length} files deleted`);
              store.fulfill(0, Date.now());
            })
            .catch(err => {
              notifications.push("error", err.message);
            });
        }
      },
      "Delete"
    )
  ];

  if (window.authorizer.hasAccess("files", 3)) {
    buttons.push(
      m(
        "button.primary",
        {
          title: "Create new file",
          onclick: () => {
            const cb = () => {
              return m(
                putFormComponent,
                Object.assign(
                  {
                    actionHandler: (action, object) => {
                      putActionHandler(action, object)
                        .then(() => {
                          overlay.close(cb);
                        })
                        .catch(err => {
                          notifications.push("error", err.message);
                          overlay.close(cb);
                          m.redraw();
                        });
                    }
                  },
                  formData
                )
              );
            };
            overlay.open(cb);
          }
        },
        "New"
      )
    );
  }

  return [
    m(
      "table.table.highlight",
      m("thead", m("tr", labels)),
      m("tbody", rows),
      tfoot
    ),
    m("div.actions-bar", buttons)
  ];
}

const component = {
  view: vnode => {
    document.title = "Files - GenieACS";

    function showMore() {
      vnode.state.showCount = (vnode.state.showCount || PAGE_SIZE) + PAGE_SIZE;
      m.redraw();
    }

    function onFilterChanged(filter) {
      const ops = { filter };
      if (vnode.attrs.sort) ops.sort = vnode.attrs.sort;
      m.route.set(m.route.get(), ops);
    }

    function onSortChange(sort) {
      const ops = { sort };
      if (vnode.attrs.filter) ops.filter = vnode.attrs.filter;
      m.route.set(m.route.get(), ops);
    }

    const sort = vnode.attrs.sort ? memoizedJsonParse(vnode.attrs.sort) : {};
    let filter = vnode.attrs.filter ? memoizedParse(vnode.attrs.filter) : true;
    filter = unpackSmartQuery(filter);

    const files = store.fetch("files", filter, {
      limit: vnode.state.showCount || PAGE_SIZE,
      sort: sort
    });

    const count = store.count("files", filter);

    const selected = new Set();
    if (vnode.state.selected) {
      for (const file of files.value)
        if (vnode.state.selected.has(file["_id"])) selected.add(file["_id"]);
    }
    vnode.state.selected = selected;

    const downloadUrl = getDownloadUrl(vnode.attrs.filter);

    return [
      m("h1", "Listing files"),
      m(filterComponent, {
        resource: "files",
        filter: vnode.attrs.filter,
        onChange: onFilterChanged
      }),
      renderTable(
        files,
        count.value,
        selected,
        showMore,
        downloadUrl,
        sort,
        onSortChange
      )
    ];
  }
};

export { init, component };
