import * as vscode from "vscode";
import * as path from "path";
import {
  DashboardConfiguration,
  KnowledgeConfiguration,
  OrchestratorConfiguration,
  detectKnowledgeRemote,
  formatOllamaInventorySummary,
  installBundledKnowledgeTools,
  loadConfigurationCenterSnapshot,
  reconfigureKnowledgeRemote,
  runPrivateKnowledgeConfiguration,
  saveDashboardConfiguration,
  saveOrchestratorConfiguration,
  synchronizeOllamaModelInventory,
} from "./configurationModel";

export type ConfigurationSection =
  | "overview"
  | "dashboard"
  | "orchestrator"
  | "knowledge";

type InstallOrchestrator = () => Promise<string>;

export class ConfigurationCenter implements vscode.Disposable {
  private static current: ConfigurationCenter | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  public static open(
    context: vscode.ExtensionContext,
    section: ConfigurationSection,
    refreshDashboard: () => Promise<void>,
    installOrchestrator: InstallOrchestrator,
  ): void {
    if (ConfigurationCenter.current) {
      ConfigurationCenter.current.panel.reveal(vscode.ViewColumn.One);
      ConfigurationCenter.current.postSnapshot(section);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "integratedPower.configurationCenter",
      "Integrated Power Configuration Center",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.file(context.extensionPath)],
      },
    );
    ConfigurationCenter.current = new ConfigurationCenter(
      panel,
      context,
      refreshDashboard,
      installOrchestrator,
      section,
    );
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly context: vscode.ExtensionContext,
    private readonly refreshDashboard: () => Promise<void>,
    private readonly installOrchestrator: InstallOrchestrator,
    initialSection: ConfigurationSection,
  ) {
    this.panel.webview.html = this.getHtml(this.panel.webview);
    this.disposables.push(
      this.panel.onDidDispose(() => this.dispose()),
      this.panel.webview.onDidReceiveMessage((message) =>
        this.handleMessage(message),
      ),
    );
    this.postSnapshot(initialSection);
  }

  public dispose(): void {
    ConfigurationCenter.current = undefined;
    while (this.disposables.length) this.disposables.pop()?.dispose();
  }

  private async handleMessage(message: unknown): Promise<void> {
    if (!isRecord(message) || typeof message.type !== "string") return;
    try {
      switch (message.type) {
        case "ready":
        case "refresh":
          this.postSnapshot(
            isSection(message.section) ? message.section : undefined,
          );
          return;
        case "saveDashboard": {
          this.postBusy(true);
          const input = parseDashboardConfiguration(message.value);
          const savedPath = await saveDashboardConfiguration(
            this.context,
            input,
            this.refreshDashboard,
          );
          this.postResult("success", `Dashboard 설정 저장 완료: ${savedPath}`);
          this.postSnapshot("dashboard");
          return;
        }
        case "saveOrchestrator": {
          this.postBusy(true);
          const configuration = parseOrchestratorConfiguration(message.value);
          const savedPath = saveOrchestratorConfiguration(
            this.context,
            configuration,
          );
          const inventory =
            configuration.enableLocalLlm && configuration.provider === "ollama"
              ? await synchronizeOllamaModelInventory(
                  this.context,
                  configuration.endpoint,
                )
              : null;
          this.postResult(
            "success",
            inventory
              ? `Integrated Orchestrator 설정 저장 완료: ${savedPath}\n${formatOllamaInventorySummary(inventory)}`
              : `Integrated Orchestrator 설정 저장 완료: ${savedPath}`,
          );
          this.postSnapshot("orchestrator");
          return;
        }
        case "saveAndInstallOrchestrator": {
          this.postBusy(true);
          const configuration = parseOrchestratorConfiguration(message.value);
          saveOrchestratorConfiguration(
            this.context,
            configuration,
          );
          const result = await this.installOrchestrator();
          const inventory =
            configuration.enableLocalLlm && configuration.provider === "ollama"
              ? await synchronizeOllamaModelInventory(
                  this.context,
                  configuration.endpoint,
                )
              : null;
          this.postResult(
            "success",
            inventory
              ? `${result}\n${formatOllamaInventorySummary(inventory)}`
              : result,
          );
          this.postSnapshot("orchestrator");
          return;
        }
        case "syncOllamaInventory": {
          this.postBusy(true);
          const configuration = parseOrchestratorConfiguration(message.value);
          if (!configuration.enableLocalLlm || configuration.provider !== "ollama") {
            throw new Error("Ollama 공급자를 사용하도록 로컬 LLM 경로를 먼저 켜주세요.");
          }
          const inventory = await synchronizeOllamaModelInventory(
            this.context,
            configuration.endpoint,
          );
          this.postResult("success", formatOllamaInventorySummary(inventory));
          this.postSnapshot("orchestrator");
          return;
        }
        case "configureKnowledge": {
          this.postBusy(true);
          const result = await runPrivateKnowledgeConfiguration(
            this.context,
            parseKnowledgeConfiguration(message.value),
          );
          const configuredPath =
            typeof result.knowledge_path === "string"
              ? result.knowledge_path
              : "설정한 Knowledge 저장소";
          this.postResult(
            "success",
            `Private Git Knowledge 설정 완료: ${configuredPath}`,
          );
          this.postSnapshot("knowledge");
          return;
        }
        case "installKnowledgeTools": {
          this.postBusy(true);
          const result = installBundledKnowledgeTools(
            this.context,
            requireString(message.value, "Knowledge 도구 설치 루트"),
          );
          this.postResult(
            "success",
            result.changed.length > 0
              ? `Knowledge 도구 ${result.changed.length}개 설치·갱신 완료: ${result.installRoot}`
              : `Knowledge 도구가 이미 최신입니다: ${result.installRoot}`,
          );
          this.postSnapshot("knowledge");
          return;
        }
        case "detectKnowledgeRemote": {
          const detected = detectKnowledgeRemote(
            parseKnowledgeRemoteReconfiguration(message.value),
          );
          void this.panel.webview.postMessage({
            type: "knowledgeRemoteDetected",
            value: detected,
          });
          this.postResult(
            "success",
            `GitHub 로그인 ${detected.githubLogin} 기준 remote를 제안했습니다. 적용하려면 origin 재설정 버튼을 누르세요.`,
          );
          return;
        }
        case "reconfigureKnowledgeRemote": {
          this.postBusy(true);
          const result = reconfigureKnowledgeRemote(
            parseKnowledgeRemoteReconfiguration(message.value),
          );
          this.postResult(
            "success",
            result.previousRemote
              ? `Knowledge origin 재설정 완료: ${result.previousRemote} → ${result.remoteUrl}`
              : `Knowledge origin 추가 완료: ${result.remoteUrl}`,
          );
          this.postSnapshot("knowledge");
          return;
        }
        case "chooseStateRoot":
          await this.chooseDirectory(
            "Integrated Power 상태 폴더 선택",
            "dashboardStateRoot",
          );
          return;
        case "choosePluginRoot":
          await this.chooseDirectory(
            "Antigravity IDE 플러그인 루트 선택",
            "pluginRoot",
          );
          return;
        case "chooseWorkRoot":
          await this.chooseDirectory(
            "에이전트 공통 작업 루트 선택",
            "workRoot",
          );
          return;
        case "chooseToolsRoot":
          await this.chooseDirectory(
            "Knowledge 도구 설치 루트 선택",
            "toolsRoot",
          );
          return;
        case "chooseKnowledgePath":
          await this.chooseDirectory(
            "Private Git Knowledge 폴더 선택",
            "knowledgePath",
          );
          return;
        case "chooseCodexExe":
          await this.chooseCodexExecutable();
          return;
        case "openKnowledgeGuide":
          await this.openKnowledgeGuide();
          return;
        case "openGitHubNewRepository":
          await vscode.env.openExternal(vscode.Uri.parse("https://github.com/new"));
          return;
      }
    } catch (error) {
      this.postResult("error", errorMessage(error));
    } finally {
      this.postBusy(false);
    }
  }

  private postSnapshot(section?: ConfigurationSection): void {
    try {
      void this.panel.webview.postMessage({
        type: "snapshot",
        value: loadConfigurationCenterSnapshot(this.context),
        section,
      });
    } catch (error) {
      this.postResult("error", errorMessage(error));
    }
  }

  private postBusy(value: boolean): void {
    void this.panel.webview.postMessage({ type: "busy", value });
  }

  private postResult(kind: "success" | "error", message: string): void {
    void this.panel.webview.postMessage({ type: "result", kind, message });
  }

  private async chooseDirectory(title: string, field: string): Promise<void> {
    const selection = await vscode.window.showOpenDialog({
      title,
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: "이 폴더 사용",
    });
    if (selection?.[0]) {
      void this.panel.webview.postMessage({
        type: "fieldValue",
        field,
        value: selection[0].fsPath,
      });
    }
  }

  private async chooseCodexExecutable(): Promise<void> {
    const selection = await vscode.window.showOpenDialog({
      title: "Codex 실행 파일 선택",
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      filters:
        process.platform === "win32"
          ? { Executable: ["exe", "cmd"] }
          : undefined,
      openLabel: "이 실행 파일 사용",
    });
    if (selection?.[0]) {
      void this.panel.webview.postMessage({
        type: "fieldValue",
        field: "codexExe",
        value: selection[0].fsPath,
      });
    }
  }

  private async openKnowledgeGuide(): Promise<void> {
    const guide = path.join(
      this.context.extensionPath,
      "assets",
      "private-git-knowledge.md",
    );
    const document = await vscode.workspace.openTextDocument(
      vscode.Uri.file(guide),
    );
    await vscode.window.showTextDocument(document, { preview: false });
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = createNonce();
    return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <title>Integrated Power Configuration Center</title>
  <style nonce="${nonce}">
    :root {
      color-scheme: light dark;
      --card: color-mix(in srgb, var(--vscode-editor-background) 88%, var(--vscode-editor-foreground) 12%);
      --line: color-mix(in srgb, var(--vscode-editor-foreground) 18%, transparent);
      --muted: var(--vscode-descriptionForeground);
      --ok: var(--vscode-testing-iconPassed);
      --warn: var(--vscode-notificationsWarningIcon-foreground);
      --bad: var(--vscode-testing-iconFailed);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 0;
      color: var(--vscode-editor-foreground);
      background: var(--vscode-editor-background);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }
    header {
      position: sticky;
      top: 0;
      z-index: 3;
      padding: 20px 28px 14px;
      border-bottom: 1px solid var(--line);
      background: color-mix(in srgb, var(--vscode-editor-background) 94%, transparent);
      backdrop-filter: blur(10px);
    }
    h1 { margin: 0 0 5px; font-size: 24px; }
    h2 { margin: 0 0 8px; font-size: 19px; }
    h3 { margin: 0 0 8px; font-size: 15px; }
    p { line-height: 1.55; }
    .subtitle, .hint, .path { color: var(--muted); }
    nav { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
    nav button {
      border: 1px solid var(--line);
      background: transparent;
      color: inherit;
    }
    nav button.active {
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
      border-color: transparent;
    }
    main { max-width: 1040px; margin: 0 auto; padding: 26px 28px 70px; }
    section { display: none; }
    section.active { display: block; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 14px; }
    .card {
      padding: 18px;
      border: 1px solid var(--line);
      border-radius: 10px;
      background: var(--card);
    }
    .card + .card { margin-top: 14px; }
    .grid .card + .card { margin-top: 0; }
    .status { font-weight: 600; }
    .ok { color: var(--ok); }
    .warn { color: var(--warn); }
    .bad { color: var(--bad); }
    .field { margin: 15px 0; }
    .field > label:first-child { display: block; margin-bottom: 6px; font-weight: 600; }
    input[type="text"], input[type="email"], input[type="url"], input[type="number"], select {
      width: 100%;
      min-height: 32px;
      padding: 6px 8px;
      color: var(--vscode-input-foreground);
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border, var(--line));
    }
    input:focus, select:focus, button:focus {
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: 1px;
    }
    .inline { display: flex; gap: 8px; align-items: center; }
    .inline input { flex: 1; }
    .check { display: flex; gap: 8px; align-items: flex-start; margin: 10px 0; }
    .check input { margin-top: 2px; }
    button {
      min-height: 32px;
      padding: 6px 12px;
      border: 0;
      border-radius: 3px;
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
      cursor: pointer;
    }
    button:hover { background: var(--vscode-button-hoverBackground); }
    button.secondary {
      color: var(--vscode-button-secondaryForeground);
      background: var(--vscode-button-secondaryBackground);
    }
    button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
    button:disabled { cursor: wait; opacity: .55; }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 18px; }
    .result {
      position: sticky;
      bottom: 12px;
      display: none;
      margin: 0 auto;
      max-width: 980px;
      padding: 11px 14px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--vscode-notifications-background);
      box-shadow: 0 4px 18px rgba(0, 0, 0, .25);
    }
    .result.visible { display: block; }
    .diag-list { margin: 10px 0 0; padding: 0; list-style: none; }
    .diag-list li { margin: 7px 0; }
    code.path {
      display: block;
      overflow-wrap: anywhere;
      margin-top: 6px;
      padding: 7px;
      border-radius: 4px;
      background: var(--vscode-textCodeBlock-background);
    }
    .notice {
      border-left: 3px solid var(--vscode-focusBorder);
      padding-left: 12px;
    }
    .subform { margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--line); }
    .hidden { display: none !important; }
  </style>
