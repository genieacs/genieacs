"use strict";

import m from "mithril";
import config from "./config";
import pieChartComponent from "./pie-chart-component";
import * as filterParser from "../common/filter-parser";

function count(filter, limit) {
  return new Promise((resolve, reject) => {
    function extract(xhr) {
      return +xhr.getResponseHeader("x-total-count");
    }
    m
      .request({
        method: "HEAD",
        url:
          "/api/devices/?" +
          m.buildQueryString({ filter: filter, limit: limit }),
        extract: extract
      })
      .then(res => {
        resolve(res);
      })
      .catch(err => {
        err.message = err.message || "Unknown error";
        reject(err);
      });
  });
}

function queryCharts(groups) {
  const now = Date.now();
  function evalNow(exp) {
    if (exp[0] == "FUNC" && exp[1] === "NOW" && exp.length == 2) return now;
  }

  let calls = [];
  groups = Object.assign({}, groups);
  for (let [groupName, group] of Object.entries(groups)) {
    groups[groupName] = group = Object.assign({}, group);
    for (let [chartName, chart] of Object.entries(group.charts)) {
      group.charts[chartName] = chart = Object.assign({}, chart);
      for (let [sliceName, slice] of Object.entries(chart.slices)) {
        chart.slices[sliceName] = slice = Object.assign({}, slice);
        calls.push(
          new Promise((resolve, reject) => {
            let f = filterParser.map(filterParser.parse(slice.filter), evalNow);
            count(filterParser.stringify(f))
              .then(c => {
                slice.count = c;
                resolve();
              })
              .catch(reject);
          })
        );
      }
    }
  }

  return new Promise((resolve, reject) => {
    Promise.all(calls)
      .then(() => {
        resolve(groups);
      })
      .catch(reject);
  });
}

const init = function() {
  return new Promise((resolve, reject) => {
    queryCharts(config.overview)
      .then(charts => {
        resolve({ charts: charts });
      })
      .catch(err => {
        err.message = err.message || "Unknown error";
        reject(err);
      });
  });
};

const component = {
  view: vnode => {
    document.title = "Overview - GenieACS";
    let children = [];
    for (let group of Object.values(vnode.attrs.charts)) {
      if (group.label) children.push(m("h1", group.label));

      let groupChildren = [];
      for (let chart of Object.values(group.charts)) {
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
