import { ClosureComponent } from "mithril";
import { m } from "../components.ts";
import * as taskQueue from "../task-queue.ts";
import { parse } from "../../lib/common/expression/parser.ts";
import memoize from "../../lib/common/memoize.ts";
import { getIcon } from "../icons.ts";
import { QueryResponse, evaluateExpression } from "../store.ts";
import debounce from "../../lib/common/debounce.ts";
import { Expression } from "../../lib/types.ts";
import { FlatDevice } from "../../lib/ui/db.ts";

const memoizedParse = memoize(parse);

function escapeRegExp(str): string {
  return str.replace(/[-[\]/{}()*+?.\\^$|]/g, "\\$&");
}

const keysByDepth: WeakMap<Record<string, unknown>, string[][]> = new WeakMap();

function orderKeysByDepth(device: Record<string, unknown>): string[][] {
  if (keysByDepth.has(device)) return keysByDepth.get(device);
  const res: string[][] = [];
  for (const key of Object.keys(device)) {
    let count = 0;
    for (
      let i = key.lastIndexOf(".", key.length - 2);
      i >= 0;
      i = key.lastIndexOf(".", i - 1)
    )
      ++count;
    while (res.length <= count) res.push([]);
    res[count].push(key);
  }
  keysByDepth.set(device, res);
  return res;
}

interface Attrs {
  device: FlatDevice;
  limit: Expression;
  deviceQuery: QueryResponse;
}

const component: ClosureComponent<Attrs> = () => {
  let queryString: string;
  const formQueryString = debounce((args: string[]) => {
    queryString = args[args.length - 1];
    m.redraw();
  }, 500);

  return {
    view: (vnode) => {
      const device = vnode.attrs.device;

      const limit =
        (evaluateExpression(vnode.attrs.limit, device) as number) || 100;

      const search = m("input", {
        type: "text",
        placeholder: "Search parameters",
        oninput: (e) => {
          formQueryString(e.target.value);
          e.redraw = false;
        },
      });

      const instanceRegex = /\.[0-9]+$/;
      let re;
      if (queryString) {
        const keywords = queryString.split(" ").filter((s) => s);
        if (keywords.length)
          re = new RegExp(keywords.map((s) => escapeRegExp(s)).join(".*"), "i");
      }

      const filteredKeys: string[] = [];
      const allKeys = orderKeysByDepth(device);
      let count = 0;
      for (const keys of allKeys) {
        let c = 0;
        for (const k of keys) {
          const p = device[k];
          const str = p.value?.[0] ? `${k} ${p.value[0]}` : k;
          if (re && !re.test(str)) continue;
          ++c;
          if (count < limit) filteredKeys.push(k);
        }
        count += c;
      }

      filteredKeys.sort();

      const rows = filteredKeys.map((k) => {
        const p = device[k];
        const val = [];
        const attrs = { key: k };

        if (p.object === false) {
          val.push(
            m(
              "parameter",
              Object.assign({ device: device, parameter: memoizedParse(k) }),
            ),
          );
        } else if (p.object && p.writable) {
          if (instanceRegex.test(k)) {
            val.push(
              m(
                "button",
                {
                  title: "Delete this instance",
                  onclick: () => {
                    taskQueue.queueTask({
                      name: "deleteObject",
                      device: device["DeviceID.ID"].value[0] as string,
                      objectName: k,
                    });
                  },
                },
                getIcon("delete-instance"),
              ),
            );
          } else {
            val.push(
              m(
                "button",
                {
                  title: "Create a new instance",
                  onclick: () => {
                    taskQueue.queueTask({
                      name: "addObject",
                      device: device["DeviceID.ID"].value[0] as string,
                      objectName: k,
                    });
                  },
                },
                getIcon("add-instance"),
              ),
            );
          }
        }

        val.push(
          m(
            "button",
            {
              title: "Refresh tree",
              onclick: () => {
                taskQueue.queueTask({
                  name: "getParameterValues",
                  device: device["DeviceID.ID"].value[0] as string,
                  parameterNames: [k],
                });
              },
            },
            getIcon("refresh"),
          ),
        );

        return m(
          "tr",
          attrs,
          m("td.left", m("long-text", { text: k })),
          m("td.right", val),
        );
      });

      return m(
        "loading",
        { queries: [vnode.attrs.deviceQuery] },
        m(
          ".all-parameters",
          m(
            "a.download-csv",
            {
              href: `api/devices/${encodeURIComponent(
                device["DeviceID.ID"].value[0],
              )}.csv`,
              download: "",
              style: "float: right;",
            },
            "Download",
          ),
          search,
          m(
            ".parameter-list",
            m("table", m("tbody", rows)),
            m(
              "m",
              `Displaying ${filteredKeys.length} out of ${count} parameters.`,
            ),
          ),
        ),
      );
    },
  };
};

export default component;
