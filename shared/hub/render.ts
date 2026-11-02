/**
 * Pure, clean, XSS-safe HTML renderers for Hub Ecosystem Matrix,
 * Hub Todo Items (with Clarification & Dispatch actions), and Category Playbooks.
 *
 * Free of DOM and Node dependencies. Safe for webviews, dashboards, and static export.
 */

import {
  EcosystemSnapshot,
  EcosystemConnectorStatus,
  HubTodoItem,
  CategoryPlaybook,
  LifeDomain,
  PrivacyTier,
  HubTodoStatus,
  ConnectorState,
} from "./types";

/**
 * Escapes characters that could lead to HTML injection or XSS vulnerabilities.
 */
export function escapeHtml(str: unknown): string {
  if (str === null || str === undefined) {
    return "";
  }
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Returns human-readable Korean label and badge styling for Life Domains.
 */
export function getDomainBadgeInfo(domain: LifeDomain): { label: string; colorStyle: string } {
  switch (domain) {
    case "private":
      return {
        label: "Private (건강·세무)",
        colorStyle: "background:#3f1414; color:#fca5a5; border:1px solid #7f1d1d;",
      };
    case "relations":
      return {
        label: "Relations (가족·관계)",
        colorStyle: "background:#3b1130; color:#f472b6; border:1px solid #831843;",
      };
    case "incubate":
      return {
        label: "Incubate (수익·사이드)",
        colorStyle: "background:#3a200a; color:#fcd34d; border:1px solid #78350f;",
      };
    case "collab":
      return {
        label: "Collab (협업·외부)",
        colorStyle: "background:#0f2744; color:#93c5fd; border:1px solid #1e3a8a;",
      };
    case "core":
    default:
      return {
        label: "Core (일상·기본)",
        colorStyle: "background:#22262e; color:#cbd5e1; border:1px solid #475569;",
      };
  }
}

/**
 * Returns human-readable Korean label and badge styling for Privacy Tiers.
 */
export function getPrivacyTierBadgeInfo(tier: PrivacyTier): { label: string; icon: string; colorStyle: string } {
  switch (tier) {
    case "strictly_local":
      return {
        label: "로컬전용 격리 (Strictly Local)",
        icon: "🔒",
        colorStyle: "background:#1c2d1c; color:#86efac; border:1px solid #166534;",
      };
    case "redacted_cloud":
      return {
        label: "가명화 전송 (Redacted Cloud)",
        icon: "🛡️",
        colorStyle: "background:#312615; color:#fde047; border:1px solid #854d0e;",
      };
    case "private_cloud":
      return {
        label: "비공개 클라우드 (Private Cloud)",
        icon: "☁️",
        colorStyle: "background:#1e293b; color:#94a3b8; border:1px solid #334155;",
      };
    case "workspace_scoped":
    default:
      return {
        label: "워크스페이스 공유 (Workspace Scoped)",
        icon: "👥",
        colorStyle: "background:#172554; color:#bfdbfe; border:1px solid #1d4ed8;",
      };
  }
}

/**
 * Returns state indicator label and color for Ecosystem Connectors.
 */
export function getConnectorStateInfo(state: ConnectorState): { label: string; colorStyle: string; icon: string } {
  switch (state) {
    case "ready":
      return {
        label: "연결 준비 완료",
        colorStyle: "background:#14532d; color:#86efac; border:1px solid #22c55e;",
        icon: "🟢",
      };
    case "installed_offline":
      return {
        label: "설치됨 (대기/오프라인)",
        colorStyle: "background:#713f12; color:#fde047; border:1px solid #eab308;",
        icon: "🟡",
      };
    case "installed_unconfigured":
      return {
        label: "설치됨 (설정 필요)",
        colorStyle: "background:#78350f; color:#fed7aa; border:1px solid #f97316;",
        icon: "🟠",
      };
    case "not_installed":
    default:
      return {
        label: "미설치 (선택 사양)",
        colorStyle: "background:#27272a; color:#a1a1aa; border:1px solid #3f3f46;",
        icon: "⚪",
      };
  }
}

/**
 * Renders the Ecosystem Connectors & Obsidian Vault Discovery matrix as compact cards.
 */
export function renderEcosystemMatrixHtml(ecosystem: EcosystemSnapshot): string {
  const scannedTime = ecosystem.scannedAt ? new Date(ecosystem.scannedAt).toLocaleString() : "미스캔";

  let html = `
<div class="hub-ecosystem-matrix" style="display:flex; flex-direction:column; gap:16px; font-family:sans-serif; color:#e2e8f0;">
  <div class="hub-ecosystem-header" style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #334155; padding-bottom:8px;">
    <div>
      <span style="font-weight:700; font-size:15px; color:#f8fafc;">📡 통합 관제 생태계 커넥터 현황</span>
      <span style="font-size:12px; color:#94a3b8; margin-left:8px;">(${escapeHtml(ecosystem.platform)} / 스캔: ${escapeHtml(scannedTime)})</span>
    </div>
    <div style="font-size:12px; color:#94a3b8;">
      활성 Todo: <code style="background:#1e293b; padding:2px 6px; border-radius:4px; color:#38bdf8;">${escapeHtml(ecosystem.activeTodoFilePath || "기본 저장소")}</code>
    </div>
  </div>`;

  // Vaults Discovery Section
  if (ecosystem.vaults && ecosystem.vaults.length > 0) {
    html += `
  <div class="hub-vaults-section" style="background:#0f172a; border:1px solid #1e293b; border-radius:6px; padding:10px 14px;">
    <div style="font-size:13px; font-weight:600; color:#38bdf8; margin-bottom:6px;">🗂️ 감지된 옵시디언 볼트 (${ecosystem.vaults.length}개)</div>
    <div style="display:flex; flex-direction:column; gap:6px;">`;

    for (const vault of ecosystem.vaults) {
      const pluginSummary = vault.installedPlugins.length > 0
        ? `플러그인: ${vault.installedPlugins.join(", ")}`
        : "설치된 플러그인 없음";

      html += `
      <div style="display:flex; justify-content:space-between; align-items:center; background:#1e293b; padding:6px 10px; border-radius:4px; font-size:12px;">
        <div>
          <span style="font-weight:600; color:#f1f5f9;">${escapeHtml(vault.name)}</span>
          <span style="color:#64748b; margin-left:6px;">(${escapeHtml(vault.source)})</span>
          <span style="color:#94a3b8; margin-left:8px;">${escapeHtml(pluginSummary)}</span>
        </div>
        <div style="color:#64748b; font-family:monospace; font-size:11px;">${escapeHtml(vault.path)}</div>
      </div>`;
    }

    html += `
    </div>
  </div>`;
  }

  // Connectors Grid
  if (!ecosystem.connectors || ecosystem.connectors.length === 0) {
    html += `
  <div style="padding:16px; text-align:center; color:#64748b; font-size:13px;">
    감지된 커넥터 정보가 없습니다.
  </div>`;
  } else {
    html += `
  <div class="hub-connectors-grid" style="display:grid; grid-template-columns:repeat(auto-fill, minmax(310px, 1fr)); gap:12px;">`;

    for (const c of ecosystem.connectors) {
      const stateInfo = getConnectorStateInfo(c.state);
      const protocolBadge = c.protocol.toUpperCase();

      html += `
    <div class="hub-connector-card" style="background:#0f172a; border:1px solid #1e293b; border-radius:6px; padding:12px; display:flex; flex-direction:column; justify-content:space-between; gap:8px;">
      <div>
        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:6px;">
          <div>
            <span style="font-weight:600; font-size:13px; color:#f8fafc;">${escapeHtml(c.label)}</span>
            <span style="font-size:11px; margin-left:6px; padding:2px 5px; border-radius:3px; background:#1e293b; color:#94a3b8; border:1px solid #334155;">${escapeHtml(protocolBadge)}</span>
          </div>
          <span style="font-size:11px; padding:2px 8px; border-radius:12px; ${stateInfo.colorStyle}">
            ${stateInfo.icon} ${escapeHtml(stateInfo.label)}
          </span>
        </div>
        <div style="font-size:12px; color:#94a3b8; line-height:1.4;">
          ${escapeHtml(c.details || "표준 프로토콜 인터페이스")}
        </div>
      </div>
      <div>`;

      if (c.endpoint) {
        html += `
        <div style="font-size:11px; color:#64748b; font-family:monospace; margin-top:4px;">
          엔드포인트: ${escapeHtml(c.endpoint)}
        </div>`;
      }

      if (c.installHint && c.state !== "ready") {
        html += `
        <div style="font-size:11px; color:#eab308; background:#422006; border:1px solid #713f12; padding:4px 8px; border-radius:4px; margin-top:6px;">
          💡 설치 안내: ${escapeHtml(c.installHint)}
        </div>`;
      }

      html += `
      </div>
    </div>`;
    }

    html += `
  </div>`;
  }

  html += `
</div>`;
  return html;
}

/**
 * Returns human-readable label and status prefix for Hub Todo Items.
 */
export function getTodoStatusInfo(status: HubTodoStatus): { marker: string; label: string; badgeStyle: string } {
  switch (status) {
    case "needs_clarification":
      return {
        marker: "[?]",
        label: "모호성 질문 대기",
        badgeStyle: "background:#451a03; color:#fde047; border:1px solid #ca8a04;",
      };
    case "ready":
      return {
        marker: "[ ]",
        label: "배당 준비 완료",
        badgeStyle: "background:#052e16; color:#86efac; border:1px solid #16a34a;",
      };
    case "in_progress":
      return {
        marker: "[/]",
        label: "진행 중",
        badgeStyle: "background:#172554; color:#93c5fd; border:1px solid #2563eb;",
      };
    case "awaiting_approval":
      return {
        marker: "[!]",
        label: "사용자 승인 대기",
        badgeStyle: "background:#4c0519; color:#fda4af; border:1px solid #e11d48;",
      };
    case "done":
    default:
      return {
        marker: "[x]",
        label: "완료",
        badgeStyle: "background:#1e293b; color:#94a3b8; border:1px solid #475569;",
      };
  }
}

/**
 * Renders the Hub Todo List HTML with domain badges, privacy tiers,
 * inline clarification forms, and dispatch triggers.
 */
export function renderHubTodoListHtml(todos: HubTodoItem[]): string {
  if (!todos || todos.length === 0) {
    return `
<div class="hub-todo-empty" style="padding:24px; text-align:center; color:#64748b; font-size:13px; font-family:sans-serif; background:#0f172a; border:1px solid #1e293b; border-radius:6px;">
  현재 등록된 Hub Todo 항목이 없습니다.
</div>`;
  }

  let html = `
<div class="hub-todo-container" style="display:flex; flex-direction:column; gap:12px; font-family:sans-serif; color:#e2e8f0;">`;

  for (const todo of todos) {
    const statusInfo = getTodoStatusInfo(todo.status);
    const domainInfo = getDomainBadgeInfo(todo.domain);
    const privacyInfo = getPrivacyTierBadgeInfo(todo.privacyTier);

    html += `
  <div class="hub-todo-card" data-todo-id="${escapeHtml(todo.id)}" style="background:#0f172a; border:1px solid #1e293b; border-radius:6px; padding:14px; display:flex; flex-direction:column; gap:10px;">
    <!-- Card Header -->
    <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:8px;">
      <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
        <span style="font-family:monospace; font-weight:700; font-size:14px; color:#38bdf8;">${statusInfo.marker}</span>
        <span style="font-size:11px; padding:2px 8px; border-radius:12px; ${statusInfo.badgeStyle}">${escapeHtml(statusInfo.label)}</span>
        <span style="font-size:11px; padding:2px 8px; border-radius:12px; ${domainInfo.colorStyle}">${escapeHtml(domainInfo.label)}</span>
        <span style="font-size:11px; padding:2px 8px; border-radius:12px; ${privacyInfo.colorStyle}">${privacyInfo.icon} ${escapeHtml(privacyInfo.label)}</span>
        ${todo.allowManualCredit ? `<span style="font-size:11px; padding:2px 6px; border-radius:12px; background:#431407; color:#fdba74; border:1px solid #c2410c;">#agya (수동기여 승인)</span>` : ""}
      </div>
      <div style="font-size:11px; color:#64748b;">
        모호성: <strong style="color:${todo.ambiguityScore >= 0.4 ? "#f87171" : "#4ade80"};">${todo.ambiguityScore}</strong> | 긴급도: ${todo.urgencyScore}
      </div>
    </div>

    <!-- Title & Raw text -->
    <div>
      <div style="font-size:14px; font-weight:600; color:#f8fafc; margin-bottom:4px;">
        ${escapeHtml(todo.title)}
      </div>
      ${todo.rawText !== todo.title ? `<div style="font-size:12px; color:#94a3b8; white-space:pre-wrap; background:#1e293b; padding:6px 10px; border-radius:4px;">${escapeHtml(todo.rawText)}</div>` : ""}
    </div>`;

    // Action Section depending on status
    if (todo.status === "needs_clarification") {
      html += `
    <!-- Clarification Questions Section -->
    <div class="hub-clarification-box" style="background:#1a150b; border:1px solid #854d0e; border-radius:6px; padding:12px; margin-top:4px;">
      <div style="font-size:12px; font-weight:600; color:#fde047; margin-bottom:8px;">
        ❓ 자율 대행을 위해 세부 조건 확인이 필요합니다:
      </div>
      <div style="display:flex; flex-direction:column; gap:10px;">`;

      for (let i = 0; i < todo.clarificationQuestions.length; i++) {
        const q = todo.clarificationQuestions[i];
        const isAnswered = q.answer && q.answer.trim().length > 0;

        html += `
        <div class="hub-clarification-item" style="font-size:12px;">
          <div style="color:#f1f5f9; margin-bottom:4px;">
            <strong>Q${i + 1}.</strong> ${escapeHtml(q.question)}
          </div>`;

        if (q.options && q.options.length > 0) {
          html += `
          <div style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:6px;">`;
          for (const opt of q.options) {
            html += `
            <span style="font-size:11px; background:#292524; color:#d6d3d1; border:1px solid #44403c; padding:2px 8px; border-radius:4px;">
              ${escapeHtml(opt)}
            </span>`;
          }
          html += `
          </div>`;
        }

        if (isAnswered) {
          html += `
          <div style="background:#14532d; color:#bbf7d0; padding:4px 8px; border-radius:4px; font-size:12px;">
            ✅ 답변: ${escapeHtml(q.answer)} <span style="font-size:10px; color:#86efac; margin-left:6px;">(${escapeHtml(q.answeredAt || "")})</span>
          </div>`;
        } else {
          html += `
          <div style="display:flex; gap:6px; margin-top:4px;">
            <input type="text" class="hub-clarify-input" data-question-id="${escapeHtml(q.id)}" placeholder="세부 내용을 입력하세요..." style="flex:1; background:#0f172a; border:1px solid #475569; color:#f8fafc; padding:6px 10px; border-radius:4px; font-size:12px;" />
          </div>`;
        }

        html += `
        </div>`;
      }

      html += `
      </div>
      <div style="margin-top:12px; display:flex; justify-content:flex-end;">
        <button class="hub-btn-clarify" data-hub-clarify-id="${escapeHtml(todo.id)}" style="background:#ca8a04; color:#0f172a; font-weight:600; border:none; padding:6px 14px; border-radius:4px; cursor:pointer; font-size:12px;">
          질문 답변 저장 및 자율 배당 재평가
        </button>
      </div>
    </div>`;
    } else if (todo.status === "ready") {
      html += `
    <!-- Dispatch Action Section -->
    <div style="display:flex; justify-content:space-between; align-items:center; background:#052e16; border:1px solid #166534; padding:8px 12px; border-radius:4px;">
      <span style="font-size:12px; color:#86efac;">
        요건이 명확합니다. 최적 하네스로 자율 배당할 수 있습니다.
      </span>
      <button class="hub-btn-dispatch" data-hub-dispatch-id="${escapeHtml(todo.id)}" style="background:#22c55e; color:#052e16; font-weight:700; border:none; padding:6px 14px; border-radius:4px; cursor:pointer; font-size:12px;">
        🚀 브로커 자동 배당 실행
      </button>
    </div>`;
    } else if (todo.status === "in_progress") {
      html += `
    <!-- In Progress Section -->
    <div style="display:flex; justify-content:space-between; align-items:center; background:#172554; border:1px solid #1e40af; padding:8px 12px; border-radius:4px;">
      <span style="font-size:12px; color:#bfdbfe;">
        ⚡ 실행 중인 경로: <strong style="color:#60a5fa;">${escapeHtml(todo.assignedRoute || "자동 라우팅")}</strong>
        ${todo.linkedBrokerTaskId ? `(Task ID: <code>${escapeHtml(todo.linkedBrokerTaskId)}</code>)` : ""}
      </span>
      <span style="font-size:11px; color:#93c5fd;">실행 로그 모니터링 중...</span>
    </div>`;
    } else if (todo.status === "awaiting_approval") {
      html += `
    <!-- Approval Section -->
    <div style="display:flex; justify-content:space-between; align-items:center; background:#4c0519; border:1px solid #9f1239; padding:8px 12px; border-radius:4px;">
      <span style="font-size:12px; color:#fecdd3;">
        작업이 완료 전 사용자 최종 확인/승인을 대기하고 있습니다.
      </span>
      <button class="hub-btn-approve" data-hub-approve-id="${escapeHtml(todo.id)}" style="background:#f43f5e; color:#ffffff; font-weight:700; border:none; padding:6px 14px; border-radius:4px; cursor:pointer; font-size:12px;">
        승인 완료 처리
      </button>
    </div>`;
    } else if (todo.status === "done") {
      html += `
    <div style="font-size:12px; color:#64748b; text-align:right;">
      완료 일시: ${escapeHtml(todo.updatedAt || todo.createdAt)}
    </div>`;
    }

    html += `
  </div>`;
  }

  html += `
</div>`;
  return html;
}

