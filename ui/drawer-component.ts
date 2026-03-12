import m, {
  Children,
  Child,
  ClosureComponent,
  Component,
  VnodeDOM,
} from "mithril";
import * as store from "./store.ts";
import * as notifications from "./notifications.ts";
import { icon } from "./tailwind-utility-components.ts";
import {
  clear,
  commit,
  deleteTask,
  getQueue,
  getStaging,
  QueueTask,
  queueTask,
  StageTask,
} from "./task-queue.ts";
import Expression from "../lib/common/expression.ts";

const invalid: WeakSet<StageTask> = new WeakSet();

function renderStagingSpv(task: StageTask, queueFunc, cancelFunc): Children {
  function keydown(e: KeyboardEvent): void {
    if (e.key === "Enter") queueFunc();
    else if (e.key === "Escape") cancelFunc();
    else e["redraw"] = false;
  }

  let input;
  if (task.parameterValues[0][2] === "xsd:boolean") {
    input = m(
      "select.mt-1 w-full block pl-3 pr-10 py-2 text-base border-stone-300 focus:outline-hidden focus:ring-cyan-500 focus:border-cyan-500 sm:text-sm rounded-md",
      {
        value: task.parameterValues[0][1].toString(),
        onchange: (e) => {
          e.redraw = false;
          task.parameterValues[0][1] = input.dom.value;
        },
        onkeydown: keydown,
        oncreate: (vnode) => {
          (vnode.dom as HTMLSelectElement).focus();
        },
      },
      [
        m("option", { value: "true" }, "true"),
        m("option", { value: "false" }, "false"),
      ],
    );
  } else {
    const type = task.parameterValues[0][2];
    let value = task.parameterValues[0][1];
    if (type === "xsd:dateTime" && typeof value === "number")
      value = new Date(value).toJSON() || value;
    input = m(
      "input.mt-1 w-full shadow-xs focus:ring-cyan-500 focus:border-cyan-500 block sm:text-sm border-stone-300 rounded-md",
      {
        type: ["xsd:int", "xsd:unsignedInt"].includes(type) ? "number" : "text",
        value: value,
        oninput: (e) => {
          e.redraw = false;
          task.parameterValues[0][1] = input.dom.value;
        },
        onkeydown: keydown,
        oncreate: (vnode) => {
          (vnode.dom as HTMLInputElement).focus();
          (vnode.dom as HTMLInputElement).select();
          // Need to prevent scrolling on focus because
          // we're animating height and using overflow: hidden
          (vnode.dom.parentNode.parentNode as Element).scrollTop = 0;
        },
      },
    );
  }

  return [
    m(
      "span.text-sm text-stone-700 inline-flex max-w-full gap-2",
      "Editing",
      m(
        "span",
        {
          title: task.parameterValues[0][0],
          dir: "rtl",
          class: "italic pr-1 min-w-0 truncate",
        },
        task.parameterValues[0][0],
      ),
    ),
    input,
  ];
}

function renderStagingDownload(task: StageTask): Children {
  if (!task.fileName || !task.fileType) invalid.add(task);
  else invalid.delete(task);
  const files = store.fetch("files", new Expression.Literal(true));
  let oui = "";
  let productClass = "";
  for (const d of task.devices) {
    const parts = d.split("-");
    if (oui === "") oui = parts[0];
    else if (oui !== parts[0]) oui = null;
    if (parts.length === 3) {
      if (productClass === "") productClass = parts[1];
      else if (productClass !== parts[1]) productClass = null;
    }
  }

  if (oui) oui = decodeURIComponent(oui);
  if (productClass) productClass = decodeURIComponent(productClass);

  const typesList = [
    ...new Set([
      "",
      "1 Firmware Upgrade Image",
      "2 Web Content",
      "3 Vendor Configuration File",
      "4 Tone File",
      "5 Ringer File",
      ...files.value.map((f) => f["metadata.fileType"]).filter((f) => f),
    ]),
  ].map((t) =>
    m(
      "option",
      { disabled: !t, value: t, selected: (task.fileType || "") === t },
      t,
    ),
  );

  const filesList = [""]
    .concat(
      files.value
        .filter(
          (f) =>
            (!f["metadata.oui"] || f["metadata.oui"] === oui) &&
            (!f["metadata.productClass"] ||
              f["metadata.productClass"] === productClass),
        )
        .map((f) => f._id),
    )
    .map((f) =>
      m(
        "option",
        { disabled: !f, value: f, selected: (task.fileName || "") === f },
        f,
      ),
    );

  return m("div.flex items-center gap-2 text-sm text-stone-700 max-w-full", [
    "Push",
    m(
      "select",
      {
        class:
          "min-w-0 pl-3 pr-10 py-2 text-base border-stone-300 focus:outline-hidden focus:ring-cyan-500 focus:border-cyan-500 sm:text-sm rounded-md",
        onchange: (e) => {
          const f = e.target.value;
          task.fileName = f;
          task.fileType = "";
          for (const file of files.value)
            if (file._id === f) task.fileType = file["metadata.fileType"];
        },
        disabled: files.fulfilling,
      },
      filesList,
    ),
    "as",
    m(
      "select",
      {
        class:
          "min-w-0 pl-3 pr-10 py-2 text-base border-stone-300 focus:outline-hidden focus:ring-cyan-500 focus:border-cyan-500 sm:text-sm rounded-md",
        onchange: (e) => {
          task.fileType = e.target.value;
        },
      },
      typesList,
    ),
  ]);
}

