const path = require("path");
const esbuild = require("esbuild");

const extensionRoot = path.resolve(__dirname, "..");

const brokerRoot = path.join(extensionRoot, "out", "broker");

Promise.all([
  esbuild.build({
    absWorkingDir: extensionRoot,
    entryPoints: [path.join(extensionRoot, "src", "broker", "index.ts")],
    outfile: path.join(brokerRoot, "index.js"),
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node18",
    external: ["vscode", "better-sqlite3-multiple-ciphers", "@a2a-js/sdk/*"],
    sourcemap: false,
  }),
  esbuild.build({
    absWorkingDir: path.resolve(extensionRoot, ".."),
    entryPoints: [path.resolve(extensionRoot, "..", "shared", "quota", "index.ts")],
    outfile: path.join(brokerRoot, "shared-quota.js"),
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node18",
    sourcemap: false,
  }),
  esbuild.build({
    absWorkingDir: path.resolve(extensionRoot, ".."),
    entryPoints: [path.resolve(extensionRoot, "..", "shared", "quota", "index.ts")],
    outfile: path.join(brokerRoot, "shared-quota-browser.js"),
    bundle: true,
    platform: "browser",
    format: "esm",
    target: "es2020",
    sourcemap: false,
  }),
]).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