/**
 * Renders Category Playbooks with Episodic, Semantic, and Procedural memory lists.
 */
export function renderPlaybooksHtml(playbooks: CategoryPlaybook[]): string {
  if (!playbooks || playbooks.length === 0) {
    return `
<div class="hub-playbooks-empty" style="padding:20px; text-align:center; color:#64748b; font-size:13px; font-family:sans-serif; background:#0f172a; border:1px solid #1e293b; border-radius:6px;">
  등록된 카테고리 플레이북이 없습니다. 작업이 완료될 때마다 선호와 규칙이 축적됩니다.
</div>`;
  }

  let html = `
<div class="hub-playbooks-container" style="display:flex; flex-direction:column; gap:14px; font-family:sans-serif; color:#e2e8f0;">`;

  for (const pb of playbooks) {
    const updated = pb.updatedAt ? new Date(pb.updatedAt).toLocaleDateString() : "-";

    html += `
  <div class="hub-playbook-card" style="background:#0f172a; border:1px solid #1e293b; border-radius:6px; padding:14px;">
    <!-- Header -->
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; border-bottom:1px solid #1e293b; padding-bottom:8px;">
      <div>
        <span style="font-weight:700; font-size:14px; color:#f8fafc;">📘 ${escapeHtml(pb.label)}</span>
        <span style="font-size:12px; color:#64748b; margin-left:6px;">(${escapeHtml(pb.category)})</span>
      </div>
      <div style="display:flex; align-items:center; gap:8px;">
        <span style="font-size:11px; color:#64748b;">업데이트: ${escapeHtml(updated)}</span>
        <button class="hub-btn-add-rule" data-hub-playbook-category="${escapeHtml(pb.category)}" style="background:#1e293b; border:1px solid #334155; color:#cbd5e1; font-size:11px; padding:3px 8px; border-radius:4px; cursor:pointer;">
          + 규칙 추가
        </button>
      </div>
    </div>

    <!-- Memory Sections Grid -->
    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(260px, 1fr)); gap:10px;">
      <!-- Procedural Rules -->
      <div style="background:#1e293b; border-radius:4px; padding:10px;">
        <div style="font-size:12px; font-weight:600; color:#38bdf8; margin-bottom:6px;">⚡ 절차 규칙 (Procedural)</div>`;

    if (!pb.procedural || pb.procedural.length === 0) {
      html += `<div style="font-size:11px; color:#64748b;">등록된 규칙 없음</div>`;
    } else {
      html += `<ul style="margin:0; padding-left:16px; font-size:11px; color:#cbd5e1; display:flex; flex-direction:column; gap:4px;">`;
      for (const item of pb.procedural) {
        html += `<li><strong>[${escapeHtml(item.trigger)}]</strong> ${escapeHtml(item.rule)}</li>`;
      }
      html += `</ul>`;
    }

    html += `
      </div>

      <!-- Semantic Preferences -->
      <div style="background:#1e293b; border-radius:4px; padding:10px;">
        <div style="font-size:12px; font-weight:600; color:#a78bfa; margin-bottom:6px;">🧠 선호 맥락 (Semantic)</div>`;

    if (!pb.semantic || pb.semantic.length === 0) {
      html += `<div style="font-size:11px; color:#64748b;">등록된 선호 없음</div>`;
    } else {
      html += `<ul style="margin:0; padding-left:16px; font-size:11px; color:#cbd5e1; display:flex; flex-direction:column; gap:4px;">`;
      for (const item of pb.semantic) {
        html += `<li><strong>${escapeHtml(item.preference)}</strong>: ${escapeHtml(item.rationale)}</li>`;
      }
      html += `</ul>`;
    }

    html += `
      </div>

      <!-- Episodic History -->
      <div style="background:#1e293b; border-radius:4px; padding:10px;">
        <div style="font-size:12px; font-weight:600; color:#34d399; margin-bottom:6px;">📜 최근 일화 (Episodic)</div>`;

    if (!pb.episodic || pb.episodic.length === 0) {
      html += `<div style="font-size:11px; color:#64748b;">기록된 일화 없음</div>`;
    } else {
      html += `<ul style="margin:0; padding-left:16px; font-size:11px; color:#cbd5e1; display:flex; flex-direction:column; gap:4px;">`;
      for (const item of pb.episodic) {
        html += `<li>${escapeHtml(item.summary)} <span style="font-size:10px; color:#64748b;">(${escapeHtml(item.recordedAt.slice(0, 10))})</span></li>`;
      }
      html += `</ul>`;
    }

    html += `
      </div>
    </div>
  </div>`;
  }

  html += `
</div>`;
  return html;
}
