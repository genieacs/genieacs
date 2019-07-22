/**
 * Copyright 2013-2019  GenieACS Inc.
 *
 * This file is part of GenieACS.
 *
 * GenieACS is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * GenieACS is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with GenieACS.  If not, see <http://www.gnu.org/licenses/>.
 */

import { VnodeDOM, ClosureComponent, Component, Children } from "mithril";
import { m } from "./components";
import codeEditorComponent from "./code-editor-component";

const singular = {
  presets: "preset",
  provisions: "provision",
  virtualParameters: "virtual parameter",
  files: "file",
  users: "user",
  permissions: "permission"
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
    const optionsValues = Array.from(
      new Set(attr.options.concat(current.object[attr.id] || []))
    );
    const currentSelected = new Set(current.object[attr.id]);
    const options = optionsValues.map(op => {
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
    const attrs = {
      id: attr.id,
      value: current.object[attr.id],
      mode: "javascript",
      onSubmit: dom => {
        dom.form.querySelector("button[type=submit]").click();
      },
      onChange: value => {
        current.object[attr.id] = value;
      }
    };
    return m(codeEditorComponent, attrs);
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
  } else if (attr.type === "textarea") {
    return m("textarea", {
      name: attr.id,
      value: current.object[attr.id],
      readonly: attr.id === "_id" && !current.isNew,
      cols: attr.cols || 80,
      rows: attr.rows || 4,
      style: "resize: none;",
      oncreate: focus
        ? _vnode => {
            const dom = _vnode.dom as HTMLInputElement;
            dom.focus();
            dom.setSelectionRange(dom.value.length, dom.value.length);
          }
        : null,
      oninput: e => {
        current.object[attr.id] = e.target.value;
        e.redraw = false;
      },
      onkeypress: e => {
        e.redraw = false;
        if (e.which === 13 && !e.shiftKey) {
          const dom = e.target;
          dom.form.querySelector("button[type=submit]").click();
          return false;
        }
        return true;
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
