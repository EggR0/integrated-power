import "./style.css";

const API = "http://127.0.0.1:37241";
const streams = new Map();

const state = {
  capabilities: [],
  tasks: [],
  approvals: [],
  tokenStatus: null,
  previousTokenStatus: null,
  lastFullNotified: false,
  notifyOnFullTokens: localStorage.getItem("ip_notify_full_tokens") !== "false",
  autoStartEnabled: false,
  logs: { path: "", lines: [] },
  mainProvider: "google.antigravity.ide",
  brokerOnline: false,
  activeTab: "tokens", // DEFAULT ACTIVE TAB
};

const defaults = [
  { provider: "google.antigravity.ide", label: "Antigravity IDE / Agy", mode: "cli", capabilities: ["leader", "executor"], available: false, stateKind: "not_installed", stateLabel: "설치X", reason: "확인중" },
  { provider: "local.openai-compatible", label: "로컬 Qwen 3.6 27B", mode: "local", capabilities: ["executor", "local-mcp"], available: false, stateKind: "not_installed", stateLabel: "설치X", model: "qwen3.6:27b", reason: "확인중" },
  { provider: "openai.codex.app", label: "Codex App Server", mode: "app-server", capabilities: ["leader", "executor"], available: false, stateKind: "not_installed", stateLabel: "설치X", reason: "확인중" },
  { provider: "openai.chatgpt.app", label: "ChatGPT desktop/web MCP app", mode: "gui", capabilities: ["leader", "remote-mcp"], available: false, stateKind: "not_installed", stateLabel: "설치X", reason: "확인중" },
  { provider: "anthropic.claude.desktop", label: "Claude Desktop local MCP", mode: "gui", capabilities: ["leader", "local-mcp"], available: false, stateKind: "not_installed", stateLabel: "설치X", reason: "확인중" },
  { provider: "google.antigravity.app", label: "Antigravity", mode: "gui", capabilities: ["leader", "executor"], available: false, stateKind: "not_installed", stateLabel: "설치X", reason: "확인중" },
  { provider: "anthropic.cowork", label: "Claude Cowork", mode: "gui", capabilities: ["leader"], available: false, stateKind: "not_installed", stateLabel: "설치X", reason: "미지원" },
  { provider: "xai.grok", label: "xAI Grok", mode: "gui", capabilities: ["leader"], available: false, stateKind: "not_installed", stateLabel: "설치X", reason: "미지원" },
];

const $ = (id) => document.getElementById(id);
const node = (tag, text, className) => {
  const value = document.createElement(tag);
  if (text !== undefined) value.textContent = String(text);
  if (className) value.className = className;
  return value;
};
const button = (text, className, data = {}) => {
  const value = node("button", text, className);
  Object.assign(value.dataset, data);
  return value;
};
const safeText = (value, fallback = "-") => (value === undefined || value === null || value === "" ? fallback : String(value));

async function api(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeout ?? 10000);
  try {
    const response = await fetch(`${API}${path}`, {
      ...options,
      signal: controller.signal,
      headers: { "content-type": "application/json", ...(options.headers || {}) },
    });
    const text = await response.text();
    let body = {};
    try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
    if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
    return body;
  } finally { clearTimeout(timer); }
}

function setConnection(kind, message) {
  state.brokerOnline = kind === "online";
  const dot = $("connection-dot");
  if (dot) dot.className = `connection-dot ${kind === "online" ? "online" : "offline"}`;
  const label = $("connection-label");
  if (label) label.textContent = message;
  const statBroker = $("stat-broker");
  if (statBroker) statBroker.textContent = kind === "online" ? "정상 가동 (37241)" : "연결 끊김";
}

function currentCapabilities() {
  const values = state.capabilities.length ? state.capabilities : defaults;
  return defaults.map((fallback) => values.find((item) => item.provider === fallback.provider) || fallback)
    .concat(values.filter((item) => !defaults.some((fallback) => fallback.provider === item.provider)));
}

let toastTimer;
function showToast(message, isError = false) {
  const toast = $("toast");
  if (!toast) return;
  toast.textContent = message;
  toast.style.borderColor = isError ? "#f43f5e" : "#38bdf8";
  toast.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add("hidden"), 3800);
}

async function copyToClipboard(text, successMsg) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(successMsg);
  } catch (error) {
    showToast("클립보드 복사 실패: " + error.message, true);
  }
}

