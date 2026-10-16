const vscode = typeof acquireVsCodeApi === "function" ? acquireVsCodeApi() : undefined;

let dashboardState = emptyState();
let brokerControlState = { tasks: [], approvals: [], loading: true, busy: false };

const root = document.getElementById("app") || document.body;
let refreshRenderTimer;
let lastRenderedHtml = "";

window.addEventListener("message", (event) => {
  try {
    const message = event.data;

    if (!message || typeof message !== "object") {
      return;
    }

    if (message.type === "state") {
      captureDomSectionStates();
      const incomingSectionStates = message.state?.sectionStates;
      const mergedSectionStates = {
        ...normalizeSectionStates(dashboardState.sectionStates),
        ...(incomingSectionStates && typeof incomingSectionStates === "object" ? incomingSectionStates : {}),
      };
      dashboardState = normalizeState({
        ...(message.state || {}),
        sectionStates: mergedSectionStates,
      });
      persistState();
      render();
      return;
    }

    if (message.type === "loading") {
      const nextIsLoading = Boolean(message.isLoading ?? dashboardState.isLoading);
      const nextIsTokenLoading = Boolean(message.isTokenLoading ?? dashboardState.isTokenLoading);
      dashboardState = {
        ...dashboardState,
        isLoading: nextIsLoading,
        isTokenLoading: nextIsTokenLoading,
        refreshStartedAt: nextIsLoading || nextIsTokenLoading ? dashboardState.refreshStartedAt || new Date().toISOString() : undefined,
      };
      render();
      return;
    }

    if (message.type === "brokerState") {
      const incomingState = message.state && typeof message.state === "object" ? message.state : {};
      brokerControlState = {
        ...brokerControlState,
        ...incomingState,
        error: typeof incomingState.error === "string" && incomingState.error ? incomingState.error : undefined,
        loading: false,
        busy: false,
      };
      render();
      return;
    }

    if (message.type === "brokerLoading") {
      brokerControlState = { ...brokerControlState, error: undefined, loading: true, busy: Boolean(message.busy) };
      render();
      return;
    }

    if (message.type === "error") {
      dashboardState = {
        ...dashboardState,
        systemErrors: [String(message.message || "Unknown error"), ...dashboardState.systemErrors].slice(0, 50),
        isLoading: false,
        isTokenLoading: false,
        refreshStartedAt: undefined,
      };
      persistState();
      render();
    }
  } catch (err) {
    console.error("[Integrated Power Webview] Message error:", err);
  }
});

function emptyTokenStatus() {
  return {
    antigravityTokensLeft: 0,
    antigravityMax: 0,
    antigravityWeeklyTokensLeft: 0,
    antigravityWeeklyMax: 0,
    opusTokensLeft: 0,
    opusMax: 0,
    opusWeeklyTokensLeft: 0,
    opusWeeklyMax: 0,
    codexTokensLeft: 0,
    codexMax: 0,
    codexWeeklyTokensLeft: 0,
    codexWeeklyMax: 0,
    recommendedTaskWeight: "unknown",
    activity: ["Initializing..."],
  };
}

function emptyState() {
  return {
    workspaceName: "Workspace",
    runs: [],
    activeRuns: [],
    artifacts: [],
    parseErrors: [],
    systemErrors: [],
    isLoading: true,
    isTokenLoading: true,
    isStale: false,
    sectionStates: { antigravity: true, codex: true, openai: true, claude: true, localLlm: true },
    viewConfig: undefined,
    prewarmMode: "click",
    prewarmModes: { antigravity: "click", opus: "click", codex: "click" },
    updatedAt: new Date().toISOString(),
    refreshStartedAt: undefined,
    tokenStatus: emptyTokenStatus(),
  };
}

function normalizePrewarmMode(mode) {
  if (mode === "always" || mode === "once" || mode === "click") {
    return mode;
  }
  return "click";
}

function normalizeState(state) {
  const safeState = state && typeof state === "object" ? state : {};
  const runs = Array.isArray(safeState.runs) ? safeState.runs.map(normalizeRun) : [];
  const activeRuns = Array.isArray(safeState.activeRuns) ? safeState.activeRuns.map(normalizeRun) : [];
  const artifacts = Array.isArray(safeState.artifacts) ? safeState.artifacts.map(normalizeArtifact) : [];
  const sectionStates = normalizeSectionStates(safeState.sectionStates);

  return {
    workspaceName: stringValue(safeState.workspaceName) || "Workspace",
    runsFile: safeRelativePath(safeState.runsFile),
    runs,
    activeRuns,
    artifacts,
    parseErrors: stringArray(safeState.parseErrors),
    systemErrors: stringArray(safeState.systemErrors),
    tokenStatus: normalizeTokenStatus(safeState.tokenStatus),
    localLlmMetrics: Array.isArray(safeState.localLlmMetrics) ? safeState.localLlmMetrics : [],
    queueContent: stringValue(safeState.queueContent),
    metricsCsv: stringValue(safeState.metricsCsv),
    isLoading: Boolean(safeState.isLoading),
    isTokenLoading: Boolean(safeState.isTokenLoading),
    isStale: Boolean(safeState.isStale),
    sectionStates,
    viewConfig: safeState.viewConfig && typeof safeState.viewConfig === "object" ? safeState.viewConfig : undefined,
    prewarmMode: normalizePrewarmMode(safeState.prewarmMode),
    prewarmModes: safeState.prewarmModes && typeof safeState.prewarmModes === "object"
      ? {
          antigravity: normalizePrewarmMode(safeState.prewarmModes.antigravity || safeState.prewarmMode),
          opus: normalizePrewarmMode(safeState.prewarmModes.opus),
          codex: normalizePrewarmMode(safeState.prewarmModes.codex),
        }
      : {
          antigravity: normalizePrewarmMode(safeState.prewarmMode),
          opus: "click",
          codex: "click",
        },
    updatedAt: stringValue(safeState.updatedAt) || new Date().toISOString(),
    refreshStartedAt: stringValue(safeState.refreshStartedAt),
  };
}

function normalizeSectionStates(sectionStates) {
  const safeSectionStates = sectionStates && typeof sectionStates === "object" ? sectionStates : {};
  const defaults = {
    antigravity: true,
    codex: true,
    openai: true,
    claude: true,
    localLlm: true,
  };
  const result = { ...defaults };
  for (const [key, val] of Object.entries(safeSectionStates)) {
    if (typeof val === "boolean") {
      result[key] = val;
    }
  }
  return result;
}

function captureDomSectionStates() {
  if (!root) return;
  const elements = root.querySelectorAll("details[data-section]");
  if (elements.length > 0) {
    const states = { ...normalizeSectionStates(dashboardState.sectionStates) };
    elements.forEach((el) => {
      const sec = el.dataset.section;
      if (sec) {
        states[sec] = el.open;
      }
    });
    dashboardState.sectionStates = states;
  }
}

function normalizeRun(run) {
  const safeRun = run && typeof run === "object" ? run : {};
  return {
    id: stringValue(safeRun.id),
    title: stringValue(safeRun.title) || stringValue(safeRun.id) || "Untitled run",
    status: stringValue(safeRun.status) || "unknown",
    active: Boolean(safeRun.active),
    startedAt: stringValue(safeRun.startedAt),
    updatedAt: stringValue(safeRun.updatedAt),
    summary: stringValue(safeRun.summary),
    agentSurface: stringValue(safeRun.agentSurface),
    kind: stringValue(safeRun.kind),
    contextFiles: stringArray(safeRun.contextFiles),
    artifacts: Array.isArray(safeRun.artifacts) ? safeRun.artifacts.map(normalizeArtifact) : [],
  };
}

