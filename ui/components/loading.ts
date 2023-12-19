import { VnodeDOM, ClosureComponent, Component } from "mithril";

const component: ClosureComponent = (): Component => {
  let overlay: HTMLElement;
  let dom: Element;
  let loading = false;

  function apply(vnode: VnodeDOM): void {
    if (!loading) {
      if (overlay) overlay.parentElement.remove();
      if (dom) dom.classList.remove("loading");
      overlay = null;
      dom = null;
      return;
    }

    if (dom && dom !== vnode.dom) dom.classList.remove("loading");

    dom = vnode.dom;
    dom.classList.add("loading");

    if (!overlay) {
      const wrapper = document.createElement("div");
      wrapper.style.position = "relative";
      wrapper.style.pointerEvents = "none";
      overlay = document.createElement("div");
      overlay.classList.add("loading-overlay");
      overlay.style.position = "absolute";
      wrapper.appendChild(overlay);
    }

    const wrapper = overlay.parentElement;
    if (wrapper.parentElement !== dom.parentElement)
      dom.parentNode.appendChild(wrapper);

    const wrapperRect = wrapper.getBoundingClientRect();
    const domRect = dom.getBoundingClientRect();
    overlay.style.width = `${dom.scrollWidth}px`;
    overlay.style.height = `${dom.scrollHeight}px`;
    overlay.style.left = `${domRect.left - wrapperRect.left}px`;
    overlay.style.top = `${domRect.top - wrapperRect.top}px`;
  }

  return {
    view: (vnode) => {
      const queries = vnode.attrs["queries"];
      loading = queries.some((q) => q.fulfilling);
      return vnode.children;
    },
    oncreate: apply,
    onupdate: apply,
    onremove: () => {
      if (overlay) overlay.parentElement.remove();
      if (dom) dom.classList.remove("loading");
      overlay = null;
      dom = null;
    },
  };
};

export default component;
