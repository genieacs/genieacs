import { div, span, button, select, option, input, h3, each } from "./dom.ts";
import { fetch as reactiveFetch, invalidate } from "./reactive-store.ts";
import { setTimestamp } from "./legacy-store.ts";
import * as notifications from "./notifications.ts";
import { createIcon } from "./icons.ts";
import {
  bumpStagingVersion,
  clear,
  commit,
  deleteTask,
  getQueue,
  getStaging,
  QueueTask,
  queueTask,
  queueVersion,
  stagingVersion,
  StageTask,
} from "./task-queue.ts";
import Expression from "../lib/common/expression.ts";

// Stable per-task ids so `each` can preserve DOM across re-renders:
// — staging items keep input focus/cursor while you type
// — queue rows keep their status-bar identity instead of being torn down and
//   recreated on every status tick.
let nextStagingId = 0;
const stagingIds = new WeakMap<StageTask, number>();
function getStagingId(s: StageTask): number {
  let id = stagingIds.get(s);
  if (id === undefined) {
    id = ++nextStagingId;
    stagingIds.set(s, id);
  }
  return id;
}

let nextQueueTaskId = 0;
const queueTaskIds = new WeakMap<QueueTask, number>();
function getQueueTaskId(t: QueueTask): number {
  let id = queueTaskIds.get(t);
  if (id === undefined) {
    id = ++nextQueueTaskId;
    queueTaskIds.set(t, id);
  }
  return id;
}

// Flat list of heading + task entries — lets a single `each` interleave both
// while keeping per-task and per-device-header DOM identity.
type QueueItem =
  | { kind: "header"; deviceId: string }
  | { kind: "task"; task: QueueTask };

function buildQueueItems(): QueueItem[] {
  const byDevice = new Map<string, QueueTask[]>();
  for (const t of getQueue()) {
    let arr = byDevice.get(t.device);
    if (!arr) byDevice.set(t.device, (arr = []));
    arr.push(t);
  }
  const items: QueueItem[] = [];
  for (const [deviceId, tasks] of byDevice) {
    items.push({ kind: "header", deviceId });
    for (const task of tasks) items.push({ kind: "task", task });
  }
  return items;
}

function renderStagingSpv(
  task: StageTask,
  queueFunc: () => void,
  cancelFunc: () => void,
): HTMLElement {
  const pv = task.parameterValues?.[0];
  if (!pv) throw new Error("Invalid setParameterValues task");
  const name = pv[0];
  const type = pv[2];

  function keydown(e: KeyboardEvent): void {
    if (e.key === "Enter") queueFunc();
    else if (e.key === "Escape") cancelFunc();
  }

  let inputEl: HTMLInputElement | HTMLSelectElement;

  if (type === "xsd:boolean") {
    const current = String(pv[1]);
    inputEl = select(
      {
        class:
          "mt-1 w-full block pl-3 pr-10 py-2 text-base border-stone-300 focus:outline-hidden focus:ring-cyan-500 focus:border-cyan-500 sm:text-sm rounded-md",
        onchange: (e) => {
          pv[1] = (e.target as HTMLSelectElement).value;
        },
        onkeydown: keydown,
        onMount: (el) => {
          requestAnimationFrame(() => {
            // preventScroll avoids the browser auto-scrolling the
            // overflow-hidden drawer mid height-animation.
            (el as HTMLSelectElement).focus({ preventScroll: true });
          });
        },
      },
      option({ value: "true", selected: current === "true" }, "true"),
      option({ value: "false", selected: current === "false" }, "false"),
    );
  } else {
    let value = pv[1];
    if (type === "xsd:dateTime" && typeof value === "number")
      value = new Date(value).toJSON() || value;

    inputEl = input({
      type:
        type === "xsd:int" || type === "xsd:unsignedInt" ? "number" : "text",
      value: value as string,
      class:
        "mt-1 w-full shadow-xs focus:ring-cyan-500 focus:border-cyan-500 block sm:text-sm border-stone-300 rounded-md",
      oninput: (e) => {
        pv[1] = (e.target as HTMLInputElement).value;
      },
      onkeydown: keydown,
      onMount: (el) => {
        requestAnimationFrame(() => {
          (el as HTMLInputElement).focus({ preventScroll: true });
          (el as HTMLInputElement).select();
        });
      },
    });
  }

  return div(
    {},
    span(
      { class: "text-sm text-stone-700 inline-flex max-w-full gap-2" },
      "Editing",
      span(
        {
          title: name,
          dir: "rtl",
          class: "italic pr-1 min-w-0 truncate",
        },
        name,
      ),
    ),
    inputEl,
  );
}

