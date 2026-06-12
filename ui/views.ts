import {
  ComputedSignal,
  ConstSignal,
  SignalBase,
  StateSignal,
  abortSignal,
  setTimeout as _setTimeout,
  setInterval as _setInterval,
} from "./signals.ts";
import views from "views-bundle";
import { count, pagedFetch, invalidate, sameRefs } from "./reactive-store.ts";
import { SkewedDate, getClockSkew } from "./skewed-date.ts";
import Expression from "../lib/common/expression.ts";
import * as taskQueue from "./task-queue.ts";
import * as notifications from "./notifications.ts";
import { deleteResource, ping, updateTags } from "./api-client.ts";
import { stringify } from "../lib/common/yaml.ts";
import { createElement, disposalAnchor, fragment, type Child } from "./dom.ts";

type ViewElement =
  | ViewNode
  | string
  | number
  | null
  | SignalBase<ViewElement>
  | ViewElement[];

export class ViewNode {
  name: string;
  attributes: Record<string, any>;
  children: ViewElement[];
  constructor(
    name: string,
    attributes: Record<string, any>,
    children: ViewElement[],
  ) {
    this.name = name;
    this.attributes = attributes ?? {};
    this.children = children;
  }
}

// A signalized version of ViewNode where all properties are wrapped in signals.
// If the original value is already a Signal, it's used as-is.
// Otherwise, a ConstSignal is created to wrap the value.
export interface SignalizedViewNode {
  name: SignalBase<string>;
  attributes: Record<string, SignalBase<unknown>>;
  children: SignalBase<ViewElement>[];
}

// Wraps a value in a ConstSignal if it's not already a Signal.
function toSignal<T>(value: T | SignalBase<T>): SignalBase<T> {
  if (value instanceof SignalBase) return value;
  return new ConstSignal(value);
}

// Converts a ViewNode to a SignalizedViewNode where all properties are signals.
function signalizeNode(node: ViewNode): SignalizedViewNode {
  const signalizedAttrs: Record<string, SignalBase<unknown>> = {};
  for (const [key, value] of Object.entries(node.attributes)) {
    signalizedAttrs[key] = toSignal(value);
  }

  return {
    name: toSignal(node.name),
    attributes: signalizedAttrs,
    children: node.children.map((child) => toSignal(child)),
  };
}

function doCount(node: SignalizedViewNode): ViewElement {
  return new ComputedSignal(() => {
    const arg = node.attributes["arg"]?.get() as {
      resource: string;
      filter: string;
      freshness?: number;
    } | null;
    if (!arg) return null;
    const res = node.attributes["res"] as StateSignal<number>;

    // View scripts see server-adjusted time (via SkewedDate), but cache
    // timestamps use local time, so convert back to local time.
    const localFreshness = arg.freshness ? arg.freshness - getClockSkew() : 0;
    const querySignal = count(arg.resource, Expression.parse(arg.filter), {
      freshness: localFreshness,
    });

    const sig = new ComputedSignal((): null => {
      if (res) res.set(querySignal.get().value);
      return null;
    });
    return sig;
  });
}

function doFetch(node: SignalizedViewNode): ViewElement {
  return new ComputedSignal(() => {
    const arg = node.attributes["arg"]?.get() as {
      resource: string;
      filter: string;
      sort?: Record<string, number>;
      limit?: number;
      freshness?: number;
    } | null;
    if (!arg) return null;
    const res = node.attributes["res"] as StateSignal<unknown[]>;
    const loading = node.attributes["loading"] as
      | StateSignal<boolean>
      | undefined;

    const localFreshness = arg.freshness ? arg.freshness - getClockSkew() : 0;
    const filter = Expression.parse(arg.filter);

    // Results are published unconditionally, provisional rows included: the
    // store keeps query.value displayable at all times (adopted rows during
    // revalidation, the covered prefix during a bookmark probe), and a newly
    // created view has no previous result to keep showing — gating on
    // loading would leave it blank despite a populated cache. pagedFetch
    // mints a new array per call, so the equals hook pins the published
    // identity while the rows are unchanged; res only notifies its
    // dependents on actual row changes.
    const value = new ComputedSignal<unknown[]>(
      () =>
        pagedFetch(arg.resource, filter, {
          sort: arg.sort,
          limit: arg.limit,
          freshness: localFreshness,
        }).value,
      { equals: sameRefs },
    );

    const sig = new ComputedSignal((): null => {
      const query = pagedFetch(arg.resource, filter, {
        sort: arg.sort,
        limit: arg.limit,
        freshness: localFreshness,
      });
      if (loading) loading.set(query.loading);
      if (res) res.set(value.get());
      return null;
    });
    return sig;
  });
}

