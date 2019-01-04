const path = require("path");
const fs = require("fs");
const util = require("util");
const webpack = require("webpack");
const nodeExternals = require("webpack-node-externals");
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

function cpDirSync(src, dst) {
  fs.mkdirSync(dst);
  const files = fs.readdirSync(src);
  for (const file of files) {
    const current = fs.lstatSync(path.join(src, file));
    if (current.isDirectory()) {
      cpDirSync(path.join(src, file), path.join(dst, file));
    } else if (current.isSymbolicLink()) {
      const symlink = fs.readlinkSync(path.join(src, file));
      fs.symlinkSync(symlink, path.join(dst, file));
    } else {
      fs.copyFileSync(path.join(src, file), path.join(dst, file));
    }
  }
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
    "config/config-ui-sample.json",
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

  cpDirSync(
    path.resolve(INPUT_DIR, "tools"),
    path.resolve(OUTPUT_DIR, "tools")
  );
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

async function generateJs() {
  const backendConf = {
    mode: MODE,
    target: "node",
    node: false,
    entry: {
      "genieacs-cwmp": path.resolve(INPUT_DIR, "bin/genieacs-cwmp"),
      "genieacs-nbi": path.resolve(INPUT_DIR, "bin/genieacs-nbi"),
      "genieacs-fs": path.resolve(INPUT_DIR, "bin/genieacs-fs"),
      "genieacs-ui": path.resolve(INPUT_DIR, "bin/genieacs-ui")
    },
    resolve: {
      alias: {
        [path.resolve(INPUT_DIR, "package.json")]: path.resolve(
          OUTPUT_DIR,
          "package.json"
        )
      }
    },
    externals: [nodeExternals()],
    output: {
      path: path.resolve(OUTPUT_DIR, "bin")
    },
    module: {
      rules: [
        {
          include: path.resolve(INPUT_DIR, "bin"),
          use: path.join(__dirname, "./shebang-loader")
        }
      ]
    },
    plugins: [
      new webpack.BannerPlugin({ banner: "#!/usr/bin/env node", raw: true })
    ]
  };

  const frontendConf = {
    mode: MODE,
    entry: path.resolve(INPUT_DIR, "ui/app.js"),
    output: {
      path: path.resolve(OUTPUT_DIR, "public"),
      filename: "app.js"
    },
    resolve: {
      alias: {
        [path.resolve(INPUT_DIR, "package.json")]: path.resolve(
          OUTPUT_DIR,
          "package.json"
        )
      }
    }
  };

  const stats = await util.promisify(webpack)([backendConf, frontendConf]);

  // Remove js ext and mark as executable
  for (const file of [
    "genieacs-cwmp",
    "genieacs-nbi",
    "genieacs-fs",
    "genieacs-ui"
  ]) {
    fs.renameSync(
      path.resolve(OUTPUT_DIR, `bin/${file}.js`),
      path.resolve(OUTPUT_DIR, `bin/${file}`)
    );
    const mode = fs.statSync(path.resolve(OUTPUT_DIR, `bin/${file}`)).mode;
    fs.chmodSync(path.resolve(OUTPUT_DIR, `bin/${file}`), mode | 73);
  }

  process.stdout.write(stats.toString({ colors: true }) + "\n");
}

init()
  .then(() => {
    Promise.all([copyStatic(), generateCss(), generateJs()])
      .then(() => {})
      .catch(err => {
        process.stderr.write(err.stack + "\n");
      });
  })
  .catch(err => {
    process.stderr.write(err.stack + "\n");
  });