function normalizeArtifact(artifact) {
  const safeArtifact = artifact && typeof artifact === "object" ? artifact : {};
  const workspacePath = safeRelativePath(safeArtifact.workspacePath);
  return {
    id: stringValue(safeArtifact.id),
    label: stringValue(safeArtifact.label) || workspacePath || "Artifact",
    runId: stringValue(safeArtifact.runId),
    runTitle: stringValue(safeArtifact.runTitle),
    type: stringValue(safeArtifact.type),
    workspacePath,
    canOpen: Boolean(safeArtifact.canOpen && workspacePath && stringValue(safeArtifact.id)),
  };
}

function optionalNumber(value) {
  if (value === null || typeof value === "boolean" || (typeof value === "string" && !value.trim())) return undefined;
  if (typeof value !== "number" && typeof value !== "string") return undefined;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

function normalizeTokenStatus(status) {
  if (!status || typeof status !== "object") {
    return undefined;
  }

  return {
    ...status,
    antigravityTokensLeft: toFiniteNumber(status.antigravityTokensLeft),
    antigravityMax: toFiniteNumber(status.antigravityMax),
    antigravityPercentage: optionalNumber(status.antigravityPercentage),
    antigravityEstimatedAbsolute: optionalNumber(status.antigravityEstimatedAbsolute),
    antigravityWeeklyTokensLeft: toFiniteNumber(status.antigravityWeeklyTokensLeft),
    antigravityWeeklyMax: toFiniteNumber(status.antigravityWeeklyMax),
    antigravityWeeklyPercentage: optionalNumber(status.antigravityWeeklyPercentage),
    antigravityWeeklyResetTime: stringValue(status.antigravityWeeklyResetTime),
    opusTokensLeft: toFiniteNumber(status.opusTokensLeft),
    opusMax: toFiniteNumber(status.opusMax),
    opusPercentage: optionalNumber(status.opusPercentage),
    opusEstimatedAbsolute: optionalNumber(status.opusEstimatedAbsolute),
    opusWeeklyTokensLeft: toFiniteNumber(status.opusWeeklyTokensLeft),
    opusWeeklyMax: toFiniteNumber(status.opusWeeklyMax),
    opusWeeklyPercentage: optionalNumber(status.opusWeeklyPercentage),
    opusWeeklyEstimatedAbsolute: optionalNumber(status.opusWeeklyEstimatedAbsolute),
    opusWeeklyResetTime: stringValue(status.opusWeeklyResetTime),
    codexTokensLeft: toFiniteNumber(status.codexTokensLeft),
    codexMax: toFiniteNumber(status.codexMax),
    codexPercentage: optionalNumber(status.codexPercentage),
    codexEstimatedAbsolute: optionalNumber(status.codexEstimatedAbsolute),
    codexWeeklyTokensLeft: toFiniteNumber(status.codexWeeklyTokensLeft),
    codexWeeklyMax: toFiniteNumber(status.codexWeeklyMax),
    codexWeeklyPercentage: optionalNumber(status.codexWeeklyPercentage),
    codexWeeklyEstimatedAbsolute: optionalNumber(status.codexWeeklyEstimatedAbsolute),
    codexWeeklyResetTime: stringValue(status.codexWeeklyResetTime),
    claudeDirectUsage: normalizeClaudeDirectUsage(status.claudeDirectUsage),
    recommendedTaskWeight: normalizeTaskWeight(status.recommendedTaskWeight),
    activity: stringArray(status.activity),
  };
}

function normalizeClaudeDirectUsage(value) {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  return {
    status: value.status === "measured" || value.status === "partial" ? value.status : "no-data",
    today: normalizeUsageSummary(value.today),
    sevenDays: normalizeUsageSummary(value.sevenDays),
    sources: stringArray(value.sources),
    lastUsedAt: stringValue(value.lastUsedAt),
    lastMeasuredAt: stringValue(value.lastMeasuredAt),
    errors: stringArray(value.errors),
  };
}

function normalizeUsageSummary(value) {
  const safeValue = value && typeof value === "object" ? value : {};
  return {
    inputTokens: toFiniteNumber(safeValue.inputTokens),
    cachedInputTokens: toFiniteNumber(safeValue.cachedInputTokens),
    outputTokens: toFiniteNumber(safeValue.outputTokens),
    reasoningOutputTokens: toFiniteNumber(safeValue.reasoningOutputTokens),
    totalTokens: toFiniteNumber(safeValue.totalTokens),
    billableTokens: optionalNumber(safeValue.billableTokens),
    eventCount: toFiniteNumber(safeValue.eventCount),
  };
}

function render() {
  captureDomSectionStates();
  const isRefreshing = dashboardState.isLoading;
  if (refreshRenderTimer) {
    clearTimeout(refreshRenderTimer);
    refreshRenderTimer = undefined;
  }

  const nextHtml = `
    <main class="dashboard-shell ${dashboardState.isLoading ? "is-loading" : ""}">
      <header class="dashboard-header">
        <div>
          <p class="eyebrow">AI Workflow</p>
          <h1>${escapeHtml(dashboardState.workspaceName)}</h1>
          <div class="header-meta">
            <span>Updated ${escapeHtml(formatDateTime(dashboardState.updatedAt))}</span>
            ${dashboardState.runsFile ? `<span>${escapeHtml(dashboardState.runsFile)}</span>` : ""}
            ${dashboardState.isStale ? `<span class="stale-badge">Stale</span>` : ""}
          </div>
        </div>
        <div class="header-actions">
          <button type="button" class="header-settings-btn" data-command="configureViews" title="Configure Dashboard Views and Panel Visibility">
            ⚙️ <span class="text-full">View Settings</span><span class="text-medium">Settings</span><span class="text-short">View</span>
          </button>
        </div>
      </header>

      <section class="dashboard-grid">
        ${renderTokenStatus(dashboardState.tokenStatus)}
        ${dashboardState.viewConfig?.showLocalLlm !== false ? renderLocalComputeStatus(dashboardState.tokenStatus) : ""}
      </section>

      <section class="content-grid">
        ${dashboardState.viewConfig?.showLocalLlm !== false && dashboardState.localLlmMetrics?.length ? renderLocalLlmMetricsPanel(dashboardState.localLlmMetrics) : ""}
        ${dashboardState.viewConfig?.showQueue !== false && dashboardState.queueContent ? renderQueuePanel(dashboardState.queueContent) : ""}
        ${dashboardState.viewConfig?.showCodex !== false && dashboardState.viewConfig?.showMetrics !== false && dashboardState.metricsCsv ? renderMetricsPanel(dashboardState.metricsCsv) : ""}
        ${dashboardState.viewConfig?.showErrors !== false ? renderErrorsPanel(dashboardState.parseErrors, dashboardState.systemErrors) : ""}
      </section>
      <section id="broker-controls-root" aria-label="Broker tasks and approvals"></section>
    </main>
  `;

  const activeCommand = document.activeElement?.getAttribute("data-command");
  const activeBrokerFocus = document.activeElement?.getAttribute("data-broker-focus");
  const brokerSelection = activeBrokerFocus && typeof document.activeElement.selectionStart === "number"
    ? [document.activeElement.selectionStart, document.activeElement.selectionEnd]
    : undefined;

  function restoreFocus() {
    if (activeCommand) {
      const el = root.querySelector(`[data-command="${activeCommand}"]`);
      if (el) {
        el.focus();
      }
    }
    if (activeBrokerFocus) {
      const focusTarget = [...root.querySelectorAll("[data-broker-focus]")]
        .find((element) => element.getAttribute("data-broker-focus") === activeBrokerFocus);
      if (focusTarget) {
        focusTarget.focus();
        if (brokerSelection && typeof focusTarget.setSelectionRange === "function") {
          focusTarget.setSelectionRange(brokerSelection[0], brokerSelection[1]);
        }
      }
    }
  }

  if (nextHtml === lastRenderedHtml) {
    renderBrokerControls();
    restoreFocus();
    return;
  }

  const prevScrollTop = window.scrollY || document.documentElement.scrollTop;

  lastRenderedHtml = nextHtml;
  root.innerHTML = nextHtml;
  renderBrokerControls();

  if (prevScrollTop > 0) {
    window.scrollTo({ top: prevScrollTop, behavior: "instant" });
  }
  restoreFocus();

  if (!root.__delegationInitialized) {
    root.__delegationInitialized = true;

    root.addEventListener("click", (e) => {
      const setModeBtn = e.target.closest("[data-set-prewarm-mode]");
      if (setModeBtn && setModeBtn.dataset.setPrewarmMode && vscode) {
        const newMode = setModeBtn.dataset.setPrewarmMode;
        const target = setModeBtn.dataset.target;
        if (target) {
          if (!dashboardState.prewarmModes) {
            dashboardState.prewarmModes = { antigravity: "click", opus: "click", codex: "click" };
          }
          dashboardState.prewarmModes[target] = newMode;
          if (target === "antigravity") {
            dashboardState.prewarmMode = newMode;
          }
        } else {
          dashboardState.prewarmMode = newMode;
        }
        render();
        vscode.postMessage({ type: "setPrewarmMode", mode: newMode, target });
        return;
      }

      const prewarmBtn = e.target.closest("[data-prewarm]");
      if (prewarmBtn && prewarmBtn.dataset.prewarm && vscode) {
        prewarmBtn.disabled = true;
        prewarmBtn.classList.add("loading");
        prewarmBtn.innerHTML = '<span class="text-full">⚡ Starting...</span><span class="text-medium">⚡ Starting...</span><span class="text-short">⚡ ...</span>';
        vscode.postMessage({
          type: "prewarm",
          model: prewarmBtn.dataset.prewarm,
          window: prewarmBtn.dataset.prewarmWindow || "5h",
        });
        return;
      }

      const cmdBtn = e.target.closest("[data-command]");
      if (cmdBtn && cmdBtn.dataset.command) {
        postCommand(cmdBtn.dataset.command);
        return;
      }

      const artifactBtn = e.target.closest("[data-artifact-id]");
      if (artifactBtn && artifactBtn.dataset.artifactId && vscode) {
        vscode.postMessage({ type: "openArtifact", artifactId: artifactBtn.dataset.artifactId });
        return;
      }
    });

    root.addEventListener("toggle", (e) => {
      const details = e.target.closest("details[data-section]");
      if (details && details.dataset.section) {
        dashboardState = {
          ...dashboardState,
          sectionStates: {
            ...normalizeSectionStates(dashboardState.sectionStates),
            [details.dataset.section]: details.open,
          },
        };
        persistState();
      }
    }, true);
  }

  root.querySelectorAll("[data-progress]").forEach((element) => {
    const percentage = clamp(Number(element.dataset.progress), 0, 100);
    element.style.width = `${percentage.toFixed(1)}%`;
  });

  if (isRefreshing) {
    refreshRenderTimer = setTimeout(render, 1000);
  }
}

function renderBrokerControls() {
  const brokerControlsRoot = root.querySelector("#broker-controls-root");
  if (!brokerControlsRoot || !window.IPBrokerControls) return;
  window.IPBrokerControls.render(brokerControlsRoot, {
    ...brokerControlState,
    workspaceName: dashboardState.workspaceName,
    artifacts: dashboardState.artifacts,
  }, (message) => {
    if (vscode) vscode.postMessage(message);
  });
}

function hasDashboardContent(state) {
  return Boolean(
    state.tokenStatus ||
      state.runs?.length ||
      state.activeRuns?.length ||
      state.artifacts?.length ||
      state.queueContent ||
      state.metricsCsv ||
      state.localLlmMetrics?.length
  );
}

function renderTokenStatus(tokenStatus) {
  if (!tokenStatus && dashboardState.isTokenLoading) {
    return renderTokenSkeleton();
  }

  const status = tokenStatus || {};
  const antigravity = buildTokenMetric("5Hours", status, "antigravity", "Gemini 5Hours", "antigravityWeekly");
  const antigravityWeekly = buildTokenMetric("Weekly", status, "antigravityWeekly", "Gemini Weekly");
  const opus = buildTokenMetric("5Hours", status, "opus", "Claude 5Hours", "opusWeekly");
  const opusWeekly = buildTokenMetric("Weekly", status, "opusWeekly", "Claude Weekly");
  const codex = buildTokenMetric("5Hours", status, "codex", "ChatGPT 5Hours", "codexWeekly");
  const codexWeekly = buildTokenMetric("Weekly", status, "codexWeekly", "ChatGPT Weekly");
  const sectionStates = normalizeSectionStates(dashboardState.sectionStates);
  const taskWeight = normalizeTaskWeight(status.recommendedTaskWeight);

  const sections = [];

  // Section 1: Antigravity IDE (Gemini + Claude)
  if (dashboardState.viewConfig?.showAntigravity !== false) {
    const hasAntigravity = Boolean(antigravity?.percentage !== undefined || antigravityWeekly?.percentage !== undefined);
    sections.push(`
      <details class="token-section" data-section="antigravity" ${sectionStates.antigravity !== false ? "open" : ""}>
        <summary>
          <span class="section-title">
            <span class="text-full">Antigravity IDE</span>
            <span class="text-medium">Antigravity</span>
            <span class="text-short">Antigravity</span>
          </span>
          <span class="status-pill ${hasAntigravity ? "status-ok" : "status-neutral"}">
            <span class="text-full">${hasAntigravity ? "Connected" : "Idle"}</span>
            <span class="text-medium">${hasAntigravity ? "Connected" : "Idle"}</span>
            <span class="text-short">${hasAntigravity ? "Conn" : "Idle"}</span>
          </span>
        </summary>
        <div class="capacity-groups">
          ${renderCapacityGroup("Gemini", [antigravity, antigravityWeekly])}
          ${renderCapacityGroup("Claude", [opus, opusWeekly])}
        </div>
      </details>
    `);
  }

  // Section 2: OpenAI (ChatGPT + Codex)
  if (dashboardState.viewConfig?.showCodex !== false) {
    const hasCodex = Boolean(codex?.percentage !== undefined || codexWeekly?.percentage !== undefined);
    sections.push(`
      <details class="token-section" data-section="openai" ${sectionStates.openai !== false && sectionStates.codex !== false ? "open" : ""}>
        <summary>
          <span class="section-title">
            <span class="text-full">OpenAI (ChatGPT · Codex)</span>
            <span class="text-medium">OpenAI (ChatGPT)</span>
            <span class="text-short">OpenAI</span>
          </span>
          <span class="status-pill ${hasCodex ? "status-ok" : "status-neutral"}">
            <span class="text-full">${hasCodex ? "Connected" : "Idle"}</span>
            <span class="text-medium">${hasCodex ? "Connected" : "Idle"}</span>
            <span class="text-short">${hasCodex ? "Conn" : "Idle"}</span>
          </span>
        </summary>
        <div class="capacity-groups">
          ${renderCapacityGroup("ChatGPT", [codex, codexWeekly])}
        </div>
      </details>
    `);
  }

  // Section 3: Anthropic Claude (API · CLI · Cowork) - Token Status Submenu
  if (dashboardState.viewConfig?.showClaude !== false) {
    sections.push(renderClaudeTokenSection(status, sectionStates.claude !== false));
  }

  return `
    <article class="panel token-panel">
      <div class="panel-heading">
        <div>
          <p class="eyebrow">Capacity</p>
          <h2>Token Status</h2>
        </div>
        ${renderTokenPanelStatus(status)}
      </div>

      ${renderCapacitySummary(status)}

      ${sections.join('\n      <hr class="section-divider" />\n')}

      <div class="token-footer">
        ${dashboardState.viewConfig?.showCodex !== false ? `<span>Codex: ${escapeHtml(status.codexStatus || "Idle")}</span>` : ""}
        <span class="task-routing-pill task-routing-${escapeAttr(taskWeight)}">
          <span class="text-full">Task Routing: ${escapeHtml(taskWeight)}</span>
          <span class="text-medium">Task Routing: ${escapeHtml(taskWeight)}</span>
          <span class="text-short">${escapeHtml(taskWeight)}</span>
        </span>
      </div>
    </article>
  `;
}

function renderClaudeTokenSection(status, isOpen) {
  const claude5Hours = buildTokenMetric("5Hours", status, "claude", "Claude 5Hours", "claudeWeekly");
  const claudeWeekly = buildTokenMetric("Weekly", status, "claudeWeekly", "Claude Weekly");
  const hasQuota = !claude5Hours.unavailable || !claudeWeekly.unavailable;

  const claudeUsage = status.claudeDirectUsage || status.directUsage || {};
  const todayTotal = claudeUsage.today?.totalTokens ?? claudeUsage.todayTokens ?? 0;
  const sevenDaysTotal = claudeUsage.sevenDays?.totalTokens ?? claudeUsage.sevenDaysTokens ?? 0;
  const hasDirectUsage = (claudeUsage.today?.eventCount ?? 0) > 0 || (claudeUsage.sevenDays?.eventCount ?? 0) > 0;

  let metrics;
  if (hasQuota) {
    metrics = [claude5Hours, claudeWeekly];
  } else if (hasDirectUsage) {
    metrics = [
      buildClaudeMetric("Today", claudeUsage.today, todayTotal),
      buildClaudeMetric("Weekly", claudeUsage.sevenDays, sevenDaysTotal),
    ];
  } else {
    metrics = [
      buildTokenMetric("5Hours", status, "claude", "Claude 5Hours", "claudeWeekly"),
      buildTokenMetric("Weekly", status, "claudeWeekly", "Claude Weekly"),
    ];
  }

  const statusLabel = hasQuota ? ["Quota", "Quota", "Q"] : hasDirectUsage ? ["Records", "Records", "Logs"] : ["No records", "No records", "—"];

  return `
    <details class="token-section" data-section="claude" ${isOpen ? "open" : ""}>
      <summary>
        <span class="section-title">
          <span class="text-full">Anthropic Claude</span>
          <span class="text-medium">Claude</span>
          <span class="text-short">Claude</span>
        </span>
        <span class="status-pill ${hasQuota ? "status-ok" : "status-neutral"}" title="${hasQuota ? "Provider quota was reported by its source." : hasDirectUsage ? "Local usage records were observed; this does not confirm provider account connectivity." : "No local usage records were found."}">
          <span class="text-full">${statusLabel[0]}</span>
          <span class="text-medium">${statusLabel[1]}</span>
          <span class="text-short">${statusLabel[2]}</span>
        </span>
      </summary>
      <div class="capacity-groups">
        ${renderCapacityGroup("Claude (API & CLI)", metrics)}
      </div>
    </details>
  `;
}

function buildClaudeMetric(label, summary, totalTokens) {
  const tokens = Number(totalTokens ?? summary?.totalTokens ?? 0);
  const events = Number(summary?.eventCount || 0);
  const hasData = tokens > 0 || events > 0;

  const subtextFull = hasData ? `${formatTokenCount(tokens)} observed usage` : "No usage event recorded";
  const subtextMedium = hasData ? `${formatTokenCount(tokens)}` : "Waiting";
  const subtextShort = hasData ? `${formatTokenCount(tokens)}` : "Waiting";
  const refreshFull = hasData ? `· ${formatNumber(events)} events` : "";
  const refreshMedium = hasData ? `· ${formatNumber(events)} ev` : "";
  const refreshShort = hasData ? `· ${formatNumber(events)} ev` : "";
  const tooltip = `[Local usage records; not account quota] Claude ${label}: ${subtextFull}${refreshFull}.`;

  const labelFull = label;
  const labelMedium = label;
  const labelShort = label === "Today" ? "Today" : "W";

  return {
    label,
    labelFull,
    labelMedium,
    labelShort,
    ariaLabel: `Claude ${label}`,
    mainText: hasData ? `${formatTokenCount(tokens)}` : "Unavailable",
    subtext: subtextFull,
    subtextFull,
    subtextMedium,
    subtextShort,
    refreshText: refreshFull,
    refreshFull,
    refreshMedium,
    refreshShort,
    percentage: undefined,
    unavailable: !hasData,
    isUsageOnly: true,
    tone: "healthy",
    tooltip,
  };
}

function formatTokenBreakdown(summary) {
  const parts = [
    summary.inputTokens ? `${formatNumber(summary.inputTokens)} in` : "",
    summary.cachedInputTokens ? `${formatNumber(summary.cachedInputTokens)} cached` : "",
    summary.outputTokens ? `${formatNumber(summary.outputTokens)} out` : "",
    summary.reasoningOutputTokens ? `${formatNumber(summary.reasoningOutputTokens)} reasoning` : "",
  ].filter(Boolean);
  const events = `${formatNumber(summary.eventCount)} events`;
  return parts.length ? `${parts.join(" · ")} · ${events}` : events;
}

function renderLocalComputeStatus(tokenStatus) {
  if (!tokenStatus && dashboardState.isTokenLoading) {
    return "";
  }

  const status = tokenStatus || {};
  const localComputeStatus = status.localComputeStatus || {};
  const endpointHealth = localComputeStatus.endpointHealth || "offline";
  const loadedModels = Array.isArray(localComputeStatus.loadedModels) ? localComputeStatus.loadedModels : [];
  const hasLoadedModels = loadedModels.length > 0;
  const isServerRunning = endpointHealth === "ok" || endpointHealth === "idle";

  let serverBadgeText = "Offline";
  let serverBadgeClass = "status-error";
  if (hasLoadedModels) {
    serverBadgeText = `Active · ${loadedModels[0]}`;
    serverBadgeClass = "status-ok";
  } else if (isServerRunning) {
    serverBadgeText = `${localComputeStatus.programName || "Server"} (Idle)`;
    serverBadgeClass = "status-neutral";
  }

  const sectionStates = normalizeSectionStates(dashboardState.sectionStates);
  const gpus = Array.isArray(localComputeStatus.gpus) ? localComputeStatus.gpus : [];

  return `
    <article class="panel token-panel local-compute-panel">
      <div class="panel-heading">
        <div>
          <p class="eyebrow">Local Compute</p>
          <h2>Local LLM</h2>
        </div>
        <span class="status-pill ${serverBadgeClass}">
          <span class="text-full">${escapeHtml(serverBadgeText)}</span>
          <span class="text-medium">${escapeHtml(serverBadgeText)}</span>
          <span class="text-short">${escapeHtml(hasLoadedModels ? "Active" : isServerRunning ? "Ready" : "Off")}</span>
        </span>
      </div>

      <details class="token-section" data-section="localLlm" ${sectionStates.localLlm ? "open" : ""}>
        <summary>
          <span class="section-title">
            <span class="text-full">GPU Capacity (${gpus.length ? `${gpus.length} GPUs` : "Detecting"})</span>
            <span class="text-medium">GPU Capacity (${gpus.length})</span>
            <span class="text-short">GPU (${gpus.length})</span>
          </span>
          <span class="status-pill ${serverBadgeClass}">
            <span class="text-full">${escapeHtml(serverBadgeText)}</span>
            <span class="text-medium">${escapeHtml(serverBadgeText)}</span>
            <span class="text-short">${escapeHtml(hasLoadedModels ? "Active" : isServerRunning ? "Ready" : "Offline")}</span>
          </span>
        </summary>
        <div class="capacity-groups">
          ${
            gpus.length
              ? gpus.map((gpu) => {
                  const powerW = Math.round(Number(gpu.powerDrawW || 0));
                  const powerLimitW = Math.round(Number(gpu.powerLimitW || 0));
                  const hasPower = powerW > 0 && powerLimitW > 0;
                  const powerText = {
                    full: hasPower ? `${powerW}W / ${powerLimitW}W` : "",
                    medium: hasPower ? `${powerW}W/${powerLimitW}W` : "",
                    short: hasPower ? `${powerW}W` : "",
                  };

                  const vramUsedGb = (Number(gpu.vramUsedMb || 0) / 1024).toFixed(1);
                  const vramTotalGb = (Number(gpu.vramTotalMb || 0) / 1024).toFixed(0);
                  const hasVram = Number(gpu.vramTotalMb || 0) > 0;
                  const vramText = {
                    full: hasVram ? `${vramUsedGb}GB / ${vramTotalGb}GB` : "",
                    medium: hasVram ? `${vramUsedGb}GB/${vramTotalGb}GB` : "",
                    short: hasVram ? `${vramUsedGb}/${vramTotalGb}G` : "",
                  };

                  const isGpuActive = Number(gpu.vramUsedMb || 0) >= 1000;
                  let gpuTagFull = "";
                  let gpuTagMedium = "";
                  let gpuTagShort = "";
                  if (hasLoadedModels && isGpuActive) {
                    const modelShort = (loadedModels[0] || "").split("/").pop() || loadedModels[0];
                    gpuTagFull = ` · [${loadedModels[0]}]`;
                    gpuTagMedium = ` · [${modelShort}]`;
                    gpuTagShort = ` [${modelShort.slice(0, 6)}]`;
                  } else if (isGpuActive) {
                    gpuTagFull = ` · [VRAM Active]`;
                    gpuTagMedium = ` · [Active]`;
                    gpuTagShort = ` [Act]`;
                  } else {
                    gpuTagFull = ` · [Idle]`;
                    gpuTagMedium = ` · [Idle]`;
                    gpuTagShort = ` [Idle]`;
                  }

                  const cleanGpuName = (gpu.name || "GPU").replace(/NVIDIA GeForce\s*/i, "").trim();
                  const gpuTitleVariants = {
                    full: `GPU ${gpu.id}: ${cleanGpuName}${gpuTagFull}`,
                    medium: `GPU ${gpu.id}: ${cleanGpuName}${gpuTagMedium}`,
                    short: `GPU ${gpu.id}: ${cleanGpuName.replace(/RTX\s*/i, "")}${gpuTagShort}`,
                  };

                  return renderCapacityGroup(
                    `GPU ${gpu.id}: ${cleanGpuName}${gpuTagFull}`,
                    [
                      buildHardwareMetric(
                        "GPU",
                        gpu.utilizationPercentage,
                        100,
                        "%",
                        powerText
                      ),
                      buildHardwareMetric(
                        "VRAM",
                        gpu.vramUsedMb,
                        gpu.vramTotalMb,
                        "MB",
                        vramText
                      ),
                    ],
                    gpuTitleVariants
                  );
                }).join("")
              : renderCapacityGroup("GPU Offline", [
                  buildHardwareMetric("GPU", null, 100, "%"),
                  buildHardwareMetric("VRAM", null, null, "MB"),
                ])
          }
        </div>
      </details>
    </article>
  `;
}

function renderCapacitySummary(status) {
  // A5 Best/Lowest selection lives in shared/quota (window.IPQuota) — the
  // same source the control-center consumes. Only the DOM stays here.
  const summary = IPQuota.calculateCapacitySummary(status, dashboardState.viewConfig);
  if (!summary) {
    return "";
  }
  const { lowest, strongest } = summary;

  return `
    <div class="capacity-summary" title="${escapeAttr("Higher remaining quota is better. Healthy: over 35%. Caution: 15-35%. Limited: 15% or lower.")}">
      <span class="summary-pill">
        <strong>Best</strong>
        <span class="text-full">${escapeHtml(strongest.labelFull)}</span>
        <span class="text-medium">${escapeHtml(strongest.labelMedium)}</span>
        <span class="text-short">${escapeHtml(strongest.labelShort)}</span>
        ${strongest.percentage.toFixed(0)}%
      </span>
      <span class="summary-pill summary-${escapeAttr(capacityTone(lowest.percentage))}">
        <strong>Lowest</strong>
        <span class="text-full">${escapeHtml(lowest.labelFull)}</span>
        <span class="text-medium">${escapeHtml(lowest.labelMedium)}</span>
        <span class="text-short">${escapeHtml(lowest.labelShort)}</span>
        ${lowest.percentage.toFixed(0)}%
      </span>
    </div>
  `;
}

function getPrewarmTargetForGroup(title) {
  const t = (title || "").toLowerCase().trim();
  if (t.includes("api") || t.includes("cli")) return undefined;
  const model = t.includes("gemini") || t === "antigravity" ? "antigravity"
    : t === "claude" || t.includes("opus") ? "opus"
    : t.includes("chatgpt") || t.includes("codex") || t === "openai" ? "codex"
    : undefined;
  return model && IPQuota.PREWARM_TARGETS.some((target) => target.model === model) ? model : undefined;
}

function renderPrewarmInlineControl(target, label) {
  const modes = dashboardState.prewarmModes || {};
  const currentMode = normalizePrewarmMode(modes[target] || (target === "antigravity" ? dashboardState.prewarmMode : "click"));

  return `
    <div class="prewarm-inline-control" role="radiogroup" aria-label="${escapeAttr(label)} Pre-warm Mode" title="${escapeAttr(`${label} 5시간 프리웜 설정: 해당 창이 Ready일 때 요청합니다. 실제 타이머 시작은 제공자에서 별도로 확인해야 합니다.`)}">
      <span class="prewarm-icon" aria-hidden="true" title="${escapeAttr(`${label} Pre-warm`)}">⚡</span>
      <div class="prewarm-mode-options">
        <button type="button" class="prewarm-mode-btn ${currentMode === "click" ? "active" : ""}" data-target="${escapeAttr(target)}" data-set-prewarm-mode="click" title="${escapeAttr(`${label} Click: 수동 실행만 허용`)}">
          <span class="text-full">Click</span>
          <span class="text-medium">Click</span>
          <span class="text-short">Clk</span>
        </button>
        <button type="button" class="prewarm-mode-btn ${currentMode === "once" ? "active" : ""}" data-target="${escapeAttr(target)}" data-set-prewarm-mode="once" title="${escapeAttr(`${label} Once: 100% 도달 시 1회 자동 실행 후 Click으로 복귀`)}">
          <span class="text-full">Once</span>
          <span class="text-medium">Once</span>
          <span class="text-short">1x</span>
        </button>
        <button type="button" class="prewarm-mode-btn ${currentMode === "always" ? "active" : ""}" data-target="${escapeAttr(target)}" data-set-prewarm-mode="always" title="${escapeAttr(`${label} Always: 100% 완충 시마다 연속 자동 프리웜`)}">
          <span class="text-full">Always</span>
          <span class="text-medium">Always</span>
          <span class="text-short">Alw</span>
        </button>
      </div>
    </div>
  `;
}

function renderTokenPanelStatus(status) {
  const visibleStatuses = [];
  if (dashboardState.viewConfig?.showCodex !== false && status.codexStatus) visibleStatuses.push(status.codexStatus);
  const pillStatus = visibleStatuses[0] || "Active";
  const isRefreshing = dashboardState.isLoading || dashboardState.isTokenLoading;
  const refreshingClass = isRefreshing ? " status-refreshing" : "";
  const title = isRefreshing
    ? `Updating... Last fresh update: ${formatDateTime(dashboardState.updatedAt)}.`
    : `Current status: ${pillStatus}.`;

  return `<span class="status-pill ${statusClass(pillStatus)}${refreshingClass}" title="${escapeAttr(title)}">${escapeHtml(pillStatus)}</span>`;
}

function renderTokenSkeleton() {
  return `
    <article class="panel token-panel">
      <div class="panel-heading">
        <div>
          <p class="eyebrow">Capacity</p>
          <h2>Token Status</h2>
        </div>
        <span class="status-pill status-warning">Loading</span>
      </div>
      <div class="skeleton-block"></div>
      <div class="skeleton-block short"></div>
    </article>
  `;
}

// Quota calculation/formatting now lives in shared/quota (bundled to
// webview/quota-core.js, exposed globally as IPQuota / window.IPQuota).
// Use safe fallback reference to avoid SyntaxError in classic script scopes.
var IPQuota = window.IPQuota || (typeof IPQuota !== "undefined" ? IPQuota : undefined);

function buildTokenMetric(label, status, prefix, ariaLabel, pairedWeeklyPrefix) {
  // A4 absolute-token availability + A7 tooltip live in shared/quota
  // (window.IPQuota) — the same source the control-center consumes.
  return IPQuota.buildTokenMetric(label, status, prefix, ariaLabel, pairedWeeklyPrefix);
}

function renderCapacityGroup(title, metrics, titleVariants) {
  let titleFull = title;
  let titleMedium = title
    .replace(/NVIDIA GeForce\s*/i, "")
    .trim();
  let titleShort = title
    .replace(/NVIDIA GeForce\s*/i, "")
    .replace(/Thinking\s*via\s*Antigravity/i, "")
    .replace(/Thinking\s*/i, "")
    .replace(/Pro\s*/i, "")
    .trim();

  if (titleVariants) {
    if (titleVariants.full) titleFull = titleVariants.full;
    if (titleVariants.medium) titleMedium = titleVariants.medium;
    if (titleVariants.short) titleShort = titleVariants.short;
  } else if (/^GPU\s+\d+:/i.test(title)) {
    titleMedium = title
      .replace(/NVIDIA GeForce\s*/i, "")
      .replace(/ · \[VRAM Active\]/i, " · [Active]")
      .replace(/ · \[Idle\]/i, " · [Idle]")
      .trim();
    titleShort = title
      .replace(/NVIDIA GeForce\s*/i, "")
      .replace(/RTX\s*/i, "")
      .replace(/ · \[VRAM Active\]/i, " [Act]")
      .replace(/ · \[Idle\]/i, " [Idle]")
      .trim();
  }

  const prewarmTarget = getPrewarmTargetForGroup(title);
  const inlinePrewarm = prewarmTarget ? renderPrewarmInlineControl(prewarmTarget, titleFull) : "";

  return `
    <div class="capacity-group">
      <div class="capacity-group-header">
        <h3 title="${escapeAttr(titleFull)}">
          <span class="text-full">${escapeHtml(titleFull)}</span>
          <span class="text-medium">${escapeHtml(titleMedium)}</span>
          <span class="text-short">${escapeHtml(titleShort)}</span>
        </h3>
        ${inlinePrewarm}
      </div>
      <div class="capacity-row-list">
        ${metrics.map((m) => renderCapacityMetric(m, title)).join("")}
      </div>
    </div>
  `;
}

function renderCapacityMetric(metric, groupTitle = "") {
  const targetFromGroup = getPrewarmTargetForGroup(groupTitle);
  const combined = `${metric.ariaLabel || ""} ${metric.labelFull || ""} ${metric.label || ""}`.toLowerCase();
  const inferredTarget = combined.includes("gemini") || combined.includes("antigravity") ? "antigravity"
    : combined.includes("claude") || combined.includes("opus") ? "opus"
    : combined.includes("chatgpt") || combined.includes("codex") ? "codex"
    : undefined;
  const isEligibleGroup = !groupTitle.toLowerCase().includes("api") && !groupTitle.toLowerCase().includes("cli");
  const prewarmTarget = isEligibleGroup ? targetFromGroup || inferredTarget : undefined;
  const isSupportedWindow = metric.label === "5Hours" || metric.label === "Weekly";
  const windowType = metric.label === "Weekly" ? "weekly" : "5h";
  const supportedTarget = prewarmTarget && IPQuota.PREWARM_TARGETS.find((target) => target.model === prewarmTarget && (target.window === windowType || (!target.window && windowType === "5h")));
  const canPrewarm = isSupportedWindow && Boolean(supportedTarget) && IPQuota.canTriggerPrewarm(metric);
  const disabledReason = metric.unavailable
    ? "쿼터 정보를 확인할 수 없습니다."
    : metric.isWeeklyExhausted
      ? "주간 쿼터 소진으로 프리웜을 실행할 수 없습니다."
      : metric.refreshFull && metric.refreshFull !== "· Ready"
        ? (metric.label === "Weekly" ? `주간 재충전 중입니다 (${metric.refreshFull}).` : `5시간 재충전 중입니다 (${metric.refreshFull}).`)
        : (metric.label === "Weekly" ? "일주일(168시간) 쿼터가 100%이고 시간이 꽉 차 있을 때 실행할 수 있습니다." : "5시간 쿼터가 100%이고 시간이 꽉 차 있을 때 실행할 수 있습니다.");
  const prewarmTitle = canPrewarm
    ? `브로커에 ${metric.label === "Weekly" ? "주간(168시간)" : "5시간"} 프리웜 실행을 요청합니다.`
    : disabledReason;
  const prewarmBtn = isSupportedWindow && supportedTarget
    ? `<button type="button" class="prewarm-btn" data-prewarm="${escapeAttr(supportedTarget.model)}" data-prewarm-window="${windowType}" aria-label="${escapeAttr(`${supportedTarget.displayName} pre-warm${canPrewarm ? "" : ` disabled: ${disabledReason}`}`)}" title="${escapeAttr(prewarmTitle)}"${canPrewarm ? "" : " disabled"}><span class="text-full">⚡ Pre-warm</span><span class="text-medium">⚡ Pre-warm</span><span class="text-short">⚡ Pre</span></button>`
    : "";
  const segments = metric.label === "Weekly" ? 7 : 5;
  const ticks = IPQuota.buildGaugeTickGradient(segments);
  const fillPercentage = typeof metric.displayPercentage === "number" ? metric.displayPercentage : metric.percentage;
  const quotaGauge = metric.isUsageOnly ? "" : `
    <div class="progress-track" aria-label="${escapeHtml(metric.ariaLabel)} quota${metric.unavailable ? " unavailable" : ""}">
      <div class="progress-fill" data-progress="${escapeAttr(typeof fillPercentage === "number" ? fillPercentage.toFixed(1) : "")}"${typeof fillPercentage === "number" ? ` style="width:${fillPercentage}%"` : " style=\"width:0%\""}></div>
      <div class="progress-ticks" data-segments="${segments}" aria-hidden="true" style="background-image:${escapeAttr(ticks)}"></div>
    </div>`;

  return `
    <div class="capacity-metric-row token-metric ${metric.tone} ${metric.unavailable ? "unavailable" : ""}" title="${escapeAttr(metric.tooltip || "")}">
      <div class="metric-reset-row">
        <span class="capacity-metric-label">
          <span class="text-full">${escapeHtml(metric.labelFull || metric.label)}</span>
          <span class="text-medium">${escapeHtml(metric.labelMedium || metric.label)}</span>
          <span class="text-short">${escapeHtml(metric.labelShort || metric.label)}</span>
        </span>
        <span class="reset-left">
          <span class="text-full">${escapeHtml(metric.subtextFull || metric.subtext)}</span>
          <span class="text-medium">${escapeHtml(metric.subtextMedium || metric.subtext)}</span>
          <span class="text-short">${escapeHtml(metric.subtextShort || metric.subtext)}</span>
        </span>
        <span class="reset-right">
          ${prewarmBtn}
          <span class="text-full">${escapeHtml(metric.refreshFull || metric.refreshText || "")}</span>
          <span class="text-medium">${escapeHtml(metric.refreshMedium || metric.refreshText || "")}</span>
          <span class="text-short">${escapeHtml(metric.refreshShort || metric.refreshText || "")}</span>
        </span>
      </div>
      ${quotaGauge}
    </div>
  `;
}

function buildHardwareMetric(label, used, total, unit, extraRightText = "") {
  const safeUsed = Number(used);
  const safeTotal = Number(total);
  const hasMetric = Number.isFinite(safeUsed) && safeUsed >= 0 && Number.isFinite(safeTotal) && safeTotal > 0;
  const percentage = hasMetric ? clamp((safeUsed / safeTotal) * 100, 0, 100) : 0;
  const isPercentMetric = unit === "%";
  const mainText = hasMetric
    ? isPercentMetric
      ? `${safeUsed.toFixed(0)}%`
      : `${formatNumber(safeUsed)} / ${formatNumber(safeTotal)} ${unit}`
    : "Unavailable";
  const subtextFull = hasMetric
    ? isPercentMetric
      ? `${percentage.toFixed(0)}% current load`
      : `${percentage.toFixed(1)}% used`
    : "Waiting for hardware data";
  const subtextMedium = hasMetric
    ? isPercentMetric
      ? `${percentage.toFixed(0)}% load`
      : `${percentage.toFixed(1)}%`
    : "Waiting";
  const subtextShort = hasMetric
    ? isPercentMetric
      ? `${percentage.toFixed(0)}%`
      : `${percentage.toFixed(0)}%`
    : "Waiting";
  const tone = percentage >= 90 ? "critical" : percentage >= 75 ? "warning" : "healthy";

  const rightFull = typeof extraRightText === "object" && extraRightText !== null
    ? String(extraRightText.full || "")
    : String(extraRightText || "");
  const rightMedium = typeof extraRightText === "object" && extraRightText !== null
    ? String(extraRightText.medium || extraRightText.full || "")
    : String(extraRightText || "");
  const rightShort = typeof extraRightText === "object" && extraRightText !== null
    ? String(extraRightText.short || extraRightText.medium || extraRightText.full || "")
    : String(extraRightText || "").replace(/\s+/g, "");

  const tooltip = `${label}: ${subtextFull}${rightFull ? ` (${rightFull})` : ""}. Healthy: under 75%. Caution: 75-89%. Limited: 90% or higher.`;

  return {
    label,
    labelFull: label,
    labelMedium: label,
    labelShort: label,
    ariaLabel: label,
    mainText,
    subtext: subtextFull,
    subtextFull,
    subtextMedium,
    subtextShort,
    refreshText: rightFull,
    refreshFull: rightFull,
    refreshMedium: rightMedium,
    refreshShort: rightShort,
    percentage,
    unavailable: !hasMetric,
    tone,
    tooltip,
  };
}

function renderSummaryCard(title, value, detail) {
  return `
    <article class="panel summary-card">
      <p>${escapeHtml(title)}</p>
      <strong>${formatNumber(value)}</strong>
      <span>${escapeHtml(detail)}</span>
    </article>
  `;
}

function renderCurrentTask(taskText) {
  if (!taskText) {
    return "";
  }

  return `
    <article class="panel current-task-panel">
      <p class="eyebrow">Current Task</p>
      <div class="task-content">${escapeHtml(taskText)}</div>
    </article>
  `;
}

function renderRunsPanel(title, runs) {
  return `
    <article class="panel list-panel">
      <div class="panel-heading">
        <h2>${escapeHtml(title)}</h2>
      </div>
      ${
        runs.length
          ? `<div class="item-list">${runs.slice(0, 8).map(renderRunItem).join("")}</div>`
          : `<p class="empty-state">No active runs.</p>`
      }
    </article>
  `;
}

function renderRunItem(run) {
  const detail = run.summary || run.agentSurface || run.kind || run.updatedAt || "";

  return `
    <div class="list-item">
      <div>
        <strong>${escapeHtml(run.title)}</strong>
        ${detail ? `<span>${escapeHtml(detail)}</span>` : ""}
      </div>
      <span class="status-pill ${statusClass(run.status)}">${escapeHtml(run.status)}</span>
    </div>
  `;
}

function renderArtifactsPanel(artifacts) {
  return `
    <article class="panel list-panel">
      <div class="panel-heading">
        <h2>Artifacts</h2>
      </div>
      ${
        artifacts.length
          ? `<div class="item-list">${artifacts.slice(0, 8).map(renderArtifactItem).join("")}</div>`
          : `<p class="empty-state">No artifacts found.</p>`
      }
    </article>
  `;
}

function renderLocalLlmMetricsPanel(metrics) {
  return `
    <article class="panel list-panel">
      <div class="panel-heading">
        <h2>Local LLM Usage Metrics</h2>
      </div>
      <div class="item-list">
        ${metrics.slice(0, 10).map(m => `
          <div class="list-item">
            <div>
              <strong>${escapeHtml(m.taskTitle)} (${escapeHtml(m.taskType || m.taskScale)})</strong>
              <span>${escapeHtml(m.model)} - ${m.actualElapsedSeconds}s elapsed${m.tokensPerSecond ? `, ${escapeHtml(m.tokensPerSecond)} tok/s` : ""}</span>
              ${m.selectionReason ? `<span>${escapeHtml(m.selectionReason)}</span>` : ""}
              ${m.errorMessage ? `<span>${escapeHtml(m.errorMessage)}</span>` : ""}
            </div>
            <span class="status-pill ${m.success === false ? "status-error" : m.success === true ? "status-ok" : "status-neutral"}">
              ${m.success === false ? "Failed" : `${m.totalTokens} Tokens`}
            </span>
          </div>
        `).join("")}
      </div>
    </article>
  `;
}

function renderArtifactItem(artifact) {
  const detail = artifact.workspacePath || artifact.type || artifact.runTitle || "";

  return `
    <div class="list-item">
      <div>
        <strong>${escapeHtml(artifact.label)}</strong>
        ${detail ? `<span>${escapeHtml(detail)}</span>` : ""}
      </div>
      ${
        artifact.canOpen
          ? `<button type="button" data-artifact-id="${escapeAttr(artifact.id)}">Open</button>`
          : `<span class="status-pill status-neutral">Unavailable</span>`
      }
    </div>
  `;
}

function renderQueuePanel(content) {
  return `
    <article class="panel content-panel">
      <div class="panel-heading">
        <h2>AI Work Queue</h2>
      </div>
      <div class="markdown-body">
        <pre>${escapeHtml(content)}</pre>
      </div>
    </article>
  `;
}

function renderMetricsPanel(csv) {
  const lines = csv.split('\n').filter(l => l.trim().length > 0);
  if (lines.length === 0) return '';
  const headerValues = lines[0].split(',');
  const header = headerValues.map(c => escapeHtml(c));
  const rows = lines.slice(Math.max(1, lines.length - 5)).map(l => l.split(',').map(c => escapeHtml(c)));

  return `
    <article class="panel list-panel">
      <div class="panel-heading">
        <h2>Recent Metrics</h2>
      </div>
      <div class="table-container">
        <table>
          <thead>
            <tr>${header.map(h => `<th>${h}</th>`).join('')}</tr>
          </thead>
          <tbody>
            ${rows.map(r => `<tr>${r.map((c, index) => `<td data-label="${escapeAttr(headerValues[index] || `Column ${index + 1}`)}" title="${escapeAttr(c)}">${c}</td>`).join('')}</tr>`).join('')}
          </tbody>
        </table>
      </div>
    </article>
  `;
}

function renderErrorsPanel(parseErrors, systemErrors) {
  const safeSystemErrors = systemErrors || [];
  const safeParseErrors = parseErrors || [];
  const groups = classifyErrorGroups(safeSystemErrors, safeParseErrors);
  const combined = groups.flatMap((group) => group.errors);

  return `
    <article class="panel list-panel errors-panel">
      <div class="panel-heading">
        <div>
          <h2>Errors</h2>
          <p class="panel-caption">Grouped by source so dashboard, quota, run, and parse failures do not blur together.</p>
        </div>
        <span class="count-badge">${combined.length}</span>
      </div>
      ${
        combined.length
          ? `
            ${groups.map(renderErrorGroup).join("")}
          `
          : `<p class="empty-state">No errors.</p>`
      }
    </article>
  `;
}

function classifyErrorGroups(systemErrors, parseErrors) {
  const groups = [
    { id: "dashboard", title: "Dashboard", detail: "Extension state, file reads, and dashboard refresh failures.", errors: [] },
    { id: "quota", title: "Quota Telemetry", detail: "Antigravity, Claude, ChatGPT, and quota collector failures.", errors: [] },
    { id: "runs", title: "Run Execution", detail: "Agent run failures reported from the workspace run log.", errors: [] },
    { id: "parse", title: "Run Log Parsing", detail: "Malformed or unreadable run-log entries.", errors: parseErrors },
  ];

  const byId = Object.fromEntries(groups.map((group) => [group.id, group]));
  systemErrors.forEach((error) => {
    const normalized = error.toLowerCase();
    if (normalized.includes("run failed")) {
      byId.runs.errors.push(error);
    } else if (
      normalized.includes("quota") ||
      normalized.includes("token") ||
      normalized.includes("antigravity") ||
      normalized.includes("codex") ||
      normalized.includes("claude") ||
      normalized.includes("anthropic") ||
      normalized.includes("cowork") ||
      normalized.includes("opus") ||
      normalized.includes("gemini") ||
      normalized.includes("localllm") ||
      normalized.includes("local llm")
    ) {
      byId.quota.errors.push(error);
    } else {
      byId.dashboard.errors.push(error);
    }
  });

  return groups.filter((group) => group.errors.length);
}

function renderErrorGroup(group) {
  if (!group.errors.length) {
    return "";
  }

  return `
    <section class="error-group">
      <h3>${escapeHtml(group.title)}</h3>
      <p>${escapeHtml(group.detail)}</p>
      <ul class="error-list">${group.errors.slice(0, 8).map((error) => `<li>${escapeHtml(error)}</li>`).join("")}</ul>
    </section>
  `;
}

function postCommand(command) {
  if (!vscode || !command) {
    return;
  }

  if (command === "refresh") {
    dashboardState = {
      ...dashboardState,
      isLoading: true,
      isTokenLoading: true,
      isStale: false,
      refreshStartedAt: new Date().toISOString(),
    };
    render();
  }

  const message = command === "ready" ? { type: command, state: dashboardState } : { type: command };
  vscode.postMessage(message);
}

function persistState() {
  if (vscode) {
    vscode.setState(dashboardState);
  }
}

function safeRelativePath(value) {
  const text = stringValue(value);
  if (!text) {
    return undefined;
  }

  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(text) || text.startsWith("/") || text.startsWith("\\\\")) {
    return undefined;
  }

  const parts = text.split(/[\\/]+/).filter(Boolean);
  if (parts.includes("..")) {
    return undefined;
  }

  return parts.join("/");
}

