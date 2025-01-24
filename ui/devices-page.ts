import { ClosureComponent, Component, Children } from "mithril";
import { m } from "./components.ts";
import config from "./config.ts";
import indexTableComponent from "./index-table-component.ts";
import filterComponent from "./filter-component.ts";
import * as store from "./store.ts";
import { queueTask, stageDownload } from "./task-queue.ts";
import * as notifications from "./notifications.ts";
import { parse, stringify, map } from "../lib/common/expression/parser.ts";
import { evaluate, extractParams } from "../lib/common/expression/util.ts";
import memoize from "../lib/common/memoize.ts";
import * as smartQuery from "./smart-query.ts";

const PAGE_SIZE = config.ui.pageSize || 10;

const memoizedParse = memoize(parse);
const memoizedJsonParse = memoize(JSON.parse);
const memoizedGetSortable = memoize((p) => {
  const expressionParams = extractParams(p);
  if (expressionParams.length === 1) {
    const param = evaluate(expressionParams[0]);
    if (typeof param === "string") return param;
  }
  return null;
});

const getDownloadUrl = memoize((filter, indexParameters) => {
  const columns = {};
  for (const p of indexParameters)
    columns[store.evaluateExpression(p.label, null) as string] = stringify(
      p.parameter,
    );
  return `api/devices.csv?${m.buildQueryString({
    filter: stringify(filter),
    columns: JSON.stringify(columns),
  })}`;
});

const unpackSmartQuery = memoize((query) => {
  return map(query, (e) => {
    if (Array.isArray(e) && e[0] === "FUNC" && e[1] === "Q")
      return smartQuery.unpack("devices", e[2], e[3]);
    return e;
  });
});

export function init(
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    if (!window.authorizer.hasAccess("devices", 2))
      return void reject(new Error("You are not authorized to view this page"));

    const filter = args.hasOwnProperty("filter") ? "" + args["filter"] : "";
    const sort = args.hasOwnProperty("sort") ? "" + args["sort"] : "";
    const indexParameters = Object.values(config.ui.index);
    if (!indexParameters.length) {
      indexParameters.push({
        label: "ID",
        parameter: ["PARAM", "DeviceID.ID"],
      });
    }
    resolve({ filter, indexParameters, sort });
  });
}

function renderActions(selected: Set<string>): Children {
  const buttons = [];

  buttons.push(
    m(
      "button.primary",
      {
        title: "Reboot selected devices",
        disabled: !selected.size,
        onclick: () => {
          const tasks = [...selected].map((s) => ({
            name: "reboot",
            device: s,
          }));
          queueTask(...tasks);
        },
      },
      "Reboot",
    ),
  );

  buttons.push(
    m(
      "button.critical",
      {
        title: "Factory reset selected devices",
        disabled: !selected.size,
        onclick: () => {
          const tasks = [...selected].map((s) => ({
            name: "factoryReset",
            device: s,
          }));
          queueTask(...tasks);
        },
      },
      "Reset",
    ),
  );

  buttons.push(
    m(
      "button.critical",
      {
        title: "Push a firmware or a config file",
        disabled: !selected.size,
        onclick: () => {
          stageDownload({
            name: "download",
            devices: [...selected],
          });
        },
      },
      "Push file",
    ),
  );

  buttons.push(
    m(
      "button.primary",
      {
        title: "Delete selected devices",
        disabled: !selected.size,
        onclick: () => {
          const ids = Array.from(selected);
          if (!confirm(`Deleting ${ids.length} devices. Are you sure?`)) return;

          let counter = 1;
          for (const id of ids) {
            ++counter;
            store
              .deleteResource("devices", id)
              .then(() => {
                notifications.push("success", `${id}: Deleted`);
                if (--counter === 0) store.setTimestamp(Date.now());
              })
              .catch((err) => {
                notifications.push("error", `${id}: ${err.message}`);
                if (--counter === 0) store.setTimestamp(Date.now());
              });
          }
          if (--counter === 0) store.setTimestamp(Date.now());
        },
      },
      "Delete",
    ),
  );

  buttons.push(
    m(
      "button.primary",
      {
        title: "Tag selected devices",
        disabled: !selected.size,
        onclick: () => {
          const ids = Array.from(selected);
          const tag = prompt(`Enter tag to assign to ${ids.length} devices:`);
          if (!tag) return;

          let counter = 1;
          for (const id of ids) {
            ++counter;
            store
              .updateTags(id, { [tag]: true })
              .then(() => {
                notifications.push("success", `${id}: Tags updated`);
                if (--counter === 0) store.setTimestamp(Date.now());
              })
              .catch((err) => {
                notifications.push("error", `${id}: ${err.message}`);
                if (--counter === 0) store.setTimestamp(Date.now());
              });
          }
          if (--counter === 0) store.setTimestamp(Date.now());
        },
      },
      "Tag",
    ),
  );

  buttons.push(
    m(
      "button.primary",
      {
        title: "Untag selected devices",
        disabled: !selected.size,
        onclick: () => {
          const ids = Array.from(selected);
          const tag = prompt(
            `Enter tag to unassign from ${ids.length} devices:`,
          );
          if (!tag) return;

          let counter = 1;
          for (const id of ids) {
            ++counter;
            store
              .updateTags(id, { [tag]: false })
              .then(() => {
                notifications.push("success", `${id}: Tags updated`);
                if (--counter === 0) store.setTimestamp(Date.now());
              })
              .catch((err) => {
                notifications.push("error", `${id}: ${err.message}`);
                if (--counter === 0) store.setTimestamp(Date.now());
              });
          }
          if (--counter === 0) store.setTimestamp(Date.now());
        },
      },
      "Untag",
    ),
  );

  return buttons;
}

