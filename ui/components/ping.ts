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

import { ClosureComponent, Component, VnodeDOM } from "mithril";
import { m } from "../components";
import * as store from "../store";

const REFRESH_INTERVAL = 3000;

const component: ClosureComponent = (vn): Component => {
  let interval: ReturnType<typeof setInterval>;
  let host: string;

  const refresh = async (): Promise<void> => {
    let status = "";
    if (host) {
      try {
        const res = await store.ping(host);
        if (res["avg"] != null) status = `${Math.trunc(res["avg"])} ms`;
        else status = "Unreachable";
      } catch (err) {
        setTimeout(() => {
          throw err;
        }, 0);
      }
    }

    const dom = (vn as VnodeDOM).dom;

    if (dom) dom.innerHTML = `Pinging ${host}: ${status}`;
  };

  return {
    onremove: () => {
      clearInterval(interval);
    },
    view: vnode => {
      const device = vnode.attrs["device"];
      let param =
        device["InternetGatewayDevice.ManagementServer.ConnectionRequestURL"];
      if (!param)
        param = device["Device.ManagementServer.ConnectionRequestURL"];

      let h;
      if (param && param.value) {
        const url = new URL(param.value[0]);
        h = url.hostname;
      }

      if (host !== h) {
        host = h;
        clearInterval(interval);
        if (host) {
          refresh();
          interval = setInterval(refresh, REFRESH_INTERVAL);
        }
      }

      return m("div", `Pinging ${host}:`);
    }
  };
};

export default component;