function requestNotificationPermission() {
  if ("Notification" in window && Notification.permission === "default") {
    void Notification.requestPermission();
  }
}

function sendDesktopNotification(title, body) {
  if (!state.notifyOnFullTokens) return;
  if ("Notification" in window && Notification.permission === "granted") {
    try {
      new Notification(title, {
        body,
        icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>⚡</text></svg>",
      });
    } catch {
      // Fallback
    }
  }
}

function checkTokenFullNotification(previous, current) {
  if (!current || !state.notifyOnFullTokens) return;

  const agy = current.antigravityPercentage ?? 100;
  const opus = current.opusPercentage ?? 100;
  const codex = current.codexPercentage ?? 100;

  const isAllFull = agy >= 100 && opus >= 100 && codex >= 100;
  const wasAnyDepleted = previous
    ? (previous.antigravityPercentage !== undefined && previous.antigravityPercentage < 100) ||
      (previous.opusPercentage !== undefined && previous.opusPercentage < 100) ||
      (previous.codexPercentage !== undefined && previous.codexPercentage < 100)
    : false;

  if (isAllFull) {
    if (wasAnyDepleted && !state.lastFullNotified) {
      state.lastFullNotified = true;
      const msg = "모든 AI 모델 쿼터(Gemini, Claude, Codex)가 100%로 완충되었습니다! 작업을 최대 속도로 진행할 수 있습니다.";
      showToast(`🎉 [100% 완충] ${msg}`);
      sendDesktopNotification("🎉 [Integrated Power] AI 토큰 100% 충전 완료", msg);
    }
  } else {
    state.lastFullNotified = false;
  }
}

function switchTab(targetTab) {
  state.activeTab = targetTab;
  document.querySelectorAll(".nav-link").forEach((link) => {
    link.classList.toggle("active", link.dataset.section === targetTab);
  });
  document.querySelectorAll(".view-section").forEach((sec) => {
    sec.classList.toggle("active", sec.id === `view-${targetTab}`);
  });

  const titles = {
    tokens: { eyebrow: "AI 쿼터 및 토큰 실시간 관제", title: "AI 모델 쿼터 현황 및 리셋 주기" },
    home: { eyebrow: "통합 관제 센터", title: "PC 상태와 AI 작업을 한곳에서" },
    agents: { eyebrow: "에이전트 관리", title: "연결된 AI 에이전트 현황 및 진단" },
    tasks: { eyebrow: "작업 및 승인", title: "멀티 에이전트 작업 위임 및 승인 관리" },
    logs: { eyebrow: "실시간 진단", title: "Integrated Power 브로커 로그" },
    settings: { eyebrow: "환경 설정", title: "네트워크, 시작 프로그램 및 알림 설정" },
  };

  const current = titles[targetTab] || titles.tokens;
  if ($("page-eyebrow")) $("page-eyebrow").textContent = current.eyebrow;
  if ($("page-title")) $("page-title").textContent = current.title;

  if (targetTab === "logs") void refreshLogs();
}

function formatCountdown(resetTimeStr) {
  if (!resetTimeStr) return "5시간 윈도우";
  const target = Date.parse(resetTimeStr);
  if (Number.isNaN(target)) return resetTimeStr;
  const diffMs = target - Date.now();
  if (diffMs <= 0) return "리셋 완료 (100%)";
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const mins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  return hours > 0 ? `리셋까지 ${hours}시간 ${mins}분` : `리셋까지 ${mins}분`;
}

