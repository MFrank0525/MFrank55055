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
  resolveAutoListingControllerPublishGroupProgress,
  resolveAutoListingControllerPaidImageRecordId,
  shouldSuppressTerminalFailureBehindNewerProgress,
  compactAutoListingTerminalFailureMessage
} from "../dist/src/autolist/batch-continuation-rules.js";
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
  hasPendingResumeProductFolders,
  inferResumeStartStepForTask,
  selectRemainingResumeProductFolderNames,
  shouldInvalidatePublishedResumeWithoutProductFolders,
  shouldReplaceStaleResumeStartStep
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
import {
  mergePublishArtifactWithSafeManifest,
  publishDistributedProducts,
  selectLatestFailedPublishResult
} from "../dist/src/autolist/publish.js";

const canonicalIdentity = {
  batchFingerprint: "batch-1",
  recordId: "record-1",
  taskId: "task-1",
  shopCode: "01",
  watermarkNo: 1
};
assert.equal(shouldRunPendingTargetProductListPreflight("known_sequence"), false);
assert.equal(
  isSettledExactTitlePositiveEvidence({
    queryMatches: true,
    count: 2,
    visibleResultRows: 2,
    visibleLoadingIndicators: 1
  }),
  true,
  "Exact-title rows plus a positive count must settle even when an unrelated persistent spinner remains visible"
);
assert.equal(shouldRunPendingTargetProductListPreflight("unresolved_disorder"), true);
assert.equal(
  resolveProductListPreflightMode({
    requestedMode: undefined,
    resumeSourceImagePath: "",
    startStep: "source_images_discovered"
  }),
  "known_sequence"
);
assert.equal(
  resolveProductListPreflightMode({
    requestedMode: "unresolved_disorder",
    resumeSourceImagePath: "/runtime/source.png",
    startStep: "published"
  }),
  "unresolved_disorder"
);
assert.throws(
  () =>
    resolveProductListPreflightMode({
      requestedMode: "unresolved_disorder",
      resumeSourceImagePath: "",
      startStep: "source_images_discovered"
    }),
  /only valid for an explicit publish-stage resume/
);
assert.throws(
  () =>
    resolveProductListPreflightMode({
      requestedMode: "unexpected_mode",
      resumeSourceImagePath: "/runtime/source.png",
      startStep: "published"
    }),
  /Invalid productListPreflightMode/
);
const mergedResumeArtifact = mergePublishArtifactWithSafeManifest({
  artifact: { results: [], simulated: false },
  manifestEntries: [
    {
      targetKey: "safe-1",
      targetIdentity: canonicalIdentity,
      productFolder: "/shops/01/product-水印1",
      runtimeKey: "safe-1",
      shopFolder: "/shops/01",
      watermarkNo: 1,
      batchFingerprint: "batch-1",
      recordId: "record-1",
      taskId: "task-1",
      status: "published",
      finalVerifyStatus: "publish_signal_confirmed",
      message: "safe evidence",
      updatedAt: "2026-01-01T00:00:00.000Z"
    },
    {
      targetKey: "unsafe-2",
      targetIdentity: { ...canonicalIdentity, watermarkNo: 2 },
      productFolder: "/shops/01/product-水印2",
      runtimeKey: "unsafe-2",
      shopFolder: "/shops/01",
      watermarkNo: 2,
      batchFingerprint: "batch-1",
      recordId: "record-1",
      taskId: "task-1",
      status: "failed",
      finalVerifyStatus: "needs_manual_review",
      message: "unsafe evidence",
      updatedAt: "2026-01-01T00:00:00.000Z"
    }
  ],
  identity: { batchFingerprint: "batch-1", recordId: "record-1", taskId: "task-1" }
});
assert.deepEqual(mergedResumeArtifact.results.map((item) => item.targetKey), ["safe-1"]);

