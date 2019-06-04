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
import * as notifications from "../notifications";
import * as store from "../store";

const component: ClosureComponent = (): Component => {
  return {
    view: vnode => {
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
          "button.critical",
          {
            title: "Push a firmware or a config file",
            onclick: () => {
              taskQueue.stageDownload({
                name: "download",
                device: device["DeviceID.ID"].value[0]
              });
            }
          },
          "Push file"
        )
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
                .catch(err => {
                  notifications.push("error", err.message);
                });
            }
          },
          "Delete"
        )
      );

      return m(".actions-bar", buttons);
    }
  };
};

export default component;