function renderStaging(staging: Set<StageTask>): Child[] {
  const elements: Child[] = [];

  for (const s of staging) {
    const queueFunc = (): void => {
      staging.delete(s);
      for (const d of s.devices) {
        const t = Object.assign({ device: d }, s);
        delete t.devices;
        queueTask(t);
      }
    };
    const cancelFunc = (): void => {
      staging.delete(s);
    };

    let elms;
    if (s.name === "setParameterValues")
      elms = renderStagingSpv(s, queueFunc, cancelFunc);
    else if (s.name === "download") elms = renderStagingDownload(s);

    const queue = m(
      "button",
      {
        class:
          "px-2.5 py-1.5 border border-transparent text-xs font-medium rounded-sm shadow-xs text-white bg-cyan-600 hover:bg-cyan-700 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-cyan-500 disabled:cursor-not-allowed disabled:opacity-50",
        title: "Queue task",
        onclick: queueFunc,
        disabled: invalid.has(s),
      },
      "Queue",
    );
    const cancel = m(
      "button",
      {
        class:
          "px-2.5 py-1.5 border border-stone-300 shadow-xs text-xs font-medium rounded-sm text-stone-700 bg-white hover:bg-stone-50 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-cyan-500 disabled:cursor-not-allowed disabled:opacity-50",
        title: "Cancel edit",
        onclick: cancelFunc,
      },
      "Cancel",
    );

    elements.push(
      m(
        "div.p-4",
        elms,
        m("div.flex mt-4 justify-center gap-4", cancel, queue),
      ),
    );
  }
  return elements;
}

function renderQueue(queue: Set<QueueTask>): Child[] {
  const details: Child[] = [];
  const devices: { [deviceId: string]: any[] } = {};
  for (const t of queue) {
    devices[t.device] = devices[t.device] || [];
    devices[t.device].push(t);
  }

  for (const [k, v] of Object.entries(devices)) {
    details.push(m("h3.font-semibold text-stone-700", k));
    for (const t of v) {
      const actions: ReturnType<typeof m>[] = [];
      let task: ReturnType<typeof m>;

      if (t.status === "fault" || t.status === "stale") {
        actions.push(
          m(
            "button",
            {
              title: "Retry this task",
              onclick: () => {
                queueTask(t);
              },
            },
            m(icon, {
              name: "retry",
              class: "inline h-4 w-4 text-cyan-700 hover:text-cyan-900",
            }),
          ),
        );
      }

      actions.push(
        m(
          "button",
          {
            title: "Remove this task",
            onclick: () => {
              deleteTask(t);
            },
          },
          m(icon, {
            name: "remove",
            class: "inline h-4 w-4 text-cyan-700 hover:text-cyan-900",
          }),
        ),
      );

      if (t.name === "setParameterValues") {
        task = m(
          "span.text-stone-900 inline-flex max-w-full gap-2",
          "Set",
          m(
            "span",
            {
              title: t.parameterValues[0][0],
              dir: "rtl",
              class: "italic pr-1 min-w-0 truncate",
            },
            t.parameterValues[0][0],
          ),
          "to",
          m(
            "span",
            {
              title: t.parameterValues[0][1],
              class: "min-w-0 truncate",
            },
            t.parameterValues[0][1],
          ),
        );
      } else if (t.name === "refreshObject") {
        task = m(
          "span.text-stone-900 inline-flex max-w-full gap-2",
          "Refresh",
          m(
            "span",
            {
              title: t.parameterName,
              dir: "rtl",
              class: "italic pr-1 min-w-0 truncate",
            },
            t.parameterName,
          ),
        );
      } else if (t.name === "reboot") {
        task = m("span.text-stone-900", "Reboot");
      } else if (t.name === "factoryReset") {
        task = m("span.text-stone-900", "Factory reset");
      } else if (t.name === "addObject") {
        task = m(
          "span.text-stone-900 inline-flex max-w-full gap-2",
          "Add",
          m(
            "span",
            {
              title: t.objectName,
              dir: "rtl",
              class: "italic pr-1 min-w-0 truncate",
            },
            t.objectName,
          ),
        );
      } else if (t.name === "deleteObject") {
        task = m(
          "span.text-stone-900 inline-flex max-w-full gap-2",
          "Delete",
          m(
            "span",
            {
              title: t.objectName,
              dir: "rtl",
              class: "italic pr-1 min-w-0 truncate",
            },
            t.objectName,
          ),
        );
      } else if (t.name === "getParameterValues") {
        task = m(
          "span.text-stone-900",
          `Refresh ${t.parameterNames.length} parameters`,
        );
      } else if (t.name === "download") {
        task = m(
          "span.text-stone-900",
          `Push file: ${t.fileName} (${t.fileType})`,
        );
      } else {
        task = m("span.text-stone-900", t.name);
      }

      let bgDiv: ReturnType<typeof m>;
      if (t.status === "pending") {
        bgDiv = m(
          "div.block absolute inset-0 bg-emerald-200 rounded-sm animate-pulse",
          "",
        );
      } else if (t.status === "fault") {
        bgDiv = m("div.block absolute inset-0 bg-red-200 rounded-sm", "");
      } else if (t.status === "stale") {
        bgDiv = m("div.block absolute inset-0 bg-stone-200 rounded-sm", "");
      }

      details.push(
        m(
          "div.flex justify-between w-full rounded-sm items-center relative",
          bgDiv,
          m("div.overflow-hidden relative", task),
          m("div.flex whitespace-nowrap gap-2 ml-2 relative", actions),
        ),
      );
    }
  }

  return details;
}

