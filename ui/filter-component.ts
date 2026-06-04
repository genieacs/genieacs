import { div, label, input, each } from "./dom.ts";
import { StateSignal } from "./signals.ts";
import memoize from "../lib/common/memoize.ts";
import Autocomplete from "./autocomplete-component.ts";
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

function parseFilter(resource: smartQuery.Resource, f: string): Expression {
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
          return smartQuery.unpack(
            resource,
            e.args[0].value as string,
            e.args[1].value as string,
          );
        }
      }
    }
    return e;
  });

  // Throws exception if invalid Mongo query
  validQuery(unpacked, resource);

  return exp;
}

function splitFilter(filter: Expression | undefined): string[] {
  if (!filter) return [""];
  if (filter instanceof Expression.Literal && filter.value) return [""];
  const list: Expression[] = [filter];
  const res: string[] = [];
  while (list.length) {
    const f = list.pop()!;
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
  resource: smartQuery.Resource;
  filter?: Expression;
  onChange: (filter: Expression) => void;
}

const BASE_INPUT_CLASS =
  "appearance-none rounded-none relative block w-full px-3 py-2 border-stone-300 placeholder-stone-500 text-stone-900 focus:ring-cyan-500 focus:border-cyan-500 focus:z-10 sm:text-sm";

export function createFilter(attrs: Attrs): HTMLElement {
  const filterList = new StateSignal<string[]>(splitFilter(attrs.filter));
  const filterInvalid = new StateSignal(0);
  let filterTouched = false;

  function onChange(): void {
    filterTouched = false;
    const list = filterList.get().filter((f) => f);
    let invalid = 0;
    let filter: Expression = new Expression.Literal(true);
    for (const [idx, f] of list.entries()) {
      try {
        filter = Expression.and(filter, parseFilter(attrs.resource, f));
      } catch {
        invalid |= 1 << idx;
      }
    }
    list.push("");
    filterInvalid.set(invalid);
    filterList.set(list);

    if (invalid) return;
    if (!list.length) attrs.onChange(new Expression.Literal(true));
    else attrs.onChange(filter);
  }

  return div(
    { class: "mb-5" },
    label({ class: "text-sm font-semibold text-stone-700" }, "Filter"),
    div(
      { class: "shadow-sm rounded-md mt-1 max-w-screen-sm -space-y-px" },
      each(
        filterList,
        (_, idx) => idx,
        (_fltr, getIdx) => {
          const inputEl = input({
            type: "text",
            class: () => {
              const idx = getIdx();
              const list = filterList.get();
              let c = BASE_INPUT_CLASS;
              if (idx === 0) c += " rounded-t-md";
              if (idx === list.length - 1) c += " rounded-b-md";
              if (filterInvalid.get() & (1 << idx)) c += " !text-red-700";
              return c;
            },
            value: () => filterList.get()[getIdx()] ?? "",
            oninput: (e) => {
              filterList.get()[getIdx()] = (e.target as HTMLInputElement).value;
              filterTouched = true;
            },
            onblur: () => {
              if (filterTouched) onChange();
            },
          });

          getAutocomplete(attrs.resource).attach(inputEl);
          // Attach Enter handler after autocomplete so its stopImmediatePropagation
          // on suggestion-pick can suppress this.
          inputEl.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && filterTouched) onChange();
          });
          return inputEl;
        },
        // Rows are editable inputs keyed by index over raw strings; value and
        // class read filterList reactively, and an identity-based re-render on
        // commit would drop focus mid-edit (Enter).
        // TODO: model rows as stable { id, text: StateSignal } entities keyed
        // by id (editing writes the row's signal instead of mutating the list
        // in place); then drop this opt-out.
        { rerenderOnChange: false },
      ),
    ),
  );
}
