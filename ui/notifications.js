"use strict";

import m from "mithril";

const notifications = new Set();

export function push(type, message) {
  const n = { type: type, message: message, timestamp: Date.now() };
  notifications.add(n);
  m.redraw();
  setTimeout(() => {
    notifications.delete(n);
    m.redraw();
  }, 4000);
}

export function getNotifications() {
  return notifications;
}
