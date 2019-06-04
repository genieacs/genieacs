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

export function init(args): Promise<{}> {
  if (!window.authorizer.hasAccess("devices", 2)) {
    return Promise.reject(
      new Error("You are not authorized to view this page")
    );
  }

  return Promise.resolve({
    deviceId: args.id,
    deviceFilter: ["=", ["PARAM", "DeviceID.ID"], args.id]
  });
}

export const component: ClosureComponent = (): Component => {
  return {
    view: vnode => {
      document.title = `${vnode.attrs["deviceId"]} - Devices - GenieACS`;

      const dev = store.fetch("devices", vnode.attrs["deviceFilter"]).value;
      if (!dev.length) return "Loading";
      const conf = config.ui.device;
      const cmps = [];

      for (const c of Object.values(conf))
        cmps.push(m.context({ device: dev[0] }, c["type"], c));

      return [m("h1", vnode.attrs["deviceId"]), cmps];
    }
  };
};
