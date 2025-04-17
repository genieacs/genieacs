import { ClosureComponent, Component } from "mithril";
import { m } from "../components";
import * as store from "../store";
import * as notifications from "../notifications";
import { getIcon } from "../icons";
import * as taskQueue from "../task-queue";

const component: ClosureComponent = (): Component => {
  return {
    view: (vnode) => {
      const device = vnode.attrs["device"];
      const deviceId = device["DeviceID.ID"].value[0];
      const files = store.fetch("uploads", [
        "AND",
        [">", ["PARAM", "_id"], `${deviceId}/`],
        ["<", ["PARAM", "_id"], `${deviceId}/zzzz`],
      ]);

      const uploads: Record<string, any> = {};

      for (const [k, v] of Object.entries(device)) {
        if (k.startsWith("Uploads.")) {
          const parts = k.split(".");
          if (parts.length !== 3) continue;
          uploads[parts[1]] = uploads[parts[1]] || {};
          uploads[parts[1]][parts[2]] = v["value"][0];
        }
      }

      const headers = ["Filename", "Type", "Timestamp", "Status"].map((l) =>
        m("th", l),
      );
      const thead = m("thead", m("tr", headers));

      let minTime = 999999;
      const timestamp = store.getTimestamp();
      const rows = [];
      const uploadsSorted = Object.values(uploads).sort(
        (a, b) => a["Upload"] - b["Upload"],
      );

      for (const u of Object.values(uploadsSorted)) {
        if (!u["Upload"]) continue;
        const ready = u["LastUpload"] >= u["Upload"];
        if (!ready) {
          minTime = Math.min(minTime, u["Upload"] - timestamp);
          rows.push([
            m("td", u["FileName"]),
            m("td", u["FileType"]),
            m("td", new Date(u["Upload"]).toLocaleString()),
            m("td", "Waiting for upload"),
          ]);
        } else {
          const filePath = `${deviceId}/${u["FileName"]}`;
          if (!Array.isArray(files.value)) continue;
          if (!files.value.some((f) => f["_id"] === filePath)) continue;

          const deleteButton = m(
            "button",
            {
              title: "Delete file",
              onclick: (e) => {
                e.redraw = false;
                store
                  .deleteResource("uploads", filePath)
                  .then(() => {
                    notifications.push("success", "File deleted");
                    store.fulfill(Date.now());
                    m.redraw();
                  })
                  .catch((err) => {
                    notifications.push("error", err.message);
                    store.fulfill(Date.now());
                  });
              },
            },
            getIcon("delete-instance"),
          );

          rows.push([
            m("td", u["FileName"]),
            m("td", u["FileType"]),
            m("td", new Date(u["LastUpload"]).toLocaleString()),
            m(
              "td",
              m(
                "a",
                {
                  href: `api/blob/uploads/${encodeURIComponent(filePath)}`,
                },
                "Ready",
              ),
            ),
            m("td", deleteButton),
          ]);
        }
      }

      if (minTime < 60000) {
        setTimeout(() => {
          store.fulfill(0);
        }, 10000);
      }

      const addButton = m(
        "button",
        {
          title: "Fetch a new file",
          onclick: () => {
            taskQueue.stageUpload({
              name: "upload",
              devices: [deviceId],
            });
          },
        },
        getIcon("add-instance"),
      );

      const empty = !rows.length;

      rows.push([m("td", { colspan: headers.length }), m("td", addButton)]);

      const tbody = m(
        "tbody",
        rows.map((r) => m("tr", r)),
        empty
          ? m("tr.empty", m("td", { colspan: headers.length }, "No uploads"))
          : null,
      );

      return m("table.table", thead, tbody);
    },
  };
};

export default component;
