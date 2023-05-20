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
import { m } from "./components";
import config from "./config";
import * as store from "./store";

export function init(
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  if (!window.authorizer.hasAccess("devices", 2)) {
    return Promise.reject(
      new Error("You are not authorized to view this page")
    );
  }

  return Promise.resolve({
    deviceId: args.id,
    deviceFilter: ["=", ["PARAM", "DeviceID.ID"], args.id],
    tab: args.tab,
  });
}

export const component: ClosureComponent = (): Component => {
  return {
    view: (vnode) => {
      document.title = `${vnode.attrs["deviceId"]} - Device ${vnode.attrs["tab"]} - GenieACS`;

      const dev = store.fetch("devices", vnode.attrs["deviceFilter"]);
      if (!dev.value.length) {
        if (!dev.fulfilling)
          return m("p.error", `No such device ${vnode.attrs["deviceId"]}`);
        return m(
          "loading",
          { queries: [dev] },
          m("div", { style: "height: 100px;" })
        );
      }


      const conf = config.ui.device;
      const deviceTabs = config.ui.deviceTabs;
      
      const cmps = [];
      
      if (Object.keys(deviceTabs).length > 0) {
        const tabActive = { [vnode.attrs["tab"]||deviceTabs[0]["route"]]: "active" };
        const tabs = [];
        const tabContent = [];
        for (const [k,c] of Object.entries(deviceTabs)) {
          tabs.push(
            m("li",{
              "class": tabActive[c["route"]],
            },[
              m("a", {
                href: `#!/devices/${vnode.attrs["deviceId"]}/${c["route"]}`,
              },c["label"])
            ])
          )
          if (tabActive[c["route"]]){
            for (const comp of Object.values(c["components"])) {
              tabContent.push(
                m.context({ device: dev.value[0], deviceQuery: dev }, comp["type"], comp)
              );  
            }  
          }
        }
        cmps.push(
          m("div.tab",[
            m("ul",tabs),
            m("div.tab_content", tabContent)
          ])
        );
      }else{
        for (const c of Object.values(conf)) {
          cmps.push(
            m.context({ device: dev.value[0], deviceQuery: dev }, c["type"], c)
          );
        }  
      }
      return [m("h1", vnode.attrs["deviceId"]), cmps];
    },
  };
};