function renderTokens() {
  const ts = state.tokenStatus || {};
  const agy5h = ts.antigravityPercentage ?? 100;
  const agyWeekly = ts.antigravityWeeklyPercentage ?? 100;
  const opus5h = ts.opusPercentage ?? 100;
  const opusWeekly = ts.opusWeeklyPercentage ?? 100;
  const codex5h = ts.codexPercentage ?? 100;
  const codexWeekly = ts.codexWeeklyPercentage ?? 100;

  // 1. Gemini Gauges & Bars
  if ($("percent-gemini-5h")) $("percent-gemini-5h").textContent = `${Math.round(agy5h)}%`;
  if ($("gauge-gemini-5h")) $("gauge-gemini-5h").setAttribute("stroke-dasharray", `${Math.round(agy5h)}, 100`);
  if ($("label-gemini-5h")) $("label-gemini-5h").textContent = `${Math.round(agy5h)}%`;
  if ($("bar-gemini-5h")) $("bar-gemini-5h").style.width = `${Math.max(0, Math.min(100, agy5h))}%`;
  if ($("label-gemini-weekly")) $("label-gemini-weekly").textContent = `${Math.round(agyWeekly)}%`;
  if ($("bar-gemini-weekly")) $("bar-gemini-weekly").style.width = `${Math.max(0, Math.min(100, agyWeekly))}%`;
  if ($("reset-gemini")) $("reset-gemini").textContent = formatCountdown(ts.antigravityResetTime);
  if ($("count-gemini")) $("count-gemini").textContent = ts.antigravityTokensLeft ? `${(ts.antigravityTokensLeft / 1000).toFixed(0)}k 토큰 남음` : "용량 가용";

  // 2. Opus Gauges & Bars
  if ($("percent-opus-5h")) $("percent-opus-5h").textContent = `${Math.round(opus5h)}%`;
  if ($("gauge-opus-5h")) $("gauge-opus-5h").setAttribute("stroke-dasharray", `${Math.round(opus5h)}, 100`);
  if ($("label-opus-5h")) $("label-opus-5h").textContent = `${Math.round(opus5h)}%`;
  if ($("bar-opus-5h")) $("bar-opus-5h").style.width = `${Math.max(0, Math.min(100, opus5h))}%`;
  if ($("label-opus-weekly")) $("label-opus-weekly").textContent = `${Math.round(opusWeekly)}%`;
  if ($("bar-opus-weekly")) $("bar-opus-weekly").style.width = `${Math.max(0, Math.min(100, opusWeekly))}%`;
  if ($("reset-opus")) $("reset-opus").textContent = formatCountdown(ts.opusResetTime);
  if ($("count-opus")) $("count-opus").textContent = ts.opusTokensLeft ? `${(ts.opusTokensLeft / 1000).toFixed(0)}k 토큰 남음` : "용량 가용";

  // 3. Codex Gauges & Bars
  if ($("percent-codex-5h")) $("percent-codex-5h").textContent = `${Math.round(codex5h)}%`;
  if ($("gauge-codex-5h")) $("gauge-codex-5h").setAttribute("stroke-dasharray", `${Math.round(codex5h)}, 100`);
  if ($("label-codex-5h")) $("label-codex-5h").textContent = `${Math.round(codex5h)}%`;
  if ($("bar-codex-5h")) $("bar-codex-5h").style.width = `${Math.max(0, Math.min(100, codex5h))}%`;
  if ($("label-codex-weekly")) $("label-codex-weekly").textContent = `${Math.round(codexWeekly)}%`;
  if ($("bar-codex-weekly")) $("bar-codex-weekly").style.width = `${Math.max(0, Math.min(100, codexWeekly))}%`;
  if ($("reset-codex")) $("reset-codex").textContent = formatCountdown(ts.codexResetTime);
  if ($("count-codex")) $("count-codex").textContent = ts.codexTokensLeft ? `${(ts.codexTokensLeft / 1000).toFixed(0)}k 토큰 남음` : "용량 가용";

  // 4. Task Routing recommendation
  const routing = ts.recommendedTaskWeight || "normal";
  const routingBadge = $("task-routing-badge");
  if (routingBadge) {
    routingBadge.className = `task-routing-pill ${routing}`;
    routingBadge.textContent = routing === "restricted" ? "Restricted (용량 제한)" : routing === "degraded" ? "Degraded (경고)" : "Normal (최대 용량)";
  }

  // 5. Claude Direct Usage
  const cdu = ts.claudeDirectUsage;
  if (cdu && cdu.today) {
    if ($("claude-today-tokens")) {
      const el = $("claude-today-tokens");
      el.textContent = `${(cdu.today.totalTokens || 0).toLocaleString()} `;
      el.appendChild(node("span", "tokens", "unit"));
    }
    if ($("claude-today-billable")) $("claude-today-billable").textContent = (cdu.today.billableTokens || 0).toLocaleString();
    if ($("claude-today-reasoning")) $("claude-today-reasoning").textContent = (cdu.today.reasoningOutputTokens || 0).toLocaleString();
    if ($("claude-7d-tokens")) {
      const el = $("claude-7d-tokens");
      el.textContent = `${(cdu.sevenDays?.totalTokens || 0).toLocaleString()} `;
      el.appendChild(node("span", "tokens", "unit"));
    }
    if ($("claude-7d-billable")) $("claude-7d-billable").textContent = (cdu.sevenDays?.billableTokens || 0).toLocaleString();
    if ($("claude-7d-events")) $("claude-7d-events").textContent = `${cdu.sevenDays?.eventCount || 0}건`;
    if ($("claude-sources")) $("claude-sources").textContent = Array.isArray(cdu.sources) && cdu.sources.length ? cdu.sources.join(", ") : "Claude API, CLI, Cowork";
  }

  // 6. Local Compute
  const lcs = ts.localComputeStatus;
  if (lcs) {
    if ($("local-loaded-model")) $("local-loaded-model").textContent = Array.isArray(lcs.loadedModels) && lcs.loadedModels.length ? lcs.loadedModels.join(", ") : "qwen3.6:27b";
    if ($("local-endpoint-health")) $("local-endpoint-health").textContent = lcs.endpointHealth === "ok" ? "정상 (127.0.0.1:11434)" : "대기중";
    const gpu = Array.isArray(lcs.gpus) && lcs.gpus[0] ? lcs.gpus[0] : null;
    if (gpu) {
      const vramPct = Math.round((gpu.vramUsedMb / Math.max(1, gpu.vramTotalMb)) * 100);
      if ($("gpu-vram-text")) $("gpu-vram-text").textContent = `${(gpu.vramUsedMb / 1024).toFixed(1)} GB / ${(gpu.vramTotalMb / 1024).toFixed(1)} GB (${vramPct}%)`;
      if ($("gpu-vram-bar")) $("gpu-vram-bar").style.width = `${vramPct}%`;
    }
  }

  // 7. Last Updated & Activities
  if ($("token-last-updated")) $("token-last-updated").textContent = `마지막 동기화: ${new Date().toLocaleTimeString()} · 자동 갱신 중`;
  const actList = $("token-activity-list");
  if (actList && Array.isArray(ts.activity) && ts.activity.length) {
    actList.replaceChildren();
    for (const item of ts.activity.slice(0, 5)) {
      actList.append(node("li", item));
    }
  }
}

