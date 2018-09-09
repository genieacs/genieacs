const nodeExternals = require("webpack-node-externals");
const CopyWebpackPlugin = require("copy-webpack-plugin");
const CleanWebpackPlugin = require("clean-webpack-plugin");

const mode = "production";

function transformPackageJson(content) {
  const pkg = JSON.parse(content);
  delete pkg["devDependencies"];
  pkg["scripts"] = {
    start: "node cluster"
  };
  return JSON.stringify(pkg, null, 2);
}

module.exports = [
  {
    mode: mode,
    entry: "./server/server.js",
    target: "node",
    externals: [nodeExternals()],
    output: {
      filename: "server.js"
    },
    plugins: [
      new CleanWebpackPlugin(["dist"]),
      new CopyWebpackPlugin(
        [
          { from: "images/logo.svg", to: "public/logo.svg" },
          { from: "images/favicon.png", to: "public/favicon.png" },
          { from: "config.json", to: "config.json" },
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
    entry: "./server/cluster.js",
    target: "node",
    output: {
      filename: "cluster.js"
    }
  },
  {
    mode: mode,
    entry: "./client/app.js",
    output: {
      filename: "public/app.js"
    }
  }
];
