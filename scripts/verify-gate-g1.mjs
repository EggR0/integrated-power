import { execSync } from "child_process";
import path from "path";

console.log("Verifying G1: Protobuf Schema Compliance...");
const pyFile = path.resolve("scripts/verify_g1.py");

try {
  const stdout = execSync(`python "${pyFile}"`, {
    encoding: "utf-8",
  });
  if (stdout.includes("G1_PYTHON_ASSERTIONS_PASSED")) {
    console.log("G1_PROTOBUF_SCHEMA_VERIFIED");
    process.exit(0);
  } else {
    console.error("FAIL: Did not get expected token:", stdout);
    process.exit(1);
  }
} catch (err) {
  console.error("FAIL during G1 check:", err);
  process.exit(1);
}
