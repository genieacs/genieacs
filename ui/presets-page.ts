import { ClosureComponent, Component, Children, Vnode } from "mithril";
import { m } from "./components.ts";
import config from "./config.ts";
import filterComponent from "./filter-component.ts";
import * as overlay from "./overlay.ts";
import * as store from "./store.ts";
import * as notifications from "./notifications.ts";
import putFormComponent from "./put-form-component.ts";
import indexTableComponent from "./index-table-component.ts";
import memoize from "../lib/common/memoize.ts";
import * as smartQuery from "./smart-query.ts";
import { map, parse, stringify } from "../lib/common/expression/parser.ts";

const PAGE_SIZE = config.ui.pageSize || 10;

const memoizedParse = memoize(parse);
const memoizedJsonParse = memoize(JSON.parse);

const attributes = [
  { id: "_id", label: "Name" },
  { id: "channel", label: "Channel" },
  { id: "weight", label: "Weight" },
  { id: "schedule", label: "Schedule" },
  { id: "events", label: "Events" },
  { id: "precondition", label: "Precondition", type: "textarea" },
  { id: "provision", label: "Provision", type: "combo" },
  { id: "provisionArgs", label: "Arguments", type: "textarea" },
];

const unpackSmartQuery = memoize((query) => {
  return map(query, (e) => {
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

      if (object.precondition) {
        try {
          object.precondition = stringify(memoizedParse(object.precondition));
        } catch (err) {
          return void resolve({
            precondition: "Precondition must be valid expression",
          });
        }
      }

      store
        .resourceExists("presets", id)
        .then((exists) => {
          if (exists && isNew) {
            store.setTimestamp(Date.now());
            return void resolve({ _id: "Preset already exists" });
          }

          if (!exists && !isNew) {
            store.setTimestamp(Date.now());
            return void resolve({ _id: "Preset does not exist" });
          }

          store
            .putResource("presets", id, object)
            .then(() => {
              notifications.push(
                "success",
                `Preset ${exists ? "updated" : "created"}`,
              );
              store.setTimestamp(Date.now());
              resolve(null);
            })
            .catch(reject);
        })
        .catch(reject);
    } else if (action === "delete") {
      store
        .deleteResource("presets", object["_id"])
        .then(() => {
          notifications.push("success", "Preset deleted");
          store.setTimestamp(Date.now());
          resolve(null);
        })
        .catch((err) => {
          reject(err);
          store.setTimestamp(Date.now());
        });
    } else {
      reject(new Error("Undefined action"));
    }
  });
}

const formData = {
  resource: "presets",
  attributes: attributes,
};

const getDownloadUrl = memoize((filter) => {
  const cols = {};
  for (const attr of attributes) cols[attr.label] = attr.id;
  return `api/presets.csv?${m.buildQueryString({
    filter: stringify(filter),
    columns: JSON.stringify(cols),
  })}`;
});

export function init(
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!window.authorizer.hasAccess("presets", 2)) {
    return Promise.reject(
      new Error("You are not authorized to view this page"),
    );
  }

  const sort = args.hasOwnProperty("sort") ? "" + args["sort"] : "";
  const filter = args.hasOwnProperty("filter") ? "" + args["filter"] : "";
  return Promise.resolve({ filter, sort });
}

