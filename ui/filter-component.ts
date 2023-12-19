import m, { ClosureComponent } from "mithril";
import { parse, stringify, map } from "../lib/common/expression/parser.ts";
import memoize from "../lib/common/memoize.ts";
import Autocomplete from "./autocomplete-compnent.ts";
import * as smartQuery from "./smart-query.ts";
import { validQuery } from "../lib/db/synth.ts";
import { Expression } from "../lib/types.ts";

const getAutocomplete = memoize((resource) => {
  const labels = smartQuery.getLabels(resource);
  const autocomplete = new Autocomplete("autocomplete", (txt, cb) => {
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

function parseFilter(resource, f): Expression {
  let exp;
  if (/^[\s0-9a-zA-Z]+:/.test(f)) {
    const k = f.split(":", 1)[0];
    const v = f.slice(k.length + 1).trim();
    exp = ["FUNC", "Q", k.trim(), v];
  } else {
    exp = parse(f);
  }

  const unpacked = map(exp, (e) => {
    if (Array.isArray(e) && e[0] === "FUNC") {
      if (e[1] === "Q") return smartQuery.unpack(resource, e[2], e[3]);
      else if (e[1] === "NOW") return Date.now();
    }
    return e;
  });

  // Throws exception if invalid Mongo query
  validQuery(unpacked, resource);

  return exp;
}

function stringifyFilter(f: Expression): string {
  if (Array.isArray(f) && f[0] === "FUNC" && f[1] === "Q")
    return `${f[2]}: ${f[3]}`;
  return stringify(f);
}

function splitFilter(filter: string): string[] {
  if (!filter) return [""];
  const list: string[] = [];
  const f = parse(filter);
  if (Array.isArray(f) && f[0] === "AND")
    for (const ff of f.slice(1)) list.push(stringifyFilter(ff));
  else list.push(stringifyFilter(f));

  list.push("");
  return list;
}

interface Attrs {
  resource: string;
  filter: string;
  onChange: (filter: string) => void;
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
    const list = filterList.map((f, idx) => {
      try {
        return parseFilter(attrs.resource, f);
      } catch (err) {
        filterInvalid |= 1 << idx;
      }
      return null;
    });
    filterList.push("");

    if (filterInvalid) {
      m.redraw();
      return;
    }
    if (list.length === 0) attrs.onChange("");
    else if (list.length > 1) attrs.onChange(stringify(["AND", ...list]));
    else attrs.onChange(stringify(list[0]));
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

      return m("div.filter", [
        m("b", "Filter"),
        ...filterList.map((fltr, idx) => {
          return m("input", {
            type: "text",
            class: `${(filterInvalid >> idx) & 1 ? "error" : ""}`,
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
      ]);
    },
  };
};

export default component;
