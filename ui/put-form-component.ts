import { codeEditor } from "./code-editor-component.ts";
import {
  div,
  h2,
  form,
  p,
  label,
  input,
  select,
  option,
  datalist,
  textarea,
  button,
  table,
  tr,
  td,
  type Child,
} from "./dom.ts";

const singular: Record<string, string> = {
  presets: "preset",
  provisions: "provision",
  virtualParameters: "virtual parameter",
  files: "file",
  users: "user",
  permissions: "permission",
  views: "view",
};

interface FormState {
  isNew: boolean;
  object: Record<string, unknown>;
  modified: boolean;
}

interface Attribute {
  id: string;
  label: string;
  type?: string;
  mode?: string;
  options?: string[] | (() => string[]);
  cols?: number;
  rows?: number;
}

// Options may be supplied as a function (e.g. reading a query signal) so they
// can be resolved lazily — and, when called from a tracked context, reactively.
function resolveOptions(attr: Attribute): string[] {
  return (
    (typeof attr.options === "function" ? attr.options() : attr.options) || []
  );
}

let datalistCounter = 0;

function createField(
  current: FormState,
  attr: Attribute,
  focus: boolean,
): Child {
  if (attr.type === "combo") {
    // The select element is created once (so focus and handlers persist) and
    // its options render reactively — same pattern as "multi" below: when
    // options come from a function reading a query signal, they refresh in an
    // already-open form once the fetch resolves. The current value is
    // injected and the selection re-derived from current.object on each run,
    // so a refresh preserves what the user picked.
    return select(
      {
        name: attr.id,
        class:
          "mt-1 block pl-3 pr-10 py-2 text-base border-stone-300 focus:outline-hidden focus:ring-cyan-500 focus:border-cyan-500 sm:text-sm rounded-md",
        onMount: focus
          ? (el) => {
              (el as HTMLSelectElement).focus();
            }
          : undefined,
        onchange: (e) => {
          current.object[attr.id] = (e.target as HTMLSelectElement).value;
          current.modified = true;
        },
      },
      option({ value: "" }, ""),
      () => {
        let selected = "";
        let optionsValues = resolveOptions(attr);
        if (current.object[attr.id] != null) {
          const val = current.object[attr.id] as string;
          if (!optionsValues.includes(val)) {
            optionsValues = optionsValues.concat([val]);
          }
          selected = val;
        }
        return optionsValues.map((op) =>
          option({ value: op, selected: op === selected }, op),
        );
      },
    );
  }

  if (attr.type === "multi") {
    // Rows are rendered reactively: when options come from a function reading
    // a query signal, they refresh in an already-open form once the fetch
    // resolves. State is re-derived from current.object on each run, so user
    // selections survive a refresh. Focus only once so a late options refresh
    // can't steal focus from a field the user has moved to.
    let focusPending = focus;
    return table(() => {
      const optionsValues = Array.from(
        new Set(
          resolveOptions(attr).concat(
            (current.object[attr.id] as string[]) || [],
          ),
        ),
      );
      const currentSelected = new Set(current.object[attr.id] as string[]);

      return optionsValues.map((op, idx) => {
        const checkEl = input({
          type: "checkbox",
          id: `${attr.id}-${op}`,
          value: op,
          checked: currentSelected.has(op),
          class:
            "focus:ring-cyan-500 h-4 w-4 text-cyan-700 border-stone-300 rounded-sm",
          onMount:
            focusPending && idx === 0
              ? (el) => {
                  focusPending = false;
                  (el as HTMLInputElement).focus();
                }
              : undefined,
          onchange: (e) => {
            if ((e.target as HTMLInputElement).checked) {
              currentSelected.add(op);
            } else {
              currentSelected.delete(op);
            }
            current.object[attr.id] = Array.from(currentSelected);
            current.modified = true;
          },
        });

        return tr(td(checkEl), td(op));
      });
    });
  }

  if (attr.type === "code") {
    return codeEditor({
      value: (current.object[attr.id] as string) || "",
      mode: attr.mode || "javascript",
      focus: focus,
      onChange: (value: string) => {
        current.object[attr.id] = value;
        current.modified = true;
      },
    });
  }

  if (attr.type === "file") {
    return input({
      type: "file",
      name: attr.id,
      onMount: focus
        ? (el) => {
            (el as HTMLInputElement).focus();
          }
        : undefined,
      onchange: (e) => {
        current.object[attr.id] = (e.target as HTMLInputElement).files;
        current.modified = true;
      },
    });
  }

  if (attr.type === "textarea") {
    return textarea({
      name: attr.id,
      value: (current.object[attr.id] as string) || "",
      readonly: attr.id === "_id" && !current.isNew,
      cols: attr.cols || 80,
      rows: attr.rows || 4,
      class:
        "shadow-xs block focus:ring-cyan-500 focus:border-cyan-500 sm:text-sm border border-stone-300 rounded-md",
      style: "resize: none;",
      onMount: focus
        ? (el) => {
            const ta = el as HTMLTextAreaElement;
            ta.focus();
            ta.setSelectionRange(ta.value.length, ta.value.length);
          }
        : undefined,
      oninput: (e) => {
        current.object[attr.id] = (e.target as HTMLTextAreaElement).value;
        current.modified = true;
      },
      onkeydown: (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          const formEl = (e.target as HTMLElement).closest("form");
          const submitButton = formEl?.querySelector<HTMLButtonElement>(
            "button[type=submit]",
          );
          submitButton?.click();
          e.preventDefault();
        }
      },
    });
  }

  // Default: text or password input
  const datalistId = attr.options ? `datalist-${++datalistCounter}` : null;

  const inputEl = input({
    type: attr.type === "password" ? "password" : "text",
    name: attr.id,
    list: datalistId ?? undefined,
    autocomplete: datalistId ? "off" : undefined,
    readonly: attr.id === "_id" && !current.isNew,
    value: (current.object[attr.id] as string) || "",
    class:
      "shadow-xs focus:ring-cyan-500 focus:border-cyan-500 block sm:text-sm border-stone-300 rounded-md",
    onMount: focus
      ? (el) => {
          (el as HTMLInputElement).focus();
        }
      : undefined,
    oninput: (e) => {
      current.object[attr.id] = (e.target as HTMLInputElement).value;
      current.modified = true;
    },
  });

  if (datalistId) {
    return [
      inputEl,
      datalist(
        { id: datalistId },
        ...resolveOptions(attr).map((opt) => option({ value: opt })),
      ),
    ];
  }

  return inputEl;
}

