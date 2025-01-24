import { ClosureComponent, Component, Children } from "mithril";
import { m } from "./components.ts";
import config from "./config.ts";
import indexTableComponent from "./index-table-component.ts";
import filterComponent from "./filter-component.ts";
import * as store from "./store.ts";
import * as notifications from "./notifications.ts";
import memoize from "../lib/common/memoize.ts";
import * as smartQuery from "./smart-query.ts";
import { map, parse, stringify } from "../lib/common/expression/parser.ts";
import { stringify as yamlStringify } from "../lib/common/yaml.ts";

const PAGE_SIZE = config.ui.pageSize || 10;

const memoizedParse = memoize(parse);
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
    filter: stringify(filter),
    columns: JSON.stringify(cols),
  })}`;
});

const unpackSmartQuery = memoize((query) => {
  return map(query, (e) => {
    if (Array.isArray(e) && e[0] === "FUNC" && e[1] === "Q")
      return smartQuery.unpack("faults", e[2], e[3]);
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

  const sort = args.hasOwnProperty("sort") ? "" + args["sort"] : "";
  const filter = args.hasOwnProperty("filter") ? "" + args["filter"] : "";
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
        const ops = { filter };
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

      let filter = vnode.attrs["filter"]
        ? memoizedParse(vnode.attrs["filter"])
        : true;
      filter = unpackSmartQuery(filter);

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

          return m("a", { href: deviceHref }, fault["device"]);
        }

        if (attr.id === "message")
          return m("long-text", { text: fault["message"] });

        if (attr.id === "detail")
          return m("long-text", { text: yamlStringify(fault["detail"]) });

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
            "button.primary",
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
        m("h1", "Listing faults"),
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
