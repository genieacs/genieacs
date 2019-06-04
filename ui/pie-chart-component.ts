/**
 * Copyright 2013-2019  GenieACS Inc.
 *
 * This file is part of GenieACS.
 *
 * GenieACS is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * GenieACS is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with GenieACS.  If not, see <http://www.gnu.org/licenses/>.
 */

import { ClosureComponent, Component, Children } from "mithril";
import { m } from "./components";
import { stringify } from "../lib/common/expression-parser";
import memoize from "../lib/common/memoize";

const memoizedStringify = memoize(stringify);

function drawChart(chartData): Children {
  const slices = chartData.slices;
  const total: number = Array.from(Object.values(chartData.slices)).reduce(
    (a: number, s) => a + (s["count"]["value"] || 0),
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
    const percent = total > 0 ? (slice["count"]["value"] || 0) / total : 0;
    legend.push(
      m(".legend-line", [
        m("span.color", {
          style: `background-color: ${slice["color"]} !important;`
        }),
        `${slice["label"]}: `,
        m(
          "a",
          {
            href: `/#!/devices/?${m.buildQueryString({
              filter: memoizedStringify(slice["filter"])
            })}`
          },
          slice["count"]["value"] || 0
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
          fill: slice["color"]
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
              filter: memoizedStringify(slice["filter"])
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
}

const component: ClosureComponent = (): Component => {
  return {
    view: vnode => {
      return drawChart(vnode.attrs["chart"]);
    }
  };
};

export default component;
