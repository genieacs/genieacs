import { ClosureComponent, Component } from "mithril";
import { m } from "../components.ts";
import config from "../config.ts";
import { evaluateExpression } from "../store.ts";

const CHARTS = config.ui.overview.charts;

const component: ClosureComponent = (): Component => {
  return {
    view: (vnode) => {
      const device = vnode.attrs["device"];
      const chartName = evaluateExpression(vnode.attrs["chart"], device || {});
      const chart = CHARTS[chartName as string] as Record<string, unknown>;
      if (!chart) return null;
      for (const slice of Object.values(chart.slices)) {
        const filter = slice["filter"];
        if (evaluateExpression(filter, device || {})) {
          const dot = m(
            "svg",
            {
              width: "1em",
              height: "1em",
              xmlns: "http://www.w3.org/2000/svg",
              "xmlns:xlink": "http://www.w3.org/1999/xlink",
            },
            m("circle", {
              cx: "0.5em",
              cy: "0.5em",
              r: "0.4em",
              fill: evaluateExpression(slice["color"], null),
            }),
          );
          return m(
            "span.overview-dot",
            dot,
            evaluateExpression(slice["label"], null),
          );
        }
      }
      return null;
    },
  };
};

export default component;
