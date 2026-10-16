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
  const brokerControls = readFile("vscode-extension/webview/broker-controls.js");
  const dashboardProvider = readFile("vscode-extension/src/DashboardProvider.ts");
  const dashboardController = readFile("vscode-extension/src/DashboardController.ts");
  const packageJson = JSON.parse(readFile("vscode-extension/package.json"));
  assert(css.includes("max-width: 390px"), "VSIX compact CSS is missing its width limit.");
  assert(css.includes(":focus-visible"), "VSIX compact CSS is missing focus-visible styling.");
  assert(packageJson.contributes?.commands?.some((command) => command.command === "integratedPower.agentRuns.openCompact"), "VSIX package is missing the compact-panel command.");
  assert(brokerControls.includes("createElement") && brokerControls.includes("textContent"), "Broker controls must build user data with safe DOM APIs.");
  assert(!/\.innerHTML\s*=/.test(brokerControls), "Broker controls must not assign dynamic innerHTML.");
  assert(dashboardProvider.includes('"broker-controls.js"'), "DashboardProvider must load the broker controls module.");
  assert(dashboardController.includes("brokerScope()") && dashboardController.includes("requireScopedTask"), "Broker mutations must use the current workspace scope and revalidate task revisions.");
  for (const action of ["createBrokerTask", "delegateBrokerTask", "cancelBrokerTask", 'action: "approve"', 'action: "reject"', 'type: "openArtifact"']) {
    assert(brokerControls.includes(action), `Broker controls are missing ${action}.`);
  }

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
    setTimeout: () => 0,
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
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

  const readyGemini = webviewSandbox.IPQuota.buildTokenMetric("5Hours", { antigravityPercentage: 68 }, "antigravity", "Gemini 5Hours", "antigravityWeekly");
  const readyHtml = webviewSandbox.renderCapacityGroup("Gemini", [readyGemini]);
  assert(readyHtml.includes('data-prewarm="antigravity"') && /class="prewarm-btn[^\"]*"[^>]*disabled/.test(readyHtml), "each supported model must render its prewarm button disabled with an eligibility reason when the 5h window is not Ready");
  assert(!readyHtml.includes(">99.9% capacity retained") && !readyHtml.includes("starts 5h recharge timer"), "IDE prewarm tooltip must not promise quota retention or a confirmed timer");
  assert(readyHtml.includes("progress-ticks") && readyHtml.includes('data-segments="5"'), "IDE 5h gauge must render five full-track segments");
  const weeklyHtml = webviewSandbox.renderCapacityMetric(webviewSandbox.IPQuota.buildTokenMetric("Weekly", { antigravityWeeklyPercentage: 47 }, "antigravityWeekly", "Gemini Weekly"), "Gemini");
  assert(weeklyHtml.includes('data-segments="7"'), "IDE weekly gauge must render seven full-track segments");

  // GPU compact UI regression: verify CSS containment for GPU headers and metric rows
  assert(css.includes(".capacity-group-header h3") && css.includes("text-overflow: ellipsis"), "capacity-group-header h3 must include text-overflow: ellipsis for narrow sidebars");
  assert(css.includes(".reset-left") && css.includes("white-space: nowrap"), ".reset-left must include white-space: nowrap to prevent '%' from breaking onto a new line");

  // GPU webview render regression: verify responsive 3-stage title & compact right-text
  const gpuHtml = webviewSandbox.renderLocalComputeStatus({
    localComputeStatus: {
      endpointHealth: "offline",
      gpus: [
        {
          id: 0,
          name: "NVIDIA GeForce RTX 3090",
          utilizationPercentage: 33,
          powerDrawW: 103.88,
          powerLimitW: 370,
          vramUsedMb: 4400,
          vramTotalMb: 24576,
        },
      ],
    },
  });
  assert(gpuHtml.includes("GPU 0: 3090 [Act]"), "GPU capacity group header must include shortened text-short label (GPU 0: 3090 [Act])");
  assert(gpuHtml.includes("104W"), "GPU power in short mode must be rounded compact without decimal places (104W)");
  assert(gpuHtml.includes("4.3/24G"), "GPU VRAM in short mode must be compact (4.3/24G)");

  // When a browser is installed, measure the actual broker panel at narrow widths.
  const os = require("os");
  const { execFileSync } = require("child_process");
  const { pathToFileURL } = require("url");
  const chromeCandidates = [
    process.env.CHROME_BIN,
    process.env.CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].filter((candidate) => candidate && fs.existsSync(candidate));
  if (chromeCandidates.length) {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ip-compact-layout-"));
    try {
      const fixturePath = path.join(tempRoot, "fixture.html");
      const styleUrl = pathToFileURL(path.join(repoRoot, "vscode-extension", "webview", "styles.css")).href;
      const coreUrl = pathToFileURL(path.join(repoRoot, "vscode-extension", "webview", "quota-core.js")).href;
      const controlsUrl = pathToFileURL(path.join(repoRoot, "vscode-extension", "webview", "broker-controls.js")).href;
      const mainUrl = pathToFileURL(path.join(repoRoot, "vscode-extension", "webview", "main.js")).href;
      const dashboardState = {
        workspaceName: "A deliberately long Integrated Power workspace name",
        runsFile: "reports/agent-runs.jsonl",
        runs: [{ id: "run-1", title: "A long completed run title that must remain readable", status: "completed", active: false, updatedAt: "2026-10-13T02:00:00Z", summary: "Completed synthetic work", artifacts: [] }],
        activeRuns: [{ id: "run-active", title: "A long active run title", status: "running", active: true, startedAt: "2026-10-13T01:00:00Z", summary: "Running synthetic task", artifacts: [] }],
        artifacts: [{ id: "artifact-1", label: "reports/a-long-synthetic-artifact-name.json", runId: "run-1", runTitle: "Completed run", type: "report", workspacePath: "reports/a-long-synthetic-artifact-name.json", canOpen: true }],
        parseErrors: ["Run log parsing: a deliberately long synthetic parser error that should wrap cleanly."],
        systemErrors: ["Dashboard error: a deliberately long synthetic error that should wrap without clipping."],
        isLoading: false, isTokenLoading: false, isStale: false,
        sectionStates: { antigravity: true, codex: true, openai: true, claude: true, localLlm: true },
        viewConfig: { showAntigravity: true, showCodex: true, showOpenai: true, showClaude: true, showLocalLlm: true, showQueue: true, showMetrics: true, showErrors: true },
        prewarmMode: "click", prewarmModes: { antigravity: "click", opus: "once", codex: "always" },
        updatedAt: "2026-10-13T02:00:00Z",
        tokenStatus: {
          antigravityPercentage: 68, antigravityTokensLeft: 680, antigravityMax: 1000, antigravityResetTime: "2026-10-13T06:00:00Z",
          antigravityWeeklyPercentage: 47, antigravityWeeklyTokensLeft: 4700, antigravityWeeklyMax: 10000, antigravityWeeklyResetTime: "2026-10-17T00:00:00Z",
          opusPercentage: 52, opusTokensLeft: 520, opusMax: 1000, opusResetTime: "2026-10-13T05:00:00Z",
          opusWeeklyPercentage: 35, opusWeeklyTokensLeft: 3500, opusWeeklyMax: 10000, opusWeeklyResetTime: "2026-10-17T00:00:00Z",
          codexPercentage: 84, codexTokensLeft: 840, codexMax: 1000, codexResetTime: "2026-10-13T06:30:00Z",
          codexWeeklyPercentage: 72, codexWeeklyTokensLeft: 7200, codexWeeklyMax: 10000, codexWeeklyResetTime: "2026-10-17T00:00:00Z",
          claudePercentage: 45, claudeTokensLeft: 450, claudeMax: 1000, claudeWeeklyPercentage: 62, claudeWeeklyTokensLeft: 6200, claudeWeeklyMax: 10000,
          localComputeStatus: { endpointHealth: "online", programName: "vLLM", loadedModels: ["qwen3.8:27b"], gpus: [{ id: 0, name: "NVIDIA GeForce RTX 3090", utilizationPercentage: 33, powerDrawW: 103.88, powerLimitW: 370, vramUsedMb: 4400, vramTotalMb: 24576 }] },
          activity: [],
        },
        localLlmMetrics: [{ source: "vLLM", model: "qwen3.8:27b", tokensPerSecond: 37.4, promptTokens: 1024, completionTokens: 256, updatedAt: "2026-10-13T02:00:00Z" }],
        queueContent: "## Current queue\n- A long synthetic queue item that should wrap at every compact width without clipping.",
        metricsCsv: "timestamp,model,tokens_per_second\n2026-10-13T02:00:00Z,qwen3.8:27b,37.4",
      };
      const brokerState = {
        workspaceName: dashboardState.workspaceName, loading: false, busy: false, tasks: [
          { id: "task-1", title: "A deliberately long broker task title that must wrap", goal: "A long synthetic task goal that must not push actions beyond the panel edge.", status: "running", revision: 4 },
          ...Array.from({ length: 21 }, (_, index) => {
            const status = ["completed", "cancelled", "failed", "merged"][index % 4];
            return {
            id: `history-${index}`, title: `Historical task ${index + 1}`, goal: "Synthetic historical record.", status, revision: 4,
            ...(index === 19 ? {} : { createdAt: index === 20 ? "not-a-date" : "2026-08-15T12:34:00.000Z" }),
            };
          }),
        ], approvals: [
          { id: "approval-1", taskId: "task-1", action: "external-send", description: "Confirm this long approval description without breaking the compact dashboard panel.", expectedRevision: 4 },
        ], artifacts: dashboardState.artifacts,
      };
      const fixture = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${styleUrl}">
<style>
:root{--vscode-foreground:#ddd;--vscode-editor-background:#222;--vscode-descriptionForeground:#aaa;--vscode-button-foreground:#fff;--vscode-button-background:#06a;--vscode-focusBorder:#58f;--vscode-panel-border:#555;--vscode-input-background:#151515;--vscode-input-foreground:#ddd;--vscode-input-border:#555}
html,body,#app{width:199px;max-width:199px;min-width:0;margin:0;box-sizing:border-box}
</style></head><body><div id="app"></div>
<script>window.__posted=[];window.acquireVsCodeApi=()=>({getState:()=>undefined,setState:()=>{},postMessage:(message)=>window.__posted.push(message)});</script>
<script src="${coreUrl}"></script><script>window.IPQuota=window.IPQuota||IPQuota;</script>
<script src="${controlsUrl}"></script><script src="${mainUrl}"></script>
<script>
const sendBrokerMessage=message=>window.dispatchEvent(new MessageEvent("message",{data:JSON.parse(JSON.stringify(message))}));
sendBrokerMessage({type:"state",state:${JSON.stringify(dashboardState)}});
sendBrokerMessage({type:"brokerState",state:${JSON.stringify(brokerState)}});
sendBrokerMessage({type:"brokerState",state:{...${JSON.stringify(brokerState)},error:"Integrated Power broker is not started."}});
const brokerErrorInitiallyVisible=document.querySelector("#app .broker-error")?.textContent==="Integrated Power broker is not started.";
const successWireMessage=JSON.parse(JSON.stringify({type:"brokerState",state:{...${JSON.stringify(brokerState)},error:undefined}}));
const successWireOmittedError=!Object.prototype.hasOwnProperty.call(successWireMessage.state,"error");
sendBrokerMessage(successWireMessage);
const staleErrorClearedAfterSuccess=!document.querySelector("#app .broker-error");
sendBrokerMessage({type:"brokerState",state:{...${JSON.stringify(brokerState)},error:"Latest broker action failed."}});
const incomingBrokerErrorPreserved=document.querySelector("#app .broker-error")?.textContent==="Latest broker action failed.";
sendBrokerMessage({type:"brokerLoading",busy:true});
const staleErrorClearedOnLoading=!document.querySelector("#app .broker-error");
const results=[];
for(const width of [199,160,120]){
  for(const node of [document.documentElement,document.body,document.getElementById("app")])node.style.width=width+"px";
  const visible=[...document.querySelectorAll("#app *")].filter(e=>e.getClientRects().length&&getComputedStyle(e).visibility!=="hidden");
  const outOfBounds=visible.filter(e=>{const r=e.getBoundingClientRect();return r.left< -1||r.right>width+1;}).map(e=>({node:String(e.tagName),className:String(e.className||""),text:(e.innerText||"").slice(0,45),parent:String(e.parentElement?.className||e.parentElement?.tagName||""),left:Math.round(e.getBoundingClientRect().left),right:Math.round(e.getBoundingClientRect().right)}));
  const controls=[...document.querySelectorAll("#app button,#app input,#app textarea,#app select,#app a")].filter(e=>e.getClientRects().length);
  const overflowingButtons=controls.filter(e=>e.tagName==="BUTTON"&&e.scrollWidth>e.clientWidth+1).map(e=>({label:e.innerText,left:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right,scrollWidth:e.scrollWidth,clientWidth:e.clientWidth}));
  const multilineButtons=controls.filter(e=>e.tagName==="BUTTON").flatMap(button=>{const range=document.createRange();range.selectNodeContents(button);const tops=[...new Set([...range.getClientRects()].map(rect=>Math.round(rect.top)))].sort((a,b)=>a-b);const lines=tops.filter((top,index)=>index===0||top-tops[index-1]>2);return lines.length>1?[{label:button.innerText,lines}]:[]});
  const controlBounds=controls.filter(e=>{const r=e.getBoundingClientRect();return r.left< -1||r.right>width+1;}).map(e=>({label:(e.innerText||e.getAttribute("aria-label")||e.value||"").slice(0,40),left:Math.round(e.getBoundingClientRect().left),right:Math.round(e.getBoundingClientRect().right)}));
  const clippedControls=controls.flatMap(e=>{const r=e.getBoundingClientRect();for(let p=e.parentElement;p&&p!==document.body;p=p.parentElement){const overflow=getComputedStyle(p).overflowX;if((overflow==="hidden"||overflow==="clip")&&(r.left<p.getBoundingClientRect().left-1||r.right>p.getBoundingClientRect().right+1))return [{label:(e.innerText||e.getAttribute("aria-label")||e.value||"").slice(0,40),ancestor:String(p.className||p.tagName)}]}return []});
  const prewarm=[...document.querySelectorAll("#app button[data-prewarm]")].map(e=>({target:e.dataset.prewarm,disabled:e.disabled,title:e.title}));
  const history=document.querySelector("#app details.broker-history");
  const historySummary=history?.querySelector("summary");
  const historyStages=Object.fromEntries(["full","medium","short"].map(stage=>{const node=historySummary?.querySelector(".text-"+stage);return [stage,{visible:Boolean(node&&getComputedStyle(node).display!=="none"),text:node?.textContent||""}]}));
  const historyRange=historySummary&&document.createRange();
  if(historyRange)historyRange.selectNodeContents(historySummary);
  const historyLines=historyRange?[...new Set([...historyRange.getClientRects()].map(rect=>Math.round(rect.top)))].length:0;
  const historicalStates=[...(history?.querySelectorAll(".broker-task-state")||[])].map(e=>e.textContent);
  results.push({width,bodyClient:document.body.clientWidth,bodyScroll:document.body.scrollWidth,appClient:document.getElementById("app").clientWidth,appScroll:document.getElementById("app").scrollWidth,controls:controls.length,controlBounds,clippedControls,outOfBounds:outOfBounds.slice(0,20),overflowingButtons,multilineButtons,prewarm,historySummary:historySummary?.innerText||"",historyStages,historyAriaLabel:historySummary?.getAttribute("aria-label")||"",historyTitle:historySummary?.title||"",historySummaryOpen:history?.open??null,historySummaryOverflow:historySummary?historySummary.scrollWidth>historySummary.clientWidth:false,historySummaryWidth:historySummary?.clientWidth??0,historySummaryScrollWidth:historySummary?.scrollWidth??0,historySummaryLines:historyLines,historyCardCount:history?.querySelectorAll("article.broker-card").length??0,historyDatedTaskCount:historicalStates.filter(text=>text.includes("2026-08-15")).length,historyInventedDate:historicalStates.some(text=>text.includes("Invalid Date")),sections:[...document.querySelectorAll("#app h1,#app h2,#app h3")].map(e=>e.innerText).slice(0,20)});
}
const disabledButtons=[...document.querySelectorAll("#app button[data-prewarm]")];
disabledButtons.forEach(e=>e.click());
const disabledDispatches=window.__posted.filter(message=>message.type==="prewarm").length;
const readGauges=()=>[...document.querySelectorAll("#app .token-metric .progress-track")].map(track=>({label:track.getAttribute("aria-label"),group:track.closest(".capacity-group")?.querySelector(".text-full")?.textContent,segments:Number(track.querySelector(".progress-ticks")?.dataset.segments),trackWidth:track.getBoundingClientRect().width,trackClientWidth:track.clientWidth,tickWidth:track.querySelector(".progress-ticks")?.getBoundingClientRect().width,fillWidth:track.querySelector(".progress-fill")?.getBoundingClientRect().width,background:getComputedStyle(track.querySelector(".progress-ticks")).backgroundImage}));
const partialGauge=readGauges();
window.dispatchEvent(new MessageEvent("message",{data:{type:"state",state:{...${JSON.stringify(dashboardState)},tokenStatus:{antigravityPercentage:100,antigravityWeeklyPercentage:100,opusPercentage:100,opusWeeklyPercentage:100,codexPercentage:100,codexWeeklyPercentage:100}}}}));
const readyButtons=[...document.querySelectorAll("#app button[data-prewarm]")];
readyButtons.forEach(e=>e.click());
const dispatchedTargets=window.__posted.filter(message=>message.type==="prewarm").map(message=>message.model).sort();
const readyGauge=readGauges();
window.dispatchEvent(new MessageEvent("message",{data:{type:"state",state:{...${JSON.stringify(dashboardState)},tokenStatus:{}}}}));
const unavailableGauge=document.querySelector("#app .token-metric.unavailable .progress-track");
const unavailable={segments:Number(unavailableGauge?.querySelector(".progress-ticks")?.dataset.segments),trackClientWidth:unavailableGauge?.clientWidth,tickWidth:unavailableGauge?.querySelector(".progress-ticks")?.getBoundingClientRect().width};
for(const node of [document.documentElement,document.body,document.getElementById("app")])node.style.width="900px";
window.dispatchEvent(new MessageEvent("message",{data:{type:"state",state:${JSON.stringify(dashboardState)}}}));
const readHistoryLabel=()=>{const summary=document.querySelector("#app details.broker-history summary");return {full:summary?.querySelector(".text-full")?.textContent||"",medium:summary?.querySelector(".text-medium")?.textContent||"",short:summary?.querySelector(".text-short")?.textContent||"",visible:Object.fromEntries(["full","medium","short"].map(stage=>{const node=summary?.querySelector(".text-"+stage);return [stage,Boolean(node&&getComputedStyle(node).display!=="none")]})),ariaLabel:summary?.getAttribute("aria-label")||""}};
const historyPanel=document.querySelector("#app .broker-panel");
historyPanel.style.maxWidth="none";
historyPanel.style.width="900px";
const fullHistoryLabel=readHistoryLabel();
historyPanel.style.width="260px";
const mediumHistoryLabel=readHistoryLabel();
document.title=JSON.stringify({results,disabledDispatches,dispatchedTargets,partialGauge,readyGauge,unavailable,fullHistoryLabel,mediumHistoryLabel,brokerStateProof:{brokerErrorInitiallyVisible,successWireOmittedError,staleErrorClearedAfterSuccess,incomingBrokerErrorPreserved,staleErrorClearedOnLoading}});
</script></body></html>`;
      fs.writeFileSync(fixturePath, fixture, "utf8");
      const launcher = [
        "--headless=new", "--no-sandbox", "--disable-gpu", "--allow-file-access-from-files",
        "--no-first-run", "--disable-default-apps", "--disable-background-networking", "--password-store=basic",
        "--window-size=199,900", "--dump-dom", pathToFileURL(fixturePath).href,
      ];
      if (process.env.IP_PARITY_SCREENSHOT_PATH) {
        fs.mkdirSync(path.dirname(process.env.IP_PARITY_SCREENSHOT_PATH), { recursive: true });
        launcher.splice(launcher.length - 1, 0, `--screenshot=${process.env.IP_PARITY_SCREENSHOT_PATH}`, "--window-size=900,900");
      }
      const dom = execFileSync(chromeCandidates[0], launcher, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 20000, maxBuffer: 4 * 1024 * 1024 });
      const title = dom.match(/<title>(.*?)<\/title>/s)?.[1];
      assert(title, "Chromium did not return compact layout measurements.");
      const { results: measurements, disabledDispatches, dispatchedTargets, partialGauge, readyGauge, unavailable, brokerStateProof, fullHistoryLabel, mediumHistoryLabel } = JSON.parse(title);
      for (const measured of measurements) {
        const width = measured.width;
        for (const target of ["body", "app"]) {
          assert(measured[`${target}Scroll`] <= measured[`${target}Client`], `${target} horizontally overflows at ${width}px: ${JSON.stringify(measured)}`);
        }
        assert(measured.controlBounds.length === 0, `A visible dashboard control extends outside ${width}px: ${JSON.stringify(measured.controlBounds)}`);
        assert(measured.clippedControls.length === 0, `A dashboard control is clipped by an ancestor at ${width}px: ${JSON.stringify(measured.clippedControls)}`);
        assert(measured.overflowingButtons.length === 0, `A button label overflows its control at ${width}px: ${JSON.stringify(measured.overflowingButtons)}`);
        assert(measured.multilineButtons.length === 0, `A button label breaks across lines at ${width}px: ${JSON.stringify(measured.multilineButtons)}`);
        assert(measured.outOfBounds.length === 0, `A visible dashboard element extends outside ${width}px: ${JSON.stringify(measured.outOfBounds)}`);
        assert(measured.controls >= 15, `The full dashboard fixture did not render at ${width}px: ${JSON.stringify(measured)}`);
        assert(measured.sections.some((title) => title.includes("Broker tasks")), `Broker controls did not render at ${width}px.`);
        assert(JSON.stringify([...new Set(measured.prewarm.map((button) => button.target))].sort()) === JSON.stringify(["antigravity", "codex", "opus"]), `all three model actions must render at ${width}px`);
        assert(measured.prewarm.length === 6, `both 5-hour and weekly prewarm actions must render for all three models at ${width}px`);
        assert(measured.prewarm.every((button) => button.disabled && button.title.length > 0), `non-Ready model actions must be disabled with a reason at ${width}px`);
        assert(measured.historySummary.includes("History (21)"), `collapsed terminal history must show its count at ${width}px: ${JSON.stringify(measured)}`);
        assert(measured.historyStages.short.visible && !measured.historyStages.medium.visible && !measured.historyStages.full.visible, `short history label must be the only visible stage at ${width}px: ${JSON.stringify(measured.historyStages)}`);
        assert(measured.historyStages.short.text === "History (21)", `short history label must preserve the two-digit count at ${width}px`);
        assert(measured.historyAriaLabel === "History (21) · 2026-08-15" && measured.historyTitle === measured.historyAriaLabel, `the accessible label and tooltip must retain the full creation date at ${width}px`);
        assert(measured.historySummaryOpen === false, `terminal history must start collapsed at ${width}px`);
        assert(measured.historyCardCount === 21, `terminal history must retain every old task at ${width}px`);
        assert(measured.historySummaryOverflow === false, `history summary must fit without horizontal clipping at ${width}px: ${JSON.stringify(measured)}`);
        assert(measured.historySummaryLines <= 1, `history summary must stay on one line at ${width}px`);
        assert(measured.historyDatedTaskCount === 19, `only valid createdAt dates may be shown for history at ${width}px: ${JSON.stringify(measured)}`);
        assert(measured.historyInventedDate === false, `missing or invalid createdAt values must not create fake dates at ${width}px`);
      }
      assert(brokerStateProof.brokerErrorInitiallyVisible, "the broker transport fixture must first display the received error");
      assert(brokerStateProof.successWireOmittedError, "JSON serialization must drop the undefined error field from a success snapshot");
      assert(brokerStateProof.staleErrorClearedAfterSuccess, "a successful broker snapshot without an error must clear the prior broker error");
      assert(brokerStateProof.incomingBrokerErrorPreserved, "a new broker action error must remain visible");
      assert(brokerStateProof.staleErrorClearedOnLoading, "a new broker loading snapshot must clear stale broker errors");
      assert(fullHistoryLabel.full === "History (21) · 2026-08-15" && fullHistoryLabel.visible.full && !fullHistoryLabel.visible.medium && !fullHistoryLabel.visible.short, `wide panels must use the full label: ${JSON.stringify(fullHistoryLabel)}`);
      assert(mediumHistoryLabel.medium === "History (21) · 8/15" && mediumHistoryLabel.visible.medium && !mediumHistoryLabel.visible.full && !mediumHistoryLabel.visible.short, `medium panels must use the medium label: ${JSON.stringify(mediumHistoryLabel)}`);
      assert(fullHistoryLabel.short === "History (21)" && mediumHistoryLabel.short === "History (21)", "short label must retain the count while dates remain available in accessible text");
      assert(disabledDispatches === 0, "disabled prewarm actions must not dispatch to the IDE bridge");
      assert(JSON.stringify([...new Set(dispatchedTargets)].sort()) === JSON.stringify(["antigravity", "codex", "opus"]), "enabled model actions must dispatch each canonical target through the IDE bridge");
      assert(partialGauge.length >= 6, `all provider windows must render an actual gauge overlay: ${JSON.stringify(partialGauge)}`);
      for (const [index, item] of partialGauge.entries()) {
        const expectedSegments = item.label.includes("Weekly") ? 7 : 5;
        assert(item.segments === expectedSegments, `gauge ${index} must keep its ${expectedSegments} segments: ${JSON.stringify(item)}`);
        assert(Math.abs(item.trackClientWidth - item.tickWidth) < 1, `gauge ${index} ticks must cover the full track independently of fill: ${JSON.stringify(item)}`);
        assert(item.fillWidth < item.trackWidth, `partial gauge ${index} must prove ticks do not follow the fill width: ${JSON.stringify(item)}`);
        assert(item.background.includes("linear-gradient") && (item.background.match(/rgba\(255, 255, 255, 0\.55\)/g) || []).length === (expectedSegments - 1) * 2, `gauge ${index} computed divider positions must match the shared ${expectedSegments}-segment gradient`);
      }
      const canonicalReadyGauge = readyGauge.filter((item) => ["Gemini", "Claude", "ChatGPT"].includes(item.group));
      assert(canonicalReadyGauge.length === 6 && canonicalReadyGauge.every((item) => item.segments === (item.label.includes("Weekly") ? 7 : 5) && Math.abs(item.trackClientWidth - item.tickWidth) < 1), `all six Ready provider gauges must retain the full 5/7 segment overlay: ${JSON.stringify(canonicalReadyGauge)}`);
      assert(unavailable.segments === 5, "an unavailable 5h window must retain its gauge ticks");
      assert(Math.abs(unavailable.trackClientWidth - unavailable.tickWidth) < 1, `unavailable gauge ticks must cover the full track: ${JSON.stringify(unavailable)}`);
      console.log("compact UI Chromium layout passed at 199px, 160px, and 120px");
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  } else {
    console.log("compact UI Chromium layout skipped (set CHROME_BIN to run physical width measurements)");
  }

  console.log("compact UI regression passed");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
