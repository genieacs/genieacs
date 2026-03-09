import { ClosureComponent, Component, Children } from "mithril";
import { m } from "./components.ts";
import { stringify } from "../lib/common/expression/parser.ts";
import memoize from "../lib/common/memoize.ts";
import * as store from "./store.ts";

const memoizedStringify = memoize(stringify);

function drawChart(chartData): Children {
  const slices = chartData.slices;
  const total: number = Array.from(Object.values(chartData.slices)).reduce(
    (a: number, s) => a + (s["count"]["value"] || 0),
    0,
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
      m("tr", [
        m(
          "td",
          m("span.inline-block w-3 h-3 border border-stone-200 mr-1", {
            style: `background-color: ${store.evaluateExpression(slice["color"], null)} !important;`,
          }),
        ),
        m("td.w-full", store.evaluateExpression(slice["label"], null)),
        m(
          "td.text-stone-500 text-right tabular-nums",
          `${Math.round(percent * 100)}%`,
        ),
        m(
          "td.text-right tabular-nums",
          m(
            "a.text-cyan-700 hover:text-cyan-900 font-medium ml-2",
            {
              href: `#!/devices/?${m.buildQueryString({
                filter: memoizedStringify(slice["filter"]),
              })}`,
            },
            slice["count"]["value"] || 0,
          ),
        ),
      ]),
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
        m("path.stroke-white stroke-1", {
          d: sketch,
          fill: store.evaluateExpression(slice["color"], null),
        }),
      );

      const percentageX =
        Math.cos(2 * Math.PI * (currentProgressPercentage - percent / 2)) * 50;
      const percentageY =
        Math.sin(2 * Math.PI * (currentProgressPercentage - percent / 2)) * 50;

      links.push(
        m(
          "a.opacity-0 hover:opacity-100 focus-visible:opacity-100 outline-hidden",
          {
            "xlink:href": `#!/devices/?${m.buildQueryString({
              filter: memoizedStringify(slice["filter"]),
            })}`,
          },
          [
            m("path.stroke-cyan-500 stroke-1", {
              d: sketch,
              "fill-opacity": 0,
            }),
            m(
              "text.opacity-40 font-medium fill-black",
              {
                x: percentageX,
                y: percentageY,
                "dominant-baseline": "middle",
                "text-anchor": "middle",
              },
              `${Math.round(percent * 100)}%`,
            ),
          ],
        ),
      );
    }
  }

  legend.push(
    m(
      "tr",
      m("td", ""),
      m("td", { colspan: 2 }, "Total"),
      m("td.text-right tabular-nums", total),
    ),
  );

  return m(
    "loading",
    {
      queries: Object.values(chartData.slices).map((s) => s["count"]),
    },
    m("div", [
      m(
        "svg.m-4",
        {
          // Adding 2 as padding; strokes must not be more than 2
          viewBox: "-102 -102 204 204",
          width: "204px",
          height: "204px",
          xmlns: "http://www.w3.org/2000/svg",
          "xmlns:xlink": "http://www.w3.org/1999/xlink",
        },
        paths.concat(links),
      ),
      m("table.mt-8 text-sm", legend),
    ]),
  );
}

const component: ClosureComponent = (): Component => {
  return {
    view: (vnode) => {
      return drawChart(vnode.attrs["chart"]);
    },
  };
};

export default component;
