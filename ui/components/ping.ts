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

const REFRESH_INTERVAL = 3000;

const component: ClosureComponent = (): Component => {
  return {
    oninit: vnode => {
      vnode.state["timestamp"] = 0;
      vnode.state["ping"] = null;
      vnode.state["host"] = null;
      vnode.state["timeout"] = null;
    },
    view: vnode => {
      const refresh = (): void => {
        const device = vnode.attrs["device"];
        let param =
          device["InternetGatewayDevice.ManagementServer.ConnectionRequestURL"];
        if (!param)
          param = device["Device.ManagementServer.ConnectionRequestURL"];
        if (!param || !param.value) return;

        const url = new URL(param.value[0]);
        vnode.state["host"] = url.hostname;
        vnode.state["timestamp"] = Date.now();
        store
          .ping(vnode.state["host"])
          .then(res => {
            vnode.state["ping"] = res;
          })
          .catch(() => {
            // Do nothing
          });
      };

      const t = vnode.state["timestamp"] + REFRESH_INTERVAL - Date.now();
      clearTimeout(vnode.state["timeout"]);
      if (t <= 0) refresh();
      else vnode.state["timeout"] = setTimeout(refresh, t);

      if (vnode.state["host"]) {
        let status = "";
        if (vnode.state["ping"]) {
          if (vnode.state["ping"].avg != null)
            status = `${Math.trunc(vnode.state["ping"].avg)} ms`;
          else status = "Unreachable";
        }

        return m("div", `Pinging ${vnode.state["host"]}: ${status}`);
      }
      return null;
    }
  };
};

export default component;
