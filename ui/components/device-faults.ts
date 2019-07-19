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
import * as store from "../store";
import * as notifications from "../notifications";
import { getIcon } from "../icons";

const component: ClosureComponent = (): Component => {
  return {
    view: vnode => {
      const device = vnode.attrs["device"];
      const deviceId = device["DeviceID.ID"].value[0];
      const faults = store.fetch("faults", [
        "AND",
        [">", ["PARAM", "_id"], `${deviceId}:`],
        ["<", ["PARAM", "_id"], `${deviceId}:zzzz`]
      ]);

      const headers = [
        "Channel",
        "Code",
        "Message",
        "Retries",
        "Timestamp"
      ].map(l => m("th", l));
      const thead = m("thead", m("tr", headers));

      const rows = [];
      for (const f of faults.value) {
        rows.push([
          m("td", f["channel"]),
          m("td", f["code"]),
          m("td", f["message"]),
          m("td", f["retries"]),
          m("td", new Date(f["timestamp"]).toLocaleString()),
          m(
            "td",
            m(
              "button",
              {
                title: "Delete fault",
                onclick: e => {
                  e.redraw = false;
                  store
                    .deleteResource("faults", f["_id"])
                    .then(() => {
                      notifications.push("success", "Fault deleted");
                      store.fulfill(Date.now(), Date.now());
                      m.redraw();
                    })
                    .catch(err => {
                      notifications.push("error", err.message);
                      store.fulfill(Date.now(), Date.now());
                    });
                }
              },
              getIcon("remove")
            )
          )
        ]);
      }

      let tbody;
      if (rows.length) {
        tbody = m("tbody", rows.map(r => m("tr", r)));
      } else {
        tbody = m(
          "tbody",
          m("tr.empty", m("td", { colspan: headers.length }, "No faults"))
        );
      }

      return m("table.table", thead, tbody);
    }
  };
};

export default component;
