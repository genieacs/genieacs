import { SignalBase, ComputedSignal, Watcher, untracked } from "./signals.ts";

// Namespace URIs for prefixed attributes (xlink:href, xml:lang, etc.)
const ATTR_NAMESPACES: Record<string, string> = {
  xlink: "http://www.w3.org/1999/xlink",
  xml: "http://www.w3.org/XML/1998/namespace",
};

// Extend Element to track disposables
interface ElementWithDisposables extends Element {
  __disposables?: DisposableStack;
}

// Child types that can be rendered
export type Child =
  | string
  | number
  | boolean
  | null
  | undefined
  | Node
  | SignalBase<unknown>
  | (() => unknown)
  | Child[];

// Reactive value - can be static, a function, or a signal
type Reactive<T> = T | (() => T) | SignalBase<T>;

// Common attributes for all elements - allows arbitrary string keys
interface BaseAttrs {
  class?: Reactive<string>;
  style?:
    | Reactive<string>
    | Partial<Record<keyof CSSStyleDeclaration, Reactive<string>>>;
  ref?: (el: Element) => void;
  onMount?: (el: Element) => void | (() => void);
  [key: string]: unknown;
}

// Event handler type
type EventHandler<E extends Event, T extends Element> = (
  e: E & { currentTarget: T },
) => void;

// HTML-specific attributes
interface HtmlAttrs extends BaseAttrs {
  id?: Reactive<string>;
  title?: Reactive<string>;
  tabindex?: Reactive<number>;
  hidden?: Reactive<boolean>;
  onclick?: EventHandler<MouseEvent, HTMLElement>;
  ondblclick?: EventHandler<MouseEvent, HTMLElement>;
  onmousedown?: EventHandler<MouseEvent, HTMLElement>;
  onmouseup?: EventHandler<MouseEvent, HTMLElement>;
  onmouseover?: EventHandler<MouseEvent, HTMLElement>;
  onmouseout?: EventHandler<MouseEvent, HTMLElement>;
  onmousemove?: EventHandler<MouseEvent, HTMLElement>;
  onkeydown?: EventHandler<KeyboardEvent, HTMLElement>;
  onkeyup?: EventHandler<KeyboardEvent, HTMLElement>;
  onkeypress?: EventHandler<KeyboardEvent, HTMLElement>;
  onfocus?: EventHandler<FocusEvent, HTMLElement>;
  onblur?: EventHandler<FocusEvent, HTMLElement>;
  onsubmit?: EventHandler<SubmitEvent, HTMLFormElement>;
  oninput?: EventHandler<InputEvent, HTMLInputElement>;
  onchange?: EventHandler<Event, HTMLElement>;
}

interface AnchorAttrs extends HtmlAttrs {
  href?: Reactive<string>;
  target?: Reactive<string>;
  rel?: Reactive<string>;
  "xlink:href"?: Reactive<string>;
}

interface ButtonAttrs extends HtmlAttrs {
  type?: Reactive<"button" | "submit" | "reset">;
  disabled?: Reactive<boolean>;
  name?: Reactive<string>;
  value?: Reactive<string>;
}

interface InputAttrs extends HtmlAttrs {
  type?: Reactive<string>;
  value?: Reactive<string>;
  placeholder?: Reactive<string>;
  disabled?: Reactive<boolean>;
  readonly?: Reactive<boolean>;
  required?: Reactive<boolean>;
  checked?: Reactive<boolean>;
  name?: Reactive<string>;
  min?: Reactive<string | number>;
  max?: Reactive<string | number>;
  step?: Reactive<string | number>;
  pattern?: Reactive<string>;
  autocomplete?: Reactive<string>;
  list?: Reactive<string>;
}

interface TextareaAttrs extends HtmlAttrs {
  value?: Reactive<string>;
  placeholder?: Reactive<string>;
  disabled?: Reactive<boolean>;
  readonly?: Reactive<boolean>;
  required?: Reactive<boolean>;
  rows?: Reactive<number>;
  cols?: Reactive<number>;
  name?: Reactive<string>;
}

