import m, { ClosureComponent, ChildArray } from "mithril";
import {
  ComputedSignal,
  ConstSignal,
  SignalBase,
  StateSignal,
  Watcher,
  setTimeout as _setTimeout,
  setInterval as _setInterval,
} from "./signals.ts";
import views from "views-bundle";
import { count, fetch, invalidate } from "./reactive-store.ts";
import { SkewedDate, getClockSkew } from "./skewed-date.ts";
import Expression from "../lib/common/expression.ts";
import * as taskQueue from "./task-queue.ts";
import * as notifications from "./notifications.ts";
import { deleteResource, ping, updateTags } from "./store.ts";
import { stringify } from "../lib/common/yaml.ts";

type ViewElement =
  | ViewNode
  | string
  | number
  | SignalBase<ViewElement>
  | ViewElement[];

export class ViewNode {
  name: string | null;
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
  name: SignalBase<string | null>;
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

    const sig = new ComputedSignal(() => {
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
      freshness?: number;
    } | null;
    if (!arg) return null;
    const res = node.attributes["res"] as StateSignal<unknown[]>;

    const localFreshness = arg.freshness ? arg.freshness - getClockSkew() : 0;
    const querySignal = fetch(arg.resource, Expression.parse(arg.filter), {
      freshness: localFreshness,
    });

    const sig = new ComputedSignal(() => {
      if (res) res.set(querySignal.get().value);
      return null;
    });
    return sig;
  });
}

function doTask(node: SignalizedViewNode): ViewElement {
  return new ComputedSignal(() => {
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
      taskQueue
        .commit([task], (_, err, conReq, tasks2) => {
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
  return new ComputedSignal(() => {
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
  return new ComputedSignal(() => {
    const arg = node.attributes["arg"]?.get() as {
      resource: string;
      id: string;
    } | null;
    if (!arg?.resource || !arg?.id) return null;
    const res = node.attributes["res"] as StateSignal<boolean | Error>;

    deleteResource(arg.resource, arg.id)
      .then(() => {
        invalidate(Date.now());
        if (res) res.set(true);
      })
      .catch((err) => {
        if (res) res.set(err instanceof Error ? err : new Error(String(err)));
      });

    return null;
  });
}

function doYamlStringify(node: SignalizedViewNode): ViewElement {
  return new ComputedSignal(() => {
    const arg = node.attributes["arg"]?.get();
    const res = node.attributes["res"] as StateSignal<string>;
    if (arg === undefined || !res) return null;
    res.set(stringify(arg));
    return null;
  });
}

function doUpdateTags(node: SignalizedViewNode): ViewElement {
  return new ComputedSignal(() => {
    const arg = node.attributes["arg"]?.get() as {
      deviceId: string;
      tags: Record<string, boolean>;
    } | null;
    if (!arg?.deviceId || !arg?.tags) return null;
    const res = node.attributes["res"] as StateSignal<boolean | Error>;

    updateTags(arg.deviceId, arg.tags)
      .then(() => {
        invalidate(Date.now());
        if (res) res.set(true);
      })
      .catch((err) => {
        if (res) res.set(err instanceof Error ? err : new Error(String(err)));
      });

    return null;
  });
}

function doPing(node: SignalizedViewNode): ViewElement {
  return new ComputedSignal(() => {
    const arg = node.attributes["arg"]?.get() as string | null;
    const res = node.attributes["res"] as StateSignal<number | Error | null>;
    if (!arg || !res) return null;

    const refresh = (): void => {
      ping(arg)
        .then((r) => {
          res.set(r["avg"] != null ? r["avg"] : null);
        })
        .catch((err) => {
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
    const context2 = context.popView(node.name).pushDeferred(node.children);
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

class RenderContext {
  private viewStacks: Record<string, ViewFunc[]>;
  private deferredStack: ChildArray[];

  constructor(clone?: RenderContext) {
    if (clone) {
      this.viewStacks = clone.viewStacks;
      this.deferredStack = clone.deferredStack;
    } else {
      this.viewStacks = {};
      this.deferredStack = [];
    }
  }

  getView(name: string): ViewFunc {
    const stack = this.viewStacks[name];
    if (!stack) return null;
    return stack[stack.length - 1];
  }

  pushViews(_views: Record<string, ViewFunc>): RenderContext {
    const clone = new RenderContext(this);
    for (const [name, view] of Object.entries(_views)) {
      clone.viewStacks[name] = [...(clone.viewStacks[name] ?? []), view];
    }
    return clone;
  }

  popView(name: string): RenderContext {
    const stack = this.viewStacks[name];
    if (!stack?.length) return this;
    const clone = new RenderContext(this);
    clone.viewStacks = { ...this.viewStacks, [name]: stack.slice(0, -1) };
    return clone;
  }

  getDeferred(): (ViewNode | SignalBase | any)[] {
    if (!this.deferredStack.length) return null;
    return this.deferredStack[this.deferredStack.length - 1];
  }

  popDeferred(): RenderContext {
    const clone = new RenderContext(this);
    clone.deferredStack = this.deferredStack.slice(0, -1);
    return clone;
  }

  pushDeferred(deferred: (ViewNode | SignalBase | any)[]): RenderContext {
    const clone = new RenderContext(this);
    clone.deferredStack = [...this.deferredStack, deferred];
    return clone;
  }
}

function renderNode(node: ViewElement): ReturnType<typeof m> {
  if (node instanceof SignalBase) {
    return renderNode(node.get());
  }
  if (node instanceof ViewNode) {
    const attrs: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node.attributes)) {
      attrs[k] = v instanceof SignalBase ? v.get() : v;
    }
    if (!node.name) return m.fragment(attrs, node.children.map(renderNode));
    return m(node.name, attrs, node.children.map(renderNode));
  }

  if (Array.isArray(node))
    return m.fragment(
      {},
      node.map((n) => renderNode(n)),
    );
  return m.fragment({}, node);
}

export const ViewComponent: ClosureComponent<{
  name: string;
  attrs: Record<string, string>;
}> = (vnode) => {
  const context = new RenderContext().pushViews(
    views as Record<string, ViewFunc>,
  );
  const node = initView(
    context,
    new ViewNode(vnode.attrs.name, vnode.attrs.attrs, []),
  );

  const signal = new ComputedSignal<ReturnType<typeof renderNode>>(() => {
    return renderNode(node);
  });

  const watcher = new Watcher(() => {
    requestAnimationFrame(() => {
      watcher.watch(); // Reset notification state
      m.redraw();
    });
  });
  watcher.watch(signal);

  return {
    view: () => signal.get(),
    onremove: () => {
      watcher[Symbol.dispose]();
      if (node[Symbol.dispose]) node[Symbol.dispose]();
    },
  };
};
