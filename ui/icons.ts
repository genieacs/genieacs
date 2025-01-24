import m, { Children } from "mithril";
import { ICONS_SVG } from "../build/assets.ts";

export function getIcon(name: string): Children {
  return m(
    `svg.icon.icon-${name}`,
    { key: `icon-${name}` },
    m("use", { href: `${ICONS_SVG}#icon-${name}` }),
  );
}
