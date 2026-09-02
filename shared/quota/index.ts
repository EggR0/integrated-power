/**
 * Shared quota calculation, formatting, and settings primitives.
 *
 * This module must stay free of DOM and Node dependencies so that the same
 * code is bundled by the VSIX webview (IIFE, `window.IPQuota`) and by the
 * control-center desktop UI (vite alias `@shared/quota`). UI rendering and
 * per-platform settings persistence live in each program, not here.
 */

export * from "./capacity";
export * from "./external";
export * from "./format";
export * from "./local";
export * from "./metric";
export * from "./settings";
