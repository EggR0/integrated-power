const path = require("path");
const esbuild = require("esbuild");

const extensionRoot = path.resolve(__dirname, "..");

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
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
