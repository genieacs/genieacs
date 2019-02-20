import { ClosureComponent, Component, Children } from "mithril";
import { m } from "./components";
import config from "./config";
import filterComponent from "./filter-component";
import * as store from "./store";
import * as notifications from "./notifications";
import memoize from "../lib/common/memoize";
import putFormComponent from "./put-form-component";
import * as overlay from "./overlay";
import * as smartQuery from "./smart-query";
import { map, parse } from "../lib/common/expression-parser";
import { loadCodeMirror } from "./dynamic-loader";

const PAGE_SIZE = config.ui.pageSize || 10;

const memoizedParse = memoize(parse);
const memoizedJsonParse = memoize(JSON.parse);

const attributes = [
  { id: "_id", label: "Name" },
  { id: "script", label: "Script", type: "code" }
];

const unpackSmartQuery = memoize(query => {
  return map(query, e => {
    if (Array.isArray(e) && e[0] === "FUNC" && e[1] === "Q")
      return smartQuery.unpack("virtualParameters", e[2], e[3]);
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

      if (!id) return void resolve({ _id: "ID can not be empty" });

      store
        .resourceExists("virtualParameters", id)
        .then(exists => {
          if (exists && isNew) {
            store.fulfill(0, Date.now());
            return void resolve({ _id: "Virtual parameter already exists" });
          }

          if (!exists && !isNew) {
            store.fulfill(0, Date.now());
            return void resolve({ _id: "Virtual parameter does not exist" });
          }

          store
            .putResource("virtualParameters", id, object)
            .then(() => {
              notifications.push(
                "success",
                `Virtual parameter ${exists ? "updated" : "created"}`
              );
              store.fulfill(0, Date.now());
              resolve();
            })
            .catch(reject);
        })
        .catch(reject);
    } else if (action === "delete") {
      store
        .deleteResource("virtualParameters", object["_id"])
        .then(() => {
          notifications.push("success", "Virtual parameter deleted");
          store.fulfill(0, Date.now());
          resolve();
        })
        .catch(err => {
          store.fulfill(0, Date.now());
          reject(err);
        });
    } else {
      reject(new Error("Undefined action"));
    }
  });
}

const formData = {
  resource: "virtualParameters",
  attributes: attributes
};

const getDownloadUrl = memoize(filter => {
  const cols = {};
  for (const attr of attributes) cols[attr.label] = attr.id;
  return `/api/virtualParameters.csv?${m.buildQueryString({
    filter: filter,
    columns: JSON.stringify(cols)
  })}`;
});

export function init(args): Promise<{}> {
  if (!window.authorizer.hasAccess("virtualParameters", 2)) {
    return Promise.reject(
      new Error("You are not authorized to view this page")
    );
  }

  const sort = args.sort;
  const filter = args.filter;

  return new Promise((resolve, reject) => {
    loadCodeMirror()
      .then(() => {
        resolve({ filter, sort });
      })
      .catch(reject);
  });
}

function renderTable(
  virtualParametersResponse,
  total,
  selected,
  showMoreCallback,
  downloadUrl,
  sort,
  onSortChange
): Children {
  const virtualParameters = virtualParametersResponse.value;
  const selectAll = m("input", {
    type: "checkbox",
    checked:
      virtualParameters.length && selected.size === virtualParameters.length,
    onchange: e => {
      for (const virtualParameter of virtualParameters) {
        if (e.target.checked) selected.add(virtualParameter["_id"]);
        else selected.delete(virtualParameter["_id"]);
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
  for (const virtualParameter of virtualParameters) {
    const checkbox = m("input", {
      type: "checkbox",
      checked: selected.has(virtualParameter["_id"]),
      onchange: e => {
        if (e.target.checked) selected.add(virtualParameter["_id"]);
        else selected.delete(virtualParameter["_id"]);
      },
      onclick: e => {
        e.stopPropagation();
        e.redraw = false;
      }
    });

    const tds = [m("td", checkbox)];
    for (const attr of attributes) {
      if (attr.id === "script") {
        const firstLines = virtualParameter[attr.id].split("\n", 11);
        if (firstLines.length > 10) firstLines[10] = ["\ufe19"];
        tds.push(
          m("td", { title: firstLines.join("\n") }, firstLines[0] || "")
        );
      } else {
        tds.push(m("td", virtualParameter[attr.id]));
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
                      base: virtualParameter,
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

            if (!selected.delete(virtualParameter["_id"]))
              selected.add(virtualParameter["_id"]);
          }
        },
        tds
      )
    );
  }

  if (!rows.length) {
    rows.push(
      m(
        "tr.empty",
        m("td", { colspan: labels.length }, "No virtual parameters")
      )
    );
  }

  const footerElements = [];
  if (total != null)
    footerElements.push(`${virtualParameters.length}/${total}`);
  else footerElements.push(`${virtualParameters.length}`);

  footerElements.push(
    m(
      "button",
      {
        title: "Show more virtual parameters",
        onclick: showMoreCallback,
        disabled:
          virtualParameters.length >= total ||
          !virtualParametersResponse.fulfilled
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
        title: "Delete selected virtual parameters",
        disabled: !selected.size,
        onclick: e => {
          e.redraw = false;
          e.target.disabled = true;
          Promise.all(
            Array.from(selected).map(id =>
              store.deleteResource("virtualParameters", id)
            )
          )
            .then(res => {
              notifications.push(
                "success",
                `${res.length} virtual parameters deleted`
              );
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

  if (window.authorizer.hasAccess("virtualParameters", 3)) {
    buttons.push(
      m(
        "button.primary",
        {
          title: "Create new virtual parameter",
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
      document.title = "Virtual Parameters - GenieACS";

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

      const virtualParameters = store.fetch("virtualParameters", filter, {
        limit: vnode.state["showCount"] || PAGE_SIZE,
        sort: sort
      });

      const count = store.count("virtualParameters", filter);

      const selected = new Set();
      if (vnode.state["selected"]) {
        for (const virtualParameter of virtualParameters.value) {
          if (vnode.state["selected"].has(virtualParameter["_id"]))
            selected.add(virtualParameter["_id"]);
        }
      }
      vnode.state["selected"] = selected;

      const downloadUrl = getDownloadUrl(vnode.attrs["filter"]);

      const attrs = {};
      attrs["resource"] = "virtualParameters";
      attrs["filter"] = vnode.attrs["filter"];
      attrs["onChange"] = onFilterChanged;

      return [
        m("h1", "Listing virtual parameters"),
        m(filterComponent, attrs),
        renderTable(
          virtualParameters,
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
