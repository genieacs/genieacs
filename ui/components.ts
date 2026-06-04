import m, {
  Static,
  Attributes,
  Children,
  ComponentTypes,
  CommonAttributes,
  ClosureComponent,
  Vnode,
} from "./mithril-compat.ts";
import parameter from "./components/parameter.ts";
import parameterList from "./components/parameter-list.ts";
import parameterTable from "./components/parameter-table.ts";
import overviewDot from "./components/overview-dot.ts";
import container from "./components/container.ts";
import summonButton from "./components/summon-button.ts";
import deviceFaults from "./components/device-faults.ts";
import allParameters from "./components/all-parameters.ts";
import deviceActions from "./components/device-actions.ts";
import tags from "./components/tags.ts";
import ping from "./components/ping.ts";
import deviceLink from "./components/device-link.ts";
import longTextComponent from "./components/long-text-component.ts";
import loading from "./components/loading.ts";

const comps: Record<string, ComponentTypes<any>> = {
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
  "long-text": longTextComponent,
  loading: loading,
};

const contextifiedComponents = new WeakMap<ComponentTypes, ComponentTypes>();
// Store context directly on vnode as a property so it survives object spreading
// in mithril-compat.ts when creating vnodeForView
const CONTEXT_KEY = Symbol("vnodeContext");

interface MC extends Static {
  context: {
    (
      ctx: Attributes,
      selector: string,
      ...children: Children[]
    ): Vnode<any, any>;
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
      attributes: Attrs & CommonAttributes<Attrs, State>,
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
  },
}) as MC;

function contextFn(context: Attributes, ...argumentsList: any[]): Vnode {
  const vnode = Reflect.apply(M, undefined, argumentsList);
  vnode[CONTEXT_KEY] = context;
  return vnode;
}

function applyContext(vnode: any, parentContext: Attributes): void {
  if (Array.isArray(vnode)) {
    for (const c of vnode) applyContext(c, parentContext);
  } else if (vnode && typeof vnode === "object" && vnode.tag) {
    const vc = Object.assign({}, parentContext, vnode[CONTEXT_KEY]);
    if (typeof vnode.tag !== "string") {
      vnode[CONTEXT_KEY] = vc;
      vnode.attrs = Object.assign({}, vc, vnode.attrs);
    }
    if (vnode.children?.length)
      for (const c of vnode.children) applyContext(c, vc);
  }
}

export function contextifyComponent(component: ComponentTypes): ComponentTypes {
  let c = contextifiedComponents.get(component);
  if (!c) {
    if (typeof component !== "function") {
      c = Object.assign({}, component);
      const view = component.view;
      c.view = function (vnode) {
        const context = (vnode as any)[CONTEXT_KEY] || {};
        // Merge context into attrs so the component can access it
        vnode.attrs = Object.assign({}, context, vnode.attrs);
        const res = Reflect.apply(view, this, [vnode]);
        applyContext(res, context);
        return res;
      };
    } else if (!component.prototype?.view) {
      c = (initialNode) => {
        const state = (component as ClosureComponent)(initialNode);
        const view = state.view;
        state.view = function (vnode) {
          const context = (vnode as any)[CONTEXT_KEY] || {};
          // Merge context into attrs so the component can access it
          vnode.attrs = Object.assign({}, context, vnode.attrs);
          try {
            const res = Reflect.apply(view, this, [vnode]);
            applyContext(res, context);
            return res;
          } catch (err) {
            return m(
              "p.text-sm font-bold text-red-500 cursor-pointer",
              {
                title: "Click to print stack trace to console",
                onclick: () => console.error(err),
              },
              "Error!",
            );
          }
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
