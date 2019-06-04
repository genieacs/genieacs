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

import { ClosureComponent, Component } from "mithril";
import { m } from "./components";
import * as store from "./store";
import { yaml } from "./dynamic-loader";
import * as configFunctions from "./config-functions";
import codeEditorComponent from "./code-editor-component";
import { parse } from "../lib/common/expression-parser";

function putActionHandler(prefix: string[], dataYaml: string): Promise<any> {
  return new Promise((resolve, reject) => {
    try {
      let updated = yaml.parse(dataYaml, { schema: "failsafe" });
      if (updated) {
        const config = {};
        let ref = config;
        prefix.forEach((seg, index) => {
          if (index < prefix.length - 1) {
            ref[seg] = {};
            ref = ref[seg];
          } else {
            ref[seg] = updated;
          }
        });
        updated = configFunctions.flattenConfig(config);
      } else {
        updated = {};
      }

      // Try parse to ensure valid expressions
      for (const v of Object.values(updated)) parse(v as string);

      store
        .queryConfig(`${prefix.join(".")}.%`)
        .then(res => {
          const current = {};
          for (const f of res) current[f._id] = f.value;

          const diff = configFunctions.diffConfig(current, updated);
          if (!diff.add.length && !diff.remove.length) return void resolve();

          const promises = [];

          for (const obj of diff.add)
            promises.push(store.putResource("config", obj._id, obj));

          for (const id of diff.remove)
            promises.push(store.deleteResource("config", id));

          Promise.all(promises)
            .then(() => {
              resolve();
            })
            .catch(reject);
        })
        .catch(reject);
    } catch (error) {
      resolve({ config: error.message });
    }
  });
}

const component: ClosureComponent = (): Component => {
  return {
    view: vnode => {
      const prefix = vnode.attrs["prefix"].split(".");
      const name = vnode.attrs["name"];
      const data = vnode.attrs["data"];

      if (prefix[prefix.length - 1] === "") prefix.pop();

      let config;
      if (data.length) {
        config = configFunctions.structureConfig(data);
        for (const seg of prefix) config = config[seg];
      }

      const yamlString =
        config && Object.values(config).length
          ? yaml.stringify(config, {
              schema: "failsafe",
              tags: args => {
                return args;
              }
            })
          : "";

      const attrs = {
        id: `${name}-ui-config`,
        value: yamlString,
        mode: "yaml",
        focus: true,
        onSubmit: dom => {
          dom.form.querySelector("button[type=submit]").click();
        },
        onChange: value => {
          vnode.state["updatedYaml"] = value;
        }
      };

      const code = m(codeEditorComponent, attrs);
      const submit = m("button.primary", { type: "submit" }, "Save");

      return m("div.put-form", [
        m("h1", `Editing ${name}`),
        m(
          "form",
          {
            onsubmit: e => {
              e.redraw = false;
              e.preventDefault();
              if (vnode.state["updatedYaml"] == null)
                vnode.state["updatedYaml"] = yamlString;

              putActionHandler(prefix, vnode.state["updatedYaml"])
                .then(vnode.attrs["onUpdate"])
                .catch(vnode.attrs["onError"]);
            }
          },
          [code, m(".actions-bar", [submit])]
        )
      ]);
    }
  };
};

export default component;
