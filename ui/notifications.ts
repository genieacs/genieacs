/**
 * Copyright 2013-2019  GenieACS Inc.
 *
 * This file is part of GenieACS.
 *
 * GenieACS is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * GenieACS is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with GenieACS.  If not, see <http://www.gnu.org/licenses/>.
 */

import m from "mithril";

interface Notification {
  type: string;
  message: string;
  timestamp: number;
  actions?: { [label: string]: () => void };
}

const notifications = new Set<Notification>();

export function push(type, message, actions?): Notification {
  const n: Notification = {
    type: type,
    message: message,
    timestamp: Date.now(),
    actions: actions
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