export const component: ClosureComponent = (): Component => {
  return {
    view: (vnode) => {
      document.title = "Devices - GenieACS";
      const attributes = vnode.attrs["indexParameters"];

      function showMore(): void {
        vnode.state["showCount"] =
          (vnode.state["showCount"] || PAGE_SIZE) + PAGE_SIZE;
        m.redraw();
      }

      function onFilterChanged(filter): void {
        const ops = { filter };
        if (vnode.attrs["sort"]) ops["sort"] = vnode.attrs["sort"];
        m.route.set("/devices", ops);
      }

      const sort = vnode.attrs["sort"]
        ? memoizedJsonParse(vnode.attrs["sort"])
        : {};

      const sortAttributes = {};
      for (let i = 0; i < attributes.length; i++) {
        const attr = attributes[i];
        if (attr.unsortable) continue;
        const param = memoizedGetSortable(attr.parameter);
        if (param) sortAttributes[i] = sort[param] || 0;
      }

      function onSortChange(sortedAttrs): void {
        const _sort = {};
        for (const index of sortedAttrs) {
          const param = memoizedGetSortable(
            attributes[Math.abs(index) - 1].parameter,
          );
          _sort[param] = Math.sign(index);
        }
        const ops = { sort: JSON.stringify(_sort) };
        if (vnode.attrs["filter"]) ops["filter"] = vnode.attrs["filter"];
        m.route.set("/devices", ops);
      }

      let filter = vnode.attrs["filter"]
        ? memoizedParse(vnode.attrs["filter"])
        : true;
      filter = unpackSmartQuery(filter);

      const devs = store.fetch("devices", filter, {
        limit: vnode.state["showCount"] || PAGE_SIZE,
        sort: sort,
      });
      const count = store.count("devices", filter);

      const downloadUrl = getDownloadUrl(filter, attributes);

      const valueCallback = (attr, device): Children => {
        return m.context(
          { device: device, parameter: attr.parameter },
          attr.type || "parameter",
          attr,
        );
      };

      const attrs = {};
      attrs["attributes"] = attributes.map((a) => ({
        ...a,
        label: store.evaluateExpression(a.label, null),
        type: store.evaluateExpression(a.type, null),
      }));
      attrs["data"] = devs.value;
      attrs["total"] = count.value;
      attrs["showMoreCallback"] = showMore;
      attrs["sortAttributes"] = sortAttributes;
      attrs["onSortChange"] = onSortChange;
      attrs["downloadUrl"] = downloadUrl;
      attrs["valueCallback"] = valueCallback;
      attrs["recordActionsCallback"] = (device): Children => {
        return m(
          "a",
          {
            href: `#!/devices/${encodeURIComponent(
              device["DeviceID.ID"].value[0],
            )}`,
          },
          "Show",
        );
      };

      if (window.authorizer.hasAccess("devices", 3))
        attrs["actionsCallback"] = renderActions;

      const filterAttrs = {
        resource: "devices",
        filter: vnode.attrs["filter"],
        onChange: onFilterChanged,
      };

      return [
        m("h1", "Listing devices"),
        m(filterComponent, filterAttrs),
        m("loading", { queries: [devs, count] }, m(indexTableComponent, attrs)),
      ];
    },
  };
};
