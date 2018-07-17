"use strict";

import m from "mithril";
import * as taskQueue from "../task-queue";
import * as store from "../store";
import * as notifications from "../notifications";
import * as funcCache from "../../common/func-cache";
import * as expression from "../../common/expression";

const parseParameter = funcCache.getter(p => {
  p = expression.parse(p);
  if (Array.isArray(p) && p[0] === "PARAM") p = p[1];
  return p;
});

const component = {
  oninit: vnode => {
    vnode.state.parameters = Object.values(vnode.attrs.parameters).map(
      parameter => parseParameter(parameter)
    );
  },
  view: vnode => {
    const device = vnode.attrs.device;

    return m(
      "button.primary",
      {
        title: "Initiate session and refresh basic parameters",
        onclick: e => {
          e.target.disabled = true;
          const params = vnode.state.parameters.map(p =>
            store.evaluateExpression(p, device)
          );
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
