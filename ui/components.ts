import m, {
  Static,
  Attributes,
  Children,
  ComponentTypes,
  Lifecycle,
  ClosureComponent,
  Vnode
} from "mithril";
import parameter from "./components/parameter";
import parameterList from "./components/parameter-list";
import parameterTable from "./components/parameter-table";
import overviewDot from "./components/overview-dot";
import container from "./components/container";
import summonButton from "./components/summon-button";
import deviceFaults from "./components/device-faults";
import allParameters from "./components/all-parameters";
import deviceActions from "./components/device-actions";
import tags from "./components/tags";
import ping from "./components/ping";
import deviceLink from "./components/device-link";
import longTextComponent from "./long-text-component";

const comps = {
  parameter,
  "parameter-list": parameterList,
  "parameter-table": parameterTable,
  "overview-dot": overviewDot,
  container,
  "summon-button": summonButton,
  "device-faults": deviceFaults,
  "all-parameters": allParameters,
  "device-actions": deviceActions,
  tags,
  ping,
  "device-link": deviceLink,
  "long-text": longTextComponent
};

const contextifiedComponents = new WeakMap<ComponentTypes, ComponentTypes>();
const vnodeContext = new WeakMap<Vnode, Attributes>();

interface MC extends Static {
  context: {
    (ctx: Attributes, selector: string, ...children: Children[]): Vnode<
      any,
      any
    >;
    (
      ctx: Attributes,
      selector: string,
      attributes: Attributes,
      ...children: Children[]
    ): Vnode<any, any>;
    <Attrs, State>(
      ctx: Attributes,
      component: ComponentTypes<Attrs, State>,
      ...args: Children[]
    ): Vnode<Attrs, State>;
    <Attrs, State>(
      ctx: Attributes,
      component: ComponentTypes<Attrs, State>,
      attributes: Attrs & Lifecycle<Attrs, State> & { key?: string | number },
      ...args: Children[]
    ): Vnode<Attrs, State>;
  };
}

const M = new Proxy(m, {
  apply: (target, thisArg, argumentsList) => {
    const c = argumentsList[0];
    if (typeof c !== "string") argumentsList[0] = contextifyComponent(c);
    else if (comps[c]) argumentsList[0] = contextifyComponent(comps[c]);

    return Reflect.apply(target, undefined, argumentsList);
  },
  get: (target, prop) => {
    if (prop === "context") return contextFn;
    else return Reflect.get(target, prop);
  }
}) as MC;

function contextFn(context, ...argumentsList): Vnode {
  const vnode = Reflect.apply(M, undefined, argumentsList);
  vnodeContext.set(vnode, context);
  return vnode;
}

function applyContext(vnode, parentContext): void {
  if (Array.isArray(vnode)) {
    for (const c of vnode) applyContext(c, parentContext);
  } else if (vnode && typeof vnode === "object" && vnode.tag) {
    const vc = Object.assign({}, parentContext, vnodeContext.get(vnode));
    vnodeContext.set(vnode, vc);
    vnode.attrs = Object.assign({}, vc, vnode.attrs);
    if (vnode.children && vnode.children.length)
      for (const c of vnode.children) applyContext(c, vc);
  }
}

export function contextifyComponent(component: ComponentTypes): ComponentTypes {
  let c = contextifiedComponents.get(component);
  if (!c) {
    if (typeof component !== "function") {
      c = Object.assign({}, component);
      const view = component.view;
      c.view = function(vnode) {
        const context = vnodeContext.get(vnode) || {};
        const res = Reflect.apply(view, this, [vnode]);
        applyContext(res, context);
        return res;
      };
    } else if (!component.prototype || !component.prototype.view) {
      c = initialNode => {
        const state = (component as ClosureComponent)(initialNode);
        const view = state.view;
        state.view = function(vnode) {
          const context = vnodeContext.get(vnode) || {};
          const res = Reflect.apply(view, this, [vnode]);
          applyContext(res, context);
          return res;
        };
        return state;
      };
    } else {
      // TODO support class components
      throw new Error("Class components not supported");
    }
    contextifiedComponents.set(component, c);
  }
  return c;
}

export { M as m };