function doTask(node: SignalizedViewNode): ViewElement {
  return new ComputedSignal((): null => {
    const arg = node.attributes["arg"]?.get() as {
      name: string;
      device: string;
      commit?: boolean;
      parameterNames?: string[];
      parameterValues?: unknown[];
      objectName?: string;
    } | null;
    if (!arg) return null;
    const res = node.attributes["res"] as StateSignal<string>;
    const task: any = Object.assign({}, arg);
    if (arg.commit) {
      if (res) res.set("pending");
      const signal = abortSignal();
      taskQueue
        .commit([task], (_, err, conReq, tasks2) => {
          if (signal.aborted) return;
          for (const t of tasks2)
            if (t.status === "stale") taskQueue.deleteTask(t);
          if (err) {
            if (res) res.set("stale");
          } else if (conReq !== "OK") {
            if (res) res.set("stale");
          } else if (tasks2[0]?.status === "stale") {
            if (res) res.set("stale");
          } else if (tasks2[0]?.status === "fault") {
            if (res) res.set("fault");
          } else {
            if (res) res.set("done");
          }
        })
        .then(() => invalidate(Date.now()))
        .catch(() => {
          if (signal.aborted) return;
          if (res) res.set("stale");
        });
    } else if (task.name === "setParameterValues" || task.name === "download") {
      if (task.name === "download") taskQueue.stageDownload(task);
      else taskQueue.stageSpv(task);
      if (res) res.set("staging");
    } else {
      taskQueue.queueTask(task);
      if (res) res.set("queued");
    }
    return null;
  });
}

function doNotify(node: SignalizedViewNode): ViewElement {
  return new ComputedSignal((): null => {
    const arg = node.attributes["arg"]?.get() as {
      type: string;
      message: string;
      actions?: Record<string, () => void>;
    } | null;
    if (!arg?.type || !arg?.message) return null;

    notifications.push(arg.type, arg.message, arg.actions);
    return null;
  });
}

function doDelete(node: SignalizedViewNode): ViewElement {
  return new ComputedSignal((): null => {
    const arg = node.attributes["arg"]?.get() as {
      resource: string;
      id: string;
    } | null;
    if (!arg?.resource || !arg?.id) return null;
    const res = node.attributes["res"] as StateSignal<boolean | Error>;

    const signal = abortSignal();
    deleteResource(arg.resource, arg.id, signal)
      .then(() => {
        invalidate(Date.now());
        if (res) res.set(true);
      })
      .catch((err) => {
        if (signal.aborted) return;
        if (res) res.set(err instanceof Error ? err : new Error(String(err)));
      });

    return null;
  });
}

function doYamlStringify(node: SignalizedViewNode): ViewElement {
  return new ComputedSignal((): null => {
    const arg = node.attributes["arg"]?.get();
    const res = node.attributes["res"] as StateSignal<string>;
    if (arg === undefined || !res) return null;
    res.set(stringify(arg));
    return null;
  });
}

function doUpdateTags(node: SignalizedViewNode): ViewElement {
  return new ComputedSignal((): null => {
    const arg = node.attributes["arg"]?.get() as {
      deviceId: string;
      tags: Record<string, boolean>;
    } | null;
    if (!arg?.deviceId || !arg?.tags) return null;
    const res = node.attributes["res"] as StateSignal<boolean | Error>;

    const signal = abortSignal();
    updateTags(arg.deviceId, arg.tags, signal)
      .then(() => {
        invalidate(Date.now());
        if (res) res.set(true);
      })
      .catch((err) => {
        if (signal.aborted) return;
        if (res) res.set(err instanceof Error ? err : new Error(String(err)));
      });

    return null;
  });
}

function doPing(node: SignalizedViewNode): ViewElement {
  return new ComputedSignal((): null => {
    const arg = node.attributes["arg"]?.get() as string | null;
    const res = node.attributes["res"] as StateSignal<number | Error | null>;
    if (!arg || !res) return null;

    const signal = abortSignal();

    const refresh = (): void => {
      ping(arg, signal)
        .then((r) => {
          res.set(r["avg"] != null ? r["avg"] : null);
        })
        .catch((err) => {
          if (signal.aborted) return;
          res.set(err instanceof Error ? err : new Error(String(err)));
        });
    };

    refresh();
    _setInterval(refresh, 3000);
    return null;
  });
}

function initView(context: RenderContext, node: ViewElement): ViewElement {
  if (node instanceof SignalBase) {
    return new ComputedSignal<ViewElement>(() => {
      const v = initView(context, node.get());
      if (v instanceof SignalBase) return v.get();
      return v;
    });
  }

  if (Array.isArray(node)) return node.map((n) => initView(context, n));

  if (!(node instanceof ViewNode)) return node;

  const script = context.getView(node.name);

  if (script) {
    const context2 = context.popView(node.name);
    const signalizedNode = signalizeNode(node);
    return new ComputedSignal<ViewElement>(() => {
      const res = script(
        signalizedNode,
        _setTimeout as any,
        _setInterval as any,
        SkewedDate as unknown as DateConstructorLike,
      );

      return initView(context2, res);
    });
  }

  if (node.name === "do-count") return doCount(signalizeNode(node));
  if (node.name === "do-fetch") return doFetch(signalizeNode(node));
  if (node.name === "do-task") return doTask(signalizeNode(node));
  if (node.name === "do-notify") return doNotify(signalizeNode(node));
  if (node.name === "do-delete") return doDelete(signalizeNode(node));
  if (node.name === "do-ping") return doPing(signalizeNode(node));
  if (node.name === "do-yaml-stringify")
    return doYamlStringify(signalizeNode(node));
  if (node.name === "do-update-tags") return doUpdateTags(signalizeNode(node));

  const children = node.children.map((child) => initView(context, child));
  return new ViewNode(node.name, node.attributes, children);
}

