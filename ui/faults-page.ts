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

import { ClosureComponent, Component, Children } from "mithril";
import { m } from "./components";
import config from "./config";
import indexTableComponent from "./index-table-component";
import filterComponent from "./filter-component";
import * as store from "./store";
import * as notifications from "./notifications";
import memoize from "../lib/common/memoize";
import * as smartQuery from "./smart-query";
import { map, parse, stringify } from "../lib/common/expression-parser";
import { loadYaml, yaml } from "./dynamic-loader";

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
  { id: "timestamp", label: "Timestamp" }
];

const getDownloadUrl = memoize(filter => {
  const cols = {};
  for (const attr of attributes) {
    cols[attr.label] =
      attr.id === "timestamp" ? `DATE_STRING(${attr.id})` : attr.id;
  }

  return `/api/faults.csv?${m.buildQueryString({
    filter: stringify(filter),
    columns: JSON.stringify(cols)
  })}`;
});

const unpackSmartQuery = memoize(query => {
  return map(query, e => {
    if (Array.isArray(e) && e[0] === "FUNC" && e[1] === "Q")
      return smartQuery.unpack("faults", e[2], e[3]);
    return e;
  });
});

export function init(args): Promise<{}> {
  if (!window.authorizer.hasAccess("faults", 2)) {
    return Promise.reject(
      new Error("You are not authorized to view this page")
    );
  }

  const sort = args.hasOwnProperty("sort") ? "" + args["sort"] : "";
  const filter = args.hasOwnProperty("filter") ? "" + args["filter"] : "";
  return new Promise((resolve, reject) => {
    loadYaml()
      .then(() => {
        resolve({ filter, sort });
      })
      .catch(reject);
  });
}

export const component: ClosureComponent = (): Component => {
  return {
    view: vnode => {
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
        const _sort = Object.assign({}, sort);
        for (const [index, direction] of Object.entries(sortAttrs)) {
          // Changing the priority of columns
          delete _sort[attributes[index].id];
          _sort[attributes[index].id] = direction;
        }

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
        sort: sort
      });
      const count = store.count("faults", filter);

      const downloadUrl = getDownloadUrl(filter);

      const valueCallback = (attr, fault): Children => {
        if (attr.id === "device") {
          const deviceHref = `#!/devices/${encodeURIComponent(
            fault["device"]
          )}`;

          return m("a", { href: deviceHref }, fault["device"]);
        }

        if (attr.id === "detail")
          return m("long-text", { text: yaml.stringify(fault["detail"]) });

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
        attrs["actionsCallback"] = (selected): Children => {
          return m(
            "button.primary",
            {
              disabled: selected.size === 0,
              title: "Delete selected faults",
              onclick: e => {
                e.redraw = false;
                e.target.disabled = true;

                if (!confirm(`Deleting ${selected.size} faults. Are you sure?`))
                  return;

                Promise.all(
                  Array.from(selected).map(id =>
                    store.deleteResource("faults", id)
                  )
                )
                  .then(res => {
                    notifications.push(
                      "success",
                      `${res.length} faults deleted`
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
          );
        };
      }

      const filterAttrs = {};
      filterAttrs["resource"] = "faults";
      filterAttrs["filter"] = vnode.attrs["filter"];
      filterAttrs["onChange"] = onFilterChanged;

      return [
        m("h1", "Listing faults"),
        m(filterComponent, filterAttrs),
        m(indexTableComponent, attrs)
      ];
    }
  };
};
