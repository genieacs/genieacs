import { ClosureComponent, Component, Children } from "mithril";
import { m } from "./components";
import config from "./config";
import filterComponent from "./filter-component";
import * as overlay from "./overlay";
import * as store from "./store";
import * as notifications from "./notifications";
import putFormComponent from "./put-form-component";
import memoize from "../lib/common/memoize";
import * as smartQuery from "./smart-query";
import { map, parse, stringify } from "../lib/common/expression-parser";

const PAGE_SIZE = config.ui.pageSize || 10;

const memoizedParse = memoize(parse);
const memoizedJsonParse = memoize(JSON.parse);

const attributes = [
  { id: "_id", label: "Name" },
  { id: "channel", label: "Channel" },
  { id: "weight", label: "Weight" },
  { id: "schedule", label: "Schedule" },
  { id: "events", label: "Events", unsortable: true },
  { id: "precondition", label: "Precondition", unsortable: true },
  { id: "provision", label: "Provision", type: "combo", unsortable: true },
  { id: "provisionArgs", label: "Arguments", unsortable: true }
];

const unpackSmartQuery = memoize(query => {
  return map(query, e => {
    if (Array.isArray(e) && e[0] === "FUNC" && e[1] === "Q")
      return smartQuery.unpack("presets", e[2], e[3]);
    return e;
  });
});

interface ValidationErrors {
  [prop: string]: string;
}

function putActionHandler(action, _object, isNew): Promise<ValidationErrors> {
  return new Promise((resolve, reject) => {
    const object = Object.assign({}, _object);
    if (action === "save") {
      const id = object["_id"];
      delete object["_id"];

      const errors = {};

      if (!id) errors["_id"] = "ID can not be empty";
      if (!object.provision) errors["provision"] = "Provision not selected";

      if (Object.keys(errors).length) return void resolve(errors);

      store
        .resourceExists("presets", id)
        .then(exists => {
          if (exists && isNew) {
            store.fulfill(0, Date.now());
            return void resolve({ _id: "Preset already exists" });
          }

          if (!exists && !isNew) {
            store.fulfill(0, Date.now());
            return void resolve({ _id: "Preset does not exist" });
          }

          store
            .putResource("presets", id, object)
            .then(() => {
              notifications.push(
                "success",
                `Preset ${exists ? "updated" : "created"}`
              );
              store.fulfill(0, Date.now());
              resolve();
            })
            .catch(reject);
        })
        .catch(reject);
    } else if (action === "delete") {
      store
        .deleteResource("presets", object["_id"])
        .then(() => {
          notifications.push("success", "Preset deleted");
          store.fulfill(0, Date.now());
          resolve();
        })
        .catch(err => {
          reject(err);
          store.fulfill(0, Date.now());
        });
    } else {
      reject(new Error("Undefined action"));
    }
  });
}

const formData = {
  resource: "presets",
  attributes: attributes
};

const getDownloadUrl = memoize(filter => {
  const cols = {};
  for (const attr of attributes) cols[attr.label] = attr.id;
  return `/api/presets.csv?${m.buildQueryString({
    filter: stringify(filter),
    columns: JSON.stringify(cols)
  })}`;
});

export function init(args): Promise<{}> {
  if (!window.authorizer.hasAccess("presets", 2)) {
    return Promise.reject(
      new Error("You are not authorized to view this page")
    );
  }

  const sort = args.sort;
  const filter = args.filter;
  return Promise.resolve({ filter, sort });
}

