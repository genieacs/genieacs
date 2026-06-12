// Mithril.js emulation layer — renders directly to real DOM elements so
// existing Mithril components work with minimal or no changes.

import { disposeElement, div } from "./dom.ts";
import { ComputedSignal, Watcher } from "./signals.ts";

// Types

export type Attributes = Record<string, any>;

export interface CommonAttributes<Attrs, State> {
  key?: string | number;
  oncreate?: (vnode: VnodeDOM<Attrs, State>) => void;
  onupdate?: (vnode: VnodeDOM<Attrs, State>) => void;
  onremove?: (vnode: VnodeDOM<Attrs, State>) => void;
}

export interface Vnode<Attrs = any, State = any> {
  tag: string | ComponentTypes<Attrs, State>;
  attrs: Attrs & CommonAttributes<Attrs, State>;
  children: Children;
  key?: string | number;
  state?: State;
}

export interface VnodeDOM<Attrs = any, State = any> extends Vnode<
  Attrs,
  State
> {
  dom: HTMLElement | null;
  domSize?: number;
}

export type Child =
  | Vnode
  | string
  | number
  | boolean
  | null
  | undefined
  | Child[];
export type Children = Child | Child[];

export interface Component<Attrs = any, State = any> {
  oninit?: (vnode: Vnode<Attrs, State>) => void;
  oncreate?: (vnode: VnodeDOM<Attrs, State>) => void;
  onupdate?: (vnode: VnodeDOM<Attrs, State>) => void;
  onremove?: (vnode: VnodeDOM<Attrs, State>) => void;
  view: (vnode: Vnode<Attrs, State>) => Children;
  [key: string]: any;
}

export type ClosureComponent<Attrs = any, State = any> = (
  vnode: Vnode<Attrs, State>,
) => Component<Attrs, State>;

export type ComponentTypes<Attrs = any, State = any> =
  | Component<Attrs, State>
  | ClosureComponent<Attrs, State>;

// Static interface - represents the m() function with all its methods
export interface Static {
  (selector: string, ...children: Children[]): Vnode;
  (selector: string, attributes: Attributes, ...children: Children[]): Vnode;
  <Attrs, State>(
    component: ComponentTypes<Attrs, State>,
    ...args: Children[]
  ): Vnode<Attrs, State>;
  <Attrs, State>(
    component: ComponentTypes<Attrs, State>,
    attributes: Attrs & CommonAttributes<Attrs, State>,
    ...args: Children[]
  ): Vnode<Attrs, State>;

  redraw(): void;
  mount(element: Element, component: ComponentTypes | null): void;
}

// Selector Parsing

interface ParsedSelector {
  tag: string;
  id?: string;
  classes: string[];
}

const selectorCache = new Map<string, ParsedSelector>();

function parseSelector(selector: string): ParsedSelector {
  const cached = selectorCache.get(selector);
  if (cached) return cached;

  const result: ParsedSelector = { tag: "div", classes: [] };

  let i = 0;
  const len = selector.length;

  // Parse tag name
  if (i < len && /[a-zA-Z]/.test(selector[i])) {
    const start = i;
    while (i < len && /[a-zA-Z0-9-]/.test(selector[i])) i++;
    result.tag = selector.slice(start, i);
  }

  // Parse classes and id
  // Supports both ".class1.class2" and ".class1 class2 class3" syntax
  let inClassMode = false;
  while (i < len) {
    const char = selector[i];
    if (char === ".") {
      inClassMode = true;
      i++;
      const start = i;
      while (i < len && /[a-zA-Z0-9_:/-]/.test(selector[i])) i++;
      if (i > start) result.classes.push(selector.slice(start, i));
    } else if (char === "#") {
      inClassMode = false;
      i++;
      const start = i;
      while (i < len && /[a-zA-Z0-9_-]/.test(selector[i])) i++;
      if (i > start) result.id = selector.slice(start, i);
    } else if (char === " " && inClassMode) {
      // Skip spaces
      while (i < len && selector[i] === " ") i++;
      // If next char is not . or #, treat following word as a class
      if (i < len && selector[i] !== "." && selector[i] !== "#") {
        const start = i;
        while (i < len && /[a-zA-Z0-9_:/-]/.test(selector[i])) i++;
        if (i > start) result.classes.push(selector.slice(start, i));
      }
    } else {
      i++;
    }
  }

  selectorCache.set(selector, result);
  return result;
}

