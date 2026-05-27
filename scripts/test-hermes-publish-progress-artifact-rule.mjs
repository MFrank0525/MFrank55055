import assert from "node:assert/strict";
import fs from "node:fs";

const runnerSource = fs.readFileSync("src/cli/hermes-auto-listing-runner.ts", "utf8");
const continuationRuleSource = fs.readFileSync("src/autolist/batch-continuation-rules.ts", "utf8");

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
assert.match(
  runnerSource,
  /progressHeartbeat/,
  "Hermes status must expose an effective heartbeat based on the newest publish progress source"
);
assert.match(
  continuationRuleSource,
  /latest_publish_artifact/,
  "Hermes status heartbeat must be allowed to use the latest publish artifact rather than stale state progress"
);
assert.match(
  runnerSource,
  /latestProgress: undefined/,
  "Hermes status must hide stale state latestProgress when publish progress is newer"
);

console.log("hermes publish progress artifact rule passed");
