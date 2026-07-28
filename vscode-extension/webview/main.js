const vscode = typeof acquireVsCodeApi === "function" ? acquireVsCodeApi() : undefined;

let dashboardState = emptyState();

const root = document.getElementById("app") || document.body;

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
    dashboardState = {
      ...dashboardState,
      isLoading: Boolean(message.isLoading ?? dashboardState.isLoading),
      isTokenLoading: Boolean(message.isTokenLoading ?? dashboardState.isTokenLoading),
    };
    render();
    return;
  }

  if (message.type === "error") {
    dashboardState = {
      ...dashboardState,
      systemErrors: [String(message.message || "Unknown error"), ...dashboardState.systemErrors].slice(0, 50),
      isLoading: false,
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
    recommendedTaskWeight: normalizeTaskWeight(status.recommendedTaskWeight),
    activity: stringArray(status.activity),
  };
}

function render() {
  root.innerHTML = `
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
          <button type="button" data-command="refresh">Refresh</button>
          <button type="button" data-command="openRunsFile">Open Runs</button>
        </div>
      </header>

      ${dashboardState.isLoading ? renderLoadingStrip() : ""}

      <section class="dashboard-grid">
        ${renderTokenStatus(dashboardState.tokenStatus)}
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
}

function renderLoadingStrip() {
  return `
    <div class="loading-strip" role="status" aria-live="polite">
      <span class="spinner"></span>
      <span>Refreshing dashboard</span>
    </div>
  `;
}

function renderTokenStatus(tokenStatus) {
  if (!tokenStatus && dashboardState.isTokenLoading) {
    return renderTokenSkeleton();
  }

  const status = tokenStatus || {};
  const antigravity = buildTokenMetric("Gemini 3.1 Pro (5Hours)", status, "antigravity");
  const antigravityWeekly = buildTokenMetric("Gemini 3.1 Pro (Weekly)", status, "antigravityWeekly");
  const opus = buildTokenMetric("Opus 4.6 Thinking (5Hours)", status, "opus");
  const opusWeekly = buildTokenMetric("Opus 4.6 Thinking (Weekly)", status, "opusWeekly");
  const codex = buildTokenMetric("Codex (5Hours)", status, "codex");
  const codexWeekly = buildTokenMetric("Codex (Weekly)", status, "codexWeekly");
  const localComputeStatus = status.localComputeStatus || {};
  const localProgramName = stringValue(localComputeStatus.programName) || "Offline";
  const sectionStates = normalizeSectionStates(dashboardState.sectionStates);
  const taskWeight = normalizeTaskWeight(status.recommendedTaskWeight);
  const activity = Array.isArray(status.activity) ? status.activity.slice(0, 4) : [];

  const sections = [];

  if (dashboardState.viewConfig?.showAntigravity !== false) {
    sections.push(`
      <details class="token-section" data-section="antigravity" ${sectionStates.antigravity ? "open" : ""}>
        <summary>Antigravity IDE</summary>
        <div class="token-metrics">
          ${renderTokenMetric(antigravity)}
          ${renderTokenMetric(antigravityWeekly)}
          ${renderTokenMetric(opus)}
          ${renderTokenMetric(opusWeekly)}
        </div>
      </details>
    `);
  }

  if (dashboardState.viewConfig?.showCodex !== false) {
    sections.push(`
      <details class="token-section" data-section="codex" ${sectionStates.codex ? "open" : ""}>
        <summary>Codex</summary>
        <div class="token-metrics">
          ${renderTokenMetric(codex)}
          ${renderTokenMetric(codexWeekly)}
        </div>
      </details>
    `);
  }

  if (dashboardState.viewConfig?.showLocalLlm !== false) {
    sections.push(`
      <details class="token-section" data-section="localLlm" ${sectionStates.localLlm ? "open" : ""}>
        <summary>Local LLM <span>${escapeHtml(localProgramName)}</span></summary>
        <div class="token-metrics-container">
          ${
            localComputeStatus.gpus?.length 
            ? localComputeStatus.gpus.map(gpu => `
                <div class="gpu-block">
                  <div class="gpu-header">GPU ${gpu.id}: ${escapeHtml(gpu.name)}</div>
                  <div class="token-metrics">
                    ${renderHardwareMetric(
                      "GPU Utilization",
                      gpu.utilizationPercentage,
                      100,
                      "%",
                      `${gpu.powerDrawW}W / ${gpu.powerLimitW}W`
                    )}
                    ${renderHardwareMetric(
                      "VRAM Usage",
                      gpu.vramUsedMb,
                      gpu.vramTotalMb,
                      "MB"
                    )}
                  </div>
                </div>
              `).join('<hr class="section-divider" />')
            : `
              <div class="token-metrics">
                ${renderHardwareMetric("GPU Utilization", null, 100, "%")}
                ${renderHardwareMetric("VRAM Usage", null, null, "MB")}
              </div>
            `
          }
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
        ${dashboardState.isTokenLoading
          ? `<span class="status-pill status-warning">Loading</span>`
          : (() => {
              const visibleStatuses = [];
              if (dashboardState.viewConfig?.showCodex !== false && status.codexStatus) visibleStatuses.push(status.codexStatus);
              if (dashboardState.viewConfig?.showLocalLlm !== false && status.llmStatus) visibleStatuses.push(status.llmStatus);
              const pillStatus = visibleStatuses[0] || "Unknown";
              return `<span class="status-pill ${statusClass(pillStatus)}">${escapeHtml(pillStatus)}</span>`;
            })()}
      </div>

      ${sections.join('\n      <hr class="section-divider" />\n')}

      <div class="token-footer">
        ${dashboardState.viewConfig?.showCodex !== false ? `<span>Codex: ${escapeHtml(status.codexStatus || "Unknown")}</span>` : ""}
        <span class="task-routing-pill task-routing-${escapeAttr(taskWeight)}">
          Task Routing: ${escapeHtml(taskWeight)}
        </span>
        ${dashboardState.viewConfig?.showLocalLlm !== false && status.llmStatus ? `<span>Local LLM: ${escapeHtml(status.llmStatus)}</span>` : ""}
      </div>

      ${
        activity.length
          ? `<ul class="activity-list">${activity.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
          : ""
      }
    </article>
  `;
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

function buildTokenMetric(label, status, prefix, secondaryResetTime) {
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

  return {
    label,
    mainText,
    subtext,
    refreshText,
    percentage: normalizedPercentage,
    unavailable: percentage === undefined && !hasAbsolute,
    tone: normalizedPercentage <= 15 ? "critical" : normalizedPercentage <= 35 ? "warning" : "healthy",
  };
}

function renderTokenMetric(metric) {
  return `
    <div class="token-metric ${metric.tone} ${metric.unavailable ? "unavailable" : ""}">
      <div class="metric-row">
        <span>${escapeHtml(metric.label)}</span>
        <strong>${escapeHtml(metric.mainText)}</strong>
      </div>
      <div class="progress-track" aria-label="${escapeHtml(metric.label)} usage">
        <div class="progress-fill" data-progress="${escapeAttr(metric.percentage.toFixed(1))}"></div>
      </div>
      <div class="metric-reset-row">
        <span class="reset-left">${escapeHtml(metric.subtext)}</span>
        <span class="reset-right">${metric.refreshText ? escapeHtml(metric.refreshText) : ""}</span>
      </div>
    </div>
  `;
}

function renderHardwareMetric(label, used, total, unit, extraRightText = "") {
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

  return renderTokenMetric({
    label,
    mainText,
    subtext,
    refreshText: extraRightText,
    percentage,
    unavailable: !hasMetric,
    tone,
  });
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
  const combined = [...(systemErrors || []), ...(parseErrors || [])];
  return `
    <article class="panel list-panel errors-panel">
      <div class="panel-heading">
        <h2>Errors</h2>
        <span class="count-badge">${combined.length}</span>
      </div>
      ${
        combined.length
          ? `<ul class="error-list">${combined.slice(0, 8).map((error) => `<li>${escapeHtml(error)}</li>`).join("")}</ul>`
          : `<p class="empty-state">No errors.</p>`
      }
    </article>
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
    };
    render();
  }

  vscode.postMessage({ type: command });
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
  return ["heavy", "light", "restricted", "unknown"].includes(value) ? value : "unknown";
}

function toFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function clamp(value, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(Math.max(number, min), max) : min;
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
