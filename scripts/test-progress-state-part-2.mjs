import assert from "node:assert/strict";
import "./test-main-image-square-normalization-rule.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readLatestTaskProgressEvent } from "../dist/src/autolist/progress-events.js";
import { buildFeishuSellingPointText } from "../dist/src/autolist/selling-point-rules.js";
import {
  auditAutoListingContinuity,
  auditCompletedBatchResidue,
  buildCanonicalPublishTargetKeys,
  summarizeFeishuBatchProgress,
  auditMainImageGeneration,
  auditPublishMainImageSubset,
  auditPublishCoverage
} from "../dist/src/autolist/audit-rules.js";
import {
  shouldContinueFeishuBatchAfterChildExit,
  shouldContinueFullFlowAfterChildExit,
  shouldBlockFullFlowAfterSuccessfulChild,
  shouldContinueFeishuAfterBatchRefresh,
  shouldRefreshFeishuAssetsBeforeFullFlow,
  shouldPreferActiveTaskStateSummary,
  selectAutoListingControllerStatusResultFile,
  isAutoListingControllerChildProcessCommand,
  isAutoListingDirectRunProcessCommand,
  isAutoListingControllerSupervisorProcessCommand,
  shouldResumeFeishuBatchAfterRetryableChildFailure,
  shouldRecoverFullFlowAfterChildFailure,
  shouldResumeInterruptedTaskInPlace,
  resolveDefaultRetryableChildFailureRecoveryAttempts,
  resolveAutoListingControllerProgressAgeSeconds,
  resolveAutoListingControllerEffectiveProgressTimestamp,
  resolveAutoListingControllerFeishuProgressDisplayMode,
  resolveAutoListingControllerFeishuBatchDisplayCounts,
  resolveAutoListingControllerStartAfterFeishuRefresh,
  resolveAutoListingControllerLaunchPolicy,
  selectAutoListingControllerActiveRunIdFromLogLines,
  selectAutoListingControllerStatusRuntimeDir,
  shouldSuppressHistoricalResultInAutoListingControllerStatus,
  shouldExposeHistoricalRuntimeForCurrentFeishuBatch,
  shouldSuppressStateCurrentTaskInAutoListingControllerStatus,
  shouldExposePublishProgressInAutoListingControllerStatus,
  shouldUseExpectedResultFileInRunningStatus,
  shouldResumeHistoricalFailureForCurrentFeishuBatch,
  isAutoListingControllerRunningProcessConfirmed,
  selectAutoListingControllerLatestResultFileForJobStatus,
  isExternalMainImageRawReuseMessage,
  shouldClearPauseSignalOnAutoListingControllerStart,
  summarizeAutoListingControllerImageGenerationEvents,
  isAutoListingControllerProgressArtifactRelativePath,
  shouldTerminateRecordedAutoListingControllerProcessGroup,
  shouldTerminateChildAfterTerminalResult,
  isRetryableExternalServiceAvailabilityFailure,
  shouldConsumeSupervisorRecoveryAttempt,
  resolveSupervisorRecoveryDelayMs,
  resolveSupervisorRecoveryChildMode,
  formatAutoListingControllerCompactStatusText,
  resolveAutoListingControllerHermesStatusPayload,
  selectAutoListingControllerFailedResumeCandidate,
  resolveAutoListingControllerRealtimeProgressSignal,
  resolveAutoListingControllerRuntimeStatus,
  resolveAutoListingControllerIdleStatus,
  resolveAutoListingControllerDryRunStartDecision,
  resolveAutoListingControllerContinueDecision,
  resolveAutoListingControllerBatchOwnership,
  resolveAutoListingSupervisorBatchOwnership,
  resolveAutoListingControllerPublishGroupProgress,
  resolveAutoListingControllerPaidImageRecordId,
  shouldSuppressTerminalFailureBehindNewerProgress,
  compactAutoListingTerminalFailureMessage
} from "../dist/src/autolist/batch-continuation-rules.js";

assert.equal(resolveAutoListingControllerBatchOwnership({
  controllerRunning: true,
  controllerBatchFingerprint: "batch-old",
  currentBatchFingerprint: "batch-current",
  controllerOwnsWaitState: true,
  controllerChildActive: false
}), "supersede_waiting_controller");
assert.equal(resolveAutoListingControllerBatchOwnership({
  controllerRunning: true,
  controllerBatchFingerprint: "batch-old",
  currentBatchFingerprint: "batch-current",
  controllerOwnsWaitState: false,
  controllerChildActive: true
}), "block_conflicting_controller");
assert.equal(resolveAutoListingControllerBatchOwnership({
  controllerRunning: true,
  controllerBatchFingerprint: "batch-current",
  currentBatchFingerprint: "batch-current",
  controllerOwnsWaitState: true,
  controllerChildActive: false
}), "reuse_current_controller");
assert.equal(resolveAutoListingSupervisorBatchOwnership({
  ownedBatchFingerprint: "batch-old",
  currentBatchFingerprint: "batch-current"
}), "stop_superseded_batch");
assert.equal(resolveAutoListingSupervisorBatchOwnership({
  ownedBatchFingerprint: "batch-current",
  currentBatchFingerprint: "batch-current"
}), "continue_owned_batch");
import { shouldTreatControllerSupervisorAsInert } from "../dist/src/autolist/maintenance-rules.js";
import {
  isDoudianLoginRequiredFailure,
  resolveDoudianLoginRecoveryPollMs
} from "../dist/src/autolist/doudian-login-recovery-rules.js";
import {
  formatPaidImageAcceptedTaskWaitSummary,
  resolvePaidImageChildStallTimeoutMs,
  resolvePaidImageChildWatchdogDecision,
  resolvePaidImageWaitStatus,
  shouldRefreshProgressSeenAtForPaidImageWait
} from "../dist/src/autolist/paid-image-wait-rules.js";
import { shouldRefreshFeishuAssetsToCandidateCache } from "../dist/src/autolist/feishu-refresh-rules.js";
import { shouldRetainStoppedControllerPublishCheckpoint } from "../dist/src/autolist/status-progress-rules.js";
import {
  initializePublishAttemptState,
  markPublishAttemptStarted,
  readPublishAttemptState
} from "../dist/src/autolist/publish-attempt-state.js";
import {
  shouldFailAutoListingControllerStatusForFeishuCacheInvalid,
  shouldPreserveAutoListingControllerCompletedStatusForFeishuCacheInvalid
} from "../dist/src/autolist/controller-cache-status-rules.js";
import { buildFeishuBatchFingerprint, canResumeFeishuBatchArtifacts } from "../dist/src/autolist/feishu-batch-rules.js";
import { hasSharedFeishuWhiteBackgroundLocalFile, resolvePendingFeishuProductSourceImagesFromRecords } from "../dist/src/autolist/feishu-products.js";
import { appendProcessedImages, clearProcessedImagesForBatch, readProcessedImages } from "../dist/src/autolist/file-batch.js";
import { selectCleanupTargets, selectStaleRunHistoryTargets } from "../dist/src/autolist/cleanup-rules.js";
import { cleanupStaleRunHistory } from "../dist/src/autolist/cleanup.js";
import {
  evaluateImageGenerationEndpointProbe,
  resolveImageDownloadTimeoutMs,
  resolveImageGenerationRequestDeadlineMs,
  resolveVideosBase64SubmitTimeoutMs,
  resolveImageGenerationHttpRetryPolicy,
  resolveImageGenerationTransportRetryPolicy,
  resolvePaidImageProviderTimeoutRetry,
  shouldRetryImageGenerationWithPolicyPrompt
} from "../dist/src/autolist/image-generation-rules.js";
import {
  inferResumeStartStepForTask,
  selectRemainingResumeProductFolderNames
} from "../dist/src/autolist/resume-rules.js";
import {
  hasIncompleteFixedMainImageRoundFiles,
  summarizeReusableTaskArtifacts
} from "../dist/src/autolist/resume-artifacts.js";
import { recoverDistributedFoldersFromShopRoot } from "../dist/src/autolist/resume.js";
import {
  hasCompleteProductPublishCoverage,
  isProductFullyProcessed
} from "../dist/src/autolist/processed-completion-rules.js";
import { applyResumeTaskId, createRunState, recordTaskProgress } from "../dist/src/autolist/state-machine.js";
import {
  assertGeneratedTitlesBelongToProduct,
  countTitleCharacters,
  normalizeTitleForDoudian
} from "../dist/src/autolist/title-rules.js";
import { resolveFeishuAssetRecordForFolder } from "../dist/src/business/publish-from-spu/asset-rules.js";
const progressRulesModule = await import("../dist/src/autolist/batch-continuation-rules.js");
import {
  classifyPublishFailure,
  evaluateDetailImageCompletion,
  evaluatePriceInventoryEntryRule,
  evaluatePublishCreatePageReadiness,
  evaluatePublishSubmission,
  evaluateSpecTemplateCompletion,
  isUploadPlaceholderGraphicContext,
  evaluateShopSwitchMenuState,
  evaluateShopTargetSelectionState,
  resolveProductListPreflightMode,
  shouldRunPendingTargetProductListPreflight,
  shouldRetryPublishFailure,
  shouldStopPublishBatchAfterFailure,
  evaluatePublishResult
} from "../dist/src/business/publish-from-spu/publish-rules.js";
import { isSettledExactTitlePositiveEvidence } from "../dist/src/business/publish-from-spu/product-list-verification-action.js";
import { isPublishOutcomeAcceptedForBatchCompletion } from "../dist/src/autolist/publish-manifest.js";
import {
  mergePublishArtifactWithSafeManifest,
  publishDistributedProducts,
  selectLatestBlockingPublishResult
} from "../dist/src/autolist/publish.js";

const canonicalIdentity = {
  batchFingerprint: "batch-1",
  recordId: "record-1",
  taskId: "task-1",
  shopCode: "01",
  watermarkNo: 1
};
const hermesRunnerSource = [
  "src/cli/auto-listing-controller-contract.ts",
  "src/cli/auto-listing-controller-runtime.ts",
  "src/cli/auto-listing-controller-status.ts",
  "src/cli/auto-listing-controller.ts"
].map((file) => fs.readFileSync(file, "utf8")).join("\n");
const autoListingCliSource = fs.readFileSync("src/cli/auto-listing.ts", "utf8");
const controllerProcessLivenessSource = fs.readFileSync("src/cli/controller-process-liveness.ts", "utf8");
const hermesSupervisorSource = fs.readFileSync("src/cli/auto-listing-supervisor.ts", "utf8");
const orchestratorSource = fs.readFileSync("src/autolist/orchestrator.ts", "utf8");
const processedCompletionRulesSource = fs.readFileSync("src/autolist/processed-completion-rules.ts", "utf8");
const publishSource = fs.readFileSync("src/autolist/publish.ts", "utf8");
const productListVerificationSource = fs.readFileSync("src/business/publish-from-spu/product-list-verification-action.ts", "utf8");
const publishSubmitPageActionSource = fs.readFileSync("src/business/publish-from-spu/publish-submit-page-action.ts", "utf8");
const publishAssetsSource = fs.readFileSync("src/business/publish-from-spu/assets.ts", "utf8");
const graphicPreviewSource = fs.readFileSync("src/business/publish-from-spu/graphic-section-preview-action.ts", "utf8");
const feishuAssetsSource = fs.readFileSync("src/feishu/assets.ts", "utf8");
const auditAutoListingSource = fs.readFileSync("src/cli/audit-auto-listing.ts", "utf8");
const resumeSource = fs.readFileSync("src/autolist/resume.ts", "utf8");
const browserLaunchSource = fs.readFileSync("src/browser/launch.ts", "utf8");
const packageSource = fs.readFileSync("package.json", "utf8");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "auto-listing-progress-split-"));

function record(recordId, whiteImage, qualificationImage) {
  return {
    recordId,
    userCognitionName: recordId,
    genericName: "凝胶",
    brand: "宝元堂",
    spu: recordId,
    sellingPointText: "测试卖点",
    shortTitle: "测试短标题",
    rawFields: {},
    whiteBackgroundImages: whiteImage
      ? [{ fileToken: `${recordId}-white`, name: path.basename(whiteImage), localFile: whiteImage, raw: {} }]
      : [],
    qualificationImages: qualificationImage
      ? [{ fileToken: `${recordId}-cert`, name: path.basename(qualificationImage), localFile: qualificationImage, raw: {} }]
      : []
  };
}

const continuityOk = auditAutoListingContinuity({
  records: [
    record("rec-1", "/work/input/auto-listing/feishu-images/product-1.png", "/work/input/auto-listing/qualifications/product-1-cert.png"),
    record("rec-2", "/work/input/auto-listing/feishu-images/product-2.png", "/work/input/auto-listing/qualifications/product-2-cert.png"),
    record("rec-3", "/work/input/auto-listing/feishu-images/product-3.png", "/work/input/auto-listing/qualifications/product-3-cert.png")
  ],
  processedImages: ["/work/input/auto-listing/feishu-images/product-1.png"],
  existingFiles: [
    "/work/input/auto-listing/feishu-images/product-2.png",
    "/work/input/auto-listing/feishu-images/product-3.png",
    "/work/input/auto-listing/qualifications/product-2-cert.png",
    "/work/input/auto-listing/qualifications/product-3-cert.png"
  ],
  discoveredRunImageCount: 2
});

assert.equal(continuityOk.ok, true);
assert.equal(continuityOk.summary.recordCount, 3);
assert.equal(continuityOk.summary.processedRecordCount, 1);
assert.equal(continuityOk.summary.pendingRecordCount, 2);

const duplicateWhiteLocalFileAudit = auditAutoListingContinuity({
  records: [
    record("rec-packaging-a", "/work/input/auto-listing/feishu-images/same-spu-product.png"),
    record("rec-packaging-b", "/work/input/auto-listing/feishu-images/same-spu-product.png")
  ],
  processedImages: [],
  existingFiles: ["/work/input/auto-listing/feishu-images/same-spu-product.png"]
});

