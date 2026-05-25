import assert from "node:assert/strict";
import { selectMaintenanceResidueTargets } from "../src/autolist/maintenance-rules.ts";

const targets = selectMaintenanceResidueTargets({
  filePaths: [
    "/repo/input/auto-listing/auto-listing.job.mac-feishu-real.resume.generated.json",
    "/repo/input/auto-listing/auto-listing.job.relist-third.generated.json",
    "/repo/scripts/inspect-shop-switch-dialog.mjs",
    "/repo/scripts/test-progress-state.mjs",
    "/repo/src/autolist/cleanup.ts"
  ],
  activeGeneratedJobFile: "/repo/input/auto-listing/auto-listing.job.mac-feishu-real.resume.generated.json"
});

assert.deepEqual(targets, [
  {
    filePath: "/repo/input/auto-listing/auto-listing.job.relist-third.generated.json",
    reason: "obsolete generated auto-listing job"
  },
  {
    filePath: "/repo/scripts/inspect-shop-switch-dialog.mjs",
    reason: "one-off diagnostic or temporary maintenance script"
  }
]);

console.log("maintenance residue rule passed");
