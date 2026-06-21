import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const staleArtifact = "dist/stale-build-artifact.js";
fs.mkdirSync("dist", { recursive: true });
fs.writeFileSync(staleArtifact, "throw new Error('stale build artifact');\n");

try {
  execFileSync("npm", ["run", "build"], { stdio: "pipe" });
  assert.equal(fs.existsSync(staleArtifact), false, "build must remove stale output before compiling");
} finally {
  fs.rmSync(staleArtifact, { force: true });
}

console.log("build output cleanup rule passed");
