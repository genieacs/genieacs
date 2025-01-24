import path from "node:path";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { exec } from "node:child_process";
import * as esbuild from "esbuild";
import { optimize } from "svgo";
import * as xmlParser from "../lib/xml-parser.ts";

const fsAsync = {
  readdir: promisify(fs.readdir),
  readFile: promisify(fs.readFile),
  writeFile: promisify(fs.writeFile),
  copyFile: promisify(fs.copyFile),
  rename: promisify(fs.rename),
  chmod: promisify(fs.chmod),
  lstat: promisify(fs.lstat),
  exists: promisify(fs.exists),
  rmdir: promisify(fs.rmdir),
  unlink: promisify(fs.unlink),
  mkdir: promisify(fs.mkdir),
};

const execAsync = promisify(exec);

const MODE = process.env["NODE_ENV"] || "production";

const INPUT_DIR = process.cwd();
const OUTPUT_DIR = path.join(INPUT_DIR, "dist");

async function rmDir(dirPath: string): Promise<void> {
  if (!(await fsAsync.exists(dirPath))) return;
  const files = await fsAsync.readdir(dirPath);

  for (const file of files) {
    const filePath = path.join(dirPath, file);
    if ((await fsAsync.lstat(filePath)).isDirectory()) await rmDir(filePath);
    else await fsAsync.unlink(filePath);
  }
  await fsAsync.rmdir(dirPath);
}

// For lockfileVersion = 1
function stripDevDeps(deps): void {
  if (!deps["dependencies"]) return;
  for (const [k, v] of Object.entries(deps["dependencies"])) {
    if (v["dev"]) delete deps["dependencies"][k];
    else stripDevDeps(v);
  }
  if (!Object.keys(deps["dependencies"]).length) delete deps["dependencies"];
}

// For lockfileVersion = 2
function stripDevDeps2(deps): void {
  if (!deps["packages"]) return;
  for (const [k, v] of Object.entries(deps["packages"])) {
    delete v["devDependencies"];
    if (v["dev"]) delete deps["packages"][k];
  }
}

function xmlTostring(xml): string {
  const children = [];
  for (const c of xml.children || []) children.push(xmlTostring(c));

  return xml.name === "root" && xml.bodyIndex === 0
    ? children.join("")
    : `<${xml.name} ${xml.attrs}>${children.join("")}</${xml.name}>`;
}

function assetHash(buffer: Buffer | string): string {
  return createHash("md5").update(buffer).digest("hex").slice(0, 8);
}

const ASSETS = {} as {
  APP_JS?: string;
  APP_CSS?: string;
  ICONS_SVG?: string;
  LOGO_SVG?: string;
  FAVICON_PNG?: string;
};

const assetsPlugin = {
  name: "assets",
  setup(build) {
    build.onLoad({ filter: /\/build\/assets.ts$/ }, () => {
      const lines = Object.entries(ASSETS).map(
        ([k, v]) => `export const ${k} = ${JSON.stringify(v)};`,
      );
      return { contents: lines.join("\n") };
    });
  },
} as esbuild.Plugin;

const packageDotJsonPlugin = {
  name: "packageDotJson",
  setup(build) {
    const sourcePath = path.join(INPUT_DIR, "package.json");
    build.onResolve({ filter: /\/package.json$/ }, (args) => {
      const p = path.join(args.resolveDir, args.path);
      if (p !== sourcePath) return undefined;
      return { path: path.join(OUTPUT_DIR, "package.json") };
    });
  },
} as esbuild.Plugin;

const inlineDepsPlugin = {
  name: "inlineDeps",
  setup(build) {
    const deps = [
      "parsimmon",
      "espresso-iisojs",
      "codemirror",
      "mithril",
      "yaml",
    ];
    build.onResolve({ filter: /^[^.]/ }, async (args) => {
      if (deps.some((d) => args.path.startsWith(d))) return undefined;
      return { sideEffects: false, external: true };
    });
  },
} as esbuild.Plugin;

