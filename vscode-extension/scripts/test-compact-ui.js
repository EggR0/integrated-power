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
    // 2026-09-02 requirement change: the main window now shows on the OS
    // taskbar / Dock / panel by default (skipTaskbar:false) so it "sticks to the
    // taskbar" per OS. The tray icon stays for quick access, and the in-app
    // "작업표시줄에 창 표시" toggle switches the window to tray-only at runtime.
    assert(windowConfig?.skipTaskbar === false, "Tauri main window must show on the taskbar by default (skipTaskbar:false); tray-only is an in-app toggle.");
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

  // Regression test: verify quota-core.js and main.js evaluate together without SyntaxError
  const vm = require("vm");
  const quotaCoreCode = readFile("vscode-extension/webview/quota-core.js");
  const mainJsCode = readFile("vscode-extension/webview/main.js");
  const mockElement = {
    innerHTML: "",
    style: {},
    dataset: {},
    addEventListener: () => {},
    querySelector: () => null,
    querySelectorAll: () => [],
    closest: () => null,
    focus: () => {},
  };
  const webviewSandbox = {
    console,
    Date,
    Math,
    Number,
    String,
    Array,
    Object,
    Boolean,
    RegExp,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    window: {
      addEventListener: () => {},
      scrollTo: () => {},
    },
    document: {
      getElementById: () => mockElement,
      body: mockElement,
      documentElement: { scrollTop: 0 },
      activeElement: null,
      readyState: "complete",
      addEventListener: () => {},
    },
    acquireVsCodeApi: () => ({
      getState: () => undefined,
      setState: () => {},
      postMessage: () => {},
    }),
  };
  webviewSandbox.window.window = webviewSandbox.window;
  webviewSandbox.window.document = webviewSandbox.document;
  vm.createContext(webviewSandbox);
  vm.runInContext(quotaCoreCode, webviewSandbox);
  webviewSandbox.window.IPQuota = webviewSandbox.IPQuota;
  vm.runInContext(mainJsCode, webviewSandbox);

  const getPrewarmTarget = webviewSandbox.getPrewarmTargetForGroup;
  assert(typeof getPrewarmTarget === "function", "getPrewarmTargetForGroup must be a function");
  assert(getPrewarmTarget("Gemini") === "antigravity", "Gemini must map to antigravity target");
  assert(getPrewarmTarget("Claude") === "opus", "Claude must map to opus target");
  assert(getPrewarmTarget("ChatGPT") === "codex", "ChatGPT must map to codex target");
  assert(getPrewarmTarget("Claude (API & CLI)") === undefined, "Claude (API & CLI) must NOT have prewarm target");
  assert(getPrewarmTarget("GPU 0: RTX 3090") === undefined, "GPU groups must NOT have prewarm target");
  assert(getPrewarmTarget("GPU Offline") === undefined, "GPU Offline group must NOT have prewarm target");

  const rendered = webviewSandbox.renderPrewarmInlineControl("antigravity", "Gemini");
  assert(!rendered.includes("prewarm-inline-label"), "renderPrewarmInlineControl must not contain overflowing prewarm-inline-label");
  assert(rendered.includes("Clk") && rendered.includes("1x") && rendered.includes("Alw"), "renderPrewarmInlineControl must include responsive short labels");

  console.log("compact UI regression passed");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
