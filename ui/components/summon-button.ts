import { ClosureComponent } from "../mithril-compat.ts";
import { m } from "../components.ts";
import * as taskQueue from "../task-queue.ts";
import * as store from "../legacy-store.ts";
import { invalidate } from "../reactive-store.ts";
import * as notifications from "../notifications.ts";
import Expression from "../../lib/common/expression.ts";
import { FlatDevice } from "../../lib/ui/db.ts";

interface Attrs {
  device: FlatDevice;
  parameters: Record<string, Expression>;
}

const component: ClosureComponent<Attrs> = () => {
  return {
    view: (vnode) => {
      const device = vnode.attrs.device;

      return m(
        "button",
        {
          class:
            "px-2.5 py-1.5 border border-transparent text-xs font-medium rounded-sm shadow-xs text-white bg-cyan-600 hover:bg-cyan-700 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-cyan-500",
          title: "Initiate session and refresh basic parameters",
          onclick: (e: Event) => {
            const target = e.target as HTMLButtonElement;
            target.disabled = true;
            const params = Object.values(vnode.attrs.parameters)
              .map((exp) =>
                exp instanceof Expression.Parameter
                  ? exp.path.toString()
                  : null,
              )
              .filter((exp): exp is string => !!exp);

            const task = {
              name: "getParameterValues",
              parameterNames: params,
              device: device["DeviceID.ID"] as string,
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
                target.disabled = false;
                store.setTimestamp(Date.now());
                invalidate(Date.now());
              })
              .catch((err) => {
                target.disabled = false;
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