function renderNotifications(notifs): Child[] {
  const notificationElements: Child[] = [];

  for (const n of notifs) {
    let notifColors = "",
      buttonColors = "";
    if (n.type === "success") {
      notifColors = "bg-emerald-50 text-emerald-800 border-emerald-100";
      buttonColors =
        "hover:bg-emerald-100 text-emerald-800 focus:ring-offset-emerald-50 focus:ring-emerald-600";
    } else if (n.type === "error") {
      notifColors = "bg-red-50 text-red-800 border-red-100";
      buttonColors =
        "hover:bg-red-100 text-red-800 focus:ring-offset-red-50 focus:ring-red-600";
    } else if (n.type === "warning") {
      notifColors = "bg-yellow-50 text-yellow-800 border-yellow-100";
      buttonColors =
        "hover:bg-yellow-100 text-yellow-800 focus:ring-offset-yellow-50 focus:ring-yellow-600";
    }

    let buttons;
    if (n.actions) {
      const btns = Object.entries(n.actions).map(([label, onclick]) =>
        m(
          "button",
          {
            class:
              "ml-2 px-2 py-1.5 -my-1.5 rounded-md text-sm font-medium focus:outline-hidden focus:ring-2 focus:ring-offset-2 " +
              buttonColors,
            onclick: onclick,
          },
          label,
        ),
      );
      if (btns.length) buttons = m("div", btns);
    }

    notificationElements.push(
      m(
        "div",
        {
          class:
            "absolute flex justify-between rounded-md w-full text-sm shadow-md p-4 border transition-[top,opacity] " +
            notifColors,
          style: "opacity: 0",
          oncreate: (vnode) => {
            (vnode.dom as HTMLDivElement).style.opacity = "1";
          },
          onbeforeremove: (vnode) => {
            (vnode.dom as HTMLDivElement).style.opacity = "0";
            return new Promise<void>((resolve) => {
              setTimeout(() => {
                resolve();
              }, 500);
            });
          },
          key: n.timestamp,
        },
        n.message,
        buttons,
      ),
    );
  }
  return notificationElements;
}

