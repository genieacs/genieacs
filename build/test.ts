import path from "node:path";
import { readdir, readFile } from "node:fs/promises";

import * as esbuild from "esbuild";

const INPUT_DIR = process.cwd();

// Redirect ui/store.ts imports to test/mocks/store.ts
const mockStorePlugin: esbuild.Plugin = {
  name: "mock-store",
  setup(build) {
    const storePath = path.join(INPUT_DIR, "ui/store.ts");
    const mockStorePath = path.join(INPUT_DIR, "test/mocks/store.ts");

    build.onResolve({ filter: /\.\/store\.ts$/ }, (args) => {
      const resolved = path.join(args.resolveDir, args.path);
      if (resolved === storePath) {
        return { path: mockStorePath };
      }
      return undefined;
    });
  },
};

// Export private functions from reactive-store.ts for testing
const exportPrivateFunctionsPlugin: esbuild.Plugin = {
  name: "export-private-functions",
  setup(build) {
    const reactiveStorePath = path.join(INPUT_DIR, "ui/reactive-store.ts");

    build.onLoad({ filter: /reactive-store\.ts$/ }, async (args) => {
      if (args.path !== reactiveStorePath) return undefined;

      let contents = await readFile(args.path, "utf8");

      const exports = `
// Test-only exports (added by build/test.ts)
export { compareFunction as _testCompareFunction };
export { getObjectId as _testGetObjectId };
export { applyDefaultSort as _testApplyDefaultSort };
export { stores as _testStores };
export { getStore as _testGetStore };
export { ResourceStore as _testResourceStore };
`;
      contents += exports;

      return { contents, loader: "ts" };
    });
  },
};

async function buildTests(): Promise<void> {
  // Find all test files
  const testFiles = (await readdir(path.join(INPUT_DIR, "test")))
    .filter((f) => f.endsWith(".ts"))
    .map((f) => path.join("test", f));

  await esbuild.build({
    entryPoints: testFiles,
    bundle: true,
    platform: "node",
    target: "node18",
    packages: "external",
    sourcemap: "inline",
    outdir: "test",
    logLevel: "warning",
    plugins: [mockStorePlugin, exportPrivateFunctionsPlugin],
  });
}

buildTests().catch((err) => {
  process.stderr.write(err.stack + "\n");
  process.exit(1);
});
