import { ClosureComponent } from "mithril";
import { m } from "./components.ts";
import { queryConfig, putResource, deleteResource } from "./api-client.ts";
import { yaml } from "./dynamic-loader.ts";
import * as configFunctions from "./config-functions.ts";
import codeEditorComponent from "./code-editor-component.ts";
import Expression from "../lib/common/expression.ts";

function putActionHandler(prefix: string[], dataYaml: string): Promise<any> {
  return new Promise((resolve, reject) => {
    try {
      let updated = yaml.parse(dataYaml, { schema: "failsafe" });
      if (updated) {
        const config: Record<string, any> = {};
        let ref: Record<string, any> = config;
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

      queryConfig(`${prefix.join(".")}.%`)
        .then((res): void => {
          const current: Record<string, any> = {};
          for (const f of res) current[f._id] = f.value;

          const diff = configFunctions.diffConfig(current, updated);
          if (!diff.add.length && !diff.remove.length)
            return void resolve(null);

          const promises = [];

          for (const obj of diff.add) {
            promises.push(
              putResource(
                "config",
                obj._id,
                obj as unknown as Record<string, unknown>,
              ),
            );
          }

          for (const id of diff.remove)
            promises.push(deleteResource("config", id));

          Promise.all(promises)
            .then(() => {
              resolve(null);
            })
            .catch(reject);
        })
        .catch(reject);
    } catch (error) {
      if (!(error instanceof Error)) throw error;
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
  let updatedYaml: string | null = null;

  return {
    view: (vnode) => {
      const prefix = vnode.attrs.prefix.split(".");
      const name = vnode.attrs.name;
      const data = vnode.attrs.data;

      if (prefix[prefix.length - 1] === "") prefix.pop();

      let config: Record<string, any> | undefined;
      if (data.length) {
        config = configFunctions.structureConfig(data) as Record<string, any>;
        for (const seg of prefix) config = config?.[seg];
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
        onSubmit: (dom: Element) => {
          (dom as HTMLInputElement).form
            ?.querySelector<HTMLButtonElement>("button[type=submit]")
            ?.click();
        },
        onChange: (value: string) => {
          updatedYaml = value;
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
            onsubmit: (e: Event) => {
              e.redraw = false;
              e.preventDefault();
              if (updatedYaml == null) updatedYaml = yamlString;

              putActionHandler(prefix, updatedYaml)
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
