import { p, div } from "./dom.ts";

interface Attrs {
  error: string;
}

export function createPage(attrs: Attrs): HTMLElement {
  document.title = "Error! - GenieACS";
  return div({}, p({ class: "text-sm font-bold text-red-500" }, attrs.error));
}
