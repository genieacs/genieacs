"use strict";

import { m } from "./components";
import config from "./config";
import * as store from "./store";
import pieChartComponent from "./pie-chart-component";

const GROUPS = config.ui.overview.groups;
const CHARTS = {};
for (const group of Object.values(GROUPS)) {
  for (const chartName of Object.values(group["charts"]))
    CHARTS[chartName] = config.ui.overview.charts[chartName];
}

function queryCharts(charts) {
  charts = Object.assign({}, charts);
  for (let [chartName, chart] of Object.entries(charts)) {
    charts[chartName] = chart = Object.assign({}, chart);
    chart.slices = Object.assign({}, chart.slices);
    for (let [sliceName, slice] of Object.entries(chart.slices)) {
      const filter = slice.filter;
      chart.slices[sliceName] = slice = Object.assign({}, slice);
      slice.count = store.count("devices", filter);
    }
  }
  return charts;
}

export function init() {
  if (!window.authorizer.hasAccess("devices", 1)) {
    return Promise.reject(
      new Error("You are not authorized to view this page")
    );
  }

  return Promise.resolve({ charts: queryCharts(CHARTS) });
}

export function component() {
  return {
    view: vnode => {
      document.title = "Overview - GenieACS";
      const children = [];
      for (const group of Object.values(GROUPS)) {
        if (group.label) children.push(m("h1", group.label));

        const groupChildren = [];
        for (const chartName of Object.values(group.charts)) {
          const chart = vnode.attrs.charts[chartName];
          const chartChildren = [];
          if (chart.label) chartChildren.push(m("h2", chart.label));

          chartChildren.push(m(pieChartComponent, { chart: chart }));

          groupChildren.push(m(".overview-chart", chartChildren));
        }

        children.push(m(".overview-chart-group", groupChildren));
      }

      return children;
    }
  };
}
