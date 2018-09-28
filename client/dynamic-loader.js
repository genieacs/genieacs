"use strict";

let codeMirror;

function loadCodeMirror() {
  if (codeMirror) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const promises = [
      import(/* webpackChunkName: "codemirror" */ "codemirror"),
      import(/* webpackChunkName: "codemirror" */ "codemirror/mode/javascript/javascript")
    ];
    Promise.all(promises)
      .then(modules => {
        codeMirror = modules[0];
        resolve();
      })
      .catch(reject);
  });
}

export { loadCodeMirror, codeMirror };
