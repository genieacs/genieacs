import { div } from "./dom.ts";
import { codeMirror } from "./dynamic-loader.ts";

interface Attrs {
  value: string;
  mode: string;
  readOnly?: boolean;
  focus?: boolean;
  onChange?: (value: string) => void;
}

function mount(container: HTMLElement, attrs: Attrs): void {
  if (!container.isConnected) return;

  const extensions = [
    codeMirror.EditorView.theme({
      "&.cm-editor": {
        display: "block",
        width: "50rem",
        height: "30rem",
        "max-width": "100%",
        "border-radius": "0.375rem",
        "border-width": "1px",
        "border-color": "var(--color-stone-300)",
        "box-shadow":
          "var(--tw-ring-shadow, 0 0 #0000), 0 1px 2px 0 rgb(0 0 0 / 0.05)",
        overflow: "hidden",
        "& > .cm-scroller": {
          "font-family": "inherit",
          "line-height": "inherit",
        },
      },
      "&.cm-editor.cm-focused": {
        outline: "none",
        "border-color": "var(--color-cyan-500)",
        "--tw-ring-shadow": "0 0 0 1px var(--color-cyan-500)",
      },
    }),
    codeMirror.lineNumbers(),
    codeMirror.history(),
    codeMirror.syntaxHighlighting(codeMirror.defaultHighlightStyle),
    codeMirror.keymap.of([
      ...codeMirror.defaultKeymap,
      ...codeMirror.historyKeymap,
    ]),
    codeMirror.EditorState.readOnly.of(!!attrs.readOnly),
    codeMirror.EditorView.updateListener.of((update) => {
      if (update.docChanged && attrs.onChange)
        attrs.onChange(update.state.doc.toString());
    }),
  ];

  if (attrs.mode === "javascript") extensions.push(codeMirror.javascript());
  else if (attrs.mode === "jsx")
    extensions.push(codeMirror.javascript({ jsx: true }));
  else if (attrs.mode === "yaml") extensions.push(codeMirror.yaml());

  const editor = new codeMirror.EditorView({
    state: codeMirror.EditorState.create({
      doc: attrs.value,
      extensions,
    }),
    parent: container,
  });

  if (attrs.focus) editor.focus();
}

export function codeEditor(attrs: Attrs): HTMLDivElement {
  const container = div({ class: "font-mono text-sm" });
  requestAnimationFrame(() => mount(container, attrs));
  return container;
}
