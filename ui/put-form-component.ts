import { VnodeDOM, ClosureComponent, Component, Children } from "mithril";
import { m } from "./components";
import { codeMirror } from "./dynamic-loader";

const singular = {
  presets: "preset",
  provisions: "provision",
  virtualParameters: "virtual parameter",
  files: "file"
};

function createField(current, attr, focus): Children {
  if (attr.type === "combo") {
    const options = [m("option", { value: "" }, "--Please choose--")];
    for (const op of attr.options) options.push(m("option", { value: op }, op));

    let selected = "";
    if (attr.options.includes(current.object[attr.id]))
      selected = current.object[attr.id];
    return m(
      "select",
      {
        name: attr.id,
        value: selected,
        oncreate: focus
          ? _vnode => {
              (_vnode.dom as HTMLSelectElement).focus();
            }
          : null,
        onchange: e => {
          current.object[attr.id] = e.target.value;
          e.redraw = false;
        }
      },
      options
    );
  } else if (attr.type === "multi") {
    const currentSelected = new Set(current.object[attr.id]);
    const options = attr.options.map(op => {
      const id = `${attr.id}-${op}`;
      const opts = {
        type: "checkbox",
        id: id,
        value: op,
        oncreate: _vnode => {
          if (focus && !options.length) _vnode.dom.focus();
          if (currentSelected.has(op)) _vnode.dom.checked = true;
        },
        onchange: e => {
          if (e.target.checked) currentSelected.add(op);
          else currentSelected.delete(op);
          current.object[attr.id] = Array.from(currentSelected);
          e.redraw = false;
        }
      };

      return m("tr", [m("td", m("input", opts)), m("td", op)]);
    });

    return m("table", options);
  } else if (attr.type === "code") {
    return m("textarea", {
      name: attr.id,
      value: current.object[attr.id],
      oncreate: _vnode => {
        const editor = codeMirror.fromTextArea(_vnode.dom, {
          mode: "javascript",
          lineNumbers: true,
          extraKeys: {
            "Ctrl-Enter": () => {
              ((_vnode.dom as HTMLTextAreaElement).form.querySelector(
                "button[type=submit]"
              ) as HTMLButtonElement).click();
            },
            "Cmd-Enter": () => {
              ((_vnode.dom as HTMLTextAreaElement).form.querySelector(
                "button[type=submit]"
              ) as HTMLButtonElement).click();
            }
          }
        });

        editor.on("change", e => {
          current.object[attr.id] = e.getValue();
        });

        if (focus) editor.focus();
      }
    });
  } else if (attr.type === "file") {
    return m("input", {
      type: "file",
      name: attr.id,
      oncreate: focus
        ? _vnode => {
            (_vnode.dom as HTMLInputElement).focus();
          }
        : null,
      onchange: e => {
        current.object[attr.id] = e.target.files;
        e.redraw = false;
      }
    });
  }

  return m("input", {
    type: attr.type === "password" ? "password" : "text",
    name: attr.id,
    disabled: attr.id === "_id" && !current.isNew,
    value: current.object[attr.id],
    oncreate: focus
      ? _vnode => {
          (_vnode.dom as HTMLInputElement).focus();
        }
      : null,
    oninput: e => {
      current.object[attr.id] = e.target.value;
      e.redraw = false;
    }
  });
}

const component: ClosureComponent = (): Component => {
  return {
    view: vnode => {
      const actionHandler = vnode.attrs["actionHandler"];
      const attributes = vnode.attrs["attributes"];
      const resource = vnode.attrs["resource"];
      const base = vnode.attrs["base"] || {};
      if (!vnode.state["current"]) {
        vnode.state["current"] = {
          isNew: !base["_id"],
          object: Object.assign({}, base)
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
            m("label", { for: attr.id }, attr.label || attr.id),
            m("br"),
            createField(current, attr, focus)
          )
        );
      }

      const submit = m(
        "button.primary",
        { type: "submit" },
        "Save"
      ) as VnodeDOM;
      const buttons = [submit];

      if (!current.isNew) {
        buttons.push(m(
          "button.primary",
          {
            type: "button",
            title: `Delete ${singular[resource] || resource}`,
            onclick: e => {
              e.redraw = false;
              e.target.disabled = true;
              actionHandler("delete", current.object).then(() => {
                e.target.disabled = false;
              });
            }
          },
          "Delete"
        ) as VnodeDOM);
      }

      form.push(m(".actions-bar", buttons));

      const children = [
        m(
          "h1",
          `${current.isNew ? "New" : "Editing"} ${singular[resource] ||
            resource}`
        ),
        m(
          "form",
          {
            onsubmit: e => {
              e.redraw = false;
              // const onsubmit = e.target.onsubmit;
              e.preventDefault();
              // e.target.onsubmit = null;
              (submit.dom as HTMLFormElement).disabled = true;
              // submit.dom.textContent = "Loading ...";
              actionHandler("save", current.object).then(() => {
                // submit.dom.textContent = "Save";
                // e.target.onsubmit = onsubmit;
                (submit.dom as HTMLFormElement).disabled = false;
              });
            }
          },
          form
        )
      ];

      return m("div.put-form", children);
    }
  };
};

export default component;