assert.equal(duplicateWhiteLocalFileAudit.ok, false);
assert.ok(
  duplicateWhiteLocalFileAudit.errors.some((issue) => issue.code === "duplicate_white_image_local_file"),
  "Different Feishu product records must not share one local white-background image path"
);
assert.equal(
  hasSharedFeishuWhiteBackgroundLocalFile([
    record("rec-packaging-a", "/work/input/auto-listing/feishu-images/same-spu-product.png"),
    record("rec-packaging-b", "/work/input/auto-listing/feishu-images/same-spu-product.png")
  ]),
  true
);
assert.equal(
  hasSharedFeishuWhiteBackgroundLocalFile([
    record("rec-packaging-a", "/work/input/auto-listing/feishu-images/packaging-a.png"),
    record("rec-packaging-b", "/work/input/auto-listing/feishu-images/packaging-b.png")
  ]),
  false
);

const batchProgress = summarizeFeishuBatchProgress({
  records: [
    record("rec-1", "/work/input/auto-listing/feishu-images/product-1.png"),
    record("rec-2", "/work/input/auto-listing/feishu-images/product-2.png"),
    record("rec-3", "/work/input/auto-listing/feishu-images/product-3.png")
  ],
  processedImages: [
    "/work/input/auto-listing/feishu-images/product-1.png",
    "/work/input/auto-listing/feishu-images/product-2.png"
  ]
});

assert.deepEqual(batchProgress, {
  recordCount: 3,
  processedRecordCount: 2,
  pendingRecordCount: 1,
  pendingSourceImages: ["/work/input/auto-listing/feishu-images/product-3.png"],
  batchComplete: false
});
const completedBatchProgressWithoutLocalAssets = summarizeFeishuBatchProgress({
  records: [
    record("recv-done-1", ""),
    record("recv-done-2", "")
  ],
  processedImages: [
    "/work/input/auto-listing/feishu-images/批文-产品-recv-done-1-白底图-01-a.png",
    "/work/input/auto-listing/feishu-images/批文-产品-recv-done-2-白底图-01-b.png"
  ]
});
assert.deepEqual(
  completedBatchProgressWithoutLocalAssets,
  {
    recordCount: 2,
    processedRecordCount: 2,
    pendingRecordCount: 0,
    pendingSourceImages: [],
    batchComplete: true
  },
  "Completed Feishu records must stay completed when post-completion refresh cleanup removed local source asset declarations"
);

const completedContinuityWithoutLocalAssets = auditAutoListingContinuity({
  records: [record("recv-done-1", ""), record("recv-done-2", "")],
  processedImages: [
    "/work/input/auto-listing/feishu-images/批文-产品-recv-done-1-白底图-01-a.png",
    "/work/input/auto-listing/feishu-images/批文-产品-recv-done-2-白底图-01-b.png"
  ],
  existingFiles: [],
  discoveredRunImageCount: 0
});
assert.equal(
  completedContinuityWithoutLocalAssets.ok,
  true,
  "Continuity audit must not fail a completed record only because its downloaded source asset declaration was cleaned after completion"
);

const pendingFeishuSourceImages = resolvePendingFeishuProductSourceImagesFromRecords({
  records: [
    record("rec-1", "/work/input/auto-listing/feishu-images/product-1.png"),
    record("rec-2", "/work/input/auto-listing/feishu-images/product-2.png")
  ],
  processedImages: ["/work/input/auto-listing/feishu-images/product-1.png"],
  fileExists: (filePath) => filePath.endsWith("product-2.png")
});
assert.deepEqual(pendingFeishuSourceImages, [path.resolve("/work/input/auto-listing/feishu-images/product-2.png")]);
assert.deepEqual(
  resolvePendingFeishuProductSourceImagesFromRecords({
    records: [record("recv-done-1", "")],
    processedImages: ["/work/input/auto-listing/feishu-images/批文-产品-recv-done-1-白底图-01-a.png"],
    fileExists: () => false
  }),
  [],
  "Pending source resolution must not reopen completed records when only the local source asset declaration is missing"
);

assert.throws(
  () =>
    resolvePendingFeishuProductSourceImagesFromRecords({
      records: [
        record("rec-packaging-a", "/work/input/auto-listing/feishu-images/same-spu-product.png"),
        record("rec-packaging-b", "/work/input/auto-listing/feishu-images/same-spu-product.png")
      ],
      processedImages: [],
      fileExists: () => true
    }),
  /share one local white background image path/
);

assert.throws(
  () =>
    resolvePendingFeishuProductSourceImagesFromRecords({
      records: [
        record("rec-1", "/work/input/auto-listing/feishu-images/product-1.png"),
        record("rec-2", "/work/input/auto-listing/feishu-images/product-2.png")
      ],
      processedImages: ["/work/input/auto-listing/feishu-images/product-1.png"],
      fileExists: () => false
    }),
  /Feishu product row 2 \(rec-2\) white background image was missing/
);

const repeatedProductManifest = path.join(tempDir, "processed-images.json");
const repeatedBatchA = [
  record("rec-batch-a", "/work/input/auto-listing/feishu-images/same-product.png")
];
const repeatedBatchB = [
  record("rec-batch-b", "/work/input/auto-listing/feishu-images/same-product.png")
];
const repeatedBatchAFingerprint = buildFeishuBatchFingerprint(repeatedBatchA);
const repeatedBatchBFingerprint = buildFeishuBatchFingerprint(repeatedBatchB);

assert.notEqual(repeatedBatchAFingerprint, repeatedBatchBFingerprint);
appendProcessedImages(repeatedProductManifest, ["/work/input/auto-listing/feishu-images/same-product.png"], repeatedBatchAFingerprint);
assert.equal(readProcessedImages(repeatedProductManifest, repeatedBatchAFingerprint).has("/work/input/auto-listing/feishu-images/same-product.png"), true);
assert.equal(readProcessedImages(repeatedProductManifest, repeatedBatchBFingerprint).has("/work/input/auto-listing/feishu-images/same-product.png"), false);

const repeatedBatchProgress = summarizeFeishuBatchProgress({
  records: repeatedBatchB,
  processedImages: readProcessedImages(repeatedProductManifest, repeatedBatchBFingerprint)
});
assert.equal(repeatedBatchProgress.processedRecordCount, 0);
assert.equal(repeatedBatchProgress.pendingRecordCount, 1);
assert.equal(repeatedBatchProgress.batchComplete, false);

const legacyManifest = path.join(tempDir, "legacy-processed-images.json");
fs.writeFileSync(legacyManifest, JSON.stringify(["/work/input/auto-listing/feishu-images/legacy-product.png"]));
assert.throws(
  () => readProcessedImages(legacyManifest, repeatedBatchAFingerprint),
  /obsolete identity-free array format/,
  "an identity-free legacy processed list must not be attached to the current batch"
);
assert.throws(
  () => appendProcessedImages(path.join(tempDir, "identity-free-append.json"), ["/work/input/image.png"]),
  /explicit Feishu batch fingerprint/,
  "new processed-image entries require an explicit batch identity"
);

const appendMigratedManifest = path.join(tempDir, "append-migrated-processed-images.json");
appendProcessedImages(appendMigratedManifest, ["/work/input/auto-listing/feishu-images/current-batch-first.png"], repeatedBatchAFingerprint);
appendProcessedImages(appendMigratedManifest, ["/work/input/auto-listing/feishu-images/current-batch-second.png"], repeatedBatchAFingerprint);
assert.equal(readProcessedImages(appendMigratedManifest, repeatedBatchAFingerprint).has("/work/input/auto-listing/feishu-images/current-batch-first.png"), true);
assert.equal(readProcessedImages(appendMigratedManifest, repeatedBatchAFingerprint).has("/work/input/auto-listing/feishu-images/current-batch-second.png"), true);
assert.equal(readProcessedImages(appendMigratedManifest, repeatedBatchBFingerprint).has("/work/input/auto-listing/feishu-images/current-batch-first.png"), false);
assert.equal(clearProcessedImagesForBatch(appendMigratedManifest, repeatedBatchAFingerprint), true);
assert.equal(readProcessedImages(appendMigratedManifest, repeatedBatchAFingerprint).size, 0);
assert.equal(clearProcessedImagesForBatch(appendMigratedManifest, repeatedBatchAFingerprint), false);

