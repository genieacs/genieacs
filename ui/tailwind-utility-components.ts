import m, {
  ChildArrayOrPrimitive,
  ClosureComponent,
  mount,
  Vnode,
  VnodeDOM,
} from "mithril";
import { ICONS_SVG } from "../build/assets.ts";

export const portal: ClosureComponent<void> = () => {
  let rootElement: HTMLElement;
  let children: ChildArrayOrPrimitive;

  return {
    oncreate: (vnode) => {
      children = vnode.children;
      rootElement = document.createElement("div");
      document.body.appendChild(rootElement);
      mount(rootElement, { view: () => children });
    },

    onupdate: (vnode) => {
      children = vnode.children;
    },

    onremove: () => {
      if (document.body.contains(rootElement)) {
        mount(rootElement, null);
        document.body.removeChild(rootElement);
      }
    },

    view: () => {
      return null;
    },
  };
};

interface DialogAttrs {
  onClose?: () => void;
  as: string;
  class?: string;
}

export const dialog: ClosureComponent<DialogAttrs> = () => {
  return {
    view(vnode) {
      return m(
        portal,
        m(
          vnode.attrs.as,
          { class: vnode.attrs.class, role: "dialog", "aria-modal": "true" },
          vnode.children,
        ),
      );
    },
  };
};

interface DialogOverlayAttrs {
  class?: string;
}

export const dialogOverlay: ClosureComponent<DialogOverlayAttrs> = () => {
  return {
    view(vnode) {
      return m(
        "div",
        { class: vnode.attrs.class, "aria-hidden": "true" },
        vnode.children,
      );
    },
  };
};

let transitionShow = false;
let transitionTimeout = 0;

interface TransitionRootAttrs {
  show: boolean;
  duration: number;
}

export const transitionRoot: ClosureComponent<TransitionRootAttrs> = (
  initialVnode,
) => {
  let show = initialVnode.attrs.show;
  let transitionTimestamp = 0;
  let timeout: ReturnType<typeof setTimeout>;

  return {
    view(vnode: Vnode<TransitionRootAttrs>) {
      if (show !== vnode.attrs.show) {
        const now = Date.now();
        transitionTimestamp = now;
        show = vnode.attrs.show;
        clearTimeout(timeout);
        timeout = setTimeout(() => m.redraw(), vnode.attrs.duration);
      }

      transitionShow = show;
      transitionTimeout = Math.max(
        0,
        vnode.attrs.duration - (Date.now() - transitionTimestamp),
      );

      if (!transitionShow && !transitionTimeout) return null;

      return vnode.children;
    },
  };
};

interface TransitionChildAttrs {
  enter: string;
  enterFrom: string;
  enterTo: string;
  leave: string;
  leaveFrom: string;
  leaveTo: string;
}

export const transitionChild: ClosureComponent<TransitionChildAttrs> = () => {
  let show: boolean;
  let timeout: number;
  let firstFrame: boolean;

  function updateCssClasses(vnode: VnodeDOM<TransitionChildAttrs>): void {
    const dom = vnode.dom as HTMLElement;
    const enter = vnode.attrs.enter.split(" ");
    const enterFrom = vnode.attrs.enterFrom.split(" ");
    const enterTo = vnode.attrs.enterTo.split(" ");
    const leave = vnode.attrs.leave.split(" ");
    const leaveFrom = vnode.attrs.leaveFrom.split(" ");
    const leaveTo = vnode.attrs.leaveTo.split(" ");

    if (show) {
      dom.classList.remove(...leave, ...leaveFrom, ...leaveTo);
      if (firstFrame) {
        dom.classList.add(...enterFrom);
        void dom.getBoundingClientRect();
        dom.classList.remove(...enterFrom);
      }
      if (timeout) dom.classList.add(...enter);
      else dom.classList.remove(...enter);
      dom.classList.add(...enterTo);
    } else {
      dom.classList.remove(...enter, ...enterFrom, ...enterTo);
      if (firstFrame) {
        dom.classList.add(...leaveFrom);
        void dom.getBoundingClientRect();
        dom.classList.remove(...leaveFrom);
      }
      if (timeout) dom.classList.add(...leave);
      else dom.classList.remove(...leave);
      dom.classList.add(...leaveTo);
    }
  }

  return {
    view(vnode: Vnode<TransitionChildAttrs>) {
      firstFrame = show !== transitionShow;
      show = transitionShow;
      timeout = transitionTimeout;
      return vnode.children;
    },

    oncreate(vnode: VnodeDOM<TransitionChildAttrs>) {
      updateCssClasses(vnode);
    },

    onupdate(vnode: VnodeDOM<TransitionChildAttrs>) {
      updateCssClasses(vnode);
    },
  };
};

interface IconAttrs {
  name: string;
  class?: string;
}

export const icon: ClosureComponent<IconAttrs> = () => {
  return {
    view(vnode) {
      return m(
        `svg`,
        {
          xmlns: "http://www.w3.org/2000/svg",
          fill: "none",
          stroke: "currentColor",
          "stroke-width": "2",
          class: vnode.attrs.class,
          "aria-hidden": "true",
        },
        m("use", { href: `${ICONS_SVG}#icon-${vnode.attrs.name}` }),
      );
    },
  };
};
