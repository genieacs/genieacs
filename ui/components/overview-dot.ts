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
import config from "../config";
import * as store from "../store";

const CHARTS = config.ui.overview.charts;

const component: ClosureComponent = (): Component => {
  return {
    view: vnode => {
      const device = vnode.attrs["device"];
      const chart = CHARTS[vnode.attrs["chart"]];
      if (!chart) return null;
      for (const slice of Object.values(chart.slices)) {
        const filter = slice["filter"];
        if (store.evaluateExpression(filter, device)) {
          const dot = m(
            "svg",
            {
              width: "1em",
              height: "1em",
              xmlns: "http://www.w3.org/2000/svg",
              "xmlns:xlink": "http://www.w3.org/1999/xlink"
            },
            m("circle", {
              cx: "0.5em",
              cy: "0.5em",
              r: "0.4em",
              fill: slice["color"]
            })
          );
          return m("span.overview-dot", dot, `${slice["label"]}`);
        }
      }
      return null;
    }
  };
};

export default component;
