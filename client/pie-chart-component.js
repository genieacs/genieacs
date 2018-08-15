"use strict";

import m from "mithril";

const drawChart = function(chartData) {
  let slices = chartData.slices;
  let total = Array.from(Object.values(chartData.slices)).reduce(
    (a, s) => a + (s.count.value || 0),
    0
  );
  let legend = [];
  let paths = [];
  let links = [];
  let currentProgressPercentage = 0;
  let startX = Math.cos(2 * Math.PI * currentProgressPercentage) * 100;
  let startY = Math.sin(2 * Math.PI * currentProgressPercentage) * 100;
  let endX, endY;

  for (let slice of Object.values(slices)) {
    let percent = total > 0 ? (slice.count.value || 0) / total : 0;
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
              filter: slice.filter
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
      let isBigArc = percent > 0.5 ? 1 : 0;

      let sketch =
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

      let percentageX =
        Math.cos(2 * Math.PI * (currentProgressPercentage - percent / 2)) * 50;
      let percentageY =
        Math.sin(2 * Math.PI * (currentProgressPercentage - percent / 2)) * 50;

      links.push(
        m(
          "a",
          {
            "xlink:href": `/#!/devices/?${m.buildQueryString({
              filter: slice.filter
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
