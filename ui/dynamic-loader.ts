import * as notifications from "./notifications.ts";

export let codeMirror: typeof import("codemirror");
export let yaml: typeof import("yaml");

let note;

function onError(): void {
  if (!note) {
    note = notifications.push(
      "error",
      "Error loading JS resource, please reload the page",
      {
        Reload: () => {
          window.location.reload();
        },
      },
    );
  }
}

export function loadCodeMirror(): Promise<void> {
  if (codeMirror) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const promises = [
      import("codemirror"),
      import("codemirror/mode/javascript/javascript"),
      import("codemirror/mode/yaml/yaml"),
    ];
    Promise.all(promises)
      .then((modules) => {
        codeMirror = modules[0].default;
        resolve();
      })
      .catch((err) => {
        onError();
        reject(err);
      });
  });
}

export function loadYaml(): Promise<void> {
  if (yaml) return Promise.resolve();

  return new Promise((resolve, reject) => {
    import("yaml")
      .then((module) => {
        yaml = module.default;
        resolve();
      })
      .catch((err) => {
        onError();
        reject(err);
      });
  });
}