function renderMainAgent() {
  const capabilities = currentCapabilities();
  let selected = capabilities.find((item) => item.provider === state.mainProvider);
  if (!selected) {
    selected = capabilities[0] || defaults[0];
    state.mainProvider = selected.provider;
  }
  const select = $("main-agent-select");
  if (select) {
    select.replaceChildren();
    for (const capability of capabilities) {
      const option = node("option", `${capability.label || capability.provider}`);
      option.value = capability.provider;
      option.selected = capability.provider === state.mainProvider;
      select.append(option);
    }
  }

  if ($("main-agent-name")) $("main-agent-name").textContent = selected.label || selected.provider;
  const pill = $("main-agent-status");
  if (pill) {
    pill.textContent = selected.available ? "사용가능" : "확인중";
    pill.className = `status-pill ${selected.available ? "available" : "not-installed"}`;
  }

  const endpoint = selected.endpoint || selected.reason || "공식 연결 경로 확인 중";
  if ($("main-agent-detail")) {
    $("main-agent-detail").textContent = `연결 방식: ${safeText(selected.mode)} · 대상 ID: ${selected.provider} · ${endpoint}`;
  }
  if ($("selected-agent-hint")) {
    $("selected-agent-hint").textContent = `현재 메인 대상: ${selected.label || selected.provider}`;
  }

  const actions = $("main-agent-actions");
  if (actions) {
    actions.replaceChildren();
    if (selected.provider === "openai.chatgpt.app") {
      actions.append(
        button("📋 ChatGPT HTTP URL 복사", "button primary copy-chatgpt-mcp"),
        button("📋 STDIO 경로 복사", "button secondary copy-chatgpt-stdio"),
      );
    } else if (selected.provider === "anthropic.claude.desktop") {
      actions.append(
        button("⚡ Claude Desktop 자동 등록", "button primary register-claude"),
        button("📋 설정 JSON 복사", "button secondary copy-claude-mcp"),
      );
    } else {
      actions.append(button("📋 MCP 설정 JSON 복사", "button secondary copy-generic-mcp"));
    }
  }
}

function renderHomeStats() {
  const capabilities = currentCapabilities();
  const availableCount = capabilities.filter((c) => c.available).length;
  if ($("stat-agents")) $("stat-agents").textContent = `${availableCount} / ${capabilities.length}개`;
  if ($("stat-tasks")) $("stat-tasks").textContent = `${state.tasks.length}건`;
  if ($("stat-approvals")) $("stat-approvals").textContent = `${state.approvals.length}건`;
}