// Hyperscript Function

type HyperscriptResult = Vnode | null;

function m(selector: string, ...args: any[]): HyperscriptResult;
function m<Attrs, State>(
  component: ComponentTypes<Attrs, State>,
  ...args: any[]
): HyperscriptResult;
function m(selectorOrComponent: any, ...args: any[]): HyperscriptResult {
  let attrs: Attributes = {};
  const children: Child[] = [];

  // Parse arguments: [attrs?, ...children]
  let argIndex = 0;
  if (
    args.length > 0 &&
    args[0] != null &&
    typeof args[0] === "object" &&
    !Array.isArray(args[0]) &&
    !(args[0] as any).tag
  ) {
    attrs = args[0];
    argIndex = 1;
  }

  // Rest are children
  for (let i = argIndex; i < args.length; i++) {
    const arg = args[i];
    if (Array.isArray(arg)) {
      children.push(...arg);
    } else {
      children.push(arg);
    }
  }

  // Handle string selectors
  if (typeof selectorOrComponent === "string") {
    const parsed = parseSelector(selectorOrComponent);
    const mergedAttrs = { ...attrs };

    if (parsed.id && !mergedAttrs.id) {
      mergedAttrs.id = parsed.id;
    }

    if (parsed.classes.length > 0) {
      const existingClass = mergedAttrs.class || mergedAttrs.className || "";
      const allClasses = [...parsed.classes];
      if (existingClass) {
        allClasses.push(
          ...(typeof existingClass === "string"
            ? existingClass.split(/\s+/)
            : []),
        );
      }
      mergedAttrs.class = allClasses.join(" ");
      delete mergedAttrs.className;
    }

    return {
      tag: parsed.tag,
      attrs: mergedAttrs,
      children,
      key: mergedAttrs.key,
    };
  }

  // Handle component
  return {
    tag: selectorOrComponent,
    attrs,
    children,
    key: attrs.key,
  };
}

// Rendering Engine

// Namespace URIs
const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";
const XML_NS = "http://www.w3.org/XML/1998/namespace";

const ATTR_NAMESPACES: Record<string, string> = {
  xlink: XLINK_NS,
  xml: XML_NS,
};

// SVG tags used in the codebase. The namespace flag propagates from <svg>
// to descendants during render, but components can also be passed an SVG
// child tag directly (e.g. a closure that returns <circle>) without an
// outer <svg> in scope — this set ensures those create with SVG namespace.
const SVG_ELEMENTS = new Set(["svg", "use", "circle"]);

// Pending lifecycle callbacks, flushed after each render
let pendingOnCreate: (() => void)[] = [];
let pendingOnUpdate: (() => void)[] = [];
let pendingOnRemove: (() => void)[] = [];

function createElement(tag: string, isSvg: boolean): Element {
  if (isSvg || SVG_ELEMENTS.has(tag)) {
    return document.createElementNS(SVG_NS, tag);
  }
  return document.createElement(tag);
}

