"use strict";

import m from "mithril";
import * as taskQueue from "../task-queue";
import * as store from "../store";
import * as notifications from "../notifications";
import * as expression from "../../common/expression";
import memoize from "../../common/memoize";

const memoizedParse = memoize(expression.parse);

const component = {
  view: vnode => {
    const device = vnode.attrs.device;

    return m(
      "button.primary",
      {
        title: "Initiate session and refresh basic parameters",
        onclick: e => {
          e.target.disabled = true;
          const params = Object.values(vnode.attrs.parameters)
            .map(p => {
              const exp = memoizedParse(p);
              if (!Array.isArray(exp) || !exp[0] == "PARAM") return null;
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
                if (err)
                  return notifications.push(
                    "error",
                    `${deviceId}: ${err.message}`
                  );

                for (let t of tasks2)
                  if (t.status === "stale") taskQueue.deleteTask(t);

                if (connectionRequestStatus !== "OK")
                  notifications.push(
                    "error",
                    `${deviceId}: ${connectionRequestStatus}`
                  );
                else if (tasks2[0].status === "stale")
                  notifications.push(
                    "error",
                    `${deviceId}: No contact from device`
                  );
                else if (tasks2[0].status === "fault")
                  notifications.push("error", `${deviceId}: Refresh faulted`);
                else notifications.push("success", `${deviceId}: Summoned`);
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

export default component;