function renderAgents() {
  const target = $("agent-list");
  if (!target) return;
  target.replaceChildren();
  for (const item of currentCapabilities()) {
    const card = node("article", undefined, "agent-card-item card");
    const topRow = node("div", undefined, "agent-heading");
    topRow.append(node("strong", item.label || item.provider));
    const pill = node("span", item.available ? "사용가능" : "설치X", `status-pill ${item.available ? "available" : "not-installed"}`);
    topRow.append(pill);
    card.append(topRow);

    const meta = node("div", `${item.provider} · ${item.mode || "bridge"}`, "agent-card-meta");
    card.append(meta);

    const desc = node("div", item.model ? `모델: ${item.model}` : safeText(item.reason, "공식 연결 경로"), "agent-card-meta");
    card.append(desc);

    const act = node("div", undefined, "agent-quick-actions");
    if (item.provider === "openai.chatgpt.app") {
      act.append(button("📋 HTTP URL", "button secondary copy-chatgpt-mcp"));
    } else if (item.provider === "anthropic.claude.desktop") {
      act.append(button("⚡ 자동 등록", "button primary register-claude"));
    } else {
      act.append(button("선택", "button secondary select-main-btn", { provider: item.provider }));
    }
    card.append(act);
    target.append(card);
  }
}

function renderTasks() {
  const taskTarget = $("tasks");
  if (taskTarget) {
    taskTarget.replaceChildren();
    if (!state.tasks.length) {
      taskTarget.append(node("div", "진행 중인 작업이 없습니다.", "empty-card"));
    } else {
      for (const item of state.tasks) {
        const itemCard = node("div", undefined, "card task-card");
        itemCard.append(node("strong", item.title || item.id));
        itemCard.append(node("p", item.goal || ""));
        const meta = node("div", `상태: ${item.status} · 개정: ${item.revision} · 주관: ${item.originProvider}`, "muted");
        itemCard.append(meta);
        const actions = node("div", undefined, "task-actions");
        actions.append(
          button("위임", "button secondary delegate", { task: item.id, revision: String(item.revision) }),
          button("취소", "button secondary cancel", { task: item.id, revision: String(item.revision) }),
        );
        itemCard.append(actions);
        taskTarget.append(itemCard);
      }
    }
  }

  const approvalTarget = $("approvals");
  if (approvalTarget) {
    approvalTarget.replaceChildren();
    if (!state.approvals.length) {
      approvalTarget.append(node("div", "승인 대기 중인 요청이 없습니다.", "empty-card"));
    } else {
      for (const item of state.approvals) {
        const appCard = node("div", undefined, "card approval-card");
        appCard.append(node("strong", `[${item.action}] ${item.description || item.id}`));
        appCard.append(node("p", `요청자: ${item.requestedBy} · 작업: ${item.taskId}`));
        const actions = node("div", undefined, "task-actions");
        actions.append(button("✓ 승인", "button primary approve", { approval: item.id, revision: String(item.expectedRevision ?? 1) }));
        appCard.append(actions);
        approvalTarget.append(appCard);
      }
    }
  }
}

async function refreshLogs() {
  try {
    const res = await api("/v1/logs?lines=160");
    if ($("log-path")) $("log-path").textContent = `로그 경로: ${res.path || "%LOCALAPPDATA%\\IntegratedPower\\state\\broker.log"}`;
    if ($("log-lines")) $("log-lines").textContent = Array.isArray(res.lines) && res.lines.length ? res.lines.join("\n") : "기록된 브로커 로그가 없습니다.";
  } catch (error) {
    if ($("log-lines")) $("log-lines").textContent = `로그 조회 실패: ${error.message}`;
  }
}

async function refreshAutoStart() {
  try {
    const res = await api("/v1/system/autostart");
    state.autoStartEnabled = Boolean(res.enabled);
    const toggle = $("setting-autostart-toggle");
    if (toggle) toggle.checked = state.autoStartEnabled;
  } catch {
    // ignore
  }
}

