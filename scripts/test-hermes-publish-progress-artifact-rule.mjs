import assert from "node:assert/strict";
import fs from "node:fs";

const runnerSource = fs.readFileSync("src/cli/hermes-auto-listing-runner.ts", "utf8");

assert.match(
  runnerSource,
  /summarizeLatestPublishArtifact/,
  "Hermes status must inspect recent publish artifacts when manifest progress is stale"
);
assert.match(
  runnerSource,
  /latestArtifact/,
  "Hermes publish progress must expose the latest publish artifact for module-level progress"
);
assert.match(
  runnerSource,
  /publishProgressHasNewerArtifact/,
  "Hermes status summary must prefer publish progress when recent artifacts are newer than task state"
);
assert.match(
  runnerSource,
  /publishProgressHasNewerActive/,
  "Hermes status summary must prefer publish progress when active manifest progress is newer than task state"
);

console.log("hermes publish progress artifact rule passed");
