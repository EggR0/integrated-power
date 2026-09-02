// Build the webview quota core bundle (IIFE -> window.IPQuota).
//
// The VSIX webview (webview/main.js) is a plain script loaded by the webview
// host without a bundler, so the shared quota module is compiled here into a
// small IIFE it can load via <script src="quota-core.js">. The same source
// (shared/quota/index.ts) is bundled separately for the control-center via
// vite. Keeping one source guarantees the two programs compute identical
// quota numbers.
const path = require("path");
const esbuild = require("esbuild");

const extensionRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(extensionRoot, "..");

esbuild.build({
  absWorkingDir: repoRoot,
  entryPoints: [path.join(repoRoot, "shared", "quota", "index.ts")],
  outfile: path.join(extensionRoot, "webview", "quota-core.js"),
  bundle: true,
  format: "iife",
  globalName: "IPQuota",
  platform: "browser",
  sourcemap: false,
  target: "es2020",
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