function renderStagingDownload(
  task: StageTask,
  onUpdate: () => void,
): HTMLElement {
  const filesState = reactiveFetch("files", new Expression.Literal(true)).get();
  const filesValue = filesState.value as Record<string, unknown>[];
  let oui: string | null = "";
  let productClass: string | null = "";
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
      ...filesValue
        .map((f) => f["metadata.fileType"] as string)
        .filter((f) => f),
    ]),
  ];

  const filesList = [""].concat(
    filesValue
      .filter(
        (f) =>
          (!f["metadata.oui"] || f["metadata.oui"] === oui) &&
          (!f["metadata.productClass"] ||
            f["metadata.productClass"] === productClass),
      )
      .map((f) => f._id as string),
  );

  return div(
    { class: "flex items-center gap-2 text-sm text-stone-700 max-w-full" },
    "Push",
    select(
      {
        class:
          "min-w-0 pl-3 pr-10 py-2 text-base border-stone-300 focus:outline-hidden focus:ring-cyan-500 focus:border-cyan-500 sm:text-sm rounded-md",
        onchange: (e) => {
          const f = (e.target as HTMLSelectElement).value;
          task.fileName = f;
          task.fileType = "";
          for (const file of filesValue)
            if (file._id === f)
              task.fileType = file["metadata.fileType"] as string;
          onUpdate();
        },
        disabled: filesState.loading,
      },
      ...filesList.map((f) =>
        option(
          { disabled: !f, value: f, selected: (task.fileName || "") === f },
          f,
        ),
      ),
    ),
    "as",
    select(
      {
        class:
          "min-w-0 pl-3 pr-10 py-2 text-base border-stone-300 focus:outline-hidden focus:ring-cyan-500 focus:border-cyan-500 sm:text-sm rounded-md",
        onchange: (e) => {
          task.fileType = (e.target as HTMLSelectElement).value;
          onUpdate();
        },
      },
      ...typesList.map((t) =>
        option(
          { disabled: !t, value: t, selected: (task.fileType || "") === t },
          t,
        ),
      ),
    ),
  );
}

function renderStagingItem(s: StageTask): HTMLElement {
  const staging = getStaging();
  const queueFunc = (): void => {
    staging.delete(s);
    for (const d of s.devices) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { devices: _devices, ...rest } = s;
      queueTask({ device: d, ...rest });
    }
    bumpStagingVersion();
  };
  const cancelFunc = (): void => {
    staging.delete(s);
    bumpStagingVersion();
  };

  // Download body is wrapped in a function child so dropdown options refresh
  // when the files query resolves, and when the user changes a selection
  // (which bumps stagingVersion).
  let elContainer: HTMLElement | (() => HTMLElement);
  if (s.name === "setParameterValues") {
    elContainer = renderStagingSpv(s, queueFunc, cancelFunc);
  } else if (s.name === "download") {
    elContainer = () => {
      stagingVersion.get();
      return renderStagingDownload(s, bumpStagingVersion);
    };
  } else {
    elContainer = div();
  }

  return div(
    { class: "p-4" },
    elContainer,
    div(
      { class: "flex mt-4 justify-center gap-4" },
      button(
        {
          class:
            "px-2.5 py-1.5 border border-stone-300 shadow-xs text-xs font-medium rounded-sm text-stone-700 bg-white hover:bg-stone-50 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-cyan-500",
          title: "Cancel edit",
          onclick: cancelFunc,
        },
        "Cancel",
      ),
      button(
        {
          class:
            "px-2.5 py-1.5 border border-transparent text-xs font-medium rounded-sm shadow-xs text-white bg-cyan-600 hover:bg-cyan-700 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-cyan-500 disabled:cursor-not-allowed disabled:opacity-50",
          title: "Queue task",
          onclick: queueFunc,
          disabled: () => {
            stagingVersion.get();
            return s.name === "download" && (!s.fileName || !s.fileType);
          },
        },
        "Queue",
      ),
    ),
  );
}

