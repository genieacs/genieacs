import esbuild from "esbuild";

import { APP_JS } from "../build/assets.ts";
import { Views } from "./types.ts";

export async function validateViewScript(
  id: string,
  script: string,
): Promise<string | null> {
  const input = buildInput({ [id]: { md5: "", script } } as unknown as Views);
  try {
    await runBuild(input);
  } catch (err) {
    if (!err.errors?.length) throw err;
    const e = err.errors[0];
    if (!e.location) return e.text;
    const offset = input
      .slice(0, input.indexOf("function(node,"))
      .split("\n").length;
    const line = e.location.line - offset;
    return `${e.text} at ${id}:${line}:${e.location.column}`;
  }
  return null;
}

function buildInput(views: Views): string {
  const appJsPath = `./${APP_JS}`;
  const viewEntries: string[] = [];
  for (const [k, v] of Object.entries(views)) {
    viewEntries.push(`
      "${k}": function(node, setTimeout, setInterval, Date) {
        ${v.script}
      }`);
  }

  return `
    import {ViewNode, Signal} from "${appJsPath}";

    function h(name, attributes, ...children) {
      return new ViewNode(name, attributes, children);
    }

    export default {
      ${viewEntries.join(",\n")}
    };
  `;
}

export async function bundleViews(views: Views): Promise<string> {
  return runBuild(buildInput(views));
}

async function runBuild(input: string): Promise<string> {
  const appJsPath = `./${APP_JS}`;

  const buildResult = await esbuild.build({
    stdin: {
      contents: input,
      loader: "jsx",
    },
    bundle: true,
    write: false,
    format: "esm",
    logLevel: "silent",
    minify: process.env.NODE_ENV === "production",
    jsxFactory: "h",
    jsxFragment: "null",
    plugins: [
      {
        name: "import-resolver",
        setup(build) {
          build.onResolve({ filter: /.*/ }, (args) => {
            if (args.path === appJsPath)
              return { sideEffects: false, external: true };
            return { path: args.path, namespace: "env-ns" };
          });
          build.onLoad({ filter: /.*/, namespace: "env-ns" }, () => {
            throw new Error(`import not supported`);
          });
        },
      },
    ],
  });

  return buildResult.outputFiles[0].text;
}