async function refresh() {
  try {
    await api("/health");
    setConnection("online", "브로커 정상 (37241)");
    if ($("status")) $("status").textContent = "브로커 정상 가동 중 (127.0.0.1:37241)";

    const [capRes, taskRes, appRes, tokenRes] = await Promise.all([
      api("/v1/capabilities").catch(() => ({ capabilities: [] })),
      api("/v1/tasks").catch(() => ({ tasks: [] })),
      api("/v1/approvals").catch(() => ({ approvals: [] })),
      api("/v1/tokens/status").catch(() => ({ tokenStatus: null })),
    ]);

    if (Array.isArray(capRes.capabilities)) state.capabilities = capRes.capabilities;
    if (Array.isArray(taskRes.tasks)) state.tasks = taskRes.tasks;
    if (Array.isArray(appRes.approvals)) state.approvals = appRes.approvals;

    if (tokenRes && tokenRes.tokenStatus) {
      state.previousTokenStatus = state.tokenStatus;
      state.tokenStatus = tokenRes.tokenStatus;
      checkTokenFullNotification(state.previousTokenStatus, state.tokenStatus);
    }

    renderTokens();
    renderMainAgent();
    renderHomeStats();
    renderAgents();
    renderTasks();
    if (state.activeTab === "logs") void refreshLogs();
  } catch (error) {
    setConnection("offline", "브로커 오프라인");
    if ($("status")) $("status").textContent = "브로커 연결 대기 중…";
    renderTokens();
    renderMainAgent();
    renderHomeStats();
    renderAgents();
    renderTasks();
  }
}

