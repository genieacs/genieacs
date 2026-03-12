import { ClosureComponent } from "mithril";
import { m } from "./components.ts";
import { overview } from "./config.ts";
import * as store from "./store.ts";
import pieChartComponent from "./pie-chart-component.ts";

const GROUPS = overview.groups;
const CHARTS: typeof overview.charts = {};
for (const group of GROUPS) {
  for (const chartName of group.charts)
    CHARTS[chartName] = overview.charts[chartName];
}

function queryCharts(charts: typeof overview.charts): typeof charts {
  charts = Object.assign({}, charts);
  for (let [chartName, chart] of Object.entries(charts)) {
    charts[chartName] = chart = { ...chart };
    chart.slices = chart.slices.map((s) => ({ ...s }));
    for (const slice of chart.slices) {
      slice["count"] = store.count("devices", slice.filter);
    }
  }
  return charts;
}

export function init(): Promise<{ charts: typeof overview.charts }> {
  if (!window.authorizer.hasAccess("devices", 1)) {
    return Promise.reject(
      new Error("You are not authorized to view this page"),
    );
  }

  return Promise.resolve({ charts: queryCharts(CHARTS) });
}

interface Attrs {
  charts: typeof overview.charts;
}

export const component: ClosureComponent<Attrs> = () => {
  return {
    view: (vnode) => {
      document.title = "Overview - GenieACS";
      const children = [];
      for (const group of GROUPS) {
        if (group.label) {
          children.push(
            m("h1.text-xl font-medium text-stone-900 mb-5", group["label"]),
          );
        }

        const groupChildren = [];
        for (const chartName of group.charts) {
          const chart = vnode.attrs.charts[chartName];
          const chartChildren = [];
          if (chart.label) {
            chartChildren.push(
              m(
                "h2.text-lg font-semibold text-stone-700 truncate mb-5 text-center",
                chart.label,
              ),
            );
          }

          chartChildren.push(m(pieChartComponent, { chart }));

          groupChildren.push(
            m(
              "div.p-4 bg-white shadow-sm rounded-lg sm:p-6 sm:px-8",
              chartChildren,
            ),
          );
        }

        children.push(
          m("div.flex justify-center mt-5 mb-10 gap-x-10", groupChildren),
        );
      }

      return children;
    },
  };
};
