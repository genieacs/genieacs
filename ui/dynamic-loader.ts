import * as notifications from "./notifications.ts";

export let codeMirror: typeof import("./codemirror-loader");
export let yaml: typeof import("./yaml-loader");

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
    import("./codemirror-loader")
      .then((module) => {
        codeMirror = module;
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
    import("./yaml-loader")
      .then((module) => {
        yaml = module;
        resolve();
      })
      .catch((err) => {
        onError();
        reject(err);
      });
  });
}