function setAttribute(element: Element, name: string, value: any): void {
  // Handle special cases
  if (name === "key" || name === "children") return;

  // Event handlers
  if (name.startsWith("on") && typeof value === "function") {
    const eventName = name.slice(2).toLowerCase();
    (element as any)[`__handler_${eventName}`] = value;
    if (!(element as any)[`__listener_${eventName}`]) {
      (element as any)[`__listener_${eventName}`] = true;
      element.addEventListener(eventName, (e) => {
        const handler = (element as any)[`__handler_${eventName}`];
        if (handler) {
          const result = handler.call(element, e);
          // Mithril convention: returning false prevents default and stops propagation
          if (result === false) {
            e.preventDefault();
            e.stopPropagation();
          }
          return result;
        }
      });
    }
    return;
  }

  // Class handling
  if (name === "class" || name === "className") {
    // SVG elements have className as a read-only SVGAnimatedString
    if (element instanceof SVGElement) {
      element.setAttribute("class", String(value ?? ""));
    } else {
      (element as HTMLElement).className = String(value ?? "");
    }
    return;
  }

  // Input value/checked - must be set as properties, not attributes
  if (name === "value" && element instanceof HTMLInputElement) {
    if (element.value !== String(value ?? "")) {
      element.value = String(value ?? "");
    }
    return;
  }
  if (name === "checked" && element instanceof HTMLInputElement) {
    element.checked = !!value;
    return;
  }
  if (name === "value" && element instanceof HTMLTextAreaElement) {
    if (element.value !== String(value ?? "")) {
      element.value = String(value ?? "");
    }
    return;
  }
  if (name === "value" && element instanceof HTMLSelectElement) {
    if (element.value !== String(value ?? "")) {
      element.value = String(value ?? "");
    }
    return;
  }

  // Style handling
  if (name === "style") {
    if (typeof value === "object" && value !== null) {
      const style = (element as HTMLElement).style;
      for (const [k, v] of Object.entries(value)) {
        style.setProperty(k, String(v));
      }
    } else if (typeof value === "string") {
      (element as HTMLElement).style.cssText = value;
    }
    return;
  }

  // Namespaced attributes (xlink:href, xml:lang, etc.)
  const colonIndex = name.indexOf(":");
  if (colonIndex > 0) {
    const prefix = name.slice(0, colonIndex);
    const localName = name.slice(colonIndex + 1);
    const ns = ATTR_NAMESPACES[prefix];
    if (ns) {
      if (value == null) {
        element.removeAttributeNS(ns, localName);
      } else {
        element.setAttributeNS(ns, localName, String(value));
      }
      return;
    }
  }

  // Boolean attributes
  if (typeof value === "boolean") {
    if (value) {
      element.setAttribute(name, "");
    } else {
      element.removeAttribute(name);
    }
    return;
  }

  // Regular attributes
  if (value == null) {
    element.removeAttribute(name);
  } else {
    element.setAttribute(name, String(value));
  }
}

function updateAttributes(
  element: Element,
  oldAttrs: Attributes,
  newAttrs: Attributes,
): void {
  // Remove old attributes not in new
  for (const name of Object.keys(oldAttrs)) {
    if (!(name in newAttrs)) {
      if (name.startsWith("on")) {
        const eventName = name.slice(2).toLowerCase();
        (element as any)[`__handler_${eventName}`] = null;
      } else if (name !== "key" && name !== "children") {
        element.removeAttribute(name);
      }
    }
  }

  // Set new/changed attributes
  for (const [name, value] of Object.entries(newAttrs)) {
    if (oldAttrs[name] !== value) {
      setAttribute(element, name, value);
    }
  }
}

function flattenChildren(children: Children): Child[] {
  if (!Array.isArray(children)) {
    return children == null ? [] : [children];
  }

  const result: Child[] = [];
  for (const child of children) {
    if (Array.isArray(child)) {
      result.push(...flattenChildren(child));
    } else {
      result.push(child);
    }
  }
  return result;
}

// Store rendered result for component diffing (declared early for use in removeVnodeDom)
const componentRenderedResults = new WeakMap<Component, VnodeDOM | null>();

// Recursively remove DOM nodes from a vnode and its children.
// callOnRemove handles the lifecycle (onremove + element disposal) for the
// whole tree in one pass; removeDom then detaches the DOM and clears stored
// rendered results.
function removeVnodeDom(vnode: VnodeDOM | null): void {
  if (!vnode) return;
  callOnRemove(vnode);
  removeDom(vnode);
}

// Structural removal only — no lifecycle callbacks (callOnRemove covers those).
function removeDom(vnode: VnodeDOM | null): void {
  if (!vnode) return;

  // For component vnodes, check if there's a rendered result stored
  // This must come FIRST because vnode.dom only points to the first element,
  // but components may render multiple elements
  if (vnode.state) {
    const hasRendered = componentRenderedResults.has(vnode.state as Component);
    if (hasRendered) {
      const rendered = componentRenderedResults.get(vnode.state as Component);
      if (rendered) {
        removeDom(rendered);
      }
      componentRenderedResults.delete(vnode.state as Component);
      return;
    }
  }

  // For fragments (arrays), remove all children - don't just use vnode.dom
  // which only points to the first element
  if (vnode.tag === "[" && Array.isArray(vnode.children)) {
    for (const child of vnode.children) {
      if (child && typeof child === "object") {
        removeDom(child as VnodeDOM);
      }
    }
    return;
  }

  // If vnode has direct DOM, remove it
  if (vnode.dom) {
    vnode.dom.parentNode?.removeChild(vnode.dom);
    return;
  }

  // Otherwise, recursively check children
  if (Array.isArray(vnode.children)) {
    for (const child of vnode.children) {
      if (child && typeof child === "object" && "dom" in child) {
        removeDom(child as VnodeDOM);
      }
    }
  }
}

