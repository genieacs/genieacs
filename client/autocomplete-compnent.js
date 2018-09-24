"use strict";

class Autocomplete {
  constructor(className, callback) {
    this.callback = callback;
    this.element = null;
    this.hideTimeout = null;
    this.visible = false;
    this.default = null;

    this.container = document.createElement("div");
    this.container.style.position = "absolute";
    this.container.style.display = "block";
    this.container.style.opacity = 0;
    this.container.className = className;
  }

  attach(el) {
    el.setAttribute("autocomplete", "off");

    el.addEventListener("focus", () => {
      this.element = el;
      let domRect = el.getBoundingClientRect();
      this.container.style.left = `${domRect.left}px`;
      this.container.style.width = `${domRect.width}px`;
      this.container.style.top = `${domRect.bottom}px`;
      this.update();
    });

    el.addEventListener("blur", () => {
      if (this.element !== el) return;
      if (!this.visible) return;
      this.default = null;
      this.hide();
    });

    el.addEventListener("keydown", e => {
      if (this.element !== el) return;
      if (e.key === "Escape") this.hide();
      else if (e.key === "Enter")
        if (this.default != null) {
          el.value = this.default;
          e.preventDefault();
          this.update();
        }
    });

    el.addEventListener("input", () => {
      if (this.element !== el) return;
      this.update();
    });
  }

  hide() {
    this.container.style.opacity = 0;
    this.visible = false;
    this.default = null;
    clearTimeout(this.hideTimeout);
    this.hideTimeout = setTimeout(() => {
      this.hideTimeout = null;
      while (this.container.firstChild)
        this.container.removeChild(this.container.firstChild);
      document.body.removeChild(this.container);
    }, 500);
  }

  update() {
    const el = this.element;

    this.callback(el.value, suggestions => {
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
          window.getComputedStyle(this.container).opacity;
        } else {
          clearTimeout(this.hideTimeout);
          this.hideTimeout = null;
        }
        this.container.style.opacity = 1;
        this.visible = true;
      }

      this.default = suggestions[0];

      for (let suggestion of suggestions) {
        let e = document.createElement("div");
        e.className = "suggestion";
        let t = document.createTextNode(suggestion);
        e.appendChild(t);
        e.addEventListener("mousedown", ev => {
          ev.preventDefault();
          el.value = suggestion;
          if (this.element === el) this.update(el);
        });
        this.container.appendChild(e);
      }
    });
  }
}

export default Autocomplete;
