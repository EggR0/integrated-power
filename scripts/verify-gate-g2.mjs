import { execSync } from "child_process";
import path from "path";

console.log("Verifying G2: Active Session Grace Period Protection...");
const pyFile = path.resolve("scripts/verify_g2.py");

try {
  const stdout = execSync(`python "${pyFile}"`, {
    encoding: "utf-8",
  });
  if (stdout.includes("G2_PYTHON_ASSERTIONS_PASSED")) {
    console.log("G2_ACTIVE_SESSION_PROTECTION_VERIFIED");
    process.exit(0);
  } else {
    console.error("FAIL: Did not get expected token:", stdout);
    process.exit(1);
  }
} catch (err) {
  console.error("FAIL during G2 check:", err);
  process.exit(1);
}
