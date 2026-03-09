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
            "svg.inline",
            {
              width: "1em",
              height: "1em",
              style: "margin: 0 0.2em 0.2em",
              xmlns: "http://www.w3.org/2000/svg",
              "xmlns:xlink": "http://www.w3.org/1999/xlink",
            },
            m("circle.stroke-stone-200 stroke-1", {
              cx: "0.5em",
              cy: "0.5em",
              r: "0.4em",
              fill: evaluateExpression(slice["color"], null),
            }),
          );
          return m("span", dot, evaluateExpression(slice["label"], null));
        }
      }
      return null;
    },
  };
};

export default component;
