import { ClosureComponent, Component } from "mithril";
import { m } from "../components.ts";
import * as taskQueue from "../task-queue.ts";
import * as notifications from "../notifications.ts";
import { deleteResource } from "../api-client.ts";
import { navigate } from "../router.ts";
import { FlatDevice } from "../../lib/ui/db.ts";

interface Attrs {
  device: FlatDevice;
}

const component: ClosureComponent<Attrs> = (): Component<Attrs> => {
  return {
    view: (vnode) => {
      const device = vnode.attrs.device;
      const deviceId = device["DeviceID.ID"] as string;

      const buttons = [];

      buttons.push(
        m(
          "button.px-4 py-2 border border-stone-300 shadow-xs text-sm font-medium rounded-md text-stone-700 bg-white hover:bg-stone-50 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed",
          {
            title: "Reboot device",
            onclick: () => {
              taskQueue.queueTask({
                name: "reboot",
                device: deviceId,
              });
            },
          },
          "Reboot",
        ),
      );

      buttons.push(
        m(
          "button.px-4 py-2 border border-stone-300 shadow-xs text-sm font-medium rounded-md text-stone-700 bg-white hover:bg-stone-50 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed",
          {
            title: "Factory reset device",
            onclick: () => {
              taskQueue.queueTask({
                name: "factoryReset",
                device: deviceId,
              });
            },
          },
          "Reset",
        ),
      );

      buttons.push(
        m(
          "button.px-4 py-2 border border-stone-300 shadow-xs text-sm font-medium rounded-md text-stone-700 bg-white hover:bg-stone-50 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed",
          {
            title: "Push a firmware or a config file",
            onclick: () => {
              taskQueue.stageDownload({
                name: "download",
                devices: [deviceId],
              });
            },
          },
          "Push file",
        ),
      );

      buttons.push(
        m(
          "button.px-4 py-2 border border-stone-300 shadow-xs text-sm font-medium rounded-md text-stone-700 bg-white hover:bg-stone-50 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed",
          {
            title: "Delete device",
            onclick: () => {
              if (!confirm("Deleting this device. Are you sure?")) return;

              deleteResource("devices", deviceId)
                .then(() => {
                  notifications.push("success", `${deviceId}: Device deleted`);
                  navigate("/devices").catch(console.error);
                })
                .catch((err) => {
                  notifications.push("error", err.message);
                });
            },
          },
          "Delete",
        ),
      );

      return m("div.flex gap-3 mt-4", buttons);
    },
  };
};

export default component;
