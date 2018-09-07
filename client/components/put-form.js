"use strict";

import m from "mithril";

const singular = {
  presets: "preset"
};

function createField(current, attr, focus) {
  if (attr.type === "combo") {
    let options = [m("option", { value: "" }, "--Please choose--")];
    for (let op of attr.options) options.push(m("option", { value: op }, op));

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
    let actionHandler = vnode.attrs.actionHandler;
    let attributes = vnode.attrs.attributes;
    let resource = vnode.attrs.resource;
    let base = vnode.attrs.base || {};
    if (!vnode.state.current)
      vnode.state.current = {
        isNew: !base["_id"],
        object: Object.assign({}, base)
      };

    let current = vnode.state.current;

    let form = [];
    let focused = false;
    for (let attr of attributes) {
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

    let buttons = [m("button.primary", { type: "submit" }, "Save")];

    if (!current.isNew)
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

    form.push(m(".actions-bar", buttons));

    let children = [
      m("h1", `${current.isNew ? "New" : "Editing"} ${singular[resource]}`),
      m(
        "form",
        {
          onsubmit: e => {
            e.target.disabled = true;
            e.preventDefault();
            e.redraw = false;
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
