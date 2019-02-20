import { m } from "./components";
import * as store from "./store";
import * as notifications from "./notifications";
import putFormComponent from "./put-form-component";
import * as overlay from "./overlay";
import * as expressionParser from "../lib/common/expression-parser";
import { loadCodeMirror } from "./dynamic-loader";
import { ClosureComponent, Component, Children } from "mithril";

const attributes = [
  { id: "_id", label: "Key" },
  { id: "value", label: "Value" }
];

interface ValidationErrors {
  [prop: string]: string;
}

function putActionHandler(action, _object, isNew?): Promise<ValidationErrors> {
  return new Promise((resolve, reject) => {
    const object = Object.assign({}, _object);
    if (action === "save") {
      const id = object["_id"];
      delete object["_id"];

      if (!id) return void resolve({ _id: "ID can not be empty" });
      try {
        expressionParser.parse(object.value);
      } catch (err) {
        return void resolve({
          value: "Config value must be valid expression"
        });
      }

      store
        .resourceExists("config", id)
        .then(exists => {
          if (exists && isNew) {
            store.fulfill(0, Date.now());
            return void resolve({ _id: "Config already exists" });
          }

          if (!exists && !isNew) {
            store.fulfill(0, Date.now());
            return void resolve({ _id: "Config does not exist" });
          }

          store
            .putResource("config", id, object)
            .then(() => {
              notifications.push(
                "success",
                `Config ${exists ? "updated" : "created"}`
              );
              store.fulfill(0, Date.now());
              resolve();
            })
            .catch(reject);
        })
        .catch(reject);
    } else if (action === "delete") {
      store
        .deleteResource("config", object["_id"])
        .then(() => {
          notifications.push("success", "Config deleted");
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
  resource: "config",
  attributes: attributes
};

function escapeRegExp(str): string {
  return str.replace(/[-[\]/{}()*+?.\\^$|]/g, "\\$&");
}

export function init(): Promise<{}> {
  if (!window.authorizer.hasAccess("config", 2)) {
    return Promise.reject(
      new Error("You are not authorized to view this page")
    );
  }
  return new Promise((resolve, reject) => {
    loadCodeMirror()
      .then(() => {
        resolve({});
      })
      .catch(reject);
  });
}

function renderTable(confsResponse, searchString): Children {
  const confs = confsResponse.value.sort((a, b) => {
    return a._id < b._id ? -1 : 1;
  });

  let regex;
  if (searchString) {
    const keywords = searchString.split(" ").filter(s => s);
    if (keywords.length)
      regex = new RegExp(keywords.map(s => escapeRegExp(s)).join(".*"), "i");
  }

  const rows = [];
  for (const conf of confs) {
    const attrs = {};
    if (regex && !regex.test(conf._id) && !regex.test(conf.value))
      attrs["style"] = "display: none;";

    const edit = m(
      "button",
      {
        title: "Edit config value",
        onclick: () => {
          const cb = (): Children => {
            return m(
              putFormComponent,
              Object.assign(
                {
                  base: conf,
                  actionHandler: (action, object) => {
                    return new Promise(resolve => {
                      putActionHandler(action, object, false)
                        .then(errors => {
                          const ErrorList = errors ? Object.values(errors) : [];
                          if (ErrorList.length) {
                            for (const err of ErrorList)
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
      "✎"
    );

    const del = m(
      "button",
      {
        title: "Delete config",
        onclick: () => {
          if (!confirm(`Deleting ${conf._id} config. Are you sure?`)) return;

          putActionHandler("delete", conf).catch(err => {
            throw err;
          });
        }
      },
      "✕"
    );

    rows.push(
      m(
        "tr",
        attrs,
        m("td.left", m("long-text", { text: conf._id })),
        m(
          "td.right",
          m("span", [m("long-text", { text: `${conf.value}` }), edit, del])
        )
      )
    );
  }

  if (!rows.length)
    rows.push(m("tr.empty", m("td", { colspan: 2 }, "No config")));

  return m("table", m("tbody", rows));
}

export const component: ClosureComponent = (): Component => {
  return {
    view: vnode => {
      document.title = "Config - GenieACS";

      const search = m("input", {
        type: "text",
        placeholder: "Search config",
        oninput: e => {
          vnode.state["searchString"] = e.target.value;
          e.redraw = false;
          clearTimeout(vnode.state["timeout"]);
          vnode.state["timeout"] = setTimeout(m.redraw, 250);
        }
      });

      let newConfig;
      if (window.authorizer.hasAccess("config", 3)) {
        newConfig = m(
          "button.primary",
          {
            title: "Create new config",
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
        );
      }

      const confs = store.fetch("config", true);

      return [
        m("h1", "Listing config"),
        m(
          ".all-parameters",
          search,
          m(
            ".parameter-list",
            { style: "height: 400px" },
            renderTable(confs, vnode.state["searchString"])
          ),
          m(".actions-bar", newConfig)
        )
      ];
    }
  };
};