function generateSymbol(id: string, svgStr: string): string {
  const xml = xmlParser.parseXml(svgStr);
  const svg = xml.children[0];
  const svgAttrs = xmlParser.parseAttrs(svg.attrs);
  let viewBox = "";
  for (const a of svgAttrs) {
    if (a.name === "viewBox") {
      viewBox = `viewBox="${a.value}"`;
      break;
    }
  }
  const symbolBody = xml.children[0].children
    .map((c) => xmlTostring(c))
    .join("");
  return `<symbol id="icon-${id}" ${viewBox}>${symbolBody}</symbol>`;
}

async function getBuildMetadata(): Promise<string> {
  const date = new Date().toISOString().slice(2, 10).replaceAll("-", "");

  const [commit, diff, newFiles] = await Promise.all([
    execAsync("git rev-parse HEAD"),
    execAsync("git diff HEAD"),
    execAsync("git ls-files --others --exclude-standard"),
  ]).then((res) => res.map((r) => r.stdout.trim()));

  if (!diff && !newFiles) return date + commit.slice(0, 4);

  const hash = createHash("md5");
  hash.update(commit).update(diff).update(newFiles);
  for (const file of newFiles.split("\n").filter((f) => f))
    hash.update(await fsAsync.readFile(file));
  return date + hash.digest("hex").slice(0, 4);
}

async function init(): Promise<void> {
  const [buildMetadata, packageJsonFile, npmShrinkwrapFile] = await Promise.all(
    [
      getBuildMetadata(),
      fsAsync.readFile(path.join(INPUT_DIR, "package.json")),
      fsAsync.readFile(path.join(INPUT_DIR, "npm-shrinkwrap.json")),
    ],
  );

  const packageJson = JSON.parse(packageJsonFile.toString());
  delete packageJson["devDependencies"];
  delete packageJson["private"];
  delete packageJson["scripts"];
  packageJson["version"] = `${packageJson["version"]}+${buildMetadata}`;

  const npmShrinkwrap = JSON.parse(npmShrinkwrapFile.toString());
  npmShrinkwrap["version"] = packageJson["version"];
  stripDevDeps(npmShrinkwrap);
  stripDevDeps2(npmShrinkwrap);

  await rmDir(OUTPUT_DIR);

  await fsAsync.mkdir(OUTPUT_DIR);

  await Promise.all([
    fsAsync.mkdir(path.join(OUTPUT_DIR, "bin")),
    fsAsync.mkdir(path.join(OUTPUT_DIR, "public")),
    fsAsync.writeFile(
      path.join(OUTPUT_DIR, "package.json"),
      JSON.stringify(packageJson, null, 2),
    ),
    fsAsync.writeFile(
      path.join(OUTPUT_DIR, "npm-shrinkwrap.json"),
      JSON.stringify(npmShrinkwrap, null, 2),
    ),
  ]);
}

async function copyStatic(): Promise<void> {
  const files = [
    "LICENSE",
    "README.md",
    "CHANGELOG.md",
    "public/logo.svg",
    "public/favicon.png",
  ];

  const [logo, favicon] = await Promise.all([
    fsAsync.readFile(path.join(INPUT_DIR, "public/logo.svg")),
    fsAsync.readFile(path.join(INPUT_DIR, "public/favicon.png")),
  ]);

  ASSETS.LOGO_SVG = `logo-${assetHash(logo)}.svg`;
  ASSETS.FAVICON_PNG = `favicon-${assetHash(favicon)}.png`;

  const filenames = {} as Record<string, string>;
  filenames["public/logo.svg"] = path.join("public", ASSETS.LOGO_SVG);
  filenames["public/favicon.png"] = path.join("public", ASSETS.FAVICON_PNG);

  await Promise.all(
    files.map((f) =>
      fsAsync.copyFile(
        path.join(INPUT_DIR, f),
        path.join(OUTPUT_DIR, filenames[f] || f),
      ),
    ),
  );
}

