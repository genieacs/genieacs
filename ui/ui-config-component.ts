import { div, h2, form, button } from "./dom.ts";
import { queryConfig, putResource, deleteResource } from "./api-client.ts";
import { yaml } from "./dynamic-loader.ts";
import * as configFunctions from "./config-functions.ts";
import { codeEditor } from "./code-editor-component.ts";
import Expression from "../lib/common/expression.ts";

function putActionHandler(
  prefix: string[],
  dataYaml: string,
): Promise<Record<string, string> | null> {
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
        .then((res) => {
          const current: Record<string, unknown> = {};
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
  onUpdate: (errs: Record<string, string> | null) => void;
  onError: (err: Error) => void;
}

// Result object with state accessor for close confirmation
export interface UiConfigResult {
  element: Node;
  isModified: () => boolean;
}

// DOM-based UI config component
export function createUiConfig(attrs: Attrs): UiConfigResult {
  let updatedYaml: string | null = null;

  const prefix = attrs.prefix.split(".");
  const name = attrs.name;
  const data = attrs.data;

  if (prefix[prefix.length - 1] === "") prefix.pop();

  let config: Record<string, unknown> | undefined;
  if (data.length) {
    config = configFunctions.structureConfig(data) as Record<string, unknown>;
    for (const seg of prefix)
      config = config?.[seg] as Record<string, unknown> | undefined;
  }

  const yamlString =
    config && Object.values(config).length
      ? yaml.stringify(config, { schema: "failsafe" })
      : "";

  const codeEditorContainer = codeEditor({
    value: yamlString,
    mode: "yaml",
    focus: true,
    onChange: (value: string) => {
      updatedYaml = value;
    },
  });

  const submitBtn = button(
    {
      type: "submit",
      class:
        "ml-3 inline-flex justify-center py-2 px-4 border border-transparent shadow-xs text-sm font-medium rounded-md text-white bg-cyan-600 hover:bg-cyan-700 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-cyan-500",
    },
    "Save",
  );

  const formEl = form(
    {
      onsubmit: (e) => {
        e.preventDefault();
        if (updatedYaml == null) updatedYaml = yamlString;

        putActionHandler(prefix, updatedYaml)
          .then(attrs.onUpdate)
          .catch(attrs.onError);
      },
    },
    codeEditorContainer,
    div({ class: "flex justify-end mt-5" }, submitBtn),
  );

  const element = div(
    {},
    h2(
      { class: "mb-5 text-lg leading-6 font-medium text-stone-900" },
      `Editing ${name}`,
    ),
    formEl,
  );

  return {
    element,
    isModified: () => updatedYaml != null,
  };
}
