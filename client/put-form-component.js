"use strict";

import m from "mithril";
import { codeMirror } from "./dynamic-loader";

const singular = {
  presets: "preset",
  provisions: "provision",
  virtualParameters: "virtual parameter",
  files: "file"
};

function createField(current, attr, focus) {
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
              _vnode.dom.focus();
            }
          : null,
        onchange: e => {
          current.object[attr.id] = e.target.value;
          e.redraw = false;
        }
      },
      options
    );
  } else if (attr.type === "code") {
    return m("textarea", {
      name: attr.id,
      value: current.object[attr.id],
      oncreate: _vnode => {
        const editor = codeMirror.fromTextArea(_vnode.dom, {
          mode: "javascript",
          lineNumbers: true
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
            _vnode.dom.focus();
          }
        : null,
      onchange: e => {
        current.object[attr.id] = e.target.files;
        e.redraw = false;
      }
    });
  }

  return m("input", {
    type: "text",
    name: attr.id,
    disabled: attr.id === "_id" && !current.isNew,
    value: current.object[attr.id],
    oncreate: focus
      ? _vnode => {
          _vnode.dom.focus();
        }
      : null,
    oninput: e => {
      current.object[attr.id] = e.target.value;
      e.redraw = false;
    }
  });
}

const component = {
  view: vnode => {
    const actionHandler = vnode.attrs.actionHandler;
    const attributes = vnode.attrs.attributes;
    const resource = vnode.attrs.resource;
    const base = vnode.attrs.base || {};
    if (!vnode.state.current) {
      vnode.state.current = {
        isNew: !base["_id"],
        object: Object.assign({}, base)
      };
    }

    const current = vnode.state.current;

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

    const submit = m("button.primary", { type: "submit" }, "Save");
    const buttons = [submit];

    if (!current.isNew) {
      buttons.push(
        m(
          "button.primary",
          {
            type: "button",
            title: `Delete ${singular[resource]}`,
            onclick: e => {
              e.redraw = false;
              e.target.disabled = true;
              actionHandler("delete", current.object);
            }
          },
          "Delete"
        )
      );
    }

    form.push(m(".actions-bar", buttons));

    const children = [
      m("h1", `${current.isNew ? "New" : "Editing"} ${singular[resource]}`),
      m(
        "form",
        {
          onsubmit: e => {
            e.redraw = false;
            e.target.onsubmit = null;
            e.preventDefault();
            for (const elem of e.target.elements) elem.disabled = true;
            submit.dom.textContent = "Loading ...";
            actionHandler("save", current.object);
          }
        },
        form
      )
    ];

    return m("div.put-form", children);
  }
};

export default component;
