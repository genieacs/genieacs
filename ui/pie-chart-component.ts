import {
  div,
  span,
  a,
  table,
  tr,
  td,
  svg,
  svgPath,
  svgText,
  svgA,
} from "./dom.ts";
import Expression from "../lib/common/expression.ts";

interface ChartSlice {
  label: string;
  filter: Expression;
  color: string;
  count: number | null;
  loading: boolean;
}

interface ChartData {
  label?: string;
  slices: ChartSlice[];
}

export function createPieChart(chart: ChartData): HTMLElement {
  const slices = chart.slices;
  const total = slices.reduce((acc, s) => acc + (s.count || 0), 0);

  const legendRows: HTMLTableRowElement[] = [];
  const paths: SVGPathElement[] = [];
  const links: SVGAElement[] = [];

  let currentProgressPercentage = 0;
  let startX = Math.cos(2 * Math.PI * currentProgressPercentage) * 100;
  let startY = Math.sin(2 * Math.PI * currentProgressPercentage) * 100;

  for (const slice of slices) {
    const percent = total > 0 ? (slice.count || 0) / total : 0;
    const filterQs = new URLSearchParams({
      filter: slice.filter.toString(),
    }).toString();

    legendRows.push(
      tr(
        {},
        td(
          {},
          span({
            class: "inline-block w-3 h-3 border border-stone-200 mr-1",
            style: `background-color: ${slice.color} !important;`,
          }),
        ),
        td({ class: "w-full" }, slice.label),
        td(
          { class: "text-stone-500 text-right tabular-nums" },
          `${Math.round(percent * 100)}%`,
        ),
        td(
          { class: "text-right tabular-nums" },
          a(
            {
              class: "text-cyan-700 hover:text-cyan-900 font-medium ml-2",
              href: `/devices?${filterQs}`,
            },
            slice.count || 0,
          ),
        ),
      ),
    );

    if (percent > 0) {
      currentProgressPercentage += percent;
      const endX = Math.cos(2 * Math.PI * currentProgressPercentage) * 100;
      const endY = Math.sin(2 * Math.PI * currentProgressPercentage) * 100;
      const isBigArc = percent > 0.5 ? 1 : 0;

      const sketch =
        `M ${startX} ${startY} ` +
        `A 100 100 0 ${isBigArc} 1 ${endX} ${endY} ` +
        `L 0 0 z`;

      startX = endX;
      startY = endY;

      paths.push(
        svgPath({
          class: "stroke-white stroke-1",
          d: sketch,
          fill: slice.color,
        }),
      );

      const percentageX =
        Math.cos(2 * Math.PI * (currentProgressPercentage - percent / 2)) * 50;
      const percentageY =
        Math.sin(2 * Math.PI * (currentProgressPercentage - percent / 2)) * 50;

      links.push(
        svgA(
          {
            class:
              "opacity-0 hover:opacity-100 focus-visible:opacity-100 outline-hidden",
            href: `/devices?${filterQs}`,
          },
          svgPath({
            class: "stroke-cyan-500 stroke-1",
            d: sketch,
            "fill-opacity": "0",
          }),
          svgText(
            {
              class: "opacity-40 font-medium fill-black",
              x: percentageX,
              y: percentageY,
              "dominant-baseline": "middle",
              "text-anchor": "middle",
            },
            `${Math.round(percent * 100)}%`,
          ),
        ),
      );
    }
  }

  legendRows.push(
    tr(
      {},
      td({}),
      td({ colspan: 2 }, "Total"),
      td({ class: "text-right tabular-nums" }, total),
    ),
  );

  const isLoading = slices.some((s) => s.loading);

  const content = div(
    { style: isLoading ? "opacity:0.6" : undefined },
    svg(
      {
        class: "m-4",
        viewBox: "-102 -102 204 204",
        width: "204px",
        height: "204px",
        xmlns: "http://www.w3.org/2000/svg",
      },
      ...paths,
      ...links,
    ),
    table({ class: "mt-8 text-sm" }, ...legendRows),
  );

  if (!isLoading) return content;

  const spinner = div({
    style:
      "width:48px;height:48px;background-size:100% 100%;background-repeat:no-repeat;" +
      'background-image:url("data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIiBwcmVzZXJ2ZUFzcGVjdFJhdGlvPSJ4TWlkWU1pZCI+PHBhdGggZD0iTTEwIDUwYTQwIDQwIDAgMDA4MCAwIDQwIDQyIDAgMDEtODAgMCIgZmlsbD0iI2IxMmQ1YyIgLz48L3N2Zz4=")',
  });
  const anim = spinner.animate(
    [{ transform: "rotate(0deg)" }, { transform: "rotate(360deg)" }],
    { duration: 1000, iterations: Infinity },
  );
  anim.currentTime = Date.now() % 1000;

  return div(
    { style: "position:relative" },
    content,
    div(
      {
        style:
          "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none",
      },
      spinner,
    ),
  );
}
