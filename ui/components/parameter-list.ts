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

const component: ClosureComponent = (): Component => {
  return {
    view: vnode => {
      const device = vnode.attrs["device"];

      const rows = Object.values(vnode.attrs["parameters"]).map(parameter => {
        const p = m.context(
          {
            device: device,
            parameter: parameter["parameter"]
          },
          parameter["type"] || "parameter",
          parameter
        );

        return m(
          "tr",
          {
            onupdate: vn => {
              (vn.dom as HTMLElement).style.display = (p as VnodeDOM).dom
                ? ""
                : "none";
            }
          },
          m("th", parameter["label"]),
          m("td", p)
        );
      });

      return m("table.parameter-list", rows);
    }
  };
};

export default component;
