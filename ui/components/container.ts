import { Attributes, ClosureComponent } from "mithril";
import memoize from "../../lib/common/memoize.ts";
import Expression from "../../lib/common/expression.ts";
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
      const vv = v.evaluate((e) => {
        if (e instanceof Expression.Literal) return e;
        else if (e instanceof Expression.FunctionCall) {
          if (e.name === "ENCODEURICOMPONENT") {
            const a = evaluateExpression(e.args[0], obj);
            if (a instanceof Expression.Literal) {
              if (a.value == null) return new Expression.Literal(null);
              return new Expression.Literal(encodeURIComponent(a.value));
            }
          }
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
        if (c instanceof Expression)
          c = evaluateExpression(c, device || {}).value;
        if (typeof c !== "object") return `${c}`;
        const type = evaluateExpression(c["type"], device || {}).value;
        if (!type) return null;
        return m(type as string, c);
      });

      let el = vnode.attrs["element"];

      if (el == null) return children;

      let attrs: Attributes;
      if (el instanceof Expression) {
        el = evaluateExpression(el, device || {}).value;
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
