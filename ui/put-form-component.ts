import { VnodeDOM, ClosureComponent, Children } from "mithril";
import { m } from "./components.ts";
import codeEditorComponent from "./code-editor-component.ts";
import { getDatalistId } from "./datalist.ts";

const singular = {
  presets: "preset",
  provisions: "provision",
  virtualParameters: "virtual parameter",
  files: "file",
  users: "user",
  permissions: "permission",
};

function createField(current, attr, focus): Children {
  if (attr.type === "combo") {
    let selected = "";
    let optionsValues = attr.options;
    if (current.object[attr.id] != null) {
      if (!optionsValues.includes(current.object[attr.id]))
        optionsValues = optionsValues.concat([current.object[attr.id]]);
      selected = current.object[attr.id];
    }

    const options = [m("option", { value: "" }, "")];
    for (const op of optionsValues)
      options.push(m("option", { value: op }, op));

    return m(
      "select.mt-1 block pl-3 pr-10 py-2 text-base border-stone-300 focus:outline-hidden focus:ring-cyan-500 focus:border-cyan-500 sm:text-sm rounded-md",
      {
        name: attr.id,
        value: selected,
        oncreate: focus
          ? (_vnode) => {
              (_vnode.dom as HTMLSelectElement).focus();
            }
          : null,
        onchange: (e) => {
          current.object[attr.id] = e.target.value;
          current.modified = true;
          e.redraw = false;
        },
      },
      options,
    );
  } else if (attr.type === "multi") {
    const optionsValues = Array.from(
      new Set(attr.options.concat(current.object[attr.id] || [])),
    );
    const currentSelected = new Set(current.object[attr.id]);
    const options = optionsValues.map((op) => {
      const id = `${attr.id}-${op}`;
      const opts = {
        type: "checkbox",
        id: id,
        value: op,
        oncreate: (_vnode) => {
          if (focus && !options.length) _vnode.dom.focus();
          if (currentSelected.has(op)) _vnode.dom.checked = true;
        },
        onchange: (e) => {
          if (e.target.checked) currentSelected.add(op);
          else currentSelected.delete(op);
          current.object[attr.id] = Array.from(currentSelected);
          current.modified = true;
          e.redraw = false;
        },
      };

      return m("tr", [
        m(
          "td",
          m(
            "input.focus:ring-cyan-500 h-4 w-4 text-cyan-700 border-stone-300 rounded-sm",
            opts,
          ),
        ),
        m("td", op),
      ]);
    });

    return m("table", options);
  } else if (attr.type === "code") {
    const attrs = {
      id: attr.id,
      value: current.object[attr.id],
      mode: "javascript",
      onSubmit: (dom) => {
        dom.form.querySelector("button[type=submit]").click();
      },
      onChange: (value) => {
        current.object[attr.id] = value;
        current.modified = true;
      },
    };
    return m(codeEditorComponent, attrs);
  } else if (attr.type === "file") {
    return m("input", {
      type: "file",
      name: attr.id,
      oncreate: focus
        ? (_vnode) => {
            (_vnode.dom as HTMLInputElement).focus();
          }
        : null,
      onchange: (e) => {
        current.object[attr.id] = e.target.files;
        current.modified = true;
        e.redraw = false;
      },
    });
  } else if (attr.type === "textarea") {
    return m(
      "textarea.shadow-xs block focus:ring-cyan-500 focus:border-cyan-500 sm:text-sm border border-stone-300 rounded-md",
      {
        name: attr.id,
        value: current.object[attr.id],
        readonly: attr.id === "_id" && !current.isNew,
        cols: attr.cols || 80,
        rows: attr.rows || 4,
        style: "resize: none;",
        oncreate: focus
          ? (_vnode) => {
              const dom = _vnode.dom as HTMLInputElement;
              dom.focus();
              dom.setSelectionRange(dom.value.length, dom.value.length);
            }
          : null,
        oninput: (e) => {
          current.object[attr.id] = e.target.value;
          current.modified = true;
          e.redraw = false;
        },
        onkeypress: (e) => {
          e.redraw = false;
          if (e.which === 13 && !e.shiftKey) {
            const dom = e.target;
            dom.form.querySelector("button[type=submit]").click();
            return false;
          }
          return true;
        },
      },
    );
  }

  let datalist: string = null;
  if (attr.options) datalist = getDatalistId(attr.options);

  return m(
    "input.shadow-xs focus:ring-cyan-500 focus:border-cyan-500 block sm:text-sm border-stone-300 rounded-md",
    {
      type: attr.type === "password" ? "password" : "text",
      name: attr.id,
      list: datalist,
      autocomplete: datalist ? "off" : null,
      disabled: attr.id === "_id" && !current.isNew,
      value: current.object[attr.id],
      oncreate: focus
        ? (_vnode) => {
            (_vnode.dom as HTMLInputElement).focus();
          }
        : null,
      oninput: (e) => {
        current.object[attr.id] = e.target.value;
        current.modified = true;
        e.redraw = false;
      },
    },
  );
}

