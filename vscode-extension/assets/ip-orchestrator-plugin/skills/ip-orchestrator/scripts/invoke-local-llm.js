#!/usr/bin/env node
/**
 * Cross-Platform Local LLM Runner (Linux, macOS, Windows)
 * Integrated Power v0.9.0
 *
 * Streams inference from Ollama / OpenAI-compatible endpoints with
 * full context support (32k+ default) and unbounded generation (no arbitrary token cap).
 */

const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");
const { URL } = require("url");

function parseArgs() {
  const args = process.argv.slice(2);
  const params = {
    promptFile: "",
    promptText: "",
    outputFile: "",
    model: "qwen3.8:27b",
    endpoint: process.env.OLLAMA_HOST || "http://127.0.0.1:11434",
    numCtx: 32768, // Default 32K context window
    numPredict: -1, // -1 = unbounded / model default (no arbitrary cap)
    temperature: 0.2,
    stream: true,
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
    } else if (arg === "--endpoint" || arg === "-e") {
      params.endpoint = args[++i];
    } else if (arg === "--numCtx") {
      params.numCtx = parseInt(args[++i], 10);
    } else if (arg === "--numPredict") {
      params.numPredict = parseInt(args[++i], 10);
    }
  }

  return params;
}

async function main() {
  const params = parseArgs();

  let prompt = params.promptText;
  if (params.promptFile) {
    prompt = fs.readFileSync(path.resolve(params.promptFile), "utf8");
  }

  if (!prompt || !prompt.trim()) {
    console.error("[invoke-local-llm] Error: No prompt provided via --prompt or --promptFile");
    process.exit(1);
  }

  let endpointUrl = params.endpoint || "http://127.0.0.1:11434";
  if (!endpointUrl.startsWith("http://") && !endpointUrl.startsWith("https://")) {
    endpointUrl = "http://" + endpointUrl;
  }
  endpointUrl = endpointUrl.replace("0.0.0.0", "127.0.0.1");
  if (!/:\d+/.test(endpointUrl)) {
    endpointUrl = endpointUrl + ":11434";
  }

  const generateUrl = new URL("/api/chat", endpointUrl);
  const payload = JSON.stringify({
    model: params.model,
    messages: [
      {
        role: "system",
        content: "You are an expert systems software engineer. Provide complete, production-ready code and solutions.",
      },
      {
        role: "user",
        content: prompt,
      },
    ],
    options: {
      num_ctx: params.numCtx,
      num_predict: params.numPredict,
      temperature: params.temperature,
    },
    stream: true,
  });

  const isHttps = generateUrl.protocol === "https:";
  const client = isHttps ? https : http;

  console.log(`[invoke-local-llm] Connecting to ${generateUrl.origin} (Model: ${params.model}, Context: ${params.numCtx}, Predict: ${params.numPredict === -1 ? 'unbounded' : params.numPredict})...`);

  const reqOptions = {
    hostname: generateUrl.hostname,
    port: generateUrl.port || (isHttps ? 443 : 80),
    path: generateUrl.pathname,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(payload),
    },
  };

  const startTime = Date.now();
  const contentChunks = [];
  const thinkingChunks = [];

  const req = client.request(reqOptions, (res) => {
    if (res.statusCode && res.statusCode >= 400) {
      let errBody = "";
      res.on("data", (chunk) => (errBody += chunk));
      res.on("end", () => {
        console.error(`[invoke-local-llm] HTTP Error ${res.statusCode}: ${errBody}`);
        process.exit(1);
      });
      return;
    }

    res.setEncoding("utf8");
    let buffer = "";

    res.on("data", (chunk) => {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          const msg = parsed.message || {};
          if (msg.content) {
            contentChunks.push(msg.content);
            process.stdout.write(msg.content);
          }
          if (msg.thinking) {
            thinkingChunks.push(msg.thinking);
          }
        } catch {
          // ignore partial parse error
        }
      }
    });

    res.on("end", () => {
      const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(2);
      const fullContent = contentChunks.join("");
      const fullThinking = thinkingChunks.join("");
      const output = fullContent.trim() ? fullContent : fullThinking;

      console.log(`\n[invoke-local-llm] Completed in ${elapsedSec}s. Output length: ${output.length} chars.`);

      if (params.outputFile) {
        const outPath = path.resolve(params.outputFile);
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        fs.writeFileSync(outPath, output, "utf8");
        console.log(`[invoke-local-llm] Saved result to: ${outPath}`);
      }
    });
  });

  req.on("error", (err) => {
    console.error(`[invoke-local-llm] Request failed: ${err.message}`);
    process.exit(1);
  });

  req.write(payload);
  req.end();
}

main().catch((err) => {
  console.error("[invoke-local-llm] Fatal:", err);
  process.exit(1);
});