function renderTable(
  presetsResponse,
  total,
  selected,
  showMoreCallback,
  downloadUrl,
  sort,
  onSortChange
): Children {
  const presets = presetsResponse.value;
  const selectAll = m("input", {
    type: "checkbox",
    checked: presets.length && selected.size === presets.length,
    onchange: e => {
      for (const preset of presets) {
        if (e.target.checked) selected.add(preset["_id"]);
        else selected.delete(preset["_id"]);
      }
    },
    disabled: !total
  });

  const labels = [m("th", selectAll)];

  for (const attr of attributes) {
    const label = attr.label;

    if (attr.unsortable) {
      labels.push(m("th", label));
      continue;
    }

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
  for (const preset of presets) {
    const checkbox = m("input", {
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
    if (preset["precondition"].length) {
      devicesUrl += `?${m.buildQueryString({
        filter: preset["precondition"]
      })}`;
    }

    const tds = [m("td", checkbox)];
    for (const attr of attributes) {
      if (attr.id === "precondition") {
        tds.push(
          m(
            "td",
            { title: preset[attr.id] },
            m("a", { href: devicesUrl }, preset[attr.id])
          )
        );
      } else {
        tds.push(m("td", preset[attr.id]));
      }
    }

    tds.push(
      m(
        "td.table-row-links",
        m(
          "a",
          {
            onclick: () => {
              const cb = (): Children => {
                return m(
                  putFormComponent,
                  Object.assign(
                    {
                      base: preset,
                      actionHandler: (action, object) => {
                        return new Promise(resolve => {
                          putActionHandler(action, object, false)
                            .then(errors => {
                              const errorList = errors
                                ? Object.values(errors)
                                : [];
                              if (errorList.length) {
                                for (const err of errorList)
                                  notifications.push("error", err);
                              } else {
                                overlay.close(cb);
                              }
                              resolve();
                            })
                            .catch(err => {
                              notifications.push("error", err.message);
                              resolve();
                            });
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

  const footerElements = [];
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
              store.fulfill(0, Date.now());
            });
        }
      },
      "Delete"
    )
  ];

  if (window.authorizer.hasAccess("presets", 3)) {
    buttons.push(
      m(
        "button.primary",
        {
          title: "Create new preset",
          onclick: () => {
            const cb = (): Children => {
              return m(
                putFormComponent,
                Object.assign(
                  {
                    actionHandler: (action, object) => {
                      return new Promise(resolve => {
                        putActionHandler(action, object, true)
                          .then(errors => {
                            const errorList = errors
                              ? Object.values(errors)
                              : [];
                            if (errorList.length) {
                              for (const err of errorList)
                                notifications.push("error", err);
                            } else {
                              overlay.close(cb);
                            }
                            resolve();
                          })
                          .catch(err => {
                            notifications.push("error", err.message);
                            resolve();
                          });
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

export const component: ClosureComponent = (): Component => {
  return {
    view: vnode => {
      document.title = "Presets - GenieACS";

      function showMore(): void {
        vnode.state["showCount"] =
          (vnode.state["showCount"] || PAGE_SIZE) + PAGE_SIZE;
        m.redraw();
      }

      function onFilterChanged(filter): void {
        const ops = { filter };
        if (vnode.attrs["sort"]) ops["sort"] = vnode.attrs["sort"];
        m.route.set(m.route.get(), ops);
      }

      function onSortChange(sort): void {
        const ops = { sort };
        if (vnode.attrs["filter"]) ops["filter"] = vnode.attrs["filter"];
        m.route.set(m.route.get(), ops);
      }

      const sort = vnode.attrs["sort"]
        ? memoizedJsonParse(vnode.attrs["sort"])
        : {};
      let filter = vnode.attrs["filter"]
        ? memoizedParse(vnode.attrs["filter"])
        : true;
      filter = unpackSmartQuery(filter);

      const presets = store.fetch("presets", filter, {
        limit: vnode.state["showCount"] || PAGE_SIZE,
        sort: sort
      });
      const count = store.count("presets", filter);

      const provisions = store.fetch("provisions", true);
      if (provisions.fulfilled) {
        const provisionAttr = attributes.find(attr => {
          return attr.id === "provision";
        });

        const provisionIds = new Set([
          "refresh",
          "value",
          "tag",
          "reboot",
          "reset",
          "download",
          "instances"
        ]);

        for (const p of provisions.value) provisionIds.add(p["_id"]);

        provisionAttr["options"] = Array.from(provisionIds);
      }

      const selected = new Set();
      if (vnode.state["selected"]) {
        for (const preset of presets.value) {
          if (vnode.state["selected"].has(preset["_id"]))
            selected.add(preset["_id"]);
        }
      }
      vnode.state["selected"] = selected;

      const downloadUrl = getDownloadUrl(filter);

      const attrs = {};
      attrs["resource"] = "presets";
      attrs["filter"] = vnode.attrs["filter"];
      attrs["onChange"] = onFilterChanged;

      return [
        m("h1", "Listing presets"),
        m(filterComponent, attrs),
        renderTable(
          presets,
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
};
