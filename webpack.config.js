const nodeExternals = require("webpack-node-externals");
const CopyWebpackPlugin = require("copy-webpack-plugin");
const CleanWebpackPlugin = require("clean-webpack-plugin");
const path = require("path");

const mode = "production";

function transformPackageJson(content) {
  const pkg = JSON.parse(content);
  delete pkg["devDependencies"];
  pkg["scripts"] = {
    "start-ui": "node cluster"
  };
  return JSON.stringify(pkg, null, 2);
}

module.exports = [
  {
    mode: mode,
    entry: "./lib/ui/server.js",
    target: "node",
    externals: [nodeExternals()],
    output: {
      filename: "server.js"
    },
    plugins: [
      new CleanWebpackPlugin(["dist"]),
      new CopyWebpackPlugin(
        [
          { from: "public/logo.svg", to: "public/logo.svg" },
          { from: "public/favicon.png", to: "public/favicon.png" },
          { from: "config/config-ui.json", to: "config-ui.json" },
          {
            from: "package.json",
            to: "package.json",
            transform: transformPackageJson
          }
        ],
        {}
      )
    ]
  },
  {
    mode: mode,
    entry: "./lib/ui/cluster.js",
    target: "node",
    output: {
      filename: "cluster.js"
    }
  },
  {
    mode: mode,
    entry: "./ui/app.js",
    output: {
      path: path.resolve(__dirname, "dist/public"),
      filename: "app.js"
    }
  }
];
