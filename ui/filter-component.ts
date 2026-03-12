import m, { ClosureComponent } from "mithril";
import memoize from "../lib/common/memoize.ts";
import Autocomplete from "./autocomplete-compnent.ts";
import * as smartQuery from "./smart-query.ts";
import { validQuery } from "../lib/db/synth.ts";
import Expression from "../lib/common/expression.ts";

const getAutocomplete = memoize((resource) => {
  const labels = smartQuery.getLabels(resource);
  const autocomplete = new Autocomplete((txt, cb) => {
    txt = txt.toLowerCase();
    cb(
      labels
        .filter((s) => s.toLowerCase().includes(txt))
        .map((s) => ({
          value: `${s}: `,
          tip: smartQuery.getTip(resource, s),
        })),
    );
  });
  return autocomplete;
});

function parseFilter(resource: string, f: string): Expression {
  let exp;
  if (/^[\s0-9a-zA-Z]+:/.test(f)) {
    const k = f.split(":", 1)[0];
    const v = f.slice(k.length + 1).trim();
    exp = new Expression.FunctionCall("Q", [
      new Expression.Literal(k.trim()),
      new Expression.Literal(v),
    ]);
  } else {
    exp = Expression.parse(f);
  }

  const unpacked = exp.evaluate((e) => {
    if (e instanceof Expression.FunctionCall) {
      if (e.name === "NOW") return new Expression.Literal(Date.now());
      else if (e.name === "Q") {
        if (
          e.args[0] instanceof Expression.Literal &&
          e.args[1] instanceof Expression.Literal
        ) {
          const r = smartQuery.unpack(
            resource,
            e.args[0].value as string,
            e.args[1].value as string,
          );
          return r;
        }
      }
    }
    return e;
  });

  // Throws exception if invalid Mongo query
  validQuery(unpacked, resource);

  return exp;
}

function splitFilter(filter: Expression): string[] {
  if (!filter) return [""];
  if (filter instanceof Expression.Literal && filter.value) return [""];
  const list: Expression[] = [filter];
  const res: string[] = [];
  while (list.length) {
    const f = list.pop();
    if (f instanceof Expression.Binary && f.operator === "AND") {
      list.push(f.right);
      list.push(f.left);
    } else if (f instanceof Expression.FunctionCall && f.name === "Q") {
      const l = f.args[0] as Expression.Literal;
      const r = f.args[1] as Expression.Literal;
      res.push(`${l.value}: ${r.value}`);
    } else {
      res.push(f.toString());
    }
  }

  res.push("");
  return res;
}

interface Attrs {
  resource: string;
  filter?: Expression;
  onChange: (filter: Expression) => void;
}

const component: ClosureComponent<Attrs> = (initialVnode) => {
  let filterList = splitFilter(initialVnode.attrs.filter);
  let filterInvalid = 0;
  let filterTouched = false;
  let attrs: Attrs = initialVnode.attrs;

  function onChange(): void {
    filterTouched = false;
    filterInvalid = 0;
    filterList = filterList.filter((f) => f);
    let filter: Expression = new Expression.Literal(true);
    for (const [idx, f] of filterList.entries()) {
      try {
        filter = Expression.and(filter, parseFilter(attrs.resource, f));
      } catch {
        filterInvalid |= 1 << idx;
      }
    }
    filterList.push("");

    if (filterInvalid) {
      m.redraw();
      return;
    }
    if (!filterList.length) attrs.onChange(null);
    else attrs.onChange(filter);
  }

  return {
    onupdate: (vnode) => {
      getAutocomplete(vnode.attrs.resource).reposition();
    },
    view: (vnode) => {
      if (attrs.filter !== vnode.attrs.filter) {
        filterInvalid = 0;
        filterList = splitFilter(vnode.attrs.filter);
      }

      attrs = vnode.attrs;

      return m("div.mb-5", [
        m("label.text-sm font-semibold text-stone-700", "Filter"),
        m(
          "div.shadow-sm rounded-md mt-1 max-w-screen-sm -space-y-px",
          ...filterList.map((fltr, idx) => {
            let classNames =
              "appearance-none rounded-none relative block w-full px-3 py-2 border-stone-300 placeholder-stone-500 text-stone-900 focus:ring-cyan-500 focus:border-cyan-500 focus:z-10 sm:text-sm";
            if (idx === 0) classNames += " rounded-t-md";
            if (idx === filterList.length - 1) classNames += " rounded-b-md";
            if (filterInvalid & (1 << idx)) classNames += " !text-red-700";

            return m(`input`, {
              type: "text",
              class: classNames,
              value: fltr,
              oninput: (e) => {
                e.redraw = false;
                filterList[idx] = e.target.value;
                filterTouched = true;
              },
              oncreate: (vn) => {
                const el = vn.dom as HTMLInputElement;
                getAutocomplete(vnode.attrs.resource).attach(el);

                el.addEventListener("blur", () => {
                  if (filterTouched) onChange();
                });

                el.addEventListener("keydown", (e) => {
                  if (e.key === "Enter" && filterTouched) onChange();
                });
              },
            });
          }),
        ),
      ]);
    },
  };
};

export default component;
