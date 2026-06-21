import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const staleArtifact = "dist/stale-build-artifact.js";
const stabilityChecklist = fs.readFileSync("docs/auto-listing/stability-checklist.md", "utf8");
assert.match(
  stabilityChecklist,
  /运行中.*npm run build.*不得删除.*dist.*build:clean.*离线/s,
  "Operational build safety must be an explicit project rule"
);
fs.mkdirSync("dist", { recursive: true });
fs.writeFileSync(staleArtifact, "throw new Error('stale build artifact');\n");

try {
  execFileSync("npm", ["run", "build"], { stdio: "pipe" });
  assert.equal(
    fs.existsSync(staleArtifact),
    true,
    "Operational build must not delete dist while another controller or status process may be importing it"
  );
  execFileSync("npm", ["run", "build:clean"], { stdio: "pipe" });
  assert.equal(fs.existsSync(staleArtifact), false, "Offline clean build must remove stale output before compiling");
} finally {
  fs.rmSync(staleArtifact, { force: true });
}

console.log("runtime-safe and clean build separation rule passed");
