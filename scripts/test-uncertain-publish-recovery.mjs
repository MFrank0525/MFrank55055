import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { approveReviewedNegativeUncertainPublishRetry } from "../dist/src/autolist/recover-uncertain-publish.js";
import { readPublishResultSummary } from "../dist/src/autolist/publish.js";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "listing-uncertain-recovery-"));
const runtimeDir = path.join(root, "publish-target");
const shopFolder = path.join(root, "02shop");
fs.mkdirSync(path.join(runtimeDir, "screenshots"), { recursive: true });
fs.mkdirSync(shopFolder, { recursive: true });
fs.writeFileSync(path.join(runtimeDir, "screenshots", "doudian-list-full-title-02shop-not-found.png"), "evidence");
fs.writeFileSync(path.join(runtimeDir, "publish-submit-attempt.json"), JSON.stringify({ state: "attempted_or_unknown" }));
fs.writeFileSync(path.join(runtimeDir, "result.json"), JSON.stringify({
  ok: true,
  status: "published",
  message: "Publish button click was issued; platform success signal was not observed.",
  finishedAt: "2026-08-09T00:00:00.000Z",
  data: {
    shopFolder,
    metadata: {
      title: "精确标题",
      canonicalIdentity: { batchFingerprint: "batch", recordId: "record", taskId: "task", shopCode: "02", watermarkNo: 8 }
    },
    browser: { publishClickAttempted: true, publishClicked: false, publishIssue: "no submission success signal" }
  }
}));

try {
  const approved = await approveReviewedNegativeUncertainPublishRetry({
    runtimeDir,
    shopFolder,
    now: () => Date.parse("2026-08-09T01:00:00.000Z"),
    verify: async () => ({
      found: false,
      title: "精确标题",
      shopFolder,
      shopName: "店铺",
      countText: "共0条",
      matchedRows: [],
      pageUrl: "https://example.invalid/list?tab=all",
      screenshotFile: path.join(runtimeDir, "screenshots", "latest-not-found.png")
    })
  });
  const result = JSON.parse(fs.readFileSync(approved.resultFile, "utf8"));
  assert.equal(result.manualRecovery.approved, true);
  assert.equal(result.manualRecovery.type, "operator_reviewed_stable_negative_list_verification");
  assert.equal(fs.existsSync(approved.archiveFile), true);
  assert.equal(readPublishResultSummary(approved.resultFile).reviewedNegativeRetryApproved, true);
  result.manualRecovery.title = "另一个标题";
  fs.writeFileSync(approved.resultFile, JSON.stringify(result));
  assert.equal(readPublishResultSummary(approved.resultFile).reviewedNegativeRetryApproved, false);
  result.manualRecovery.title = "精确标题";
  fs.writeFileSync(approved.resultFile, JSON.stringify(result));

  await assert.rejects(
    approveReviewedNegativeUncertainPublishRetry({
      runtimeDir,
      shopFolder,
      now: () => Date.parse("2026-08-09T02:00:00.000Z"),
      verify: async () => ({
        found: true,
        title: "精确标题",
        shopFolder,
        shopName: "店铺",
        countText: "共1条",
        matchedRows: ["精确标题"],
        pageUrl: "https://example.invalid/list?tab=all",
        screenshotFile: "found.png"
      })
    }),
    /not a stable zero result/
  );
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log("uncertain publish recovery tests passed");
