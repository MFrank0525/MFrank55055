import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { selectMaintenanceResidueTargets } from "../dist/src/autolist/maintenance-rules.js";
import { cleanupMaintenanceResidue } from "../dist/src/autolist/cleanup.js";
import { collectPreviousBatchArtifactTargets, writeIdleFeishuCache } from "../dist/src/autolist/maintenance-inventory.js";

const targets = selectMaintenanceResidueTargets({
  filePaths: [
    "/repo/input/auto-listing/auto-listing.job.mac-feishu-real.resume.generated.json",
    "/repo/input/auto-listing/auto-listing.job.relist-third.generated.json",
    "/repo/scripts/inspect-shop-switch-dialog.mjs",
    "/repo/scripts/test-progress-state.mjs",
    "/repo/src/autolist/cleanup.ts",
    "/repo/docs/superpowers",
    "/repo/data/auto-listing/control/auto-listing-controller-20260707.log",
    "/repo/data/auto-listing/control/auto-listing-controller-job.json",
    "/repo/data/auto-listing/control/hermes-watchdog-state.json",
    "/repo/data/auto-listing/control/feishu-products.refresh-candidate.json",
    "/repo/data/auto-listing/runs/20260707-213928",
    "/repo/data/auto-listing/deferred-main-images",
    "/repo/data/auto-listing/shop-access-audits",
    "/repo/data/auto-listing/paid-image-submissions",
    "/repo/data/auto-listing/processed-images.json",
    "/repo/data/auto-listing/after-duzhong-processed-images.json",
    "/repo/data/feishu/products.json",
    "/repo/input/auto-listing/feishu-images",
    "/repo/input/auto-listing/qualifications",
    "/repo/input/legacy",
    "/repo/data/auto-listing/.DS_Store",
    "/repo/data/auto-listing/conversation-targets.json"
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
  },
  { filePath: "/repo/docs/superpowers", reason: "historical engineering process documents" },
  { filePath: "/repo/data/auto-listing/control/auto-listing-controller-20260707.log", reason: "historical controller log" },
  { filePath: "/repo/data/auto-listing/control/auto-listing-controller-job.json", reason: "terminal controller state" },
  { filePath: "/repo/data/auto-listing/control/hermes-watchdog-state.json", reason: "stale watchdog state" },
  { filePath: "/repo/data/auto-listing/control/feishu-products.refresh-candidate.json", reason: "transient Feishu refresh candidate" },
  { filePath: "/repo/data/auto-listing/runs/20260707-213928", reason: "previous batch runtime" },
  { filePath: "/repo/data/auto-listing/deferred-main-images", reason: "obsolete deferred main-image workspace" },
  { filePath: "/repo/data/auto-listing/shop-access-audits", reason: "completed shop-access audit output" },
  { filePath: "/repo/data/auto-listing/paid-image-submissions", reason: "previous paid image-generation batch ledger" },
  { filePath: "/repo/data/auto-listing/processed-images.json", reason: "previous batch processed-image marker" },
  { filePath: "/repo/data/auto-listing/after-duzhong-processed-images.json", reason: "obsolete processed-image snapshot" },
  { filePath: "/repo/data/feishu/products.json", reason: "previous Feishu batch cache" },
  { filePath: "/repo/input/auto-listing/feishu-images", reason: "previous Feishu batch source assets" },
  { filePath: "/repo/input/auto-listing/qualifications", reason: "previous Feishu batch qualification assets" },
  { filePath: "/repo/input/legacy", reason: "legacy input directory" },
  { filePath: "/repo/data/auto-listing/.DS_Store", reason: "filesystem metadata" }
]);

console.log("maintenance residue rule passed");

const cleanupRoot = fs.mkdtempSync(path.join(os.tmpdir(), "maintenance-cleanup-"));
const target = path.join(cleanupRoot, "obsolete.json");
fs.writeFileSync(target, "{}\n");
const dryRun = cleanupMaintenanceResidue({ targets: [target], apply: false, workspaceRoot: cleanupRoot });
assert.deepEqual(dryRun.removedPaths, []);
assert.deepEqual(dryRun.selectedPaths, [target]);
assert.equal(fs.existsSync(target), true, "dry run must never delete data");
const applied = cleanupMaintenanceResidue({ targets: [target], apply: true, workspaceRoot: cleanupRoot });
assert.deepEqual(applied.removedPaths, [target]);
assert.equal(fs.existsSync(target), false);
assert.throws(
  () => cleanupMaintenanceResidue({ targets: [path.dirname(cleanupRoot)], apply: true, workspaceRoot: cleanupRoot }),
  /outside workspace|unsafe/i
);

const inventoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "maintenance-inventory-"));
for (const relativePath of [
  "data/auto-listing/runs/run-a/state.json",
  "data/auto-listing/paid-image-submissions/batch-a/product.json",
  "data/auto-listing/control/controller.log",
  "data/auto-listing/processed-images.json",
  "data/feishu/products.json",
  "input/auto-listing/auto-listing.job.resume.generated.json",
  "input/auto-listing/feishu-images/.gitkeep",
  "input/auto-listing/feishu-images/product.png"
]) {
  const filePath = path.join(inventoryRoot, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, "{}\n");
}
const inventoryTargets = collectPreviousBatchArtifactTargets(inventoryRoot).map((item) => path.relative(inventoryRoot, item));
assert.deepEqual(inventoryTargets, [
  "data/auto-listing/control/controller.log",
  "data/auto-listing/paid-image-submissions",
  "data/auto-listing/processed-images.json",
  "data/auto-listing/runs",
  "data/feishu/products.json",
  "input/auto-listing/auto-listing.job.resume.generated.json",
  "input/auto-listing/feishu-images/product.png"
]);
fs.writeFileSync(
  path.join(inventoryRoot, "data/feishu/products.json"),
  JSON.stringify({ schemaVersion: 2, fieldMapVersion: 2, batchFingerprint: "4f53cda18c2baa0c0354bb5f", records: [] })
);
assert.equal(
  collectPreviousBatchArtifactTargets(inventoryRoot).includes(path.join(inventoryRoot, "data/feishu/products.json")),
  false,
  "a valid empty Feishu cache is an idle-state marker, not previous batch residue"
);
fs.rmSync(path.join(inventoryRoot, "data/feishu/products.json"));
writeIdleFeishuCache(inventoryRoot);
assert.equal(JSON.parse(fs.readFileSync(path.join(inventoryRoot, "data/feishu/products.json"), "utf8")).records.length, 0);
fs.writeFileSync(
  path.join(inventoryRoot, "data/auto-listing/control/hermes-watchdog-state.json"),
  JSON.stringify({ job_key: "", active_key: "::0" })
);
assert.equal(
  collectPreviousBatchArtifactTargets(inventoryRoot).some((item) => item.endsWith("hermes-watchdog-state.json")),
  false,
  "an idle watchdog heartbeat is current control state, not historical batch residue"
);
