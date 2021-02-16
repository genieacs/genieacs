/**
 * Copyright 2013-2021  GenieACS Inc.
 *
 * This file is part of GenieACS.
 *
 * GenieACS is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * GenieACS is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with GenieACS.  If not, see <http://www.gnu.org/licenses/>.
 */

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
