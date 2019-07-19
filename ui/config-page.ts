/**
 * Copyright 2013-2019  GenieACS Inc.
 *
 * This file is part of GenieACS.
 *
 * GenieACS is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * GenieACS is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with GenieACS.  If not, see <http://www.gnu.org/licenses/>.
 */

import { m } from "./components";
import * as store from "./store";
import * as notifications from "./notifications";
import putFormComponent from "./put-form-component";
import uiConfigComponent from "./ui-config-component";
import * as overlay from "./overlay";
import { parse, stringify } from "../lib/common/expression-parser";
import { loadCodeMirror, loadYaml } from "./dynamic-loader";
import { ClosureComponent, Component, Children } from "mithril";
import { getIcon } from "./icons";

const attributes = [
  { id: "_id", label: "Key" },
  { id: "value", label: "Value", type: "textarea" }
];

interface ValidationErrors {
  [prop: string]: string;
}

function putActionHandler(action, _object, isNew?): Promise<ValidationErrors> {
  return new Promise((resolve, reject) => {
    const object = Object.assign({}, _object);
    if (action === "save") {
      let id = object["_id"] || "";
      delete object["_id"];

      const regex = /^[0-9a-zA-Z_.-]+$/;
      id = id.trim();
      if (!id.match(regex)) return void resolve({ _id: "Invalid ID" });

      try {
        object.value = stringify(parse(object.value || ""));
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
    Promise.all([loadCodeMirror(), loadYaml()])
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
      getIcon("edit")
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
      getIcon("remove")
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

      const confs = store.fetch("config", true);

      let newConfig;
      const subs = [];

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
          "New config"
        );

        const subsData = [
          { name: "overview", prefix: "ui.overview.groups.", data: [] },
          { name: "charts", prefix: "ui.overview.charts.", data: [] },
          { name: "filters", prefix: "ui.filters.", data: [] },
          { name: "index page", prefix: "ui.index.", data: [] },
          { name: "device page", prefix: "ui.device.", data: [] }
        ];

        if (confs.fulfilled) {
          for (const conf of confs.value) {
            for (const sub of subsData) {
              if (conf["_id"].startsWith(sub["prefix"])) {
                sub["data"].push(conf);
                break;
              }
            }
          }
        }

        for (const sub of subsData) {
          const attrs = { prefix: sub.prefix, name: sub.name, data: sub.data };
          subs.push(
            m(
              "button",
              {
                onclick: () => {
                  const cb = (): Children => {
                    return m(
                      uiConfigComponent,
                      Object.assign(
                        {
                          onUpdate: errs => {
                            const errors = errs ? Object.values(errs) : [];
                            if (errors.length) {
                              for (const err of errors)
                                notifications.push("error", err);
                            } else {
                              notifications.push(
                                "success",
                                `${sub.name.replace(
                                  /^[a-z]/,
                                  sub.name[0].toUpperCase()
                                )} config updated`
                              );
                              overlay.close(cb);
                            }
                            store.fulfill(0, Date.now());
                          },
                          onError: err => {
                            notifications.push("error", err.message);
                            store.fulfill(0, Date.now());
                            overlay.close(cb);
                          }
                        },
                        attrs
                      )
                    );
                  };
                  overlay.open(cb);
                }
              },
              `Edit ${sub.name}`
            )
          );
        }
      }

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
          m(".actions-bar", [newConfig].concat(subs))
        )
      ];
    }
  };
};
