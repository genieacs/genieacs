import m, { Children } from "mithril";

type OverlayCallback = () => Children;

let overlayCallback: OverlayCallback = null;

export function open(callback: OverlayCallback): void {
  overlayCallback = callback;
}

export function close(callback: OverlayCallback): boolean {
  if (callback === overlayCallback) {
    overlayCallback = null;
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
          close(overlayCallback);
        },
        style: "opacity: 0",
        oncreate: vnode => {
          (vnode.dom as HTMLDivElement).focus();
          (vnode.dom as HTMLDivElement).style.opacity = "1";
        },
        onbeforeremove: vnode => {
          (vnode.dom as HTMLDivElement).style.opacity = "0";
          return new Promise(resolve => {
            setTimeout(() => {
              resolve();
            }, 500);
          });
        }
      },
      m(
        ".overlay",
        {
          onclick: e => {
            e.stopPropagation();
          }
        },
        overlayCallback()
      )
    );
  }

  return null;
}

document.addEventListener("keydown", e => {
  if (overlayCallback && e.keyCode === 27 && close(overlayCallback)) m.redraw();
});

window.addEventListener("popstate", () => {
  if (close(overlayCallback)) m.redraw();
});
