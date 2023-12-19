import { Attributes, ClosureComponent } from "mithril";
import { map } from "../../lib/common/expression/parser.ts";
import memoize from "../../lib/common/memoize.ts";
import { Expression } from "../../lib/types.ts";
import { m } from "../components.ts";
import { evaluateExpression, getTimestamp } from "../store.ts";
import { FlatDevice } from "../../lib/ui/db.ts";

const evaluateAttributes = memoize(
  (
    attrs: Record<string, Expression>,
    obj: Record<string, unknown>,
    now: number, // eslint-disable-line @typescript-eslint/no-unused-vars
  ): Attributes => {
    const res: Attributes = {};
    for (const [k, v] of Object.entries(attrs)) {
      const vv = map(v, (e) => {
        if (
          Array.isArray(e) &&
          e[0] === "FUNC" &&
          e[1] === "ENCODEURICOMPONENT"
        ) {
          const a = evaluateExpression(e[2], obj);
          if (a == null) return null;
          return encodeURIComponent(a as string);
        }
        return e;
      });
      res[k] = evaluateExpression(vv, obj);
    }
    return res;
  },
);

interface Attrs {
  device: FlatDevice;
  filter: Expression;
  components: unknown;
}

const component: ClosureComponent<Attrs> = () => {
  return {
    view: (vnode) => {
      const device = vnode.attrs.device;
      if ("filter" in vnode.attrs) {
        if (!evaluateExpression(vnode.attrs.filter, device || {})) return null;
      }

      const children = Object.values(vnode.attrs.components).map((c) => {
        if (Array.isArray(c)) c = evaluateExpression(c, device || {});
        if (typeof c !== "object") return `${c}`;
        const type = evaluateExpression(c["type"], device || {});
        if (!type) return null;
        return m(type as string, c);
      });

      let el = vnode.attrs["element"];

      if (el == null) return children;

      let attrs: Attributes;
      if (Array.isArray(el)) {
        el = evaluateExpression(el, device || {});
      } else if (typeof el === "object") {
        if (el["attributes"] != null) {
          attrs = evaluateAttributes(
            el["attributes"],
            device || {},
            getTimestamp(),
          );
        }

        el = evaluateExpression(el["tag"], device || {});
      }

      return m(el, attrs, children);
    },
  };
};

export default component;