interface Attrs {
  base?: Record<string, unknown>;
  actionHandler: (action: string, object: unknown) => Promise<void>;
  resource: string;
  attributes: Attribute[];
}

// Result object with state accessor for close confirmation
export interface PutFormResult {
  element: HTMLDivElement;
  isModified: () => boolean;
}

// DOM-based put form component
export function createPutForm(attrs: Attrs): PutFormResult {
  const actionHandler = attrs.actionHandler;
  const attributes = attrs.attributes;
  const resource = attrs.resource;
  const base = attrs.base || {};

  const current: FormState = {
    isNew: !base["_id"],
    object: Object.assign({}, base),
    modified: false,
  };

  const formFields: Node[] = [];
  let focused = false;

  const submitBtn = button(
    {
      type: "submit",
      class:
        "ml-3 inline-flex justify-center py-2 px-4 border border-transparent shadow-xs text-sm font-medium rounded-md text-white bg-cyan-600 hover:bg-cyan-700 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-cyan-500",
    },
    "Save",
  );

  for (const attr of attributes) {
    let focus = false;
    if (!focused && (current.isNew || attr.id !== "_id")) {
      focus = focused = true;
    }

    const field = createField(current, attr, focus);

    formFields.push(
      p(
        label(
          {
            class: "block text-sm font-semibold text-stone-700 mt-2 mb-1",
          },
          attr.label || attr.id,
        ),
        field,
      ),
    );
  }

  // Buttons
  const buttons: Node[] = [];

  if (!current.isNew) {
    buttons.push(
      button(
        {
          type: "button",
          class:
            "ml-3 inline-flex justify-center py-2 px-4 border border-transparent shadow-xs text-sm font-medium rounded-md text-white bg-red-600 hover:bg-red-700 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-red-500",
          title: `Delete ${singular[resource] || resource}`,
          onclick: (e) => {
            const btn = e.target as HTMLButtonElement;
            btn.disabled = true;
            void actionHandler("delete", current.object).finally(() => {
              btn.disabled = false;
            });
          },
        },
        "Delete",
      ),
    );
  }

  buttons.push(submitBtn);

  formFields.push(div({ class: "flex justify-end mt-5" }, ...buttons));

  const formEl = form(
    {
      onsubmit: (e) => {
        e.preventDefault();
        submitBtn.disabled = true;
        void actionHandler("save", current.object).finally(() => {
          submitBtn.disabled = false;
        });
      },
    },
    ...formFields,
  );

  const element = div(
    { class: "put-form" },
    h2(
      { class: "text-lg leading-6 font-medium text-stone-900" },
      `${current.isNew ? "New" : "Editing"} ${singular[resource] || resource}`,
    ),
    formEl,
  );

  return {
    element,
    isModified: () => current.modified,
  };
}