let renderDepth = 0;
const MAX_RENDER_DEPTH = 100;

function render(
  vnode: Child,
  parent: Element,
  oldVnode: VnodeDOM | null,
  isSvg: boolean,
  nextSibling: Node | null = null,
): VnodeDOM | null {
  renderDepth++;
  if (renderDepth > MAX_RENDER_DEPTH) {
    console.error(
      "Max render depth exceeded! Possible infinite recursion. vnode:",
      vnode,
    );
    renderDepth--;
    return null;
  }
  try {
    return renderImpl(vnode, parent, oldVnode, isSvg, nextSibling);
  } finally {
    renderDepth--;
  }
}

function renderImpl(
  vnode: Child,
  parent: Element,
  oldVnode: VnodeDOM | null,
  isSvg: boolean,
  nextSibling: Node | null,
): VnodeDOM | null {
  // Handle null/undefined/boolean
  if (vnode == null || typeof vnode === "boolean") {
    if (oldVnode) {
      removeVnodeDom(oldVnode);
    }
    return null;
  }

  // Handle arrays (fragments)
  if (Array.isArray(vnode)) {
    const renderedChildren: (VnodeDOM | null)[] = [];

    // Get old children if oldVnode is a fragment
    const oldChildren: (VnodeDOM | null)[] =
      oldVnode?.tag === "[" && Array.isArray(oldVnode.children)
        ? (oldVnode.children as (VnodeDOM | null)[])
        : [];

    const maxLen = Math.max(vnode.length, oldChildren.length);

    for (let i = 0; i < maxLen; i++) {
      const newChild = vnode[i];
      const oldChild = oldChildren[i] || null;

      if (i < vnode.length) {
        const rendered = render(newChild, parent, oldChild, isSvg, nextSibling);
        renderedChildren.push(rendered);
      } else if (oldChild?.dom) {
        // Remove extra old children
        callOnRemove(oldChild);
        oldChild.dom.parentNode?.removeChild(oldChild.dom);
      }
    }

    // Return a virtual fragment vnode pointing to first child's DOM
    const firstChild = renderedChildren.find((c) => c?.dom);
    return {
      tag: "[",
      attrs: {},
      children: renderedChildren as any,
      dom: firstChild?.dom || null,
      domSize: renderedChildren.length,
    } as VnodeDOM;
  }

  // Handle text nodes
  if (typeof vnode === "string" || typeof vnode === "number") {
    const text = String(vnode);
    if (oldVnode?.dom instanceof Text) {
      if (oldVnode.dom.textContent !== text) {
        oldVnode.dom.textContent = text;
      }
      return {
        tag: "#text",
        attrs: {},
        children: text,
        dom: oldVnode.dom,
      } as VnodeDOM;
    }

    const textNode = document.createTextNode(text);
    if (oldVnode?.dom && oldVnode.dom.parentNode === parent) {
      parent.replaceChild(textNode, oldVnode.dom);
    } else if (nextSibling && nextSibling.parentNode === parent) {
      parent.insertBefore(textNode, nextSibling);
    } else {
      parent.appendChild(textNode);
    }
    return {
      tag: "#text",
      attrs: {},
      children: text,
      dom: textNode as unknown as Element,
    } as VnodeDOM;
  }

  // Handle vnodes
  const vnodeObj = vnode as Vnode;

  // Ensure attrs is always defined
  if (!vnodeObj.attrs) {
    vnodeObj.attrs = {} as any;
  }

  // Handle components (functions or objects with view method)
  if (
    typeof vnodeObj.tag === "function" ||
    (typeof vnodeObj.tag === "object" &&
      vnodeObj.tag !== null &&
      typeof (vnodeObj.tag as any).view === "function")
  ) {
    return renderComponent(vnodeObj, parent, oldVnode, isSvg, nextSibling);
  }

  // Handle elements
  const tag = vnodeObj.tag;

  // Validate tag is a string
  if (typeof tag !== "string") {
    console.error(
      "Invalid vnode tag (expected string):",
      tag,
      "vnode:",
      vnodeObj,
    );
    throw new Error(
      `Invalid element tag: ${typeof tag} - ${JSON.stringify(tag)}`,
    );
  }

  const elementIsSvg = isSvg || tag === "svg";

  let element: Element;
  let reusingElement = false;

  if (oldVnode?.dom instanceof Element && oldVnode.tag === tag) {
    // Reuse existing element
    element = oldVnode.dom;
    reusingElement = true;
    updateAttributes(element, oldVnode.attrs || {}, vnodeObj.attrs || {});
  } else {
    // Create new element
    element = createElement(tag, elementIsSvg);
    for (const [name, value] of Object.entries(vnodeObj.attrs || {})) {
      setAttribute(element, name, value);
    }

    if (oldVnode?.dom && oldVnode.dom.parentNode === parent) {
      callOnRemove(oldVnode);
      parent.replaceChild(element, oldVnode.dom);
    } else if (oldVnode) {
      // Old vnode exists - remove its DOM (may be in different parent or null)
      removeVnodeDom(oldVnode);
      // After removal, nextSibling may be invalid - check it's still in parent
      if (nextSibling && nextSibling.parentNode === parent) {
        parent.insertBefore(element, nextSibling);
      } else {
        parent.appendChild(element);
      }
    } else if (nextSibling && nextSibling.parentNode === parent) {
      parent.insertBefore(element, nextSibling);
    } else {
      parent.appendChild(element);
    }
  }

  // Render children
  const newChildren = flattenChildren(vnodeObj.children);
  const oldChildren = oldVnode?.children
    ? flattenChildren(oldVnode.children as Children).map((c) =>
        c && typeof c === "object" && "dom" in c ? c : null,
      )
    : [];

  // Simple child reconciliation (not keyed for now)
  const renderedChildren: (VnodeDOM | null)[] = [];
  const maxLen = Math.max(newChildren.length, oldChildren.length);

  for (let i = 0; i < maxLen; i++) {
    const newChild = newChildren[i];
    const oldChild = oldChildren[i] as VnodeDOM | null;

    if (i < newChildren.length) {
      // Only use nextSibling if the old DOM is still in this parent
      let insertBefore: Node | null = null;
      if (oldChild?.dom?.nextSibling && oldChild.dom.parentNode === element) {
        insertBefore = oldChild.dom.nextSibling;
      }
      const rendered = render(
        newChild,
        element,
        oldChild,
        elementIsSvg,
        insertBefore,
      );
      renderedChildren.push(rendered);
    } else if (oldChild?.dom && oldChild.dom.parentNode === element) {
      // Remove extra old children
      callOnRemove(oldChild);
      element.removeChild(oldChild.dom);
    }
  }

  // Mutate original vnode to add dom property (Mithril compatibility)
  (vnodeObj as VnodeDOM).dom = element as HTMLElement;
  (vnodeObj as VnodeDOM).children = renderedChildren as any;

  const result = vnodeObj as VnodeDOM;

  // Schedule lifecycle callbacks
  if (reusingElement && vnodeObj.attrs?.onupdate) {
    pendingOnUpdate.push(() => vnodeObj.attrs.onupdate!(result));
  } else if (!reusingElement && vnodeObj.attrs?.oncreate) {
    pendingOnCreate.push(() => vnodeObj.attrs.oncreate!(result));
  }

  return result;
}

