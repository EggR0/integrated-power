/**
 * Local-LLM server badge shared by the IDE webview and the control-center.
 *
 * The P2 broker passthrough carries `localComputeStatus.{endpointHealth,
 * loadedModels, programName, gpus}`. The IDE webview (and this module) derive
 * a single status badge from THREE conditions, in priority order:
 *
 *   1. a model is loaded      -> "Active · {model}"   (active)
 *   2. endpoint is up, idle   -> "{program} (Idle)"   (idle)
 *   3. otherwise              -> "Offline"            (offline)
 *
 * The control-center previously keyed its badge off `localComputeStatus.status`
 * (`"online"`/`"busy"`), a field the P2 state does NOT carry — so it was
 * permanently "Offline". This function is the single source of truth so both
 * surfaces agree. Pure (no DOM, no Node).
 */

/** Tone for the badge: active model / up-but-idle / down. */
export type LocalServerTone = "active" | "idle" | "offline";

/**
 * Build the local-LLM server badge.
 * @param endpointHealth  `localComputeStatus.endpointHealth` (`"ok" | "idle" | "offline" | ...`)
 * @param loadedModels    `localComputeStatus.loadedModels` (array of model names)
 * @param programName     `localComputeStatus.programName` (e.g. "vLLM", "Offline")
 * @returns `{ text, tone, hasLoadedModels, isServerRunning, programName }`
 */
export function localServerBadge(
  endpointHealth: string | undefined,
  loadedModels: readonly unknown[] | undefined,
  programName: string | undefined,
): {
  text: string;
  tone: LocalServerTone;
  hasLoadedModels: boolean;
  isServerRunning: boolean;
  programName: string;
} {
  const models = Array.isArray(loadedModels) ? (loadedModels as string[]) : [];
  const hasLoadedModels = models.length > 0;
  const health = typeof endpointHealth === "string" ? endpointHealth : "offline";
  // "ok" (serving) and "idle" (up, no load) both mean the server is running.
  const isServerRunning = health === "ok" || health === "idle";
  const program = typeof programName === "string" && programName.trim() ? programName : "Server";

  if (hasLoadedModels) {
    return {
      text: `Active · ${models[0]}`,
      tone: "active",
      hasLoadedModels,
      isServerRunning,
      programName: program,
    };
  }
  if (isServerRunning) {
    return {
      text: `${program} (Idle)`,
      tone: "idle",
      hasLoadedModels,
      isServerRunning,
      programName: program,
    };
  }
  return {
    text: "Offline",
    tone: "offline",
    hasLoadedModels,
    isServerRunning,
    programName: program,
  };
}

/**
 * Footer label for the "loaded model" line. First loaded model, or a muted
 * placeholder when none is loaded.
 */
export function localLoadedModelLabel(loadedModels: readonly unknown[] | undefined): string {
  const models = Array.isArray(loadedModels) ? (loadedModels as string[]) : [];
  return models.length > 0 ? String(models[0]) : "—";
}
