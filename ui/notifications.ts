import { StateSignal } from "./signals.ts";

export interface Notification {
  type: string;
  message: string;
  timestamp: number;
  actions?: { [label: string]: () => void };
}

const notificationsSignal = new StateSignal<Notification[]>([]);

export function push(
  type: string,
  message: string,
  actions?: { [label: string]: () => void },
): Notification {
  const n: Notification = {
    type: type,
    message: message,
    timestamp: Date.now(),
    actions: actions,
  };
  notificationsSignal.set([...notificationsSignal.get(), n]);
  if (!actions) {
    setTimeout(() => {
      dismiss(n);
    }, 4000);
  }

  return n;
}

export function dismiss(n: Notification): void {
  notificationsSignal.set(notificationsSignal.get().filter((x) => x !== n));
}

export function getSignal(): StateSignal<Notification[]> {
  return notificationsSignal;
}
