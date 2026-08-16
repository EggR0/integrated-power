#!/usr/bin/env node
/**
 * Cross-Platform Codex Runner (Linux, macOS, Windows)
 * Integrated Power v0.9.0
 *
 * Runs Codex CLI in a pure Node.js process without PowerShell dependencies.
 */

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

function parseArgs() {
  const args = process.argv.slice(2);
  const params = {
    promptFile: "",
    promptText: "",
    outputFile: "",
    model: "gpt-5.5",
    sandbox: "read-only",
    reasoningEffort: "high",
    timeoutSec: 1800,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--promptFile" || arg === "-f") {
      params.promptFile = args[++i];
    } else if (arg === "--prompt" || arg === "-p") {
      params.promptText = args[++i];
    } else if (arg === "--outputFile" || arg === "-o") {
      params.outputFile = args[++i];
    } else if (arg === "--model" || arg === "-m") {
      params.model = args[++i];
    } else if (arg === "--sandbox" || arg === "-s") {
      params.sandbox = args[++i];
    } else if (arg === "--reasoningEffort" || arg === "-r") {
      params.reasoningEffort = args[++i];
    }
  }

  return params;
}

function resolveCodexExe() {
  if (process.env.CODEX_EXE && fs.existsSync(process.env.CODEX_EXE)) {
    return process.env.CODEX_EXE;
  }
  if (process.env.LOCALAPPDATA) {
    const codexBinRoot = path.join(process.env.LOCALAPPDATA, "OpenAI", "Codex", "bin");
    if (fs.existsSync(codexBinRoot)) {
      const subdirs = fs.readdirSync(codexBinRoot);
      for (const sub of subdirs) {
        const candidate = path.join(codexBinRoot, sub, "codex.exe");
        if (fs.existsSync(candidate)) {
          return candidate;
        }
      }
    }
  }
  return "codex";
}

async function main() {
  const params = parseArgs();

  let prompt = params.promptText;
  if (params.promptFile) {
    prompt = fs.readFileSync(path.resolve(params.promptFile), "utf8");
  }

  if (!prompt || !prompt.trim()) {
    console.error("[invoke-codex] Error: No prompt provided via --prompt or --promptFile");
    process.exit(1);
  }

  const codexExe = resolveCodexExe();
  const tempOutputFile = params.outputFile
    ? path.resolve(params.outputFile)
    : path.join(process.cwd(), ".codex-output.tmp");

  fs.mkdirSync(path.dirname(tempOutputFile), { recursive: true });

  const args = [
    "exec",
    "--cd", process.cwd(),
    "--sandbox", params.sandbox,
    "--model", params.model,
    "-c", `model_reasoning_effort="${params.reasoningEffort}"`,
    "--output-last-message", tempOutputFile,
    prompt,
  ];

  console.log(`[invoke-codex] Launching ${codexExe} (Model: ${params.model}, Sandbox: ${params.sandbox})...`);

  const proc = spawn(codexExe, args, {
    stdio: ["ignore", "inherit", "inherit"],
    windowsHide: true,
  });

  const exitCode = await new Promise((resolve) => {
    proc.on("close", resolve);
  });

  if (exitCode !== 0) {
    console.error(`[invoke-codex] Codex process exited with code ${exitCode}`);
    process.exit(exitCode);
  }

  if (fs.existsSync(tempOutputFile)) {
    console.log(`[invoke-codex] Success. Output written to: ${tempOutputFile}`);
  }
}

main().catch((err) => {
  console.error("[invoke-codex] Fatal:", err);
  process.exit(1);
});
