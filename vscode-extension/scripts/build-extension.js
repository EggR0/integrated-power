const path = require("path");
const esbuild = require("esbuild");

const extensionRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(extensionRoot, "..");

// Build the shared quota module into the webview IIFE bundle first so
// webview/quota-core.js is always fresh whenever the extension compiles.
esbuild
  .build({
    absWorkingDir: repoRoot,
    entryPoints: [path.join(repoRoot, "shared", "quota", "index.ts")],
    outfile: path.join(extensionRoot, "webview", "quota-core.js"),
    bundle: true,
    format: "iife",
    globalName: "IPQuota",
    platform: "browser",
    sourcemap: false,
    target: "es2020",
  })
  .then(() =>
    esbuild.build({
      absWorkingDir: extensionRoot,
      entryPoints: [path.join(extensionRoot, "src", "extension.ts")],
      outfile: path.join(extensionRoot, "out", "extension.js"),
      bundle: true,
      external: ["vscode"],
      format: "cjs",
      platform: "node",
      sourcemap: true,
      target: "node18",
    })
  )
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
