"use strict";

import m from "mithril";
import * as taskQueue from "../task-queue";
import * as notifications from "../notifications";
import * as store from "../store";

const component = {
  view: vnode => {
    const device = vnode.attrs.device;

    const buttons = [];

    buttons.push(
      m(
        "button.primary",
        {
          title: "Reboot device",
          onclick: () => {
            taskQueue.queueTask({
              name: "reboot",
              device: device["DeviceID.ID"].value[0]
            });
          }
        },
        "Reboot"
      )
    );

    buttons.push(
      m(
        "button.critical",
        {
          title: "Factory reset device",
          onclick: () => {
            taskQueue.queueTask({
              name: "factoryReset",
              device: device["DeviceID.ID"].value[0]
            });
          }
        },
        "Reset"
      )
    );

    buttons.push(
      m(
        "button.primary",
        {
          title: "Delete device",
          onclick: () => {
            if (!confirm("Deleting this device. Are you sure?")) return;

            store
              .deleteResource("devices", device["DeviceID.ID"].value[0])
              .then(() => {
                notifications.push("success", "Device deleted");
                m.route.set("/devices");
              })
              .catch(err => {
                notifications.push("error", err.message);
              });
          }
        },
        "Delete"
      )
    );

    return m(".device-actions", buttons);
  }
};

export default component;
