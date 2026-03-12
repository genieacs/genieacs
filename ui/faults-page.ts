import { ClosureComponent, Component, Children } from "mithril";
import { m } from "./components.ts";
import { pageSize as PAGE_SIZE } from "./config.ts";
import indexTableComponent from "./index-table-component.ts";
import filterComponent from "./filter-component.ts";
import * as store from "./store.ts";
import * as notifications from "./notifications.ts";
import memoize from "../lib/common/memoize.ts";
import * as smartQuery from "./smart-query.ts";
import { stringify as yamlStringify } from "../lib/common/yaml.ts";
import Expression from "../lib/common/expression.ts";

const memoizedJsonParse = memoize(JSON.parse);

const attributes = [
  { id: "device", label: "Device" },
  { id: "channel", label: "Channel" },
  { id: "code", label: "Code" },
  { id: "message", label: "Message" },
  { id: "detail", label: "Detail" },
  { id: "retries", label: "Retries" },
  { id: "timestamp", label: "Timestamp" },
];

const getDownloadUrl = memoize((filter) => {
  const cols = {};
  for (const attr of attributes) {
    cols[attr.label] =
      attr.id === "timestamp" ? `DATE_STRING(${attr.id})` : attr.id;
  }

  return `api/faults.csv?${m.buildQueryString({
    filter: filter.toString(),
    columns: JSON.stringify(cols),
  })}`;
});

const unpackSmartQuery = memoize((query: Expression) => {
  return query.evaluate((e) => {
    if (e instanceof Expression.FunctionCall) {
      if (e.name === "Q") {
        if (
          e.args[0] instanceof Expression.Literal &&
          e.args[1] instanceof Expression.Literal
        ) {
          return smartQuery.unpack(
            "faults",
            e.args[0].value as string,
            e.args[1].value as string,
          );
        }
      }
    }
    return e;
  });
});

async function deleteFaults(faults: Iterable<string>): Promise<void> {
  const proms: Map<string, Promise<void>> = new Map();
  for (const f of faults) {
    const deviceId = f.split(":", 1)[0];
    let p = proms.get(deviceId);
    if (p == null) p = store.deleteResource("faults", f);
    else p = p.then(() => store.deleteResource("faults", f));
    proms.set(deviceId, p);
  }
  await Promise.all(proms.values());
}

export function init(
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!window.authorizer.hasAccess("faults", 2)) {
    return Promise.reject(
      new Error("You are not authorized to view this page"),
    );
  }
  let filter: Expression = null;
  let sort: Record<string, number> = null;
  if (args.hasOwnProperty("filter"))
    filter = Expression.parse(args["filter"] as string);
  if (args.hasOwnProperty("sort")) sort = JSON.parse(args["sort"] as string);
  return Promise.resolve({ filter, sort });
}

export const component: ClosureComponent = (): Component => {
  return {
    view: (vnode) => {
      document.title = "Faults - GenieACS";

      function showMore(): void {
        vnode.state["showCount"] =
          (vnode.state["showCount"] || PAGE_SIZE) + PAGE_SIZE;
        m.redraw();
      }

      function onFilterChanged(filter): void {
        const ops = {};
        if (!(filter instanceof Expression.Literal && filter.value))
          ops["filter"] = filter.toString();
        if (vnode.attrs["sort"]) ops["sort"] = vnode.attrs["sort"];
        m.route.set("/faults", ops);
      }

      const sort = vnode.attrs["sort"]
        ? memoizedJsonParse(vnode.attrs["sort"])
        : {};

      const sortAttributes = {};
      for (let i = 0; i < attributes.length; i++) {
        const attr = attributes[i];
        if (attr.id !== "detail") sortAttributes[i] = sort[attr.id] || 0;
      }

      function onSortChange(sortAttrs): void {
        const _sort = {};
        for (const index of sortAttrs)
          _sort[attributes[Math.abs(index) - 1].id] = Math.sign(index);
        const ops = { sort: JSON.stringify(_sort) };
        if (vnode.attrs["filter"]) ops["filter"] = vnode.attrs["filter"];
        m.route.set("/faults", ops);
      }

      const filter = unpackSmartQuery(
        vnode.attrs["filter"] ?? new Expression.Literal(true),
      );

      const faults = store.fetch("faults", filter, {
        limit: vnode.state["showCount"] || PAGE_SIZE,
        sort: sort,
      });
      const count = store.count("faults", filter);

      const downloadUrl = getDownloadUrl(filter);

      const valueCallback = (attr, fault): Children => {
        if (attr.id === "device") {
          const deviceHref = `#!/devices/${encodeURIComponent(
            fault["device"],
          )}`;

          return m(
            "a.text-cyan-700 hover:text-cyan-900 font-medium",
            { href: deviceHref },
            fault["device"],
          );
        }

        if (attr.id === "message")
          return m("long-text", { text: fault["message"], class: "max-w-xs" });

        if (attr.id === "detail") {
          return m("long-text", {
            text: yamlStringify(fault["detail"]),
            class: "max-w-xs",
          });
        }

        if (attr.id === "timestamp")
          return new Date(fault["timestamp"]).toLocaleString();

        return fault[attr.id];
      };

      const attrs = {};
      attrs["attributes"] = attributes;
      attrs["data"] = faults.value;
      attrs["valueCallback"] = valueCallback;
      attrs["total"] = count.value;
      attrs["showMoreCallback"] = showMore;
      attrs["sortAttributes"] = sortAttributes;
      attrs["onSortChange"] = onSortChange;
      attrs["downloadUrl"] = downloadUrl;

      if (window.authorizer.hasAccess("faults", 3)) {
        attrs["actionsCallback"] = (selected: Set<string>): Children => {
          return m(
            "button.px-4 py-2 border border-stone-300 shadow-xs text-sm font-medium rounded-md text-stone-700 bg-white hover:bg-stone-50 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed",
            {
              disabled: selected.size === 0,
              title: "Delete selected faults",
              onclick: (e) => {
                e.redraw = false;
                e.target.disabled = true;

                if (!confirm(`Deleting ${selected.size} faults. Are you sure?`))
                  return;

                const c = selected.size;
                deleteFaults(selected)
                  .then(() => {
                    notifications.push("success", `${c} faults deleted`);
                    store.setTimestamp(Date.now());
                  })
                  .catch((err) => {
                    notifications.push("error", err.message);
                    store.setTimestamp(Date.now());
                  });
              },
            },
            "Delete",
          );
        };
      }

      const filterAttrs = {
        resource: "faults",
        filter: vnode.attrs["filter"],
        onChange: onFilterChanged,
      };

      return [
        m("h1.text-xl font-medium text-stone-900 mb-5", "Listing faults"),
        m(filterComponent, filterAttrs),
        m(
          "loading",
          { queries: [faults, count] },
          m(indexTableComponent, attrs),
        ),
      ];
    },
  };
};
