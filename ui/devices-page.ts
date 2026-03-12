import { ClosureComponent, Children } from "mithril";
import { m } from "./components.ts";
import { pageSize as PAGE_SIZE, index as indexConfig } from "./config.ts";
import indexTableComponent from "./index-table-component.ts";
import filterComponent from "./filter-component.ts";
import * as store from "./store.ts";
import { queueTask, stageDownload } from "./task-queue.ts";
import * as notifications from "./notifications.ts";
import Expression, { extractPaths } from "../lib/common/expression.ts";
import memoize from "../lib/common/memoize.ts";
import * as smartQuery from "./smart-query.ts";

const memoizedGetSortable = memoize((p: Expression) => {
  const expressionParams = extractPaths(p);
  if (expressionParams.length === 1) return expressionParams[0];
  return null;
});

const getDownloadUrl = memoize(
  (
    filter: Expression,
    indexParameters: { label: string; parameter: Expression }[],
  ) => {
    const columns = {};
    for (const p of indexParameters) columns[p.label] = p.parameter.toString();
    return `api/devices.csv?${m.buildQueryString({
      filter: filter.toString(),
      columns: JSON.stringify(columns),
    })}`;
  },
);

const unpackSmartQuery = memoize((query: Expression) => {
  return query.evaluate((e) => {
    if (e instanceof Expression.FunctionCall) {
      if (e.name === "Q") {
        if (
          e.args[0] instanceof Expression.Literal &&
          e.args[1] instanceof Expression.Literal
        ) {
          return smartQuery.unpack(
            "devices",
            e.args[0].value as string,
            e.args[1].value as string,
          );
        }
      }
    }
    return e;
  });
});

export function init(args: Record<string, unknown>): Promise<Attrs> {
  return new Promise((resolve, reject) => {
    if (!window.authorizer.hasAccess("devices", 2))
      return void reject(new Error("You are not authorized to view this page"));

    let filter: Expression = null;
    let sort: Record<string, number> = null;
    if (args.hasOwnProperty("filter"))
      filter = Expression.parse(args["filter"] as string);
    if (args.hasOwnProperty("sort")) sort = JSON.parse(args["sort"] as string);
    const indexParameters = indexConfig;
    if (!indexParameters.length) {
      indexParameters.push({
        label: "ID",
        parameter: Expression.parse("DeviceID.ID"),
        unsortable: false,
        raw: {},
      });
    }
    resolve({ filter, indexParameters, sort });
  });
}

function renderActions(selected: Set<string>): Children {
  const buttons = [];

  buttons.push(
    m(
      "button.px-4 py-2 border border-stone-300 shadow-xs text-sm font-medium rounded-md text-stone-700 bg-white hover:bg-stone-50 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed",
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
      "button.px-4 py-2 border border-stone-300 shadow-xs text-sm font-medium rounded-md text-stone-700 bg-white hover:bg-stone-50 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed",
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
      "button.px-4 py-2 border border-stone-300 shadow-xs text-sm font-medium rounded-md text-stone-700 bg-white hover:bg-stone-50 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed",
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
      "button.px-4 py-2 border border-stone-300 shadow-xs text-sm font-medium rounded-md text-stone-700 bg-white hover:bg-stone-50 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed",
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
      "button.px-4 py-2 border border-stone-300 shadow-xs text-sm font-medium rounded-md text-stone-700 bg-white hover:bg-stone-50 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed",
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
      "button.px-4 py-2 border border-stone-300 shadow-xs text-sm font-medium rounded-md text-stone-700 bg-white hover:bg-stone-50 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed",
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

interface Attrs {
  indexParameters: typeof indexConfig;
  filter?: Expression;
  sort?: Record<string, number>;
}

export const component: ClosureComponent<Attrs> = () => {
  return {
    view: (vnode) => {
      document.title = "Devices - GenieACS";
      const attributes = vnode.attrs.indexParameters;

      function showMore(): void {
        vnode.state["showCount"] =
          (vnode.state["showCount"] || PAGE_SIZE) + PAGE_SIZE;
        m.redraw();
      }

      function onFilterChanged(filter: Expression): void {
        const ops = {};
        if (!(filter instanceof Expression.Literal && filter.value))
          ops["filter"] = filter.toString();
        if (vnode.attrs.sort) ops["sort"] = vnode.attrs.sort;
        m.route.set("/devices", ops);
      }

      const sort = vnode.attrs.sort || {};

      const sortAttributes = {};
      for (let i = 0; i < attributes.length; i++) {
        const attr = attributes[i];
        if (attr.unsortable) continue;
        const param = memoizedGetSortable(attr.parameter);
        if (param) sortAttributes[i] = sort[param.toString()] || 0;
      }

      function onSortChange(sortedAttrs): void {
        const _sort = {};
        for (const index of sortedAttrs) {
          const param = memoizedGetSortable(
            attributes[Math.abs(index) - 1].parameter,
          );
          _sort[param.toString()] = Math.sign(index);
        }
        const ops = { sort: JSON.stringify(_sort) };
        if (vnode.attrs["filter"]) ops["filter"] = vnode.attrs["filter"];
        m.route.set("/devices", ops);
      }

      const filter = unpackSmartQuery(
        vnode.attrs["filter"] ?? new Expression.Literal(true),
      );

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
          attr.raw,
        );
      };

      const attrs = {};
      attrs["attributes"] = attributes.map((a) => ({
        ...a,
        label: a.label,
        type: a.type,
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
          "a.text-cyan-700 hover:text-cyan-900",
          {
            href: `#!/devices/${encodeURIComponent(device["DeviceID.ID"])}`,
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
        m("h1.text-xl font-medium text-stone-900 mb-5", "Listing devices"),
        m(filterComponent, filterAttrs),
        m("loading", { queries: [devs, count] }, m(indexTableComponent, attrs)),
      ];
    },
  };
};
