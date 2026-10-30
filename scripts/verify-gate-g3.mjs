import { execSync } from "child_process";
import path from "path";

console.log("Verifying G3: Transcript step_count Recovery and Brain-only Sessions...");
const pyFile = path.resolve("scripts/verify_g3.py");

try {
  const stdout = execSync(`python "${pyFile}"`, {
    encoding: "utf-8",
  });
  if (stdout.includes("G3_PYTHON_ASSERTIONS_PASSED")) {
    console.log("G3_TRANSCRIPT_RECOVERY_VERIFIED");
    process.exit(0);
  } else {
    console.error("FAIL: Did not get expected token:", stdout);
    process.exit(1);
  }
} catch (err) {
  console.error("FAIL during G3 check:", err);
  process.exit(1);
}
