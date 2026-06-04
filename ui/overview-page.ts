import { overview, rawConf } from "./config.ts";
import { count as reactiveCount } from "./reactive-store.ts";
import Expression from "../lib/common/expression.ts";
import { renderView } from "./views.ts";
import { createPieChart } from "./pie-chart-component.ts";
import { div, h1, h2 } from "./dom.ts";

const GROUPS = overview.groups;
const CHARTS: typeof overview.charts = {};
for (const group of GROUPS) {
  for (const chartName of group.charts)
    CHARTS[chartName] = overview.charts[chartName];
}

export type Attrs = Record<string, never>;

export function init(): Promise<Attrs> {
  if (!window.authorizer.hasAccess("devices", 1)) {
    return Promise.reject(
      new Error("You are not authorized to view this page"),
    );
  }

  return Promise.resolve({} as Attrs);
}

export function createPage(): HTMLElement {
  document.title = "Overview - GenieACS";

  // Custom view mode
  if (
    rawConf["overview"] instanceof Expression.Literal &&
    typeof rawConf["overview"].value === "string"
  ) {
    const viewName = (rawConf["overview"] as Expression.Literal)
      .value as string;
    return div({}, renderView(viewName, {}));
  }

  // Create reactive count signals for all chart slices
  const sliceCountSignals = new Map<string, ReturnType<typeof reactiveCount>>();
  for (const [chartName, chart] of Object.entries(CHARTS)) {
    for (let i = 0; i < chart.slices.length; i++) {
      const slice = chart.slices[i];
      sliceCountSignals.set(
        `${chartName}:${i}`,
        reactiveCount("devices", slice.filter),
      );
    }
  }

  // Reactive child: reads all count signals, rebuilds charts when data arrives
  return div({}, () => {
    const groupElements: Node[] = [];

    for (const group of GROUPS) {
      if (group.label) {
        groupElements.push(
          h1({ class: "text-xl font-medium text-stone-900 mb-5" }, group.label),
        );
      }

      const chartElements: Node[] = [];
      for (const chartName of group.charts) {
        const chartConfig = CHARTS[chartName];

        const slices = chartConfig.slices.map((s, i) => {
          const signal = sliceCountSignals.get(`${chartName}:${i}`);
          const state = signal!.get();
          return {
            label: s.label,
            filter: s.filter,
            color: s.color,
            count: state.value as number | null,
            loading: state.loading,
          };
        });

        chartElements.push(
          div(
            { class: "p-4 bg-white shadow-sm rounded-lg sm:p-6 sm:px-8" },
            ...(chartConfig.label
              ? [
                  h2(
                    {
                      class:
                        "text-lg font-semibold text-stone-700 truncate mb-5 text-center",
                    },
                    chartConfig.label,
                  ),
                ]
              : []),
            createPieChart({ label: chartConfig.label, slices }),
          ),
        );
      }

      groupElements.push(
        div(
          { class: "flex justify-center mt-5 mb-10 gap-x-10" },
          ...chartElements,
        ),
      );
    }

    return div({}, ...groupElements);
  });
}