export const component: ClosureComponent = (): Component => {
  return {
    view: (vnode) => {
      document.title = "Presets - GenieACS";

      function showMore(): void {
        vnode.state["showCount"] =
          (vnode.state["showCount"] || PAGE_SIZE) + PAGE_SIZE;
        m.redraw();
      }

      function onFilterChanged(filter): void {
        const ops = { filter };
        if (vnode.attrs["sort"]) ops["sort"] = vnode.attrs["sort"];
        m.route.set("/admin/presets", ops);
      }

      const sort = vnode.attrs["sort"]
        ? memoizedJsonParse(vnode.attrs["sort"])
        : {};

      const sortAttributes = {};
      for (let i = 0; i < attributes.length; i++) {
        const attr = attributes[i];
        if (
          !(
            attr.id === "events" ||
            attr.id === "precondition" ||
            attr.id === "provision" ||
            attr.id === "provisionArgs"
          )
        )
          sortAttributes[i] = sort[attr.id] || 0;
      }

      function onSortChange(sortAttrs): void {
        const _sort = {};
        for (const index of sortAttrs)
          _sort[attributes[Math.abs(index) - 1].id] = Math.sign(index);
        const ops = { sort: JSON.stringify(_sort) };
        if (vnode.attrs["filter"]) ops["filter"] = vnode.attrs["filter"];
        m.route.set("/admin/presets", ops);
      }

      let filter = vnode.attrs["filter"]
        ? memoizedParse(vnode.attrs["filter"])
        : true;
      filter = unpackSmartQuery(filter);

      const presets = store.fetch("presets", filter, {
        limit: vnode.state["showCount"] || PAGE_SIZE,
        sort: sort,
      });
      const count = store.count("presets", filter);

      const userDefinedProvisions: Set<string> = new Set();

      const provisionIds = new Set([
        "refresh",
        "value",
        "tag",
        "reboot",
        "reset",
        "download",
        "instances",
      ]);

      const provisions = store.fetch("provisions", true);
      if (provisions.fulfilled) {
        for (const p of provisions.value) {
          userDefinedProvisions.add(p["_id"]);
          provisionIds.add(p["_id"]);
        }
      }

      const provisionAttr = attributes.find((attr) => {
        return attr.id === "provision";
      });
      provisionAttr["options"] = Array.from(provisionIds);

      const downloadUrl = getDownloadUrl(filter);

      const valueCallback = (attr, preset): Vnode => {
        if (attr.id === "precondition") {
          let devicesUrl = "#!/devices";
          if (preset["precondition"].length) {
            devicesUrl += `?${m.buildQueryString({
              filter: preset["precondition"],
            })}`;
          }

          return m(
            "a",
            { href: devicesUrl, title: preset["precondition"] },
            preset["precondition"],
          );
        } else if (
          attr.id === "provision" &&
          userDefinedProvisions.has(preset[attr.id])
        ) {
          return m(
            "a",
            {
              href: `#!/admin/provisions?${m.buildQueryString({
                filter: `Q("ID", "${preset["provision"]}")`,
              })}`,
            },
            preset["provision"],
          );
        } else {
          return preset[attr.id];
        }
      };

      const attrs = {};
      attrs["attributes"] = attributes;
      attrs["data"] = presets.value;
      attrs["total"] = count.value;
      attrs["showMoreCallback"] = showMore;
      attrs["sortAttributes"] = sortAttributes;
      attrs["onSortChange"] = onSortChange;
      attrs["downloadUrl"] = downloadUrl;
      attrs["valueCallback"] = valueCallback;
      attrs["recordActionsCallback"] = (preset) => {
        return [
          m(
            "a",
            {
              onclick: () => {
                let cb: () => Children = null;
                const comp = m(
                  putFormComponent,
                  Object.assign(
                    {
                      base: preset,
                      actionHandler: (action, object) => {
                        return new Promise<void>((resolve) => {
                          putActionHandler(action, object, false)
                            .then((errors) => {
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
                            .catch((err) => {
                              notifications.push("error", err.message);
                              resolve();
                            });
                        });
                      },
                    },
                    formData,
                  ),
                );
                cb = (): Children => {
                  if (!preset.provision) {
                    return m(
                      "div",
                      { style: "margin:20px" },
                      "This UI only supports presets with a single 'provision' configuration. If this preset was originally created from the old UI (genieacs-gui), you must edit it there.",
                    );
                  }
                  return comp;
                };
                overlay.open(
                  cb,
                  () =>
                    !comp.state?.["current"]["modified"] ||
                    confirm("You have unsaved changes. Close anyway?"),
                );
              },
            },
            "Show",
          ),
        ];
      };

      if (window.authorizer.hasAccess("presets", 3)) {
        attrs["actionsCallback"] = (selected: Set<string>): Children => {
          return [
            m(
              "button.primary",
              {
                title: "Create new preset",
                onclick: () => {
                  let cb: () => Children = null;
                  const comp = m(
                    putFormComponent,
                    Object.assign(
                      {
                        actionHandler: (action, object) => {
                          return new Promise<void>((resolve) => {
                            putActionHandler(action, object, true)
                              .then((errors) => {
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
                              .catch((err) => {
                                notifications.push("error", err.message);
                                resolve();
                              });
                          });
                        },
                      },
                      formData,
                    ),
                  );
                  cb = () => comp;
                  overlay.open(
                    cb,
                    () =>
                      !comp.state["current"]["modified"] ||
                      confirm("You have unsaved changes. Close anyway?"),
                  );
                },
              },
              "New",
            ),
            m(
              "button.primary",
              {
                title: "Delete selected presets",
                disabled: !selected.size,
                onclick: (e) => {
                  if (
                    !confirm(`Deleting ${selected.size} presets. Are you sure?`)
                  )
                    return;

                  e.redraw = false;
                  e.target.disabled = true;
                  Promise.all(
                    Array.from(selected).map((id) =>
                      store.deleteResource("presets", id),
                    ),
                  )
                    .then((res) => {
                      notifications.push(
                        "success",
                        `${res.length} presets deleted`,
                      );
                      store.setTimestamp(Date.now());
                    })
                    .catch((err) => {
                      notifications.push("error", err.message);
                      store.setTimestamp(Date.now());
                    });
                },
              },
              "Delete",
            ),
          ];
        };
      }

      const filterAttrs = {
        resource: "presets",
        filter: vnode.attrs["filter"],
        onChange: onFilterChanged,
      };

      return [
        m("h1", "Listing presets"),
        m(filterComponent, filterAttrs),
        m(
          "loading",
          { queries: [presets, count] },
          m(indexTableComponent, attrs),
        ),
      ];
    },
  };
};
