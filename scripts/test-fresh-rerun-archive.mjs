import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { archiveFreshRerunEvidence } from "../dist/src/autolist/fresh-rerun-archive.js";
import { paidImageBatchLedgerDir } from "../dist/src/autolist/paid-image-submission-ledger.js";

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fresh-rerun-archive-"));
try {
  const batchFingerprint = "batch-fingerprint-001";
  const ledgerRoot = path.join(tempRoot, "ledger");
  const batchDir = paidImageBatchLedgerDir(ledgerRoot, batchFingerprint);
  writeJson(path.join(batchDir, "product-1", "slots", "01.json"), { state: "completed" });
  const runtimeRoot = path.join(tempRoot, "runs");
  writeJson(path.join(runtimeRoot, "old-run", "state.json"), { feishuBatchFingerprint: batchFingerprint });
  writeJson(path.join(runtimeRoot, "other-run", "state.json"), { feishuBatchFingerprint: "another-batch" });
  const processedManifest = path.join(tempRoot, "processed-images.json");
  writeJson(processedManifest, { currentBatchFingerprint: batchFingerprint });

  const result = archiveFreshRerunEvidence({
    batchFingerprint,
    paidImageLedgerRoot: ledgerRoot,
    runtimeRoot,
    processedImageManifest: processedManifest,
    archiveRoot: path.join(tempRoot, "archives"),
    now: new Date("2026-11-19T12:00:00.000Z")
  });
  assert.equal(result.paidImageStates.completed, 1);
  assert.equal(fs.existsSync(batchDir), false);
  assert.equal(fs.existsSync(path.join(runtimeRoot, "old-run")), false);
  assert.equal(fs.existsSync(path.join(runtimeRoot, "other-run")), true);
  assert.equal(fs.existsSync(path.join(result.archiveDir, "paid-image-ledger", "product-1", "slots", "01.json")), true);
  assert.equal(fs.existsSync(path.join(result.archiveDir, "runs", "old-run", "state.json")), true);
  assert.equal(fs.existsSync(path.join(result.archiveDir, "processed-images.before-rerun.json")), true);
  assert.equal(fs.existsSync(path.join(result.archiveDir, "archive-manifest.json")), true);

  const blockedBatch = "batch-fingerprint-active";
  const blockedDir = paidImageBatchLedgerDir(ledgerRoot, blockedBatch);
  writeJson(path.join(blockedDir, "product-1", "slots", "01.json"), { state: "submitted" });
  assert.throws(
    () => archiveFreshRerunEvidence({
      batchFingerprint: blockedBatch,
      paidImageLedgerRoot: ledgerRoot,
      runtimeRoot,
      processedImageManifest: processedManifest,
      archiveRoot: path.join(tempRoot, "archives"),
      now: new Date("2026-11-19T12:01:00.000Z")
    }),
    /submitted=1/
  );
  assert.equal(fs.existsSync(blockedDir), true);
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

console.log("fresh rerun evidence archive rules passed");
