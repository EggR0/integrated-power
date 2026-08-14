const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

if (process.platform !== "win32") { console.log("gpu selection test skipped outside Windows"); process.exit(0); }
const root = fs.mkdtempSync(path.join(os.tmpdir(), "integrated-power-gpu-test-"));
const fakeBin = path.join(root, "bin"); fs.mkdirSync(fakeBin, { recursive: true });
const fake = path.join(fakeBin, "nvidia-smi.cmd");
fs.writeFileSync(fake, "@echo 0, NVIDIA Fake, 24576, 8000, 8.6, GPU-TEST-0, 80\r\n@echo 1, NVIDIA Fake, 24576, 22000, 8.6, GPU-TEST-1, 0\r\n", "utf8");
const script = path.resolve(__dirname, "..", "assets", "ip-orchestrator-plugin", "skills", "ip-orchestrator", "scripts", "Select-LocalLLMModel.ps1");
const endpoint = process.env.INTEGRATED_POWER_LOCAL_ENDPOINT || (fs.existsSync("D:\\AI_Models") ? "http://127.0.0.1:11435" : "http://127.0.0.1:11434");
const output = execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-TaskType", "coding", "-InstalledOnly", "-PreferredModel", "qwen3.6:27b", "-HardwareMode", "user_default", "-OllamaEndpoint", endpoint, "-AsJson"], { encoding: "utf8", env: { ...process.env, PATH: `${fakeBin};${process.env.PATH}` }, timeout: 30000 });
const result = JSON.parse(output);
assert.strictEqual(result.Hardware.GpuIndex, 1);
assert.strictEqual(result.Hardware.GpuUuid, "GPU-TEST-1");
assert.strictEqual(result.Hardware.GpuUtilizationPercent, 0);
console.log("fake two-GPU selection passed: GPU1 / GPU-TEST-1");