</head>
<body>
  <header>
    <h1>Integrated Power Configuration Center</h1>
    <div class="subtitle">사용량 확인, 에이전트 작업 연결, 사용자 소유 지식 보존을 한 화면에서 각각 설정합니다.</div>
    <nav aria-label="설정 영역">
      <button type="button" data-section="overview">개요</button>
      <button type="button" data-section="dashboard">Dashboard</button>
      <button type="button" data-section="orchestrator">Integrated Orchestrator</button>
      <button type="button" data-section="knowledge">Private Git Knowledge</button>
    </nav>
  </header>
  <main>
    <section id="overview">
      <div class="grid">
        <article class="card"><h3>Dashboard</h3><div id="status-dashboard" class="status">확인 중</div><p>Antigravity IDE·Codex의 제공자 사용량과 로컬 GPU 상태를 한곳에서 비교해, 어느 실행 경로를 쓸지 판단할 근거를 제공합니다.</p></article>
        <article class="card"><h3>Integrated Orchestrator</h3><div id="status-orchestrator" class="status">확인 중</div><p><code>ip-orchestrator</code>가 현재 에이전트, Codex, 하드웨어에 맞는 로컬 LLM 사이에서 작업 경로를 고릅니다. Antigravity IDE에서는 같은 작업의 출력을 <code>ip-orchestrator.md</code> 하나로 합쳐 prompt/response 아티팩트가 계속 늘지 않게 합니다. Dashboard와 분리 설치되어 사용량 화면을 열었다고 실행 규칙이 바뀌지는 않습니다.</p></article>
        <article class="card"><h3>Private Git Knowledge</h3><div id="status-knowledge" class="status">확인 중</div><p>Obsidian vault의 <code>main</code>을 전역 지식의 단일 기준으로 사용합니다. 에이전트는 기존 문서를 먼저 찾고 Project·Knowledge·Area·Inbox 중 정해진 경로에 저장하며, 지식 종류를 Git 브랜치로 만들지 않습니다.</p></article>
      </div>
      <article class="card">
        <h2>환경 진단</h2>
        <ul id="diagnostics" class="diag-list"></ul>
        <p id="gpu-summary" class="hint"></p>
      </article>
      <article class="card">
        <h2>이 PC의 경로 기준</h2>
        <p class="hint">다른 사용자나 다른 PC의 경로를 가져오지 않습니다. 아래 로컬 설정과 각 탭에서 사용자가 확정한 경로만 사용합니다.</p>
        <code id="roots-config-path" class="path"></code>
      </article>
      <article class="card">
        <h2>의존성 안내</h2>
        <ul class="diag-list">
          <li><strong>Git for Windows</strong> — Private Git Knowledge에 필요합니다. 확장이 자동 설치하지 않습니다.</li>
          <li><strong>GitHub CLI</strong> — GitHub 저장소 생성·로그인에 선택적으로 사용합니다. 기존 private remote가 있으면 필수가 아닙니다.</li>
          <li><strong>Codex CLI</strong> — Codex 위임 경로를 켤 때만 필요합니다.</li>
          <li><strong>Anthropic Claude (Desktop & CLI)</strong> — Claude Desktop MCP 연동 및 <code>@anthropic-ai/claude-code</code> CLI에 필요합니다. <code>ANTHROPIC_API_KEY</code> 환경변수 설정 시 API 사용량이 자동 집계됩니다.</li>
          <li><strong>Ollama 또는 vLLM</strong> — 로컬 LLM 경로를 켤 때만 필요합니다. GPU driver와 모델은 묵시적으로 설치하지 않습니다.</li>
          <li><strong>Agy</strong> — Agy 사용량을 표시할 때만 필요합니다.</li>
        </ul>
        <p class="hint">상태 다시 확인은 현재 Windows 사용자·시스템 PATH를 새로 읽으므로 IDE를 재시작하지 않아도 방금 설치한 CLI를 다시 찾습니다. 다른 사용자의 홈 폴더를 검색하거나 비슷한 이름의 폴더를 삭제하지 않습니다.</p>
      </article>
      <article class="card notice">
        <h2>GEMINI.md 경계</h2>
        <p>Integrated Power는 전역 <code>GEMINI.md</code>를 생성·추가·교체하지 않습니다. Antigravity IDE 연동은 관리 플러그인, <code>ip-orchestrator</code> 스킬, 제품 전용 설정·상태 파일을 사용합니다.</p>
        <div id="gemini-status" class="hint"></div>
        <code id="gemini-path" class="path"></code>
      </article>
      <div class="actions"><button type="button" data-action="refresh">상태 다시 확인</button></div>
    </section>

    <section id="dashboard">
      <article class="card">
        <h2>Dashboard 설정</h2>
        <p class="hint">표시 영역과 Integrated Power 상태 저장 위치만 변경합니다. 프로젝트 파일은 이동하지 않습니다. 기존 <code>EggR\state</code> 데이터는 최초 전환 때 새 경로로 누락 파일만 복사하고 원본을 남깁니다.</p>
        <label class="check"><input id="show-antigravity" type="checkbox"><span>Antigravity IDE 사용량 표시</span></label>
        <label class="check"><input id="show-codex" type="checkbox"><span>OpenAI (ChatGPT · Codex) 사용량 표시</span></label>
        <label class="check"><input id="show-claude" type="checkbox"><span>Anthropic Claude (API · CLI) 사용량 표시</span></label>
        <label class="check"><input id="show-local-llm" type="checkbox"><span>로컬 LLM·GPU 상태 표시</span></label>
        <label class="check"><input id="notify-full-tokens" type="checkbox"><span>토큰 100% 완충 시 알림 발송</span></label>
        <label class="check"><input id="auto-start-boot" type="checkbox"><span>Windows 부팅 시 자동 시작</span></label>
        <div class="field">
          <label for="dashboard-state-root">Integrated Power 상태 경로</label>
          <div class="inline"><input id="dashboard-state-root" type="text"><button type="button" class="secondary" data-action="chooseStateRoot">찾기</button></div>
        </div>
        <div class="actions"><button type="button" data-action="saveDashboard">Dashboard 설정 저장</button></div>
      </article>
    </section>

    <section id="orchestrator">
      <article class="card">
        <h2>Integrated Orchestrator 설정 및 설치</h2>
        <p class="hint">설정 파일과 Antigravity IDE 플러그인은 분리되어 있습니다. 현재 사용자 홈의 표준 위치는 제안값일 뿐이며, 실제 설치 루트는 여기서 확인·변경한 뒤 저장합니다. 다른 사용자 폴더를 검색하지 않습니다. 플러그인 3.3.0부터 한 Antigravity 작업 안의 모델 호출 결과는 기본적으로 단일 <code>ip-orchestrator.md</code>를 재사용하며 기존 brain 파일은 삭제하지 않습니다.</p>
        <div id="plugin-status" class="status"></div>
        <code id="plugin-path" class="path"></code>
        <code id="orchestrator-settings-path" class="path"></code>
        <div class="field">
          <label for="plugin-root">Antigravity IDE 플러그인 루트</label>
          <div class="inline"><input id="plugin-root" type="text"><button type="button" class="secondary" data-action="choosePluginRoot">찾기</button></div>
          <div id="plugin-root-source" class="hint"></div>
        </div>
        <div class="subform">
          <h3>배포 마이그레이션 계획</h3>
          <div id="plugin-plan-status" class="status"></div>
          <ul id="plugin-plan-actions" class="diag-list"></ul>
          <p class="hint">Integrated Power가 소유한 정확한 <code>ip-orchestrator</code>, 이전 <code>eggr-orchestrator</code>, 더 이전 <code>codex-orchestrator</code> 경로만 확인합니다. 인식되지 않은 폴더는 자동 이동하지 않으며, 기존 항목은 삭제하지 않고 백업합니다.</p>
        </div>

        <label class="check"><input id="enable-codex" type="checkbox"><span>Codex 위임 경로 사용</span></label>
        <div id="codex-options" class="subform">
          <div class="field">
            <label for="codex-exe">Codex 실행 파일</label>
            <div class="inline"><input id="codex-exe" type="text"><button type="button" class="secondary" data-action="chooseCodexExe">찾기</button></div>
          </div>
        </div>

        <label class="check"><input id="enable-local-llm" type="checkbox"><span>로컬 LLM 위임 경로 사용</span></label>
        <div id="local-llm-options" class="subform">
          <div class="field"><label for="local-provider">공급자</label><select id="local-provider"><option value="ollama">Ollama</option><option value="vllm">vLLM / OpenAI 호환 API</option></select></div>
          <div class="field"><label for="local-endpoint">Endpoint</label><input id="local-endpoint" type="url"></div>
          <div class="field"><label for="selection-mode">모델 선택</label><select id="selection-mode"><option value="auto">현재 VRAM·GPU 기능에 맞춰 자동 선택</option><option value="user_default">사용자 지정 모델 우선</option></select></div>
          <div id="model-field" class="field"><label for="local-model">사용자 기본 모델 ID</label><input id="local-model" type="text"></div>
          <div class="field"><label for="reserve-vram">남겨 둘 VRAM(GB)</label><input id="reserve-vram" type="number" min="0" max="256" step="0.5"></div>
          <label class="check"><input id="allow-cpu-offload" type="checkbox"><span>VRAM 부족 시 CPU offload 허용</span></label>
          <div class="subform">
            <h3>Ollama 모델 인벤토리</h3>
            <p class="hint"><code>ollama list</code>에 해당하는 설치 모델 목록을 사용자 전용 레지스트리와 비교합니다. 설치된 미등록 모델은 추가하지만, 등록됐으나 설치되지 않은 모델은 사용자 확인 없이 내려받지 않습니다.</p>
            <div id="ollama-inventory-status" class="status">아직 동기화하지 않았습니다.</div>
            <code id="ollama-registry-path" class="path"></code>
            <div id="ollama-inventory-details" class="hint"></div>
            <ul id="ollama-inventory-models" class="diag-list"></ul>
            <div class="actions"><button type="button" class="secondary" data-action="syncOllamaInventory">설치 모델 다시 확인·레지스트리 동기화</button></div>
          </div>
        </div>

        <div class="field"><label for="default-route">기본 실행 경로</label><select id="default-route"><option value="main_agent">현재 에이전트 직접 처리</option><option value="codex">Codex 위임</option><option value="local_llm">로컬 LLM 위임</option></select></div>
        <div class="actions">
          <button type="button" class="secondary" data-action="saveOrchestrator">설정만 저장</button>
          <button type="button" data-action="saveAndInstallOrchestrator">설정 저장 및 플러그인 설치·갱신</button>
        </div>
      </article>
    </section>

    <section id="knowledge">
      <article class="card">
        <h2>Private Git Knowledge 설정</h2>
        <p class="hint">개발자의 저장소가 아니라 각 사용자가 소유한 로컬 또는 private 원격 Git 저장소를 구성합니다. 공통 작업 루트와 Knowledge 경로는 이 PC에서 사용자가 확정하며, 다른 PC의 절대 경로를 복사하거나 사용자 홈을 훑어 추측하지 않습니다. 확장에 내장된 Win11 도구가 기존 문서를 덮어쓰지 않고 Obsidian 분류표와 빠진 기본 폴더만 추가합니다. 최초 설정 마법사는 commit·pull·push하지 않습니다. 이후 <code>route-knowledge</code>가 기존 문서와 허용 경로를 확인하고, <code>save-knowledge</code>와 <code>save-agent-worklog</code>만 명시된 파일을 canonical <code>main</code>에 저장합니다. 작업 이름으로 Knowledge 브랜치를 만들지 않습니다.</p>
        <div id="knowledge-wizard-status" class="status"></div>
        <div id="knowledge-github-status" class="hint"></div>
        <div id="knowledge-routing-status" class="hint"></div>
        <div class="field"><label for="knowledge-mode">저장 방식</label><select id="knowledge-mode"><option value="local_only">로컬 Git만 사용</option><option value="private_remote">Private 원격 Git 연결</option></select></div>
        <div class="field">
          <label for="work-root">에이전트 공통 작업 루트</label>
          <div class="inline"><input id="work-root" type="text"><button type="button" class="secondary" data-action="chooseWorkRoot">찾기</button></div>
          <div id="work-root-source" class="hint"></div>
        </div>
        <div class="field">
          <label for="tools-root">Knowledge 도구 설치 루트</label>
          <div class="inline"><input id="tools-root" type="text"><button type="button" class="secondary" data-action="chooseToolsRoot">찾기</button></div>
          <div id="tools-root-source" class="hint"></div>
        </div>
        <div class="field">
          <label for="knowledge-path">Knowledge 경로</label>
          <div class="inline"><input id="knowledge-path" type="text"><button type="button" class="secondary" data-action="chooseKnowledgePath">찾기</button></div>
          <div id="knowledge-path-source" class="hint"></div>
        </div>
        <div id="remote-field" class="field"><label for="knowledge-remote">Private Git 원격 URL</label><input id="knowledge-remote" type="text" placeholder="https://github.com/owner/private-repo.git 또는 git@github.com:owner/private-repo.git"></div>
        <div class="grid">
          <div class="field"><label for="author-name">Git 작성자 이름</label><input id="author-name" type="text"></div>
          <div class="field"><label for="author-email">Git 작성자 이메일</label><input id="author-email" type="email"></div>
        </div>
        <label class="check"><input id="allow-non-empty" type="checkbox"><span>검토한 비어 있지 않은 폴더에 Git 초기화 허용</span></label>
        <label class="check"><input id="skip-remote-check" type="checkbox"><span>오프라인 설정: 원격 연결 확인을 생략</span></label>
        <div class="actions">
          <button type="button" class="secondary" data-action="installKnowledgeTools">내장 Knowledge 도구 설치·복구</button>
          <button type="button" data-action="configureKnowledge">Knowledge 설정·재설정 실행</button>
          <button type="button" class="secondary" data-action="detectKnowledgeRemote">현재 GitHub 로그인으로 remote 감지</button>
          <button type="button" class="secondary" data-action="reconfigureKnowledgeRemote">입력한 remote로 origin 재설정</button>
          <button type="button" class="secondary" data-action="openGitHubNewRepository">GitHub private 저장소 만들기</button>
          <button type="button" class="secondary" data-action="openKnowledgeGuide">설치·보안 안내 열기</button>
        </div>
      </article>
    </section>
  </main>
  <div id="result" class="result" role="status" aria-live="polite"></div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    let currentSection = "overview";
    let busy = false;

    const byId = (id) => document.getElementById(id);
    const bool = (id) => byId(id).checked;
    const value = (id) => byId(id).value;
    const setValue = (id, next) => { byId(id).value = next ?? ""; };
    const setChecked = (id, next) => { byId(id).checked = next === true; };

    function showSection(section) {
      currentSection = ["overview", "dashboard", "orchestrator", "knowledge"].includes(section) ? section : "overview";
      document.querySelectorAll("main section").forEach((item) => item.classList.toggle("active", item.id === currentSection));
      document.querySelectorAll("nav button").forEach((item) => item.classList.toggle("active", item.dataset.section === currentSection));
      vscode.setState({ section: currentSection });
    }

    function statusText(element, complete) {
      element.textContent = complete ? "✓ 설정 완료" : "– 설정 필요";
      element.className = "status " + (complete ? "ok" : "warn");
    }

    function render(snapshot) {
      statusText(byId("status-dashboard"), snapshot.status.dashboard);
      statusText(byId("status-orchestrator"), snapshot.status.orchestrator);
      statusText(byId("status-knowledge"), snapshot.status.knowledge);
      const diagnostics = byId("diagnostics");
      diagnostics.replaceChildren();
      snapshot.diagnostics.forEach((item) => {
        const li = document.createElement("li");
        li.className = item.available ? "ok" : (item.optional ? "hint" : "warn");
        li.textContent =
          (item.available ? "✓ " : (item.optional ? "○ 선택 사항 · " : "! 필요 · ")) +
          item.label +
          (item.path ? " · " + item.path : "");
        diagnostics.appendChild(li);
      });
      byId("gpu-summary").textContent = snapshot.gpuSummary;
      byId("roots-config-path").textContent = "canonical roots: " + snapshot.paths.roots;
      byId("gemini-status").textContent = snapshot.installation.globalGeminiExists
        ? "기존 파일이 있습니다. Integrated Power가 읽거나 수정하지 않습니다."
        : "파일이 없습니다. Integrated Power 설치 과정에서도 생성하지 않습니다.";
      byId("gemini-path").textContent = snapshot.paths.globalGemini;

      setChecked("show-antigravity", snapshot.dashboard.showAntigravity);
      setChecked("show-codex", snapshot.dashboard.showCodex);
      setChecked("show-claude", snapshot.dashboard.showClaude ?? true);
      setChecked("show-local-llm", snapshot.dashboard.showLocalLlm);
      setChecked("notify-full-tokens", snapshot.dashboard.notifyOnFullTokens ?? true);
      setChecked("auto-start-boot", snapshot.dashboard.autoStartOnBoot ?? false);
      setValue("dashboard-state-root", snapshot.dashboard.stateRoot);

      setChecked("enable-codex", snapshot.orchestrator.enableCodex);
      setChecked("enable-local-llm", snapshot.orchestrator.enableLocalLlm);
      setValue("codex-exe", snapshot.orchestrator.codexExe);
      setValue("local-provider", snapshot.orchestrator.provider === "none" ? "ollama" : snapshot.orchestrator.provider);
      setValue("local-endpoint", snapshot.orchestrator.endpoint);
      setValue("selection-mode", snapshot.orchestrator.selectionMode);
      setValue("local-model", snapshot.orchestrator.model);
      setValue("reserve-vram", String(snapshot.orchestrator.reserveVramGB));
      setChecked("allow-cpu-offload", snapshot.orchestrator.allowCpuOffload);
      setValue("default-route", snapshot.orchestrator.defaultRoute);
      setValue("plugin-root", snapshot.orchestrator.pluginRoot);
      byId("plugin-root-source").textContent = snapshot.paths.pluginRootConfigured
        ? "이 PC에 저장된 설치 루트입니다."
        : "현재 사용자 홈에서 계산한 제안값입니다. 저장 및 설치 전에 확인하세요.";
      byId("plugin-status").textContent = snapshot.installation.pluginInstalled
        ? "✓ ip-orchestrator 플러그인 설치됨"
        : snapshot.installation.legacyPluginInstalled
          ? "△ 이전 orchestrator 플러그인 발견 · 다음 설치에서 백업 후 ip-orchestrator로 전환"
          : "– 플러그인 설치 필요";
      byId("plugin-status").className = "status " + (snapshot.installation.pluginInstalled ? "ok" : "warn");
      byId("plugin-path").textContent = "플러그인: " + snapshot.paths.plugin;
      byId("orchestrator-settings-path").textContent =
        "설정: " + snapshot.paths.orchestrator +
        (snapshot.installation.settingsSource !== "integrated-power" && snapshot.installation.settingsSource !== "none"
          ? " (이전 설정을 읽음; 저장 시 Integrated Power 경로로 전환)"
          : "");
      const inventory = snapshot.ollamaInventory;
      byId("ollama-inventory-status").textContent = inventory
        ? (inventory.status === "ready" ? "✓ 모델 인벤토리 동기화됨" : "△ " + inventory.status)
        : "– 아직 동기화하지 않았습니다.";
      byId("ollama-inventory-status").className = "status " + (inventory?.status === "ready" ? "ok" : "warn");
      byId("ollama-registry-path").textContent = inventory?.registryPath
        ? "사용자 레지스트리: " + inventory.registryPath
        : "";
      byId("ollama-inventory-details").textContent = inventory
        ? "설치 " + inventory.installedModels.length + "개 · 등록·설치됨 " + inventory.registeredInstalled.length +
          "개 · 새 등록 " + inventory.newlyRegistered.length + "개 · 등록됐지만 미설치 " +
          inventory.registryModelsNotInstalled.length + "개" +
          (inventory.inventorySource ? " · 탐지: " + inventory.inventorySource : "")
        : "최초 설정 저장 또는 수동 동기화 때 확인합니다.";
      const inventoryModels = byId("ollama-inventory-models");
      inventoryModels.replaceChildren();
      const inventoryRows = inventory ? [
        ["설치됨", inventory.installedModels],
        ["이번에 등록", inventory.newlyRegistered],
        ["등록됐지만 미설치", inventory.registryModelsNotInstalled],
        ["설치 제안(확인 필요)", inventory.suggestedInstalls]
      ] : [];
      inventoryRows.forEach(([label, models]) => {
        if (!models.length) return;
        const li = document.createElement("li");
        li.textContent = label + ": " + models.join(", ");
        inventoryModels.appendChild(li);
      });
      if (inventory?.agentPrompt) {
        const li = document.createElement("li");
        li.textContent = inventory.agentPrompt;
        inventoryModels.appendChild(li);
      }
      const plan = snapshot.installation.pluginPlan;
      byId("plugin-plan-status").textContent = plan.blocked
        ? "설치 중단: " + plan.blockingReason
        : "설치 가능 · ip 상태: " + plan.destinationState + " · eggr 이전 상태: " + plan.previousState + " · codex 이전 상태: " + plan.legacyState;
      byId("plugin-plan-status").className = "status " + (plan.blocked ? "bad" : "ok");
      const planActions = byId("plugin-plan-actions");
      planActions.replaceChildren();
      (plan.actions.length ? plan.actions : ["변경할 항목이 없습니다."]).forEach((description) => {
        const li = document.createElement("li");
        li.textContent = description;
        planActions.appendChild(li);
      });

      setValue("knowledge-mode", snapshot.knowledge.mode);
      setValue("work-root", snapshot.knowledge.workRoot);
      setValue("tools-root", snapshot.knowledge.toolsRoot);
      setValue("knowledge-path", snapshot.knowledge.knowledgePath);
      byId("work-root-source").textContent = snapshot.knowledge.workRootConfigured
        ? "이 PC의 canonical roots.json에 저장됨"
        : "제안값입니다. 다른 PC에서는 자동 승계하지 않으며 사용자가 확정해야 합니다.";
      byId("tools-root-source").textContent = snapshot.knowledge.toolsRootConfigured
        ? "이 PC의 canonical roots.json에 저장됨"
        : "현재 OS의 사용자 데이터 위치에서 계산한 제안값입니다.";
      byId("knowledge-path-source").textContent = snapshot.knowledge.knowledgePathConfigured
        ? "이 PC의 canonical roots.json에 저장됨"
        : "공통 작업 루트 아래의 제안값입니다. 필요하면 다른 위치를 선택할 수 있습니다.";
      setValue("knowledge-remote", snapshot.knowledge.remoteUrl);
      setValue("author-name", snapshot.knowledge.authorName);
      setValue("author-email", snapshot.knowledge.authorEmail);
      setChecked("allow-non-empty", false);
      setChecked("skip-remote-check", false);
      byId("knowledge-github-status").textContent =
        "GitHub CLI 로그인: " + (snapshot.knowledge.githubLogin || "확인되지 않음") +
        " · 실제 origin: " + (snapshot.knowledge.repositoryRemote || "없음");
      byId("knowledge-routing-status").textContent =
        "현재 브랜치: " + (snapshot.knowledge.currentBranch || "확인되지 않음") +
        " · Obsidian 분류표: " + (snapshot.knowledge.routingPolicyExists ? "준비됨" : "없음") +
        " · 남아 있는 agent 브랜치: " + snapshot.knowledge.taskBranchCount +
        (snapshot.knowledge.currentBranch && snapshot.knowledge.currentBranch !== "main"
          ? " · ⚠ Knowledge는 main으로 통합해야 합니다."
          : "");
      byId("knowledge-wizard-status").textContent = snapshot.installation.knowledgeWizardInstalled
        ? "✓ 확장 내장 Windows Knowledge 도구 준비됨 · " + snapshot.installation.knowledgeToolsRoot
        : "– 내장 Knowledge 도구 설치·복구를 실행하세요.";
      byId("knowledge-wizard-status").className = "status " + (snapshot.installation.knowledgeWizardInstalled ? "ok" : "warn");
      syncConditionalFields();
    }

    function syncConditionalFields() {
      byId("codex-options").classList.toggle("hidden", !bool("enable-codex"));
      byId("local-llm-options").classList.toggle("hidden", !bool("enable-local-llm"));
      byId("model-field").classList.toggle("hidden", value("selection-mode") !== "user_default");
      byId("remote-field").classList.toggle("hidden", value("knowledge-mode") !== "private_remote");
      for (const option of byId("default-route").options) {
        option.disabled =
          (option.value === "codex" && !bool("enable-codex")) ||
          (option.value === "local_llm" && !bool("enable-local-llm"));
      }
      const selected = value("default-route");
      if ((selected === "codex" && !bool("enable-codex")) || (selected === "local_llm" && !bool("enable-local-llm"))) {
        setValue("default-route", "main_agent");
      }
    }

    function dashboardConfiguration() {
      return {
        showAntigravity: bool("show-antigravity"),
        showCodex: bool("show-codex"),
        showClaude: bool("show-claude"),
        showLocalLlm: bool("show-local-llm"),
        notifyOnFullTokens: bool("notify-full-tokens"),
        autoStartOnBoot: bool("auto-start-boot"),
        stateRoot: value("dashboard-state-root")
      };
    }

    function orchestratorConfiguration() {
      return {
        enableCodex: bool("enable-codex"),
        enableLocalLlm: bool("enable-local-llm"),
        defaultRoute: value("default-route"),
        codexExe: value("codex-exe"),
        provider: value("local-provider"),
        endpoint: value("local-endpoint"),
        selectionMode: value("selection-mode"),
        model: value("local-model"),
        reserveVramGB: Number(value("reserve-vram")),
        allowCpuOffload: bool("allow-cpu-offload"),
        pluginRoot: value("plugin-root")
      };
    }

    function knowledgeConfiguration() {
      return {
        mode: value("knowledge-mode"),
        workRoot: value("work-root"),
        toolsRoot: value("tools-root"),
        knowledgePath: value("knowledge-path"),
        remoteUrl: value("knowledge-remote"),
        authorName: value("author-name"),
        authorEmail: value("author-email"),
        allowNonEmptyDirectory: bool("allow-non-empty"),
        skipRemoteCheck: bool("skip-remote-check")
      };
    }

    document.querySelectorAll("nav button").forEach((button) => button.addEventListener("click", () => showSection(button.dataset.section)));
    ["enable-codex", "enable-local-llm", "selection-mode", "knowledge-mode"].forEach((id) => byId(id).addEventListener("change", syncConditionalFields));
    document.querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", () => {
      if (busy) return;
      const action = button.dataset.action;
      if (action === "saveDashboard") vscode.postMessage({ type: action, value: dashboardConfiguration() });
      else if (action === "saveOrchestrator" || action === "saveAndInstallOrchestrator" || action === "syncOllamaInventory") vscode.postMessage({ type: action, value: orchestratorConfiguration() });
      else if (action === "configureKnowledge") vscode.postMessage({ type: action, value: knowledgeConfiguration() });
      else if (action === "installKnowledgeTools") vscode.postMessage({ type: action, value: value("tools-root") });
      else if (action === "detectKnowledgeRemote" || action === "reconfigureKnowledgeRemote") {
        vscode.postMessage({
          type: action,
          value: {
            knowledgePath: value("knowledge-path"),
            remoteUrl: value("knowledge-remote")
          }
        });
      }
      else vscode.postMessage({ type: action, section: currentSection });
    }));

    window.addEventListener("message", (event) => {
      const message = event.data;
      if (message.type === "snapshot") {
        render(message.value);
        if (message.section) showSection(message.section);
      } else if (message.type === "busy") {
        busy = message.value === true;
        document.querySelectorAll("button[data-action]").forEach((button) => { button.disabled = busy; });
      } else if (message.type === "result") {
        const result = byId("result");
        result.textContent = message.message;
        result.className = "result visible " + (message.kind === "error" ? "bad" : "ok");
      } else if (message.type === "fieldValue") {
        const map = { dashboardStateRoot: "dashboard-state-root", pluginRoot: "plugin-root", workRoot: "work-root", toolsRoot: "tools-root", knowledgePath: "knowledge-path", codexExe: "codex-exe" };
        if (map[message.field]) setValue(map[message.field], message.value);
      } else if (message.type === "knowledgeRemoteDetected") {
        setValue("knowledge-remote", message.value.remoteUrl);
        byId("knowledge-github-status").textContent =
          "GitHub CLI 로그인: " + message.value.githubLogin +
          " · 현재 origin: " + (message.value.currentRemote || "없음") +
          " · 제안: " + message.value.remoteUrl;
      }
    });

    showSection((vscode.getState() || {}).section || "overview");
    vscode.postMessage({ type: "ready", section: currentSection });
  </script>
