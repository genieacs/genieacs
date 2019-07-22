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
import * as taskQueue from "./task-queue";
import * as notifications from "./notifications";
import { parse, stringify } from "../lib/common/expression-parser";
import { evaluate, extractParams } from "../lib/common/expression";
import memoize from "../lib/common/memoize";
import * as smartQuery from "./smart-query";
import * as expressionParser from "../lib/common/expression-parser";

const PAGE_SIZE = config.ui.pageSize || 10;

const memoizedParse = memoize(parse);
const memoizedJsonParse = memoize(JSON.parse);
const memoizedGetSortable = memoize(p => {
  const expressionParams = extractParams(p);
  if (expressionParams.length === 1) {
    const param = evaluate(expressionParams[0]);
    if (typeof param === "string") return param;
  }
  return null;
});

const getDownloadUrl = memoize((filter, indexParameters) => {
  const columns = {};
  for (const p of indexParameters) columns[p.label] = stringify(p.parameter);
  return `/api/devices.csv?${m.buildQueryString({
    filter: stringify(filter),
    columns: JSON.stringify(columns)
  })}`;
});

const unpackSmartQuery = memoize(query => {
  return expressionParser.map(query, e => {
    if (Array.isArray(e) && e[0] === "FUNC" && e[1] === "Q")
      return smartQuery.unpack("devices", e[2], e[3]);
    return e;
  });
});

export function init(args): Promise<{}> {
  return new Promise((resolve, reject) => {
    if (!window.authorizer.hasAccess("devices", 2))
      return void reject(new Error("You are not authorized to view this page"));

    const filter = args.hasOwnProperty("filter") ? "" + args["filter"] : "";
    const sort = args.hasOwnProperty("sort") ? "" + args["sort"] : "";
    const indexParameters = Object.values(config.ui.index);
    if (!indexParameters.length) {
      indexParameters.push({
        label: "ID",
        parameter: ["PARAM", "DeviceID.ID"]
      });
    }
    resolve({ filter, indexParameters, sort });
  });
}

function renderActions(selected): Children {
  const buttons = [];

  buttons.push(
    m(
      "button.primary",
      {
        title: "Reboot selected devices",
        disabled: !selected.size,
        onclick: () => {
          for (const d of selected) {
            taskQueue.queueTask({
              name: "reboot",
              device: d
            });
          }
        }
      },
      "Reboot"
    )
  );

  buttons.push(
    m(
      "button.critical",
      {
        title: "Factory reset selected devices",
        disabled: !selected.size,
        onclick: () => {
          for (const d of selected) {
            taskQueue.queueTask({
              name: "factoryReset",
              device: d
            });
          }
        }
      },
      "Reset"
    )
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
                if (--counter === 0) store.fulfill(0, Date.now());
              })
              .catch(err => {
                notifications.push("error", `${id}: ${err.message}`);
                if (--counter === 0) store.fulfill(0, Date.now());
              });
          }
          if (--counter === 0) store.fulfill(0, Date.now());
        }
      },
      "Delete"
    )
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
                if (--counter === 0) store.fulfill(0, Date.now());
              })
              .catch(err => {
                notifications.push("error", `${id}: ${err.message}`);
                if (--counter === 0) store.fulfill(0, Date.now());
              });
          }
          if (--counter === 0) store.fulfill(0, Date.now());
        }
      },
      "Tag"
    )
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
            `Enter tag to unassign from ${ids.length} devices:`
          );
          if (!tag) return;

          let counter = 1;
          for (const id of ids) {
            ++counter;
            store
              .updateTags(id, { [tag]: false })
              .then(() => {
                notifications.push("success", `${id}: Tags updated`);
                if (--counter === 0) store.fulfill(0, Date.now());
              })
              .catch(err => {
                notifications.push("error", `${id}: ${err.message}`);
                if (--counter === 0) store.fulfill(0, Date.now());
              });
          }
          if (--counter === 0) store.fulfill(0, Date.now());
        }
      },
      "Untag"
    )
  );

  return buttons;
}

export const component: ClosureComponent = (): Component => {
  return {
    view: vnode => {
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
        const _sort = Object.assign({}, sort);
        for (const [index, direction] of Object.entries(sortedAttrs)) {
          const param = memoizedGetSortable(attributes[index].parameter);
          if (param) {
            // Changing the priority of columns
            delete _sort[param];
            _sort[param] = direction;
          }
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
        sort: sort
      });
      const count = store.count("devices", filter);

      const downloadUrl = getDownloadUrl(filter, attributes);

      const valueCallback = (attr, device): Children => {
        return m.context(
          { device: device, parameter: attr.parameter },
          attr.type || "parameter",
          attr
        );
      };

      const attrs = {};
      attrs["attributes"] = attributes;
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
              device["DeviceID.ID"].value[0]
            )}`
          },
          "Show"
        );
      };

      if (window.authorizer.hasAccess("devices", 3))
        attrs["actionsCallback"] = renderActions;

      const filterAttrs = {};
      filterAttrs["resource"] = "devices";
      filterAttrs["filter"] = vnode.attrs["filter"];
      filterAttrs["onChange"] = onFilterChanged;

      return [
        m("h1", "Listing devices"),
        m(filterComponent, filterAttrs),
        m(indexTableComponent, attrs)
      ];
    }
  };
};
