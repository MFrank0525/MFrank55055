import assert from "node:assert/strict";
import fs from "node:fs";

const runnerSource = fs.readFileSync("src/cli/auto-listing-controller.ts", "utf8");
const continuationRuleSource = fs.readFileSync("src/autolist/batch-continuation-rules.ts", "utf8");

assert.match(
  runnerSource,
  /summarizeLatestPublishArtifact/,
  "AutoListingController status must inspect recent publish artifacts when manifest progress is stale"
);
assert.match(
  runnerSource,
  /latestArtifact/,
  "AutoListingController publish progress must expose the latest publish artifact for module-level progress"
);
assert.match(
  runnerSource,
  /publishProgressHasNewerArtifact/,
  "AutoListingController status summary must prefer publish progress when recent artifacts are newer than task state"
);
assert.match(
  runnerSource,
  /publishProgressHasNewerActive/,
  "AutoListingController status summary must prefer publish progress when active manifest progress is newer than task state"
);
assert.match(
  runnerSource,
  /progressHeartbeat/,
  "AutoListingController status must expose an effective heartbeat based on the newest publish progress source"
);
assert.match(
  continuationRuleSource,
  /latest_publish_artifact/,
  "AutoListingController status heartbeat must be allowed to use the latest publish artifact rather than stale state progress"
);
assert.match(
  runnerSource,
  /latestProgress: undefined/,
  "AutoListingController status must hide stale state latestProgress when publish progress is newer"
);

console.log("hermes publish progress artifact rule passed");
