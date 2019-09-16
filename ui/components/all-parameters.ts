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

const memoizedParse = memoize(parse);

function escapeRegExp(str): string {
  return str.replace(/[-[\]/{}()*+?.\\^$|]/g, "\\$&");
}

const component: ClosureComponent = (): Component => {
  return {
    view: vnode => {
      const device = vnode.attrs["device"];

      const search = m("input", {
        type: "text",
        placeholder: "Search parameters",
        oninput: e => {
          vnode.state["searchString"] = e.target.value;
          e.redraw = false;
          clearTimeout(vnode.state["timeout"]);
          vnode.state["timeout"] = setTimeout(m.redraw, 500);
        }
      });

      const instanceRegex = /\.[0-9]+$/;
      let re;
      if (vnode.state["searchString"]) {
        const keywords = vnode.state["searchString"].split(" ").filter(s => s);
        if (keywords.length)
          re = new RegExp(keywords.map(s => escapeRegExp(s)).join(".*"), "i");
      }

      const rows = Object.keys(device)
        .sort()
        .map(k => {
          const p = device[k];
          const val = [];
          const attrs = {};
          if (re) {
            const str = p.value && p.value[0] ? `${k} ${p.value[0]}` : k;
            if (!re.test(str)) attrs["style"] = "display: none;";
          }

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
                        objectName: k
                      });
                    }
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
                        objectName: k
                      });
                    }
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
                    parameterNames: [k]
                  });
                }
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
        ".all-parameters",
        m(
          "a.download-csv",
          {
            href: `/api/devices/${encodeURIComponent(
              device["DeviceID.ID"].value[0]
            )}.csv`,
            download: "",
            style: "float: right;"
          },
          "Download"
        ),
        search,
        m(".parameter-list", m("table", m("tbody", rows)))
      );
    }
  };
};

export default component;
