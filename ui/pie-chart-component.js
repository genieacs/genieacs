"use strict";

import m from "mithril";
import { stringify } from "../lib/common/expression-parser";
import memoize from "../lib/common/memoize";

const memoizedStringify = memoize(stringify);

const drawChart = function(chartData) {
  const slices = chartData.slices;
  const total = Array.from(Object.values(chartData.slices)).reduce(
    (a, s) => a + (s.count.value || 0),
    0
  );
  const legend = [];
  const paths = [];
  const links = [];
  let currentProgressPercentage = 0;
  let startX = Math.cos(2 * Math.PI * currentProgressPercentage) * 100;
  let startY = Math.sin(2 * Math.PI * currentProgressPercentage) * 100;
  let endX, endY;

  for (const slice of Object.values(slices)) {
    const percent = total > 0 ? (slice.count.value || 0) / total : 0;
    legend.push(
      m(".legend-line", [
        m("span.color", {
          style: `background-color: ${slice.color} !important;`
        }),
        `${slice.label}: `,
        m(
          "a",
          {
            href: `/#!/devices/?${m.buildQueryString({
              filter: memoizedStringify(slice.filter)
            })}`
          },
          slice.count.value || 0
        ),
        ` (${(percent * 100).toFixed(2)}%)`
      ])
    );

    if (percent > 0) {
      currentProgressPercentage += percent;
      endX = Math.cos(2 * Math.PI * currentProgressPercentage) * 100;
      endY = Math.sin(2 * Math.PI * currentProgressPercentage) * 100;
      const isBigArc = percent > 0.5 ? 1 : 0;

      const sketch =
        `M ${startX} ${startY} ` + // Move to the starting point
        `A 100 100 0 ${isBigArc} 1 ${endX} ${endY} ` + // Draw an Arc from starting point to ending point
        `L 0 0 z`; // complete the shape by drawing a line to the center of circle

      startX = endX;
      startY = endY;

      paths.push(
        m("path", {
          d: sketch,
          fill: slice.color
        })
      );

      const percentageX =
        Math.cos(2 * Math.PI * (currentProgressPercentage - percent / 2)) * 50;
      const percentageY =
        Math.sin(2 * Math.PI * (currentProgressPercentage - percent / 2)) * 50;

      links.push(
        m(
          "a",
          {
            "xlink:href": `/#!/devices/?${m.buildQueryString({
              filter: memoizedStringify(slice.filter)
            })}`
          },
          [
            m("path", {
              d: sketch,
              "fill-opacity": 0
            }),
            m(
              "text",
              {
                x: percentageX,
                y: percentageY,
                "dominant-baseline": "middle",
                "text-anchor": "middle"
              },
              `${(percent * 100).toFixed(2)}%`
            )
          ]
        )
      );
    }
  }

  legend.push(m("span.legend-total", `Total: ${total}`));

  return m("div", { class: "pie-chart" }, [
    m(
      "svg",
      {
        // Adding 2 as padding; strokes must not be more than 2
        viewBox: "-102 -102 204 204",
        width: "204px",
        height: "204px",
        xmlns: "http://www.w3.org/2000/svg",
        "xmlns:xlink": "http://www.w3.org/1999/xlink"
      },
      paths.concat(links)
    ),
    m(".legend", legend)
  ]);
};

const component = {
  view: vnode => {
    return drawChart(vnode.attrs.chart);
  }
};

export default component;