const component: ClosureComponent = (): Component => {
  return {
    view: (vnode) => {
      const queue = getQueue();
      const staging = getStaging();
      const notifs = notifications.getNotifications();

      let drawerElement, statusElement;
      const notificationElements = renderNotifications(notifs);
      const stagingElements = renderStaging(staging);
      const queueElements = renderQueue(queue);

      function repositionNotifications(): void {
        let top = 16;
        for (const c of notificationElements as VnodeDOM[]) {
          (c.dom as HTMLDivElement).style.top = `${top}px`;
          top += (c.dom as HTMLDivElement).offsetHeight + 16;
        }
      }

      function resizeDrawer(): void {
        let height =
          statusElement.dom.offsetTop + statusElement.dom.offsetHeight;
        if (stagingElements.length) {
          for (const s of stagingElements as VnodeDOM[]) {
            height = Math.max(
              height,
              (s.dom as HTMLDivElement).offsetTop +
                (s.dom as HTMLDivElement).offsetHeight,
            );
          }
        } else if (vnode.state["mouseIn"]) {
          for (const c of drawerElement.children)
            height = Math.max(height, c.dom.offsetTop + c.dom.offsetHeight);
        }
        drawerElement.dom.style.height = height + "px";
      }

      if (stagingElements.length + queueElements.length) {
        const statusCount = { queued: 0, pending: 0, fault: 0, stale: 0 };
        for (const t of queue) statusCount[t["status"]] += 1;

        const actions = m(
          "div.flex ml-auto gap-2",
          m(
            "button",
            {
              class:
                "px-2.5 py-1.5 -my-1.5 border border-stone-300 shadow-xs text-xs font-medium rounded-sm text-stone-700 bg-white hover:bg-stone-50 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed",
              title: "Clear tasks",
              onclick: clear,
              disabled: !queueElements.length,
            },
            "Clear",
          ),
          m(
            "button",
            {
              class:
                "px-2.5 py-1.5 -my-1.5 border border-transparent text-xs font-medium rounded-sm shadow-xs text-white bg-cyan-600 hover:bg-cyan-700 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed",
              title: "Commit queued tasks",
              disabled: !statusCount.queued,
              onclick: () => {
                const tasks = Array.from(getQueue()).filter(
                  (t) => t["status"] === "queued",
                );
                commit(
                  tasks,
                  (deviceId, err, connectionRequestStatus, tasks2) => {
                    if (err) {
                      notifications.push(
                        "error",
                        `${deviceId}: ${err.message}`,
                      );
                      return;
                    }

                    if (connectionRequestStatus !== "OK") {
                      notifications.push(
                        "error",
                        `${deviceId}: ${connectionRequestStatus}`,
                      );
                      return;
                    }

                    for (const t of tasks2) {
                      if (t.status === "stale") {
                        notifications.push(
                          "error",
                          `${deviceId}: No contact from device`,
                        );
                        return;
                      } else if (t.status === "fault") {
                        notifications.push(
                          "error",
                          `${deviceId}: Task(s) faulted`,
                        );
                        return;
                      }
                    }

                    notifications.push(
                      "success",
                      `${deviceId}: Task(s) committed`,
                    );
                  },
                )
                  .then(() => {
                    store.setTimestamp(Date.now());
                  })
                  .catch((err) => {
                    notifications.push("error", err.message);
                  });
              },
            },
            "Commit",
          ),
        );

        statusElement = m(
          "div.flex p-4 gap-5 items-center text-sm",
          m(
            "span.text-stone-700 -mx-1 px-1",
            { class: statusCount.queued ? "font-semibold" : "" },
            `Queued: ${statusCount.queued}`,
          ),
          m(
            "span.text-stone-700 relative",
            statusCount.pending
              ? m(
                  "div.block absolute -inset-x-1 inset-y-0 rounded-sm bg-emerald-200 animate-pulse",
                  "",
                )
              : null,
            m("span.relative", `Pending: ${statusCount.pending}`),
          ),
          m(
            "span.text-stone-700 relative",
            m("span.relative", `Fault: ${statusCount.fault}`),
          ),
          m(
            "span.text-stone-700 relative",
            statusCount.stale
              ? m(
                  "div.block absolute -inset-x-1 inset-y-0 rounded-sm bg-stone-200",
                  "",
                )
              : null,
            m("span.relative", `Stale: ${statusCount.stale}`),
          ),
          actions,
        );

        drawerElement = m(
          "div",
          {
            class:
              "w-[48rem] mx-auto pointer-events-auto bg-white rounded-b-lg border-stone-300 border-x border-b shadow-md overflow-hidden transition-[height] -mt-px",
            key: "drawer",
            style: "opacity: 0;height: 0;",
            oncreate: (vnode2) => {
              vnode.state["mouseIn"] = false;
              (vnode2.dom as HTMLDivElement).style.opacity = "1";
              resizeDrawer();
            },
            onmouseenter: (e) => {
              if (drawerElement.dom.style.opacity === "0") return;
              vnode.state["mouseIn"] = true;
              resizeDrawer();
              e.redraw = false;
            },
            onmouseleave: (e) => {
              if (drawerElement.dom.style.opacity === "0") return;
              vnode.state["mouseIn"] = false;
              resizeDrawer();
              e.redraw = false;
            },
            onupdate: resizeDrawer,
            onbeforeremove: (vnode2) => {
              (vnode2.dom as HTMLDivElement).style.opacity = "0";
              (vnode2.dom as HTMLDivElement).style.height = "0";
              return new Promise((resolve) => {
                setTimeout(resolve, 500);
              });
            },
          },
          statusElement,
          stagingElements.length
            ? stagingElements
            : m("div.px-4 pb-4 text-sm", queueElements),
        );
      }

      return m(
        "div.fixed pointer-events-none inset-0 z-30",
        drawerElement,
        m(
          "div",
          {
            class: "relative w-[48rem] mx-auto pointer-events-auto",
            key: "notifications",
            onupdate: repositionNotifications,
            oncreate: repositionNotifications,
          },
          notificationElements,
        ),
      );
    },
  };
};

export default component;