function stringValue(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    const text = stringValue(item);
    return text ? [text] : [];
  });
}

function normalizeTaskWeight(value) {
  return ["normal", "degraded", "restricted", "unknown", "heavy", "light"].includes(value) ? value : "unknown";
}

function toFiniteNumber(value) {
  return IPQuota.toFiniteNumber(value);
}

function clamp(value, min, max) {
  return IPQuota.clamp(value, min, max);
}

function capacityTone(percentage) {
  return IPQuota.capacityTone(percentage);
}

function statusClass(status) {
  const normalized = String(status || "").toLowerCase();
  if (["ok", "ready", "online", "active", "running", "healthy", "completed"].some((term) => normalized.includes(term))) {
    return "status-ok";
  }
  if (["warn", "limited", "busy", "queued", "degraded", "pending"].some((term) => normalized.includes(term))) {
    return "status-warning";
  }
  if (["error", "fail", "offline", "blocked", "exhausted"].some((term) => normalized.includes(term))) {
    return "status-error";
  }
  return "status-neutral";
}

function formatNumber(value) {
  return IPQuota.formatNumber(value);
}

function formatTokenCount(value) {
  return IPQuota.formatTokenCount(value);
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value || "unknown");
  }

  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatElapsed(value) {
  const startedAt = new Date(value || Date.now());
  const diffSeconds = Math.max(0, Math.floor((Date.now() - startedAt.getTime()) / 1000));
  if (!Number.isFinite(diffSeconds) || diffSeconds < 60) {
    return `${diffSeconds || 0}s`;
  }

  const minutes = Math.floor(diffSeconds / 60);
  const seconds = diffSeconds % 60;
  if (minutes < 60) {
    return `${minutes}m ${seconds}s`;
  }

  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function formatResetTime(value) {
  return IPQuota.formatResetTime(value);
}

function formatRefreshCountdown(value) {
  return IPQuota.formatRefreshCountdown(value);
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function initialize() {
  const previousState = vscode?.getState?.();
  if (previousState) {
    dashboardState = normalizeState(previousState);
    dashboardState.isTokenLoading = true;
  }

  render();
  postCommand("ready");
  setInterval(render, 10000);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initialize);
} else {
  initialize();
}
