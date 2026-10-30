import { execSync } from "child_process";
import path from "path";

console.log("Verifying G4: Workspace URI Migration and Sidebar Visibility...");
const pyFile = path.resolve("scripts/verify_g4.py");

try {
  const stdout = execSync(`python "${pyFile}"`, {
    encoding: "utf-8",
  });
  if (stdout.includes("G4_PYTHON_ASSERTIONS_PASSED")) {
    console.log("G4_WORKSPACE_MIGRATION_VERIFIED");
    process.exit(0);
  } else {
    console.error("FAIL: Did not get expected token:", stdout);
    process.exit(1);
  }
} catch (err) {
  console.error("FAIL during G4 check:", err);
  process.exit(1);
}
