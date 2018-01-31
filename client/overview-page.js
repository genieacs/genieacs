"use strict";

import m from "mithril";
import * as config from "./config";
import * as store from "./store";
import pieChartComponent from "./pie-chart-component";

const GROUPS = config.get("ui.overview.groups");
const CHARTS = {};
for (let group of Object.values(GROUPS))
  for (let chartName of Object.values(group["charts"]))
    CHARTS[chartName] = config.get("ui.overview.charts")[chartName];

function queryCharts(charts) {
  charts = Object.assign({}, charts);
  for (let [chartName, chart] of Object.entries(charts)) {
    charts[chartName] = chart = Object.assign({}, chart);
    for (let [sliceName, slice] of Object.entries(chart.slices)) {
      chart.slices[sliceName] = slice = Object.assign({}, slice);
      slice.count = store.count("devices", slice.filter);
    }
  }
  return charts;
}

const init = function() {
  return new Promise(resolve => {
    resolve({ charts: queryCharts(CHARTS) });
  });
};

const component = {
  view: () => {
    document.title = "Overview - GenieACS";
    let children = [];
    for (let group of Object.values(GROUPS)) {
      if (group.label) children.push(m("h1", group.label));

      let groupChildren = [];
      for (let chartName of Object.values(group.charts)) {
        const chart = CHARTS[chartName];
        let chartChildren = [];
        if (chart.label) chartChildren.push(m("h2", chart.label));

        chartChildren.push(m(pieChartComponent, { chart: chart }));

        groupChildren.push(m(".overview-chart", chartChildren));
      }

      children.push(m(".overview-chart-group", groupChildren));
    }

    return children;
  }
};

export { init, component };