function bindEvents() {
  // Sidebar navigation
  document.querySelectorAll(".nav-link").forEach((link) => {
    link.onclick = () => switchTab(link.dataset.section);
  });

  // Quick nav buttons on home tab
  document.addEventListener("click", (e) => {
    const quickBtn = e.target.closest(".quick-nav-btn");
    if (quickBtn && quickBtn.dataset.target) switchTab(quickBtn.dataset.target);
  });

  // Refresh buttons
  if ($("connection-refresh")) $("connection-refresh").onclick = () => void refresh();
  if ($("token-refresh-btn")) $("token-refresh-btn").onclick = async () => {
    showToast("실시간 쿼터를 갱신 중입니다…");
    await refresh();
    showToast("AI 모델 쿼터가 최신 상태로 갱신되었습니다.");
  };

  // Notification Toggles (Quick and Settings)
  const syncNotifyToggles = (checked) => {
    state.notifyOnFullTokens = checked;
    localStorage.setItem("ip_notify_full_tokens", String(checked));
    if ($("token-notify-quick-toggle")) $("token-notify-quick-toggle").checked = checked;
    if ($("setting-token-notify-toggle")) $("setting-token-notify-toggle").checked = checked;
    if (checked) {
      requestNotificationPermission();
      showToast("토큰 100% 완충 시 알림이 켜졌습니다.");
    } else {
      showToast("토큰 100% 완충 시 알림이 꺼졌습니다.");
    }
  };

  if ($("token-notify-quick-toggle")) {
    $("token-notify-quick-toggle").checked = state.notifyOnFullTokens;
    $("token-notify-quick-toggle").onchange = (e) => syncNotifyToggles(e.target.checked);
  }
  if ($("setting-token-notify-toggle")) {
    $("setting-token-notify-toggle").checked = state.notifyOnFullTokens;
    $("setting-token-notify-toggle").onchange = (e) => syncNotifyToggles(e.target.checked);
  }

  // Test Notification Button
  if ($("btn-test-notification")) {
    $("btn-test-notification").onclick = () => {
      requestNotificationPermission();
      showToast("🔔 [테스트 알림] 토큰 100% 완충 알림이 정상적으로 작동합니다.");
      sendDesktopNotification("🎉 [테스트] Integrated Power 토큰 완충 알림", "AI 모델 토큰이 100% 충전되었을 때 이와 같은 알림이 표시됩니다.");
    };
  }

  // Autostart Toggle
  if ($("setting-autostart-toggle")) {
    $("setting-autostart-toggle").onchange = async (e) => {
      const enabled = e.target.checked;
      try {
        const res = await api("/v1/system/autostart", {
          method: "POST",
          body: JSON.stringify({ enabled }),
        });
        state.autoStartEnabled = Boolean(res.enabled);
        showToast(state.autoStartEnabled ? "Windows 시작 시 자동 실행이 등록되었습니다." : "Windows 시작 시 자동 실행이 해제되었습니다.");
      } catch (err) {
        showToast(`자동 실행 설정 실패: ${err.message}`, true);
        e.target.checked = state.autoStartEnabled;
      }
    };
  }

  // Log tab buttons
  if ($("log-refresh-btn")) $("log-refresh-btn").onclick = () => void refreshLogs();
  if ($("log-copy-btn")) {
    $("log-copy-btn").onclick = async () => {
      const content = $("log-lines")?.textContent || "";
      await copyToClipboard(content, "브로커 로그가 클립보드에 복사되었습니다.");
    };
  }

  // Main agent selection change
  if ($("main-agent-select")) {
    $("main-agent-select").onchange = (e) => {
      state.mainProvider = e.target.value;
      renderMainAgent();
    };
  }

  // Task creation
  if ($("create")) {
    $("create").onclick = async () => {
      try {
        await api("/v1/tasks", {
          method: "POST",
          body: JSON.stringify({
            title: $("title").value,
            goal: $("goal").value,
            workspacePath: $("workspace").value || undefined,
            originProvider: state.mainProvider,
            privacy: "private",
          }),
        });
        showToast("새 작업이 성공적으로 등록되었습니다.");
        await refresh();
      } catch (error) {
        showToast(`작업 생성 실패: ${error.message}`, true);
      }
    };
  }

  // Global action delegations
  document.addEventListener("click", async (event) => {
    const control = event.target.closest("button");
    if (!control) return;

    try {
      if (control.classList.contains("select-main-btn") && control.dataset.provider) {
        state.mainProvider = control.dataset.provider;
        renderMainAgent();
        switchTab("home");
      } else if (control.classList.contains("copy-chatgpt-mcp")) {
        await copyToClipboard("http://127.0.0.1:37241/mcp", "ChatGPT 맞춤형 MCP URL ('http://127.0.0.1:37241/mcp')이 복사되었습니다.");
      } else if (control.classList.contains("copy-chatgpt-stdio")) {
        const stdioSnippet = `{\n  "mcpServers": {\n    "integrated-power": {\n      "command": "node",\n      "args": ["D:\\\\Workspace\\\\integrated-power-control-center\\\\mcp-server.js"]\n    }\n  }\n}`;
        await copyToClipboard(stdioSnippet, "ChatGPT STDIO 설정 JSON이 복사되었습니다.");
      } else if (control.classList.contains("register-claude")) {
        const res = await api("/v1/integrations/claude/register", { method: "POST", body: JSON.stringify({ confirm: true }) });
        showToast(`Claude Desktop에 Integrated Power MCP가 등록되었습니다 (${res.changed ? "신규 등록" : "이미 최신"}). Claude를 재시작하세요.`);
        await refresh();
      } else if (control.classList.contains("copy-claude-mcp") || control.classList.contains("copy-generic-mcp")) {
        const res = await api("/v1/integrations/claude/spec").catch(() => null);
        const snippet = JSON.stringify(res?.snippet || { mcpServers: { "integrated-power": { command: "node", args: ["mcp-server.js"] } } }, null, 2);
        await copyToClipboard(snippet, "MCP 설정 JSON이 클립보드에 복사되었습니다.");
      } else if (control.classList.contains("delegate")) {
        await api("/v1/tasks/delegate", {
          method: "POST",
          body: JSON.stringify({ taskId: control.dataset.task, provider: state.mainProvider, prompt: $("goal")?.value || "작업 위임", expectedRevision: Number(control.dataset.revision) }),
        });
        showToast("작업이 성공적으로 위임되었습니다.");
        await refresh();
      } else if (control.classList.contains("cancel")) {
        await api(`/v1/tasks/${encodeURIComponent(control.dataset.task)}/cancel`, {
          method: "POST",
          body: JSON.stringify({ expectedRevision: Number(control.dataset.revision) }),
        });
        showToast("작업이 취소되었습니다.");
        await refresh();
      } else if (control.classList.contains("approve")) {
        await api(`/v1/approvals/${encodeURIComponent(control.dataset.approval)}/approve`, {
          method: "POST",
          body: JSON.stringify({ expectedRevision: Number(control.dataset.revision) }),
        });
        showToast("요청이 승인되었습니다.");
        await refresh();
      }
    } catch (err) {
      showToast(`동작 실패: ${err.message}`, true);
    }
  });
}

// Initial setup
bindEvents();
switchTab("tokens"); // DEFAULT ON OPEN
renderTokens();
renderMainAgent();
renderHomeStats();
renderAgents();
renderTasks();
void refresh();
void refreshAutoStart();
setInterval(refresh, 5000);
