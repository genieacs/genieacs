"use strict";

import m from "mithril";
import config from "../config";
import * as store from "../store";
import * as funcCache from "../../common/func-cache";
import Filter from "../../common/filter";

const CHARTS = config.ui.overview.charts;

const component = {
  view: vnode => {
    const device = vnode.attrs.device;
    const chart = CHARTS[vnode.attrs.chart];
    for (let slice of Object.values(chart.slices)) {
      const filter = store.unpackFilter(
        funcCache.get(Filter.parse, slice.filter)
      );
      if (filter.test(device)) {
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
            fill: slice.color
          })
        );
        return m("span.overview-dot", dot, `${slice.label}`);
      }
    }
  }
};

export default component;
