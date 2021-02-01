/**
 * Copyright 2013-2019  GenieACS Inc.
 *
 * This file is part of GenieACS.
 *
 * GenieACS is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * GenieACS is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with GenieACS.  If not, see <http://www.gnu.org/licenses/>.
 */

import * as path from "path";
import * as fs from "fs";
import { rollup, WarningHandler } from "rollup";
import rollupJson from "@rollup/plugin-json";
import typescript from "@rollup/plugin-typescript";
import { terser } from "rollup-plugin-terser";
import nodeResolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import postcss from "postcss";
import postcssImport from "postcss-import";
import postcssPresetEnv from "postcss-preset-env";
import cssnano from "cssnano";
import SVGO from "svgo";
import * as xmlParser from "../lib/xml-parser";

const MODE = process.env["NODE_ENV"] || "production";

const BUILD_METADATA = new Date()
  .toISOString()
  .split(".")[0]
  .replace(/[^0-9]/g, "");

const INPUT_DIR = path.resolve(__dirname, "..");
const OUTPUT_DIR = path.resolve(__dirname, "../dist");

const builtins = [
  "path",
  "fs",
  "cluster",
  "os",
  "tls",
  "http",
  "https",
  "zlib",
  "crypto",
  "util",
  "vm",
  "querystring",
  "child_process",
  "dgram",
  "url",
  "readline",
  "stream",
];

function rmDirSync(dirPath): void {
  if (!fs.existsSync(dirPath)) return;
  const files = fs.readdirSync(dirPath);

  for (const file of files) {
    const filePath = `${dirPath}/${file}`;
    if (fs.statSync(filePath).isFile()) fs.unlinkSync(filePath);
    else rmDirSync(filePath);
  }
  fs.rmdirSync(dirPath);
}

function stripDevDeps(deps): void {
  if (!deps["dependencies"]) return;
  for (const [k, v] of Object.entries(deps["dependencies"])) {
    if (v["dev"]) delete deps["dependencies"][k];
    else stripDevDeps(v);
  }
  if (!Object.keys(deps["dependencies"]).length) delete deps["dependencies"];
}

function xmlTostring(xml): string {
  const children = [];
  for (const c of xml.children || []) children.push(xmlTostring(c));

  return xml.name === "root" && xml.bodyIndex === 0
    ? children.join("")
    : `<${xml.name} ${xml.attrs}>${children.join("")}</${xml.name}>`;
}

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

async function init(): Promise<string[]> {
  // Delete any old output directory
  rmDirSync(OUTPUT_DIR);

  // Create output directory layout
  fs.mkdirSync(OUTPUT_DIR);
  fs.mkdirSync(OUTPUT_DIR + "/bin");
  fs.mkdirSync(OUTPUT_DIR + "/public");

  // Create package.json
  const packageJson = JSON.parse(
    fs.readFileSync(path.resolve(INPUT_DIR, "package.json")).toString()
  );
  delete packageJson["devDependencies"];
  delete packageJson["private"];
  packageJson["scripts"] = {
    install: packageJson["scripts"].install,
    configure: packageJson["scripts"].configure,
  };
  packageJson["version"] = `${packageJson["version"]}+${BUILD_METADATA}`;
  fs.writeFileSync(
    path.resolve(OUTPUT_DIR, "package.json"),
    JSON.stringify(packageJson, null, 2)
  );

  // Create npm-shrinkwrap.json
  const npmShrinkwrapJson = JSON.parse(
    fs.readFileSync(path.resolve(INPUT_DIR, "npm-shrinkwrap.json")).toString()
  );
  npmShrinkwrapJson["version"] = packageJson["version"];
  stripDevDeps(npmShrinkwrapJson);
  fs.writeFileSync(
    path.resolve(OUTPUT_DIR, "npm-shrinkwrap.json"),
    JSON.stringify(npmShrinkwrapJson, null, 2)
  );
  return Object.keys(packageJson["dependencies"]);
}

async function copyStatic(): Promise<void> {
  const files = [
    "LICENSE",
    "README.md",
    "CHANGELOG.md",
    "public/logo.svg",
    "public/favicon.png",
  ];

  for (const file of files) {
    fs.copyFileSync(
      path.resolve(INPUT_DIR, file),
      path.resolve(OUTPUT_DIR, file)
    );
  }
}

async function generateCss(): Promise<void> {
  const cssInPath = path.resolve(INPUT_DIR, "ui/css/app.css");
  const cssOutPath = path.resolve(OUTPUT_DIR, "public/app.css");
  const cssIn = fs.readFileSync(cssInPath);
  const cssOut = await postcss([
    postcssImport,
    postcssPresetEnv({
      stage: 3,
      features: {
        "nesting-rules": true,
        "color-mod-function": true,
      },
    }),
    cssnano,
  ]).process(cssIn, { from: cssInPath, to: cssOutPath });
  fs.writeFileSync(cssOutPath, cssOut.css);
}