interface SelectAttrs extends HtmlAttrs {
  value?: Reactive<string>;
  disabled?: Reactive<boolean>;
  required?: Reactive<boolean>;
  multiple?: Reactive<boolean>;
  name?: Reactive<string>;
}

interface OptionAttrs extends HtmlAttrs {
  value?: Reactive<string>;
  selected?: Reactive<boolean>;
  disabled?: Reactive<boolean>;
}

interface ImgAttrs extends HtmlAttrs {
  src?: Reactive<string>;
  alt?: Reactive<string>;
  width?: Reactive<string | number>;
  height?: Reactive<string | number>;
  loading?: Reactive<"lazy" | "eager">;
}

interface FormAttrs extends HtmlAttrs {
  action?: Reactive<string>;
  method?: Reactive<string>;
  enctype?: Reactive<string>;
  target?: Reactive<string>;
}

interface LabelAttrs extends HtmlAttrs {
  for?: Reactive<string>;
}

interface TableAttrs extends HtmlAttrs {
  cellpadding?: Reactive<string | number>;
  cellspacing?: Reactive<string | number>;
}

interface TdAttrs extends HtmlAttrs {
  colspan?: Reactive<number>;
  rowspan?: Reactive<number>;
}

// SVG-specific attributes
interface SvgBaseAttrs extends BaseAttrs {
  fill?: Reactive<string>;
  stroke?: Reactive<string>;
  "stroke-width"?: Reactive<string | number>;
  "fill-opacity"?: Reactive<string | number>;
  transform?: Reactive<string>;
  d?: Reactive<string>;
  x?: Reactive<string | number>;
  y?: Reactive<string | number>;
  width?: Reactive<string | number>;
  height?: Reactive<string | number>;
  viewBox?: Reactive<string>;
  xmlns?: Reactive<string>;
  "xmlns:xlink"?: Reactive<string>;
  "dominant-baseline"?: Reactive<string>;
  "text-anchor"?: Reactive<string>;
}

interface SvgPathAttrs extends SvgBaseAttrs {
  d?: Reactive<string>;
}

interface SvgCircleAttrs extends SvgBaseAttrs {
  cx?: Reactive<string | number>;
  cy?: Reactive<string | number>;
  r?: Reactive<string | number>;
}

interface SvgRectAttrs extends SvgBaseAttrs {
  rx?: Reactive<string | number>;
  ry?: Reactive<string | number>;
}

// Check if a value is reactive (function or signal)
function isReactive(
  value: unknown,
): value is (() => unknown) | SignalBase<unknown> {
  return typeof value === "function" || value instanceof SignalBase;
}

// Get value from potentially reactive source
function getValue<T>(source: Reactive<T>): T {
  if (source instanceof SignalBase) return source.get();
  if (typeof source === "function") return (source as () => T)();
  return source;
}

// Wrap a function-or-signal source into a ComputedSignal.
function toComputed<T>(source: (() => T) | SignalBase<T>): ComputedSignal<T> {
  return typeof source === "function"
    ? new ComputedSignal(source)
    : new ComputedSignal(() => source.get());
}

// Re-run `update` (batched onto a microtask) whenever `computed` changes,
// re-arming the watcher each time until it is disposed. The caller does the
// initial render and is responsible for disposing the returned watcher.
function watchEffect(
  computed: SignalBase<unknown>,
  update: () => void,
): Watcher {
  const watcher = new Watcher(() => {
    queueMicrotask(() => {
      if (watcher._disposed) return;
      update();
      watcher.watch(computed);
    });
  });
  watcher.watch(computed);
  return watcher;
}

// Own a computed + watcher pair (plus a teardown callback) on a node, so they
// are released when the node is torn down via disposeElement.
function trackOnNode(
  node: Node,
  computed: Disposable,
  watcher: Disposable,
  teardown: () => void,
): void {
  const stack = new DisposableStack();
  stack.use(computed);
  stack.use(watcher);
  stack.defer(teardown);
  (node as ElementWithDisposables).__disposables = stack;
}

