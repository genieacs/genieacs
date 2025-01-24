import { ClosureComponent, Component } from "mithril";
import { m } from "../components.ts";
import * as taskQueue from "../task-queue.ts";
import * as store from "../store.ts";
import * as notifications from "../notifications.ts";

const component: ClosureComponent = (): Component => {
  return {
    view: (vnode) => {
      const device = vnode.attrs["device"];

      return m(
        "button.primary",
        {
          title: "Initiate session and refresh basic parameters",
          onclick: (e) => {
            e.target.disabled = true;
            const params = Object.values(vnode.attrs["parameters"])
              .map((exp) => {
                if (!Array.isArray(exp) || exp[0] !== "PARAM") return null;
                return store.evaluateExpression(exp[1], device) as string;
              })
              .filter((exp) => !!exp);

            const task = {
              name: "getParameterValues",
              parameterNames: params,
              device: device["DeviceID.ID"].value[0],
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
                      `${deviceId}: ${connectionRequestStatus}`,
                    );
                  } else if (tasks2[0].status === "stale") {
                    notifications.push(
                      "error",
                      `${deviceId}: No contact from device`,
                    );
                  } else if (tasks2[0].status === "fault") {
                    notifications.push("error", `${deviceId}: Refresh faulted`);
                  } else {
                    notifications.push("success", `${deviceId}: Summoned`);
                  }
                },
              )
              .then(() => {
                e.target.disabled = false;
                store.setTimestamp(Date.now());
              })
              .catch((err) => {
                e.target.disabled = false;
                notifications.push("error", err.message);
              });
          },
        },
        "Summon",
      );
    },
  };
};

export default component;