type SetTimeout = typeof setTimeout;

type DateConstructorLike = typeof globalThis.Date;

type ViewFunc = (
  node: SignalizedViewNode,
  setTimeout: SetTimeout,
  setInterval: SetTimeout,
  Date: DateConstructorLike,
) => ViewElement;

// Immutable: every derived context is constructed with its own (shallow-
// copied) stacks map. The stack arrays are shared between contexts until
// replaced, and are only ever rebuilt, never mutated.
class RenderContext {
  private viewStacks: Record<string, ViewFunc[]>;

  constructor(viewStacks: Record<string, ViewFunc[]> = {}) {
    this.viewStacks = viewStacks;
  }

  getView(name: string): ViewFunc | undefined {
    const stack = this.viewStacks[name];
    if (!stack) return undefined;
    return stack[stack.length - 1];
  }

  pushViews(_views: Record<string, ViewFunc>): RenderContext {
    const viewStacks = { ...this.viewStacks };
    for (const [name, view] of Object.entries(_views)) {
      viewStacks[name] = [...(viewStacks[name] ?? []), view];
    }
    return new RenderContext(viewStacks);
  }

  popView(name: string): RenderContext {
    const stack = this.viewStacks[name];
    if (!stack?.length) return this;
    return new RenderContext({
      ...this.viewStacks,
      [name]: stack.slice(0, -1),
    });
  }
}

// Convert a ViewElement tree into a dom.ts Child that can be rendered
// by dom.ts's createElement/fragment. Signals become reactive functions,
// ViewNodes become createElement calls, primitives pass through as-is.
function toChild(node: ViewElement, nsContext?: string): Child {
  if (node == null || typeof node === "boolean") return null;

  // Signals → reactive function child (dom.ts handles the watcher/disposal)
  if (node instanceof SignalBase) {
    return (() => toChild(node.get(), nsContext)) as Child;
  }

  // ViewNode → createElement
  if (node instanceof ViewNode) {
    if (!node.name) {
      // Fragment — return children as array so dom.ts tracks each node
      // individually (a DocumentFragment loses its children after append,
      // breaking reactive update removal)
      return node.children.map((c) => toChild(c, nsContext)) as Child;
    }

    // Resolve namespace from explicit xmlns or inherited context
    const xmlns = node.attributes.xmlns as string | undefined;
    const namespace = xmlns || nsContext;

    // Build attrs, converting SignalBase values to reactive functions
    // so dom.ts's createElement handles the binding
    const attrs: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node.attributes)) {
      if (key === "xmlns") continue;
      if (value instanceof SignalBase) {
        attrs[key] = () => value.get();
      } else {
        attrs[key] = value;
      }
    }

    // Convert children, propagating namespace context
    const children = node.children.map((c) => toChild(c, namespace));

    return createElement(
      node.name,
      attrs,
      children,
      namespace,
    ) as unknown as Child;
  }

  // Arrays → map each element
  if (Array.isArray(node)) {
    return node.map((c) => toChild(c, nsContext)) as Child;
  }

  // Primitives (string, number) pass through directly
  return node as Child;
}

// Render a view by name into a DOM node
export function renderView(
  name: string,
  attrs: Record<string, unknown>,
): DocumentFragment {
  const context = new RenderContext().pushViews(
    views as Record<string, ViewFunc>,
  );
  // The view's signal graph (script computeds, do-* effects) needs an owner:
  // signals constructed inside a computation register their disposal on it
  // (signals.ts registerCleanup), so disposing the owner cascades through the
  // whole graph — clearing intervals, aborting in-flight requests, releasing
  // query signals. Without an owner the graph is reclaimed only by GC, and
  // until then its intervals keep firing and its query signals keep regions
  // pinned in the reactive store. The owner rides a disposal anchor in the
  // returned fragment, torn down with the rest of the view's DOM.
  //
  // This top-level initView pass only CONSTRUCTS signals; it must not read
  // any (a read would register a dependency, and that dependency changing
  // would re-run cleanups — disposing the live view's graph mid-display).
  const owner = new ComputedSignal<ViewElement>(() =>
    initView(context, new ViewNode(name, attrs, [])),
  );
  const viewNode = owner.get();
  return fragment(toChild(viewNode), disposalAnchor(owner));
}
