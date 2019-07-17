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
import rollupReplace from "rollup-plugin-replace";
import rollupJson from "rollup-plugin-json";
import typescript from "rollup-plugin-typescript";
import { terser } from "rollup-plugin-terser";
import postcss from "postcss";
import postcssImport from "postcss-import";
import postcssCssNext from "postcss-cssnext";
import cssnano from "cssnano";

const MODE = process.env["NODE_ENV"] || "production";

const BUILD_METADATA = new Date()
  .toISOString()
  .split(".")[0]
  .replace(/[^0-9]/g, "");

const INPUT_DIR = path.resolve(__dirname, "..");
const OUTPUT_DIR = path.resolve(__dirname, "../dist");

const externals = [
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
  "mongodb",
  "libxmljs",
  "vm",
  "later",
  "seedrandom",
  "querystring",
  "child_process",
  "dgram",
  "url",
  "koa",
  "koa-router",
  "koa-compress",
  "koa-bodyparser",
  "koa-jwt",
  "koa-static",
  "jsonwebtoken",
  "stream",
  "mithril",
  "parsimmon",
  "yaml",
  "codemirror",
  "codemirror/mode/javascript/javascript",
  "codemirror/mode/yaml/yaml"
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

async function init(): Promise<void> {
  // Delete any old output directory
  rmDirSync(OUTPUT_DIR);

  // Create output directory layout
  fs.mkdirSync(OUTPUT_DIR);
  fs.mkdirSync(OUTPUT_DIR + "/bin");
  fs.mkdirSync(OUTPUT_DIR + "/config");
  fs.mkdirSync(OUTPUT_DIR + "/public");
  fs.mkdirSync(OUTPUT_DIR + "/tools");

  // Create package.json
  const packageJson = JSON.parse(
    fs.readFileSync(path.resolve(INPUT_DIR, "package.json")).toString()
  );
  delete packageJson["devDependencies"];
  packageJson["scripts"] = {
    install: packageJson["scripts"].install,
    configure: packageJson["scripts"].configure
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
}

async function copyStatic(): Promise<void> {
  const files = [
    "LICENSE",
    "README.md",
    "CHANGELOG.md",
    "config/config-sample.json",
    "config/ext-sample.js",
    "public/logo.svg",
    "public/favicon.png"
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
    postcssCssNext({ warnForDuplicates: false }),
    cssnano
  ]).process(cssIn, { from: cssInPath, to: cssOutPath });
  fs.writeFileSync(cssOutPath, cssOut.css);
}

async function generateToolsJs(): Promise<void> {
  for (const bin of ["dump-data-model"]) {
    const inputFile = path.resolve(INPUT_DIR, `tools/${bin}`);
    const outputFile = path.resolve(OUTPUT_DIR, `tools/${bin}`);
    const bundle = await rollup({
      input: inputFile,
      external: externals,
      acorn: {
        allowHashBang: true
      },
      plugins: [
        rollupReplace({
          delimiters: ["", ""],
          "#!/usr/bin/env -S node -r esm -r ts-node/register/transpile-only": ""
        }),
        typescript({
          tsconfig: "./tsconfig.json",
          include: [`tools/${bin}`, "lib/**/*.ts"]
        }),
        MODE === "production" ? terser() : null
      ]
    });

    await bundle.write({
      format: "cjs",
      preferConst: true,
      banner: "#!/usr/bin/env node",
      file: outputFile
    });

    // Mark as executable
    const mode = fs.statSync(outputFile).mode;
    fs.chmodSync(outputFile, mode | 73);
  }
}

async function generateBackendJs(): Promise<void> {
  for (const bin of [
    "genieacs-cwmp",
    "genieacs-ext",
    "genieacs-nbi",
    "genieacs-fs",
    "genieacs-ui"
  ]) {
    const inputFile = path.resolve(INPUT_DIR, `bin/${bin}`);
    const outputFile = path.resolve(OUTPUT_DIR, `bin/${bin}`);
    const bundle = await rollup({
      input: inputFile,
      external: externals,
      acorn: {
        allowHashBang: true
      },
      treeshake: {
        propertyReadSideEffects: false,
        pureExternalModules: true
      },
      plugins: [
        rollupReplace({
          delimiters: ["", ""],
          "#!/usr/bin/env -S node -r esm -r ts-node/register/transpile-only": ""
        }),
        rollupJson({ preferConst: true }),
        {
          resolveId: (importee, importer) => {
            if (importee.endsWith("/package.json")) {
              const p = path.resolve(path.dirname(importer), importee);
              if (p === path.resolve(INPUT_DIR, "package.json"))
                return path.resolve(OUTPUT_DIR, "package.json");
            }
            return null;
          }
        },
        typescript({
          tsconfig: "./tsconfig.json",
          include: [`bin/${bin}`, "lib/**/*.ts"]
        }),
        MODE === "production" ? terser() : null
      ]
    });

    await bundle.write({
      format: "cjs",
      preferConst: true,
      banner: "#!/usr/bin/env node",
      file: outputFile
    });

    // Mark as executable
    const mode = fs.statSync(outputFile).mode;
    fs.chmodSync(outputFile, mode | 73);
  }
}

async function generateFrontendJs(): Promise<void> {
  const inputFile = path.resolve(INPUT_DIR, "ui/app.ts");
  const outputFile = path.resolve(OUTPUT_DIR, "public/app.js");

  const bundle = await rollup({
    input: inputFile,
    external: externals,
    plugins: [
      rollupJson({ preferConst: true }),
      typescript({ tsconfig: "./tsconfig.json" }),
      MODE === "production" ? terser() : null
    ],
    inlineDynamicImports: true,
    treeshake: {
      propertyReadSideEffects: false,
      pureExternalModules: true
    },
    onwarn: ((warning, warn) => {
      // Ignore circular dependency warnings
      if (warning.code !== "CIRCULAR_DEPENDENCY") warn(warning);
    }) as WarningHandler
  });

  await bundle.write({
    preferConst: true,
    format: "umd",
    file: outputFile,
    globals:{
      parsimmon:'Parsimmon',
      mithril:'m'
    },
    sourcemap:true
  });

}

init()
  .then(() => {
    Promise.all([
      copyStatic(),
      generateCss(),
      generateToolsJs(),
      generateBackendJs(),
      generateFrontendJs()
    ])
      .then(() => {})
      .catch(err => {
        process.stderr.write(err.stack + "\n");
      });
  })
  .catch(err => {
    process.stderr.write(err.stack + "\n");
  });
