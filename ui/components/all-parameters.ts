import { ClosureComponent } from "mithril";
import { m } from "../components.ts";
import * as taskQueue from "../task-queue.ts";
import { parse } from "../../lib/common/expression/parser.ts";
import memoize from "../../lib/common/memoize.ts";
import { icon } from "../tailwind-utility-components.ts";
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

      const search = m(
        "input.appearance-none border-0 block w-full px-4 py-3 border-stone-300 placeholder-stone-500 text-stone-900 focus:ring-cyan-500 text-sm rounded-t-lg font-mono focus:ring-2",
        {
          type: "text",
          placeholder: "Search parameters",
          oninput: (e) => {
            formQueryString(e.target.value);
            e.redraw = false;
          },
        },
      );

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
                m(icon, {
                  name: "delete-instance",
                  class:
                    "inline h-4 w-4 ml-1 text-cyan-700 hover:text-cyan-900",
                }),
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
                m(icon, {
                  name: "add-instance",
                  class:
                    "inline h-4 w-4 ml-1 text-cyan-700 hover:text-cyan-900",
                }),
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
            m(icon, {
              name: "refresh",
              class: "inline h-4 w-4 ml-1 text-cyan-700 hover:text-cyan-900",
            }),
          ),
        );

        return m(
          "tr",
          m("td.pl-4 pr-2 py-2 truncate", m("long-text", { text: k })),
          m("td.pr-4 py-2 text-right flex justify-end", val),
        );
      });

      return m(
        "loading",
        { queries: [vnode.attrs.deviceQuery] },
        m(
          ".bg-white shadow-sm rounded-lg",
          search,
          m(
            ".overflow-hidden",
            m(
              ".overflow-y-scroll h-96 shadow-inner",
              m(
                "table.w-full table-fixed font-mono text-xs text-stone-900",
                m("tbody.divide-y divide-stone-200", rows),
              ),
            ),
            m(
              "div.text-stone-700 px-4 py-3 flex justify-between items-end",
              m(
                "span.text-xs",
                "Displaying ",
                m("span.font-medium", "" + filteredKeys.length),
                " out of ",
                m("span.font-medium", "" + count),
                " parameters",
              ),
              m(
                "a.text-cyan-700 hover:text-cyan-900 text-sm font-medium",
                {
                  href: `api/devices/${encodeURIComponent(
                    device["DeviceID.ID"].value[0],
                  )}.csv`,
                  download: "",
                },
                "Download",
              ),
            ),
          ),
        ),
      );
    },
  };
};

export default component;