interface Attrs {
  base?: Record<string, any>;
  actionHandler: (action: string, object: any) => Promise<void>;
  resource: string;
  attributes: {
    id: string;
    label: string;
    type?: string;
    options?: string[];
  }[];
}

const component: ClosureComponent<Attrs> = () => {
  return {
    view: (vnode) => {
      const actionHandler = vnode.attrs.actionHandler;
      const attributes = vnode.attrs.attributes;
      const resource = vnode.attrs.resource;
      const base = vnode.attrs.base || {};
      if (!vnode.state["current"]) {
        vnode.state["current"] = {
          isNew: !base["_id"],
          object: Object.assign({}, base),
          modified: false,
        };
      }

      const current = vnode.state["current"];

      const form = [];
      let focused = false;
      for (const attr of attributes) {
        let focus = false;
        if (!focused && (current.isNew || attr.id !== "_id"))
          focus = focused = true;

        form.push(
          m(
            "p",
            m(
              "label.block text-sm font-semibold text-stone-700 mt-2 mb-1",
              { for: attr.id },
              attr.label || attr.id,
            ),
            createField(current, attr, focus),
          ),
        );
      }

      const buttons: VnodeDOM[] = [];

      if (!current.isNew) {
        buttons.push(
          m(
            "button.ml-3 inline-flex justify-center py-2 px-4 border border-transparent shadow-xs text-sm font-medium rounded-md text-white bg-red-600 hover:bg-red-700 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-red-500",
            {
              type: "button",
              title: `Delete ${singular[resource] || resource}`,
              onclick: (e) => {
                e.redraw = false;
                e.target.disabled = true;
                void actionHandler("delete", current.object).finally(() => {
                  e.target.disabled = false;
                });
              },
            },
            "Delete",
          ) as VnodeDOM,
        );
      }

      const submit = m(
        "button.ml-3 inline-flex justify-center py-2 px-4 border border-transparent shadow-xs text-sm font-medium rounded-md text-white bg-cyan-600 hover:bg-cyan-700 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-cyan-500",
        { type: "submit" },
        "Save",
      ) as VnodeDOM;

      buttons.push(submit);

      form.push(m("div.flex justify-end mt-5", buttons));

      const children = [
        m(
          "h2.text-lg leading-6 font-medium text-stone-900",
          `${current.isNew ? "New" : "Editing"} ${
            singular[resource] || resource
          }`,
        ),
        m(
          "form",
          {
            onsubmit: (e) => {
              e.redraw = false;
              // const onsubmit = e.target.onsubmit;
              e.preventDefault();
              // e.target.onsubmit = null;
              (submit.dom as HTMLFormElement).disabled = true;
              // submit.dom.textContent = "Loading ...";
              void actionHandler("save", current.object).finally(() => {
                // submit.dom.textContent = "Save";
                // e.target.onsubmit = onsubmit;
                (submit.dom as HTMLFormElement).disabled = false;
              });
            },
          },
          form,
        ),
      ];

      return m("div", children);
    },
  };
};

export default component;