function renderTaskRow(t: QueueTask): HTMLElement {
  // Retry button is always in the DOM; the reactive class hides it for any
  // status other than fault/stale. Keeping it mounted lets `each` preserve
  // the row across status ticks instead of rebuilding action buttons.
  const retryBtn = button(
    {
      class: () => {
        queueVersion.get();
        return t.status === "fault" || t.status === "stale" ? "" : "hidden";
      },
      title: "Retry this task",
      onclick: () => queueTask(t),
    },
    createIcon({
      name: "retry",
      class: "inline h-4 w-4 text-cyan-700 hover:text-cyan-900",
    }),
  );

  const removeBtn = button(
    {
      title: "Remove this task",
      onclick: () => deleteTask(t),
    },
    createIcon({
      name: "remove",
      class: "inline h-4 w-4 text-cyan-700 hover:text-cyan-900",
    }),
  );

  let taskEl: HTMLElement;
  if (t.name === "setParameterValues") {
    const pv = t.parameterValues?.[0];
    if (!pv) throw new Error("Invalid setParameterValues task");
    const valueStr = String(pv[1]);
    taskEl = span(
      { class: "text-stone-900 inline-flex max-w-full gap-2" },
      "Set",
      span(
        {
          title: pv[0],
          dir: "rtl",
          class: "italic pr-1 min-w-0 truncate",
        },
        pv[0],
      ),
      "to",
      span(
        {
          title: valueStr,
          class: "min-w-0 truncate",
        },
        valueStr,
      ),
    );
  } else if (t.name === "refreshObject") {
    taskEl = span(
      { class: "text-stone-900 inline-flex max-w-full gap-2" },
      "Refresh",
      span(
        {
          title: t.objectName,
          dir: "rtl",
          class: "italic pr-1 min-w-0 truncate",
        },
        t.objectName,
      ),
    );
  } else if (t.name === "reboot") {
    taskEl = span({ class: "text-stone-900" }, "Reboot");
  } else if (t.name === "factoryReset") {
    taskEl = span({ class: "text-stone-900" }, "Factory reset");
  } else if (t.name === "addObject") {
    taskEl = span(
      { class: "text-stone-900 inline-flex max-w-full gap-2" },
      "Add",
      span(
        {
          title: t.objectName,
          dir: "rtl",
          class: "italic pr-1 min-w-0 truncate",
        },
        t.objectName,
      ),
    );
  } else if (t.name === "deleteObject") {
    taskEl = span(
      { class: "text-stone-900 inline-flex max-w-full gap-2" },
      "Delete",
      span(
        {
          title: t.objectName,
          dir: "rtl",
          class: "italic pr-1 min-w-0 truncate",
        },
        t.objectName,
      ),
    );
  } else if (t.name === "getParameterValues") {
    taskEl = span(
      { class: "text-stone-900" },
      `Refresh ${t.parameterNames!.length} parameters`,
    );
  } else if (t.name === "download") {
    taskEl = span(
      { class: "text-stone-900" },
      `Push file: ${t.fileName} (${t.fileType})`,
    );
  } else {
    taskEl = span({ class: "text-stone-900" }, t.name);
  }

  // Single bg div with a reactive class — status changes only swap classes,
  // they don't recreate any DOM.
  const bgDiv = div({
    class: () => {
      queueVersion.get();
      if (t.status === "pending")
        return "block absolute inset-0 bg-emerald-200 rounded-sm animate-pulse";
      if (t.status === "fault")
        return "block absolute inset-0 bg-red-200 rounded-sm";
      if (t.status === "stale")
        return "block absolute inset-0 bg-stone-200 rounded-sm";
      return "hidden";
    },
  });

  return div(
    { class: "flex justify-between w-full rounded-sm items-center relative" },
    bgDiv,
    div({ class: "overflow-hidden relative z-10" }, taskEl),
    div(
      { class: "flex whitespace-nowrap gap-2 ml-2 relative z-10" },
      retryBtn,
      removeBtn,
    ),
  );
}

