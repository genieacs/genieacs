import { ClosureComponent, Component } from "mithril";
import { m } from "../components.ts";
import * as taskQueue from "../task-queue.ts";
import * as notifications from "../notifications.ts";
import * as store from "../store.ts";

const component: ClosureComponent = (): Component => {
  return {
    view: (vnode) => {
      const device = vnode.attrs["device"];

      const buttons = [];

      buttons.push(
        m(
          "button.primary",
          {
            title: "Reboot device",
            onclick: () => {
              taskQueue.queueTask({
                name: "reboot",
                device: device["DeviceID.ID"].value[0],
              });
            },
          },
          "Reboot",
        ),
      );

      buttons.push(
        m(
          "button.critical",
          {
            title: "Factory reset device",
            onclick: () => {
              taskQueue.queueTask({
                name: "factoryReset",
                device: device["DeviceID.ID"].value[0],
              });
            },
          },
          "Reset",
        ),
      );

      buttons.push(
        m(
          "button.critical",
          {
            title: "Push a firmware or a config file",
            onclick: () => {
              taskQueue.stageDownload({
                name: "download",
                devices: [device["DeviceID.ID"].value[0]],
              });
            },
          },
          "Push file",
        ),
      );

      buttons.push(
        m(
          "button.primary",
          {
            title: "Delete device",
            onclick: () => {
              if (!confirm("Deleting this device. Are you sure?")) return;
              const deviceId = device["DeviceID.ID"].value[0];

              store
                .deleteResource("devices", deviceId)
                .then(() => {
                  notifications.push("success", `${deviceId}: Device deleted`);
                  m.route.set("/devices");
                })
                .catch((err) => {
                  notifications.push("error", err.message);
                });
            },
          },
          "Delete",
        ),
      );

      return m(".actions-bar", buttons);
    },
  };
};

export default component;
