import * as overlay from "./overlay.ts";
import { textarea, span } from "./dom.ts";

interface LongTextAttrs {
  text: string;
  class?: string;
}

export function createLongText(attrs: LongTextAttrs): HTMLSpanElement {
  const text = attrs.text || "";
  const className = attrs.class || "";

  const el = span(
    {
      class: "block truncate decoration-dotted max-w-full " + className,
      onMount: () => {
        const w = Math.round(el.getBoundingClientRect().width);
        if (w !== el.scrollWidth) {
          el.title = text;
          el.className += " cursor-pointer hover:underline";
          el.onclick = (e) => {
            overlay.open(() => {
              const ta = textarea({
                class:
                  "font-mono text-sm focus:ring-cyan-500 focus:border-cyan-500 border border-stone-300 rounded-md",
                value: text,
                cols: 80,
                rows: 24,
                readonly: true,
              });
              setTimeout(() => ta.focus(), 0);
              return ta;
            });
            e.stopPropagation();
          };
        }
      },
    },
    text,
  );

  return el;
}