function renderNotification(n: notifications.Notification): HTMLElement {
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

  let buttonsDiv: HTMLElement | null = null;
  if (n.actions) {
    const btns = Object.entries(n.actions).map(([label, onclick]) =>
      button(
        {
          class:
            "ml-2 px-2 py-1.5 -my-1.5 rounded-md text-sm font-medium focus:outline-hidden focus:ring-2 focus:ring-offset-2 " +
            buttonColors,
          onclick: onclick as () => void,
        },
        label,
      ),
    );
    if (btns.length) buttonsDiv = div({}, ...btns);
  }

  return div(
    {
      class:
        "absolute flex justify-between rounded-md w-full text-sm shadow-md p-4 border transition-[top,opacity] " +
        notifColors,
      style: "opacity: 0",
    },
    n.message,
    buttonsDiv,
  );
}

function repositionNotifications(container: HTMLElement): void {
  let top = 16;
  for (const child of Array.from(container.children)) {
    const el = child as HTMLElement;
    // Skip notifications mid-fade so their slot is reclaimed immediately
    // and incoming siblings don't stack below the corpse.
    if (el.dataset.removing) continue;
    el.style.top = `${top}px`;
    top += el.offsetHeight + 16;
  }
}

export function createDrawer(): HTMLElement {
  let mouseIn = false;
  // Captured by the reactive status-bar child below. Used as a direct measure
  // target so we don't have to traverse the DOM to figure out which child is
  // the status bar.
  let statusBarEl: HTMLElement | null = null;
  let updateScheduled = false;
  // Forward-declared so helpers above can close over it; assigned below
  // before any DOM event / rAF can fire.
  // eslint-disable-next-line prefer-const
  let drawerEl!: HTMLElement;

  function resizeDrawer(): void {
    if (!statusBarEl) {
      drawerEl.style.height = "0";
      return;
    }
    const statusHeight = statusBarEl.offsetTop + statusBarEl.offsetHeight;
    // Can't use drawerEl.scrollHeight: when the explicit height is already
    // ≥ content height, scrollHeight collapses to clientHeight, so the drawer
    // would never shrink. Walk laid-out descendants and take the bottom edge.
    let fullHeight = 0;
    const walk = (parent: Element): void => {
      for (const c of Array.from(parent.children)) {
        const el = c as HTMLElement;
        const display = getComputedStyle(el).display;
        if (display === "none") continue;
        if (display === "contents") {
          walk(el);
          continue;
        }
        const bottom = el.offsetTop + el.offsetHeight;
        if (bottom > fullHeight) fullHeight = bottom;
      }
    };
    walk(drawerEl);
    // Expand to show staging items (always) or queue list (only on hover).
    const expand = mouseIn || getStaging().size > 0;
    drawerEl.style.height = (expand ? fullHeight : statusHeight) + "px";
  }

  // Coalesce reactive ticks into a single rAF per frame. The callback reads
  // statusBarEl at fire time, so it picks up whatever the latest state is —
  // intermediate flip-flops between empty/non-empty don't matter.
  function scheduleDrawerUpdate(): void {
    if (updateScheduled) return;
    updateScheduled = true;
    requestAnimationFrame(() => {
      updateScheduled = false;
      drawerEl.style.opacity = statusBarEl ? "1" : "0";
      resizeDrawer();
    });
  }

  // Notification list container ref for repositioning. Placed after drawerEl
  // in normal flow so its absolute children sit below the drawer rather than
  // over it (the container itself collapses to 0 layout height).
  const notifContainer: HTMLElement = div(
    { class: "relative w-[48rem] mx-auto pointer-events-auto" },
    each<notifications.Notification>(
      notifications.getSignal(),
      (n) => n.timestamp,
      (n) => renderNotification(n),
      {
        onAdd: (node) => {
          const el = node as HTMLElement;
          requestAnimationFrame(() => {
            el.style.opacity = "1";
            repositionNotifications(notifContainer);
          });
        },
        onRemove: (node) => {
          const el = node as HTMLElement;
          el.dataset.removing = "1";
          el.style.opacity = "0";
          // Reflow remaining notifications up now; the dying one fades in
          // place via its top/opacity transition.
          repositionNotifications(notifContainer);
          return new Promise((resolve) => setTimeout(resolve, 500));
        },
      },
    ),
  );

  drawerEl = div(
    {
      class:
        "relative w-[48rem] mx-auto pointer-events-auto bg-white rounded-b-lg border-stone-300 border-x border-b shadow-md overflow-hidden transition-[height] -mt-px",
      style: "height: 0; opacity: 0;",
      onmouseenter: () => {
        mouseIn = true;
        resizeDrawer();
      },
      onmouseleave: () => {
        mouseIn = false;
        resizeDrawer();
      },
    },
    div({ style: "display:contents" }, () => {
      queueVersion.get();
      stagingVersion.get();
      const queue = getQueue();
      const staging = getStaging();
      if (queue.size + staging.size === 0) {
        statusBarEl = null;
        scheduleDrawerUpdate();
        return null;
      }

      // Status counts
      const statusCount = { queued: 0, pending: 0, fault: 0, stale: 0 };
      for (const t of queue)
        statusCount[t.status as keyof typeof statusCount] += 1;

      // Status bar
      const statusBar = div(
        { class: "flex p-4 gap-5 items-center text-sm" },
        span(
          {
            class:
              "text-stone-700 -mx-1 px-1" +
              (statusCount.queued ? " font-semibold" : ""),
          },
          `Queued: ${statusCount.queued}`,
        ),
        span(
          { class: "text-stone-700 relative" },
          statusCount.pending
            ? div({
                class:
                  "block absolute -inset-x-1 inset-y-0 rounded-sm bg-emerald-200 animate-pulse",
              })
            : null,
          span({ class: "relative z-10" }, `Pending: ${statusCount.pending}`),
        ),
        span(
          { class: "text-stone-700 relative" },
          span({ class: "relative" }, `Fault: ${statusCount.fault}`),
        ),
        span(
          { class: "text-stone-700 relative" },
          statusCount.stale
            ? div({
                class:
                  "block absolute -inset-x-1 inset-y-0 rounded-sm bg-stone-200",
              })
            : null,
          span({ class: "relative z-10" }, `Stale: ${statusCount.stale}`),
        ),
        div(
          { class: "flex ml-auto gap-2" },
          button(
            {
              class:
                "px-2.5 py-1.5 -my-1.5 border border-stone-300 shadow-xs text-xs font-medium rounded-sm text-stone-700 bg-white hover:bg-stone-50 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed",
              title: "Clear tasks",
              onclick: () => clear(),
              disabled: queue.size === 0,
            },
            "Clear",
          ),
          button(
            {
              class:
                "px-2.5 py-1.5 -my-1.5 border border-transparent text-xs font-medium rounded-sm shadow-xs text-white bg-cyan-600 hover:bg-cyan-700 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed",
              title: "Commit queued tasks",
              disabled: statusCount.queued === 0,
              onclick: () => {
                const tasks = Array.from(getQueue()).filter(
                  (t) => t.status === "queued",
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
                    setTimestamp(Date.now());
                    invalidate(Date.now());
                  })
                  .catch((err) => {
                    notifications.push("error", err.message);
                  });
              },
            },
            "Commit",
          ),
        ),
      );

      statusBarEl = statusBar;
      scheduleDrawerUpdate();
      return statusBar;
    }),
    each<StageTask>(
      () => {
        stagingVersion.get();
        return [...getStaging()];
      },
      getStagingId,
      (s) => renderStagingItem(s),
    ),
    // Queue list — rendered via each() outside the reactive wrapper so rows
    // (and their reactive bg/retry classes) persist across status ticks
    // instead of being torn down and rebuilt. Hidden via class while staging
    // is open so the each's DOM stays mounted for instant restore.
    div(
      {
        class: () => {
          queueVersion.get();
          stagingVersion.get();
          return getStaging().size === 0 && getQueue().size > 0
            ? "px-4 pb-4 text-sm"
            : "hidden";
        },
      },
      each<QueueItem>(
        () => {
          queueVersion.get();
          return buildQueueItems();
        },
        (item) =>
          item.kind === "header"
            ? `h:${item.deviceId}`
            : `t:${getQueueTaskId(item.task)}`,
        (item) =>
          item.kind === "header"
            ? h3({ class: "font-semibold text-stone-700" }, item.deviceId)
            : renderTaskRow(item.task),
        // buildQueueItems() creates fresh wrapper objects on every tick while
        // rows update reactively via queueVersion — identity-based re-render
        // would needlessly rebuild every row on every tick.
        // TODO: refactor task-queue to immutable updates through a signal
        // (like reactive-store) and restructure this flat list as nested
        // each()s (device → tasks); then drop this opt-out.
        { rerenderOnChange: false },
      ),
    ),
  );

  return div(
    { class: "fixed pointer-events-none inset-0 z-30" },
    drawerEl,
    notifContainer,
  );
}
