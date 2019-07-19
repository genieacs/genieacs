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
import * as notifications from "../notifications";
import * as store from "../store";
import { getIcon } from "../icons";

const component: ClosureComponent = (): Component => {
  return {
    view: vnode => {
      const device = vnode.attrs["device"];
      let writable = true;
      if (vnode.attrs["writable"] != null) writable = vnode.attrs["writable"];

      const tags = [];
      for (const p of Object.keys(device))
        if (p.startsWith("Tags.")) tags.push(p.slice(5));

      tags.sort();

      if (!writable) return m(".tags", tags.map(t => m("span.tag", t)));

      return m(
        ".tags",
        tags.map(tag =>
          m(
            "span.tag",
            tag,
            m(
              "button",
              {
                onclick: e => {
                  e.target.disabled = true;
                  const deviceId = device["DeviceID.ID"].value[0];
                  store
                    .updateTags(deviceId, { [tag]: false })
                    .then(() => {
                      e.target.disabled = false;
                      notifications.push(
                        "success",
                        `${deviceId}: Tags updated`
                      );
                      store.fulfill(0, Date.now());
                    })
                    .catch(err => {
                      e.target.disabled = false;
                      notifications.push(
                        "error",
                        `${deviceId}: ${err.message}`
                      );
                    });
                }
              },
              getIcon("remove")
            )
          )
        ),
        m(
          "span.tag.writable",
          m.trust("&nbsp;"),
          m(
            "button",
            {
              onclick: e => {
                e.target.disabled = true;
                const deviceId = device["DeviceID.ID"].value[0];
                const tag = prompt(`Enter tag to assign to device:`);
                if (!tag) {
                  e.target.disabled = false;
                  return;
                }

                store
                  .updateTags(deviceId, { [tag]: true })
                  .then(() => {
                    e.target.disabled = false;
                    notifications.push("success", `${deviceId}: Tags updated`);
                    store.fulfill(0, Date.now());
                  })
                  .catch(err => {
                    e.target.disabled = false;
                    notifications.push("error", `${deviceId}: ${err.message}`);
                  });
              }
            },
            getIcon("add")
          )
        )
      );
    }
  };
};

export default component;
