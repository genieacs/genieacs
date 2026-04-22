import { Attributes, ClosureComponent } from "mithril";
import memoize from "../../lib/common/memoize.ts";
import Expression, { Value } from "../../lib/common/expression.ts";
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
  components: Record<string, unknown>;
  element?:
    | Expression
    | { tag: Expression; attributes?: Record<string, Expression> };
}

const component: ClosureComponent<Attrs> = () => {
  return {
    view: (vnode) => {
      const device = vnode.attrs.device;
      if ("filter" in vnode.attrs) {
        if (!evaluateExpression(vnode.attrs.filter, device || {}).value)
          return null;
      }

      const children = Object.values(vnode.attrs.components).map((c) => {
        if (c instanceof Expression)
          c = evaluateExpression(c, device || {}).value;
        if (typeof c !== "object" || c == null) return `${c}`;
        const comp = c as { type: Expression };
        const type = evaluateExpression(comp.type, device || {}).value;
        if (!type) return null;
        return m(type as string, comp);
      });

      const element = vnode.attrs.element;
      if (element == null) return children;

      let attrs: Attributes;
      let el: Expression | Value;
      if (element instanceof Expression) {
        el = evaluateExpression(element, device || {}).value;
      } else {
        if (element.attributes != null) {
          attrs = evaluateAttributes(
            element.attributes,
            device || {},
            getTimestamp(),
          );
        }
        el = evaluateExpression(element.tag, device || {}).value;
      }

      return m(el as string, attrs, children);
    },
  };
};

export default component;
