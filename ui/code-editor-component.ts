import { Editor } from "codemirror";
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
  onReady?: (editor: Editor) => void;
}

const component: ClosureComponent<Attrs> = () => {
  return {
    view: (vnode) => {
      return m("textarea", {
        name: vnode.attrs.id,
        value: vnode.attrs.value,
        oncreate: (_vnode) => {
          const editor = codeMirror.fromTextArea(
            _vnode.dom as HTMLTextAreaElement,
            {
              mode: vnode.attrs.mode,
              lineNumbers: true,
              readOnly: vnode.attrs.readOnly,
              extraKeys: {
                "Ctrl-Enter": () => {
                  if (vnode.attrs.onSubmit) vnode.attrs.onSubmit(_vnode.dom);
                },
                "Cmd-Enter": () => {
                  if (vnode.attrs.onSubmit) vnode.attrs.onSubmit(_vnode.dom);
                },
              },
            },
          );

          if (vnode.attrs.onChange) {
            editor.on("change", (e) => {
              vnode.attrs.onChange(e.getValue());
            });
          }

          if (vnode.attrs.focus) editor.focus();
          if (vnode.attrs.onReady) vnode.attrs.onReady(editor);
        },
      });
    },
  };
};

export default component;
