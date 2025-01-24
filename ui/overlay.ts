import m, { Children } from "mithril";

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
      ".overlay-wrapper",
      {
        tabindex: 0,
        onclick: () => {
          close(overlayCallback, false);
        },
        style: "opacity: 0",
        oncreate: (vnode) => {
          (vnode.dom as HTMLDivElement).focus();
          (vnode.dom as HTMLDivElement).style.opacity = "1";
        },
        onbeforeremove: (vnode) => {
          (vnode.dom as HTMLDivElement).style.opacity = "0";
          return new Promise<void>((resolve) => {
            setTimeout(() => {
              resolve();
            }, 500);
          });
        },
      },
      m(
        ".overlay",
        {
          onclick: (e) => {
            e.stopPropagation();
          },
        },
        overlayCallback(),
      ),
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