</body>
</html>`;
  }
}

function parseKnowledgeRemoteReconfiguration(value: unknown): {
  knowledgePath: string;
  remoteUrl: string;
} {
  if (!isRecord(value)) {
    throw new Error("Knowledge remote 설정 형식이 올바르지 않습니다.");
  }
  return {
    knowledgePath: requireString(value.knowledgePath, "Knowledge 경로"),
    remoteUrl: optionalString(value.remoteUrl),
  };
}

function parseDashboardConfiguration(value: unknown): DashboardConfiguration {
  if (!isRecord(value)) throw new Error("Dashboard 설정 형식이 올바르지 않습니다.");
  return {
    showAntigravity: value.showAntigravity === true,
    showCodex: value.showCodex === true,
    showClaude: value.showClaude !== false,
    showLocalLlm: value.showLocalLlm === true,
    notifyOnFullTokens: value.notifyOnFullTokens === true,
    autoStartOnBoot: value.autoStartOnBoot === true,
    stateRoot: requireString(value.stateRoot, "Integrated Power 상태 경로"),
  };
}

function parseOrchestratorConfiguration(
  value: unknown,
): OrchestratorConfiguration {
  if (!isRecord(value)) throw new Error("Integrated Orchestrator 설정 형식이 올바르지 않습니다.");
  const defaultRoute = value.defaultRoute;
  const provider = value.provider;
  const selectionMode = value.selectionMode;
  if (
    defaultRoute !== "main_agent" &&
    defaultRoute !== "codex" &&
    defaultRoute !== "local_llm"
  ) {
    throw new Error("기본 실행 경로가 올바르지 않습니다.");
  }
  if (provider !== "none" && provider !== "ollama" && provider !== "vllm") {
    throw new Error("로컬 LLM 공급자가 올바르지 않습니다.");
  }
  if (selectionMode !== "auto" && selectionMode !== "user_default") {
    throw new Error("모델 선택 방식이 올바르지 않습니다.");
  }
  return {
    enableCodex: value.enableCodex === true,
    enableLocalLlm: value.enableLocalLlm === true,
    defaultRoute,
    codexExe: optionalString(value.codexExe),
    provider,
    endpoint: optionalString(value.endpoint),
    selectionMode,
    model: optionalString(value.model),
    reserveVramGB:
      typeof value.reserveVramGB === "number" ? value.reserveVramGB : Number.NaN,
    allowCpuOffload: value.allowCpuOffload === true,
    pluginRoot: requireString(value.pluginRoot, "Antigravity 플러그인 루트"),
  };
}

function parseKnowledgeConfiguration(value: unknown): KnowledgeConfiguration {
  if (!isRecord(value)) throw new Error("Knowledge 설정 형식이 올바르지 않습니다.");
  if (value.mode !== "local_only" && value.mode !== "private_remote") {
    throw new Error("Knowledge 저장 방식이 올바르지 않습니다.");
  }
  return {
    mode: value.mode,
    workRoot: requireString(value.workRoot, "공통 작업 루트"),
    toolsRoot: requireString(value.toolsRoot, "Knowledge 도구 설치 루트"),
    knowledgePath: requireString(value.knowledgePath, "Knowledge 경로"),
    remoteUrl: optionalString(value.remoteUrl),
    authorName: requireString(value.authorName, "Git 작성자 이름"),
    authorEmail: requireString(value.authorEmail, "Git 작성자 이메일"),
    allowNonEmptyDirectory: value.allowNonEmptyDirectory === true,
    skipRemoteCheck: value.skipRemoteCheck === true,
  };
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} 값이 필요합니다.`);
  }
  return value;
}

function optionalString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function isSection(value: unknown): value is ConfigurationSection {
  return (
    value === "overview" ||
    value === "dashboard" ||
    value === "orchestrator" ||
    value === "knowledge"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function createNonce(): string {
  const characters =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let nonce = "";
  for (let index = 0; index < 32; index++) {
    nonce += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return nonce;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