// Bind a reactive attribute to an element
function bindAttribute(
  element: Element,
  name: string,
  value: (() => unknown) | SignalBase<unknown>,
): Disposable {
  const resources = new DisposableStack();
  const computed = toComputed(value);
  resources.use(computed);

  const applyValue = (): void => {
    // get() throws if the signal was disposed mid-update; ignore it.
    try {
      applyAttribute(element, name, computed.get());
    } catch {
      // disposed
    }
  };

  // Apply initial value BEFORE watching to avoid spurious re-apply.
  applyValue();
  resources.use(watchEffect(computed, applyValue));

  return resources;
}

// Apply a static attribute value to an element
function applyAttribute(element: Element, name: string, value: unknown): void {
  const htmlEl = element as HTMLElement;

  // Handle special cases
  if (name === "class") {
    // SVG elements have className as a read-only SVGAnimatedString
    if (element instanceof SVGElement) {
      element.setAttribute("class", String(value ?? ""));
    } else {
      htmlEl.className = String(value ?? "");
    }
    return;
  }

  if (name === "style") {
    if (typeof value === "string") {
      htmlEl.setAttribute("style", value);
    } else if (value && typeof value === "object") {
      // Style object: { "background-color": "red", color: "blue" }
      const styleObj = value as Record<string, string>;
      for (const [prop, val] of Object.entries(styleObj)) {
        htmlEl.style.setProperty(prop, val);
      }
    }
    return;
  }

  if (name === "value" && "value" in htmlEl) {
    (htmlEl as HTMLInputElement).value = String(value ?? "");
    return;
  }

  if (name === "checked" && "checked" in htmlEl) {
    (htmlEl as HTMLInputElement).checked = Boolean(value);
    return;
  }

  // Boolean attributes
  if (
    name === "disabled" ||
    name === "readonly" ||
    name === "required" ||
    name === "hidden" ||
    name === "selected" ||
    name === "multiple"
  ) {
    if (value) {
      htmlEl.setAttribute(name, "");
    } else {
      htmlEl.removeAttribute(name);
    }
    return;
  }

  // Data attributes
  if (name.startsWith("data-")) {
    if (value == null) {
      htmlEl.removeAttribute(name);
    } else {
      htmlEl.setAttribute(name, String(value));
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

  // Regular attributes
  if (value == null) {
    htmlEl.removeAttribute(name);
  } else {
    htmlEl.setAttribute(name, String(value));
  }
}

// Render a child to a Node
function renderChild(child: Child): Node | Node[] | null {
  if (child == null || child === false || child === true) {
    return null;
  }

  if (typeof child === "string" || typeof child === "number") {
    return document.createTextNode(String(child));
  }

  if (child instanceof Node) {
    return child;
  }

  if (Array.isArray(child)) {
    const nodes: Node[] = [];
    for (const c of child) {
      const rendered = renderChild(c);
      if (rendered) {
        if (Array.isArray(rendered)) {
          nodes.push(...rendered);
        } else {
          nodes.push(rendered);
        }
      }
    }
    return nodes;
  }

  // Reactive child (function or signal)
  if (isReactive(child)) {
    return createReactiveNode(child);
  }

  return null;
}

// Normalize a renderChild result into the nodes to track in currentNodes.
// A DocumentFragment empties itself on insertion, so storing it in
// currentNodes would orphan its children on the next update (disposeElement
// and removeChild on the emptied fragment are no-ops). Track its children
// instead. Fragments can reach here either as a reactive child's return
// value or from a nested reactive child (createReactiveNode returns a
// fragment), including inside arrays.
function toNodes(rendered: Node | Node[] | null): Node[] {
  if (!rendered) return [];
  const arr = Array.isArray(rendered) ? rendered : [rendered];
  return arr.flatMap((n) =>
    n instanceof DocumentFragment ? Array.from(n.childNodes) : [n],
  );
}

// Create a reactive node that updates when its signal changes
function createReactiveNode(
  source: (() => unknown) | SignalBase<unknown>,
): Node {
  // Use a comment node as anchor
  const anchor = document.createComment("");
  const currentNodes: Node[] = [];

  // Create the computed outside the parent's tracking scope — reactive nodes
  // manage themselves via their own watcher and must NOT register as
  // dependencies of a parent ComputedSignal.
  const computed = untracked(() => toComputed(source));

  const update = (): void => {
    const parent = anchor.parentNode;
    if (!parent) return;

    let value: unknown;
    try {
      value = computed.get();
    } catch {
      // Signal was disposed, stop updating
      return;
    }

    const rendered = toNodes(renderChild(value as Child));

    // Remove old nodes
    for (const node of currentNodes) {
      disposeElement(node);
      node.parentNode?.removeChild(node);
    }
    currentNodes.length = 0;

    // Insert new nodes
    for (const node of rendered) {
      parent.insertBefore(node, anchor);
      currentNodes.push(node);
    }
  };

  // Initial render — evaluate BEFORE watching so the watcher doesn't see
  // the spurious undefined→value transition from _recompute's markSinksDirty.
  // Also untracked so child signals don't register as parent dependencies.
  const initialValue = untracked(() => computed.get());
  currentNodes.push(...toNodes(renderChild(initialValue as Child)));

  const watcher = watchEffect(computed, update);

  // Create a fragment with initial nodes + anchor
  const frag = document.createDocumentFragment();
  for (const node of currentNodes) {
    frag.appendChild(node);
  }
  frag.appendChild(anchor);

  trackOnNode(anchor, computed, watcher, () => {
    for (const node of currentNodes) {
      disposeElement(node);
    }
    currentNodes.length = 0;
  });

  return frag;
}

// Dispose an element and all its children
export function disposeElement(node: Node): void {
  if (node instanceof Element) {
    const elem = node as ElementWithDisposables;
    if (elem.__disposables) {
      elem.__disposables[Symbol.dispose]();
      elem.__disposables = undefined;
    }

    for (const child of Array.from(node.childNodes)) {
      disposeElement(child);
    }
  } else if ((node as any).__disposables) {
    (node as any).__disposables[Symbol.dispose]();
    (node as any).__disposables = undefined;
  }
}

// Generic element creator
export function createElement<T extends Element>(
  tag: string,
  attrs: Record<string, unknown> | null | undefined,
  children: Child[],
  namespace?: string,
): T {
  const element = namespace
    ? (document.createElementNS(namespace, tag) as unknown as T)
    : (document.createElement(tag) as unknown as T);

  const disposables = new DisposableStack();

  // Process attributes
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value === undefined) continue;

      // Skip special handlers. "onRemove" is not part of BaseAttrs (use the
      // each() option instead), but stays skipped defensively: a stray
      // function-valued onRemove would otherwise match the "on" prefix below
      // and register a bogus "remove" event listener.
      if (key === "ref" || key === "onMount" || key === "onRemove") continue;

      // Event handlers
      if (key.startsWith("on") && typeof value === "function") {
        element.addEventListener(
          key.slice(2).toLowerCase(),
          value as EventListener,
        );
        disposables.defer(() =>
          element.removeEventListener(
            key.slice(2).toLowerCase(),
            value as EventListener,
          ),
        );
        continue;
      }

      // Reactive attributes
      if (isReactive(value)) {
        disposables.use(
          bindAttribute(
            element,
            key,
            value as (() => unknown) | SignalBase<unknown>,
          ),
        );
        continue;
      }

      // Static attributes
      applyAttribute(element, key, value);
    }
  }

  // Process children
  for (const child of children) {
    const rendered = renderChild(child);
    if (rendered) {
      if (Array.isArray(rendered)) {
        for (const node of rendered) {
          element.appendChild(node);
        }
      } else {
        element.appendChild(rendered);
      }
    }
  }

  // Store disposables
  (element as ElementWithDisposables).__disposables = disposables;

  // Handle ref
  if (attrs?.ref && typeof attrs.ref === "function") {
    (attrs.ref as (e: Element) => void)(element);
  }

  // Handle onMount
  if (attrs?.onMount && typeof attrs.onMount === "function") {
    queueMicrotask(() => {
      // Element may have been disposed synchronously before the microtask ran;
      // running onMount then would operate on a detached element and defer()
      // on a disposed stack throws, leaking the cleanup.
      if (disposables.disposed) return;
      const cleanup = (attrs.onMount as (e: Element) => void | (() => void))(
        element,
      );
      if (typeof cleanup === "function") {
        disposables.defer(cleanup);
      }
    });
  }

  return element;
}

