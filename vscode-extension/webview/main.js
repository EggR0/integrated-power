const vscode = typeof acquireVsCodeApi === "function" ? acquireVsCodeApi() : undefined;

let dashboardState = emptyState();

const root = document.getElementById("app") || document.body;
let refreshRenderTimer;

window.addEventListener("message", (event) => {
  const message = event.data;

  if (!message || typeof message !== "object") {
    return;
  }

  if (message.type === "state") {
    dashboardState = normalizeState({
      ...(message.state || {}),
      sectionStates: message.state?.sectionStates || dashboardState.sectionStates,
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
});

document.addEventListener("DOMContentLoaded", () => {
  const previousState = vscode?.getState?.();
  if (previousState) {
    dashboardState = normalizeState(previousState);
    dashboardState.isTokenLoading = true;
  }

  render();
  postCommand("ready");
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
    sectionStates: { antigravity: true, codex: true, localLlm: true },
    viewConfig: undefined,
    updatedAt: new Date().toISOString(),
    refreshStartedAt: undefined,
    tokenStatus: emptyTokenStatus(),
  };
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
    updatedAt: stringValue(safeState.updatedAt) || new Date().toISOString(),
    refreshStartedAt: stringValue(safeState.refreshStartedAt),
  };
}

function normalizeSectionStates(sectionStates) {
  const safeSectionStates = sectionStates && typeof sectionStates === "object" ? sectionStates : {};
  return {
    antigravity: typeof safeSectionStates.antigravity === "boolean" ? safeSectionStates.antigravity : true,
    codex: typeof safeSectionStates.codex === "boolean" ? safeSectionStates.codex : true,
    localLlm: typeof safeSectionStates.localLlm === "boolean" ? safeSectionStates.localLlm : true,
  };
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

function normalizeTokenStatus(status) {
  if (!status || typeof status !== "object") {
    return undefined;
  }

  const optionalNumber = (value) => {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : undefined;
  };

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
    status: value.status === "measured" ? "measured" : "no-data",
    today: normalizeUsageSummary(value.today),
    sevenDays: normalizeUsageSummary(value.sevenDays),
    sources: stringArray(value.sources),
    lastUsedAt: stringValue(value.lastUsedAt),
    lastMeasuredAt: stringValue(value.lastMeasuredAt) || new Date().toISOString(),
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
    billableTokens: toFiniteNumber(safeValue.billableTokens),
    eventCount: toFiniteNumber(safeValue.eventCount),
  };
}

function render() {
  const isRefreshing = dashboardState.isLoading || dashboardState.isTokenLoading;
  if (refreshRenderTimer) {
    clearTimeout(refreshRenderTimer);
    refreshRenderTimer = undefined;
  }

  root.innerHTML = `
    <main class="dashboard-shell ${dashboardState.isLoading ? "is-loading" : ""} ${isRefreshing ? "is-refreshing" : ""}">
      <header class="dashboard-header">
        <div>
          <p class="eyebrow">AI Workflow</p>
          <h1>${escapeHtml(dashboardState.workspaceName)}</h1>
          <div class="header-meta">
            <span>Updated ${escapeHtml(formatDateTime(dashboardState.updatedAt))}</span>
            ${dashboardState.runsFile ? `<span>${escapeHtml(dashboardState.runsFile)}</span>` : ""}
            ${dashboardState.isStale ? `<span class="stale-badge">Stale</span>` : ""}
          </div>
          <div class="terminal-quick-actions">
            <button class="ghost-btn" data-command="openTerminals" title="Open Broker, Ollama, and Web UI background terminals in IDE">
              ⚡ All Terminals
            </button>
            <button class="ghost-btn" data-command="showBroker" title="Focus Broker Terminal">
              🟢 Broker
            </button>
            <button class="ghost-btn" data-command="showOllama" title="Focus Ollama Local LLM Terminal">
              🦙 Ollama
            </button>
            <button class="ghost-btn" data-command="showWebUI" title="Focus Web UI Terminal">
              🌐 Web UI
            </button>
          </div>
        </div>
      </header>

      <section class="dashboard-grid">
        ${renderTokenStatus(dashboardState.tokenStatus)}
        ${renderClaudeDirectUsage(dashboardState.tokenStatus?.claudeDirectUsage)}
        ${dashboardState.viewConfig?.showLocalLlm !== false ? renderLocalComputeStatus(dashboardState.tokenStatus) : ""}
      </section>

      <section class="content-grid">
        ${dashboardState.viewConfig?.showLocalLlm !== false && dashboardState.localLlmMetrics?.length ? renderLocalLlmMetricsPanel(dashboardState.localLlmMetrics) : ""}
        ${dashboardState.queueContent ? renderQueuePanel(dashboardState.queueContent) : ""}
        ${dashboardState.viewConfig?.showCodex !== false && dashboardState.metricsCsv ? renderMetricsPanel(dashboardState.metricsCsv) : ""}
        ${renderErrorsPanel(dashboardState.parseErrors, dashboardState.systemErrors)}
      </section>
    </main>
  `;

  root.querySelectorAll("[data-command]").forEach((button) => {
    button.addEventListener("click", () => postCommand(button.dataset.command));
  });

  root.querySelectorAll("[data-artifact-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const artifactId = button.dataset.artifactId;
      if (artifactId && vscode) {
        vscode.postMessage({ type: "openArtifact", artifactId });
      }
    });
  });

  root.querySelectorAll("[data-progress]").forEach((element) => {
    const percentage = clamp(Number(element.dataset.progress), 0, 100);
    element.style.width = `${percentage.toFixed(1)}%`;
  });

  root.querySelectorAll("details.token-section").forEach((details) => {
    details.addEventListener("toggle", () => {
      const section = details.dataset.section;
      if (!section) {
        return;
      }

      dashboardState = {
        ...dashboardState,
        sectionStates: {
          ...normalizeSectionStates(dashboardState.sectionStates),
          [section]: details.open,
        },
      };
      persistState();
    });
  });

  if (isRefreshing) {
    refreshRenderTimer = setTimeout(render, 1000);
  }
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
  const antigravity = buildTokenMetric("5Hours", status, "antigravity", "Gemini 3.1 Pro 5Hours");
  const antigravityWeekly = buildTokenMetric("Weekly", status, "antigravityWeekly", "Gemini 3.1 Pro Weekly");
  const opus = buildTokenMetric("5Hours", status, "opus", "Opus 4.6 Thinking via Antigravity 5Hours");
  const opusWeekly = buildTokenMetric("Weekly", status, "opusWeekly", "Opus 4.6 Thinking via Antigravity Weekly");
  const codex = buildTokenMetric("5Hours", status, "codex", "ChatGPT 5Hours");
  const codexWeekly = buildTokenMetric("Weekly", status, "codexWeekly", "ChatGPT Weekly");
  const sectionStates = normalizeSectionStates(dashboardState.sectionStates);
  const taskWeight = normalizeTaskWeight(status.recommendedTaskWeight);
  const activity = Array.isArray(status.activity) ? status.activity.slice(0, 4) : [];

  const sections = [];

  if (dashboardState.viewConfig?.showAntigravity !== false) {
    sections.push(`
      <details class="token-section" data-section="antigravity" ${sectionStates.antigravity ? "open" : ""}>
        <summary>Antigravity IDE</summary>
        <div class="capacity-groups">
          ${renderCapacityGroup("Gemini 3.1 Pro", [antigravity, antigravityWeekly])}
          ${renderCapacityGroup("Opus 4.6 Thinking", [opus, opusWeekly])}
        </div>
      </details>
    `);
  }

  if (dashboardState.viewConfig?.showCodex !== false) {
    sections.push(`
      <details class="token-section" data-section="codex" ${sectionStates.codex ? "open" : ""}>
        <summary>Codex</summary>
        <div class="capacity-groups">
          ${renderCapacityGroup("ChatGPT", [codex, codexWeekly])}
        </div>
      </details>
    `);
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
        ${dashboardState.viewConfig?.showCodex !== false ? `<span>Codex: ${escapeHtml(status.codexStatus || "Unknown")}</span>` : ""}
        <span class="task-routing-pill task-routing-${escapeAttr(taskWeight)}">
          Task Routing: ${escapeHtml(taskWeight)}
        </span>
      </div>

      ${
        activity.length
          ? `<ul class="activity-list">${activity.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
          : ""
      }
    </article>
  `;
}

function renderClaudeDirectUsage(usage) {
  if (!usage && dashboardState.isTokenLoading) {
    return "";
  }

  const safeUsage = usage || {
    status: "no-data",
    today: normalizeUsageSummary(),
    sevenDays: normalizeUsageSummary(),
    sources: [],
    lastMeasuredAt: new Date().toISOString(),
    errors: [],
  };
  const hasUsage = safeUsage.status === "measured" && safeUsage.sevenDays.eventCount > 0;
  const sourceText = safeUsage.sources.length ? safeUsage.sources.join(", ") : "No Claude API, CLI, or Cowork usage events found";

  return `
    <article class="panel token-panel claude-direct-panel">
      <div class="panel-heading">
        <div>
          <p class="eyebrow">Direct Usage</p>
          <h2>Claude Direct</h2>
          <p class="panel-caption">Claude API, Claude CLI, and Cowork usage measured from local metadata logs.</p>
        </div>
        <span class="status-pill ${hasUsage ? "status-ok" : "status-neutral"}">${hasUsage ? "Measured" : "No data"}</span>
      </div>
      <div class="usage-window-list">
        ${renderClaudeUsageWindow("Today", safeUsage.today)}
        ${renderClaudeUsageWindow("7Days", safeUsage.sevenDays)}
      </div>
      <div class="usage-source-row" title="${escapeAttr(sourceText)}">
        <span>Sources</span>
        <strong>${escapeHtml(sourceText)}</strong>
      </div>
      <div class="usage-source-row">
        <span>Last used</span>
        <strong>${safeUsage.lastUsedAt ? escapeHtml(formatDateTime(safeUsage.lastUsedAt)) : "Waiting for Claude usage data"}</strong>
      </div>
      ${
        safeUsage.errors?.length
          ? `<ul class="activity-list">${safeUsage.errors.slice(0, 3).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
          : ""
      }
    </article>
  `;
}

function renderClaudeUsageWindow(label, summary) {
  return `
    <div class="usage-window">
      <div>
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(formatTokenCount(summary.totalTokens))}</strong>
      </div>
      <p>${escapeHtml(formatTokenBreakdown(summary))}</p>
    </div>
  `;
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
  const localProgramName = stringValue(localComputeStatus.programName) || "Offline";
  const sectionStates = normalizeSectionStates(dashboardState.sectionStates);

  return `
    <article class="panel token-panel local-compute-panel">
      <div class="panel-heading">
        <div>
          <p class="eyebrow">Local Compute</p>
          <h2>Local LLM</h2>
        </div>
        <span class="status-pill ${statusClass(status.llmStatus || localProgramName)}">${escapeHtml(localProgramName)}</span>
      </div>

      <details class="token-section" data-section="localLlm" ${sectionStates.localLlm ? "open" : ""}>
        <summary>GPU Capacity <span>${escapeHtml(status.llmStatus || "Unknown")}</span></summary>
        <div class="capacity-groups">
          ${
            localComputeStatus.gpus?.length
              ? localComputeStatus.gpus.map((gpu) =>
                  renderCapacityGroup(`GPU ${gpu.id}: ${gpu.name}`, [
                    buildHardwareMetric(
                      "GPU",
                      gpu.utilizationPercentage,
                      100,
                      "%",
                      `${gpu.powerDrawW}W / ${gpu.powerLimitW}W`
                    ),
                    buildHardwareMetric(
                      "VRAM",
                      gpu.vramUsedMb,
                      gpu.vramTotalMb,
                      "MB"
                    ),
                  ])
                ).join("")
              : renderCapacityGroup("Offline", [
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
  const entries = [
    capacitySummaryEntry("Gemini 5Hours", status.antigravityPercentage, status.antigravityTokensLeft, status.antigravityMax),
    capacitySummaryEntry("Gemini Weekly", status.antigravityWeeklyPercentage, status.antigravityWeeklyTokensLeft, status.antigravityWeeklyMax),
    capacitySummaryEntry("Opus 5Hours", status.opusPercentage, status.opusTokensLeft, status.opusMax),
    capacitySummaryEntry("Opus Weekly", status.opusWeeklyPercentage, status.opusWeeklyTokensLeft, status.opusWeeklyMax),
    capacitySummaryEntry("ChatGPT 5Hours", status.codexPercentage, status.codexTokensLeft, status.codexMax),
    capacitySummaryEntry("ChatGPT Weekly", status.codexWeeklyPercentage, status.codexWeeklyTokensLeft, status.codexWeeklyMax),
  ].filter(Boolean);

  if (!entries.length) {
    return "";
  }

  const sorted = entries.slice().sort((a, b) => a.percentage - b.percentage);
  const lowest = sorted[0];
  const strongest = sorted[sorted.length - 1];

  return `
    <div class="capacity-summary" title="${escapeAttr("Higher remaining quota is better. Healthy: over 35%. Caution: 15-35%. Limited: 15% or lower.")}">
      <span><strong>Best</strong> ${escapeHtml(strongest.label)} ${strongest.percentage.toFixed(0)}%</span>
      <span class="summary-${escapeAttr(capacityTone(lowest.percentage))}"><strong>Lowest</strong> ${escapeHtml(lowest.label)} ${lowest.percentage.toFixed(0)}%</span>
    </div>
  `;
}

function capacitySummaryEntry(label, exactPercentage, left, max) {
  let percentage;
  if (typeof exactPercentage === "number" && Number.isFinite(exactPercentage)) {
    percentage = clamp(exactPercentage, 0, 100);
  } else {
    const safeLeft = toFiniteNumber(left);
    const safeMax = toFiniteNumber(max);
    if (safeMax > 0) {
      percentage = clamp((safeLeft / safeMax) * 100, 0, 100);
    }
  }

  return typeof percentage === "number" ? { label, percentage } : undefined;
}

function renderTokenPanelStatus(status) {
  const visibleStatuses = [];
  if (dashboardState.viewConfig?.showCodex !== false && status.codexStatus) visibleStatuses.push(status.codexStatus);
  const pillStatus = visibleStatuses[0] || "Unknown";
  const isRefreshing = dashboardState.isLoading || dashboardState.isTokenLoading;
  const refreshingClass = isRefreshing ? " status-refreshing" : "";
  const label = isRefreshing
    ? `Refreshing ${formatElapsed(dashboardState.refreshStartedAt)}`
    : pillStatus;
  const title = isRefreshing
    ? `Showing previous data. Last fresh update: ${formatDateTime(dashboardState.updatedAt)}.`
    : `Current status: ${pillStatus}.`;

  return `<span class="status-pill ${statusClass(pillStatus)}${refreshingClass}" title="${escapeAttr(title)}">${escapeHtml(label)}</span>`;
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

function buildTokenMetric(label, status, prefix, ariaLabel) {
  const left = toFiniteNumber(status[`${prefix}TokensLeft`]);
  const max = toFiniteNumber(status[`${prefix}Max`]);
  const exactPercentage = status[`${prefix}Percentage`];
  const estimated = status[`${prefix}EstimatedAbsolute`];
  const rawResetTime = status[`${prefix}ResetTime`];

  let percentage;
  if (typeof exactPercentage === "number" && Number.isFinite(exactPercentage)) {
    percentage = clamp(exactPercentage, 0, 100);
  } else if (max > 0) {
    percentage = clamp((left / max) * 100, 0, 100);
  }

  const hasAbsolute = typeof estimated === "number" || max > 0 || left > 0;
  const normalizedPercentage = percentage ?? 0;
  
  const displayPercentage = typeof exactPercentage === "number" ? exactPercentage : normalizedPercentage;
  const mainText = (hasAbsolute || percentage !== undefined) ? `${displayPercentage.toFixed(2)}%` : "Unavailable";
  
  let subtext = "Waiting for quota data";
  if (hasAbsolute || percentage !== undefined) {
    subtext = `${normalizedPercentage.toFixed(2)}% remaining`;
  }

  const refreshText = formatRefreshCountdown(rawResetTime);
  const tooltip = `${ariaLabel || label}: ${subtext}${refreshText ? ` ${refreshText}` : ""}. Healthy: over 35%. Caution: 15-35%. Limited: 15% or lower.`;

  return {
    label,
    ariaLabel: ariaLabel || label,
    mainText,
    subtext,
    refreshText,
    percentage: normalizedPercentage,
    unavailable: percentage === undefined && !hasAbsolute,
    tone: capacityTone(normalizedPercentage),
    tooltip,
  };
}

function renderCapacityGroup(title, metrics) {
  return `
    <div class="capacity-group">
      <h3>${escapeHtml(title)}</h3>
      <div class="capacity-row-list">
        ${metrics.map(renderCapacityMetric).join("")}
      </div>
    </div>
  `;
}

function renderCapacityMetric(metric) {
  return `
    <div class="capacity-metric-row token-metric ${metric.tone} ${metric.unavailable ? "unavailable" : ""}" title="${escapeAttr(metric.tooltip || "")}">
      <div class="metric-reset-row">
        <span class="capacity-metric-label">${escapeHtml(metric.label)}</span>
        <span class="reset-left">${escapeHtml(metric.subtext)}</span>
        <span class="reset-right">${metric.refreshText ? escapeHtml(metric.refreshText) : ""}</span>
      </div>
      <div class="progress-track" aria-label="${escapeHtml(metric.ariaLabel)} usage">
        <div class="progress-fill" data-progress="${escapeAttr(metric.percentage.toFixed(1))}"></div>
      </div>
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
  const subtext = hasMetric
    ? isPercentMetric
      ? `${percentage.toFixed(0)}% current load`
      : `${percentage.toFixed(1)}% used`
    : "Waiting for hardware data";
  const tone = percentage >= 90 ? "critical" : percentage >= 75 ? "warning" : "healthy";
  const tooltip = `${label}: ${subtext}${extraRightText ? ` ${extraRightText}` : ""}. Healthy: under 75%. Caution: 75-89%. Limited: 90% or higher.`;

  return {
    label,
    ariaLabel: label,
    mainText,
    subtext,
    refreshText: extraRightText,
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
  const header = lines[0].split(',').map(c => escapeHtml(c));
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
            ${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}
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
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function clamp(value, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(Math.max(number, min), max) : min;
}

function capacityTone(percentage) {
  return percentage <= 15 ? "critical" : percentage <= 35 ? "warning" : "healthy";
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
  return new Intl.NumberFormat().format(toFiniteNumber(value));
}

function formatTokenCount(value) {
  const number = toFiniteNumber(value);
  if (number >= 1_000_000) {
    return `${(number / 1_000_000).toFixed(number >= 10_000_000 ? 1 : 2)}M tokens`;
  }
  if (number >= 1_000) {
    return `${(number / 1_000).toFixed(number >= 10_000 ? 1 : 2)}K tokens`;
  }
  return `${formatNumber(number)} tokens`;
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
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  const diffHours = (date.getTime() - Date.now()) / (1000 * 60 * 60);
  if (diffHours > 24) {
    return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  }
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
}

function formatRefreshCountdown(value) {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  
  const diffMs = date.getTime() - Date.now();
  if (diffMs <= 0) return "Refreshes soon";
  
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  
  if (diffHours > 0) return `\u00B7 Refreshes in ${diffHours}h ${diffMins}m`;
  return `\u00B7 Refreshes in ${diffMins}m`;
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