const hermesRunnerSource = [
  "src/cli/auto-listing-controller-contract.ts",
  "src/cli/auto-listing-controller-runtime.ts",
  "src/cli/auto-listing-controller-status.ts",
  "src/cli/auto-listing-controller.ts"
].map((file) => fs.readFileSync(file, "utf8")).join("\n");
const controllerProcessLivenessSource = fs.readFileSync("src/cli/controller-process-liveness.ts", "utf8");
const hermesSupervisorSource = fs.readFileSync("src/cli/auto-listing-supervisor.ts", "utf8");
const orchestratorSource = fs.readFileSync("src/autolist/orchestrator.ts", "utf8");
const processedCompletionRulesSource = fs.readFileSync("src/autolist/processed-completion-rules.ts", "utf8");
const publishSource = fs.readFileSync("src/autolist/publish.ts", "utf8");
const productListVerificationSource = fs.readFileSync(
  "src/business/publish-from-spu/product-list-verification-action.ts",
  "utf8"
);
const publishSubmitPageActionSource = fs.readFileSync(
  "src/business/publish-from-spu/publish-submit-page-action.ts",
  "utf8"
);
assert.match(
  productListVerificationSource,
  /ecom-g-tabs-nav-list[\s\S]*getByRole\("tab", \{ name: "售卖中", exact: true \}\)[\s\S]*getByRole\("tab", \{ name: "全部", exact: true \}\)/,
  "product-list verification must resolve 全部 only inside the unique product-status tab group"
);
assert.doesNotMatch(
  productListVerificationSource,
  /getByText\("全部", \{ exact: true \}\)/,
  "product-list verification must never fall back to page-wide 全部 text shared by filter controls"
);
assert.match(
  productListVerificationSource,
  /waitForUniqueProductListLocator[\s\S]*product status tab group[\s\S]*product status 全部 tab/,
  "product-list verification must wait for asynchronous list controls and fail with structural diagnostics"
);
assert.match(
  productListVerificationSource,
  /属性自动优化[\s\S]*getByRole\("button", \{ name: "Close", exact: true \}\)/,
  "product-list verification must close the auto-optimization opt-in dialog through its safe close control"
);
assert.match(
  productListVerificationSource,
  /商品质量分优化预警[\s\S]*getByRole\("button", \{ name: "知道了", exact: true \}\)[\s\S]*qualityScoreDialogs\.count[\s\S]*remained visible/,
  "product-list verification must acknowledge the quality-score warning through its unique safe button and verify dismissal"
);
assert.match(
  productListVerificationSource,
  /auxo-modal-mask[\s\S]*unrecognized modal overlay/,
  "product-list verification must diagnose an unknown blocking overlay instead of timing out on the query button"
);
assert.doesNotMatch(
  productListVerificationSource,
  /getByRole\([^\n]*立即开启|click[^\n]*立即开启/,
  "product-list verification must never grant auto-optimization authorization"
);
assert.match(
  productListVerificationSource,
  /searchInput\.locator\("xpath=ancestor::form\[1\]"\)[\s\S]*searchForm\.getByRole\("button", \{ name: "查询", exact: true \}\)/,
  "product-list verification must scope 查询 to the title input's form"
);
assert.match(
  productListVerificationSource,
  /waitForUniqueProductListLocator\([\s\S]*"title search input"[\s\S]*getByPlaceholder\("请输入商品名称\/商品ID\/商家编码，多条可用逗号隔开"\)/,
  "product-list verification must wait and fail closed unless the title search input is unique"
);
assert.doesNotMatch(
  productListVerificationSource,
  /normalizeText\(bodyText\)\.includes\(normalizedTitle\)/,
  "product-list verification must not infer a published row from page-wide text that can echo the query"
);
assert.match(
  productListVerificationSource,
  /waitForProductListQuerySettlement[\s\S]*searchParams\.get\("product_id"\)[\s\S]*共\\s\*\\d\+\\s\*条[\s\S]*暂无数据[\s\S]*visibleResultRows/,
  "product-list verification must prove query identity and a settled row-or-empty result before returning not-found"
);
assert.match(
  productListVerificationSource,
  /stableEmptyEvidenceCount[\s\S]*count === 0[\s\S]*visibleEmptyStates > 0[\s\S]*stableEmptyEvidenceCount >= 3/,
  "an exact query with a stable zero count and visible empty state must settle even when the product list keeps a permanent scroll spinner mounted"
);
assert.match(
  productListVerificationSource,
  /waitForLoadState\("networkidle", \{ timeout: 5000 \}\)/,
  "background page traffic must not add a second thirty-second false wait before structural list settlement"
);
assert.doesNotMatch(
  productListVerificationSource,
  /waitForTimeout\(2500\)/,
  "product-list verification must not use a fixed delay as evidence that an exact-title query returned no product"
);
assert.match(
  productListVerificationSource,
  /catch \(error\)[\s\S]*doudian-list-verification-failed[\s\S]*failureScreenshot/,
  "product-list verification failures must preserve a screenshot path for root-cause evidence"
);
assert.match(
  publishSubmitPageActionSource,
  /publishDialogMarkers = \["发布", "提交审核", "创建商品"\][\s\S]*dialogs\.filter/,
  "generic confirmation handling must be restricted to publish-related dialogs"
);
assert.doesNotMatch(
  hermesRunnerSource,
  /total\s*\|\|\s*["']\?["']/,
  "AutoListingController publish summary must not generate '?' for incomplete publish totals"
);
assert.match(
  hermesRunnerSource,
  /spawnSync\("pgrep",\s*\["-lf",\s*"auto-listing\.js"\]/,
  "AutoListingController direct-process discovery must fall back to pgrep when ps output is unavailable"
);
assert.match(
  hermesRunnerSource,
  /const directProcess = findActiveDirectAutoListingProcess\(\);\s*if \(directProcess\?\.runtimeDir\) \{\s*return summarizeActiveDirectAutoListingStatus\(directProcess\);/s,
  "AutoListingController status must prefer a live direct auto-listing process before historical result files"
);
assert.doesNotMatch(
  hermesRunnerSource,
  /const activePublishRunning = false;/,
  "AutoListingController status must not hard-code inactive publishing when the controller job file is missing"
);
assert.match(
  hermesRunnerSource,
  /function summarizeFeishuProgress\(processedManifestOverride\?: string\)/,
  "AutoListingController status must allow latest result artifacts to restore the processed-image manifest path"
);
assert.match(
  hermesRunnerSource,
  /historicalProcessedManifest[\s\S]*summarizeFeishuProgress\(historicalProcessedManifest\)/,
  "AutoListingController no-job status must use the latest result processed-image manifest instead of the default cache path"
);
assert.match(
  hermesRunnerSource,
  /artifacts:\s*\{\s*processedImageManifest:\s*result\.artifacts\?\.processedImageManifest\s*\}/,
  "AutoListingController summarized result must preserve the processed-image manifest path used by that run"
);
const publishFromSpuSource = [
  fs.readFileSync("src/business/publish-from-spu.ts", "utf8"),
  fs.readFileSync("src/business/publish-from-spu/basic-info-page-action.ts", "utf8"),
  fs.readFileSync("src/business/publish-from-spu/spec-service-page-action.ts", "utf8"),
  fs.readFileSync("src/business/publish-from-spu/service-fulfillment-page-action.ts", "utf8"),
  fs.readFileSync("src/business/publish-from-spu/graphic-file-input-action.ts", "utf8"),
  fs.readFileSync("src/business/publish-from-spu/graphic-section-preview-action.ts", "utf8"),
  fs.readFileSync("src/business/publish-from-spu/graphic-upload-page-action.ts", "utf8"),
  fs.readFileSync("src/business/publish-from-spu/publish-submit-page-action.ts", "utf8"),
  fs.readFileSync("src/business/publish-from-spu/publish-flow.ts", "utf8"),
  fs.readFileSync("src/business/publish-from-spu/job.ts", "utf8"),
  fs.readFileSync("src/business/publish-from-spu/price-inventory-action.ts", "utf8"),
  fs.readFileSync("src/business/publish-from-spu/publish-section-navigation.ts", "utf8")
].join("\n");
const publishAssetsSource = fs.readFileSync("src/business/publish-from-spu/assets.ts", "utf8");
const graphicPreviewSource = fs.readFileSync("src/business/publish-from-spu/graphic-section-preview-action.ts", "utf8");
const feishuAssetsSource = fs.readFileSync("src/feishu/assets.ts", "utf8");
const autoListingCliSource = fs.readFileSync("src/cli/auto-listing.ts", "utf8");
const auditAutoListingSource = fs.readFileSync("src/cli/audit-auto-listing.ts", "utf8");
const resumeSource = fs.readFileSync("src/autolist/resume.ts", "utf8");
const browserLaunchSource = fs.readFileSync("src/browser/launch.ts", "utf8");
const packageSource = fs.readFileSync("package.json", "utf8");
assert.match(
  hermesRunnerSource,
  /inferResumeStartStepForTask/,
  "AutoListingController runner must use resume-rules when building resume jobs so recoverable title-folder states resume at publish"
);
assert.match(
  hermesRunnerSource,
  /deferred-main-images/,
  "AutoListingController resume must know where deferred paid main-image rounds are stored."
);
assert.match(
  hermesRunnerSource,
  /findDeferredMainImageShopRootForResume[\s\S]*deferred-round\.json[\s\S]*countMatchingProductFoldersInShopRoot\(shopsDir,\s*names,\s*true\)/,
  "AutoListingController resume must activate a complete deferred round when the normal shop root no longer contains publishable folders."
);
assert.match(
  hermesRunnerSource,
  /resolvedShopRootDir[\s\S]*resumeJob\.input\.shopRootDir\s*=\s*resolvedShopRootDir[\s\S]*atomicWriteJson\(resumeJobFile,\s*resumeJob\)/,
  "Existing resume jobs must be rewritten to the recovered deferred shop root before product-folder validation invalidates them."
);
assert.match(
  publishSource,
  /buildPublishJobMetadata[\s\S]*feishuRecordId:\s*targetIdentity\.recordId/,
  "Auto-listing publish jobs must pass the canonical target recordId into Doudian publish metadata"
);
assert.match(
  publishSource,
  /requiresPostSubmitListVerification[\s\S]*publishClickAttempted === true[\s\S]*verifyPublishedProductInDoudianList[\s\S]*finalVerifyStatus:\s*"list_verified"/,
  "Auto-listing publish must resolve any post-submit unverified result by read-only Doudian 全部 tab full-title verification before treating the target as unsafe"
);
assert.doesNotMatch(
  publishSource,
  /list-verification-retry|replaying publish once|Retrying publish after Doudian list verification returned no product/,
  "Auto-listing must never replay a final-submit-uncertain target after a read-only list lookup"
);
assert.match(
  publishSource,
  /listVerification\?\.found === false[\s\S]*preserving uncertainty and refusing to replay publish/,
  "A negative post-submit list lookup must preserve uncertainty without crossing the irreversible boundary again"
);
assert.match(
  publishSource,
  /if \(!listVerification\)[\s\S]*finalVerifyStatus:\s*"submit_accepted_unconfirmed"[\s\S]*errorClass:\s*"final_publish_state_uncertain"/,
  "An inconclusive post-submit list lookup must be converted to an unresolved boundary so later shops cannot run"
);
assert.match(
  publishSource,
  /finalVerifyStatus === "submit_rejected_confirmed"[\s\S]*listVerification\.found === false[\s\S]*confirmed rejection plus negative exact-title list verification[\s\S]*runPublishFromSpuJob/,
  "Only an explicit platform rejection plus a negative exact-title list check may permit one controlled republish"
);
assert.match(
  publishSource,
  /requiresPostSubmitListVerification\(existingDecision,\s*existingSummary\)[\s\S]*verifyPublishedProductInDoudianList[\s\S]*finalVerifyStatus:\s*"list_verified"[\s\S]*continue;[\s\S]*refusing to replay publish/,
  "Auto-listing resume must resolve an existing uncertain submit read-only or stop without replaying publish"
);
assert.match(
  publishSource,
  /\["not_checked", "submit_accepted_unconfirmed", "needs_manual_review"\][\s\S]*publish batch stopped at an unsafe or unresolved submit boundary[\s\S]*break;/,
  "Any unresolved final-submit state must stop later shop targets immediately"
);
assert.match(
  publishFromSpuSource,
  /reassertRadioOptionNearFieldLabelCandidates[\s\S]*clickRadioOptionNearFieldLabelCandidate[\s\S]*firstReadback[\s\S]*secondReadback[\s\S]*ensurePublishSectionTab\(page, "\\u4ef7\\u683c\\u5e93\\u5b58"\)[\s\S]*shippingModeReasserted[\s\S]*shippingTimeReasserted[\s\S]*ensureServiceSectionReady/,
  "Service fulfillment must emit explicit shipping radio events and require stable readback near final submit"
);
assert.match(
  publishSource,
  /shouldRunPendingTargetProductListPreflight\(options\.productListPreflightMode\)[\s\S]*Preflight checking Doudian 全部 tab for an existing exact-title product[\s\S]*verifyPublishedProductInDoudianList[\s\S]*if \(listVerification\.found\)[\s\S]*finalVerifyStatus:\s*"list_verified"/,
  "Pending-target exact-title preflight must run only through the unresolved-disorder rule gate"
);
assert.doesNotMatch(
  publishSource,
  /if \(!listCheckedNotFound\) \{\s*options\.assertNotPaused/,
  "Known-sequence publish must not perform the old unconditional per-target product-list preflight"
);
assert.match(
  publishFromSpuSource,
  /classifyAssets\(productFolder,\s*\{\s*feishuRecordId:\s*input\.metadata\?\.feishuRecordId\s*\}\)/s,
  "Doudian publish asset classification must receive the current Feishu recordId"
);
assert.match(
  publishAssetsSource,
  /findFeishuProductRecordById[\s\S]*getFeishuWhiteBackgroundImages[\s\S]*findFeishuProductRecordById\(feishuRecordId/,
  "Publish assets must prefer exact Feishu recordId lookup before folder-name fallback matching"
);
assert.match(
  feishuAssetsSource,
  /record\.recordId[\s\S]*attachmentIdentityDigest/,
  "Feishu asset filenames must include recordId and attachment identity so same-SPU packaging variants cannot share local files"
);
assert.match(
  hermesSupervisorSource,
  /currentFeishuAssetCacheUnsafe[\s\S]*findSharedFeishuWhiteBackgroundLocalFile[\s\S]*localAssetCacheUnsafe/,
  "Supervisor must refresh Feishu assets before same-batch continuation when local white-image paths collide across records"
);
assert.match(
  hermesRunnerSource,
  /latestAutoListingChildFailureFromLog[\s\S]*childFailureMessage[\s\S]*terminalFailureMessage/,
  "AutoListingController status must expose a failed child continuation instead of hiding it behind pending-products"
);
assert.match(
  hermesRunnerSource,
  /const shouldUsePublishRealtime = publishProgressHasNewerActive \|\| publishProgressHasNewerArtifact \|\| !preferStateSummary;/,
  "AutoListingController status must compute a single gate before exposing publish realtime signals"
);
assert.match(
  hermesRunnerSource,
  /publishLogMessage:\s*shouldUsePublishRealtime && typeof publishLogProgress\?\.message === "string"/,
  "AutoListingController status must not expose stale publishLogProgress while current state/image progress is newer"
);
const priceInventoryDomSlice = publishFromSpuSource.slice(
  publishFromSpuSource.indexOf("function findPriceInventoryTableDomRows"),
  publishFromSpuSource.indexOf("async function detectPriceInventoryValuesInsideSpecInputs")
);
const specTemplateSelectionSource = publishFromSpuSource.slice(
  publishFromSpuSource.indexOf("async function chooseSpecTemplateKeywordFromDropdown"),
  publishFromSpuSource.indexOf("async function scrollMainFormContainerToBottom")
);
const uploadMainImagesSource = publishFromSpuSource.slice(
  publishFromSpuSource.indexOf("async function uploadMainImagesToSection"),
  publishFromSpuSource.indexOf("async function countGraphicSectionPreviews")
);
assert.match(
  priceInventoryDomSlice,
  /querySelectorAll\("th, td"\)[\s\S]*cellIndex[\s\S]*priceCellIndex[\s\S]*stockCellIndex/,
  "price/inventory row targeting must derive price and stock inputs from table DOM headers and cell indexes"
);
assert.doesNotMatch(
  uploadMainImagesSource,
  /waitForPreviewCount\(page, \(\) => countMainImagePreviews\(page\), files\.length, 8000\)/,
  "main-image upload must not defer confirmation to a single long end-of-batch wait"
);
assert.match(
  uploadMainImagesSource,
  /const observedCount = await waitForPreviewCount\([\s\S]*fileIndex === 0 \? 4000 : 3000[\s\S]*await page\.waitForTimeout\(fileIndex === 0 \? 450 : 180\);/,
  "main-image upload must use short per-file confirmation windows"
);
assert.match(
  uploadMainImagesSource,
  /logWarn\([\s\S]*only confirmed[\s\S]*clearing section and restarting once[\s\S]*const secondAttempt = await uploadSequenceOnce\(\);[\s\S]*throw new Error\([\s\S]*confirmed=/,
  "the main-image batch must fail closed and restart once instead of letting a partial result continue"
);
assert.match(
  uploadMainImagesSource,
  /resolveCurrentMainImageUploadInput[\s\S]*const uploadSequenceOnce[\s\S]*resolveCurrentMainImageUploadInput\(page, fileIndex\)/,
  "main-image upload must resolve current Doudian file inputs for every slot instead of reusing stale indexes after DOM rerenders"
);
assert.match(
  publishFromSpuSource,
  /resolveCurrentMainImageUploadInput[\s\S]*resolveExactMainImageFieldRoot\(page\)[\s\S]*input\[type='file'\]\[accept\*='image'\]/,
  "main-image upload must discard same-text labels outside the publish form before selecting the exact 主图 field root"
);
assert.match(
  graphicPreviewSource,
  /locator\("div\.goods-publish-highlight-group"\)[\s\S]*filter\(\{ has: page\.getByText\("主图", \{ exact: true \}\) \}\)[\s\S]*roots\.count\(\)\) === 1/,
  "the shared main-image field resolver must require exactly one publish-form root containing an exact 主图 label"
);
const exactMainPreviewCounterSource = graphicPreviewSource.slice(
  graphicPreviewSource.indexOf("export async function countMainImagePreviews"),
  graphicPreviewSource.indexOf("export async function readDetailIndicatorCount")
);
assert.match(
  exactMainPreviewCounterSource,
  /resolveExactMainImageFieldRoot[\s\S]*fieldRoot\.evaluate[\s\S]*querySelectorAll\("img, \[style\*='background-image'\]"\)/,
  "main-image atomic readback must count previews only inside the exact publish-form 主图 field root"
);
assert.doesNotMatch(
  exactMainPreviewCounterSource,
  /document\.querySelectorAll|getBoundingClientRect|current\.top|nextTop/,
  "main-image atomic readback must not use global document geometry"
);
assert.match(
  uploadMainImagesSource,
  /for \(let fileIndex = 0; fileIndex < files\.length; fileIndex \+= 1\)[\s\S]*const expectedCount = Math\.max\(previousCount, fileIndex \+ 1\)[\s\S]*waitForPreviewCount\([\s\S]*expectedCount/,
  "main-image upload must overwrite stale slot previews and confirm by slot position instead of skipping files when stale previews exist"
);
assert.doesNotMatch(
  uploadMainImagesSource,
  /Math\.min\(previousCount, files\.length\)/,
  "main-image upload must not assume existing previews are the correct files"
);
assert.doesNotMatch(
  priceInventoryDomSlice,
  /score|centerX|distanceToPrice|distanceToStock|getBoundingClientRect\(\)\.x/,
  "price/inventory row targeting must not use coordinate distance or scoring heuristics"
);
assert.match(
  specTemplateSelectionSource,
  /const candidates = resolveSpecTemplateKeywordCandidates\(keyword\);[\s\S]*await clickSpecTemplateDropdownTargetWithOverlayRecovery\(page\);[\s\S]*const visibleClickedText = await clickSpecTemplateOptionByDomStructure\(page, candidates\)[\s\S]*return visibleClickedText;[\s\S]*const input = await findSpecTemplateInputInFieldRootOnPage\(page\);[\s\S]*await clickSpecTemplateDropdownTargetWithOverlayRecovery\(page\);[\s\S]*await input\.fill\(candidate\)[\s\S]*await page\.waitForTimeout\(80\);[\s\S]*clickSpecTemplateOptionByDomStructure\(page, candidates\)[\s\S]*return clickedText;/,
  "spec-template selection must open the goods-spec dropdown before clicking a visible option and return the clicked template without waiting for expansion"
);
assert.doesNotMatch(
  specTemplateSelectionSource,
  /waitForSpecTemplateSelectionConfirmation|waitForTimeout\(300\)|waitForTimeout\(600\)|waitForTimeout\(800\)|waitForTimeout\(2500\)/,
  "spec-template selection must not use the old confirmation polling or legacy fixed waits"
);
assert.match(
  hermesSupervisorSource,
  /resolveSupervisorRecoveryChildMode[\s\S]*prepareResumeJob\(\)[\s\S]*nextMode = recoveryMode/,
  "AutoListingController supervisor must rebuild and execute a resume job for safe resume-stage transitions"
);
assert.match(
  hermesSupervisorSource,
  /childMode === "resume"[\s\S]*prepareResumeJob\(\)[\s\S]*nextMode = "resume"[\s\S]*continue/,
  "A successful resume child with pending batch work must keep resuming manifest-backed publish targets before returning to full flow"
);
assert.match(
  hermesSupervisorSource,
  /latestProgressMtimeMs[\s\S]*paid-image-submissions[\s\S]*mtimeMs/,
  "supervisor watchdog must observe paid image ledger updates so accepted external image tasks are not mistaken for a stalled child"
);
assert.match(
  hermesSupervisorSource,
  /function readMtimeMsIfPresent[\s\S]*ENOENT[\s\S]*latestProgressMtimeMs[\s\S]*paid-image-submissions[\s\S]*readMtimeMsIfPresent/,
  "supervisor watchdog must tolerate paid-image lock files disappearing between directory enumeration and stat"
);
assert.match(
  hermesSupervisorSource,
  /shouldRefreshProgressSeenAtForPaidImageWait/,
  "supervisor watchdog must still classify visible progress messages before deciding whether to refresh progress time"
);
assert.equal(
  shouldRefreshProgressSeenAtForPaidImageWait({
    activeStep: "main_images_generated",
    activeMessage: "Prompt 3/5: Image 4: videos-base64 task task_qn0 status queued 0."
  }),
  false,
  "videos-base64 queued 0 is an external-service heartbeat, not business progress"
);
assert.equal(
  shouldRefreshProgressSeenAtForPaidImageWait({
    activeStep: "main_images_generated",
    activeMessage: "Prompt 3/5: Image 4: videos-base64 task task_qn0 status pending 0."
  }),
  false,
  "videos-base64 pending 0 is an external-service heartbeat, not business progress"
);
assert.equal(
  shouldRefreshProgressSeenAtForPaidImageWait({
    activeStep: "main_images_generated",
    activeMessage: "Prompt 3/5: Image 4: videos-base64 task task_qn0 status completed 100."
  }),
  true,
  "completed provider status is real progress"
);
assert.equal(
  shouldRefreshProgressSeenAtForPaidImageWait({
    activeStep: "main_images_generated",
    activeMessage: "Prompt 3/5: Image 4: saved generated-04.png."
  }),
  true,
  "saved image output is real progress"
);
assert.match(
  hermesRunnerSource,
  /hasIncompleteFixedMainImageRoundFiles[\s\S]*return "main_images_generated"/,
  "AutoListingController must rewind publish-stage resumes when fixed main-image slots are incomplete"
);
assert.match(
  hermesRunnerSource,
  /function shouldResumeCurrentFailure[\s\S]*hasIncompleteFixedMainImageRoundFiles[\s\S]*fs\.rmSync\(resumeJobFile, \{ force: true \}\)/,
  "AutoListingController must invalidate an already-generated publish resume job when fixed main-image slots are incomplete"
);

const incompleteFixedSlotsRun = fs.mkdtempSync(path.join(os.tmpdir(), "incomplete-fixed-slots-"));
const incompleteFixedSlotsRaw = path.join(
  incompleteFixedSlotsRun,
  "tasks",
  "image-001",
  "main-image-04",
  "openai-compatible",
  "raw"
);
fs.mkdirSync(incompleteFixedSlotsRaw, { recursive: true });
for (const index of [2, 3, 4]) {
  fs.writeFileSync(path.join(incompleteFixedSlotsRaw, `generated-${String(index).padStart(2, "0")}.png`), String(index));
}
assert.equal(
  hasIncompleteFixedMainImageRoundFiles({ runtimeDir: incompleteFixedSlotsRun, taskId: "image-001", expectedImagesPerRound: 4 }),
  true
);
fs.writeFileSync(path.join(incompleteFixedSlotsRaw, "generated-01.png"), "1");
assert.equal(
  hasIncompleteFixedMainImageRoundFiles({ runtimeDir: incompleteFixedSlotsRun, taskId: "image-001", expectedImagesPerRound: 4 }),
  false
);
assert.match(
  hermesRunnerSource,
  /compactStatusLine/,
  "AutoListingController text status must compact very long log/error lines before returning them to Feishu"
);
assert.match(
  hermesRunnerSource,
  /基础信息模块未完成/,
  "AutoListingController status must summarize basic-info publish failures in plain Chinese"
);
assert.match(
  hermesRunnerSource,
  /最终发布动作未完成/,
  "AutoListingController status must summarize final publish-submit failures in plain Chinese"
);
assert.match(
  packageSource,
  /"auto-listing:hermes-status":\s*"[^"]*status --text"/,
  "AutoListingController status script must default to concise human-readable text for Feishu/AutoListingController replies"
);
assert.match(
  packageSource,
  /"auto-listing:hermes-start":\s*"[^"]*start-new --text"/,
  "Hermes start script must default to concise human-readable text for Feishu/AutoListingController replies"
);
assert.match(
  packageSource,
  /"auto-listing:hermes-continue":\s*"[^"]*continue --text"/,
  "Hermes continue script must default to concise human-readable text for Feishu/AutoListingController replies"
);
assert.match(
  hermesSupervisorSource,
  /latestTerminalResultAfter/,
  "AutoListingController watchdog must detect a terminal result file and preserve the real child outcome instead of reporting no-progress timeout"
);
assert.match(
  hermesSupervisorSource,
  /auto-listing-wait\.json/,
  "Project supervisor must persist external-service waiting state for status reporting"
);
assert.match(
  hermesRunnerSource,
  /external_service_wait/,
  "AutoListingController status must expose external-service waiting instead of looking permanently failed"
);
assert.match(
  autoListingCliSource,
  /disconnectAutomationBrowserConnections/,
  "Auto-listing CLI must release reusable CDP automation connections after every terminal result"
);
assert.match(
  auditAutoListingSource,
  /preflight\.json[\s\S]*simulateOnly[\s\S]*latestRunState\(resolved\.runtimeRootDir, resolved\.simulateOnly, batchFingerprint, businessRuleFingerprint\)/,
  "Real auto-listing audits must ignore simulated verification runs when selecting the latest run state"
);
assert.match(
  auditAutoListingSource,
  /resolveProcessedImageManifestForAudit[\s\S]*artifacts\?\.processedImageManifest[\s\S]*readProcessedImages\(effectiveProcessedImageManifest, batchFingerprint\)/,
  "Auto-listing audits must use the latest exact-batch result processed-image manifest instead of the default job cache path"
);
assert.match(
  auditAutoListingSource,
  /code\s*===\s*"EPERM"/,
  "Auto-listing audit must treat EPERM from process probes as an alive controller in restricted runtimes"
);
assert.match(
  browserLaunchSource,
  /connectedAutomationBrowsers/,
  "Browser action layer must track reusable CDP connections so terminal cleanup can release them"
);
assert.match(
  hermesRunnerSource,
  /shouldResumeSourceImageForCurrentFeishuBatch/,
  "AutoListingController runner must delegate stale resume-job filtering to a current-Feishu-batch resume guard"
);
assert.match(
  hermesRunnerSource,
  /shouldResumeHistoricalFailureForCurrentFeishuBatch/,
  "AutoListingController runner must use the rule-layer guard before resuming historical failures"
);
assert.doesNotMatch(
  resumeSource,
  /options\.mainImageWorkDir/,
  "Resume must recover Word prompts only from the current runtime task directory, never a shared global directory"
);
assert.match(
  resumeSource,
  /expectedProductFolderNames\.size === 0[\s\S]*throw new Error/,
  "Shop-folder resume must fail closed when the resume job lacks an exact product-folder allowlist"
);
assert.match(
  hermesRunnerSource,
  /canResumeFeishuBatchArtifacts/,
  "AutoListingController must require exact Feishu batch identity before selecting any historical resume artifacts"
);
assert.match(
  orchestratorSource,
  /canResumeAutoListingArtifacts/,
  "The orchestrator must independently reject resume jobs outside the current batch or business rules"
);
assert.match(
  orchestratorSource,
  /auditMainImageGeneration/,
  "Auto-listing orchestrator must run the main-image completeness audit before downstream title/distribution/publish steps"
);
assert.match(
  orchestratorSource,
  /Main image completion gate failed/,
  "Auto-listing orchestrator must fail closed when generated raw/staged main images are incomplete"
);
assert.match(
  orchestratorSource,
  /Main image completion gate failed[\s\S]*Product folders ready/,
  "Product folders must not be considered ready until the main-image completion gate has passed"
);
assert.match(
  orchestratorSource,
  /auditPublishMainImageSubset[\s\S]*expectedProductFolders:\s*distributedFolders[\s\S]*publishDistributedProducts/,
  "Publish-stage known-target resumes must validate their exact remaining image subset before browser mutation."
);
assert.match(
  orchestratorSource,
  /currentBatchPaidLedgerExists[\s\S]*shouldCleanupStaleRunHistory[\s\S]*!currentBatchPaidLedgerExists[\s\S]*enabled:\s*resolved\.input\.clearTestOutputsBeforeRun\s*&&\s*!currentBatchPaidLedgerExists/,
  "A current-batch paid ledger must protect unfinished publish runtime and shop assets from destructive full-flow pre-run cleanup."
);
assert.match(
  orchestratorSource,
  /isProductFullyProcessed[\s\S]*appendProcessedImages[\s\S]*removePaidImageProductLedger/,
  "A safely completed product must be atomically marked processed before its project-owned paid-image ledger is deleted"
);
assert.match(
  orchestratorSource,
  /step === "cleaned"[\s\S]*hasCompleteProductPublishCoverage[\s\S]*Cleanup deferred[\s\S]*archiveUnwatermarkedMainImages/,
  "A partial publish-stage resume must defer archive and cleanup until every planned target has safe manifest coverage"
);
assert.match(
  orchestratorSource,
  /summarizeFeishuBatchProgress[\s\S]*finalBatchProgress\.batchComplete[\s\S]*removePaidImageBatchLedger/,
  "A fully completed Feishu batch must remove its project-owned paid-image batch ledger at run completion"
);
assert.match(
  hermesSupervisorSource,
  /currentBatch\.batchComplete[\s\S]*cleanupCompletedBatchArtifacts/,
  "The project supervisor must clean completed-batch ledgers and stale run history automatically"
);
assert.match(
  hermesRunnerSource,
  /decision === "rerun_current_batch"[\s\S]*clearCurrentBatchPaidImageLedger[\s\S]*clearCurrentBatchProcessedImages/,
  "Confirmed current-batch rerun must delete the completed batch paid-image ledger before starting fresh generation"
);
assert.match(
  orchestratorSource,
  /expectedImagesPerPrompt:\s*mainImageExpectedCount/,
  "Main-image completion gate must use per-prompt expected image count, not per-shop distribution count"
);
assert.match(
  hermesRunnerSource,
  /shouldResumeCurrentFailure\(\)[\s\S]*findLatestInterruptedStateForResume\(\)/,
  "AutoListingController runner must preserve a valid current resume job before rebuilding one from interrupted state"
);
assert.match(
  hermesRunnerSource,
  /safelyPublishedCount/,
  "AutoListingController runner must rank interrupted resume candidates by publish-manifest progress before raw artifact count"
);
assert.match(
  hermesRunnerSource,
  /countResumeProductFolders/,
  "AutoListingController resume must count restored product folders as reusable publish-stage artifacts"
);
assert.deepEqual(
  selectRemainingResumeProductFolderNames({
    allProductFolderNames: ["product-水印01", "product-水印02", "product-水印03"],
    manifestEntries: [{ productFolder: "/shops/01/product-水印01", status: "published", finalVerifyStatus: "publish_signal_confirmed" }]
  }),
  ["product-水印02", "product-水印03"],
  "Manifest-backed recovery must include every not-yet-safe target after the failed shop, not only the single failed entry."
);
assert.equal(
  hasPendingResumeProductFolders({
    resumeProductFolderNames: ["product-水印18", "product-水印19", "product-水印20"],
    manifestEntries: [{ productFolder: "/shops/01/product-水印01", status: "published", finalVerifyStatus: "publish_signal_confirmed" }]
  }),
  true,
  "Safe evidence for earlier shops must not satisfy the exact remaining resume allowlist."
);
assert.match(hermesRunnerSource, /unsafeLatest[\s\S]*selectRemainingResumeProductFolderNames/);
assert.match(
  hermesRunnerSource,
  /const resumeProductFolderCount = countResumeProductFolders\(resumeJob\)[\s\S]*summarizeReusableTaskArtifacts[\s\S]*Math\.max\(reusableTaskArtifacts\.reusableArtifactCount, resumeProductFolderCount\)/,
  "AutoListingController resume must ask the autolist project layer whether paid/raw artifacts make a resume safe"
);
assert.doesNotMatch(
  hermesRunnerSource,
  /paid-image-ledger|countReusablePaidImageLedgerSlots/,
  "AutoListingController must not directly parse paid-image ledger internals; reusable paid assets belong to the autolist project layer"
);
assert.match(
  hermesRunnerSource,
  /summarizeReusableTaskArtifacts/,
  "AutoListingController may only ask the autolist project layer for reusable task artifact counts"
);
assert.match(
  hermesRunnerSource,
  /const imageProgressSummaryMessage[\s\S]*imageProgress[\s\S]*latestMessage[\s\S]*stateSummary/,
  "AutoListingController status summary must include image generation progress so main-image batches are visible before final publish results"
);
assert.match(
  hermesRunnerSource,
  /findInterruptedState\(\)[\s\S]*summarizeState\([\s\S]*interrupted[\s\S]*runtimeDir[\s\S]*summarizeImageGenerationProgress/,
  "AutoListingController idle/pause status must expose the latest interrupted main-image state instead of falling back to publish counters"
);
assert.match(
  hermesRunnerSource,
  /publishProgress:\s*activePublishRunning\s*\?\s*publishProgress\s*:\s*undefined/,
  "AutoListingController idle/pause text status must not expose inactive historical publish progress over current image-generation state"
);
assert.match(
  hermesRunnerSource,
  /shouldInvalidatePublishedResumeWithoutProductFolders[\s\S]*fs\.rmSync\(resumeJobFile, \{ force: true \}\)/,
  "AutoListingController resume must discard a published-stage resume job when its declared product folders are missing on disk"
);
assert.match(
  hermesRunnerSource,
  /inferResumeStartStepFromRuntimeFiles[\s\S]*openai-compatible[\s\S]*raw[\s\S]*main_images_generated/,
  "AutoListingController resume must use real runtime raw/staged files to resume local main-image recovery before distribution/publish"
);
assert.match(
  hermesRunnerSource,
  /const resumeProductFolderCount = collectResumeProductFolderNames\(failedTask\)\.length[\s\S]*summarizeReusableTaskArtifacts[\s\S]*shouldResumeSourceImageForCurrentFeishuBatch\([\s\S]*reusableArtifactCount/,
  "AutoListingController failed-result resume selection must delegate reusable paid/raw artifact counting to autolist project logic"
);
assert.match(
  hermesRunnerSource,
  /publishResumeNeedsWork[\s\S]*startStep === "published"[\s\S]*resumeProductFolderCount > 0[\s\S]*hasPendingResumeProductFolders/,
  "AutoListingController resume must continue publish-stage work when restored product folders exist but publish manifest is not safely complete"
);
assert.match(
  hermesRunnerSource,
  /const unsafePublishResumeNeedsWork =[\s\S]*unsafePublishEntriesForResume\(resumeRuntimeDir\)[\s\S]*const shouldResume = unsafePublishResumeNeedsWork \|\| publishResumeNeedsWork \|\| !result \|\| \(result\.ok !== true && result\.status !== "success"\)/,
  "AutoListingController resume must let unsafe publish manifest entries override an incorrectly successful result file"
);
assert.match(
  hermesRunnerSource,
  /findLatestUnsafePublishManifestForResume\(\)[\s\S]*const resumeProductFolderNames[\s\S]*startStep: "published"/,
  "AutoListingController unsafe publish resume must restart at the publish stage and must not regenerate titles"
);
assert.match(
  hermesRunnerSource,
  /if \(!unsafePublishResumeNeedsWork && !publishResumeNeedsWork && \(!latestRelevantFailure \|\| path\.resolve\(latestRelevantFailure\.resultFile\) !== resultFile\)\)/,
  "AutoListingController resume must not discard a valid unsafe-publish resume job only because the stale result file was incorrectly marked successful"
);
assert.match(
  hermesRunnerSource,
  /if \(shouldResume && failedTask && !publishResumeNeedsWork\)/,
  "AutoListingController resume must not let a stale failed task re-infer and overwrite a publish-stage resume job that still needs publish work"
);
assert.match(
  hermesRunnerSource,
  /resolveAutoListingControllerStartAfterFeishuRefresh/,
  "AutoListingController start must use the rule-layer decision after refreshing a completed Feishu batch"
);
assert.match(
  hermesRunnerSource,
  /rerun_confirmation_required/,
  "AutoListingController start must ask for confirmation instead of rerunning a completed unchanged Feishu batch"
);
assert.match(
  hermesRunnerSource,
  /--rerun-current-batch/,
  "AutoListingController start must require an explicit rerun flag before clearing completed batch progress"
);
assert.match(
  hermesRunnerSource,
  /launchPolicy\.refreshBeforeSelection[\s\S]*runFeishuAssetsRefreshForStart\(\)[\s\S]*const selected = selectCommand\(forceFullFlow\)/,
  "AutoListingController new-batch start must refresh Feishu before selecting any execution command"
);
assert.match(
  hermesRunnerSource,
  /batchFingerprint: selectedBatchFingerprint/,
  "Controller jobs must persist the exact selected Feishu batch fingerprint"
);
assert.match(
  hermesSupervisorSource,
  /shouldRefreshFeishuAssetsToCandidateCache[\s\S]*feishu-products\.refresh-candidate\.json[\s\S]*copyFileSync/,
  "AutoListingSupervisor post-completion Feishu refresh must write a candidate cache and only promote it after validation"
);
assert.match(
  hermesRunnerSource,
  /runtimeBatchFingerprint[\s\S]*shouldExposeHistoricalRuntimeForCurrentFeishuBatch/,
  "Active and terminal controller status must fail closed when runtime evidence belongs to another batch"
);
assert.match(
  hermesRunnerSource,
  /cleanupRecordedAutoListingControllerChild/,
  "AutoListingController start must clean a recorded orphan child process group before starting another supervisor"
);
assert.match(
  hermesSupervisorSource,
  /writeAutoListingControllerChildControl/,
  "AutoListingController supervisor must record each detached child process group for orphan recovery"
);
assert.match(
  publishSource,
  /onProgress\?/,
  "Publish stage must emit per-product progress callbacks instead of only updating publish-manifest"
);
assert.match(
  publishFromSpuSource,
  /waitForPublishSubmissionFromContext/,
  "Final submit recovery must poll the browser context for submission outcome after clicking 发布商品 instead of requiring the loading page to become an editable create page again"
);
assert.match(
  publishFromSpuSource,
  /publishClickAttempted:\s*flowResult\.publishClickAttempted/,
  "Final submit attempt state must be persisted into the publish result for project-owned resume decisions"
);
assert.match(
  publishFromSpuSource,
  /publishButton\.click\(\{ timeout: 5000, noWaitAfter: true \}\);\s*publishClickAttempted = true;/,
  "Final submit state must only become terminal after the click event is issued, without waiting for post-click navigation"
);
assert.doesNotMatch(
  publishFromSpuSource,
  /if \(publishClickAttempted\) \{[\s\S]*recoveredEditablePage[\s\S]*publishButton\.click/,
  "A final submit click that was already issued must never recover the editable page and click publish again in the same action"
);
assert.match(
  publishSource,
  /publishClickAttempted:\s*result\.data\?\.browser\?\.publishClickAttempted/,
  "Auto-listing publish resume must read the persisted final submit attempt state"
);
assert.doesNotMatch(
  publishFromSpuSource,
  /if \(!publishClicked \|\| publishIssue\) \{\s*stages\.push\(\{ step: "click_publish_product", status: "failed" \}\);\s*throw/,
  "The publish action must not throw away final-submit state after a submit click was already issued"
);
assert.match(
  orchestratorSource,
  /recordTaskProgress\(current, step, message\)/,
  "Orchestrator must record publish progress callback messages into state for Feishu node-level reporting"
);
assert.match(
  orchestratorSource,
  /appendEvent\(eventFile, createEvent\("info", step, message, current\.taskId\)\)/,
  "Orchestrator must append publish progress callback messages to events.ndjson for AutoListingController status"
);
assert.match(
  hermesRunnerSource,
  /summarizePublishLogProgress[\s\S]*publish module started[\s\S]*publishLogProgress[\s\S]*latestProgressText/,
  "AutoListingController status must surface publish module log heartbeats so reports do not look stalled during long Doudian module actions"
);
assert.match(
  processedCompletionRulesSource,
  /taskHasSafePublishArtifact[\s\S]*SAFE_PUBLISH_FINAL_VERIFY_STATUSES[\s\S]*manifestHasSafePublishCoverage/,
  "Processed-image marking must accept safe publish evidence from task artifacts or publish-manifest, not only cleaned/done task status"
);
assert.match(
  orchestratorSource,
  /loadPublishManifest\(resolved\.runtimeDir\)[\s\S]*appendProcessedImages/,
  "Orchestrator must use publish-manifest coverage when marking a cleanup-resumed product as processed"
);
assert.match(
  orchestratorSource,
  /Recovered Feishu product identity for publish-stage resume/,
  "Publish-stage resume must recover Feishu product identity without depending on saved Word prompt files"
);
assert.match(
  orchestratorSource,
  /Recovered distributed product folders from shop root directory[\s\S]*Recovered selling points and poster prompts from saved Word files/,
  "Publish-stage resume must recover distributed product folders before falling back to Word prompt recovery"
);
assert.match(
  orchestratorSource,
  /!\(startIndex >= publishStepIndex && current\.shopDistributionArtifact\?\.distributedFolders\?\.length\)/,
  "Publish-stage resume with restored product folders must not require saved Word prompt files"
);

const state = createRunState("test-run", ["/tmp/product.png"]);
const task = state.tasks[0];
const before = task.lastUpdatedAt;

await new Promise((resolve) => setTimeout(resolve, 5));

const updated = recordTaskProgress(task, "main_images_generated", "Prompt 2/5: Image 4: submitting edits request.");

assert.equal(updated.status, "main_images_generated");
assert.notEqual(updated.lastUpdatedAt, before);
assert.equal(updated.notes.at(-1), "main_images_generated: Prompt 2/5: Image 4: submitting edits request.");

const saved = recordTaskProgress(updated, "main_images_generated", "Prompt 2/5: Image 4: saved generated-04.png.");

assert.equal(saved.status, "main_images_generated");
assert.equal(saved.notes.at(-1), "main_images_generated: Prompt 2/5: Image 4: saved generated-04.png.");
assert.ok(saved.notes.length <= 25);
assert.equal(
  buildFeishuSellingPointText({
    userCognitionName: "医用芦荟凝胶",
    brandedGenericName: "延草纲目医用聚乙二醇护创敷料",
    sellingPointText: "120g/盒，官方正品，二类医疗器械认证"
  }),
  "120g/盒，官方正品，二类医疗器械认证"
);
assert.ok(
  !buildFeishuSellingPointText({
    userCognitionName: "医用芦荟凝胶",
    brandedGenericName: "延草纲目医用聚乙二醇护创敷料",
    sellingPointText: "120g/盒，官方正品，二类医疗器械认证"
  }).startsWith("医用芦荟凝胶,延草纲目医用聚乙二醇护创敷料")
);

const resumedState = applyResumeTaskId(createRunState("resume-run", ["/tmp/product-2.png"]), "image-002");
assert.equal(resumedState.tasks[0].taskId, "image-002");
assert.equal(resumedState.currentTaskId, "image-002");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "auto-listing-progress-"));
const eventsFile = path.join(tempDir, "events.ndjson");
fs.writeFileSync(
  eventsFile,
  [
    JSON.stringify({ timestamp: "2026-05-23T10:01:00.000Z", level: "info", taskId: "image-001", step: "main_images_generated", message: "Prompt 1/5: Image 1: saved generated-01.png." }),
    JSON.stringify({ timestamp: "2026-05-23T10:02:00.000Z", level: "info", taskId: "image-002", step: "main_images_generated", message: "Prompt 1/5: Image 1: submitting edits request." }),
    JSON.stringify({ timestamp: "2026-05-23T10:03:00.000Z", level: "info", taskId: "image-001", step: "main_images_generated", message: "Prompt 1/5: Image 2: submitting edits request." })
  ].join("\n") + "\n",
  "utf8"
);

const latestEvent = readLatestTaskProgressEvent(eventsFile, "image-001");

assert.deepEqual(latestEvent, {
  timestamp: "2026-05-23T10:03:00.000Z",
  step: "main_images_generated",
  message: "Prompt 1/5: Image 2: submitting edits request."
});
assert.deepEqual(
  summarizeAutoListingControllerImageGenerationEvents([
    { timestamp: "2026-05-23T10:01:00.000Z", message: "Prompt 4/5: Image 1: saved generated-01.png." },
    { timestamp: "2026-05-23T10:02:00.000Z", message: "Prompt 4/5: Image 2: saved generated-02.png." },
    { timestamp: "2026-05-23T10:03:00.000Z", message: "Prompt 4/5: Image 3: submitting edits request." }
  ]),
  {
    status: "generating",
    count: undefined,
    latestMessage: "Prompt 4/5: Image 3: submitting edits request.",
    latestSavedMessage: "Prompt 4/5: Image 2: saved generated-02.png.",
    latestSavedImage: 2,
    updatedAt: "2026-05-23T10:03:00.000Z",
    latestSavedAt: "2026-05-23T10:02:00.000Z"
  }
);
const hermesPublishStatusPayload = resolveAutoListingControllerHermesStatusPayload({
  status: "running",
  summary: "当前商品：延草纲目宝元堂痛风医用远红外治疗凝胶，发布 18/20，店铺 9/10",
  realtimeProgress: {
    source: "publish_active",
    message: "发布模块：图文信息（09延草纲目中医保健专营店）",
    timestamp: "2026-06-14T05:12:27.505Z"
  },
  publishProgress: {
    safelyPublished: 17,
    total: 20,
    active: {
      runtimeKey: "09延草纲目中医保健专营店__延草纲目宝元堂痛风医用远红外治疗凝胶水印18"
    }
  },
  imageProgress: {
    status: "ready",
    latestMessage: "Main images ready: 20 file(s)."
  }
});
assert.equal(hermesPublishStatusPayload.imageProgress, undefined);
assert.deepEqual(hermesPublishStatusPayload.hermesProgress, {
  source: "publish_active",
  message: "发布模块：图文信息（09延草纲目中医保健专营店）",
  timestamp: "2026-06-14T05:12:27.505Z"
});
assert.equal(
  JSON.stringify(hermesPublishStatusPayload).includes("Main images ready"),
  false,
  "Hermes-facing JSON must not expose completed image-generation progress during publish stage"
);
const hermesChineseFeedbackPayload = resolveAutoListingControllerHermesStatusPayload({
  status: "running",
  realtimeProgress: {
    source: "state",
    message: "Task chain completed.",
    timestamp: "2026-06-14T06:12:00.000Z",
    key: "state|Task chain completed."
  },
  feishuCurrentProduct: {
    current: 4,
    total: 4,
    userCognitionName: "喜维他B族"
  }
});
assert.equal(
  hermesChineseFeedbackPayload.hermesProgress?.message,
  "飞书当前第 4/4；任务链已完成",
  "Hermes progress message must translate terminal English progress into concise Chinese"
);
assert.equal(
  /[A-Za-z]{3,}/.test(String(hermesChineseFeedbackPayload.hermesProgress?.message || "")),
  false,
  "Hermes progress message must not expose English words to operators"
);
const groupedHermesRealtimeProgress = resolveAutoListingControllerRealtimeProgressSignal({
  jobStartedAt: "2026-06-14T06:00:00.000Z",
  activeRunId: "20260614-211821",
  status: "running",
  statusSource: "publish-manifest",
  publishSafelyPublished: 39,
  publishTotal: 40,
  publishFailed: 0,
  publishProductIndex: 20,
  publishProductTotal: 20,
  publishShopIndex: 10,
  publishShopTotal: 10,
  publishActiveRuntimeKey: "10延草纲目中医保健专营店__延草纲目宝元堂痛风医用远红外治疗凝胶水印20",
  publishActiveUpdatedAt: "2026-06-14T06:10:00.000Z",
  publishActiveMessage: "延草纲目宝元堂痛风医用远红外治疗凝胶水印20: graphic_info_fill: done",
  publishLogTimestamp: "2026-06-14T06:10:01.000Z",
  publishLogMessage: "发布模块：图文信息（10延草纲目中医保健专营店）"
});
assert.equal(
  /39\/40|40\/40|60\/60/.test(groupedHermesRealtimeProgress?.key || ""),
  false,
  "Hermes realtime key must not expose cumulative publish-manifest totals"
);
assert.match(
  groupedHermesRealtimeProgress?.key || "",
  /\|20\/20\|10\/10\|/,
  "Hermes realtime key must use the active product group and shop group progress"
);
const groupedHermesPayload = resolveAutoListingControllerHermesStatusPayload({
  status: "running",
  summary: "当前商品：延草纲目宝元堂痛风医用远红外治疗凝胶，发布已完成 20/20，店铺已完成 10/10",
  realtimeProgress: groupedHermesRealtimeProgress,
  feishuCurrentProduct: {
    current: 4,
    total: 7,
    recordId: "recv-grouped-current",
    userCognitionName: "宝元堂痛风凝胶"
  },
  feishuBatchDisplayCounts: {
    recordCount: 7,
    completedCount: 3,
    currentCount: 1,
    notStartedCount: 3
  },
  publishProgress: {
    safelyPublished: 39,
    total: 40,
    failed: 0,
    progressText: "当前商品：延草纲目宝元堂痛风医用远红外治疗凝胶，发布已完成 20/20，店铺已完成 10/10",
    publishGroupProgress: {
      productName: "延草纲目宝元堂痛风医用远红外治疗凝胶",
      productIndex: 20,
      productTotal: 20,
      shopName: "10延草纲目中医保健专营店",
      shopIndex: 10,
      shopTotal: 10,
      failed: 0
    }
  },
  imageProgress: {
    status: "ready",
    latestMessage: "Main images ready: 20 file(s)."
  }
});
assert.equal(
  /39\/40|40\/40|60\/60|Main images ready/.test(JSON.stringify(groupedHermesPayload.hermesProgress || {})),
  false,
  "Hermes progress payload must hide cumulative publish counts and stale image progress while publishing"
);
assert.equal(groupedHermesPayload.publishProgress, undefined);
assert.match(
  String(groupedHermesPayload.hermesProgress?.message || ""),
  /^飞书批次已完成 3\/7，当前第 4\/7；/,
  "Hermes progress must distinguish processed batch completion from the current Feishu record ordinal"
);
assert.match(
  String(groupedHermesPayload.hermesProgress?.message || ""),
  /当前商品：宝元堂痛风凝胶，发布已完成 20\/20，店铺已完成 10\/10/,
  "Hermes progress message must use the current product-group progress text"
);
const publishProgressOnlyHermesPayload = resolveAutoListingControllerHermesStatusPayload({
  status: "running",
  publishProgress: {
    progressText: "当前商品：延草纲目宝元堂腱鞘医用喷雾，发布已完成 16/20，当前目标 17/20，当前店铺 9/10，最近产物：publish-page-spec-editor.png",
    publishGroupProgress: {
      productName: "延草纲目宝元堂腱鞘医用喷雾",
      productIndex: 17,
      productTotal: 20,
      shopName: "09延草纲目中医保健专营店",
      shopIndex: 9,
      shopTotal: 10,
      failed: 0
    }
  },
  feishuCurrentProduct: {
    current: 6,
    total: 6,
    recordId: "recv-current-product",
    userCognitionName: "宝元堂腱鞘部位喷剂"
  }
});
assert.deepEqual(
  publishProgressOnlyHermesPayload.hermesProgress,
  {
    source: "publish_progress",
    message: "飞书当前第 6/6；当前商品：宝元堂腱鞘部位喷剂，发布已完成 16/20，当前目标 17/20，当前店铺 9/10，最近产物：规格编辑截图",
    key: "publish_progress|recv-current-product|延草纲目宝元堂腱鞘医用喷雾|17|20|9|10|0"
  },
  "Hermes payload must expose project-owned publish progress even when realtimeProgress is unavailable"
);
const dedupedHermesPayloadMessage = resolveAutoListingControllerHermesStatusPayload({
  status: "running",
  realtimeProgress: {
    source: "latest_artifact",
    message: "最近产物：publish-page-basic-filled.png",
    timestamp: "2026-06-14T06:10:02.000Z",
    key: "grouped-key"
  },
  publishProgress: {
    progressText: "当前商品：延草纲目测试品，发布已完成 10/20，当前目标 11/20，当前店铺 6/10，最近产物：publish-page-basic-filled.png"
  }
}).hermesProgress?.message;
assert.equal(
  dedupedHermesPayloadMessage,
  "当前商品：延草纲目测试品，发布已完成 10/20，当前目标 11/20，当前店铺 6/10，最近产物：基础信息截图",
  "Hermes progress message must not append the same realtime phrase twice"
);
const hermesIncompletePublishProgressPayload = resolveAutoListingControllerHermesStatusPayload({
  status: "running",
  realtimeProgress: {
    source: "latest_artifact",
    message: "最近产物：publish-page-basic-filled.png",
    timestamp: "2026-06-14T06:10:02.000Z",
    key: "artifact|publish-page-basic-filled.png"
  },
  publishProgress: {
    progressText: "发布进度 1/?，最近产物：publish-page-basic-filled.png"
  },
  feishuCurrentProduct: {
    current: 5,
    total: 6,
    userCognitionName: "李时珍痔疮凝胶"
  }
});
assert.equal(
  /\?/.test(JSON.stringify(hermesIncompletePublishProgressPayload.hermesProgress || {})),
  false,
  "Hermes progress payload must not expose '?' when publish group progress is incomplete"
);
assert.equal(
  hermesIncompletePublishProgressPayload.hermesProgress?.message,
  "飞书当前第 5/6；最近产物：基础信息截图",
  "Hermes progress payload must fall back to a concrete realtime message instead of incomplete publish totals"
);
const hermesStablePublishMessagePayload = resolveAutoListingControllerHermesStatusPayload({
  status: "running",
  realtimeProgress: {
    source: "latest_artifact",
    message: "最近产物：publish-page-basic-filled.png",
    timestamp: "2026-06-14T06:10:02.000Z",
    key: "artifact|publish-page-basic-filled.png|2026-06-14T06:10:02.000Z"
  },
  publishProgress: {
    progressText: "当前商品：延草纲目测试品，发布已完成 10/20，当前目标 11/20，当前店铺 6/10",
    publishGroupProgress: {
      productName: "延草纲目测试品",
      productIndex: 11,
      productTotal: 20,
      shopName: "06延草纲目理疗器械旗舰店",
      shopIndex: 6,
      shopTotal: 10,
      failed: 0
    }
  }
}).hermesProgress;
assert.equal(
  hermesStablePublishMessagePayload?.message,
  "当前商品：延草纲目测试品，发布已完成 10/20，当前目标 11/20，当前店铺 6/10",
  "Hermes publish-stage automatic feedback must use the stable current product progress message, not transient artifact text"
);
assert.equal(
  /publish-page-basic-filled|2026-06-14T06:10:02/.test(String(hermesStablePublishMessagePayload?.key || "")),
  false,
  "Hermes publish-stage automatic feedback key must not include transient artifact names or timestamps"
);
const hermesPublishOrdinalText = formatAutoListingControllerCompactStatusText({
  status: "running",
  productName: "延草纲目海斯莱福氨糖软骨素钙片",
  latestProgress: "最近产物：基础信息截图",
  publishSafelyPublished: 1,
  publishProductIndex: 2,
  publishProductTotal: 20,
  publishShopIndex: 1,
  publishShopTotal: 10,
  feishuProductIndex: 3,
  feishuCompleted: 1,
  feishuTotal: 6
});
assert.match(
  hermesPublishOrdinalText,
  /发布已完成 1\/20｜当前目标 2\/20｜当前店铺 1\/10｜飞书批次已完成 1\/6，当前第 3\/6/,
  "Hermes compact text must distinguish completed publish targets, current target/shop, batch completion, and current Feishu ordinal"
);
assert.doesNotMatch(
  hermesPublishOrdinalText,
  /产品 2\/20｜店铺 1\/10｜飞书产品 1\/6/,
  "Hermes compact text must not confuse publish target ordinal with Feishu product progress"
);
assert.equal(
  formatAutoListingControllerCompactStatusText({
    status: "failed",
    summary:
      "Publish failed for /Users/mfrank/MFrank55055/input/auto-listing/shops/16延草纲目特医食品专营店/商品-水印16: Main image upload did not reach 5 preview(s) after restart; confirmed=1, uploaded=1.",
    productName: "延草纲目金奥力牌苦瓜荞麦桑叶胶囊",
    publishSafelyPublished: 14,
    publishProductIndex: 16,
    publishProductTotal: 20,
    publishShopIndex: 13,
    publishShopTotal: 13,
    publishFailed: 2,
    publishFailedWatermarkNo: 16,
    feishuCompleted: 1,
    feishuTotal: 1
  }),
  "状态：失败｜发布已完成 14/20｜失败目标 16/20｜当前店铺 13/13｜飞书批次已完成 1/1\n商品：延草纲目金奥力牌苦瓜荞麦桑叶胶囊\n原因：主图上传失败：重试后仅确认 1/5 张。",
  "Hermes failure feedback must report canonical completed/current shop progress and the actionable cause without resume counts or local paths"
);
assert.equal(
  formatAutoListingControllerCompactStatusText({
    status: "running",
    productName: "延草纲目金奥力牌苦瓜荞麦桑叶胶囊",
    latestProgress:
      "Verifying existing uncertain final submit in Doudian 全部 tab: 商品-水印10 (10延草纲目营养膳食专卖店)",
    publishSafelyPublished: 14,
    publishProductIndex: 16,
    publishCurrentWatermarkNo: 10,
    publishProductTotal: 20,
    publishShopIndex: 13,
    publishShopTotal: 13,
    publishFailed: 2,
    feishuCompleted: 1,
    feishuTotal: 1
  }),
  "状态：运行中｜发布已完成 14/20｜当前目标 10/20｜当前店铺 13/13｜飞书批次已完成 1/1\n当前：延草纲目金奥力牌苦瓜荞麦桑叶胶囊\n进度：正在核验第10店是否已发布，确认不存在才会重提。",
  "Hermes running feedback must prefer the newest current action over stale failed manifest progress"
);
assert.equal(
  formatAutoListingControllerCompactStatusText({
    status: "failed",
    summary:
      "Publish failed for /shops/17店/商品-水印17: Sequential publish flow stopped: 图文信息模块未完成。Main image slots did not contain 5 images after upload; actual=0.",
    productName: "延草纲目金奥力牌苦瓜荞麦桑叶胶囊",
    publishSafelyPublished: 16,
    publishProductIndex: 17,
    publishProductTotal: 20,
    publishFailedWatermarkNo: 17
  }),
  "状态：失败｜发布已完成 16/20｜失败目标 17/20｜当前店铺 17/20｜飞书批次待确认\n商品：延草纲目金奥力牌苦瓜荞麦桑叶胶囊\n原因：主图上传失败：最终读回 0/5 张，已安全停止。",
  "Hermes must report a concise readback failure instead of a local product path"
);
assert.equal(
  resolveAutoListingControllerHermesStatusPayload({
    status: "running",
    realtimeProgress: {
      source: "latest_artifact",
      message: "最近产物：publish-page-images-uploaded.png",
      timestamp: "2026-06-14T06:10:02.000Z",
      key: "artifact|publish-page-images-uploaded.png"
    }
  }).hermesProgress?.message,
  "最近产物：图文上传截图",
  "Hermes artifact feedback must show a Chinese artifact label instead of an English filename"
);

const pageNotReadyClass = classifyPublishFailure("Platform SPU query page was not ready after navigation.");
assert.equal(pageNotReadyClass, "platform_page_not_ready");
assert.equal(shouldRetryPublishFailure(pageNotReadyClass, 0), true);
assert.equal(shouldRetryPublishFailure(pageNotReadyClass, 3), true);
assert.equal(shouldRetryPublishFailure(pageNotReadyClass, 4), false);
assert.equal(shouldRetryPublishFailure("validation_blocked", 0), false);
const guideOverlayClass = classifyPublishFailure(
  "Sequential publish flow stopped: 价格库存模块未完成。locator.click: <div class=\"ecom-guide-single-content-wrapper\"> intercepts pointer events"
);
assert.equal(guideOverlayClass, "transient_overlay_blocked");
assert.equal(shouldRetryPublishFailure(guideOverlayClass, 0), true);
assert.equal(
  shouldStopPublishBatchAfterFailure([{ stage: "published", errorClass: guideOverlayClass }]),
  true,
  "a guide overlay that survives the in-target recovery budget must stop later targets instead of repeating the same systemic failure"
);
const freightDropdownClass = classifyPublishFailure(
  "No visible freight template option matched keyword: 延草运费; visibleOptions=商品类目 > 标题推荐 > 必填项进度"
);
assert.equal(freightDropdownClass, "service_section_not_ready");
assert.equal(shouldRetryPublishFailure(freightDropdownClass, 0), true);
const basicFieldLocatorClass = classifyPublishFailure(
  "Sequential publish flow stopped: 基础信息模块未完成。Short title input not found on publish page."
);
assert.equal(basicFieldLocatorClass, "basic_info_field_not_ready");
assert.equal(
  classifyPublishFailure("Doudian 只看必填 switch click did not read back aria-checked=false."),
  "basic_info_field_not_ready",
  "只看必填 switch failures must remain recoverable basic-info failures"
);
assert.equal(
  shouldRetryPublishFailure(basicFieldLocatorClass, 0),
  true,
  "basic-info field readiness failures are transient publish-page failures and must retry with a fresh SPU-prefilled page"
);
const detailQualificationClass = classifyPublishFailure(
  "Sequential publish flow stopped: 图文信息模块未完成。Qualification detail upload was not acknowledged per file. expected=2; acknowledged=0; baseline=6; final=6"
);
assert.equal(
  classifyPublishFailure(
    "Sequential publish flow stopped: 图文信息模块未完成。Main images must already satisfy 1:1 ratio before upload. Invalid files: generated.png(1199x1312)"
  ),
  "main_image_shape_invalid"
);
assert.equal(detailQualificationClass, "detail_qualification_not_ready");
assert.equal(
  shouldStopPublishBatchAfterFailure([{ safelyPublished: false, errorClass: detailQualificationClass }]),
  true,
  "a deterministic detail qualification failure must stop the remaining product folders after the first failure"
);
const forbiddenOptionalGraphicClass = classifyPublishFailure(
  "Sequential publish flow stopped: 图文信息模块未完成。Forbidden optional graphic sections still contain images: 白底图"
);
assert.notEqual(
  forbiddenOptionalGraphicClass,
  "forbidden_optional_graphic_not_cleared",
  "white-background auto-fill is outside the project publish flow and must not have a dedicated blocking class"
);
assert.equal(
  shouldStopPublishBatchAfterFailure([{ safelyPublished: false, errorClass: forbiddenOptionalGraphicClass }]),
  false,
  "legacy white-background residue messages must not become a single-failure batch stop"
);
const disappearedBasicFieldsClass = classifyPublishFailure(
  "All expected basic-info fields disappeared from the publish page."
);
assert.equal(disappearedBasicFieldsClass, "platform_page_not_ready");
assert.equal(shouldRetryPublishFailure(disappearedBasicFieldsClass, 0), true);
const specTemplateMissingClass = classifyPublishFailure(
  "Sequential publish flow stopped: 价格库存模块未完成。Spec template selection did not match required keyword. expectedKeyword=买二送一; selectedTemplate=<empty>; keyword=买二送一"
);
assert.equal(specTemplateMissingClass, "spec_template_not_ready");
assert.equal(
  classifyPublishFailure(
    "Sequential publish flow stopped: 价格库存模块未完成。No visible spec template dropdown option matched controlled aliases: 买二送一/买2送1/2送1; keyword=买二送一"
  ),
  "spec_template_not_ready",
  "Exhausting controlled semantic aliases must remain a bounded pre-submit template readiness failure"
);
const missingShopSpecTemplateClass = classifyPublishFailure(
  "Spec template is not configured for current shop: 商品规格 surface only exposes 添加规格类型（0/3） and 规格预览."
);
assert.equal(missingShopSpecTemplateClass, "spec_template_configuration_missing");
assert.equal(
  classifyPublishFailure(
    "Sequential publish flow stopped: 价格库存模块未完成。Spec template field root was not found in 商品规格/规格模板 DOM structure.; keyword=买二送一"
  ),
  "spec_template_surface_missing",
  "the production missing-template DOM failure must restart from the SPU query instead of falling through to unknown_publish_failure"
);
assert.equal(shouldRetryPublishFailure("spec_template_surface_missing", 0), true);
assert.equal(shouldRetryPublishFailure("spec_template_surface_missing", 2), true);
assert.equal(shouldRetryPublishFailure("spec_template_surface_missing", 3), false);
assert.equal(shouldRetryPublishFailure(missingShopSpecTemplateClass, 0), false);
assert.equal(
  shouldStopPublishBatchAfterFailure([
    {
      safelyPublished: false,
      finalVerifyStatus: "not_checked",
      errorClass: missingShopSpecTemplateClass,
      issue: "店铺规格模板未配置"
    }
  ]),
  true,
  "A shop missing its configured spec template must stop the listing batch for user remediation, not skip the shop"
);
assert.equal(
  shouldRetryPublishFailure(specTemplateMissingClass, 0),
  false,
  "spec-template readiness failures must stay on the current publish page and must not trigger a whole-flow page reload"
);
const specTemplateSearchInputMissingClass = classifyPublishFailure(
  "Sequential publish flow stopped: 价格库存模块未完成。Spec template search input was not found in 商品规格/规格模板 section.; keyword=久光小泽"
);
assert.equal(
  specTemplateSearchInputMissingClass,
  "spec_template_not_ready",
  "the real 商品规格/规格模板 control-discovery failure must not be classified as unknown"
);
const specTemplateBlankValueClass = classifyPublishFailure(
  "Sequential publish flow stopped: 价格库存模块未完成。Spec template left 1 blank required spec value input(s).; keyword=久光小泽"
);
assert.equal(
  specTemplateBlankValueClass,
  "spec_template_not_ready",
  "blank spec-value inputs after template application must be retried as spec-template readiness failures"
);
assert.equal(
  shouldRetryPublishFailure(specTemplateBlankValueClass, 2),
  false,
  "spec-template readiness failures must not replay basic info after the template module has been reached"
);
assert.equal(
  shouldRetryPublishFailure(specTemplateBlankValueClass, 3),
  false,
  "spec-template readiness failures must remain non-retryable at the publish-flow level"
);
assert.equal(
  shouldStopPublishBatchAfterFailure([
    { safelyPublished: false, errorClass: "spec_template_not_ready" },
    { safelyPublished: false, errorClass: "spec_template_not_ready" }
  ]),
  true,
  "systemic spec-template control failures must stop the remaining shop batch instead of producing continuous failures"
);
const priceInventoryVerificationClass = classifyPublishFailure(
  "Sequential publish flow stopped: 价格库存模块未完成。Price/inventory verification failed: row 1 expected price=129, stock=2000; actual price=<empty>, stock=0 | row 2 expected price=99, stock=2000; actual price=<empty>, stock=0"
);
assert.equal(
  priceInventoryVerificationClass,
  "price_inventory_not_ready",
  "price/inventory readback failures must be classified separately from unknown publish failures"
);
assert.equal(
  shouldRetryPublishFailure(priceInventoryVerificationClass, 0),
  true,
  "explicit pre-submit price/inventory failures must get a bounded whole-flow retry"
);
assert.equal(
  shouldRetryPublishFailure(priceInventoryVerificationClass, 2),
  true,
  "explicit pre-submit price/inventory failures must retry three times before stopping"
);
assert.equal(
  shouldRetryPublishFailure(priceInventoryVerificationClass, 3),
  false,
  "explicit pre-submit price/inventory failures must stop after three retries"
);
assert.equal(
  shouldStopPublishBatchAfterFailure([
    { safelyPublished: false, errorClass: "price_inventory_not_ready" }
  ]),
  true,
  "an explicit price/inventory failure that exhausts retries must stop the publish batch instead of skipping to later watermarks"
);
assert.equal(
  shouldStopPublishBatchAfterFailure([
    { safelyPublished: false, errorClass: "doudian_login_required" }
  ]),
  true,
  "login expiry during publishing must stop the remaining shop batch instead of marking later watermarks failed"
);
assert.equal(
  shouldStopPublishBatchAfterFailure([
    { safelyPublished: false, errorClass: "shop_context_mismatch" }
  ]),
  true,
  "shop context mismatch must stop the remaining shop batch so recovery resumes from the first unsafe item"
);
assert.equal(
  shouldStopPublishBatchAfterFailure([
    { safelyPublished: true, errorClass: "" },
    { safelyPublished: false, errorClass: "platform_page_not_ready" }
  ]),
  false,
  "single transient page readiness failures should keep the existing bounded per-item retry behavior"
);

const finalSubmitTransientClass = classifyPublishFailure(
  "Sequential publish flow stopped: 最终发布动作未完成。系统将自动唤起图片编辑工具正反示例商品完整边缘清晰正面主题适当不完整不清晰非正面主体过小"
);
assert.equal(
  classifyPublishFailure("规格值名称中不能出现Emoji等特殊符号：❤"),
  "validation_blocked",
  "platform Emoji rejection must be classified as a deterministic validation failure"
);
assert.equal(finalSubmitTransientClass, "final_publish_state_uncertain");
assert.equal(
  shouldRetryPublishFailure(finalSubmitTransientClass, 0),
  false,
  "final publish uncertainty is past the non-idempotent submit boundary and must not re-run the whole product"
);

const finalSubmitPageContextLostClass = classifyPublishFailure(
  "Sequential publish flow stopped: 最终发布动作未完成。Publish product button click failed: Publish create page context was lost and no usable replacement page is available."
);
assert.equal(finalSubmitPageContextLostClass, "final_publish_state_uncertain");
assert.equal(
  shouldRetryPublishFailure(finalSubmitPageContextLostClass, 0),
  false,
  "page loss after entering final submit must be verified or marked uncertain, never blindly re-submitted"
);
const finalSubmitAcceptedDecision = evaluatePublishResult({
  ok: false,
  status: "failed",
  publishClickAttempted: true,
  publishClicked: false,
  publishIssue: "Publish product button was clicked, but no submission success signal was detected."
});
assert.deepEqual(
  finalSubmitAcceptedDecision,
  {
    safelyPublished: false,
    finalVerifyStatus: "submit_accepted_unconfirmed",
    errorClass: "final_publish_state_uncertain",
    issue: "Publish product button was clicked, but no submission success signal was detected."
  },
  "after the final publish click is issued without a platform success signal, recovery must not blindly submit again"
);
assert.deepEqual(
  evaluatePublishResult({
    ok: true,
    status: "published",
    publishClickAttempted: true,
    publishClicked: false,
    publishIssue: "No publish success signal was detected after clicking 发布商品.",
    message: "Publish button click was issued; platform success signal was not observed."
  }),
  {
    safelyPublished: false,
    finalVerifyStatus: "submit_accepted_unconfirmed",
    errorClass: "final_publish_state_uncertain",
    issue: "No publish success signal was detected after clicking 发布商品."
  },
  "the browser-side no-success-signal issue must trigger Doudian 全部 tab full-title verification instead of manual review"
);
assert.deepEqual(
  evaluatePublishResult({
    ok: true,
    status: "published",
    publishClickAttempted: true,
    publishClicked: false,
    publishIssue: "详看链接去查看1.操作ID:2026070518112889F05C47D0559EC9EC8D2.校验发货模式失败 | 需在“已下架”操作上架",
    message: "Publish button click was issued; platform success signal was not observed."
  }),
  {
    safelyPublished: false,
    finalVerifyStatus: "submit_rejected_confirmed",
    errorClass: "shipping_mode_rejected",
    issue: "详看链接去查看1.操作ID:2026070518112889F05C47D0559EC9EC8D2.校验发货模式失败 | 需在“已下架”操作上架"
  },
  "an explicit shipping-mode rejection must require a negative read-only list check before a controlled retry"
);
assert.equal(
  shouldRetryPublishFailure("shipping_mode_rejected", 0),
  false,
  "shipping-mode rejection must never enter the generic retry loop before read-only product-list verification"
);
const platformSystemExceptionIssue = "1. 操作ID:2026080611514994A2BEE931106AF92453 2. 系统异常,请重试 | 需在已下架操作上架 | 必填项进度100%";
assert.deepEqual(
  evaluatePublishSubmission({
    url: "https://fxg.jinritemai.com/ffa/g/create?spu_id=1",
    bodyText: "必填项进度 100%\n系统异常，请重试\n操作ID：2026080611514994A2BEE931106AF92453"
  }),
  {
    submitted: false,
    issue: "系统异常，请重试（操作ID：2026080611514994A2BEE931106AF92453）",
    freshCreatePage: false
  },
  "short-lived system rejection must outrank static required-field text and retain its operation ID"
);
assert.equal(
  classifyPublishFailure(platformSystemExceptionIssue),
  "final_publish_submit_transient",
  "an explicit platform system exception must outrank unrelated required-field text from the full publish page"
);
assert.deepEqual(
  evaluatePublishResult({
    ok: true,
    status: "published",
    publishClickAttempted: true,
    publishClicked: false,
    publishIssue: platformSystemExceptionIssue,
    message: "Publish button click was issued; platform success signal was not observed."
  }),
  {
    safelyPublished: false,
    finalVerifyStatus: "submit_rejected_confirmed",
    errorClass: "final_publish_submit_transient",
    issue: platformSystemExceptionIssue
  },
  "an explicit post-click platform system rejection must require a negative list check before one controlled retry"
);
assert.equal(
  shouldRetryPublishFailure("final_publish_submit_transient", 0),
  false,
  "a post-click platform system rejection must never enter the generic retry loop before read-only product-list verification"
);
assert.deepEqual(
  evaluatePublishResult({
    ok: true,
    status: "published",
    publishClickAttempted: true,
    publishClicked: false,
    message: "Publish button click was issued; platform success signal was not observed."
  }),
  {
    safelyPublished: false,
    finalVerifyStatus: "submit_accepted_unconfirmed",
    errorClass: "final_publish_state_uncertain",
    issue: "Publish button click was issued; platform success signal was not observed."
  },
  "a persisted published result without a platform success signal must remain non-safe for resume planning"
);
assert.deepEqual(
  evaluatePublishResult({
    ok: true,
    status: "published",
    message: "Publish button click was issued; platform success signal was not observed."
  }),
  {
    safelyPublished: false,
    finalVerifyStatus: "submit_accepted_unconfirmed",
    errorClass: "final_publish_state_uncertain",
    issue: "Publish button click was issued; platform success signal was not observed."
  },
  "a legacy result that only persisted the uncertain final-submit message must still open the final-publish circuit"
);

const navigationContextLostClass = classifyPublishFailure(
  "page.evaluate: Execution context was destroyed, most likely because of a navigation"
);
assert.equal(navigationContextLostClass, "page_context_lost");
assert.equal(shouldRetryPublishFailure(navigationContextLostClass, 0), true);

const uncertainPublishRuntime = fs.mkdtempSync(path.join(os.tmpdir(), "uncertain-publish-"));
const uncertainShop = path.join(uncertainPublishRuntime, "01延草纲目大药房专营店");
const uncertainProduct = path.join(uncertainShop, "延草纲目医用重组胶原蛋白护理软膏水印02");
fs.mkdirSync(uncertainProduct, { recursive: true });
const uncertainRuntimeKey = "01延草纲目大药房专营店__延草纲目医用重组胶原蛋白护理软膏水印02";
const uncertainResultDir = path.join(uncertainPublishRuntime, "publish", uncertainRuntimeKey);
fs.mkdirSync(uncertainResultDir, { recursive: true });
const uncertainResultFile = path.join(uncertainResultDir, "result.json");
fs.writeFileSync(
  uncertainResultFile,
  JSON.stringify(
    {
      ok: false,
      status: "failed",
      message:
        "Sequential publish flow stopped: 最终发布动作未完成。Publish product button click failed: Publish create page context was lost and no usable replacement page is available."
    },
    null,
    2
  )
);
const uncertainPublishResult = await publishDistributedProducts({
  runtimeDir: uncertainPublishRuntime,
  distributedFolders: [uncertainProduct],
  productIdentity: {
    batchFingerprint: "batch-uncertain",
    taskId: "image-001",
    recordId: "record-uncertain",
    sourceImagePath: "/tmp/source.png",
    userCognitionName: "护理软膏",
    genericName: "医用重组胶原蛋白护理软膏"
  },
  feishuProductRecord: {
    recordId: "record-uncertain",
    userCognitionName: "护理软膏",
    genericName: "医用重组胶原蛋白护理软膏",
    brand: "延草纲目",
    spu: "械注准20240001",
    sellingPointText: "卖点",
    deepseekPromptText: "提示词",
    mainImageInstructionText: "主图",
    positivePromptText: "正向",
    negativePromptText: "反向",
    titleKeywordText: "标题",
    titleSuffixText: "旗舰店",
    productPriceText: "39,29,19,9",
    shortTitle: "护理软膏",
    productCategory: "医疗器械",
    qualificationImages: [],
    whiteBackgroundImages: [],
    manufacturerName: "",
    manufacturerAddress: "",
    netContent: "",
    productStandardCode: "",
    ingredients: "",
    healthFunction: "",
    specification: "",
    rawFields: {}
  },
  simulateOnly: true
});
assert.equal(
  uncertainPublishResult.results[0].status,
  "simulated_with_preflight_warnings",
  "existing uncertain final-submit results must be scheduled for publish again instead of being treated as a safe checkpoint"
);

assert.deepEqual(
  evaluateDetailImageCompletion({
    filledFromMain: true,
    baselineDetailCount: 5,
    qualificationImageCount: 4,
    acknowledgedQualificationCount: 4,
    finalDetailCount: 9,
    expectedDetailCount: 9
  }),
  { passed: true, issue: "" }
);
assert.equal(isUploadPlaceholderGraphicContext("白底图 + 上传白底图"), true);
assert.equal(isUploadPlaceholderGraphicContext("主图3:4 + 上传辅助图"), true);
assert.equal(isUploadPlaceholderGraphicContext("白底图 删除 预览图片"), false);
const duplicateDetailCheck = evaluateDetailImageCompletion({
  filledFromMain: true,
  baselineDetailCount: 5,
  qualificationImageCount: 4,
  acknowledgedQualificationCount: 4,
  finalDetailCount: 13,
  expectedDetailCount: 9
});
assert.equal(duplicateDetailCheck.passed, false);
assert.match(duplicateDetailCheck.issue, /exceeded expected count/);

const spuPrefillFailedClass = classifyPublishFailure(
  "Publish create page did not become ready after network/page-content recovery. sections=0; textLength=67; loading=false; body=spu信息填充失败"
);
assert.equal(spuPrefillFailedClass, "platform_spu_prefill_failed");
assert.equal(
  classifyPublishFailure("Publish create page reported SPU prefill failure."),
  "platform_spu_prefill_failed",
  "the direct prefill failure raised by readiness inspection must keep the safe retry class"
);
assert.equal(shouldRetryPublishFailure(spuPrefillFailedClass, 0), true);
const emptyPublishSectionsAfterSpuClass = classifyPublishFailure(
  "Publish create page has no publish sections after SPU query."
);
assert.equal(
  emptyPublishSectionsAfterSpuClass,
  "platform_spu_prefill_failed",
  "A create page with no publish sections after SPU query is a transient platform prefill failure"
);
assert.equal(
  shouldRetryPublishFailure(emptyPublishSectionsAfterSpuClass, 0),
  true,
  "A create page with no publish sections after SPU query must be retried"
);
assert.equal(
  shouldRetryPublishFailure(emptyPublishSectionsAfterSpuClass, 3),
  true,
  "SPU prefill empty-page failures need the same extended retry budget as platform readiness failures"
);
assert.equal(
  shouldRetryPublishFailure(emptyPublishSectionsAfterSpuClass, 4),
  false,
  "SPU prefill empty-page failures must still stop after the extended retry budget is exhausted"
);

const delayedHealthFunctionOptionClass = classifyPublishFailure(
  "Health-food 保健功能 checkbox option not found: 补充维生素E"
);
assert.equal(
  delayedHealthFunctionOptionClass,
  "health_food_category_attributes_not_ready",
  "A missing asynchronously rendered health-function option must be classified as a category-attribute readiness failure"
);
assert.equal(
  shouldRetryPublishFailure(delayedHealthFunctionOptionClass, 0),
  true,
  "A pre-submit health-function readiness failure must receive the bounded safe retry budget"
);
assert.equal(
  shouldRetryPublishFailure(delayedHealthFunctionOptionClass, 2),
  false,
  "A genuinely invalid health-function option must still stop after the bounded retry budget"
);

assert.deepEqual(
  evaluatePublishCreatePageReadiness({
    usable: false,
    bodyTextLength: 67,
    sectionCount: 0,
    loading: false,
    loginRequired: false,
    bodyText: "商品发布 spu信息填充失败"
  }),
  {
    action: "reopen_from_platform_spu",
    issue: "Publish create page reported SPU prefill failure."
  }
);

const shopSwitchMissingClass = classifyPublishFailure("Shop switch failed: could not find 切换组织/店铺 for 延草纲目康复理疗专营店");
assert.equal(shopSwitchMissingClass, "shop_switch_entry_unavailable");
assert.equal(shouldRetryPublishFailure(shopSwitchMissingClass, 0), true);

const remoteDebuggingUnavailableClass = classifyPublishFailure("Remote debugging browser did not become ready in time.");
assert.equal(remoteDebuggingUnavailableClass, "browser_remote_debugging_unavailable");
assert.equal(shouldRetryPublishFailure(remoteDebuggingUnavailableClass, 0), true);

const cdpContextManagementClass = classifyPublishFailure(
  "browserType.connectOverCDP: Protocol error (Browser.setDownloadBehavior): Browser context management is not supported."
);
assert.equal(cdpContextManagementClass, "browser_remote_debugging_unavailable");
assert.equal(shouldRetryPublishFailure(cdpContextManagementClass, 0), true);
assert.equal(
  resolvePaidImageChildStallTimeoutMs({
    defaultTimeoutMs: 12 * 60 * 1000,
    activeStep: "published",
    activeMessage: "Retrying publish for 延草纲目医用面部冷敷贴水印03 (02延草纲目药品专营店): page_context_lost; attempt 1"
  }),
  12 * 60 * 1000,
  "Non-image steps must retain the configured supervisor stall timeout"
);
assert.equal(
  resolvePaidImageChildStallTimeoutMs({
    defaultTimeoutMs: 12 * 60 * 1000,
    activeStep: "main_images_generated",
    activeMessage: "Prompt 4/5: Image 2: transient transport error during initial; retry 6/8."
  }),
  12 * 60 * 1000
);
assert.equal(
  resolvePaidImageChildStallTimeoutMs({
    defaultTimeoutMs: 12 * 60 * 1000,
    activeStep: "main_images_generated",
    activeMessage: "Prompt 5/5: Image 4: videos-base64 task task_queued status queued 0."
  }),
  30 * 60 * 1000,
  "The supervisor must let an accepted queued task reach its fixed thirty-minute observation ceiling"
);
assert.equal(
  resolvePaidImageChildStallTimeoutMs({
    defaultTimeoutMs: 12 * 60 * 1000,
    activeStep: "main_images_generated",
    activeMessage: "Prompt 5/5: Image 4: videos-base64 task task_pending status pending 0."
  }),
  30 * 60 * 1000,
  "The supervisor must let an accepted pending task reach its fixed thirty-minute observation ceiling"
);
assert.equal(
  typeof resolvePaidImageChildWatchdogDecision,
  "function",
  "Accepted-task watchdog timing must be exposed as a pure state transition"
);
const firstAcceptedTaskWatchdog = resolvePaidImageChildWatchdogDecision({
  defaultTimeoutMs: 12 * 60 * 1000,
  lastProgressSeenAtMs: 0,
  nowMs: 20 * 60 * 1000,
  activeStep: "main_images_generated",
  activeMessage: "Prompt 5/5: Image 4: videos-base64 task task_first status queued 0."
});
assert.equal(firstAcceptedTaskWatchdog.shouldTerminate, false);
assert.equal(firstAcceptedTaskWatchdog.stallBaselineMs, 20 * 60 * 1000);
assert.deepEqual(firstAcceptedTaskWatchdog.acceptedTaskObservation, {
  taskKey: "task_first",
  startedAtMs: 20 * 60 * 1000
});
const sameAcceptedTaskWatchdog = resolvePaidImageChildWatchdogDecision({
  defaultTimeoutMs: 12 * 60 * 1000,
  lastProgressSeenAtMs: 0,
  nowMs: 49 * 60 * 1000,
  activeStep: "main_images_generated",
  activeMessage: "Prompt 5/5: Image 4: videos-base64 task task_first status pending 0.",
  acceptedTaskObservation: firstAcceptedTaskWatchdog.acceptedTaskObservation
});
assert.equal(sameAcceptedTaskWatchdog.shouldTerminate, false);
assert.equal(sameAcceptedTaskWatchdog.stallBaselineMs, 20 * 60 * 1000);
const changedAcceptedTaskWatchdog = resolvePaidImageChildWatchdogDecision({
  defaultTimeoutMs: 12 * 60 * 1000,
  lastProgressSeenAtMs: 0,
  nowMs: 50 * 60 * 1000,
  activeStep: "main_images_generated",
  activeMessage: "Prompt 5/5: Image 4: videos-base64 task task_second status queued 0.",
  acceptedTaskObservation: sameAcceptedTaskWatchdog.acceptedTaskObservation
});
assert.equal(changedAcceptedTaskWatchdog.shouldTerminate, false);
assert.deepEqual(changedAcceptedTaskWatchdog.acceptedTaskObservation, {
  taskKey: "task_second",
  startedAtMs: 50 * 60 * 1000
});
const decimalProgressWatchdog = resolvePaidImageChildWatchdogDecision({
  defaultTimeoutMs: 12 * 60 * 1000,
  lastProgressSeenAtMs: 0,
  nowMs: 20 * 60 * 1000,
  activeStep: "main_images_generated",
  activeMessage: "Prompt 5/5: Image 4: videos-base64 task task_decimal status queued 0.5.",
  acceptedTaskObservation: changedAcceptedTaskWatchdog.acceptedTaskObservation
});
assert.equal(decimalProgressWatchdog.effectiveStallTimeoutMs, 12 * 60 * 1000);
assert.equal(decimalProgressWatchdog.acceptedTaskObservation, undefined);
assert.equal(decimalProgressWatchdog.shouldTerminate, true);

const alreadyInTargetShop = evaluateShopSwitchMenuState({
  expectedShopName: "延草纲目康复理疗专营店",
  currentShopName: "延草纲目康复理疗专营店",
  menuOpened: true,
  switchEntryVisible: false
});

assert.deepEqual(alreadyInTargetShop, {
  action: "already_in_target_shop",
  issue: ""
});

const switchEntryUnavailable = evaluateShopSwitchMenuState({
  expectedShopName: "延草纲目康复理疗专营店",
  currentShopName: "延草纲目个护保健专营店",
  menuOpened: true,
  switchEntryVisible: false
});

assert.deepEqual(switchEntryUnavailable, {
  action: "retry_menu",
  issue: "Shop switch entry is unavailable while current shop does not match target."
});

assert.deepEqual(
  evaluateShopTargetSelectionState({
    selectionReported: false,
    chooserVisibleAfterSelection: false
  }),
  {
    action: "retry_transient_page",
    issue: "Shop chooser disappeared before target selection could be verified."
  },
  "a vanished chooser plus a loading shell must retry instead of reporting the canonical shop missing"
);
assert.deepEqual(
  evaluateShopTargetSelectionState({
    selectionReported: false,
    chooserVisibleAfterSelection: true
  }),
  {
    action: "fail_target_missing",
    issue: "Target shop is absent from the stable shop chooser."
  },
  "a stable chooser that truly lacks the target must still fail closed"
);

const cleanupTargets = selectCleanupTargets({
  candidates: [
    "/work/input/auto-listing/feishu-images/product-1.png",
    "/work/input/auto-listing/feishu-images/product-2.png",
    "/work/input/auto-listing/qualifications/product-1-cert.png",
    "/work/input/auto-listing/qualifications/product-2-cert.png"
  ],
  protectedPaths: [
    "/work/input/auto-listing/feishu-images/product-2.png",
    "/work/input/auto-listing/qualifications/product-2-cert.png"
  ]
});

assert.deepEqual(cleanupTargets.sort(), [
  "/work/input/auto-listing/feishu-images/product-1.png",
  "/work/input/auto-listing/qualifications/product-1-cert.png"
]);

assert.equal(
  auditCompletedBatchResidue({
    batchComplete: true,
    runDirCount: 3,
    paidLedgerBatchExists: true
  }).ok,
  false,
  "A completed batch with historical runs or a shared paid ledger must fail the project audit"
);
assert.equal(
  auditCompletedBatchResidue({
    batchComplete: false,
    runDirCount: 3,
    paidLedgerBatchExists: true
  }).ok,
  true,
  "Incomplete batches may retain recovery runs and paid ledgers"
);
assert.equal(
  auditCompletedBatchResidue({
    batchComplete: true,
    runDirCount: 1,
    paidLedgerBatchExists: false
  }).ok,
  true,
  "A completed batch may retain only its latest status run and no paid ledger"
);

assert.deepEqual(
  selectStaleRunHistoryTargets({
    runDirs: [
      "/work/data/auto-listing/runs/20260609-195920",
      "/work/data/auto-listing/runs/20260609-203518",
      "/work/data/auto-listing/runs/not-a-run",
      "/work/data/auto-listing/runs/control"
    ],
    activeRunDir: "/work/data/auto-listing/runs/20260609-203518"
  }),
  ["/work/data/auto-listing/runs/20260609-195920"]
);
assert.deepEqual(
  selectStaleRunHistoryTargets({
    runDirs: [
      "/work/data/auto-listing/runs/20260610-232736",
      "/work/data/auto-listing/runs/20260611-032939"
    ],
    activeRunDir: "/work/data/auto-listing/runs/20260611-032939",
    protectedRunDirs: ["/work/data/auto-listing/runs/20260610-232736"]
  }),
  [],
  "pre-run cleanup must preserve failed paid-image run dirs that can contain reusable raw main images"
);

const cleanupRunRoot = path.join(tempDir, "runs");
const oldRunDir = path.join(cleanupRunRoot, "20260609-195920");
const activeRunDir = path.join(cleanupRunRoot, "20260609-203518");
const nonRunDir = path.join(cleanupRunRoot, "control");
const protectedPaidImageRunDir = path.join(cleanupRunRoot, "20260610-232736");
const nestedPaidImageRunDir = path.join(cleanupRunRoot, "20260610-233000");
const submittedLedgerRunDir = path.join(cleanupRunRoot, "20260610-233500");
fs.mkdirSync(oldRunDir, { recursive: true });
fs.mkdirSync(activeRunDir, { recursive: true });
fs.mkdirSync(nonRunDir, { recursive: true });
fs.mkdirSync(protectedPaidImageRunDir, { recursive: true });
fs.mkdirSync(path.join(nestedPaidImageRunDir, "tasks/image-001/main-image-01/openai-compatible/raw"), { recursive: true });
fs.mkdirSync(path.join(submittedLedgerRunDir, "tasks/image-001/paid-image-ledger/batch/record/slots"), { recursive: true });
fs.writeFileSync(path.join(oldRunDir, "state.json"), "{}\n");
fs.writeFileSync(path.join(activeRunDir, "state.json"), "{}\n");
fs.writeFileSync(path.join(protectedPaidImageRunDir, "state.json"), "{}\n");
fs.writeFileSync(
  path.join(submittedLedgerRunDir, "tasks/image-001/paid-image-ledger/batch/record/slots/01.json"),
  JSON.stringify({ version: 1, slot: 1, state: "submitted", providerTaskId: "paid-task-1" }) + "\n"
);
fs.writeFileSync(
  path.join(nestedPaidImageRunDir, "tasks/image-001/main-image-01/openai-compatible/raw/generated-01.png"),
  "paid raw image\n"
);
const staleRunCleanup = cleanupStaleRunHistory({
  runtimeRootDir: cleanupRunRoot,
  activeRuntimeDir: activeRunDir,
  protectedRunDirs: [protectedPaidImageRunDir],
  cleanupAfterPublish: true,
  simulateOnly: false
});
assert.deepEqual(staleRunCleanup.removedPaths, [oldRunDir, nestedPaidImageRunDir, submittedLedgerRunDir]);
assert.equal(fs.existsSync(oldRunDir), false);
assert.equal(fs.existsSync(activeRunDir), true);
assert.equal(fs.existsSync(nonRunDir), true);
assert.equal(fs.existsSync(protectedPaidImageRunDir), true);
assert.equal(
  fs.existsSync(nestedPaidImageRunDir),
  false,
  "full-flow stale run cleanup must not permanently preserve an unrelated historical run merely because it contains raw images"
);
assert.equal(
  fs.existsSync(submittedLedgerRunDir),
  false,
  "project-level shared ledgers must own paid-task recovery; historical runtime ledgers must not permanently block run cleanup"
);
const reusableArtifactRuntimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "reusable-artifacts-"));
fs.mkdirSync(path.join(reusableArtifactRuntimeDir, "tasks/image-001/paid-image-ledger/batch/record/slots"), { recursive: true });
fs.mkdirSync(path.join(reusableArtifactRuntimeDir, "tasks/image-001/main-image-01/openai-compatible/raw"), { recursive: true });
fs.writeFileSync(
  path.join(reusableArtifactRuntimeDir, "tasks/image-001/paid-image-ledger/batch/record/slots/01.json"),
  JSON.stringify({ version: 1, slot: 1, state: "submitted", providerTaskId: "paid-task-1" }) + "\n"
);
fs.writeFileSync(
  path.join(reusableArtifactRuntimeDir, "tasks/image-001/paid-image-ledger/batch/record/slots/02.json"),
  JSON.stringify({ version: 1, slot: 2, state: "reserved" }) + "\n"
);
fs.writeFileSync(
  path.join(reusableArtifactRuntimeDir, "tasks/image-001/main-image-01/openai-compatible/raw/generated-01.png"),
  "raw image\n"
);
assert.deepEqual(
  summarizeReusableTaskArtifacts({ runtimeDir: reusableArtifactRuntimeDir, taskId: "image-001" }),
  {
    reusableRawImageCount: 1,
    reusablePaidImageTaskCount: 1,
    reusableArtifactCount: 1
  },
  "Autolist project logic must count reusable raw and paid ledger assets; reserved slots are not proof of billing"
);

const sameSpuFolderMatch = resolveFeishuAssetRecordForFolder({
  folderSearchParts: [
    "延草纲目舒奈美医用医用重组Ⅲ型人源化胶原蛋白软膏水印01",
    "医用修复乳液标题0120260524-144025.xlsx",
    "湘械注准20222141001-医用修复乳液-资质图片-01.png"
  ],
  records: [
    {
      recordId: "rec-lotion",
      spu: "湘械注准20222141001",
      brand: "舒奈美",
      userCognitionName: "医用修复乳液",
      genericName: "舒奈美医用医用重组Ⅲ型人源化胶原蛋白软膏",
      shortTitle: "SNM胶原蛋白乳液",
      whiteBackgroundImages: [{ name: "湘械注准20222141001-医用修复乳液-白底图-01.png" }],
      qualificationImages: [{ name: "湘械注准20222141001-医用修复乳液-资质图片-01.png" }]
    },
    {
      recordId: "rec-cream",
      spu: "湘械注准20222141001",
      brand: "舒奈美",
      userCognitionName: "医用修复霜",
      genericName: "舒奈美医用医用重组Ⅲ型人源化胶原蛋白软膏",
      shortTitle: "SNM胶原蛋白面霜",
      whiteBackgroundImages: [{ name: "湘械注准20222141001-医用修复霜-白底图-01.jpg" }],
      qualificationImages: [{ name: "湘械注准20222141001-医用修复霜-资质图片-01.png" }]
    }
  ]
});

assert.equal(sameSpuFolderMatch.issue, "");
assert.equal(sameSpuFolderMatch.record?.recordId, "rec-lotion");
