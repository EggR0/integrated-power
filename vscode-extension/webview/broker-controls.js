(function (global) {
  "use strict";

  const drafts = {
    createOpen: false,
    title: "",
    goal: "",
    originProvider: "local.openai-compatible",
    delegates: Object.create(null),
  };
  let historyOpen = false;
  const terminalTaskStatuses = new Set(["completed", "cancelled", "canceled", "failed", "merged"]);

  function element(tagName, className, text) {
    const node = document.createElement(tagName);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function button(label, action, disabled) {
    const node = element("button", "broker-action", label);
    node.type = "button";
    node.disabled = Boolean(disabled);
    node.addEventListener("click", action);
    return node;
  }

  function textField(label, multiline, value, onInput) {
    const wrapper = element("label", "broker-field");
    wrapper.appendChild(element("span", "broker-field-label", label));
    const input = element(multiline ? "textarea" : "input", "broker-input");
    if (!multiline) input.type = "text";
    input.required = true;
    input.maxLength = multiline ? 12000 : 120;
    input.setAttribute("aria-label", label);
    input.value = value || "";
    input.addEventListener("input", () => onInput(input.value));
    wrapper.appendChild(input);
    return { wrapper, input };
  }

  function providerSelect(label) {
    const wrapper = element("label", "broker-field");
    wrapper.appendChild(element("span", "broker-field-label", label));
    const select = element("select", "broker-input");
    select.setAttribute("aria-label", label);
    for (const [value, name] of [
      ["local.openai-compatible", "Local"],
      ["openai.codex.app", "Codex"],
      ["google.antigravity.ide", "Antigravity"],
    ]) {
      const option = element("option", "", name);
      option.value = value;
      select.appendChild(option);
    }
    wrapper.appendChild(select);
    return { wrapper, select };
  }

  function createTaskForm(send, disabled) {
    const details = element("details", "broker-create");
    details.open = drafts.createOpen;
    details.addEventListener("toggle", () => { drafts.createOpen = details.open; });
    details.appendChild(element("summary", "broker-summary", "New task"));
    const form = element("form", "broker-form");
    const title = textField("Task title", false, drafts.title, (value) => { drafts.title = value; });
    const goal = textField("Goal", true, drafts.goal, (value) => { drafts.goal = value; });
    const provider = providerSelect("Origin");
    title.input.setAttribute("data-broker-focus", "create-title");
    goal.input.setAttribute("data-broker-focus", "create-goal");
    provider.select.setAttribute("data-broker-focus", "create-provider");
    provider.select.value = drafts.originProvider;
    provider.select.addEventListener("change", () => { drafts.originProvider = provider.select.value; });
    form.append(title.wrapper, goal.wrapper, provider.wrapper);
    const submit = element("button", "broker-action broker-primary", "Create task");
    submit.type = "submit";
    submit.disabled = Boolean(disabled);
    form.appendChild(submit);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const taskTitle = title.input.value.trim();
      const taskGoal = goal.input.value.trim();
      if (!taskTitle || !taskGoal || submit.disabled) return;
      submit.disabled = true;
      send({ type: "createBrokerTask", title: taskTitle, goal: taskGoal, originProvider: provider.select.value });
    });
    details.appendChild(form);
    return details;
  }

  function delegateForm(task, send, disabled) {
    const draft = drafts.delegates[task.id] || (drafts.delegates[task.id] = {
      open: false, prompt: "", provider: "local.openai-compatible",
    });
    const details = element("details", "broker-delegate");
    details.open = draft.open;
    details.addEventListener("toggle", () => { draft.open = details.open; });
    details.appendChild(element("summary", "broker-summary", "Delegate"));
    const form = element("form", "broker-form");
    const prompt = textField("Delegation prompt", true, draft.prompt, (value) => { draft.prompt = value; });
    const provider = providerSelect("Provider");
    prompt.input.setAttribute("data-broker-focus", `delegate-prompt:${task.id}`);
    provider.select.setAttribute("data-broker-focus", `delegate-provider:${task.id}`);
    provider.select.value = draft.provider;
    provider.select.addEventListener("change", () => { draft.provider = provider.select.value; });
    form.append(prompt.wrapper, provider.wrapper);
    const submit = element("button", "broker-action", "Delegate");
    submit.type = "submit";
    submit.disabled = Boolean(disabled);
    form.appendChild(submit);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const value = prompt.input.value.trim();
      if (!value || submit.disabled) return;
      submit.disabled = true;
      send({
        type: "delegateBrokerTask",
        taskId: task.id,
        expectedRevision: task.revision,
        provider: provider.select.value,
        prompt: value,
      });
    });
    details.appendChild(form);
    return details;
  }

  function taskCreatedDate(value) {
    if (typeof value !== "string") return undefined;
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:T|$)/);
    if (!match) return undefined;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined;
    return { full: `${match[1]}-${match[2]}-${match[3]}`, short: `${month}/${day}` };
  }

  function renderTaskCard(task, send, writeDisabled) {
    const card = element("article", "broker-card");
    const name = typeof task.title === "string" && task.title ? task.title : task.id;
    card.appendChild(element("h3", "broker-card-title", name || "Untitled task"));
    const date = taskCreatedDate(task.createdAt);
    card.appendChild(element("p", "broker-task-state", `${task.status || "unknown"} · r${Number(task.revision) || 0}${date ? ` · ${date.full}` : ""}`));
    const goal = typeof task.goal === "string" ? task.goal : "";
    if (goal) card.appendChild(element("p", "broker-task-goal", goal));
    const actions = element("div", "broker-actions");
    if (task.status === "created" || task.status === "running" || task.status === "awaiting_approval") {
      actions.appendChild(button("Cancel", () => send({
        type: "cancelBrokerTask", taskId: task.id, expectedRevision: task.revision,
      }), writeDisabled));
    }
    if (task.status === "created" || task.status === "running") actions.appendChild(delegateForm(task, send, writeDisabled));
    card.appendChild(actions);
    return card;
  }

  function render(container, state, send) {
    const section = element("section", "broker-panel");
    const heading = element("div", "broker-heading");
    heading.appendChild(element("h2", "broker-title", "Broker tasks"));
    heading.appendChild(button("Refresh", () => send({ type: "refreshBroker" }), false));
    section.appendChild(heading);

    const workspace = typeof state.workspaceName === "string" ? state.workspaceName : "Current workspace";
    section.appendChild(element("p", "broker-workspace", workspace));
    if (state.error) section.appendChild(element("p", "broker-error", state.error));
    if (state.loading) section.appendChild(element("p", "broker-muted", "Loading tasks…"));
    const writeDisabled = Boolean(state.busy || state.loading || state.error);
    section.appendChild(createTaskForm(send, writeDisabled));

    const tasks = Array.isArray(state.tasks) ? state.tasks : [];
    const activeTasks = tasks.filter((task) => !terminalTaskStatuses.has(String(task.status || "").toLowerCase()));
    const historyTasks = tasks.filter((task) => terminalTaskStatuses.has(String(task.status || "").toLowerCase()));
    const taskList = element("div", "broker-list");
    taskList.setAttribute("aria-label", "Workspace tasks");
    if (!tasks.length && !state.loading) taskList.appendChild(element("p", "broker-muted", "No tasks in this workspace."));
    for (const task of activeTasks) taskList.appendChild(renderTaskCard(task, send, writeDisabled));
    if (historyTasks.length) {
      const history = element("details", "broker-history");
      history.open = historyOpen;
      history.addEventListener("toggle", () => { historyOpen = history.open; });
      const latestDate = historyTasks.map((task) => taskCreatedDate(task.createdAt)).filter(Boolean)
        .map((date) => date.full).sort().at(-1);
      const shortDate = latestDate ? taskCreatedDate(latestDate)?.short : undefined;
      const fullLabel = `History (${historyTasks.length})${latestDate ? ` · ${latestDate}` : ""}`;
      const mediumLabel = `History (${historyTasks.length})${shortDate ? ` · ${shortDate}` : ""}`;
      const historySummary = element("summary", "broker-summary");
      historySummary.setAttribute("aria-label", fullLabel);
      historySummary.title = fullLabel;
      historySummary.appendChild(element("span", "text-full", fullLabel));
      historySummary.appendChild(element("span", "text-medium", mediumLabel));
      historySummary.appendChild(element("span", "text-short", `History (${historyTasks.length})`));
      history.appendChild(historySummary);
      const historyList = element("div", "broker-list");
      for (const task of historyTasks) historyList.appendChild(renderTaskCard(task, send, writeDisabled));
      history.appendChild(historyList);
      taskList.appendChild(history);
    }
    section.appendChild(taskList);

    const approvalList = element("div", "broker-approvals");
    approvalList.appendChild(element("h3", "broker-subtitle", "Approvals"));
    const approvals = Array.isArray(state.approvals) ? state.approvals : [];
    if (!approvals.length) approvalList.appendChild(element("p", "broker-muted", "No pending approvals."));
    for (const approval of approvals) {
      const card = element("article", "broker-card broker-approval");
      card.appendChild(element("p", "broker-approval-action", approval.action || "Approval"));
      card.appendChild(element("p", "broker-task-goal", approval.description || ""));
      const actions = element("div", "broker-actions");
      actions.appendChild(button("Approve", () => send({
        type: "resolveBrokerApproval", action: "approve", approvalId: approval.id,
        expectedRevision: approval.expectedRevision,
      }), writeDisabled));
      actions.appendChild(button("Reject", () => send({
        type: "resolveBrokerApproval", action: "reject", approvalId: approval.id,
        expectedRevision: approval.expectedRevision,
      }), writeDisabled));
      card.appendChild(actions);
      approvalList.appendChild(card);
    }
    section.appendChild(approvalList);

    const artifactList = element("div", "broker-artifacts");
    artifactList.appendChild(element("h3", "broker-subtitle", "Workspace artifacts"));
    const artifacts = Array.isArray(state.artifacts) ? state.artifacts : [];
    if (!artifacts.length) artifactList.appendChild(element("p", "broker-muted", "No workspace artifacts."));
    for (const artifact of artifacts) {
      const card = element("article", "broker-card broker-artifact");
      card.appendChild(element("p", "broker-task-goal", artifact.label || artifact.runTitle || "Artifact"));
      if (artifact.canOpen && artifact.id) {
        card.appendChild(button("Open", () => send({ type: "openArtifact", artifactId: artifact.id }), false));
      }
      artifactList.appendChild(card);
    }
    section.appendChild(artifactList);
    container.replaceChildren(section);
  }

  global.IPBrokerControls = { render };
})(window);