function renderComponent(
  vnode: Vnode,
  parent: Element,
  oldVnode: VnodeDOM | null,
  isSvg: boolean,
  nextSibling: Node | null,
): VnodeDOM | null {
  const componentFn = vnode.tag as ComponentTypes;
  let component: Component;
  let isNew = true;
  let oldRendered: VnodeDOM | null = null;

  // Check if we can reuse old component instance
  const tagsMatch = oldVnode?.tag === vnode.tag;

  if (tagsMatch && oldVnode.state) {
    component = oldVnode.state as Component;
    isNew = false;

    // Get the previously rendered result for this component
    oldRendered = componentRenderedResults.get(component) || null;
  } else {
    // Different component - remove old component's DOM first
    if (oldVnode) {
      removeVnodeDom(oldVnode);
      // After removal, nextSibling may be invalid if it was part of the old DOM tree
      if (nextSibling && nextSibling.parentNode !== parent) {
        nextSibling = null;
      }
    }

    // Create new component instance
    if (typeof componentFn === "function") {
      // Closure component
      const vnodeWithDom = { ...vnode, dom: null } as VnodeDOM;
      component = (componentFn as ClosureComponent)(vnodeWithDom);
    } else {
      // Object component
      component = componentFn as Component;
    }

    // Call oninit
    if (component.oninit) {
      component.oninit(vnode);
    }
  }

  // Create vnode with state for view
  const vnodeForView: Vnode = {
    ...vnode,
    state: component,
    attrs: { ...vnode.attrs },
  };

  // Call view
  const viewResult = component.view(vnodeForView);

  // Render view result, using the previously rendered result for diffing
  const rendered = render(viewResult, parent, oldRendered, isSvg, nextSibling);

  // Store the rendered result for future diffing
  componentRenderedResults.set(component, rendered);

  // Create result vnode
  // Mutate original vnode to add dom and state properties (Mithril compatibility)
  (vnode as VnodeDOM).dom = rendered?.dom || null;
  (vnode as VnodeDOM).state = component;

  const result = vnode as VnodeDOM;

  // Schedule lifecycle callbacks
  if (isNew) {
    if (component.oncreate) {
      pendingOnCreate.push(() => component.oncreate!(result));
    }
    // Also handle oncreate passed via attrs (Mithril compatibility)
    if (vnode.attrs?.oncreate) {
      pendingOnCreate.push(() => (vnode.attrs as any).oncreate(result));
    }
  } else {
    if (component.onupdate) {
      pendingOnUpdate.push(() => component.onupdate!(result));
    }
    // Also handle onupdate passed via attrs (Mithril compatibility)
    if (vnode.attrs?.onupdate) {
      pendingOnUpdate.push(() => (vnode.attrs as any).onupdate(result));
    }
  }

  return result;
}

