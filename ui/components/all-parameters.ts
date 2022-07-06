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

import { ClosureComponent, Component } from "mithril";
import { m } from "../components";
import * as taskQueue from "../task-queue";
import { parse } from "../../lib/common/expression-parser";
import memoize from "../../lib/common/memoize";
import { getIcon } from "../icons";
import { evaluateExpression } from "../store";
import debounce from "../../lib/common/debounce";

const memoizedParse = memoize(parse);

function escapeRegExp(str): string {
  return str.replace(/[-[\]/{}()*+?.\\^$|]/g, "\\$&");
}

const keysByDepth: WeakMap<Record<string, unknown>, string[][]> = new WeakMap();

function orderKeysByDepth(device: Record<string, unknown>): string[][] {
  if (keysByDepth.has(device)) return keysByDepth.get(device);
  const res: string[][] = [];
  for (const key of Object.keys(device)) {
    let count = 0;
    for (
      let i = key.lastIndexOf(".", key.length - 2);
      i >= 0;
      i = key.lastIndexOf(".", i - 1)
    )
      ++count;
    while (res.length <= count) res.push([]);
    res[count].push(key);
  }
  keysByDepth.set(device, res);
  return res;
}

const component: ClosureComponent = (): Component => {
  let queryString: string;
  const formQueryString = debounce((args: string[]) => {
    queryString = args[args.length - 1];
    m.redraw();
  }, 500);

  return {
    view: (vnode) => {
      const device = vnode.attrs["device"];

      const limit = evaluateExpression(vnode.attrs["limit"], device) || 100;

      const search = m("input", {
        type: "text",
        placeholder: "Search parameters",
        oninput: (e) => {
          formQueryString(e.target.value);
          e.redraw = false;
        },
      });

      const instanceRegex = /\.[0-9]+$/;
      let re;
      if (queryString) {
        const keywords = queryString.split(" ").filter((s) => s);
        if (keywords.length)
          re = new RegExp(keywords.map((s) => escapeRegExp(s)).join(".*"), "i");
      }

      const filteredKeys: string[] = [];
      const allKeys = orderKeysByDepth(device);
      let count = 0;
      for (const keys of allKeys) {
        let c = 0;
        for (const k of keys) {
          const p = device[k];
          const str = p.value?.[0] ? `${k} ${p.value[0]}` : k;
          if (re && !re.test(str)) continue;
          ++c;
          if (count < limit) filteredKeys.push(k);
        }
        count += c;
      }

      filteredKeys.sort();

      const rows = filteredKeys.map((k) => {
        const p = device[k];
        const val = [];
        const attrs = { key: k };

        if (p.object === false) {
          val.push(
            m(
              "parameter",
              Object.assign({ device: device, parameter: memoizedParse(k) })
            )
          );
        } else if (p.object && p.writable) {
          if (instanceRegex.test(k)) {
            val.push(
              m(
                "button",
                {
                  title: "Delete this instance",
                  onclick: () => {
                    taskQueue.queueTask({
                      name: "deleteObject",
                      device: device["DeviceID.ID"].value[0],
                      objectName: k,
                    });
                  },
                },
                getIcon("delete-instance")
              )
            );
          } else {
            val.push(
              m(
                "button",
                {
                  title: "Create a new instance",
                  onclick: () => {
                    taskQueue.queueTask({
                      name: "addObject",
                      device: device["DeviceID.ID"].value[0],
                      objectName: k,
                    });
                  },
                },
                getIcon("add-instance")
              )
            );
          }
        }

        val.push(
          m(
            "button",
            {
              title: "Refresh tree",
              onclick: () => {
                taskQueue.queueTask({
                  name: "getParameterValues",
                  device: device["DeviceID.ID"].value[0],
                  parameterNames: [k],
                });
              },
            },
            getIcon("refresh")
          )
        );

        return m(
          "tr",
          attrs,
          m("td.left", m("long-text", { text: k })),
          m("td.right", val)
        );
      });

      return m(
        "loading",
        { queries: [vnode.attrs["deviceQuery"]] },
        m(
          ".all-parameters",
          m(
            "a.download-csv",
            {
              href: `api/devices/${encodeURIComponent(
                device["DeviceID.ID"].value[0]
              )}.csv`,
              download: "",
              style: "float: right;",
            },
            "Download"
          ),
          search,
          m(
            ".parameter-list",
            m("table", m("tbody", rows)),
            m(
              "m",
              `Displaying ${filteredKeys.length} out of ${count} parameters.`
            )
          )
        )
      );
    },
  };
};

export default component;