async function generateCss(): Promise<void> {
  const res = await esbuild.build({
    bundle: true,
    absWorkingDir: INPUT_DIR,
    minify: MODE === "production",
    sourcemap: "linked",
    sourcesContent: false,
    entryPoints: ["ui/css/app.css"],
    entryNames: "[dir]/[name]-[hash]",
    outfile: path.join(OUTPUT_DIR, "public/app.css"),
    target: ["chrome109", "safari15.6", "firefox115", "opera102", "edge118"],
    metafile: true,
  });

  for (const [k, v] of Object.entries(res.metafile.outputs)) {
    if (v.entryPoint === "ui/css/app.css") {
      ASSETS.APP_CSS = path.relative(
        path.join(OUTPUT_DIR, "public"),
        path.join(INPUT_DIR, k),
      );
      break;
    }
  }
}

async function generateBackendJs(): Promise<void> {
  const services = [
    "genieacs-cwmp",
    "genieacs-ext",
    "genieacs-nbi",
    "genieacs-fs",
    "genieacs-ui",
  ];

  await esbuild.build({
    bundle: true,
    absWorkingDir: INPUT_DIR,
    minify: MODE === "production",
    sourcemap: "inline",
    sourcesContent: false,
    platform: "node",
    target: "node12.13.0",
    packages: "external",
    banner: { js: "#!/usr/bin/env node" },
    entryPoints: services.map((s) => `bin/${s}.ts`),
    outdir: path.join(OUTPUT_DIR, "bin"),
    plugins: [packageDotJsonPlugin, assetsPlugin],
  });

  for (const bin of services) {
    const p = path.join(OUTPUT_DIR, "bin", bin);
    await fsAsync.rename(`${p}.js`, p);
    // Mark as executable
    const mode = (await fsAsync.lstat(p)).mode;
    await fsAsync.chmod(p, mode | 73);
  }
}

async function generateFrontendJs(): Promise<void> {
  const res = await esbuild.build({
    bundle: true,
    absWorkingDir: INPUT_DIR,
    splitting: true,
    minify: MODE === "production",
    sourcemap: "linked",
    sourcesContent: false,
    platform: "browser",
    format: "esm",
    target: ["chrome109", "safari15.6", "firefox115", "opera102", "edge118"],
    entryPoints: ["ui/app.ts"],
    entryNames: "[dir]/[name]-[hash]",
    outdir: path.join(OUTPUT_DIR, "public"),
    plugins: [packageDotJsonPlugin, inlineDepsPlugin, assetsPlugin],
    metafile: true,
  });

  for (const [k, v] of Object.entries(res.metafile.outputs)) {
    for (const imp of v.imports)
      if (imp.external) throw new Error(`External import found: ${imp.path}`);

    if (v.entryPoint === "ui/app.ts") {
      ASSETS.APP_JS = path.relative(
        path.join(OUTPUT_DIR, "public"),
        path.join(INPUT_DIR, k),
      );
    }
  }
}

async function generateIconsSprite(): Promise<void> {
  const symbols = [] as string[];
  const iconsDir = path.join(INPUT_DIR, "ui/icons");
  for (const file of await fsAsync.readdir(iconsDir)) {
    const id = path.parse(file).name;
    const filePath = path.join(iconsDir, file);
    const src = (await fsAsync.readFile(filePath)).toString();
    const { data } = await optimize(src, {
      plugins: [
        {
          name: "preset-default",
          params: {
            overrides: {
              removeViewBox: false,
            },
          },
        },
      ],
    });
    symbols.push(generateSymbol(id, data));
  }
  const data = `<svg xmlns="http://www.w3.org/2000/svg">${symbols.join(
    "",
  )}</svg>`;
  ASSETS.ICONS_SVG = `icons-${assetHash(data)}.svg`;
  await fsAsync.writeFile(
    path.join(OUTPUT_DIR, "public", ASSETS.ICONS_SVG),
    data,
  );
}

init()
  .then(() =>
    Promise.all([
      Promise.all([generateIconsSprite(), copyStatic()]).then(
        generateFrontendJs,
      ),
      generateCss(),
    ]).then(generateBackendJs),
  )
  .catch((err) => {
    process.stderr.write(err.stack + "\n");
  });
