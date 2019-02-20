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