function callOnRemove(vnode: VnodeDOM | null): void {
  if (!vnode) return;

  // Call component onremove
  if (vnode.state && (vnode.state as Component).onremove) {
    pendingOnRemove.push(() => (vnode.state as Component).onremove!(vnode));
  }

  // Call element onremove
  if (vnode.attrs?.onremove) {
    pendingOnRemove.push(() => vnode.attrs.onremove!(vnode));
  }

  // Recurse to children
  if (Array.isArray(vnode.children)) {
    for (const child of vnode.children) {
      if (child && typeof child === "object" && "dom" in child) {
        callOnRemove(child as VnodeDOM);
      }
    }
  }

  // Descend into the component's rendered subtree: vnode.children only holds
  // the slot children PASSED to a component, while what it rendered (where
  // nested components and their onremove live) is in componentRenderedResults.
  // Without this, unmounting (which goes through callOnRemove alone, not
  // removeVnodeDom) never reaches nested components — leaking their timers
  // and listeners.
  if (vnode.state) {
    const rendered = componentRenderedResults.get(vnode.state as Component);
    if (rendered) callOnRemove(rendered);
  }

  // Dispose the DOM element's DisposableStack
  if (vnode.dom) {
    disposeElement(vnode.dom);
  }
}

function flushLifecycleCallbacks(): void {
  // Loop: callbacks may schedule more callbacks (e.g. nested mount). Drain
  // until the queues are empty.
  while (
    pendingOnRemove.length ||
    pendingOnCreate.length ||
    pendingOnUpdate.length
  ) {
    const onRemove = pendingOnRemove;
    const onCreate = pendingOnCreate;
    const onUpdate = pendingOnUpdate;
    pendingOnRemove = [];
    pendingOnCreate = [];
    pendingOnUpdate = [];

    for (const fn of onRemove) {
      try {
        fn();
      } catch (e) {
        console.error("Error in onremove:", e);
      }
    }
    for (const fn of onCreate) {
      try {
        fn();
      } catch (e) {
        console.error("Error in oncreate:", e);
      }
    }
    for (const fn of onUpdate) {
      try {
        fn();
      } catch (e) {
        console.error("Error in onupdate:", e);
      }
    }
  }
}

// Mount and Redraw

interface MountPoint {
  element: Element;
  component: ComponentTypes;
  vnode: VnodeDOM | null;
  // Cleanups registered (via registerRenderCleanup) by code running inside this
  // mount point's render — e.g. legacy-store's per-query redraw watchers. Run
  // when the mount point is unmounted, so those watchers are disposed and their
  // query signals can be released. Scoped to the mount point rather than to
  // individual component onremove, because the registering code (a plain
  // function call inside a view) has no component of its own to hang an
  // onremove on.
  cleanups: Set<() => void>;
}

