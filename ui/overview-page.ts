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
import pieChartComponent from "./pie-chart-component";

const GROUPS = config.ui.overview.groups || {};
const CHARTS = {};
for (const group of Object.values(GROUPS)) {
  for (const chartName of Object.values(group["charts"]) as string[])
    CHARTS[chartName] = config.ui.overview.charts[chartName];
}

function queryCharts(charts): {} {
  charts = Object.assign({}, charts);
  for (let [chartName, chart] of Object.entries(charts)) {
    charts[chartName] = chart = Object.assign({}, chart);
    chart["slices"] = Object.assign({}, chart["slices"]);
    for (let [sliceName, slice] of Object.entries(chart["slices"])) {
      const filter = slice["filter"];
      chart["slices"][sliceName] = slice = Object.assign({}, slice);
      slice["count"] = store.count("devices", filter);
    }
  }
  return charts;
}

export function init(): Promise<{}> {
  if (!window.authorizer.hasAccess("devices", 1)) {
    return Promise.reject(
      new Error("You are not authorized to view this page")
    );
  }

  return Promise.resolve({ charts: queryCharts(CHARTS) });
}

export const component: ClosureComponent = (): Component => {
  return {
    view: vnode => {
      document.title = "Overview - GenieACS";
      const children = [];
      for (const group of Object.values(GROUPS)) {
        if (group["label"]) children.push(m("h1", group["label"]));

        const groupChildren = [];
        for (const chartName of Object.values(group["charts"]) as string[]) {
          const chart = vnode.attrs["charts"][chartName];
          const chartChildren = [];
          if (chart.label) chartChildren.push(m("h2", chart.label));

          const attrs = {};
          attrs["chart"] = chart;
          chartChildren.push(m(pieChartComponent, attrs));

          groupChildren.push(m(".overview-chart", chartChildren));
        }

        children.push(m(".overview-chart-group", groupChildren));
      }

      return children;
    }
  };
};
