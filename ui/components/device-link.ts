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
import { evaluateExpression } from "../store";

const component: ClosureComponent = (): Component => {
  return {
    view: (vnode) => {
      let deviceId;
      const device = vnode.attrs["device"];
      if (device) deviceId = device["DeviceID.ID"].value[0];

      const children = Object.values(vnode.attrs["components"]).map((c) => {
        if (Array.isArray(c)) c = evaluateExpression(c, device || {});
        if (typeof c !== "object") return `${c}`;
        const type = evaluateExpression(c["type"], device || {});
        if (!type) return null;
        const attrs = Object.assign({}, vnode.attrs, c);
        return m(type as string, attrs);
      });
      if (deviceId) {
        return m(
          "a",
          { href: `#!/devices/${encodeURIComponent(deviceId)}` },
          children
        );
      } else {
        return children;
      }
    },
  };
};

export default component;
