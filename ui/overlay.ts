import m, { Children } from "mithril";
import { dialog, dialogOverlay, icon } from "./tailwind-utility-components.ts";

type OverlayCallback = () => Children;
type CloseCallback = () => boolean;

let overlayCallback: OverlayCallback = null;
let closeCallback: CloseCallback = null;

export function open(
  callback: OverlayCallback,
  closeCb: CloseCallback = null,
): void {
  overlayCallback = callback;
  closeCallback = closeCb;
}

export function close(callback: OverlayCallback, force = true): boolean {
  if (callback === overlayCallback) {
    if (!force && closeCallback && !closeCallback()) return false;
    overlayCallback = null;
    closeCallback = null;
    return true;
  }

  return false;
}

export function render(): Children {
  if (overlayCallback) {
    return m(
      dialog,
      {
        as: "div",
        class: "fixed z-10 inset-0 overflow-y-auto",
        onClose: () => close(overlayCallback, false),
      },
      m("div.flex items-center justify-center min-h-screen p-4 text-center", [
        m(dialogOverlay, {
          class: "fixed inset-0 bg-black/50",
        }),
        m(
          "div.relative z-10 bg-white rounded-lg px-4 pt-5 pb-4 text-left overflow-hidden shadow-xl transform max-w-full",
          m(
            "div.block absolute top-0 right-0 pt-4 pr-4",
            m(
              "button.bg-white rounded-md text-stone-400 hover:text-stone-500 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-cyan-500",
              {
                type: "button",
                onclick: () => close(overlayCallback, false),
              },
              m("span.sr-only", "Close"),
              m(icon, { name: "close", class: "h-6 w-6" }),
            ),
          ),
          overlayCallback(),
        ),
      ]),
    );
  }

  return null;
}

document.addEventListener("keydown", (e) => {
  if (overlayCallback && e.key === "Escape" && close(overlayCallback, false))
    m.redraw();
});

window.addEventListener("popstate", () => {
  if (close(overlayCallback, false)) m.redraw();
});
