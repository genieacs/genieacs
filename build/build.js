const path = require("path");
const fs = require("fs");
const { promisify } = require("util");
const { rollup } = require("rollup");
const rollupReplace = require("rollup-plugin-replace");
const rollupJson = require("rollup-plugin-json");
const { terser } = require("rollup-plugin-terser");
const webpack = require("webpack");
const postcss = require("postcss");
const postcssImport = require("postcss-import");
const postcssCssNext = require("postcss-cssnext");
const cssnano = require("cssnano");

const MODE = "production";

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
  "http",
  "https",
  "zlib",
  "crypto",
  "mongodb",
  "libxmljs",
  "vm",
  "later",
  "parsimmon",
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
  "parsimmon"
];

function rmDirSync(dirPath) {
  if (!fs.existsSync(dirPath)) return;
  const files = fs.readdirSync(dirPath);

  for (const file of files) {
    const filePath = `${dirPath}/${file}`;
    if (fs.statSync(filePath).isFile()) fs.unlinkSync(filePath);
    else rmDirSync(filePath);
  }
  fs.rmdirSync(dirPath);
}

async function init() {
  // Delete any old output directory
  rmDirSync(OUTPUT_DIR);

  // Create output directory layout
  fs.mkdirSync(OUTPUT_DIR);
  fs.mkdirSync(OUTPUT_DIR + "/bin");
  fs.mkdirSync(OUTPUT_DIR + "/config");
  fs.mkdirSync(OUTPUT_DIR + "/debug");
  fs.mkdirSync(OUTPUT_DIR + "/public");
  fs.mkdirSync(OUTPUT_DIR + "/tools");

  // Create package.json
  const packageJson = require("../package.json");
  delete packageJson["devDependencies"];
  packageJson["scripts"] = {
    install: packageJson["scripts"].install,
    configure: packageJson["scripts"].configure
  };
  packageJson["version"] = `${packageJson["version"]}+${BUILD_METADATA}`;
  fs.writeFileSync(
    path.resolve(OUTPUT_DIR, "package.json"),
    JSON.stringify(packageJson, null, 4)
  );
}

async function copyStatic() {
  const files = [
    "LICENSE",
    "README.md",
    "CHANGELOG.md",
    "npm-shrinkwrap.json",
    "config/config-sample.json",
    "config/auth-sample.js",
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

async function generateCss() {
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

async function generateToolsJs() {
  for (const bin of ["configure-ui", "dump-data-model"]) {
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
          "#!/usr/bin/env -S node -r esm": ""
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

async function generateBackendJs() {
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
          "#!/usr/bin/env -S node -r esm": ""
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

async function generateFrontendJs() {
  const inputFile = path.resolve(INPUT_DIR, "ui/app.js");
  const outputFile = path.resolve(OUTPUT_DIR, "public/app.js");

  const bundle = await rollup({
    input: inputFile,
    external: externals,
    plugins: [rollupJson({ preferConst: true })],
    inlineDynamicImports: true,
    treeshake: {
      propertyReadSideEffects: false,
      pureExternalModules: true
    },
    onwarn: (warning, warn) => {
      // Ignore circular dependency warnings
      if (warning.code !== "CIRCULAR_DEPENDENCY") warn(warning);
    }
  });

  await bundle.write({
    preferConst: true,
    format: "esm",
    file: outputFile
  });

  const webpackConf = {
    mode: MODE,
    entry: outputFile,
    output: {
      path: path.resolve(OUTPUT_DIR, "public"),
      filename: "app.js"
    }
  };

  const stats = await promisify(webpack)(webpackConf);
  process.stdout.write(stats.toString({ colors: true }) + "\n");
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
