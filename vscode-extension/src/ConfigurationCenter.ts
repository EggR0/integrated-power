import * as vscode from "vscode";
import * as path from "path";
import {
  DashboardConfiguration,
  KnowledgeConfiguration,
  OrchestratorConfiguration,
  loadConfigurationCenterSnapshot,
  runPrivateKnowledgeConfiguration,
  saveDashboardConfiguration,
  saveOrchestratorConfiguration,
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
      "integratedPower.eggr.configurationCenter",
      "EggR Configuration Center",
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
          const savedPath = saveOrchestratorConfiguration(
            this.context,
            parseOrchestratorConfiguration(message.value),
          );
          this.postResult(
            "success",
            `Integrated Orchestrator 설정 저장 완료: ${savedPath}`,
          );
          this.postSnapshot("orchestrator");
          return;
        }
        case "saveAndInstallOrchestrator": {
          this.postBusy(true);
          saveOrchestratorConfiguration(
            this.context,
            parseOrchestratorConfiguration(message.value),
          );
          const result = await this.installOrchestrator();
          this.postResult("success", result);
          this.postSnapshot("orchestrator");
          return;
        }
        case "configureKnowledge": {
          this.postBusy(true);
          const result = await runPrivateKnowledgeConfiguration(
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
        case "chooseStateRoot":
          await this.chooseDirectory(
            "EggR 상태 폴더 선택",
            "dashboardStateRoot",
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
  <title>EggR Configuration Center</title>
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
    <h1>EggR Configuration Center</h1>
    <div class="subtitle">Dashboard, Integrated Orchestrator, Private Git Knowledge를 한 화면에서 독립적으로 설정합니다.</div>
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
        <article class="card"><h3>Dashboard</h3><div id="status-dashboard" class="status">확인 중</div><p>Antigravity IDE, Codex, 로컬 LLM 사용량과 상태를 표시합니다.</p></article>
        <article class="card"><h3>Integrated Orchestrator</h3><div id="status-orchestrator" class="status">확인 중</div><p>현재 에이전트, Codex, 하드웨어에 맞는 로컬 LLM 사이의 실행 경로를 선택합니다.</p></article>
        <article class="card"><h3>Private Git Knowledge</h3><div id="status-knowledge" class="status">확인 중</div><p>각 사용자의 지식과 작업 기록을 사용자가 소유한 Git 저장소에 누적합니다.</p></article>
      </div>
      <article class="card">
        <h2>환경 진단</h2>
        <ul id="diagnostics" class="diag-list"></ul>
        <p id="gpu-summary" class="hint"></p>
      </article>
      <article class="card">
        <h2>의존성 안내</h2>
        <ul class="diag-list">
          <li><strong>Git for Windows</strong> — Private Git Knowledge에 필요합니다. 확장이 자동 설치하지 않습니다.</li>
          <li><strong>GitHub CLI</strong> — GitHub 저장소 생성·로그인에 선택적으로 사용합니다. 기존 private remote가 있으면 필수가 아닙니다.</li>
          <li><strong>Codex CLI</strong> — Codex 위임 경로를 켤 때만 필요합니다.</li>
          <li><strong>Ollama 또는 vLLM</strong> — 로컬 LLM 경로를 켤 때만 필요합니다. GPU driver와 모델은 묵시적으로 설치하지 않습니다.</li>
          <li><strong>Agy</strong> — Agy 사용량을 표시할 때만 필요합니다.</li>
        </ul>
        <p class="hint">경로와 설치 여부는 현재 사용자 환경에서만 진단합니다. 다른 사용자의 홈 폴더를 검색하거나 비슷한 이름의 폴더를 삭제하지 않습니다.</p>
      </article>
      <article class="card notice">
        <h2>GEMINI.md 경계</h2>
        <p>EggR는 전역 <code>GEMINI.md</code>를 생성·추가·교체하지 않습니다. Antigravity IDE 연동은 플러그인, <code>eggr-orchestrator</code> 스킬, EggR 설정·상태 파일을 사용합니다.</p>
        <div id="gemini-status" class="hint"></div>
        <code id="gemini-path" class="path"></code>
      </article>
      <div class="actions"><button type="button" data-action="refresh">상태 다시 확인</button></div>
    </section>

    <section id="dashboard">
      <article class="card">
        <h2>Dashboard 설정</h2>
        <p class="hint">표시 영역과 EggR 상태 저장 위치만 변경합니다. 프로젝트 파일은 이동하지 않습니다.</p>
        <label class="check"><input id="show-antigravity" type="checkbox"><span>Antigravity IDE 사용량 표시</span></label>
        <label class="check"><input id="show-codex" type="checkbox"><span>Codex 사용량 표시</span></label>
        <label class="check"><input id="show-local-llm" type="checkbox"><span>로컬 LLM·GPU 상태 표시</span></label>
        <div class="field">
          <label for="dashboard-state-root">EggR 상태 경로</label>
          <div class="inline"><input id="dashboard-state-root" type="text"><button type="button" class="secondary" data-action="chooseStateRoot">찾기</button></div>
        </div>
        <div class="actions"><button type="button" data-action="saveDashboard">Dashboard 설정 저장</button></div>
      </article>
    </section>

    <section id="orchestrator">
      <article class="card">
        <h2>Integrated Orchestrator 설정 및 설치</h2>
        <p class="hint">설정 파일과 Antigravity IDE 플러그인은 분리되어 있습니다. 설치는 명시적으로 ‘저장 및 설치’를 누를 때만 수행합니다.</p>
        <div id="plugin-status" class="status"></div>
        <code id="plugin-path" class="path"></code>
        <code id="orchestrator-settings-path" class="path"></code>
        <div class="subform">
          <h3>배포 마이그레이션 계획</h3>
          <div id="plugin-plan-status" class="status"></div>
          <ul id="plugin-plan-actions" class="diag-list"></ul>
          <p class="hint">EggR가 소유한 정확한 신규·이전 경로만 확인합니다. 인식되지 않은 폴더는 자동 이동하지 않으며, 기존 항목은 삭제하지 않고 백업합니다.</p>
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
        <p class="hint">개발자의 저장소가 아니라 각 사용자가 소유한 로컬 또는 private 원격 Git 저장소를 구성합니다. commit·pull·push는 자동 실행하지 않습니다.</p>
        <div id="knowledge-wizard-status" class="status"></div>
        <div class="field"><label for="knowledge-mode">저장 방식</label><select id="knowledge-mode"><option value="local_only">로컬 Git만 사용</option><option value="private_remote">Private 원격 Git 연결</option></select></div>
        <div class="field">
          <label for="knowledge-path">Knowledge 경로</label>
          <div class="inline"><input id="knowledge-path" type="text"><button type="button" class="secondary" data-action="chooseKnowledgePath">찾기</button></div>
        </div>
        <div id="remote-field" class="field"><label for="knowledge-remote">Private Git 원격 URL</label><input id="knowledge-remote" type="text" placeholder="https://github.com/owner/private-repo.git 또는 git@github.com:owner/private-repo.git"></div>
        <div class="grid">
          <div class="field"><label for="author-name">Git 작성자 이름</label><input id="author-name" type="text"></div>
          <div class="field"><label for="author-email">Git 작성자 이메일</label><input id="author-email" type="email"></div>
        </div>
        <label class="check"><input id="allow-non-empty" type="checkbox"><span>검토한 비어 있지 않은 폴더에 Git 초기화 허용</span></label>
        <label class="check"><input id="skip-remote-check" type="checkbox"><span>오프라인 설정: 원격 연결 확인을 생략</span></label>
        <div class="actions">
          <button type="button" data-action="configureKnowledge">Knowledge 설정 실행</button>
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
        li.className = item.available ? "ok" : "warn";
        li.textContent = (item.available ? "✓ " : "– ") + item.label + (item.path ? " · " + item.path : "");
        diagnostics.appendChild(li);
      });
      byId("gpu-summary").textContent = snapshot.gpuSummary;
      byId("gemini-status").textContent = snapshot.installation.globalGeminiExists
        ? "기존 파일이 있습니다. EggR가 읽거나 수정하지 않습니다."
        : "파일이 없습니다. EggR 설치 과정에서도 생성하지 않습니다.";
      byId("gemini-path").textContent = snapshot.paths.globalGemini;

      setChecked("show-antigravity", snapshot.dashboard.showAntigravity);
      setChecked("show-codex", snapshot.dashboard.showCodex);
      setChecked("show-local-llm", snapshot.dashboard.showLocalLlm);
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
      byId("plugin-status").textContent = snapshot.installation.pluginInstalled
        ? "✓ eggr-orchestrator 플러그인 설치됨"
        : snapshot.installation.legacyPluginInstalled
          ? "△ 이전 codex-orchestrator 플러그인 발견 · 다음 설치에서 백업 후 전환"
          : "– 플러그인 설치 필요";
      byId("plugin-status").className = "status " + (snapshot.installation.pluginInstalled ? "ok" : "warn");
      byId("plugin-path").textContent = "플러그인: " + snapshot.paths.plugin;
      byId("orchestrator-settings-path").textContent =
        "설정: " + snapshot.paths.orchestrator +
        (snapshot.installation.settingsSource === "legacy" ? " (이전 설정을 읽음; 저장 시 EggR 경로로 전환)" : "");
      const plan = snapshot.installation.pluginPlan;
      byId("plugin-plan-status").textContent = plan.blocked
        ? "설치 중단: " + plan.blockingReason
        : "설치 가능 · 신규 상태: " + plan.destinationState + " · 이전 상태: " + plan.legacyState;
      byId("plugin-plan-status").className = "status " + (plan.blocked ? "bad" : "ok");
      const planActions = byId("plugin-plan-actions");
      planActions.replaceChildren();
      (plan.actions.length ? plan.actions : ["변경할 항목이 없습니다."]).forEach((description) => {
        const li = document.createElement("li");
        li.textContent = description;
        planActions.appendChild(li);
      });

      setValue("knowledge-mode", snapshot.knowledge.mode);
      setValue("knowledge-path", snapshot.knowledge.knowledgePath);
      setValue("knowledge-remote", snapshot.knowledge.remoteUrl);
      setValue("author-name", snapshot.knowledge.authorName);
      setValue("author-email", snapshot.knowledge.authorEmail);
      setChecked("allow-non-empty", false);
      setChecked("skip-remote-check", false);
      byId("knowledge-wizard-status").textContent = snapshot.installation.knowledgeWizardInstalled
        ? "✓ Windows Knowledge 설정 도구 준비됨"
        : "– environment-bootstrap의 Windows Knowledge 설정 도구 설치 필요";
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
        showLocalLlm: bool("show-local-llm"),
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
        allowCpuOffload: bool("allow-cpu-offload")
      };
    }

    function knowledgeConfiguration() {
      return {
        mode: value("knowledge-mode"),
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
      else if (action === "saveOrchestrator" || action === "saveAndInstallOrchestrator") vscode.postMessage({ type: action, value: orchestratorConfiguration() });
      else if (action === "configureKnowledge") vscode.postMessage({ type: action, value: knowledgeConfiguration() });
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
        const map = { dashboardStateRoot: "dashboard-state-root", knowledgePath: "knowledge-path", codexExe: "codex-exe" };
        if (map[message.field]) setValue(map[message.field], message.value);
      }
    });

    showSection((vscode.getState() || {}).section || "overview");
    vscode.postMessage({ type: "ready", section: currentSection });
  </script>
</body>
</html>`;
  }
}

function parseDashboardConfiguration(value: unknown): DashboardConfiguration {
  if (!isRecord(value)) throw new Error("Dashboard 설정 형식이 올바르지 않습니다.");
  return {
    showAntigravity: value.showAntigravity === true,
    showCodex: value.showCodex === true,
    showLocalLlm: value.showLocalLlm === true,
    stateRoot: requireString(value.stateRoot, "EggR 상태 경로"),
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
  };
}

function parseKnowledgeConfiguration(value: unknown): KnowledgeConfiguration {
  if (!isRecord(value)) throw new Error("Knowledge 설정 형식이 올바르지 않습니다.");
  if (value.mode !== "local_only" && value.mode !== "private_remote") {
    throw new Error("Knowledge 저장 방식이 올바르지 않습니다.");
  }
  return {
    mode: value.mode,
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
