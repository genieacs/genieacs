import m from "mithril";

interface Notification {
  type: string;
  message: string;
  timestamp: number;
}

const notifications = new Set<Notification>();

export function push(type, message): void {
  const n = { type: type, message: message, timestamp: Date.now() };
  notifications.add(n);
  m.redraw();
  setTimeout(() => {
    notifications.delete(n);
    m.redraw();
  }, 4000);
}

export function getNotifications(): Set<Notification> {
  return notifications;
}
