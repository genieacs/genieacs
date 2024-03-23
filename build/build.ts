import path from "node:path";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
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

const MODE = process.env["NODE_ENV"] || "production";

const buildMetadata = new Date()
  .toISOString()
  .split(".")[0]
  .replace(/[^0-9]/g, "");

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

function assetHash(buffer: Buffer | string): string {
  return createHash("md5").update(buffer).digest("hex").slice(0, 8);
}

const ASSETS = [] as string[];

async function init(): Promise<void> {
  await rmDir(OUTPUT_DIR);
  await fsAsync.mkdir(OUTPUT_DIR);
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

  ASSETS.push(`logo-${assetHash(logo)}.svg`);
  ASSETS.push(`favicon-${assetHash(favicon)}.png`);

  const filenames = {} as Record<string, string>;
  filenames["public/logo.svg"] = "public/" + ASSETS[ASSETS.length - 2];
  filenames["public/favicon.png"] = "public/" + ASSETS[ASSETS.length - 1];

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
  await esbuild.build({
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
  ASSETS.push("app.css");
}

async function generateBackendJs(): Promise<void> {
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
    entryPoints: ["bin/app.ts"],
    outdir: path.join(OUTPUT_DIR, "bin"),
  });
  ASSETS.push("app.js");
}

async function generateFrontendJs(): Promise<void> {
  await esbuild.build({
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
    metafile: true,
  });
  ASSETS.push("chunk.js");
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
  ASSETS.push("icons.svg");
  await fsAsync.writeFile(
    path.join(OUTPUT_DIR, "public/icons.svg"),
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