// Helper to parse class selectors (e.g., "div.foo.bar")
function parseSelector(selector: string): { tag: string; classes: string[] } {
  const parts = selector.split(".");
  const tag = parts[0] || "div";
  const classes = parts.slice(1);
  return { tag, classes };
}

// Element factory that supports class shorthand syntax
function elementFactory<A extends BaseAttrs, T extends Element>(
  tagOrSelector: string,
  namespace?: string,
): {
  (attrs?: A | Child, ...children: Child[]): T;
} {
  return (attrsOrChild?: A | Child, ...children: Child[]): T => {
    const { tag, classes } = parseSelector(tagOrSelector);

    let attrs: A | null = null;

    // Check if first argument is attrs or a child
    if (
      attrsOrChild != null &&
      typeof attrsOrChild === "object" &&
      !Array.isArray(attrsOrChild) &&
      !(attrsOrChild instanceof Node) &&
      !(attrsOrChild instanceof SignalBase)
    ) {
      attrs = attrsOrChild as A;
    } else if (attrsOrChild !== undefined) {
      children = [attrsOrChild as Child, ...children];
    }

    // Merge classes from selector with class attribute
    if (classes.length > 0) {
      const existingClass = attrs?.class;
      if (existingClass) {
        if (isReactive(existingClass)) {
          // Create a computed that combines both
          attrs = { ...attrs } as A;
          (attrs as any).class = () =>
            `${classes.join(" ")} ${getValue(existingClass)}`;
        } else {
          attrs = { ...attrs } as A;
          (attrs as any).class = `${classes.join(" ")} ${existingClass}`;
        }
      } else {
        attrs = { ...attrs, class: classes.join(" ") } as A;
      }
    }

    return createElement<T>(
      tag,
      attrs as Record<string, unknown>,
      children,
      namespace,
    );
  };
}

