import m from "mithril";

interface Notification {
  type: string;
  message: string;
  timestamp: number;
  actions?: { [label: string]: () => void };
}

const notifications = new Set<Notification>();

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
  notifications.add(n);
  m.redraw();
  if (!actions) {
    setTimeout(() => {
      dismiss(n);
    }, 4000);
  }

  return n;
}

export function dismiss(n: Notification): void {
  notifications.delete(n);
  m.redraw();
}

export function getNotifications(): Set<Notification> {
  return notifications;
}
