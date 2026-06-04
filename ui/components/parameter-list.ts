import { ClosureComponent, VnodeDOM } from "../mithril-compat.ts";
import { m } from "../components.ts";
import { QueryResponse } from "../legacy-store.ts";
import { evaluateExpression } from "../reactive-store.ts";
import { FlatDevice } from "../../lib/ui/db.ts";
import Expression from "../../lib/common/expression.ts";

interface Attrs {
  device: FlatDevice;
  parameters: Record<
    string,
    { type?: Expression; label: Expression; parameter: Expression }
  >;
  deviceQuery: QueryResponse;
}

const component: ClosureComponent<Attrs> = () => {
  return {
    view: (vnode) => {
      const device = vnode.attrs.device;

      const rows = Object.values(vnode.attrs.parameters).map((parameter) => {
        let type = "parameter";
        if (parameter.type) {
          const t = evaluateExpression(parameter.type, device);
          if (typeof t.value === "string") type = t.value;
        }
        const p = m.context(
          {
            device: device,
            parameter: parameter.parameter,
          },
          (type as string) || "parameter",
          parameter,
        );

        return m(
          "div.py-3 grid grid-cols-3 gap-4 px-6",
          {
            oncreate: (vn: VnodeDOM) => {
              (vn.dom as HTMLElement).style.display = (p as VnodeDOM).dom
                ? ""
                : "none";
            },
            onupdate: (vn: VnodeDOM) => {
              (vn.dom as HTMLElement).style.display = (p as VnodeDOM).dom
                ? ""
                : "none";
            },
          },
          m(
            "dt.text-sm font-medium text-stone-500",
            evaluateExpression(parameter["label"], device).value,
          ),
          m("dd.text-sm text-stone-900 col-span-2", p),
        );
      });

      return m(
        "loading",
        { queries: [vnode.attrs.deviceQuery] },
        m(
          "dl.bg-white shadow-sm overflow-hidden rounded-lg w-max py-1",
          { class: "[&>*+*]:border-t [&>*+*]:border-stone-200" },
          rows,
        ),
      );
    },
  };
};

export default component;
