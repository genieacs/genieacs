import { div, button, span } from "./dom.ts";
import { createIcon } from "./icons.ts";
import { StateSignal, untracked } from "./signals.ts";

type OverlayCallback = () => Node | Node[];

// Called before closing to confirm (return false to prevent close)
type CloseCallback = () => boolean;

interface OverlayState {
  callback: OverlayCallback;
  closeCallback: CloseCallback | null;
}

const state = new StateSignal<OverlayState | null>(null);

export function open(
  callback: OverlayCallback,
  closeCb: CloseCallback | null = null,
): void {
  state.set({ callback, closeCallback: closeCb });
}

export function close(callback: OverlayCallback, force = true): boolean {
  const current = state.get();
  if (current?.callback === callback) {
    if (!force && current.closeCallback && !current.closeCallback())
      return false;
    state.set(null);
    return true;
  }
  return false;
}

function handleClose(): void {
  const current = state.get();
  if (current) close(current.callback, false);
}

export function render(): Node | null {
  const current = state.get();
  if (!current) return null;

  // render() runs inside a reactive child (app.ts), so its computation must
  // depend only on `state` — the callback is builder code that runs once per
  // open. Untracked so signals it reads while building don't become
  // dependencies of the overlay subtree; otherwise any such signal changing
  // while the overlay is open would tear down and rebuild the whole overlay,
  // discarding in-progress user edits. Reactive children embedded in the
  // built DOM still update on their own.
  const content = untracked(() => current.callback());
  const contentArray = Array.isArray(content) ? content : [content];

  return div(
    {
      class: "fixed z-50 inset-0 overflow-y-auto",
      role: "dialog",
      "aria-modal": "true",
    },
    div(
      {
        class: "flex items-center justify-center min-h-screen p-4 text-center",
      },
      div({
        class: "fixed inset-0 bg-black/50",
        "aria-hidden": "true",
      }),
      div(
        {
          class:
            "relative z-10 bg-white rounded-lg px-4 pt-5 pb-4 text-left overflow-hidden shadow-xl transform max-w-full",
        },
        div(
          { class: "block absolute top-0 right-0 pt-4 pr-4" },
          button(
            {
              type: "button",
              class:
                "bg-white rounded-md text-stone-400 hover:text-stone-500 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-cyan-500",
              onclick: handleClose,
            },
            span({ class: "sr-only" }, "Close"),
            createIcon({ name: "close", class: "h-6 w-6" }),
          ),
        ),
        ...contentArray,
      ),
    ),
  );
}

document.addEventListener("keydown", (e) => {
  if (state.get() && e.key === "Escape") handleClose();
});

window.addEventListener("popstate", () => {
  const current = state.get();
  if (current) close(current.callback, false);
});