// SVG namespace
const SVG_NS = "http://www.w3.org/2000/svg";

// HTML Element functions
export const div = elementFactory<HtmlAttrs, HTMLDivElement>("div");
export const span = elementFactory<HtmlAttrs, HTMLSpanElement>("span");
export const p = elementFactory<HtmlAttrs, HTMLParagraphElement>("p");
export const a = elementFactory<AnchorAttrs, HTMLAnchorElement>("a");
export const button = elementFactory<ButtonAttrs, HTMLButtonElement>("button");
export const input = elementFactory<InputAttrs, HTMLInputElement>("input");
export const textarea = elementFactory<TextareaAttrs, HTMLTextAreaElement>(
  "textarea",
);
export const select = elementFactory<SelectAttrs, HTMLSelectElement>("select");
export const option = elementFactory<OptionAttrs, HTMLOptionElement>("option");
export const datalist = elementFactory<HtmlAttrs, HTMLDataListElement>(
  "datalist",
);
export const label = elementFactory<LabelAttrs, HTMLLabelElement>("label");
export const form = elementFactory<FormAttrs, HTMLFormElement>("form");
export const img = elementFactory<ImgAttrs, HTMLImageElement>("img");
export const h1 = elementFactory<HtmlAttrs, HTMLHeadingElement>("h1");
export const h2 = elementFactory<HtmlAttrs, HTMLHeadingElement>("h2");
export const h3 = elementFactory<HtmlAttrs, HTMLHeadingElement>("h3");
export const h4 = elementFactory<HtmlAttrs, HTMLHeadingElement>("h4");
export const h5 = elementFactory<HtmlAttrs, HTMLHeadingElement>("h5");
export const h6 = elementFactory<HtmlAttrs, HTMLHeadingElement>("h6");
export const ul = elementFactory<HtmlAttrs, HTMLUListElement>("ul");
export const ol = elementFactory<HtmlAttrs, HTMLOListElement>("ol");
export const li = elementFactory<HtmlAttrs, HTMLLIElement>("li");
export const table = elementFactory<TableAttrs, HTMLTableElement>("table");
export const thead = elementFactory<HtmlAttrs, HTMLTableSectionElement>(
  "thead",
);
export const tbody = elementFactory<HtmlAttrs, HTMLTableSectionElement>(
  "tbody",
);
export const tfoot = elementFactory<HtmlAttrs, HTMLTableSectionElement>(
  "tfoot",
);
export const tr = elementFactory<HtmlAttrs, HTMLTableRowElement>("tr");
export const th = elementFactory<TdAttrs, HTMLTableCellElement>("th");
export const td = elementFactory<TdAttrs, HTMLTableCellElement>("td");
export const nav = elementFactory<HtmlAttrs, HTMLElement>("nav");
export const header = elementFactory<HtmlAttrs, HTMLElement>("header");
export const footer = elementFactory<HtmlAttrs, HTMLElement>("footer");
export const main = elementFactory<HtmlAttrs, HTMLElement>("main");
export const section = elementFactory<HtmlAttrs, HTMLElement>("section");
export const article = elementFactory<HtmlAttrs, HTMLElement>("article");
export const aside = elementFactory<HtmlAttrs, HTMLElement>("aside");
export const pre = elementFactory<HtmlAttrs, HTMLPreElement>("pre");
export const code = elementFactory<HtmlAttrs, HTMLElement>("code");
export const strong = elementFactory<HtmlAttrs, HTMLElement>("strong");
export const em = elementFactory<HtmlAttrs, HTMLElement>("em");
export const small = elementFactory<HtmlAttrs, HTMLElement>("small");
export const br = elementFactory<HtmlAttrs, HTMLBRElement>("br");
export const hr = elementFactory<HtmlAttrs, HTMLHRElement>("hr");

