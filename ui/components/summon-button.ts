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

import { ClosureComponent, Component } from "mithril";
import { m } from "../components";
import * as taskQueue from "../task-queue";
import * as store from "../store";
import * as notifications from "../notifications";

const component: ClosureComponent = (): Component => {
  return {
    view: vnode => {
      const device = vnode.attrs["device"];

      return m(
        "button.primary",
        {
          title: "Initiate session and refresh basic parameters",
          onclick: e => {
            e.target.disabled = true;
            const params = Object.values(vnode.attrs["parameters"])
              .map(exp => {
                if (!Array.isArray(exp) || exp[0] !== "PARAM") return null;
                return store.evaluateExpression(exp[1], device);
              })
              .filter(exp => !!exp);

            const task = {
              name: "getParameterValues",
              parameterNames: params,
              device: device["DeviceID.ID"].value[0]
            };

            taskQueue
              .commit(
                [task],
                (deviceId, err, connectionRequestStatus, tasks2) => {
                  if (err) {
                    notifications.push("error", `${deviceId}: ${err.message}`);
                    return;
                  }

                  for (const t of tasks2)
                    if (t.status === "stale") taskQueue.deleteTask(t);

                  if (connectionRequestStatus !== "OK") {
                    notifications.push(
                      "error",
                      `${deviceId}: ${connectionRequestStatus}`
                    );
                  } else if (tasks2[0].status === "stale") {
                    notifications.push(
                      "error",
                      `${deviceId}: No contact from device`
                    );
                  } else if (tasks2[0].status === "fault") {
                    notifications.push("error", `${deviceId}: Refresh faulted`);
                  } else {
                    notifications.push("success", `${deviceId}: Summoned`);
                  }
                }
              )
              .then(() => {
                e.target.disabled = false;
                store.fulfill(0, Date.now());
              });
          }
        },
        "Summon"
      );
    }
  };
};

export default component;
