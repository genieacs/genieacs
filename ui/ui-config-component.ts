import { ClosureComponent } from "mithril";
import { m } from "./components.ts";
import * as store from "./store.ts";
import { yaml } from "./dynamic-loader.ts";
import * as configFunctions from "./config-functions.ts";
import codeEditorComponent from "./code-editor-component.ts";
import Expression from "../lib/common/expression.ts";

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
      for (const v of Object.values(updated)) Expression.parse(v as string);

      store
        .queryConfig(`${prefix.join(".")}.%`)
        .then((res) => {
          const current = {};
          for (const f of res) current[f._id] = f.value;

          const diff = configFunctions.diffConfig(current, updated);
          if (!diff.add.length && !diff.remove.length)
            return void resolve(null);

          const promises = [];

          for (const obj of diff.add) {
            promises.push(
              store.putResource(
                "config",
                obj._id,
                obj as unknown as Record<string, unknown>,
              ),
            );
          }

          for (const id of diff.remove)
            promises.push(store.deleteResource("config", id));

          Promise.all(promises)
            .then(() => {
              resolve(null);
            })
            .catch(reject);
        })
        .catch(reject);
    } catch (error) {
      resolve({ config: error.message });
    }
  });
}

interface Attrs {
  prefix: string;
  name: string;
  data: { _id: string; value: string }[];
  onUpdate: (errs: Record<string, string>) => void;
  onError: (err: Error) => void;
}

const component: ClosureComponent<Attrs> = () => {
  return {
    view: (vnode) => {
      const prefix = vnode.attrs.prefix.split(".");
      const name = vnode.attrs.name;
      const data = vnode.attrs.data;

      if (prefix[prefix.length - 1] === "") prefix.pop();

      let config;
      if (data.length) {
        config = configFunctions.structureConfig(data);
        for (const seg of prefix) config = config[seg];
      }

      const yamlString =
        config && Object.values(config).length
          ? yaml.stringify(config, { schema: "failsafe" })
          : "";

      const attrs = {
        id: `${name}-ui-config`,
        value: yamlString,
        mode: "yaml",
        focus: true,
        onSubmit: (dom) => {
          dom.form.querySelector("button[type=submit]").click();
        },
        onChange: (value) => {
          vnode.state["updatedYaml"] = value;
          vnode.state["modified"] = true;
        },
      };

      const code = m(codeEditorComponent, attrs);
      const submit = m(
        "button.ml-3 inline-flex justify-center py-2 px-4 border border-transparent shadow-xs text-sm font-medium rounded-md text-white bg-cyan-600 hover:bg-cyan-700 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-cyan-500",
        { type: "submit" },
        "Save",
      );

      return m("div", [
        m(
          "h2.mb-5 text-lg leading-6 font-medium text-stone-900",
          `Editing ${name}`,
        ),
        m(
          "form",
          {
            onsubmit: (e) => {
              e.redraw = false;
              e.preventDefault();
              if (vnode.state["updatedYaml"] == null)
                vnode.state["updatedYaml"] = yamlString;

              putActionHandler(prefix, vnode.state["updatedYaml"])
                .then(vnode.attrs.onUpdate)
                .catch(vnode.attrs.onError);
            },
          },
          [code, m(".flex justify-end mt-5", [submit])],
        ),
      ]);
    },
  };
};

export default component;
