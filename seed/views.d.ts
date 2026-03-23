interface Signal<T = unknown> {
  get(): T;
}

interface StateSignal<T = unknown> extends Signal<T> {
  set(value: T): void;
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface ComputedSignal<T = unknown> extends Signal<T> {}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface ConstSignal<T = unknown> extends Signal<T> {}

interface SignalConstructors {
  State: new <T>(value: T) => StateSignal<T>;
  Computed: new <T>(callback: () => T) => ComputedSignal<T>;
  Const: new <T>(value: T) => ConstSignal<T>;
}

declare const Signal: SignalConstructors;

type ViewElement = ViewNode | string | number | Signal | ViewElement[];

declare class ViewNode {
  name: string | null;
  attributes: Record<string, unknown>;
  children: ViewElement[];
}

interface SignalizedViewNode {
  name: Signal<string | null>;
  attributes: Record<string, Signal>;
  children: Signal<ViewNode>[];
}

declare const node: SignalizedViewNode;

declare function h(
  name: string | null,
  attributes: Record<string, unknown> | null,
  ...children: ViewElement[]
): ViewNode;

declare const Fragment: null;
