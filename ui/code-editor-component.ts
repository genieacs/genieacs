import { ClosureComponent } from "mithril";
import { m } from "./components.ts";
import { codeMirror } from "./dynamic-loader.ts";

interface Attrs {
  id: string;
  value: string;
  mode: string;
  readOnly?: boolean;
  focus?: boolean;
  onSubmit?: (dom: Element) => void;
  onChange?: (value: string) => void;
}

const component: ClosureComponent<Attrs> = () => {
  return {
    view: (vnode) => {
      return m("div.font-mono text-sm", {
        oncreate: (_vnode) => {
          const theme = codeMirror.EditorView.theme({
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
          });

          const extensions = [
            theme,
            codeMirror.lineNumbers(),
            codeMirror.history(),
            codeMirror.syntaxHighlighting(codeMirror.defaultHighlightStyle),
            codeMirror.keymap.of([
              ...codeMirror.defaultKeymap,
              ...codeMirror.historyKeymap,
            ]),
            codeMirror.EditorState.readOnly.of(!!vnode.attrs.readOnly),
            codeMirror.EditorView.updateListener.of((update) => {
              if (update.docChanged && vnode.attrs.onChange)
                vnode.attrs.onChange(update.state.doc.toString());
            }),
          ];

          if (vnode.attrs.mode === "javascript")
            extensions.push(codeMirror.javascript());
          else if (vnode.attrs.mode === "yaml")
            extensions.push(codeMirror.yaml());

          const editor = new codeMirror.EditorView({
            state: codeMirror.EditorState.create({
              doc: vnode.attrs.value,
              extensions,
            }),
            parent: _vnode.dom as HTMLTextAreaElement,
          });

          if (vnode.attrs.focus) editor.focus();
        },
      });
    },
  };
};

export default component;
