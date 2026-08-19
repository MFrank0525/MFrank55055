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
import { reconcilePositiveUncertainPublish } from "../dist/src/autolist/reconcile-positive-uncertain-publish.js";
import { findLatestIncompletePublishManifestForResume } from "../dist/src/autolist/unsafe-publish-resume.js";
import { auditPublishCoverage } from "../dist/src/autolist/audit-rules.js";
import { consumeConfirmedRejectionRetry } from "../dist/src/autolist/confirmed-rejection-retry.js";

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
const runDir = path.join(root, "run");
const runtimeDir = path.join(runDir, "publish", "publish-target");
const shopFolder = path.join(root, "02shop");
fs.mkdirSync(path.join(runtimeDir, "screenshots"), { recursive: true });
fs.mkdirSync(shopFolder, { recursive: true });
fs.writeFileSync(path.join(runtimeDir, "screenshots", "doudian-list-full-title-02shop-not-found.png"), "evidence");
fs.writeFileSync(path.join(runtimeDir, "publish-submit-attempt.json"), JSON.stringify({ state: "attempted_or_unknown" }));
const canonicalIdentity = { batchFingerprint: "batch", recordId: "record", taskId: "task", shopCode: "02", watermarkNo: 8 };
fs.writeFileSync(path.join(runDir, "publish-manifest.json"), JSON.stringify({ entries: [{
  targetIdentity: canonicalIdentity,
  targetKey: "publish-target",
  runtimeKey: "publish-target",
  productFolder: path.join(root, "product-08"),
  shopFolder,
  watermarkNo: 8,
  status: "failed",
  finalVerifyStatus: "needs_manual_review",
  resultFile: path.join(runtimeDir, "result.json"),
  message: "uncertain",
  errorClass: "validation_blocked",
  updatedAt: "2026-08-09T00:00:00.000Z"
}] }));
fs.writeFileSync(path.join(runtimeDir, "result.json"), JSON.stringify({
  ok: true,
  status: "published",
  message: "Publish button click was issued; platform success signal was not observed.",
  finishedAt: "2026-08-09T00:00:00.000Z",
  data: {
    shopFolder,
    metadata: {
      title: "精确标题",
      canonicalIdentity
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
  const approvedManifest = JSON.parse(fs.readFileSync(path.join(runDir, "publish-manifest.json"), "utf8"));
  assert.equal(approvedManifest.entries[0].status, "pending");
  assert.equal(approvedManifest.entries[0].finalVerifyStatus, "not_checked");
  assert.equal(approvedManifest.entries[0].errorClass, "reviewed_negative_retry_approved");
  const recoveryAudit = auditPublishCoverage({
    tasks: [{
      taskId: "task",
      status: "failed",
      generatedProductFolders: [path.join(root, "product-08")],
      feishuProductRecord: { recordId: "record", productCategory: "医疗器械" },
      publishArtifact: { results: [{
        targetIdentity: canonicalIdentity,
        targetKey: "publish-target",
        productFolder: path.join(root, "product-08"),
        ok: false,
        status: "failed",
        message: "uncertain",
        finalVerifyStatus: "needs_manual_review"
      }], simulated: false }
    }],
    manifestEntries: approvedManifest.entries,
    allowInProgress: true
  });
  assert.equal(recoveryAudit.ok, true);
  assert.equal(recoveryAudit.summary.inProgressPublishCount, 1);
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
  consumeConfirmedRejectionRetry(runtimeDir, {
    targetKey: "publish-target",
    title: "精确标题",
    shopFolder
  });
  await assert.rejects(
    approveReviewedNegativeUncertainPublishRetry({
      runtimeDir,
      shopFolder,
      now: () => Date.parse("2026-08-09T03:00:00.000Z"),
      verify: async () => { throw new Error("verification must not run after retry consumption"); }
    }),
    /controlled retry was already consumed/
  );
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

const positiveRoot = fs.mkdtempSync(path.join(os.tmpdir(), "listing-positive-reconciliation-"));
try {
  const runDir = path.join(positiveRoot, "run");
  const targetDir = path.join(runDir, "publish", "target-11");
  const positiveShop = path.join(positiveRoot, "03shop");
  fs.mkdirSync(targetDir, { recursive: true });
  fs.mkdirSync(positiveShop, { recursive: true });
  const identity = { batchFingerprint: "batch", recordId: "record", taskId: "task", shopCode: "03", watermarkNo: 11 };
  fs.writeFileSync(path.join(targetDir, "result.json"), JSON.stringify({
    data: { shopFolder: positiveShop, metadata: { title: "已存在标题", canonicalIdentity: identity }, browser: { publishClickAttempted: true, publishClicked: false } }
  }));
  fs.writeFileSync(path.join(runDir, "publish-manifest.json"), JSON.stringify({ entries: [{
    targetIdentity: identity, targetKey: "target-11", runtimeKey: "target-11", productFolder: "/p/11",
    shopFolder: positiveShop, watermarkNo: 11, status: "failed", finalVerifyStatus: "submit_accepted_unconfirmed", message: "uncertain"
  }] }));
  await reconcilePositiveUncertainPublish({
    runtimeDir: targetDir, shopFolder: positiveShop,
    verify: async () => ({ found: true, title: "已存在标题", shopFolder: positiveShop, shopName: "店铺", countText: "共1条", matchedRows: ["已存在标题"], pageUrl: "https://example.invalid", screenshotFile: "found.png" })
  });
  const reconciledManifest = JSON.parse(fs.readFileSync(path.join(runDir, "publish-manifest.json"), "utf8"));
  assert.equal(reconciledManifest.entries[0].status, "published");
  assert.equal(reconciledManifest.entries[0].finalVerifyStatus, "list_verified");
  assert.equal(JSON.parse(fs.readFileSync(path.join(targetDir, "result.json"), "utf8")).finalVerifyStatus, "list_verified");
  const sourceImage = path.join(positiveRoot, "source.png");
  fs.writeFileSync(sourceImage, "image");
  const runResultFile = path.join(runDir, "result.json");
  fs.writeFileSync(runResultFile, JSON.stringify({
    runtimeDir: runDir, feishuBatchFingerprint: "batch", businessRuleFingerprint: "rules",
    tasks: [{ taskId: "task", sourceImagePath: sourceImage, generatedProductFolders: ["/p/11", "/p/12"] }]
  }));
  const incomplete = findLatestIncompletePublishManifestForResume({
    rootDir: positiveRoot, resultFiles: [runResultFile], fileMtimeMs: () => 1,
    countSafelyPublishedManifestEntries: () => 1,
    shouldResumeSourceImageForCurrentFeishuBatch: () => true
  });
  assert.deepEqual(incomplete?.remainingProductFolderNames, ["12"]);
} finally {
  fs.rmSync(positiveRoot, { recursive: true, force: true });
}

console.log("uncertain publish recovery tests passed");