assert.equal(
  shouldContinueFeishuBatchAfterChildExit({
    exitCode: 0,
    batchComplete: false
  }),
  true
);
assert.equal(
  shouldContinueFullFlowAfterChildExit({
    childMode: "resume",
    exitCode: 0,
    batchComplete: false
  }),
  true
);
assert.equal(shouldBlockFullFlowAfterSuccessfulChild({
  childMode: "resume", exitCode: 0, batchComplete: false,
  unresolvedPublishBoundary: true, resumePrepared: false
}), true);
assert.equal(shouldBlockFullFlowAfterSuccessfulChild({
  childMode: "resume", exitCode: 0, batchComplete: false,
  unresolvedPublishBoundary: true, resumePrepared: true
}), false);
assert.equal(
  shouldContinueFullFlowAfterChildExit({
    childMode: "full",
    exitCode: 0,
    batchComplete: false
  }),
  true
);
assert.equal(
  shouldContinueFeishuBatchAfterChildExit({
    exitCode: 1,
    batchComplete: false
  }),
  false
);
assert.equal(
  shouldContinueFeishuBatchAfterChildExit({
    exitCode: 0,
    batchComplete: true
  }),
  false
);
assert.equal(
  shouldContinueFeishuAfterBatchRefresh({
    exitCode: 0,
    currentBatchComplete: true,
    refreshedBatchChanged: true,
    refreshedBatchComplete: false
  }),
  true
);
assert.equal(
  shouldContinueFeishuAfterBatchRefresh({
    exitCode: 0,
    currentBatchComplete: true,
    refreshedBatchChanged: false,
    refreshedBatchComplete: false
  }),
  true
);
assert.equal(
  shouldContinueFeishuAfterBatchRefresh({
    exitCode: 0,
    currentBatchComplete: true,
    refreshedBatchChanged: true,
    refreshedBatchComplete: true
  }),
  false
);
assert.equal(
  shouldRefreshFeishuAssetsToCandidateCache({ currentBatchComplete: true }),
  true,
  "A post-completion Feishu refresh must write a candidate cache so invalid next records cannot overwrite the completed batch cache"
);
assert.equal(
  shouldRefreshFeishuAssetsToCandidateCache({ currentBatchComplete: false }),
  false,
  "An in-progress batch refresh may still update the main cache"
);
assert.equal(
  shouldRefreshFeishuAssetsBeforeFullFlow({
    continuationReason: "same_batch_pending"
  }),
  false
);
assert.equal(
  shouldRefreshFeishuAssetsBeforeFullFlow({
    continuationReason: "same_batch_pending",
    currentBatchComplete: false,
    sameBatchRefreshAvailable: true
  }),
  true,
  "Same-batch pending flow must refresh Feishu assets when online identity matches the locked local batch."
);
assert.equal(
  shouldRefreshFeishuAssetsBeforeFullFlow({
    continuationReason: "same_batch_pending",
    currentBatchComplete: false,
    sameBatchRefreshAvailable: false,
    localAssetCacheUnsafe: true
  }),
  true,
  "Same-batch pending flow must refresh Feishu assets when local attachment cache has cross-record path collisions."
);
assert.equal(
  shouldRefreshFeishuAssetsBeforeFullFlow({
    continuationReason: "new_batch_after_refresh"
  }),
  false
);
assert.equal(
  shouldRefreshFeishuAssetsBeforeFullFlow({
    continuationReason: "initial_full",
    currentBatchComplete: true
  }),
  true
);
assert.equal(
  shouldRefreshFeishuAssetsBeforeFullFlow({
    continuationReason: "initial_full",
    currentBatchComplete: false
  }),
  false
);
assert.equal(
  shouldRefreshFeishuAssetsBeforeFullFlow({
    continuationReason: "initial_full",
    currentBatchComplete: false,
    sameBatchRefreshAvailable: true
  }),
  true
);
assert.equal(
  shouldPreferActiveTaskStateSummary({
    running: true,
    stateHasActiveTask: true,
    publishProgressAvailable: true
  }),
  true
);
assert.equal(
  shouldPreferActiveTaskStateSummary({
    running: true,
    stateHasActiveTask: true,
    publishProgressAvailable: false
  }),
  true,
  "A running current task must suppress stale publish-log progress even before the current runtime has a publish manifest"
);
assert.equal(resolveImageDownloadTimeoutMs(180000), 180000);
assert.equal(resolveImageDownloadTimeoutMs(10000), 30000);
assert.equal(resolveImageGenerationRequestDeadlineMs(180000), 210000);
assert.equal(resolveImageGenerationRequestDeadlineMs(10000), 60000);
assert.equal(
  resolveVideosBase64SubmitTimeoutMs(undefined, undefined),
  180000,
  "videos-base64 accepted task polling must default to the project three-minute ceiling"
);
assert.equal(
  resolveVideosBase64SubmitTimeoutMs(180000, 1800000),
  180000,
  "videos-base64 accepted task polling must cap configured provider waits at three minutes"
);
assert.deepEqual(resolveImageGenerationTransportRetryPolicy(undefined), {
  maxRetries: 8,
  delayMs: [3000, 6000, 12000, 24000, 45000, 45000, 45000, 45000]
});
assert.deepEqual(resolveImageGenerationTransportRetryPolicy(2), {
  maxRetries: 8,
  delayMs: [3000, 6000, 12000, 24000, 45000, 45000, 45000, 45000]
});
assert.equal(resolveImageGenerationTransportRetryPolicy(10).maxRetries, 10);
assert.equal(
  selectAutoListingControllerStatusResultFile({
    running: false,
    expected: { resultFile: "old-resume-result.json", mtimeMs: 100 },
    log: { resultFile: "new-supervisor-child-result.json", mtimeMs: 300 },
    latest: { resultFile: "latest-result.json", mtimeMs: 200 }
  }),
  "new-supervisor-child-result.json"
);
assert.equal(
  selectAutoListingControllerStatusResultFile({
    running: true,
    expected: { resultFile: "old-resume-result.json", mtimeMs: 100 },
    log: { resultFile: "active-child-result.json", mtimeMs: 300 },
    latest: { resultFile: "latest-result.json", mtimeMs: 400 }
  }),
  "active-child-result.json"
);
assert.equal(
  shouldUseExpectedResultFileInRunningStatus({
    running: true,
    activeRuntimeDir: "/runs/active"
  }),
  false
);
assert.equal(
  shouldUseExpectedResultFileInRunningStatus({
    running: true
  }),
  true
);
assert.equal(
  shouldClearPauseSignalOnAutoListingControllerStart({
    pauseSignalExists: true,
    runnerJobRunning: true
  }),
  true,
  "AutoListingController continue/start must cancel a pending pause even while the previous child is still between safe checkpoints"
);
assert.equal(
  shouldClearPauseSignalOnAutoListingControllerStart({
    pauseSignalExists: true,
    runnerJobRunning: false
  }),
  true
);
assert.equal(
  shouldClearPauseSignalOnAutoListingControllerStart({
    pauseSignalExists: false,
    runnerJobRunning: true
  }),
  false
);
assert.equal(
  selectAutoListingControllerActiveRunIdFromLogLines([
    "[2026-05-27T15:28:45.848Z] [info] auto-listing run started: 20260527-035110",
    "... many later lines ...",
    "[2026-05-27T17:41:03.831Z] [info] auto-listing run started: 20260528-014103",
    "[2026-05-28T02:12:13.117Z] [info] Prompt 5/5: Image 1: submitting edits request."
  ]),
  "20260528-014103"
);
assert.equal(
  shouldExposePublishProgressInAutoListingControllerStatus({
    running: true,
    publishProgressAvailable: true,
    currentTaskStatus: "main_images_generated",
    stateProgressTimestamp: "2026-05-28T02:12:13.117Z",
    publishProgressTimestamp: "2026-05-28T01:20:48.812Z"
  }),
  false
);
assert.equal(
  shouldExposePublishProgressInAutoListingControllerStatus({
    running: false,
    publishProgressAvailable: true,
    currentTaskStatus: "failed",
    currentTaskRecordId: "rec-current-main-image",
    publishRecordId: "rec-previous-published"
  }),
  false,
  "A stopped main-image failure must not inherit the previous Feishu product's publish manifest."
);
assert.equal(
  shouldExposePublishProgressInAutoListingControllerStatus({
    running: false,
    publishProgressAvailable: true,
    currentTaskStatus: "failed",
    currentTaskRecordId: "rec-current-publish",
    publishRecordId: "rec-current-publish"
  }),
  true,
  "A stopped publish failure may retain a publish checkpoint only when both artifacts identify the same Feishu product."
);
assert.equal(
  shouldExposePublishProgressInAutoListingControllerStatus({
    running: true,
    publishProgressAvailable: true,
    currentTaskStatus: "published",
    stateProgressTimestamp: "2026-05-28T02:12:13.117Z",
    publishProgressTimestamp: "2026-05-28T02:13:13.117Z"
  }),
  true
);
assert.equal(
  shouldRetainStoppedControllerPublishCheckpoint({
    controllerStatus: "pause_requested",
    currentTaskStatus: "published",
    publishProgressAvailable: true
  }),
  true,
  "A pause result written after the publish manifest must retain the current product checkpoint instead of falling back to paid-image progress."
);
assert.equal(
  shouldRetainStoppedControllerPublishCheckpoint({
    controllerStatus: "pause_requested",
    currentTaskStatus: "main_images_generated",
    publishProgressAvailable: true
  }),
  false,
  "A paused image-generation task must not expose a stale prior-product publish manifest."
);
assert.equal(
  selectAutoListingControllerStatusRuntimeDir({
    running: true,
    activeRuntimeDir: "/runs/active",
    resultRuntimeDir: "/runs/stale-result",
    resultFile: "/runs/stale-result/result.json"
  }),
  "/runs/active"
);
assert.equal(
  selectAutoListingControllerStatusRuntimeDir({
    running: false,
    activeRuntimeDir: "/runs/old-active",
    resultRuntimeDir: "/runs/latest-result",
    resultFile: "/runs/latest-result/result.json"
  }),
  "/runs/latest-result"
);
assert.equal(
  isAutoListingControllerSupervisorProcessCommand("node dist/src/cli/auto-listing-supervisor.js --initial full"),
  true
);
assert.equal(
  isAutoListingControllerChildProcessCommand(
    "npm run business:auto-listing --job /work/input/auto-listing/auto-listing.job.mac-feishu-real.resume.generated.json --allow-real"
  ),
  true
);
assert.equal(isAutoListingControllerChildProcessCommand("node dist/src/cli/flow-mac-feishu.js --real"), true);
assert.equal(isAutoListingControllerChildProcessCommand("node dist/src/cli/auto-listing.js --job unrelated.json"), false);
assert.equal(
  isAutoListingDirectRunProcessCommand("node dist/src/cli/auto-listing.js --job input/auto-listing/after-duzhong-continue.job.json --allow-real"),
  true,
  "Hermes status must recognize a real project auto-listing process even when it was launched outside the controller wrapper."
);
assert.equal(
  isAutoListingDirectRunProcessCommand("node dist/src/cli/auto-listing.js --job unrelated.json --allow-real"),
  false,
  "Hermes status must not treat arbitrary auto-listing commands as the active project run."
);
assert.equal(isAutoListingControllerSupervisorProcessCommand("/usr/bin/yes 9485"), false);
assert.equal(
  isAutoListingControllerRunningProcessConfirmed({
    pidAlive: true,
    command: undefined
  }),
  false,
  "AutoListingController status must not treat an unreadable/stale PID as an active supervisor."
);
assert.equal(
  isAutoListingControllerRunningProcessConfirmed({
    pidAlive: true,
    processGroupAlive: true,
    command: undefined
  }),
  true,
  "AutoListingController status must use the detached supervisor process group when sandboxing blocks command inspection."
);
assert.equal(
  isAutoListingControllerRunningProcessConfirmed({
    pidAlive: true,
    command: "node dist/src/cli/auto-listing-supervisor.js --initial full"
  }),
  true
);
assert.equal(
  shouldTreatControllerSupervisorAsInert({
    processConfirmed: true,
    childProcessRecorded: false,
    waitStateRecorded: false,
    terminalResultFound: true,
    terminalResultAgeMs: 7 * 60 * 60 * 1000,
    controllerLogAdvancedAfterTerminalResult: false
  }),
  true,
  "A supervisor kept alive only by leaked handles after its child wrote a terminal result must be recycled"
);
assert.equal(
  shouldTreatControllerSupervisorAsInert({
    processConfirmed: true,
    childProcessRecorded: false,
    waitStateRecorded: true,
    terminalResultFound: true,
    terminalResultAgeMs: 7 * 60 * 60 * 1000,
    controllerLogAdvancedAfterTerminalResult: false
  }),
  false,
  "A supervisor in an explicit external-service or Doudian-login wait remains active"
);
assert.equal(
  shouldTreatControllerSupervisorAsInert({
    processConfirmed: true,
    childProcessRecorded: true,
    waitStateRecorded: false,
    terminalResultFound: true,
    terminalResultAgeMs: 7 * 60 * 60 * 1000,
    controllerLogAdvancedAfterTerminalResult: false
  }),
  false,
  "A supervisor with a recorded child must not be recycled by the terminal-result heuristic"
);
assert.match(
  hermesRunnerSource,
  /cleanupInertControllerSupervisor\([\s\S]*cleanupRecordedAutoListingControllerChild\(\)/,
  "Continue/start must recycle an inert supervisor before cleaning stale child control and launching replacement work"
);
assert.match(
  controllerProcessLivenessSource,
  /isAutoListingControllerSupervisorProcessCommand[\s\S]*process\.kill\(-job\.pid,\s*"SIGTERM"\)/,
  "Inert supervisor cleanup must verify the exact project supervisor command before terminating its process group"
);
assert.match(
  hermesRunnerSource,
  /resolveAutoListingControllerBatchOwnership\([\s\S]*cleanupSupersededWaitingController\([\s\S]*if \(current && runnerJobRunning\)/,
  "Continue must transfer ownership from a different-batch wait-only controller before applying already-running reuse"
);
assert.match(
  controllerProcessLivenessSource,
  /cleanupSupersededWaitingController[\s\S]*controllerOwnsWaitState[\s\S]*controllerChildActive[\s\S]*cleanupInertControllerSupervisor/,
  "Supersession must be limited to a verified wait-only supervisor with no active child"
);
assert.match(
  hermesSupervisorSource,
  /waitForDoudianLoginRecovery[\s\S]*resolveAutoListingSupervisorBatchOwnership[\s\S]*stop_superseded_batch[\s\S]*assertDoudianPublishSessionReady/,
  "Login recovery must revalidate locked batch ownership before probing the browser or resuming work"
);
const inertCleanupSource = controllerProcessLivenessSource.slice(
  controllerProcessLivenessSource.indexOf("export async function cleanupInertControllerSupervisor")
);
assert.doesNotMatch(
  inertCleanupSource,
  /isControllerRunnerJobRunning/,
  "Cleanup must consume the controller's already-established inert decision instead of racing a second liveness classification"
);
const compactFailedStatus = formatAutoListingControllerCompactStatusText({
  status: "failed",
  summary: "发布基础信息未完成：Expected short-title field is missing from the SPU-prefilled publish page.；系统会按发布页控件未就绪处理并重试。",
  productName: "湘械注准20212140518-医用面部生物膜-白底图-01.png",
  publishSafelyPublished: 14,
  publishTotal: 20,
  publishFailed: 1,
  feishuCompleted: 2,
  feishuTotal: 3
});
assert.deepEqual(
  compactFailedStatus.split("\n"),
  [
    "状态：失败｜发布已完成 14/20｜当前目标 15/20｜当前店铺 15/20｜飞书批次已完成 2/3",
    "商品：医用面部生物膜",
    "原因：导购短标题字段缺失，已停止，可续跑。"
  ],
  "AutoListingController text status must be short, Chinese, and accurate for terminal publish failures"
);
assert.equal(/生图最近保存|运行批次|failed at|系统会按/.test(compactFailedStatus), false);
const compactImageGenerationStatus = formatAutoListingControllerCompactStatusText({
  status: "running",
  summary: "任务正在运行，当前阶段：main_images_generated",
  productName: "湘械注准20212141818-医用芦荟凝胶-白底图-01.png",
  imageGenerationProgress: "Prompt 5/5: Image 4: videos-base64 task task_O0UjYIbz9zHAJ8mCnoHszjLxdkLq7wBM status queued 0.",
  mainImageCompleted: 15,
  publishSafelyPublished: 0,
  publishTotal: 20,
  publishFailed: 0,
  feishuCompleted: 0,
  feishuTotal: 4
});
assert.equal(
  formatAutoListingControllerCompactStatusText({
    status: "running",
    imageGenerationProgress: "Prompt 5/5: Image 4: submitting videos-base64 request.",
    feishuCompleted: 1,
    feishuTotal: 7
  }).split("\n")[0],
  "状态：运行中｜提交槽位 20/20｜飞书批次已完成 1/7",
  "A submission slot index must not be reported as a completed main-image count before ledger completion is available"
);
assert.deepEqual(
  compactImageGenerationStatus.split("\n"),
  [
    "状态：运行中｜主图 15/20｜飞书批次已完成 0/4",
    "当前：医用芦荟凝胶",
    "进度：等待图片服务队列：第 5/5 组，第 4 张，任务 task_O0UjYIbz9zHAJ8mCnoHszjLxdkLq7wBM 排队中"
  ],
  "AutoListingController text status must use completed paid-ledger slots instead of the currently polled slot ordinal"
);
assert.deepEqual(
  formatAutoListingControllerCompactStatusText({
    status: "running",
    summary: "任务正在运行，当前阶段：main_images_generated",
    productName: "喜维他牌B族维生素片-B族维生素片-recvntth27DUyf-白底图-01-2a63110e80.png",
    imageGenerationProgress: "Prompt 2/5: Image 1: videos-base64 task task_U8RAbBSpF6hMeYzVVVOARoLKQ9m5zWMa status queued 0.",
    mainImageCompleted: 11,
    latestProgress: "发布模块：最终提交（10延草纲目养生器械专营店）",
    feishuProductIndex: 4,
    feishuTotal: 4
  }).split("\n"),
  [
    "状态：运行中｜主图 11/20｜飞书当前第 4/4",
    "当前：B族维生素片-recvntth27DUyf-白底图-01-2a63110e80",
    "进度：等待图片服务队列：第 2/5 组，第 1 张，任务 task_U8RAbBSpF6hMeYzVVVOARoLKQ9m5zWMa 排队中"
  ],
  "Image generation progress must suppress stale publish-log progress while the active task is generating main images"
);
assert.equal(
  formatAutoListingControllerCompactStatusText({
    status: "running",
    summary: "Task chain completed.",
    latestProgress: "Task chain completed.",
    productName: "延草纲目喜维他牌族维生素片(菠萝味)",
    publishProductIndex: 20,
    publishProductTotal: 20,
    publishShopIndex: 10,
    publishShopTotal: 10,
    feishuCompleted: 4,
    feishuTotal: 4
  }).split("\n").at(-1),
  "进度：任务链已完成",
  "Text status must translate completed task-chain progress into Chinese"
);
assert.equal(
  resolveAutoListingControllerPaidImageRecordId({
    currentTaskRecordId: "",
    feishuCurrentProductRecordId: "rec-current"
  }),
  "rec-current",
  "Resume startup must use the current Feishu product identity when compact task state has not restored recordId yet"
);
const compactPublishStageStatus = formatAutoListingControllerCompactStatusText({
  status: "running",
  summary: "任务正在运行，当前阶段：published",
  productName: "延草纲目宝元堂痛风医用远红外治疗凝胶",
  activeItemName: "延草纲目宝元堂痛风医用远红外治疗凝胶水印11",
  imageGenerationProgress: "Main images ready: 20 file(s).",
  latestProgress: "发布模块：基础信息（06延草纲目理疗器械旗舰店）",
  publishSafelyPublished: 10,
  publishProductIndex: 11,
  publishProductTotal: 20,
  publishShopIndex: 6,
  publishShopTotal: 10,
  feishuCompleted: 0,
  feishuTotal: 2
});
assert.deepEqual(
  compactPublishStageStatus.split("\n"),
  [
    "状态：运行中｜发布已完成 10/20｜当前目标 11/20｜当前店铺 6/10｜飞书批次已完成 0/2",
    "当前：延草纲目宝元堂痛风医用远红外治疗凝胶",
    "进度：发布模块：基础信息（06延草纲目理疗器械旗舰店）"
  ],
  "AutoListingController text status must show publish progress during publish stage instead of stale image generation progress"
);
assert.equal(/Main images ready/.test(compactPublishStageStatus), false);
const compactManualRecoveryPublishStatus = formatAutoListingControllerCompactStatusText({
  status: "running",
  summary: "当前商品：延草纲目医用透明质酸钠修护贴，发布 20/20，店铺 10/10",
  productName: "延草纲目医用透明质酸钠修护贴",
  activeItemName: "延草纲目医用透明质酸钠修护贴-recvnhdPKe0cNN-水印20",
  latestProgress: "延草纲目医用透明质酸钠修护贴-recvnhdPKe0cNN-水印20: basic_info_fill: basic_info_fill_attempt: 1",
  publishSafelyPublished: 19,
  publishProductIndex: 20,
  publishProductTotal: 20,
  publishShopIndex: 10,
  publishShopTotal: 10,
  feishuCompleted: 0,
  feishuTotal: 0
});
assert.deepEqual(
  compactManualRecoveryPublishStatus.split("\n"),
  [
    "状态：运行中｜发布已完成 19/20｜当前目标 20/20｜当前店铺 10/10｜飞书批次待确认",
    "当前：延草纲目医用透明质酸钠修护贴",
    "进度：延草纲目医用透明质酸钠修护贴-recvnhdPKe0cNN-水印20: basic_info_fill: basic_info_fill_attempt: 1"
  ],
  "Manual republish recovery status must show the product name instead of the Feishu record id."
);
const compactPlatformFailedStatus = formatAutoListingControllerCompactStatusText({
  status: "failed",
  summary:
    "Publish failed for /work/shop/product-1: Platform SPU query page was not ready after navigation: Platform SPU query controls are incomplete.",
  productName: "湘械注准20212140518-医用面部生物膜-白底图-01.png",
  publishSafelyPublished: 14,
  publishTotal: 20,
  publishFailed: 1,
  feishuCompleted: 2,
  feishuTotal: 3
});
assert.deepEqual(
  compactPlatformFailedStatus.split("\n"),
  [
    "状态：失败｜发布已完成 14/20｜当前目标 15/20｜当前店铺 15/20｜飞书批次已完成 2/3",
    "商品：医用面部生物膜",
    "原因：标品检索页控件未加载完整，已停止，可续跑。"
  ],
  "AutoListingController text status must summarize Platform SPU query readiness failures without long local paths"
);

const groupedPublishProgress = resolveAutoListingControllerPublishGroupProgress({
  entries: [
    ...Array.from({ length: 20 }, (_, index) => ({
      batchFingerprint: "batch-grouped-progress",
      recordId: "record-pain-gel",
      taskId: "task-pain-gel",
      productFolder: `/shops/${String(Math.floor(index / 2) + 1).padStart(2, "0")}店/延草纲目医用疼痛凝胶水印${String(index + 1).padStart(2, "0")}`,
      shopFolder: `/shops/${String(Math.floor(index / 2) + 1).padStart(2, "0")}店`,
      watermarkNo: index + 1,
      status: "published",
      finalVerifyStatus: "publish_signal_confirmed",
      updatedAt: `2026-06-13T20:${String(index).padStart(2, "0")}:00.000Z`
    })),
    ...Array.from({ length: 20 }, (_, index) => ({
      batchFingerprint: "batch-grouped-progress",
      recordId: "record-collagen-ointment",
      taskId: "task-collagen-ointment",
      productFolder: `/shops/${String(Math.floor(index / 2) + 1).padStart(2, "0")}店/延草纲目医用重组胶原蛋白护理软膏水印${String(index + 1).padStart(2, "0")}`,
      shopFolder: `/shops/${String(Math.floor(index / 2) + 1).padStart(2, "0")}店`,
      watermarkNo: index + 1,
      status: "published",
      finalVerifyStatus: "publish_signal_confirmed",
      updatedAt: `2026-06-13T21:${String(index).padStart(2, "0")}:00.000Z`
    })),
    ...Array.from({ length: 20 }, (_, index) => ({
      batchFingerprint: "batch-grouped-progress",
      recordId: "record-far-infrared-patch",
      taskId: "task-far-infrared-patch",
      productFolder: `/shops/${String(Math.floor(index / 2) + 1).padStart(2, "0")}店/延草纲目遠紅外治療貼水印${String(index + 1).padStart(2, "0")}`,
      shopFolder: `/shops/${String(Math.floor(index / 2) + 1).padStart(2, "0")}店`,
      watermarkNo: index + 1,
      status: "published",
      finalVerifyStatus: "publish_signal_confirmed",
      updatedAt: `2026-06-13T22:${String(index).padStart(2, "0")}:00.000Z`
    }))
  ]
});
assert.deepEqual(
  groupedPublishProgress,
  {
    recordId: "record-far-infrared-patch",
    productName: "延草纲目遠紅外治療貼",
    completed: 20,
    productIndex: 20,
    productTotal: 20,
    shopName: "10店",
    shopIndex: 10,
    shopTotal: 10,
    failed: 0
  },
  "AutoListingController publish display must reset cumulative manifests to the current 20-item product group"
);
const compactCompletedGroupedStatus = formatAutoListingControllerCompactStatusText({
  status: "completed",
  summary: "当前飞书批次已全部处理完成。",
  productName: groupedPublishProgress.productName,
  publishSafelyPublished: 60,
  publishTotal: 60,
  publishFailed: 0,
  publishProductIndex: groupedPublishProgress.productIndex,
  publishProductTotal: groupedPublishProgress.productTotal,
  publishShopIndex: groupedPublishProgress.shopIndex,
  publishShopTotal: groupedPublishProgress.shopTotal,
  feishuProductIndex: 4,
  feishuCompleted: 5,
  feishuTotal: 5
});
assert.equal(
  compactCompletedGroupedStatus,
  "状态：完成｜已上架 20/20\n商品：延草纲目遠紅外治療貼\n结果：飞书批次已完成 5/5。",
  "Hermes-facing compact text must not expose cumulative publish totals such as 60/60"
);
assert.equal(/发布 60\/60/.test(compactCompletedGroupedStatus), false);

const sameNameDifferentRecordProgress = resolveAutoListingControllerPublishGroupProgress({
  entries: [
    ...Array.from({ length: 20 }, (_, index) => ({
      targetIdentity: { batchFingerprint: "batch-current", recordId: "recvpy6bua9U6N", taskId: "image-001" },
      runtimeKey: `old-${index + 1}`,
      productFolder: `/shops/${index + 1}/延草纲目医用重组胶原蛋白护理软膏-recvpy6bua9U6N-水印${index + 1}`,
      watermarkNo: index + 1,
      status: "published",
      finalVerifyStatus: "publish_signal_confirmed"
    })),
    ...Array.from({ length: 7 }, (_, index) => ({
      targetIdentity: { batchFingerprint: "batch-current", recordId: "recvpyc5el2oG7", taskId: "image-003" },
      runtimeKey: `current-${index + 1}`,
      productFolder: `/shops/${index + 1}/延草纲目医用重组胶原蛋白护理软膏-recvpyc5el2oG7-水印${index + 1}`,
      watermarkNo: index + 1,
      status: "published",
      finalVerifyStatus: "publish_signal_confirmed"
    }))
  ],
  planEntries: Array.from({ length: 20 }, (_, index) => ({
    targetIdentity: { batchFingerprint: "batch-current", recordId: "recvpyc5el2oG7", taskId: "image-003" },
    runtimeKey: `current-${index + 1}`,
    productFolder: `/shops/${index + 1}/延草纲目医用重组胶原蛋白护理软膏-recvpyc5el2oG7-水印${index + 1}`,
    watermarkNo: index + 1
  })),
  activeRuntimeKey: "current-8"
});
assert.equal(sameNameDifferentRecordProgress.completed, 7);
assert.equal(sameNameDifferentRecordProgress.productIndex, 8);
assert.equal(sameNameDifferentRecordProgress.productTotal, 20);

const progressIdentity = (recordId) => ({
  targetIdentity: { batchFingerprint: "batch-progress-regression", recordId, taskId: `task-${recordId}` }
});

const completedResumeOutOfOrderProgress = resolveAutoListingControllerPublishGroupProgress({
  entries: Array.from({ length: 20 }, (_, index) => ({
    ...progressIdentity("record-completed-resume"),
    productFolder: `/shops/${String(index + 1).padStart(2, "0")}店/延草纲目宝元堂医用疼痛凝胶水印${String(index + 1).padStart(2, "0")}`,
    shopFolder: `/shops/${String(index + 1).padStart(2, "0")}店`,
    watermarkNo: index + 1,
    status: "published",
    finalVerifyStatus: "publish_signal_confirmed",
    updatedAt: index === 18 ? "2026-07-15T08:45:00.000Z" : `2026-07-15T07:${String(index).padStart(2, "0")}:00.000Z`
  })),
  planEntries: Array.from({ length: 20 }, (_, index) => ({
    ...progressIdentity("record-completed-resume"),
    productFolder: `/shops/${String(index + 1).padStart(2, "0")}店/延草纲目宝元堂医用疼痛凝胶水印${String(index + 1).padStart(2, "0")}`,
    shopFolder: `/shops/${String(index + 1).padStart(2, "0")}店`,
    watermarkNo: index + 1
  }))
});
assert.deepEqual(
  completedResumeOutOfOrderProgress,
  {
    recordId: "record-completed-resume",
    productName: "延草纲目宝元堂医用疼痛凝胶",
    completed: 20,
    productIndex: 20,
    productTotal: 20,
    shopName: "20店",
    shopIndex: 20,
    shopTotal: 20,
    failed: 0
  },
  "a completed out-of-order resume must report full terminal progress instead of the last replayed watermark"
);

const partialManifestWithFullPublishPlanProgress = resolveAutoListingControllerPublishGroupProgress({
  entries: Array.from({ length: 9 }, (_, index) => ({
    ...progressIdentity("record-partial-plan"),
    productFolder: `/shops/${String(Math.floor(index / 2) + 1).padStart(2, "0")}店/延草纲目宝元堂痛风医用远红外治疗凝胶水印${String(index + 1).padStart(2, "0")}`,
    shopFolder: `/shops/${String(Math.floor(index / 2) + 1).padStart(2, "0")}店`,
    watermarkNo: index + 1,
    status: index === 8 ? "pending" : "published",
    finalVerifyStatus: index === 8 ? "not_checked" : "publish_signal_confirmed",
    updatedAt: `2026-06-14T03:${String(index).padStart(2, "0")}:00.000Z`
  })),
  planEntries: Array.from({ length: 20 }, (_, index) => ({
    ...progressIdentity("record-partial-plan"),
    productFolder: `/shops/${String(Math.floor(index / 2) + 1).padStart(2, "0")}店/延草纲目宝元堂痛风医用远红外治疗凝胶水印${String(index + 1).padStart(2, "0")}`,
    runtimeKey: `${String(Math.floor(index / 2) + 1).padStart(2, "0")}店__延草纲目宝元堂痛风医用远红外治疗凝胶水印${String(index + 1).padStart(2, "0")}`
  })),
  activeRuntimeKey: "05店__延草纲目宝元堂痛风医用远红外治疗凝胶水印09"
});
assert.deepEqual(
  partialManifestWithFullPublishPlanProgress,
  {
    recordId: "record-partial-plan",
    productName: "延草纲目宝元堂痛风医用远红外治疗凝胶",
    completed: 8,
    productIndex: 9,
    productTotal: 20,
    shopName: "05店",
    shopIndex: 5,
    shopTotal: 10,
    failed: 0
  },
  "AutoListingController publish display must use the full publish plan for shop total instead of currently touched shops"
);

const medicalResumeWithRemainingPlanProgress = resolveAutoListingControllerPublishGroupProgress({
  entries: Array.from({ length: 11 }, (_, index) => ({
    targetIdentity: { batchFingerprint: "batch-medical", recordId: "recv-medical", taskId: "image-001" },
    productFolder: `/shops/${String(index + 1).padStart(2, "0")}店/延草纲目医用敷料-recv-medical-水印${String(index + 1).padStart(2, "0")}`,
    shopFolder: `/shops/${String(index + 1).padStart(2, "0")}店`,
    runtimeKey: `medical-${index + 1}`,
    watermarkNo: index + 1,
    status: index === 10 ? "pending" : "published",
    finalVerifyStatus: index === 10 ? "not_checked" : "publish_signal_confirmed",
    updatedAt: `2026-08-02T10:${String(index).padStart(2, "0")}:00.000Z`
  })),
  planEntries: Array.from({ length: 13 }, (_, index) => ({
    targetIdentity: { batchFingerprint: "batch-medical", recordId: "recv-medical", taskId: "image-001" },
    productFolder: `/shops/${String(index + 8).padStart(2, "0")}店/延草纲目医用敷料-recv-medical-水印${String(index + 8).padStart(2, "0")}`,
    shopFolder: `/shops/${String(index + 8).padStart(2, "0")}店`,
    runtimeKey: `medical-${index + 8}`,
    watermarkNo: index + 8
  })),
  activeRuntimeKey: "medical-11"
});
assert.equal(medicalResumeWithRemainingPlanProgress.shopIndex, 11);
assert.equal(
  medicalResumeWithRemainingPlanProgress.shopTotal,
  20,
  "A medical-device resume must combine historical manifest shops with the remaining plan instead of reporting remaining-plan length as the full shop total"
);
const resumedHistoricalFailureShopNames = [
  "01延草纲目大药房专营店",
  "02延草纲目药品专营店",
  "03延草纲目个护保健专营店",
  "04延草纲目康复理疗专营店",
  "05延草纲目医疗保健专营店",
  "06延草纲目理疗器械旗舰店",
  "07延草纲目健康护理专营店",
  "08延草纲目家庭护理专营店",
  "09延草纲目中医保健专营店",
  "10延草纲目养生器械专营店"
];
const resumedPublishWithHistoricalFutureFailuresProgress = resolveAutoListingControllerPublishGroupProgress({
  entries: [
    ...Array.from({ length: 2 }, (_, index) => ({
      ...progressIdentity("record-resumed-historical"),
      productFolder: `/shops/01延草纲目大药房专营店/延草纲目远红外磁疗舒痛贴水印${String(index + 1).padStart(2, "0")}`,
      shopFolder: "/shops/01延草纲目大药房专营店",
      runtimeKey: `01延草纲目大药房专营店__延草纲目远红外磁疗舒痛贴水印${String(index + 1).padStart(2, "0")}`,
      watermarkNo: index + 1,
      status: "published",
      finalVerifyStatus: "publish_signal_confirmed",
      updatedAt: `2026-06-18T16:1${index + 4}:00.000Z`
    })),
    {
      ...progressIdentity("record-resumed-historical"),
      productFolder: "/shops/02延草纲目药品专营店/延草纲目远红外磁疗舒痛贴水印03",
      shopFolder: "/shops/02延草纲目药品专营店",
      runtimeKey: "02延草纲目药品专营店__延草纲目远红外磁疗舒痛贴水印03",
      watermarkNo: 3,
      status: "pending",
      finalVerifyStatus: "not_checked",
      updatedAt: "2026-06-18T16:18:27.102Z"
    },
    ...Array.from({ length: 17 }, (_, index) => {
      const watermarkNo = index + 4;
      const shopName = resumedHistoricalFailureShopNames[Math.floor((watermarkNo - 1) / 2)];
      return {
        ...progressIdentity("record-resumed-historical"),
        productFolder: `/shops/${shopName}/延草纲目远红外磁疗舒痛贴水印${String(watermarkNo).padStart(2, "0")}`,
        shopFolder: `/shops/${shopName}`,
        runtimeKey: `${shopName}__延草纲目远红外磁疗舒痛贴水印${String(watermarkNo).padStart(2, "0")}`,
        watermarkNo,
        status: "failed",
        finalVerifyStatus: "needs_manual_review",
        updatedAt: `2026-06-18T13:${String(watermarkNo).padStart(2, "0")}:00.000Z`
      };
    })
  ],
  activeRuntimeKey: "02延草纲目药品专营店__延草纲目远红外磁疗舒痛贴水印03"
});
assert.deepEqual(
  resumedPublishWithHistoricalFutureFailuresProgress,
  {
    recordId: "record-resumed-historical",
    productName: "延草纲目远红外磁疗舒痛贴",
    completed: 2,
    productIndex: 3,
    productTotal: 20,
    shopName: "02延草纲目药品专营店",
    shopIndex: 2,
    shopTotal: 10,
    failed: 0
  },
  "AutoListingController publish display must ignore older future-watermark failures once a newer resume attempt is active"
);
const compactResumedPublishWithHistoricalFutureFailuresStatus = formatAutoListingControllerCompactStatusText({
  status: "running",
  summary: "当前商品：延草纲目远红外磁疗舒痛贴，发布 3/20，店铺 2/10",
  productName: resumedPublishWithHistoricalFutureFailuresProgress.productName,
  latestProgress: "发布模块：服务履约（02延草纲目药品专营店）",
  publishProductIndex: resumedPublishWithHistoricalFutureFailuresProgress.productIndex,
  publishSafelyPublished: resumedPublishWithHistoricalFutureFailuresProgress.completed,
  publishProductTotal: resumedPublishWithHistoricalFutureFailuresProgress.productTotal,
  publishShopIndex: resumedPublishWithHistoricalFutureFailuresProgress.shopIndex,
  publishShopTotal: resumedPublishWithHistoricalFutureFailuresProgress.shopTotal,
  publishFailed: resumedPublishWithHistoricalFutureFailuresProgress.failed,
  publishFailedWatermarkNo: resumedPublishWithHistoricalFutureFailuresProgress.failedWatermarkNo,
  feishuProductIndex: 1,
  feishuTotal: 4
});
assert.equal(
  compactResumedPublishWithHistoricalFutureFailuresStatus.split("\n")[0],
  "状态：运行中｜发布已完成 2/20｜当前目标 3/20｜当前店铺 2/10｜飞书当前第 1/4",
  "Hermes compact status must not display historical future failures while an earlier watermark is actively being retried"
);
assert.doesNotMatch(compactResumedPublishWithHistoricalFutureFailuresStatus, /失败项|20\/20|10\/10/);
const failedMiddleWithLaterPublishedProgress = resolveAutoListingControllerPublishGroupProgress({
  entries: [
    ...Array.from({ length: 15 }, (_, index) => ({
      ...progressIdentity("record-failed-middle"),
      productFolder: `/shops/${String(Math.floor(index / 2) + 1).padStart(2, "0")}店/延草纲目遠紅外治療貼水印${String(index + 1).padStart(2, "0")}`,
      shopFolder: `/shops/${String(Math.floor(index / 2) + 1).padStart(2, "0")}店`,
      watermarkNo: index + 1,
      status: "published",
      finalVerifyStatus: "publish_signal_confirmed",
      updatedAt: `2026-06-15T01:${String(index).padStart(2, "0")}:00.000Z`
    })),
    {
      ...progressIdentity("record-failed-middle"),
      productFolder: "/shops/08店/延草纲目遠紅外治療貼水印16",
      shopFolder: "/shops/08店",
      watermarkNo: 16,
      status: "failed",
      finalVerifyStatus: "needs_manual_review",
      updatedAt: "2026-06-15T01:16:00.000Z"
    },
    ...Array.from({ length: 4 }, (_, index) => ({
      ...progressIdentity("record-failed-middle"),
      productFolder: `/shops/${String(Math.floor((index + 16) / 2) + 1).padStart(2, "0")}店/延草纲目遠紅外治療貼水印${String(index + 17).padStart(2, "0")}`,
      shopFolder: `/shops/${String(Math.floor((index + 16) / 2) + 1).padStart(2, "0")}店`,
      watermarkNo: index + 17,
      status: "published",
      finalVerifyStatus: "publish_signal_confirmed",
      updatedAt: `2026-06-15T01:${String(index + 17).padStart(2, "0")}:00.000Z`
    }))
  ]
});
assert.deepEqual(
  failedMiddleWithLaterPublishedProgress,
  {
    recordId: "record-failed-middle",
    productName: "延草纲目遠紅外治療貼",
    completed: 19,
    productIndex: 20,
    productTotal: 20,
    shopName: "10店",
    shopIndex: 10,
    shopTotal: 10,
    failed: 1,
    failedWatermarkNo: 16,
    latestAttemptedWatermarkNo: 20
  },
  "publish progress must distinguish the failed watermark from the latest attempted watermark"
);
const compactFailedMiddleStatus = formatAutoListingControllerCompactStatusText({
  status: "failed",
  summary:
    "Publish failed for /shops/08店/延草纲目遠紅外治療貼水印16: Sequential publish flow stopped: 价格库存模块未完成。Price/inventory verification failed: row 1 expected price=129, stock=2000; actual price=<empty>, stock=0",
  productName: failedMiddleWithLaterPublishedProgress.productName,
  publishProductIndex: failedMiddleWithLaterPublishedProgress.productIndex,
  publishProductTotal: failedMiddleWithLaterPublishedProgress.productTotal,
  publishShopIndex: failedMiddleWithLaterPublishedProgress.shopIndex,
  publishShopTotal: failedMiddleWithLaterPublishedProgress.shopTotal,
  publishSafelyPublished: 19,
  publishFailed: failedMiddleWithLaterPublishedProgress.failed,
  publishFailedWatermarkNo: failedMiddleWithLaterPublishedProgress.failedWatermarkNo,
  publishLatestAttemptedWatermarkNo: failedMiddleWithLaterPublishedProgress.latestAttemptedWatermarkNo,
  feishuCompleted: 0,
  feishuTotal: 4
});
assert.deepEqual(
  compactFailedMiddleStatus.split("\n"),
  [
    "状态：失败｜发布已完成 19/20｜失败目标 16/20｜当前店铺 10/10｜飞书批次已完成 0/4",
    "商品：延草纲目遠紅外治療貼",
    "原因：价格库存读回校验失败，已停止；需重试失败水印，三次仍失败则人工处理。"
  ],
  "Hermes compact status must not report a failed middle watermark as the latest publish position"
);
const compactMissingSpecSurfaceStatus = formatAutoListingControllerCompactStatusText({
  status: "failed",
  summary:
    "Publish failed for /shops/07店/商品水印07: Sequential publish flow stopped: 价格库存模块未完成。Spec template field root was not found in 商品规格/规格模板 DOM structure.; keyword=买二送一",
  productName: "延草纲目李时珍腰椎远红外凝胶",
  publishSafelyPublished: 6,
  publishFailed: 1,
  publishFailedWatermarkNo: 7,
  publishShopIndex: 7,
  publishShopTotal: 20,
  feishuCompleted: 10,
  feishuTotal: 13
});
assert.match(
  compactMissingSpecSurfaceStatus,
  /缺少规格模板栏；续跑会关闭异常发布页，返回标品管理重新输入品牌和 SPU 后重建当前目标/,
  "Hermes must report the SPU-query recovery path instead of a false price/inventory failure"
);
const compactGuideOverlayStatus = formatAutoListingControllerCompactStatusText({
  status: "failed",
  summary:
    "Sequential publish flow stopped: 价格库存模块未完成。locator.click: <div class=\"ecom-guide-single-content-wrapper\"> intercepts pointer events",
  productName: "延草纲目凡士林胶原蛋白唇膏",
  publishSafelyPublished: 0,
  publishFailed: 1,
  publishShopIndex: 1,
  publishShopTotal: 20,
  feishuCompleted: 0,
  feishuTotal: 12
});
assert.match(
  compactGuideOverlayStatus,
  /原因：抖店引导遮罩拦截了表单控件；已安全停止，续跑会先结构化关闭遮罩并读回确认。/,
  "Hermes must report a guide overlay root cause before the generic price/inventory module wrapper"
);
const reviewMiddleWithLaterPublishedProgress = resolveAutoListingControllerPublishGroupProgress({
  entries: [
    ...Array.from({ length: 12 }, (_, index) => ({
      ...progressIdentity("record-review-middle"),
      productFolder: `/shops/${String(Math.floor(index / 2) + 1).padStart(2, "0")}店/延草纲目胶原蛋白敷料水印${String(index + 1).padStart(2, "0")}`,
      shopFolder: `/shops/${String(Math.floor(index / 2) + 1).padStart(2, "0")}店`,
      watermarkNo: index + 1,
      status: "published",
      finalVerifyStatus: "publish_signal_confirmed",
      updatedAt: `2026-06-16T01:${String(index).padStart(2, "0")}:00.000Z`
    })),
    {
      ...progressIdentity("record-review-middle"),
      productFolder: "/shops/07店/延草纲目胶原蛋白敷料水印13",
      shopFolder: "/shops/07店",
      watermarkNo: 13,
      status: "failed",
      finalVerifyStatus: "submit_accepted_unconfirmed",
      errorClass: "final_publish_state_uncertain",
      updatedAt: "2026-06-16T01:13:00.000Z"
    },
    ...Array.from({ length: 5 }, (_, index) => ({
      ...progressIdentity("record-review-middle"),
      productFolder: `/shops/${String(Math.floor((index + 13) / 2) + 1).padStart(2, "0")}店/延草纲目胶原蛋白敷料水印${String(index + 14).padStart(2, "0")}`,
      shopFolder: `/shops/${String(Math.floor((index + 13) / 2) + 1).padStart(2, "0")}店`,
      watermarkNo: index + 14,
      status: "published",
      finalVerifyStatus: "publish_signal_confirmed",
      updatedAt: `2026-06-16T01:${String(index + 14).padStart(2, "0")}:00.000Z`
    }))
  ]
});
assert.equal(reviewMiddleWithLaterPublishedProgress.failed, 1);
assert.equal(reviewMiddleWithLaterPublishedProgress.review || 0, 0);
assert.equal(reviewMiddleWithLaterPublishedProgress.reviewWatermarkNo || 0, 0);
assert.equal(reviewMiddleWithLaterPublishedProgress.failedWatermarkNo, 13);
assert.equal(reviewMiddleWithLaterPublishedProgress.productIndex, 18);
const compactReviewMiddleStatus = formatAutoListingControllerCompactStatusText({
  status: "running",
  productName: reviewMiddleWithLaterPublishedProgress.productName,
  activeItemName: "延草纲目胶原蛋白敷料水印18",
  latestProgress: "发布模块：最终提交（09店）",
  publishProductIndex: reviewMiddleWithLaterPublishedProgress.productIndex,
  publishProductTotal: reviewMiddleWithLaterPublishedProgress.productTotal,
  publishShopIndex: reviewMiddleWithLaterPublishedProgress.shopIndex,
  publishShopTotal: reviewMiddleWithLaterPublishedProgress.shopTotal,
  publishFailed: reviewMiddleWithLaterPublishedProgress.failed,
  publishReviewWatermarkNo: reviewMiddleWithLaterPublishedProgress.reviewWatermarkNo,
  feishuCompleted: 2,
  feishuTotal: 4
});
assert.doesNotMatch(compactReviewMiddleStatus.split("\n")[0], /待复核/);
assert.doesNotMatch(compactReviewMiddleStatus.split("\n")[0], /失败项/);
const compactMissingTotalsStatus = formatAutoListingControllerCompactStatusText({
  status: "running",
  productName: "延草纲目测试品",
  latestProgress: "发布流程运行中",
  showPublishProgress: true
});
assert.equal(
  /\?/.test(compactMissingTotalsStatus),
  false,
  "Hermes compact text must not expose '?' when Feishu or publish totals are temporarily unavailable"
);
assert.match(
  compactMissingTotalsStatus,
  /飞书批次待确认/,
  "Hermes compact text must render missing Feishu progress as a concrete pending label"
);
const compactBlankSpecStatus = formatAutoListingControllerCompactStatusText({
  status: "failed",
  summary:
    "Publish failed for /shops/08店/延草纲目遠紅外治療貼水印16: Sequential publish flow stopped: 价格库存模块未完成。Spec template left 1 blank required spec value input(s).; keyword=久光小泽",
  productName: "延草纲目遠紅外治療貼",
  publishProductIndex: 20,
  publishProductTotal: 20,
  publishShopIndex: 10,
  publishShopTotal: 10,
  publishSafelyPublished: 19,
  publishFailedWatermarkNo: 16,
  feishuCompleted: 0,
  feishuTotal: 4
});
assert.deepEqual(
  compactBlankSpecStatus.split("\n"),
  [
    "状态：失败｜发布已完成 19/20｜失败目标 16/20｜当前店铺 10/10｜飞书批次已完成 0/4",
    "商品：延草纲目遠紅外治療貼",
    "原因：规格模板存在空白占位值；按模板内容为准，续跑时不补写也不删除该空白项。"
  ],
  "Hermes failure text must report blank spec-template values instead of the broader price/inventory module"
);
const realtimeProgressSignal = resolveAutoListingControllerRealtimeProgressSignal({
  jobStartedAt: "2026-06-12T12:41:37.337Z",
  activeRunId: "20260612-205351",
  status: "running",
  statusSource: "publish-manifest",
  publishSafelyPublished: 1,
  publishTotal: 20,
  publishFailed: 0,
  publishActiveRuntimeKey: "01延草纲目大药房专营店__延草纲目医用重组胶原蛋白护理软膏水印02",
  publishActiveUpdatedAt: "2026-06-12T13:01:42.256Z",
  publishActiveMessage: "延草纲目医用重组胶原蛋白护理软膏水印02: basic_info_fill: basic_info_fill_attempt: 1",
  latestArtifactUpdatedAt: "2026-06-12T13:01:47.923Z",
  latestArtifactName: "publish-page-basic-filled.png",
  publishLogTimestamp: "2026-06-12T13:01:47.930Z",
  publishLogMessage: "发布模块：图文信息（01延草纲目大药房专营店）",
  stateLatestProgressTimestamp: "2026-06-12T13:01:42.256Z",
  stateLatestProgressMessage: "延草纲目医用重组胶原蛋白护理软膏水印02: basic_info_fill: basic_info_fill_attempt: 1"
});
assert.equal(realtimeProgressSignal?.source, "publish_log");
assert.equal(realtimeProgressSignal?.timestamp, "2026-06-12T13:01:47.930Z");
assert.match(
  realtimeProgressSignal?.key || "",
  /^2026-06-12T12:41:37\.337Z\|20260612-205351\|running\|publish_log\|1\/20\/0\|01延草纲目大药房专营店__延草纲目医用重组胶原蛋白护理软膏水印02\|2026-06-12T13:01:47\.930Z\|发布模块：图文信息/,
  "AutoListingController realtime progress key must reset by run and change when publish sub-item progress advances"
);
assert.equal(
  resolveAutoListingControllerRealtimeProgressSignal({
    jobStartedAt: "old-job",
    activeRunId: "old-run",
    status: "running",
    publishSafelyPublished: 19,
    publishTotal: 20,
    publishFailed: 0,
    publishActiveRuntimeKey: "old-product-19",
    publishActiveUpdatedAt: "2026-06-12T12:00:00.000Z",
    publishActiveMessage: "old progress"
  })?.key === realtimeProgressSignal?.key,
  false,
  "AutoListingController realtime progress key must not collide across supervisor continuations or new active runs"
);
const oldManifestCountWithNewPublishLog = resolveAutoListingControllerRealtimeProgressSignal({
  jobStartedAt: "2026-06-16T05:38:07.466Z",
  activeRunId: "20260616-140055",
  status: "running",
  statusSource: "publish-manifest",
  publishSafelyPublished: 19,
  publishTotal: 20,
  publishFailed: 1,
  publishProductIndex: 16,
  publishProductTotal: 20,
  publishShopIndex: 8,
  publishShopTotal: 10,
  publishActiveRuntimeKey: "08延草纲目家庭护理专营店__延草纲目医用退热贴水印16",
  publishActiveUpdatedAt: "2026-06-16T07:01:16.001Z",
  publishActiveMessage: "延草纲目医用退热贴水印16: service_fulfillment",
  publishLogTimestamp: "2026-06-16T07:01:16.001Z",
  publishLogMessage: "发布模块：服务履约（08延草纲目家庭护理专营店）"
});
assert.equal(
  oldManifestCountWithNewPublishLog?.source,
  "publish_log",
  "Hermes realtime progress must prefer the current publish module log over stale cumulative manifest counters"
);
assert.match(
  oldManifestCountWithNewPublishLog?.key || "",
  /08延草纲目家庭护理专营店__延草纲目医用退热贴水印16/,
  "Hermes realtime key must be anchored to the current active product folder, not the previous product's last published item"
);
assert.match(
  oldManifestCountWithNewPublishLog?.message || "",
  /服务履约/,
  "Hermes realtime message must expose the current publish module so operator feedback changes during publishing"
);
const newerArtifactWithCurrentPublishLog = resolveAutoListingControllerRealtimeProgressSignal({
  jobStartedAt: "2026-06-16T05:38:07.466Z",
  activeRunId: "20260616-140055",
  status: "running",
  statusSource: "publish-manifest",
  publishProductIndex: 17,
  publishProductTotal: 20,
  publishShopIndex: 9,
  publishShopTotal: 10,
  publishActiveRuntimeKey: "09延草纲目中医保健专营店__延草纲目医用退热贴水印17",
  publishActiveUpdatedAt: "2026-06-16T07:03:04.727Z",
  publishActiveMessage: "延草纲目医用退热贴水印17: basic_info_fill: basic_info_fill_attempt: 1",
  latestArtifactUpdatedAt: "2026-06-16T07:03:33.481Z",
  latestArtifactName: "publish-page-images-uploaded.png",
  publishLogTimestamp: "2026-06-16T07:03:04.727Z",
  publishLogMessage: "发布模块：基础信息（09延草纲目中医保健专营店）"
});
assert.equal(
  newerArtifactWithCurrentPublishLog?.source,
  "publish_log",
  "Hermes realtime progress must prefer publish module logs over newer screenshot artifacts during publishing"
);
assert.match(
  newerArtifactWithCurrentPublishLog?.message || "",
  /发布模块：基础信息/,
  "Hermes realtime progress must report the current workflow module, not only the latest screenshot filename"
);
assert.equal(
  selectAutoListingControllerFailedResumeCandidate([
    {
      resultFile: "/runs/new-empty/result.json",
      mtimeMs: 300,
      safelyPublishedCount: 0,
      resumeProductFolderCount: 0,
      reusableRawImageCount: 0
    },
    {
      resultFile: "/runs/older-publish-progress/result.json",
      mtimeMs: 200,
      safelyPublishedCount: 14,
      resumeProductFolderCount: 20,
      reusableRawImageCount: 20
    }
  ])?.resultFile,
  "/runs/older-publish-progress/result.json",
  "AutoListingController resume must prefer the failed run with real publish progress over a newer empty resume failure"
);
assert.equal(
  selectAutoListingControllerLatestResultFileForJobStatus({
    hasControlJob: true,
    latestResultFile: "/runs/simulated/result.json"
  }),
  undefined,
  "AutoListingController status for an existing control job must not mix in an unrelated newer simulated result."
);
assert.equal(
  selectAutoListingControllerLatestResultFileForJobStatus({
    hasControlJob: false,
    latestResultFile: "/runs/latest/result.json"
  }),
  "/runs/latest/result.json"
);
assert.equal(
  isExternalMainImageRawReuseMessage({
    message: "Reused 20 current-product raw main image(s) from /work/data/auto-listing/runs/old-run/tasks/image-001.",
    currentRuntimeDir: "/work/data/auto-listing/runs/current-run"
  }),
  true,
  "A failed task seeded from another run must not be resumed as a current-task raw reuse."
);
assert.equal(
  isExternalMainImageRawReuseMessage({
    message: "Reused 20 current-product raw main image(s) from /work/data/auto-listing/runs/current-run/tasks/image-001.",
    currentRuntimeDir: "/work/data/auto-listing/runs/current-run"
  }),
  false
);
assert.equal(
  shouldResumeFeishuBatchAfterRetryableChildFailure({
    exitCode: 1,
    batchComplete: false,
    retryableFailureMessage: "Image generation request timed out. The provider did not respond in time.",
    recoveryAttempts: 0,
    maxRecoveryAttempts: 3
  }),
  true
);
for (const unsafePaidReplayReason of [
  "failed at main_images_generated: Image generation failed: insufficient balance",
  "failed at main_images_generated: Image generation failed: billing account disabled",
  "failed at main_images_generated: Image generation failed: invalid_api_key",
  "failed at main_images_generated: Image generation failed: authentication failed",
  "failed at main_images_generated: Image generation failed: unauthorized",
  "failed at main_images_generated: Image generation failed: permission denied",
  "failed at main_images_generated: Image generation failed: quota exceeded",
  "failed at main_images_generated: Image generation failed: usage limit exceeded",
  "failed at main_images_generated: Image generation submission timed out before task id was received",
  "failed at main_images_generated: Image generation response did not include task id"
]) {
  assert.equal(
    shouldResumeFeishuBatchAfterRetryableChildFailure({
      exitCode: 1,
      batchComplete: false,
      retryableFailureMessage: unsafePaidReplayReason,
      recoveryAttempts: 0,
      maxRecoveryAttempts: 12
    }),
    false,
    `unsafe paid failure must not be replayed by supervisor broad fallbacks: ${unsafePaidReplayReason}`
  );
}
assert.equal(
  shouldResumeFeishuBatchAfterRetryableChildFailure({
    exitCode: 1,
    batchComplete: false,
    retryableFailureMessage:
      "failed at main_images_generated: videos-base64 task task_policy failed: content forbidden by policy",
    recoveryAttempts: 0,
    maxRecoveryAttempts: 12
  }),
  true,
  "content forbidden by policy must remain a bounded fixed-slot provider retry"
);
for (const safeFinancialSubstring of [
  "white balance adjustment failed",
  "unbalanced dimensions",
  "accreditation watermark rejected"
]) {
  assert.equal(
    shouldResumeFeishuBatchAfterRetryableChildFailure({
      exitCode: 1,
      batchComplete: false,
      retryableFailureMessage:
        `failed at main_images_generated: videos-base64 task task_visual failed: ${safeFinancialSubstring}`,
      recoveryAttempts: 0,
      maxRecoveryAttempts: 12
    }),
    true,
    `visual wording containing a financial substring must remain retryable: ${safeFinancialSubstring}`
  );
}
for (const unsafeLimitReason of [
  "limit exceeded",
  "account limit exceeded",
  "monthly limit reached",
  "insufficient funds",
  "limit_exceeded",
  "insufficient_funds"
]) {
  assert.equal(
    shouldResumeFeishuBatchAfterRetryableChildFailure({
      exitCode: 1,
      batchComplete: false,
      retryableFailureMessage:
        `failed at main_images_generated: videos-base64 task task_limit failed: ${unsafeLimitReason}`,
      recoveryAttempts: 0,
      maxRecoveryAttempts: 12
    }),
    false,
    `explicit limit/funds failure must stop supervisor recovery: ${unsafeLimitReason}`
  );
}
assert.equal(
  shouldResumeFeishuBatchAfterRetryableChildFailure({
    exitCode: 1,
    batchComplete: false,
    retryableFailureMessage: "failed at main_images_generated: fetch failed",
    recoveryAttempts: 0,
    maxRecoveryAttempts: 12
  }),
  true,
  "paid main-image transport failures must resume the locked batch so current-product artifacts can be reused and pending products continue"
);
assert.equal(
  isRetryableExternalServiceAvailabilityFailure("failed at main_images_generated: fetch failed"),
  true,
  "Main-image fetch failures are image-provider availability failures, not generic quick-retry failures"
);
assert.equal(
  shouldConsumeSupervisorRecoveryAttempt("failed at main_images_generated: fetch failed"),
  false,
  "Main-image transport failures must not burn the finite supervisor recovery budget"
);
assert.equal(
  resolveSupervisorRecoveryDelayMs({
    failureMessage: "failed at main_images_generated: fetch failed",
    externalServiceWaitAttempts: 0
  }),
  3 * 60 * 1000,
  "Main-image transport failures must use the fixed three-minute external-service wait"
);
assert.equal(
  shouldResumeFeishuBatchAfterRetryableChildFailure({
    exitCode: 1,
    batchComplete: false,
    retryableFailureMessage: "failed at main_images_generated: fetch failed",
    recoveryAttempts: 12,
    maxRecoveryAttempts: 12
  }),
  true,
  "Main-image provider transport failures must remain recoverable after the normal recovery budget is exhausted"
);
assert.equal(
  resolveAutoListingControllerRuntimeStatus({
    running: true,
    activeWaitState: false,
    completed: false,
    failed: false,
    hasPendingFeishuProducts: false,
    terminalFailureMessage: "main_images_generated: fetch failed"
  }),
  "external_service_wait",
  "A running supervisor with an active terminal main-image transport failure must report external-service wait, not normal running"
);
const paidLedgerDerivedWaitStatus = resolvePaidImageWaitStatus({
  baseStatus: "running",
  activeMainImageGeneration: true,
  paidImageSubmitted: 3,
  publishProgressActive: false
});
assert.equal(
  paidLedgerDerivedWaitStatus,
  "external_service_wait",
  "A running main-image task with accepted paid ledger slots must derive external-service wait status"
);
const compactPaidLedgerDerivedWait = formatAutoListingControllerCompactStatusText({
  status: paidLedgerDerivedWaitStatus,
  summary: "图片服务冷却中，系统将自动继续查询已接受任务。",
  imageGenerationProgress: "Prompt 5/5: Image 4: videos-base64 task task_active status pending 0.",
  mainImageCompleted: 17,
  mainImageExpected: 20,
  feishuCompleted: 0,
  feishuTotal: 1
});
assert.match(compactPaidLedgerDerivedWait, /主图 17\/20/);
assert.match(compactPaidLedgerDerivedWait, /等待生图服务/);
assert.equal(
  formatPaidImageAcceptedTaskWaitSummary({
    completed: 19,
    expected: 20,
    submitted: 1,
    latestProgressAt: "2026-07-29T09:03:38.139Z"
  }),
  "生图仍在运行：主图 19/20；1 个已受理任务正在供应商队列中，项目持续查询同一 task ID。最近查询：2026-07-29T09:03:38.139Z。",
  "Accepted paid tasks must be reported as active polling, not as an unknown provider cooldown"
);
assert.equal(
  typeof resolvePaidImageWaitStatus,
  "function",
  "Direct and supervised controller paths must share a paid-ledger wait status resolver"
);
const sharedDirectPaidWaitStatus = resolvePaidImageWaitStatus({
  baseStatus: "running",
  activeMainImageGeneration: true,
  paidImageSubmitted: 3,
  publishProgressActive: false
});
assert.equal(sharedDirectPaidWaitStatus, "external_service_wait");
assert.equal(
  (hermesRunnerSource.match(/resolvePaidImageWaitStatus\(/g) || []).length,
  2,
  "Both direct-run and supervised controller status branches must use the shared paid-ledger wait resolver"
);
const compactSharedDirectPaidWait = formatAutoListingControllerCompactStatusText({
  status: sharedDirectPaidWaitStatus,
  summary: "图片服务冷却中，系统将自动继续查询已接受任务。",
  imageGenerationProgress: "Prompt 5/5: Image 4: videos-base64 task task_direct status queued 0.",
  mainImageCompleted: 17,
  mainImageExpected: 20,
  feishuCompleted: 0,
  feishuTotal: 1
});
assert.match(compactSharedDirectPaidWait, /主图 17\/20/);
assert.match(compactSharedDirectPaidWait, /等待生图服务/);
assert.equal(
  resolvePaidImageWaitStatus({
    baseStatus: "running",
    activeMainImageGeneration: true,
    paidImageSubmitted: 3,
    publishProgressActive: true
  }),
  "running",
  "Direct active publish progress must retain publish precedence over historical paid slots"
);
assert.equal(
  resolvePaidImageWaitStatus({
    baseStatus: "running",
    activeMainImageGeneration: true,
    paidImageSubmitted: 3,
    publishProgressActive: false,
    terminalFailureMessage: "paid image ledger blocked slot 4: blocked_ambiguous"
  }),
  "running",
  "Direct explicit non-provider failure state must not be relabeled as provider wait"
);
assert.equal(
  resolveAutoListingControllerRuntimeStatus({
    running: true,
    activeWaitState: false,
    completed: false,
    failed: false,
    hasPendingFeishuProducts: false,
    activeMainImageGeneration: true,
    paidImageSubmitted: 3,
    publishProgressActive: true
  }),
  "running",
  "Active publish progress must take precedence over stale submitted paid-image ledger slots"
);
assert.equal(
  resolveAutoListingControllerRuntimeStatus({
    running: true,
    activeWaitState: false,
    completed: false,
    failed: false,
    hasPendingFeishuProducts: false,
    activeMainImageGeneration: true,
    paidImageSubmitted: 3,
    publishProgressActive: false,
    terminalFailureMessage: "paid image ledger blocked slot 4: blocked_ambiguous"
  }),
  "running",
  "A non-provider terminal failure must not be mislabeled as an external provider wait from stale submitted slots"
);
assert.equal(
  shouldSuppressTerminalFailureBehindNewerProgress({
    running: true,
    terminalFailureMtimeMs: Date.parse("2026-06-25T14:06:09.000Z"),
    latestProgressTimestamp: "2026-06-25T14:11:45.000Z"
  }),
  true,
  "A running controller must not let an older failed result.json hide newer current-task progress"
);
assert.equal(
  shouldSuppressTerminalFailureBehindNewerProgress({
    running: true,
    terminalFailureMtimeMs: Date.parse("2026-06-25T14:11:45.000Z"),
    latestProgressTimestamp: "2026-06-25T14:06:09.000Z"
  }),
  false,
  "A current terminal failure must remain visible when no newer progress exists"
);
assert.equal(
  resolveAutoListingControllerRuntimeStatus({
    running: true,
    activeWaitState: false,
    pauseSignalExists: true,
    completed: false,
    failed: false,
    hasPendingFeishuProducts: false
  }),
  "pause_requested",
  "Controller status must immediately expose a project-owned pause request before the child reaches its safe boundary"
);
assert.equal(
  resolveAutoListingControllerRuntimeStatus({
    running: false,
    activeWaitState: false,
    completed: false,
    failed: true,
    hasPendingFeishuProducts: false,
    stateStatus: "paused",
    resultStatus: "failed",
    terminalFailureMessage: "Auto-listing pause requested by signal file: /work/data/auto-listing/control/pause.requested"
  }),
  "paused",
  "AutoListingController status must report operator-requested pause as paused instead of failed"
);
assert.equal(
  resolveAutoListingControllerIdleStatus({
    pauseSignalExists: true,
    batchComplete: true,
    latestResultOk: true,
    latestResultStatus: "completed"
  }),
  "pause_requested",
  "A project-owned pause signal must be visible even when no controller process is active"
);
assert.match(
  formatAutoListingControllerCompactStatusText({
    status: "pause_requested",
    showPublishProgress: false,
    summary:
      "批次保护暂停：运行批次 b19afe509cf5 与当前飞书缓存 3f88a9c9c0ae 不一致；已停止复用旧运行证据。继续上架会清除暂停信号并按当前飞书缓存安全续跑。",
    feishuCompleted: 0,
    feishuTotal: 1
  }),
  /批次保护暂停：旧批次 b19afe509cf5，当前批次 3f88a9c9c0ae；继续会按当前飞书缓存重选断点/,
  "Hermes compact status must expose the batch-mismatch pause reason instead of presenting a generic stuck state"
);
assert.equal(
  formatAutoListingControllerCompactStatusText({
    status: "pause_requested",
    showPublishProgress: true,
    summary: "项目已收到手动暂停请求；任务会在安全边界停止并保留当前产物。继续上架会清除暂停信号并从安全断点续跑。",
    productName: "延草纲目万通鉴筋骨痛膏贴",
    activeItemName: "延草纲目万通鉴筋骨痛膏贴-recvnsNBVlVIE0-水印15",
    latestProgress: "Waiting for publish result.",
    publishSafelyPublished: 14,
    publishTotal: 20,
    publishProductIndex: 15,
    publishProductTotal: 20,
    publishShopIndex: 8,
    publishShopTotal: 10,
    feishuCompleted: 0,
    feishuTotal: 1
  }),
  "状态：正在安全暂停｜发布已完成 14/20｜当前目标 15/20｜当前店铺 8/10｜飞书批次已完成 0/1\n当前：延草纲目万通鉴筋骨痛膏贴\n进度：项目已收到手动暂停请求；任务会在安全边界停止并保留当前产物。继续上架会清除暂停信号并从安全断点续跑。",
  "Paused publish status must show the pause reason instead of the next-target Waiting for publish result placeholder"
);
assert.equal(
  resolveAutoListingControllerIdleStatus({
    batchComplete: true,
    latestResultOk: true,
    latestResultStatus: "completed"
  }),
  "completed",
  "Controller status without an active control job must still report the completed current Feishu batch"
);
assert.equal(
  shouldFailAutoListingControllerStatusForFeishuCacheInvalid({
    feishuCacheInvalid: true,
    idleStatus: "completed"
  }),
  false,
  "A post-completion Feishu refresh validation failure must not override a completed current batch status"
);
assert.equal(
  shouldFailAutoListingControllerStatusForFeishuCacheInvalid({
    feishuCacheInvalid: true,
    idleStatus: "idle",
    latestResultOk: true
  }),
  false,
  "A completed latest result must remain completed when a post-completion Feishu refresh cannot produce a valid cache"
);
assert.equal(
  shouldPreserveAutoListingControllerCompletedStatusForFeishuCacheInvalid({
    feishuCacheInvalid: true,
    latestResultOk: true
  }),
  true,
  "A successful latest result must preserve completed status when the only later failure is Feishu refresh validation"
);
assert.equal(
  shouldFailAutoListingControllerStatusForFeishuCacheInvalid({
    feishuCacheInvalid: true,
    idleStatus: "pending_products"
  }),
  true,
  "An incomplete current batch must still fail fast when the refreshed Feishu cache is invalid"
);
assert.equal(
  resolveAutoListingControllerIdleStatus({
    batchComplete: false,
    latestResultOk: true,
    latestResultStatus: "completed"
  }),
  "pending_products",
  "Controller status without an active control job must expose pending Feishu products"
);
assert.equal(
  resolveAutoListingControllerIdleStatus({
    batchComplete: false,
    latestResultOk: false
  }),
  "failed",
  "Controller status must surface the latest failed run before generic pending Feishu products"
);
assert.match(
  formatAutoListingControllerCompactStatusText({
    status: "failed",
    showPublishProgress: false,
    productName: "李时珍痔疮凝胶-recvnzbLwiYr2N-白底图-01-b2fa95ab53",
    summary:
      "videos-base64 prompt rounds failed after all concurrent work settled; failed indexes: 2, 3; reasons: videos-base64 paid image slots failed after all concurrent work settled; failed indexes: 4; reasons: videos-base64 task task_MlajXJcaYf6eHcsY8dQ32MaPx8sHNfCW did not finish within 180000ms. | videos-base64 paid image slots failed after all concurrent work settled; failed indexes: 3; reasons: videos-base64 task task_dDyBQYUfv3ofeu8WNDoGMNy2AcMsFZ47 did not finish within 180000ms.",
    feishuProductIndex: 5,
    feishuTotal: 6
  }),
  /原因：图片服务轮询超过 180 秒：失败组 2, 3，槽位 4；3；已按规则停止/,
  "Hermes failed status must compact videos-base64 180s poll timeouts into a clear operator-facing reason"
);
assert.equal(
  resolveAutoListingControllerDryRunStartDecision({
    batchComplete: true,
    forceRerunCurrentBatch: false
  }),
  "require_rerun_confirmation",
  "Read-only start must not advertise a stale historical resume when the current batch is complete"
);
assert.deepEqual(
  resolveAutoListingControllerLaunchPolicy("start_new_batch"),
  {
    refreshBeforeSelection: true,
    allowHistoricalResume: false,
    forceFullFlow: true
  },
  "开始上架 must refresh Feishu first and must not select a historical resume job"
);
assert.deepEqual(
  resolveAutoListingControllerLaunchPolicy("continue_current_batch"),
  {
    refreshBeforeSelection: false,
    allowHistoricalResume: true,
    forceFullFlow: false
  },
  "继续上架 must preserve the locked cached batch and select its safe resume point"
);
assert.equal(
  resolveAutoListingControllerContinueDecision({ batchComplete: true }),
  "report_complete",
  "继续上架 must stop on an already completed locked batch without launching full flow or refreshing Feishu"
);
assert.equal(
  resolveAutoListingControllerContinueDecision({ batchComplete: false }),
  "select_recovery",
  "继续上架 must select recovery only while the locked batch remains incomplete"
);
assert.equal(
  shouldExposeHistoricalRuntimeForCurrentFeishuBatch({
    currentBatchFingerprint: "batch-new",
    historicalBatchFingerprint: "batch-old"
  }),
  false,
  "A refreshed Feishu batch must not display product or publish progress from a historical runtime"
);
assert.deepEqual(
  formatAutoListingControllerCompactStatusText({
    status: "pending_products",
    summary: "当前飞书批次仍有待处理产品。",
    showPublishProgress: false,
    feishuCompleted: 0,
    feishuTotal: 7
  }).split("\n"),
  ["状态：待继续｜飞书批次已完成 0/7", "进度：当前飞书批次仍有待处理产品。"],
  "A refreshed pending batch without a matching runtime must not invent product/shop progress or an unknown current product"
);
assert.equal(
  shouldExposeHistoricalRuntimeForCurrentFeishuBatch({
    currentBatchFingerprint: "batch-current",
    historicalBatchFingerprint: "batch-current"
  }),
  true,
  "A locked batch may display historical runtime evidence only when the batch fingerprint matches exactly"
);
assert.equal(
  resolveAutoListingControllerDryRunStartDecision({
    batchComplete: true,
    forceRerunCurrentBatch: true
  }),
  "rerun_current_batch",
  "Confirmed current-batch rerun must explicitly select a clean full-flow rerun"
);
const terminalFailureRealtimeProgress = resolveAutoListingControllerRealtimeProgressSignal({
  jobStartedAt: "2026-06-12T13:00:00.000Z",
  activeRunId: "20260612-211433",
  status: "external_service_wait",
  preferStatusMessage: true,
  statusMessage: "图片服务暂时不可用：main_images_generated: fetch failed",
  statusTimestamp: "2026-06-12T13:14:38.404Z",
  stateLatestProgressTimestamp: "2026-06-12T13:14:45.000Z",
  stateLatestProgressMessage: "Prompt 5/5: Image 4: submitting videos-base64 request."
});
assert.equal(terminalFailureRealtimeProgress?.source, "status");
assert.match(
  terminalFailureRealtimeProgress?.message || "",
  /fetch failed/,
  "Terminal failure status must override later async image-generation progress in AutoListingController realtime feedback"
);
const terminalPublishFailureRealtimeProgress = resolveAutoListingControllerRealtimeProgressSignal({
  jobStartedAt: "2026-06-21T14:39:30.324Z",
  activeRunId: "20260622-011631",
  status: "failed",
  preferStatusMessage: true,
  statusMessage: "没有对应的规格模板可选",
  statusTimestamp: "2026-06-21T22:22:12.400Z",
  publishLogTimestamp: "2026-06-21T22:18:39.022Z",
  publishLogMessage: "发布模块：图文信息（07延草纲目健康护理专营店）"
});
assert.equal(terminalPublishFailureRealtimeProgress?.source, "status");
assert.match(terminalPublishFailureRealtimeProgress?.message || "", /没有对应的规格模板可选/);
assert.equal(
  compactAutoListingTerminalFailureMessage(
    "Publish failed for /shops/07店/延草纲目商品-水印14: Sequential publish flow stopped: 价格库存模块未完成。No spec template option exactly matched Feishu value: 买一送一"
  ),
  "没有对应的规格模板可选",
  "Terminal feedback must reduce exact-option absence to the requested Hermes message"
);
const doudianLoginFailureMessage =
  "Publish failed for /Users/mfrank/MFrank55055/input/auto-listing/shops/09延草纲目中医保健专营店/延草纲目李时珍牙科护理剂-recvnbT8RrH0nU-水印18: Doudian login required: open the automation browser and complete Doudian login before publishing can continue.";
assert.equal(
  compactAutoListingTerminalFailureMessage(doudianLoginFailureMessage),
  "Doudian login required: open the automation browser and complete Doudian login before publishing can continue.",
  "Terminal feedback must strip the long product path before compacting login failures"
);
assert.deepEqual(
  formatAutoListingControllerCompactStatusText({
    status: "failed",
    summary: compactAutoListingTerminalFailureMessage(doudianLoginFailureMessage),
    productName: "延草纲目李时珍牙科护理剂",
    publishProductIndex: 18,
    publishProductTotal: 20,
    publishShopIndex: 9,
    publishShopTotal: 10,
    publishSafelyPublished: 17,
    publishFailed: 1,
    publishFailedWatermarkNo: 18,
    feishuCompleted: 3,
    feishuTotal: 3
  }).split("\n"),
  [
    "状态：失败｜发布已完成 17/20｜失败目标 18/20｜当前店铺 9/10｜飞书批次已完成 3/3",
    "商品：延草纲目李时珍牙科护理剂",
    "原因：抖店登录已失效，已停止；请在自动化浏览器完成登录后从断点续跑。"
  ],
  "Hermes compact status must report Doudian login loss as an actionable manual blocker, not a truncated path"
);
assert.equal(
  shouldResumeFeishuBatchAfterRetryableChildFailure({
    exitCode: 1,
    batchComplete: false,
    retryableFailureMessage: doudianLoginFailureMessage,
    recoveryAttempts: 0,
    maxRecoveryAttempts: 12
  }),
  false,
  "Doudian login loss is an external manual blocker and must not be treated as project self-recoverable"
);
assert.equal(isDoudianLoginRequiredFailure(doudianLoginFailureMessage), true);
assert.equal(
  resolveDoudianLoginRecoveryPollMs(),
  30_000,
  "Login recovery must use a bounded read-only polling interval without consuming ordinary retry budget"
);
assert.equal(
  shouldRecoverFullFlowAfterChildFailure({
    childMode: "resume",
    exitCode: 1,
    batchComplete: false,
    retryableFailureMessage: doudianLoginFailureMessage,
    activeStep: "published",
    activeMessage: "Publish failed: doudian_login_required",
    recoveryAttempts: 0,
    maxRecoveryAttempts: 12
  }),
  false,
  "Supervisor must not restart the publish child while Doudian login remains unavailable"
);
assert.equal(
  resolveAutoListingControllerRuntimeStatus({
    running: true,
    activeWaitState: false,
    activeLoginWaitState: true,
    completed: false,
    failed: false,
    hasPendingFeishuProducts: true
  }),
  "doudian_login_wait",
  "A live supervisor waiting for the fixed headed browser login must remain observable instead of becoming terminal failed"
);

assert.equal(
  evaluatePublishResult({
    ok: false,
    status: "failed",
    publishClicked: false,
    publishClickAttempted: false,
    message: "No visible spec template dropdown option matched keyword: 买二送一"
  }).finalVerifyStatus,
  "not_checked",
  "A failure before clicking publish is safe to retry and must not be mislabeled as needs_manual_review"
);

assert.deepEqual(
  selectLatestBlockingPublishResult([
    { productFolder: "/shops/04/水印07", ok: false, message: "旧的标品页未就绪" },
    { productFolder: "/shops/05/水印09", ok: true, message: "published" },
    { productFolder: "/shops/07/水印14", ok: false, message: "当前规格模板未找到" }
  ]),
  { productFolder: "/shops/07/水印14", ok: false, message: "当前规格模板未找到" },
  "Task failure and Hermes summary must report the latest actionable blocker, not the first historical failure"
);
assert.equal(
  selectLatestBlockingPublishResult([
    {
      productFolder: "/shops/08/水印15",
      ok: true,
      status: "published",
      message: "Publish button click was issued; platform success signal was not observed.",
      finalVerifyStatus: "needs_manual_review",
      errorClass: "unknown_publish_failure"
    }
  ])?.productFolder,
  "/shops/08/水印15",
  "Published-looking results that require manual review must stop cleanup and must not be treated as safe."
);
assert.equal(
  selectLatestBlockingPublishResult([
    {
      productFolder: "/shops/07/水印07",
      ok: true,
      status: "published",
      message: "Publish button click was issued; platform success signal was not observed.",
      finalVerifyStatus: "submit_accepted_unconfirmed",
      errorClass: "final_publish_state_uncertain"
    }
  ])?.productFolder,
  "/shops/07/水印07",
  "An attempted-but-unconfirmed final submit must fail the task even when the browser action result still looks published."
);
assert.equal(
  isPublishOutcomeAcceptedForBatchCompletion({
    status: "skipped",
    finalVerifyStatus: "submit_rejected_exhausted",
    errorClass: "final_publish_submit_transient"
  }),
  true,
  "A durable exhausted rejection must have one shared non-replay product-completion classification."
);
assert.equal(
  isPublishOutcomeAcceptedForBatchCompletion({
    status: "skipped",
    finalVerifyStatus: "submit_rejected_exhausted",
    errorClass: "spec_value_duplicate_rejected"
  }),
  true,
  "A deterministic duplicate-spec rejection must be terminal accepted coverage after exact-title absence is verified."
);
assert.equal(
  selectLatestBlockingPublishResult([
    {
      productFolder: "/shops/06/水印06",
      ok: false,
      status: "skipped",
      message: "controlled rejection retry exhausted",
      finalVerifyStatus: "submit_rejected_exhausted",
      errorClass: "final_publish_submit_transient"
    }
  ]),
  undefined,
  "A terminal deferred target must not make the completed 20-target product fail after publishing."
);
assert.equal(
  shouldRecoverFullFlowAfterChildFailure({
    childMode: "full",
    exitCode: 1,
    batchComplete: false,
    retryableFailureMessage: "failed at main_images_generated: fetch failed",
    activeStep: "main_images_generated",
    activeMessage: "Prompt 5/5: Image 4: submitting videos-base64 request.",
    recoveryAttempts: 0,
    maxRecoveryAttempts: 12
  }),
  true,
  "AutoListingController must recover a full-flow child after a transient main-image transport failure instead of stopping between products"
);
assert.equal(
  shouldRecoverFullFlowAfterChildFailure({
    childMode: "resume",
    exitCode: 1,
    batchComplete: false,
    retryableFailureMessage: "Refusing to generate paid titles while product folders already contain workbook(s): /work/shop/product-1 -> title.xlsx",
    activeStep: "titles_generated",
    activeMessage: "Title workbooks already exist; resume must continue from publishing.",
    recoveryAttempts: 0,
    maxRecoveryAttempts: 3
  }),
  true,
  "AutoListingController resume children must rebuild the resume job and continue from publishing when title workbooks already exist"
);
assert.equal(
  resolveSupervisorRecoveryChildMode(
    "Refusing to generate paid titles while product folders already contain workbook(s): /work/shop/product-1 -> title.xlsx"
  ),
  "resume",
  "Title-workbook collisions are safe resume-stage transitions and must not restart the full flow"
);
assert.match(
  autoListingCliSource,
  /const explicitStartStep =[\s\S]*options\.sourceJob\.input\?\.startStep[\s\S]*options\.sourceJob[\s\S]*startStep[\s\S]*const startStep = explicitStartStep\s*\?\s*normalizeAutoListingStep\(explicitStartStep as any\)\s*:\s*inferResumeStartStepFromDisk/,
  "CLI resume job generation must preserve an explicit startStep=published instead of inferring an earlier step from disk"
);
assert.equal(
  resolveSupervisorRecoveryChildMode("failed at main_images_generated: fetch failed"),
  "full",
  "Ordinary retryable failures must keep the existing full-flow recovery behavior"
);
assert.equal(
  resolveSupervisorRecoveryChildMode(
    "failed at published: Publish failed for /work/shop/product-18: Main images must already satisfy 1:1 ratio before upload. Invalid files: main.png(1199x1312)"
  ),
  "resume",
  "A publish-stage main-image shape failure must stay on the manifest-backed publish resume path."
);
assert.equal(
  resolveSupervisorRecoveryChildMode(
    "failed at published: Main image completion gate failed: Task image-001 generated 1 main image(s), expected 20."
  ),
  "resume",
  "A publish-stage completion-gate failure must never fall through to destructive full-flow recovery."
);
assert.equal(
  resolveSupervisorRecoveryChildMode(
    "failed at cleaned: Archive guard failed: expected 20 current unwatermarked main image(s), got 3."
  ),
  "resume",
  "A cleanup-stage archive guard failure must resume cleanup instead of restarting the full paid and publish flow."
);
const emptyPublishSectionsAfterSpuFailure =
  "failed at published: Publish failed for /work/shop/product-03: Publish create page has no publish sections after SPU query.";
assert.equal(
  shouldResumeFeishuBatchAfterRetryableChildFailure({
    exitCode: 1,
    batchComplete: false,
    retryableFailureMessage: emptyPublishSectionsAfterSpuFailure,
    recoveryAttempts: 0,
    maxRecoveryAttempts: 3
  }),
  true,
  "The supervisor must classify an empty create page after SPU query as a retryable publish-page failure"
);
assert.equal(
  shouldRecoverFullFlowAfterChildFailure({
    childMode: "full",
    exitCode: 1,
    batchComplete: false,
    retryableFailureMessage: emptyPublishSectionsAfterSpuFailure,
    activeStep: "published",
    activeMessage:
      "Publish failed: product-03: Publish create page has no publish sections after SPU query.",
    recoveryAttempts: 0,
    maxRecoveryAttempts: 3
  }),
  true,
  "A retryable terminal publish failure must not be blocked by the active published progress state"
);
assert.equal(
  resolveSupervisorRecoveryChildMode(emptyPublishSectionsAfterSpuFailure),
  "resume",
  "Retryable publish-page failures must rebuild a manifest-backed resume job instead of restarting the full flow"
);
const detailFailureMessage =
  "failed at published: Publish failed for /work/shop/product-01: Sequential publish flow stopped: 图文信息模块未完成。Qualification detail upload was not acknowledged per file. expected=2; acknowledged=0; baseline=6; final=6";
assert.equal(resolveSupervisorRecoveryChildMode(detailFailureMessage), "resume");
assert.equal(
  shouldRecoverFullFlowAfterChildFailure({
    childMode: "full",
    exitCode: 1,
    batchComplete: false,
    retryableFailureMessage: detailFailureMessage,
    activeStep: "published",
    activeMessage: "Publish failed: detail_qualification_not_ready",
    recoveryAttempts: 0,
    maxRecoveryAttempts: 12
  }),
  true,
  "an exact pre-submit detail qualification failure must rebuild the manifest-backed resume job"
);
assert.equal(
  shouldRecoverFullFlowAfterChildFailure({
    childMode: "resume",
    exitCode: 1,
    batchComplete: false,
    retryableFailureMessage:
      'failed at published: Publish failed: Sequential publish flow stopped: 基础信息模块未完成。Basic info gate failed before after_basic_fill: missing=title, shortTitle, modelSpec; values={"title":"","shortTitle":"","modelSpec":""}',
    recoveryAttempts: 0,
    maxRecoveryAttempts: 3
  }),
  true,
  "AutoListingController resume children must automatically recover bounded transient publish-page failures"
);
assert.equal(
  shouldRecoverFullFlowAfterChildFailure({
    childMode: "resume",
    exitCode: 1,
    batchComplete: false,
    retryableFailureMessage:
      "failed at published: Sequential publish flow stopped: 价格库存模块未完成。Spec template selection did not match required keyword.",
    recoveryAttempts: 0,
    maxRecoveryAttempts: 3
  }),
  false,
  "AutoListingController must not auto-resume spec-template readiness failures by replaying the publish flow"
);
assert.equal(
  shouldResumeFeishuBatchAfterRetryableChildFailure({
    exitCode: 1,
    batchComplete: false,
    retryableFailureMessage:
      "failed at published: Publish failed for /work/shop/product-19: Manual spec template entry mode was not visible after clicking 切换手动填写.",
    recoveryAttempts: 0,
    maxRecoveryAttempts: 3
  }),
  false,
  "AutoListingController must stop on manual spec-template entry failures instead of replaying the publish flow"
);
assert.equal(
  shouldRecoverFullFlowAfterChildFailure({
    childMode: "resume",
    exitCode: 1,
    batchComplete: false,
    retryableFailureMessage:
      "failed at published: Publish failed for /work/shop/product-19: Manual spec template entry mode was not visible after clicking 切换手动填写.",
    recoveryAttempts: 0,
    maxRecoveryAttempts: 3
  }),
  false,
  "AutoListingController resume children must not continue after spec-template entry drift"
);
assert.equal(
  shouldRecoverFullFlowAfterChildFailure({
    childMode: "full",
    exitCode: 1,
    batchComplete: false,
    retryableFailureMessage: "Refusing to generate paid titles while product folders already contain workbook(s): /work/shop/product-1 -> title.xlsx",
    recoveryAttempts: 0,
    maxRecoveryAttempts: 3
  }),
  true
);
assert.equal(
  shouldResumeFeishuBatchAfterRetryableChildFailure({
    exitCode: 1,
    batchComplete: false,
    retryableFailureMessage: "validation failed",
    recoveryAttempts: 0,
    maxRecoveryAttempts: 3
  }),
  false
);
