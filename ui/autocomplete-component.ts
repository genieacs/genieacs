import { div, disposeElement } from "./dom.ts";

type AutocompleteCallback = (
  value: string,
  callback: (suggestions: { value: string; tip?: string }[]) => void,
) => void;

export default class Autocomplete {
  declare private callback: AutocompleteCallback;
  declare private element: HTMLInputElement | null;
  declare private hideTimeout: NodeJS.Timeout | null;
  declare private visible: boolean;
  declare private default: string | null;
  declare private selection: number | null;
  declare private container: HTMLElement;

  public constructor(callback: AutocompleteCallback) {
    this.callback = callback;
    this.element = null;
    this.hideTimeout = null;
    this.visible = false;
    this.default = null;
    this.selection = null;

    this.container = div({
      class: "absolute py-1 mt-2 rounded-md shadow-lg bg-white",
      style: "position:absolute;display:block;opacity:0",
    });
  }

  public attach(el: HTMLInputElement): void {
    el.autocomplete = "off";

    el.addEventListener("focus", () => {
      this.element = el;
      this.update();
      this.reposition();
    });

    el.addEventListener("blur", () => {
      if (this.element !== el) return;
      if (!this.visible) return;
      this.hide();
    });

    el.addEventListener("keydown", (e) => {
      if (this.element !== el) return;
      if (e.key === "Escape") {
        if (this.visible) this.hide();
      } else if (e.key === "Enter") {
        if (this.default != null) {
          el.value = this.default;
          e.stopImmediatePropagation();
          el.dispatchEvent(new InputEvent("input"));
          this.update();
        }
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        if (this.selection == null) this.selection = 0;
        else ++this.selection;
        this.update();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (this.selection == null) this.selection = -1;
        else --this.selection;
        this.update();
      }
    });

    el.addEventListener("input", () => {
      if (this.element !== el) return;
      this.selection = null;
      this.update();
    });
  }

  public reposition(): void {
    if (!this.element) return;
    const domRect = this.element.getBoundingClientRect();
    if (!domRect.width) {
      // Element has been removed
      if (this.visible) this.hide();
      return;
    }
    this.container.style.left = `${domRect.left + window.scrollX}px`;
    this.container.style.width = `${domRect.width}px`;
    this.container.style.top = `${domRect.bottom + window.scrollY}px`;
  }

  private hide(): void {
    this.container.style.opacity = "0";
    this.visible = false;
    this.default = null;
    this.selection = null;
    if (this.hideTimeout) clearTimeout(this.hideTimeout);
    this.hideTimeout = setTimeout(() => {
      this.hideTimeout = null;
      this.clearContainer();
      this.container.remove();
    }, 500);
  }

  private clearContainer(): void {
    for (const child of Array.from(this.container.childNodes)) {
      disposeElement(child);
      child.parentNode?.removeChild(child);
    }
  }

  private update(): void {
    const el = this.element;
    if (!el) return;

    this.callback(el.value, (suggestions) => {
      if (this.element !== el) return;
      this.default = null;

      if (!suggestions.length) {
        if (this.visible) this.hide();

        return;
      }

      this.clearContainer();

      if (!this.visible) {
        if (!this.hideTimeout) {
          document.body.append(this.container);
          // Force style recalc so the initial opacity is resolved before
          // setting it to "1", allowing the CSS transition to play.
          void window.getComputedStyle(this.container).opacity;
        } else {
          if (this.hideTimeout) clearTimeout(this.hideTimeout);
          this.hideTimeout = null;
        }
        this.container.style.opacity = "1";
        this.visible = true;
      }

      if (this.selection != null) {
        this.selection =
          ((this.selection % suggestions.length) + suggestions.length) %
          suggestions.length;
        this.default = suggestions[this.selection].value;
      } else {
        this.default = suggestions[0].value;
      }

      let selectedElement: HTMLElement | undefined;
      for (const [idx, suggestion] of suggestions.entries()) {
        const item = div(
          {
            class:
              "text-stone-700 block px-4 py-2 text-sm hover:bg-stone-100 hover:text-stone-900" +
              (idx === this.selection ? " bg-stone-100 text-stone-900" : ""),
            title: suggestion.tip || undefined,
            onmousedown: (ev) => {
              ev.preventDefault();
              el.value = suggestion.value;
              el.dispatchEvent(new InputEvent("input"));
              if (this.element === el) this.update();
            },
          },
          suggestion.value,
        );

        if (idx === this.selection) selectedElement = item;
        this.container.append(item);
      }

      // Ensure selected element is in view
      if (selectedElement) {
        this.container.scrollTop = Math.min(
          this.container.scrollTop,
          selectedElement.offsetTop,
        );

        this.container.scrollTop = Math.max(
          this.container.scrollTop,
          selectedElement.offsetTop +
            selectedElement.scrollHeight -
            this.container.clientHeight,
        );
      }
    });
  }
}
