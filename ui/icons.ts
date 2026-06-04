// createIcon: DOM-based, used by new components.
// icon: Mithril wrapper, used by legacy components in ui/components/*.ts.
import { svg, svgUse } from "./dom.ts";
import m, { ClosureComponent } from "./mithril-compat.ts";
import { ICONS_SVG } from "../build/assets.ts";

export interface IconAttrs {
  name: string;
  class?: string;
}

export function createIcon(attrs: IconAttrs): SVGSVGElement {
  return svg(
    {
      xmlns: "http://www.w3.org/2000/svg",
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "2",
      class: attrs.class,
      "aria-hidden": "true",
    },
    svgUse({ href: `/${ICONS_SVG}#icon-${attrs.name}` }),
  );
}

export const icon: ClosureComponent<IconAttrs> = () => {
  return {
    view(vnode) {
      return m(
        `svg`,
        {
          xmlns: "http://www.w3.org/2000/svg",
          fill: "none",
          stroke: "currentColor",
          "stroke-width": "2",
          class: vnode.attrs.class,
          "aria-hidden": "true",
        },
        m("use", { href: `/${ICONS_SVG}#icon-${vnode.attrs.name}` }),
      );
    },
  };
};
