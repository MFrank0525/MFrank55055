import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { approveReviewedNegativeUncertainPublishRetry } from "../dist/src/autolist/recover-uncertain-publish.js";
import { readPublishResultSummary } from "../dist/src/autolist/publish.js";
import {
  isKnownCategoryMisplacementWarning,
  selectCategoryMisplacementWarningCloseControl
} from "../dist/src/business/publish-from-spu/product-list-verification-action.js";

assert.equal(isKnownCategoryMisplacementWarning(
  "检测到您有3个商品类目错放，逾期未改会被平台下架，请尽快修改！建议使用推荐类目，若你认为平台判断有误，可发起申诉"
), true);
assert.equal(isKnownCategoryMisplacementWarning("建议使用推荐类目"), false);
assert.equal(selectCategoryMisplacementWarningCloseControl([
  { visible: true, text: "使用推荐类目", ariaLabel: "", className: "primary" },
  { visible: true, text: "", ariaLabel: "Close", className: "modal-close" }
]), 1);
assert.equal(selectCategoryMisplacementWarningCloseControl([
  { visible: true, text: "使用推荐类目", ariaLabel: "", className: "primary" }
]), undefined);
const verificationSource = fs.readFileSync("src/business/publish-from-spu/product-list-verification-action.ts", "utf8");
assert.match(
  verificationSource,
  /const controls = warning\.locator\("button,\[role='button'\]"\)/,
  "category warning dismissal must enumerate interactive controls, not nested close-icon descendants"
);

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
