"use strict";

import m from "mithril";

let overlayCallback = null;

function open(callback) {
  overlayCallback = callback;
}

function close(callback) {
  if (callback === overlayCallback) {
    overlayCallback = null;
    return true;
  }

  return false;
}

function render() {
  if (overlayCallback)
    return m(
      ".overlay-wrapper",
      {
        tabindex: 0,
        onclick: () => {
          close(overlayCallback);
        },
        style: "opacity: 0",
        oncreate: vnode => {
          vnode.dom.focus();
          vnode.dom.style.opacity = 1;
        },
        onbeforeremove: vnode => {
          vnode.dom.style.opacity = 0;
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

  return null;
}

document.addEventListener("keydown", e => {
  if (e.keyCode === 27 && close(overlayCallback)) m.redraw();
});

export { open, close, render };
