import { ClosureComponent } from "mithril";
import { m } from "../components.ts";
import * as taskQueue from "../task-queue.ts";
import memoize from "../../lib/common/memoize.ts";
import { icon } from "../tailwind-utility-components.ts";
import { QueryResponse, evaluateExpression } from "../store.ts";
import debounce from "../../lib/common/debounce.ts";
import Expression, { Value } from "../../lib/common/expression.ts";
import { FlatDevice } from "../../lib/ui/db.ts";
import Path from "../../lib/common/path.ts";

function escapeRegExp(str): string {
  return str.replace(/[-[\]/{}()*+?.\\^$|]/g, "\\$&");
}

interface Parameter {
  path: Expression.Parameter;
  value?: Value;
  writable?: boolean;
  object?: boolean;
}

const prepareParams = memoize((device: FlatDevice): Parameter[][] => {
  const map = new Map<string, Parameter>();

  for (const [k, v] of Object.entries(device)) {
    const [param, attr] = k.split(":");
    let attrs = map.get(param);
    if (!attrs)
      map.set(
        param,
        (attrs = { path: new Expression.Parameter(Path.parse(param)) }),
      );
    attrs[attr || "value"] = v;
  }

  const res: Parameter[][] = [];
  for (const [key, attrs] of map) {
    let count = 0;
    for (
      let i = key.lastIndexOf(".", key.length - 2);
      i >= 0;
      i = key.lastIndexOf(".", i - 1)
    )
      ++count;
    while (res.length <= count) res.push([]);
    res[count].push(attrs);
  }
  return res;
});

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
      const allParams = prepareParams(device);

      let limit = 100;
      if (vnode.attrs.limit) {
        const l = evaluateExpression(vnode.attrs.limit, device);
        if (typeof l.value === "number") limit = l.value;
      }

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

      const filteredParams: Parameter[] = [];
      let count = 0;
      for (const keys of allParams) {
        let c = 0;
        for (const k of keys) {
          const str = k.value ? `${k.path.toString()} ${k.value}` : k;
          if (re && !re.test(str)) continue;
          ++c;
          if (count < limit) filteredParams.push(k);
        }
        count += c;
      }

      filteredParams.sort((a, b) => {
        if (a.path < b.path) return -1;
        if (a.path > b.path) return 1;
        return 0;
      });

      const rows = filteredParams.map((p) => {
        const val = [];
        if (p.value) {
          val.push(
            m(
              "parameter",
              Object.assign({ device: device, parameter: p.path }),
            ),
          );
        } else if (p.object && p.writable) {
          if (instanceRegex.test(p.path.toString())) {
            val.push(
              m(
                "button",
                {
                  title: "Delete this instance",
                  onclick: () => {
                    taskQueue.queueTask({
                      name: "deleteObject",
                      device: device["DeviceID.ID"] as string,
                      objectName: p.path.toString(),
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
                      device: device["DeviceID.ID"] as string,
                      objectName: p.path.toString(),
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
                  device: device["DeviceID.ID"] as string,
                  parameterNames: [p.path.toString()],
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
          m(
            "td.pl-4 pr-2 py-2 truncate",
            m("long-text", { text: p.path.toString() }),
          ),
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
                m("span.font-medium", "" + filteredParams.length),
                " out of ",
                m("span.font-medium", "" + count),
                " parameters",
              ),
              m(
                "a.text-cyan-700 hover:text-cyan-900 text-sm font-medium",
                {
                  href: `api/devices/${encodeURIComponent(
                    device["DeviceID.ID"],
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