// SVG Element functions — same factory as HTML elements, in the SVG namespace
function svgElementFactory<A extends SvgBaseAttrs, T extends Element>(
  tag: string,
): (attrs?: A | Child, ...children: Child[]) => T {
  return elementFactory<A, T>(tag, SVG_NS);
}

export const svg = svgElementFactory<SvgBaseAttrs, SVGSVGElement>("svg");
export const svgPath = svgElementFactory<SvgPathAttrs, SVGPathElement>("path");
export const svgCircle = svgElementFactory<SvgCircleAttrs, SVGCircleElement>(
  "circle",
);
export const svgRect = svgElementFactory<SvgRectAttrs, SVGRectElement>("rect");
export const svgText = svgElementFactory<SvgBaseAttrs, SVGTextElement>("text");
export const svgG = svgElementFactory<SvgBaseAttrs, SVGGElement>("g");
export const svgA = svgElementFactory<SvgBaseAttrs & AnchorAttrs, SVGAElement>(
  "a",
);

// Keyed list helper for efficient updates
interface EachOptions<T> {
  onAdd?: (node: Node, item: T) => void;
  onRemove?: (node: Node, item: T) => Promise<void> | void;
  // Re-render a reused node when the item under its key changes identity
  // (default true). Set to false for lists whose rows read their data
  // reactively and must persist across item-identity churn.
  rerenderOnChange?: boolean;
}