async function generateBackendJs(externals: string[]): Promise<void> {
  for (const bin of [
    "genieacs-cwmp",
    "genieacs-ext",
    "genieacs-nbi",
    "genieacs-fs",
    "genieacs-ui",
  ]) {
    const inputFile = path.resolve(INPUT_DIR, `bin/${bin}.ts`);
    const outputFile = path.resolve(OUTPUT_DIR, `bin/${bin}`);
    const bundle = await rollup({
      input: inputFile,
      external: [...builtins, ...externals],
      acorn: {
        allowHashBang: true,
      },
      treeshake: {
        propertyReadSideEffects: false,
        moduleSideEffects: false,
      },
      plugins: [
        rollupJson({ preferConst: true }),
        {
          name: "",
          resolveId: (importee, importer) => {
            if (importee.endsWith("/package.json")) {
              const p = path.resolve(path.dirname(importer), importee);
              if (p === path.resolve(INPUT_DIR, "package.json"))
                return path.resolve(OUTPUT_DIR, "package.json");
            }
            return null;
          },
        },
        typescript({
          tsconfig: "./tsconfig.json",
          include: [`bin/${bin}.ts`, "lib/**/*.ts"],
        }),
        MODE === "production" ? terser() : null,
      ],
    });

    await bundle.write({
      format: "cjs",
      preferConst: true,
      sourcemap: "inline",
      sourcemapExcludeSources: true,
      banner: "#!/usr/bin/env node",
      file: outputFile,
    });

    // Mark as executable
    const mode = fs.statSync(outputFile).mode;
    fs.chmodSync(outputFile, mode | 73);
  }
}

async function generateFrontendJs(externals: string[]): Promise<void> {
  const inputFile = path.resolve(INPUT_DIR, "ui/app.ts");
  const outputDir = path.resolve(OUTPUT_DIR, "public");

  const inlineDeps = ["parsimmon", "espresso-iisojs"];
  const bundle = await rollup({
    input: inputFile,
    external: [
      ...builtins,
      ...externals.filter((e) => !inlineDeps.includes(e)),
    ],
    plugins: [
      rollupJson({ preferConst: true }),
      {
        name: "",
        resolveId: function (importee, importer) {
          if (importee.endsWith("/package.json")) {
            const p = path.resolve(path.dirname(importer), importee);
            if (p === path.resolve(INPUT_DIR, "package.json"))
              return path.resolve(OUTPUT_DIR, "package.json");
          } else if (importee === "espresso-iisojs") {
            return this.resolve(
              "espresso-iisojs/dist/espresso-iisojs.mjs",
              importer
            );
          }
          return null;
        },
      },
      typescript({ tsconfig: "./tsconfig.json" }),
      nodeResolve(),
      commonjs(),
      MODE === "production" ? terser() : null,
    ],
    preserveEntrySignatures: false,
    treeshake: {
      propertyReadSideEffects: false,
      moduleSideEffects: false,
    },
    onwarn: ((warning, warn) => {
      // Ignore circular dependency warnings
      if (warning.code !== "CIRCULAR_DEPENDENCY") warn(warning);
    }) as WarningHandler,
  });

  await bundle.write({
    manualChunks: (id) => {
      if (id.includes("node_modules/codemirror")) return "codemirror";
      else if (id.includes("node_modules/yaml")) return "yaml";
      return "app";
    },
    preferConst: true,
    format: "es",
    sourcemap: true,
    sourcemapExcludeSources: true,
    dir: outputDir,
  });
}

async function generateIconsSprite(): Promise<void> {
  const svgo = new SVGO({ plugins: [{ removeViewBox: false }] });
  const symbols = [];
  const iconsDir = path.resolve(INPUT_DIR, "ui/icons");
  for (const file of fs.readdirSync(iconsDir)) {
    const id = path.parse(file).name;
    const filePath = path.join(iconsDir, file);
    const { data } = await svgo.optimize(fs.readFileSync(filePath).toString());
    symbols.push(generateSymbol(id, data));
  }
  fs.writeFileSync(
    path.resolve(OUTPUT_DIR, "public/icons.svg"),
    `<svg xmlns="http://www.w3.org/2000/svg">${symbols.join("")}</svg>`
  );
}

init()
  .then((externals) => {
    Promise.all([
      copyStatic(),
      generateCss(),
      generateIconsSprite(),
      generateBackendJs(externals),
      generateFrontendJs(externals),
    ])
      .then(() => {
        // Ignore
      })
      .catch((err) => {
        process.stderr.write(err.stack + "\n");
      });
  })
  .catch((err) => {
    process.stderr.write(err.stack + "\n");
  });