// The cleanup set of the mount point currently being rendered, if any.
// registerRenderCleanup adds to it; null when not inside a render.
let currentRenderCleanups: Set<() => void> | null = null;

// Register a cleanup tied to the mount point currently rendering. Returns false
// (without registering) when called outside a render — callers can use that to
// detect that no reactive/host owner exists for what they're setting up.
export function registerRenderCleanup(cleanup: () => void): boolean {
  if (!currentRenderCleanups) return false;
  currentRenderCleanups.add(cleanup);
  return true;
}

const mountPoints: MountPoint[] = [];
let redrawScheduled = false;

function renderMountPoint(mp: MountPoint): void {
  const vnode = m(mp.component, {});
  if (vnode) {
    const prev = currentRenderCleanups;
    currentRenderCleanups = mp.cleanups;
    try {
      mp.vnode = render(vnode, mp.element, mp.vnode, false, null);
    } finally {
      currentRenderCleanups = prev;
    }
  }
}

function redrawNow(): void {
  for (const mp of mountPoints) renderMountPoint(mp);
  flushLifecycleCallbacks();
}

// Always rAF-scheduled. Multiple calls in the same task coalesce into
// one render across all mount points. The initial render in mount()
// uses renderMountPoint directly so callers see DOM synchronously.
function redraw(): void {
  if (redrawScheduled) return;
  redrawScheduled = true;
  requestAnimationFrame(() => {
    redrawScheduled = false;
    redrawNow();
  });
}

function mount(element: Element, component: ComponentTypes | null): void {
  // Find existing mount point
  const existingIndex = mountPoints.findIndex((mp) => mp.element === element);

  if (component === null) {
    // Unmount
    if (existingIndex >= 0) {
      const mp = mountPoints[existingIndex];
      if (mp.vnode) {
        callOnRemove(mp.vnode);
        element.innerHTML = "";
      }
      for (const cleanup of mp.cleanups) {
        try {
          cleanup();
        } catch (e) {
          console.error("Error in render cleanup:", e);
        }
      }
      mp.cleanups.clear();
      mountPoints.splice(existingIndex, 1);
      flushLifecycleCallbacks();
    }
    return;
  }

  if (existingIndex >= 0) {
    // Update existing mount
    mountPoints[existingIndex].component = component;
    renderMountPoint(mountPoints[existingIndex]);
  } else {
    // New mount - add and render immediately
    const mp: MountPoint = {
      element,
      component,
      vnode: null,
      cleanups: new Set(),
    };
    mountPoints.push(mp);
    renderMountPoint(mp);
  }

  flushLifecycleCallbacks();
}

// Public API

const mithril = m as Static;
mithril.mount = mount;
mithril.redraw = redraw;

export default mithril;
export { mithril as m, mount, redraw };

// Signal-based host for legacy Mithril components.
// Creates an HTMLElement that hosts a mithril component tree. The render
// function is called immediately and again whenever any signal it reads
// changes. Mithril diffs the vnode tree on each call.
// Uses m.mount() so the component participates in mithril's redraw cycle;
// legacy components that call m.redraw() need this to trigger re-renders.
export function createMithrilHost(renderFn: () => any): HTMLElement {
  return div({
    class: "legacy-host",
    style: "display:contents",
    onMount: (el) => {
      const container = el as HTMLElement;

      let mounted = false;
      let disposed = false;

      // Tracker registers renderFn's signal deps; mount's view calls
      // renderFn separately for a fresh tree each render (mithril mutates
      // vnodes during diff, so the tree can't be cached).
      const tracker = new ComputedSignal(() => renderFn());
      const watcher = new Watcher(() => {
        queueMicrotask(() => {
          if (disposed) return;
          tracker.get();
          watcher.watch(tracker);
          redraw();
        });
      });
      tracker.get();
      watcher.watch(tracker);
      queueMicrotask(() => {
        if (disposed) return;
        mount(container, { view: () => renderFn() });
        mounted = true;
      });

      return () => {
        disposed = true;
        watcher[Symbol.dispose]();
        tracker[Symbol.dispose]();
        if (mounted) mount(container, null);
      };
    },
  });
}
