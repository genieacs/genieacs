"use strict";

import m from "mithril";

import config from "./config";
import filterComponent from "./filter-component";
import * as overlay from "./overlay";
import * as store from "./store";
import * as expression from "../common/expression";
import * as notifications from "./notifications";
import putForm from "./components/put-form";
import memoize from "../common/memoize";

const PAGE_SIZE = config.ui.pageSize || 10;

const memoizedParse = memoize(expression.parse);

const attributes = [
  { id: "_id", label: "Name" },
  { id: "channel", label: "Channel" },
  { id: "weight", label: "Weight" },
  { id: "schedule", label: "Schedule" },
  { id: "events", label: "Events" },
  { id: "precondition", label: "Precondition" },
  { id: "provision", label: "Provision" },
  { id: "provisionArgs", label: "Arguments" }
];

function putActoinHandler(action, object, isNew) {
  if (action === "save") {
    let id = object["_id"];
    delete object["_id"];

    if (!id) return notifications.push("error", "ID can not be empty");

    store
      .resourceExists("presets", id)
      .then(exists => {
        if (exists && isNew) {
          notifications.push("error", "Preset already exists");
          store.fulfill(0, Date.now());
          return;
        }

        if (!exists && !isNew) {
          notifications.push("error", "Preset already deleted");
          store.fulfill(0, Date.now());
          return;
        }

        store
          .putResource("presets", id, object)
          .then(() => {
            notifications.push(
              "success",
              `Preset ${exists ? "updated" : "created"}`
            );
            store.fulfill(0, Date.now());
          })
          .catch(err => {
            notifications.push("error", err.message);
          });
      })
      .catch(err => {
        notifications.push("error", err.message);
      });
  } else if (action === "delete") {
    store
      .deleteResource("presets", object["_id"])
      .then(() => {
        notifications.push("success", "Preset deleted");
        store.fulfill(0, Date.now());
      })
      .catch(err => {
        notifications.push("error", err.message);
      });
  } else {
    throw new Error("Undefined action");
  }
}

let formData = {
  resource: "presets",
  attributes: attributes
};

const getDownloadUrl = memoize(filter => {
  let cols = {};
  for (let attr of attributes) cols[attr.label] = attr.id;
  return `/api/presets.csv?${m.buildQueryString({
    filter: filter,
    columns: JSON.stringify(cols)
  })}`;
});

function init(args) {
  if (!window.authorizer.hasAccess("presets", 2))
    return Promise.reject(
      new Error("You are not authorized to view this page")
    );

  const filter = args.filter;
  return Promise.resolve({ filter });
}

function renderTable(
  presetsResponse,
  total,
  selected,
  showMoreCallback,
  downloadUrl
) {
  const presets = presetsResponse.value;
  const selectAll = m("input", {
    type: "checkbox",
    checked: presets.length && selected.size === presets.length,
    onchange: e => {
      for (let preset of presets)
        if (e.target.checked) selected.add(preset["_id"]);
        else selected.delete(preset["_id"]);
    },
    disabled: !total
  });

  const labels = [selectAll]
    .concat(attributes.map(elem => elem.label))
    .map(l => m("th", l));

  let rows = [];
  for (let preset of presets) {
    let checkbox = m("input", {
      type: "checkbox",
      checked: selected.has(preset["_id"]),
      onchange: e => {
        if (e.target.checked) selected.add(preset["_id"]);
        else selected.delete(preset["_id"]);
      },
      onclick: e => {
        e.stopPropagation();
        e.redraw = false;
      }
    });

    let devicesUrl = "/#!/devices";
    if (preset["precondition"].length)
      devicesUrl += `?${m.buildQueryString({
        filter: preset["precondition"]
      })}`;

    let tds = [m("td", checkbox)];
    for (let attr of attributes)
      if (attr.id === "precondition")
        tds.push(
          m(
            "td",
            { title: preset[attr.id] },
            m("a", { href: devicesUrl }, preset[attr.id])
          )
        );
      else tds.push(m("td", preset[attr.id]));

    tds.push(
      m(
        "td.table-row-links",
        m(
          "a",
          {
            onclick: () => {
              let cb = () => {
                return m(
                  putForm,
                  Object.assign(
                    {
                      base: preset,
                      actionHandler: (action, object) => {
                        overlay.close(cb);
                        putActoinHandler(action, object, false);
                      }
                    },
                    formData
                  )
                );
              };
              overlay.open(cb);
            }
          },
          "Show"
        )
      )
    );

    rows.push(
      m(
        "tr",
        {
          onclick: e => {
            if (["INPUT", "BUTTON", "A"].includes(e.target.nodeName)) {
              e.redraw = false;
              return;
            }

            if (!selected.delete(preset["_id"])) selected.add(preset["_id"]);
          }
        },
        tds
      )
    );
  }

  if (!rows.length)
    rows.push(m("tr.empty", m("td", { colspan: labels.length }, "No presets")));

  let footerElements = [];
  if (total != null) footerElements.push(`${presets.length}/${total}`);
  else footerElements.push(`${presets.length}`);

  footerElements.push(
    m(
      "button",
      {
        title: "Show more presets",
        onclick: showMoreCallback,
        disabled: presets.length >= total || !presetsResponse.fulfilled
      },
      "More"
    )
  );

  if (downloadUrl)
    footerElements.push(
      m("a.download-csv", { href: downloadUrl, download: "" }, "Download")
    );

  let tfoot = m(
    "tfoot",
    m("tr", m("td", { colspan: labels.length }, footerElements))
  );

  const buttons = [
    m(
      "button.primary",
      {
        title: "Delete selected presets",
        disabled: !selected.size,
        onclick: e => {
          e.redraw = false;
          e.target.disabled = true;
          Promise.all(
            Array.from(selected).map(id => store.deleteResource("presets", id))
          )
            .then(res => {
              notifications.push("success", `${res.length} presets deleted`);
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

  if (window.authorizer.hasAccess("presets", 3))
    buttons.push(
      m(
        "button.primary",
        {
          title: "Create new preset",
          onclick: () => {
            let cb = () => {
              return m(
                putForm,
                Object.assign(
                  {
                    actionHandler: (action, object) => {
                      putActoinHandler(action, object, true);
                      overlay.close(cb);
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
    document.title = "Presets - GenieACS";

    function showMore() {
      vnode.state.showCount = (vnode.state.showCount || PAGE_SIZE) + PAGE_SIZE;
      m.redraw();
    }

    function onFilterChanged(filter) {
      m.route.set("/presets", { filter });
    }

    const filter = vnode.attrs.filter
      ? memoizedParse(vnode.attrs.filter)
      : true;

    let presets = store.fetch("presets", filter, {
      limit: vnode.state.showCount || PAGE_SIZE
    });
    let count = store.count("presets", filter);

    let selected = new Set();
    if (vnode.state.selected)
      for (let preset of presets.value)
        if (vnode.state.selected.has(preset["_id"]))
          selected.add(preset["_id"]);
    vnode.state.selected = selected;

    const downloadUrl = getDownloadUrl(vnode.attrs.filter);

    return [
      m("h1", "Listing presets"),
      m(filterComponent, {
        predefined: [
          { parameter: "_id" },
          { parameter: "channel" },
          { parameter: "weight" }
        ],
        filter: vnode.attrs.filter,
        onChange: onFilterChanged
      }),
      renderTable(presets, count.value, selected, showMore, downloadUrl)
    ];
  }
};

export { init, component };