export function each<T>(
  items: SignalBase<T[]> | (() => T[]),
  key: (item: T, index: number) => string | number,
  render: (item: T, index: () => number) => Node,
  options?: EachOptions<T>,
): Node {
  const anchor = document.createComment("");
  const nodeMap = new Map<
    string | number,
    { node: Node; item: T; indexSignal: { index: number } }
  >();
  const currentKeys: (string | number)[] = [];
  const rerenderOnChange = options?.rerenderOnChange !== false;

  // Create outside parent's tracking scope (same reason as createReactiveNode)
  const computed = untracked(() => toComputed<T[]>(items));

  const update = (): void => {
    const newItems = computed.get();
    const newKeys = newItems.map((item, i) => key(item, i));
    const parent = anchor.parentNode;
    if (!parent) return;

    // Remove nodes that no longer exist
    const newKeySet = new Set(newKeys);
    for (const k of currentKeys) {
      if (!newKeySet.has(k)) {
        const entry = nodeMap.get(k);
        if (entry) {
          nodeMap.delete(k);
          if (options?.onRemove) {
            const result = options.onRemove(entry.node, entry.item);
            if (result && typeof result.then === "function") {
              void result.then(() => {
                disposeElement(entry.node);
                entry.node.parentNode?.removeChild(entry.node);
              });
              continue;
            }
          }
          disposeElement(entry.node);
          entry.node.parentNode?.removeChild(entry.node);
        }
      }
    }

    // Update or create nodes
    let prevNode: Node = anchor;
    for (let i = newItems.length - 1; i >= 0; i--) {
      const item = newItems[i];
      const k = newKeys[i];
      const entry = nodeMap.get(k);

      if (entry) {
        // Update index (the render callback's index getter reads this)
        entry.indexSignal.index = i;
        if (rerenderOnChange && !Object.is(entry.item, item)) {
          // Item changed under a stable key — rebuild the node so content
          // rendered statically from the item doesn't go stale. This is a
          // content refresh, not a membership change: onAdd/onRemove are
          // not invoked.
          const indexSignal = entry.indexSignal;
          const node = render(item, () => indexSignal.index);
          disposeElement(entry.node);
          if (entry.node.parentNode === parent) {
            parent.replaceChild(node, entry.node);
          } else {
            parent.insertBefore(node, prevNode);
          }
          entry.node = node;
        }
        entry.item = item;
        // Move if needed
        if (entry.node.nextSibling !== prevNode) {
          parent.insertBefore(entry.node, prevNode);
        }
        prevNode = entry.node;
      } else {
        // Create new node
        const indexSignal = { index: i };
        const node = render(item, () => indexSignal.index);
        nodeMap.set(k, { node, item, indexSignal });
        parent.insertBefore(node, prevNode);
        if (options?.onAdd) options.onAdd(node, item);
        prevNode = node;
      }
    }

    currentKeys.length = 0;
    currentKeys.push(...newKeys);
  };

  // Initial render — evaluate BEFORE watching to avoid spurious update
  const initialItems = untracked(() => computed.get());
  const frag = document.createDocumentFragment();

  for (let i = 0; i < initialItems.length; i++) {
    const item = initialItems[i];
    const k = key(item, i);
    currentKeys.push(k);
    const indexSignal = { index: i };
    const node = render(item, () => indexSignal.index);
    nodeMap.set(k, { node, item, indexSignal });
    frag.appendChild(node);
    if (options?.onAdd) options.onAdd(node, item);
  }

  frag.appendChild(anchor);

  const watcher = watchEffect(computed, update);

  trackOnNode(anchor, computed, watcher, () => {
    for (const entry of nodeMap.values()) {
      disposeElement(entry.node);
    }
    nodeMap.clear();
  });

  return frag;
}

// SVG use element
export const svgUse = svgElementFactory<
  SvgBaseAttrs & { href?: Reactive<string> },
  SVGUseElement
>("use");

// Fragment helper
export function fragment(...children: Child[]): DocumentFragment {
  const frag = document.createDocumentFragment();
  for (const child of children) {
    const rendered = renderChild(child);
    if (rendered) {
      if (Array.isArray(rendered)) {
        for (const node of rendered) {
          frag.appendChild(node);
        }
      } else {
        frag.appendChild(rendered);
      }
    }
  }
  return frag;
}
