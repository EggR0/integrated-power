const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..", "..");

function readFile(relativePath) {
  const fullPath = path.join(repoRoot, relativePath);
  if (!fs.existsSync(fullPath)) throw new Error(`Missing file: ${relativePath}`);
  return fs.readFileSync(fullPath, "utf8");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  const controlCenterRoot = fs.existsSync(path.join(repoRoot, "control-center"))
    ? path.join(repoRoot, "control-center")
    : path.resolve(repoRoot, "..", "integrated-power-control-center");
  if (fs.existsSync(controlCenterRoot)) {
    const html = fs.readFileSync(path.join(controlCenterRoot, "index.html"), "utf8");
    const tauri = JSON.parse(fs.readFileSync(path.join(controlCenterRoot, "src-tauri", "tauri.conf.json"), "utf8"));
    const mainRs = fs.readFileSync(path.join(controlCenterRoot, "src-tauri", "src", "main.rs"), "utf8");
    const windowConfig = (tauri.app?.windows ?? tauri.tauri?.windows)?.find((window) => !window.label || window.label === "main");
    assert(html.includes("main-agent-select"), "HTML is missing the main-agent selector.");
    assert(html.includes("log-button"), "HTML is missing the broker log button.");
    assert(!/\binnerHTML\s*=/.test(html), "HTML contains an inline innerHTML assignment.");
    assert(windowConfig?.skipTaskbar === true, "Tauri main window must skip the taskbar.");
    assert(windowConfig?.width === 900, "Tauri main window width must be 900.");
    assert(windowConfig?.height === 640, "Tauri main window height must be 640.");
    for (const marker of ["TrayIconBuilder", "WindowEvent::Moved", "restore_or_place", "show_and_restore_window"]) {
      assert(mainRs.includes(marker), `Tauri entrypoint is missing ${marker}.`);
    }
  }
  const css = readFile("vscode-extension/webview/styles.css");
  const packageJson = JSON.parse(readFile("vscode-extension/package.json"));
  assert(css.includes("max-width: 390px"), "VSIX compact CSS is missing its width limit.");
  assert(css.includes(":focus-visible"), "VSIX compact CSS is missing focus-visible styling.");
  assert(packageJson.contributes?.commands?.some((command) => command.command === "integratedPower.agentRuns.openCompact"), "VSIX package is missing the compact-panel command.");
  console.log("compact UI regression passed");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
