type AutocompleteCallback = (
  value: string,
  callback: (suggestions: { value: string; tip?: string }[]) => void,
) => void;

export default class Autocomplete {
  declare private callback: AutocompleteCallback;
  declare private element: HTMLInputElement;
  declare private hideTimeout: NodeJS.Timeout;
  declare private visible: boolean;
  declare private default: string;
  declare private selection: number;
  declare private container: HTMLElement;

  public constructor(callback: AutocompleteCallback) {
    this.callback = callback;
    this.element = null;
    this.hideTimeout = null;
    this.visible = false;
    this.default = null;
    this.selection = null;

    this.container = document.createElement("div");
    this.container.style.position = "absolute";
    this.container.style.display = "block";
    this.container.style.opacity = "0";
    this.container.className =
      "absolute py-1 mt-2 rounded-md shadow-lg bg-white";
  }

  public attach(el: HTMLInputElement): void {
    el.setAttribute("autocomplete", "off");

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
        --this.selection;
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
    clearTimeout(this.hideTimeout);
    this.hideTimeout = setTimeout(() => {
      this.hideTimeout = null;
      while (this.container.firstChild)
        this.container.removeChild(this.container.firstChild);
      document.body.removeChild(this.container);
    }, 500);
  }

  private update(): void {
    const el = this.element;

    this.callback(el.value, (suggestions) => {
      if (this.element !== el) return;
      this.default = null;

      if (!suggestions.length) {
        if (this.visible) this.hide();

        return;
      }

      while (this.container.firstChild)
        this.container.removeChild(this.container.firstChild);

      if (!this.visible) {
        if (!this.hideTimeout) {
          document.body.appendChild(this.container);
          // Force style recalc so the initial opacity is resolved before
          // setting it to "1", allowing the CSS transition to play.
          void window.getComputedStyle(this.container).opacity;
        } else {
          clearTimeout(this.hideTimeout);
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

      let selectedElement;
      for (const [idx, suggestion] of suggestions.entries()) {
        const e = document.createElement("div");
        if (suggestion.tip) e.title = suggestion.tip;
        e.className =
          "text-stone-700 block px-4 py-2 text-sm hover:bg-stone-100 hover:text-stone-900";
        if (idx === this.selection) {
          e.classList.add("bg-stone-100", "text-stone-900");
          selectedElement = e;
        }

        const t = document.createTextNode(suggestion.value);
        e.appendChild(t);
        e.addEventListener("mousedown", (ev) => {
          ev.preventDefault();
          el.value = suggestion.value;
          el.dispatchEvent(new InputEvent("input"));
          if (this.element === el) this.update();
        });
        this.container.appendChild(e);
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
