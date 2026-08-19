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
  auditPublishCoverage,
  shouldAuditDistributedTitleTask
} from "../dist/src/autolist/audit-rules.js";

assert.equal(shouldAuditDistributedTitleTask("cleaned"), false);
assert.equal(shouldAuditDistributedTitleTask("done"), false);
assert.equal(shouldAuditDistributedTitleTask("published"), true);
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
  inferResumeStartStepForTask,
  resolveCanonicalResumeDecision,
  resolveCanonicalRecoveryTask,
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
import {
  mergePublishArtifactWithSafeManifest,
  publishDistributedProducts
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

const providerUnavailableMessage =
  'failed at main_images_generated: Image generation failed with HTTP 502: {"error":{"message":"Upstream service temporarily unavailable","type":"upstream_error"}}';
assert.equal(isRetryableExternalServiceAvailabilityFailure(providerUnavailableMessage), true);
assert.equal(
  shouldResumeFeishuBatchAfterRetryableChildFailure({
    exitCode: 1,
    batchComplete: false,
    retryableFailureMessage: providerUnavailableMessage,
    recoveryAttempts: 12,
    maxRecoveryAttempts: 12
  }),
  true,
  "Temporary external-service outages must remain recoverable after the generic recovery budget is exhausted"
);
assert.equal(shouldConsumeSupervisorRecoveryAttempt(providerUnavailableMessage), false);
assert.equal(resolveSupervisorRecoveryDelayMs({ failureMessage: providerUnavailableMessage, externalServiceWaitAttempts: 0 }), 3 * 60 * 1000);
assert.equal(resolveSupervisorRecoveryDelayMs({ failureMessage: providerUnavailableMessage, externalServiceWaitAttempts: 3 }), 3 * 60 * 1000);
assert.equal(
  isRetryableExternalServiceAvailabilityFailure(
    "failed at main_images_generated: Image generation request timed out. The provider did not respond in time. Raw error: This operation was aborted"
  ),
  true,
  "Main-image provider timeouts and aborts must enter external-service wait instead of fast paid resubmission"
);
assert.equal(
  shouldConsumeSupervisorRecoveryAttempt(
    "failed at main_images_generated: Image generation request timed out. The provider did not respond in time. Raw error: This operation was aborted"
  ),
  false,
  "Main-image timeout/abort failures must not burn supervisor recovery attempts"
);
const videosBase64PollTimeoutMessage = "failed at main_images_generated: videos-base64 task task_abc did not finish within 1800000ms.";
assert.equal(
  isRetryableExternalServiceAvailabilityFailure(videosBase64PollTimeoutMessage),
  true,
  "videos-base64 submitted-task poll timeouts must wait for the existing paid tasks instead of submitting another batch"
);
const paidImageSafetyBlockMessage =
  "failed at main_images_generated: videos-base64 paid image ledger blocked slot 7: blocked_ambiguous.";
assert.equal(
  isRetryableExternalServiceAvailabilityFailure(paidImageSafetyBlockMessage),
  false,
  "paid image safety blocks must not be treated as provider availability failures"
);
assert.equal(
  shouldResumeFeishuBatchAfterRetryableChildFailure({
    exitCode: 1,
    batchComplete: false,
    retryableFailureMessage: paidImageSafetyBlockMessage,
    recoveryAttempts: 0,
    maxRecoveryAttempts: 12
  }),
  false,
  "project supervisor must stop on reserved or ambiguous paid submission slots instead of restarting"
);
assert.equal(
  shouldConsumeSupervisorRecoveryAttempt(videosBase64PollTimeoutMessage),
  false,
  "videos-base64 submitted-task poll timeouts must not consume fast child recovery attempts"
);
const videosBase64NoAcceptanceFetchFailure =
  "failed at main_images_generated: videos-base64 prompt rounds failed after all concurrent work settled; failed indexes: 1, 3, 5; reasons: videos-base64 paid image slots failed after all concurrent work settled; failed indexes: 1, 2, 4; reasons: fetch failed | fetch failed | fetch failed";
assert.equal(
  isRetryableExternalServiceAvailabilityFailure(videosBase64NoAcceptanceFetchFailure),
  false,
  "videos-base64 no-acceptance submit transport failures must not enter long external-service wait"
);
assert.equal(
  shouldResumeFeishuBatchAfterRetryableChildFailure({
    exitCode: 1,
    batchComplete: false,
    retryableFailureMessage: videosBase64NoAcceptanceFetchFailure,
    recoveryAttempts: 12,
    maxRecoveryAttempts: 12
  }),
  true,
  "videos-base64 no-acceptance submit transport failures must remain self-driven after the generic recovery budget"
);
assert.equal(
  shouldConsumeSupervisorRecoveryAttempt(videosBase64NoAcceptanceFetchFailure),
  false,
  "videos-base64 no-acceptance submit transport failures must not consume recovery attempts because no paid task was accepted"
);
assert.equal(
  resolveSupervisorRecoveryDelayMs({
    failureMessage: videosBase64NoAcceptanceFetchFailure,
    externalServiceWaitAttempts: 0
  }),
  10000,
  "videos-base64 no-acceptance submit transport failures must retry quickly instead of waiting ten minutes"
);
const videosBase64SingleTaskProviderFailure =
  'failed at main_images_generated: videos-base64 prompt rounds failed after all concurrent work settled; failed indexes: 3; reasons: videos-base64 paid image slots failed after all concurrent work settled; failed indexes: 2; reasons: videos-base64 task task_cCj166vYLmQVsX0MMjLVQ0JHTOTYVyaR failed: {"code":"upstream_error","message":"提示词或图片中可能包含违规信息，请修改后重试"}';
assert.equal(
  shouldResumeFeishuBatchAfterRetryableChildFailure({
    exitCode: 1,
    batchComplete: false,
    retryableFailureMessage: videosBase64SingleTaskProviderFailure,
    recoveryAttempts: 0,
    maxRecoveryAttempts: 12
  }),
  true,
  "videos-base64 single accepted-task provider failures must resume to retry only the failed fixed slot with the original prompt"
);
assert.equal(
  isRetryableExternalServiceAvailabilityFailure(videosBase64SingleTaskProviderFailure),
  false,
  "videos-base64 accepted-task provider failures are fixed-slot retries, not unbounded external-service waits"
);
assert.equal(
  shouldConsumeSupervisorRecoveryAttempt(videosBase64SingleTaskProviderFailure),
  true,
  "videos-base64 accepted-task provider failures must consume recovery attempts to avoid unlimited paid resubmissions"
);
const videosBase64ExplicitServiceFailure =
  'failed at main_images_generated: videos-base64 prompt rounds failed after all concurrent work settled; reasons: videos-base64 task task_service failed: {"code":"service_error","message":"任务处理失败","error":{"category":"service","code":"service_error","type":"服务异常","message":"任务处理失败","retryable":false}}';
assert.equal(
  isRetryableExternalServiceAvailabilityFailure(videosBase64ExplicitServiceFailure),
  true,
  "Explicit provider service_error is an availability outage even when retryable:false applies to the finished task"
);
assert.equal(
  shouldConsumeSupervisorRecoveryAttempt(videosBase64ExplicitServiceFailure),
  false,
  "Provider service outages must not exhaust the generic child-recovery budget"
);
assert.equal(
  shouldResumeFeishuBatchAfterRetryableChildFailure({
    exitCode: 1,
    batchComplete: false,
    retryableFailureMessage: videosBase64ExplicitServiceFailure,
    recoveryAttempts: 12,
    maxRecoveryAttempts: 12
  }),
  true,
  "Provider service outages must remain self-driven after the generic recovery budget is exhausted"
);
assert.equal(
  shouldRecoverFullFlowAfterChildFailure({
    exitCode: 1,
    batchComplete: false,
    retryableFailureMessage: videosBase64SingleTaskProviderFailure,
    recoveryAttempts: 0,
    maxRecoveryAttempts: 12,
    childMode: "full",
    activeStep: "main_images_generated",
    activeMessage: "Prompt 3/5: Image 2: videos-base64 task failed"
  }),
  true,
  "full-flow supervisor must self-recover videos-base64 fixed-slot provider failures instead of stopping at 19/20 images"
);
assert.equal(
  shouldRecoverFullFlowAfterChildFailure({
    exitCode: 1,
    batchComplete: false,
    retryableFailureMessage: videosBase64SingleTaskProviderFailure,
    recoveryAttempts: 0,
    maxRecoveryAttempts: 12,
    childMode: "resume",
    activeStep: "main_images_generated",
    activeMessage: "Prompt 3/5: Image 2: videos-base64 task failed"
  }),
  true,
  "resume-mode supervisor must self-recover videos-base64 fixed-slot provider failures instead of exiting after a resume job"
);
const videosBase64RetrySubmitFetchFailure =
  "failed at main_images_generated: videos-base64 prompt rounds failed after all concurrent work settled; failed indexes: 3; reasons: videos-base64 paid image slots failed after all concurrent work settled; failed indexes: 1; reasons: fetch failed";
assert.equal(
  shouldRecoverFullFlowAfterChildFailure({
    exitCode: 1,
    batchComplete: false,
    retryableFailureMessage: videosBase64RetrySubmitFetchFailure,
    recoveryAttempts: 12,
    maxRecoveryAttempts: 12,
    childMode: "resume",
    activeStep: "main_images_generated",
    activeMessage: "Prompt 3/5: Image 2: submitting videos-base64 request."
  }),
  true,
  "resume-mode supervisor must keep waiting and retrying videos-base64 submit transport failures instead of stopping on a preserved checkpoint"
);
const videosBase64RetrySubmitFailToFetchTask =
  'failed at main_images_generated: videos-base64 prompt rounds failed after all concurrent work settled; failed indexes: 3; reasons: videos-base64 paid image slots failed after all concurrent work settled; failed indexes: 2, 4; reasons: videos-base64 submit failed with HTTP 400: {"code":"fail_to_fetch_task","message":"<html><head><title>400 Bad Request</title></head><body><center><h1>400 Bad Request</h1></center><hr><center>openresty</center></body></html>","data":null} | videos-base64 submit failed with HTTP 400: {"code":"fail_to_fetch_task","message":"<html><head><title>400 Bad Request</title></head><body><center><h1>400 Bad Request</h1></center><hr><center>openresty</center></body></html>","data":null}';
assert.equal(
  isRetryableExternalServiceAvailabilityFailure(videosBase64RetrySubmitFailToFetchTask),
  false,
  "videos-base64 fail_to_fetch_task submit failures must not enter long external-service wait"
);
assert.equal(
  shouldResumeFeishuBatchAfterRetryableChildFailure({
    exitCode: 1,
    batchComplete: false,
    retryableFailureMessage: videosBase64RetrySubmitFailToFetchTask,
    recoveryAttempts: 12,
    maxRecoveryAttempts: 12
  }),
  true,
  "videos-base64 fail_to_fetch_task submit failures must keep retrying after the generic recovery budget"
);
assert.equal(
  shouldConsumeSupervisorRecoveryAttempt(videosBase64RetrySubmitFailToFetchTask),
  false,
  "videos-base64 fail_to_fetch_task submit failures did not accept a paid task and must not consume recovery attempts"
);
assert.equal(
  shouldRecoverFullFlowAfterChildFailure({
    exitCode: 1,
    batchComplete: false,
    retryableFailureMessage: videosBase64RetrySubmitFailToFetchTask,
    recoveryAttempts: 12,
    maxRecoveryAttempts: 12,
    childMode: "resume",
    activeStep: "main_images_generated",
    activeMessage: "Prompt 3/5: Image 2: submitting videos-base64 request."
  }),
  true,
  "resume-mode supervisor must self-recover videos-base64 fail_to_fetch_task submit failures"
);
const videosBase64Cloudflare521StatusFailure =
  "failed at main_images_generated: videos-base64 prompt rounds failed after all concurrent work settled; reasons: paid image slot identity conflict for slot 7 | videos-base64 status failed with HTTP 521: Web server is down";
assert.equal(
  isRetryableExternalServiceAvailabilityFailure(videosBase64Cloudflare521StatusFailure),
  true,
  "Cloudflare 520-524 status-read failures must be classified as temporary external-service outages"
);
assert.equal(
  shouldConsumeSupervisorRecoveryAttempt(videosBase64Cloudflare521StatusFailure),
  false,
  "Cloudflare 520-524 outages must not consume the bounded fixed-slot provider-failure retry budget"
);
assert.equal(
  shouldResumeFeishuBatchAfterRetryableChildFailure({
    exitCode: 1,
    batchComplete: false,
    retryableFailureMessage: videosBase64Cloudflare521StatusFailure,
    recoveryAttempts: 12,
    maxRecoveryAttempts: 12
  }),
  true,
  "The supervisor must remain self-driven during Cloudflare 520-524 image status outages"
);
const videosBase64ProviderCircuitOpen =
  "failed at main_images_generated: paid image provider timeout circuit open for slot 17; retry after 1740000ms.";
assert.equal(isRetryableExternalServiceAvailabilityFailure(videosBase64ProviderCircuitOpen), true);
assert.equal(shouldConsumeSupervisorRecoveryAttempt(videosBase64ProviderCircuitOpen), false);
assert.equal(
  shouldResumeFeishuBatchAfterRetryableChildFailure({
    exitCode: 1,
    batchComplete: false,
    retryableFailureMessage: videosBase64ProviderCircuitOpen,
    recoveryAttempts: 12,
    maxRecoveryAttempts: 12
  }),
  true,
  "A fixed-slot provider timeout circuit must remain project-owned and self-driven after the generic recovery budget"
);
assert.equal(
  resolveSupervisorRecoveryDelayMs({
    failureMessage: videosBase64ProviderCircuitOpen,
    externalServiceWaitAttempts: 0
  }),
  29 * 60 * 1000,
  "The supervisor must honor a bounded fixed-slot circuit instead of collapsing it into a three-minute paid retry loop"
);
assert.equal(
  resolveSupervisorRecoveryDelayMs({
    failureMessage: "paid image provider timeout circuit open for slot 17; retry after invalidms.",
    externalServiceWaitAttempts: 0
  }),
  3 * 60 * 1000,
  "Malformed slot cooldown text must fall back to the normal external-service delay"
);
assert.equal(
  resolveSupervisorRecoveryDelayMs({
    failureMessage: "paid image provider timeout circuit open for slot 17; retry after 999999999ms.",
    externalServiceWaitAttempts: 0
  }),
  3 * 60 * 1000,
  "Out-of-range slot cooldown text must not create an unbounded supervisor sleep"
);
assert.deepEqual(
  resolvePaidImageProviderTimeoutRetry({
    failureReason: "provider task failed: timed out",
    audit: [
      { state: "failed_after_acceptance", at: "2026-06-18T01:00:00.000Z", reason: "provider task failed: timed out" },
      { state: "failed_after_acceptance", at: "2026-06-18T01:20:00.000Z", reason: "provider task failed: timed out" },
      { state: "failed_after_acceptance", at: "2026-06-18T01:40:00.000Z", reason: "provider task failed: timed out" }
    ],
    recordedPromptDigest: "policy-digest",
    policyCompatiblePromptDigest: "policy-digest",
    nowMs: Date.parse("2026-06-18T01:41:00.000Z")
  }),
  { usePolicyCompatiblePrompt: true, deferMs: 2 * 60 * 1000 },
  "Paid image fixed-slot cooldown must be capped by the project three-minute image wait ceiling"
);
assert.equal(
  typeof progressRulesModule.formatAutoListingControllerExternalServiceWaitSummary,
  "function",
  "External-service status must expose a deterministic countdown formatter"
);
const externalWaitSummary = progressRulesModule.formatAutoListingControllerExternalServiceWaitSummary({
  retryAt: "2026-06-18T06:30:00.000Z",
  nowMs: Date.parse("2026-06-18T06:10:29.000Z"),
  reason: "paid image provider timeout circuit open for slot 17; retry after 1171000ms."
});
assert.match(externalWaitSummary, /19分31秒后/);
assert.match(externalWaitSummary, /2026-06-18T06:30:00.000Z/);
assert.match(externalWaitSummary, /槽位 17/);
const compactExternalWait = formatAutoListingControllerCompactStatusText({
  status: "external_service_wait",
  summary: externalWaitSummary,
  productName: "李时珍膝盖部位凝胶",
  imageGenerationProgress: "Prompt 4/5: staged 4 image(s).",
  mainImageCompleted: 19,
  feishuCompleted: 5,
  feishuTotal: 7
});
assert.match(compactExternalWait, /19分31秒后/);
assert.doesNotMatch(compactExternalWait, /staged 4 image/);
const activePaidLedgerWait = {
  expectedSlotCount: 20,
  missing: 0,
  reserved: 0,
  submitted: 3,
  completed: 17,
  failedBeforeAcceptance: 0,
  failedAfterAcceptance: 0,
  ambiguous: 0
};
const compactActivePaidLedgerWait = formatAutoListingControllerCompactStatusText({
  status: "external_service_wait",
  summary: "等待生图服务恢复后自动继续查询已接受任务。",
  imageGenerationProgress: "Prompt 5/5: Image 4: videos-base64 task task_active status pending 0.",
  mainImageCompleted: activePaidLedgerWait.completed,
  mainImageExpected: activePaidLedgerWait.expectedSlotCount,
  feishuCompleted: 0,
  feishuTotal: 1
});
assert.match(compactActivePaidLedgerWait, /主图 17\/20/);
assert.match(compactActivePaidLedgerWait, /等待生图服务/);
assert.doesNotMatch(compactActivePaidLedgerWait, /主图 20\/20/);
const cloudflare502Html = '<!DOCTYPE html><html><head><title>dyysy.life | 502: Bad gateway</title></head><body><h1>Bad gateway</h1><span>Host</span><span>Error</span></body></html>';
const paidImageSafetyBlockWithHtml =
  "paid submission safety block: paid image ledger has ambiguous=20, reserved=0; original: videos-base64 submit failed with HTTP 502: " +
  cloudflare502Html;
const compactPaidSafetyBlock = formatAutoListingControllerCompactStatusText({
  status: "failed",
  summary: paidImageSafetyBlockWithHtml,
  productName: "延草纲目宝元堂足跟医用疼痛凝胶",
  publishSafelyPublished: 20,
  publishTotal: 20,
  publishProductIndex: 20,
  publishProductTotal: 20,
  publishShopIndex: 10,
  publishShopTotal: 10,
  feishuCompleted: 1,
  feishuTotal: 5
});
assert.match(compactPaidSafetyBlock, /付费生图提交状态不明确/);
assert.match(compactPaidSafetyBlock, /20 个槽位/);
assert.doesNotMatch(compactPaidSafetyBlock, /<!DOCTYPE html>|Cloudflare|paid submission safety block|videos-base64 submit failed/i);
assert.equal(
  resolveSupervisorRecoveryDelayMs({
    failureMessage: videosBase64PollTimeoutMessage,
    externalServiceWaitAttempts: 0
  }),
  3 * 60 * 1000,
  "videos-base64 submitted-task poll timeouts must use the fixed three-minute external-service wait"
);
assert.equal(
  shouldResumeFeishuBatchAfterRetryableChildFailure({
    exitCode: 1,
    batchComplete: false,
    retryableFailureMessage: videosBase64PollTimeoutMessage,
    recoveryAttempts: 12,
    maxRecoveryAttempts: 12
  }),
  true,
  "videos-base64 poll failures must remain recoverable after the generic recovery budget is exhausted"
);
assert.equal(
  isRetryableExternalServiceAvailabilityFailure(
    'Image generation failed with HTTP 502: {"error":{"message":"Upstream access forbidden, please contact administrator"}}'
  ),
  false,
  "Permission and access failures must never enter indefinite external-service waiting"
);
assert.equal(
  shouldResumeFeishuBatchAfterRetryableChildFailure({
    exitCode: 1,
    batchComplete: false,
    retryableFailureMessage:
      'Image generation failed with HTTP 502: {"error":{"message":"Upstream access forbidden, please contact administrator","type":"upstream_error"}}',
    recoveryAttempts: 0,
    maxRecoveryAttempts: 3
  }),
  false
);
assert.equal(
  shouldResumeFeishuBatchAfterRetryableChildFailure({
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
    exitCode: 124,
    batchComplete: false,
    retryableFailureMessage: "child made no progress before watchdog timeout",
    recoveryAttempts: 0,
    maxRecoveryAttempts: 3
  }),
  true
);
assert.equal(
  shouldRecoverFullFlowAfterChildFailure({
    childMode: "resume",
    exitCode: 124,
    batchComplete: false,
    retryableFailureMessage: "child made no progress before watchdog timeout",
    recoveryAttempts: 0,
    maxRecoveryAttempts: 3
  }),
  true,
  "AutoListingController resume children killed by the no-progress watchdog must automatically continue the locked current batch"
);
const doudianShippingTimePreconditionFailure =
  "failed at published: Sequential publish flow stopped: \u4ef7\u683c\u5e93\u5b58\u53d1\u8d27\u524d\u7f6e\u6a21\u5757\u672a\u5b8c\u6210\u3002Price-inventory shipping precondition failed. Missing price-inventory precondition fields: shippingTime";
assert.equal(
  shouldResumeFeishuBatchAfterRetryableChildFailure({
    exitCode: 1,
    batchComplete: false,
    retryableFailureMessage: doudianShippingTimePreconditionFailure,
    recoveryAttempts: 0,
    maxRecoveryAttempts: 12
  }),
  true,
  "shipping-time pre-submit detection failures must remain project-owned and self-recoverable"
);
assert.equal(
  resolveSupervisorRecoveryChildMode(doudianShippingTimePreconditionFailure),
  "resume",
  "shipping-time pre-submit detection failures must resume from the manifest instead of rebuilding the whole product"
);
assert.equal(
  shouldRecoverFullFlowAfterChildFailure({
    childMode: "full",
    exitCode: 1,
    batchComplete: false,
    retryableFailureMessage: doudianShippingTimePreconditionFailure,
    activeStep: "published",
    activeMessage: "Publish failed: product-1 (shop-1)",
    recoveryAttempts: 0,
    maxRecoveryAttempts: 12
  }),
  true,
  "AutoListingController must not stop when a pre-submit shipping-time readback can be retried safely"
);
const videosBase64QueuedWatchdogMessage =
  "child made no progress before watchdog timeout during main_images_generated: Prompt 4/5: Image 4: videos-base64 task task_1bRTM2GdZUb3T status queued 0.";
assert.equal(
  isRetryableExternalServiceAvailabilityFailure(videosBase64QueuedWatchdogMessage),
  true,
  "accepted videos-base64 queued 0 watchdog stalls must become external-service waits"
);
assert.equal(
  shouldConsumeSupervisorRecoveryAttempt(videosBase64QueuedWatchdogMessage),
  false,
  "accepted videos-base64 queued 0 watchdog stalls must not burn generic supervisor recovery attempts"
);
assert.equal(
  resolveSupervisorRecoveryDelayMs({
    failureMessage: videosBase64QueuedWatchdogMessage,
    externalServiceWaitAttempts: 0
  }),
  3 * 60 * 1000,
  "accepted videos-base64 queued 0 watchdog stalls must use the fixed three-minute external-service wait"
);
assert.equal(
  shouldRecoverFullFlowAfterChildFailure({
    childMode: "full",
    exitCode: 124,
    batchComplete: false,
    retryableFailureMessage: videosBase64QueuedWatchdogMessage,
    activeStep: "main_images_generated",
    activeMessage: "Prompt 4/5: Image 4: videos-base64 task task_1bRTM2GdZUb3T status queued 0.",
    recoveryAttempts: 12,
    maxRecoveryAttempts: 12
  }),
  true,
  "accepted videos-base64 queued 0 watchdog stalls must remain self-driven after the generic recovery budget"
);
assert.equal(
  shouldRecoverFullFlowAfterChildFailure({
    childMode: "full",
    exitCode: 124,
    batchComplete: false,
    retryableFailureMessage: "child made no progress before watchdog timeout",
    activeStep: "published",
    activeMessage: "Publishing product folder: product-1 (shop-1)",
    publishAttemptState: "attempted_or_unknown",
    recoveryAttempts: 0,
    maxRecoveryAttempts: 3
  }),
  false,
  "AutoListingController must not automatically retry an interrupted publish with uncertain external side effects"
);
assert.equal(
  shouldRecoverFullFlowAfterChildFailure({
    childMode: "full",
    exitCode: 124,
    batchComplete: false,
    retryableFailureMessage: "child made no progress before watchdog timeout",
    activeStep: "published",
    activeMessage: "Publishing product folder: product-1 (shop-1)",
    publishAttemptState: "not_attempted",
    recoveryAttempts: 0,
    maxRecoveryAttempts: 3
  }),
  true,
  "A watchdog kill with durable proof that the publish button was never attempted must resume the exact manifest-backed target"
);
const publishAttemptRuntime = fs.mkdtempSync(path.join(os.tmpdir(), "publish-attempt-state-"));
assert.equal(readPublishAttemptState(publishAttemptRuntime), "attempted_or_unknown");
initializePublishAttemptState(publishAttemptRuntime);
assert.equal(readPublishAttemptState(publishAttemptRuntime), "not_attempted");
markPublishAttemptStarted(publishAttemptRuntime);
assert.equal(readPublishAttemptState(publishAttemptRuntime), "attempted_or_unknown");
initializePublishAttemptState(publishAttemptRuntime);
assert.equal(
  readPublishAttemptState(publishAttemptRuntime),
  "attempted_or_unknown",
  "A recorded publish attempt must be monotonic and must never reset to safe before manifest verification"
);
const doudianPrePaidPreflightNotReady =
  "Platform SPU query page was not ready after navigation: Platform SPU query controls are incomplete.";
assert.equal(
  shouldResumeFeishuBatchAfterRetryableChildFailure({
    exitCode: 1,
    batchComplete: false,
    retryableFailureMessage: doudianPrePaidPreflightNotReady,
    recoveryAttempts: 0,
    maxRecoveryAttempts: 12
  }),
  true,
  "pre-paid Doudian/SPU readiness failures must be recoverable before image generation spends credits"
);
assert.equal(
  shouldRecoverFullFlowAfterChildFailure({
    childMode: "full",
    exitCode: 1,
    batchComplete: false,
    retryableFailureMessage: doudianPrePaidPreflightNotReady,
    recoveryAttempts: 0,
    maxRecoveryAttempts: 12,
    activeStep: "source_images_discovered",
    activeMessage: "checking Doudian login preflight before paid image generation"
  }),
  true,
  "full-flow supervisor must retry pre-paid Doudian/SPU readiness failures instead of stopping before image generation"
);
assert.equal(
  shouldRecoverFullFlowAfterChildFailure({
    childMode: "full",
    exitCode: 1,
    batchComplete: false,
    retryableFailureMessage: "failed at published: publish flow stopped because page context was lost",
    activeStep: "published",
    activeMessage: "Publish failed: product-3 (shop-2)",
    recoveryAttempts: 0,
    maxRecoveryAttempts: 3
  }),
  false,
  "AutoListingController must not restart a full flow after any publish-stage failure because prior shops may already be published"
);
assert.equal(isAutoListingControllerProgressArtifactRelativePath("publish/shop__product/screenshots/publish-page-images-uploaded.png"), true);
assert.equal(isAutoListingControllerProgressArtifactRelativePath("publish/shop__product/result.json"), true);
assert.equal(isAutoListingControllerProgressArtifactRelativePath("tasks/image-001/main-image-01/generated.png"), false);
assert.equal(
  shouldTerminateRecordedAutoListingControllerProcessGroup({ leaderRunning: false }),
  true,
  "AutoListingController must terminate a recorded detached process group even after its leader exits"
);
assert.equal(
  shouldTerminateRecordedAutoListingControllerProcessGroup({ leaderRunning: true, leaderCommandMatches: false }),
  false,
  "AutoListingController must not terminate a live reused PID whose command is unrelated"
);
assert.equal(
  shouldTerminateChildAfterTerminalResult({
    terminalResultFound: true,
    terminalResultAgeMs: 6000,
    gracePeriodMs: 5000
  }),
  true,
  "AutoListingController must promptly terminate a child that remains alive after writing a terminal result"
);
assert.equal(
  shouldTerminateChildAfterTerminalResult({
    terminalResultFound: true,
    terminalResultAgeMs: 1000,
    gracePeriodMs: 5000
  }),
  false,
  "AutoListingController must allow a short grace period for terminal output and resource cleanup"
);
assert.equal(
  shouldResumeFeishuBatchAfterRetryableChildFailure({
    exitCode: 124,
    batchComplete: false,
    retryableFailureMessage: "child made no progress before watchdog timeout",
    recoveryAttempts: 3,
    maxRecoveryAttempts: 3
  }),
  false
);
assert.equal(resolveDefaultRetryableChildFailureRecoveryAttempts(), 12);
assert.equal(
  resolveAutoListingControllerProgressAgeSeconds({
    nowIso: "2026-05-27T03:05:30.000Z",
    latestProgressTimestamp: "2026-05-27T03:02:30.000Z"
  }),
  180
);
assert.equal(
  resolveAutoListingControllerProgressAgeSeconds({
    nowIso: "bad-date",
    latestProgressTimestamp: "2026-05-27T03:02:30.000Z"
  }),
  undefined
);
assert.deepEqual(
  resolveAutoListingControllerEffectiveProgressTimestamp({
    stateProgressTimestamp: "2026-05-27T10:20:41.000Z",
    activePublishUpdatedAt: "2026-05-27T10:40:41.000Z",
    latestArtifactUpdatedAt: "2026-05-27T10:43:37.000Z"
  }),
  {
    timestamp: "2026-05-27T10:43:37.000Z",
    source: "latest_publish_artifact"
  }
);
assert.equal(
  shouldResumeInterruptedTaskInPlace({
    runStatus: "running",
    taskStatus: "main_images_generated",
    sourceImageExists: true,
    reusableRawImageCount: 7
  }),
  true
);
assert.equal(
  shouldResumeInterruptedTaskInPlace({
    runStatus: "running",
    taskStatus: "main_images_generated",
    sourceImageExists: true,
    reusableRawImageCount: 0
  }),
  false
);
assert.equal(
  shouldResumeInterruptedTaskInPlace({
    runStatus: "completed",
    taskStatus: "done",
    sourceImageExists: true,
    reusableRawImageCount: 20
  }),
  false
);
assert.equal(
  shouldResumeHistoricalFailureForCurrentFeishuBatch({
    currentBatchFingerprint: "batch-current",
    resumeBatchFingerprint: "batch-current",
    failedSourceImagePath: "/work/input/auto-listing/feishu-images/product-2.png",
    pendingSourceImages: [
      "/work/input/auto-listing/feishu-images/product-1.png",
      "/work/input/auto-listing/feishu-images/product-2.png"
    ],
    batchComplete: false
  }),
  false
);
assert.equal(
  shouldResumeHistoricalFailureForCurrentFeishuBatch({
    currentBatchFingerprint: "batch-current",
    resumeBatchFingerprint: "batch-current",
    failedSourceImagePath: "/work/input/auto-listing/feishu-images/product-2.png",
    pendingSourceImages: ["/work/input/auto-listing/feishu-images/product-2.png"],
    batchComplete: false
  }),
  true
);
assert.equal(
  shouldResumeHistoricalFailureForCurrentFeishuBatch({
    currentBatchFingerprint: "batch-current",
    resumeBatchFingerprint: "batch-current",
    failedSourceImagePath: "/work/input/auto-listing/feishu-images/product-2.png",
    pendingSourceImages: [],
    batchComplete: true,
    reusableArtifactCount: 0
  }),
  false
);
assert.equal(
  shouldResumeHistoricalFailureForCurrentFeishuBatch({
    currentBatchFingerprint: "batch-current",
    resumeBatchFingerprint: "batch-current",
    failedSourceImagePath: "/work/input/auto-listing/feishu-images/product-2.png",
    pendingSourceImages: [],
    batchComplete: true,
    reusableArtifactCount: 16
  }),
  true
);
assert.equal(
  shouldResumeHistoricalFailureForCurrentFeishuBatch({
    currentBatchFingerprint: "batch-current",
    resumeBatchFingerprint: "batch-current",
    failedSourceImagePath: "/work/input/auto-listing/feishu-images/product-2.png",
    pendingSourceImages: ["/work/input/auto-listing/feishu-images/product-3.png"],
    batchComplete: false,
    reusableArtifactCount: 0
  }),
  false
);
assert.equal(canResumeFeishuBatchArtifacts({ currentBatchFingerprint: "batch-a", resumeBatchFingerprint: "batch-a" }), true);
assert.equal(canResumeFeishuBatchArtifacts({ currentBatchFingerprint: "batch-a", resumeBatchFingerprint: "batch-b" }), false);
assert.equal(canResumeFeishuBatchArtifacts({ currentBatchFingerprint: "batch-a", resumeBatchFingerprint: undefined }), false);
assert.equal(canResumeFeishuBatchArtifacts({ currentBatchFingerprint: undefined, resumeBatchFingerprint: "batch-a" }), false);
const staleShopRoot = fs.mkdtempSync(path.join(os.tmpdir(), "stale-shop-resume-"));
fs.mkdirSync(path.join(staleShopRoot, "01", "重复产品01"), { recursive: true });
assert.throws(
  () =>
    recoverDistributedFoldersFromShopRoot({
      shopRootDir: staleShopRoot,
      requireWorkbook: false,
      productNameCandidates: ["重复产品"],
      expectedProductFolderNames: []
    }),
  /exact product-folder allowlist/,
  "A product-name match must never be enough to recover folders from the shared shop root."
);
assert.equal(
  resolveAutoListingControllerFeishuProgressDisplayMode({
    running: true,
    mode: "resume-real-job",
    batchComplete: true,
    activeResumeReusableArtifactCount: 16
  }),
  "resume_artifact_completion"
);
assert.equal(
  resolveAutoListingControllerFeishuProgressDisplayMode({
    running: true,
    mode: "resume-real-job",
    batchComplete: true,
    activeResumeReusableArtifactCount: 0
  }),
  "current_batch"
);
assert.equal(
  resolveAutoListingControllerFeishuProgressDisplayMode({
    running: true,
    mode: "full-real-flow",
    batchComplete: false,
    activeResumeReusableArtifactCount: 16
  }),
  "current_batch"
);
assert.deepEqual(
  resolveAutoListingControllerFeishuBatchDisplayCounts({
    recordCount: 10,
    processedRecordCount: 5,
    pendingSourceImages: ["/work/current.png", "/work/next.png"],
    currentSourceImagePath: "/work/current.png"
  }),
  {
    recordCount: 10,
    completedCount: 5,
    currentCount: 1,
    notStartedCount: 1
  }
);
assert.deepEqual(
  resolveAutoListingControllerFeishuBatchDisplayCounts({
    recordCount: 10,
    processedRecordCount: 5,
    pendingSourceImages: ["/work/next.png"],
    currentSourceImagePath: "/work/current.png"
  }),
  {
    recordCount: 10,
    completedCount: 5,
    currentCount: 0,
    notStartedCount: 1
  }
);

const cleanupResumeFolders = Array.from({ length: 20 }, (_, index) => `/work/shop/product-${index + 1}`);
assert.equal(
  hasCompleteProductPublishCoverage({
    task: {
      taskId: "image-partial-cleanup-guard",
      sequenceNo: 1,
      sourceImagePath: "/work/input/current.png",
      sourceImageName: "current.png",
      status: "published",
      lastUpdatedAt: new Date().toISOString(),
      generatedProductFolders: ["/work/shop/product-7"],
      notes: [],
      feishuProductRecord: {
        recordId: "record-001",
        userCognitionName: "医用面部补水喷雾",
        genericName: "医用透明质酸钠液体敷料",
        brand: "延草纲目",
        spu: "鄂械注准20232144654",
        sellingPointText: "测试卖点",
        deepseekPromptText: "测试提示词",
        mainImageInstructionText: "测试主图指令",
        positivePromptText: "测试正向提示词",
        negativePromptText: "测试反向提示词",
        titleKeywordText: "医用面部补水喷雾",
        titleSuffixText: "延草纲目",
        productPriceText: "149,139,89.9,79.9",
        shortTitle: "面部补水喷雾",
        productCategory: "医疗器械",
        whiteBackgroundImages: [],
        qualificationImages: [],
        rawFields: {}
      }
    },
    productIdentity: {
      sourceImagePath: "/work/input/current.png",
      recordId: "record-001",
      productCategory: "医疗器械"
    },
    publishManifestEntries: [
      {
        productFolder: "/work/shop/product-7",
        runtimeKey: "shop__product-7",
        shopFolder: "/work/shop",
        watermarkNo: 7,
        sourceImagePath: "/work/input/current.png",
        recordId: "record-001",
        productCategory: "医疗器械",
        status: "published",
        finalVerifyStatus: "publish_signal_confirmed",
        message: "ok",
        updatedAt: new Date().toISOString()
      }
    ]
  }),
  false,
  "One resumed target must not unlock cleanup for a 20-target product."
);
assert.equal(
  hasCompleteProductPublishCoverage({
    task: {
      taskId: "image-terminal-outcomes",
      sequenceNo: 1,
      sourceImagePath: "/work/input/current.png",
      sourceImageName: "current.png",
      status: "published",
      lastUpdatedAt: new Date().toISOString(),
      generatedProductFolders: cleanupResumeFolders,
      notes: [],
      publishArtifact: {
        simulated: false,
        results: cleanupResumeFolders.map((productFolder, index) => ({
          productFolder,
          ok: index !== 5,
          status: index === 5 ? "skipped" : "published",
          finalVerifyStatus: index === 5 ? "submit_rejected_exhausted" : "publish_signal_confirmed",
          errorClass: index === 5 ? "final_publish_submit_transient" : "",
          message: index === 5 ? "deferred without replay" : "published"
        }))
      }
    },
    productIdentity: { sourceImagePath: "/work/input/current.png", recordId: "record-001" },
    publishManifestEntries: []
  }),
  true,
  "Cleanup eligibility must consume the same terminal-outcome rule even when only task artifacts are available."
);
assert.equal(
  isProductFullyProcessed({
    task: {
      taskId: "image-001",
      sequenceNo: 1,
      sourceImagePath: "/work/input/current.png",
      sourceImageName: "current.png",
      status: "done",
      lastUpdatedAt: new Date().toISOString(),
      generatedProductFolders: cleanupResumeFolders,
      notes: [],
      shopDistributionArtifact: {
        distributedFolders: cleanupResumeFolders,
        simulated: false
      }
    },
    productIdentity: {
      sourceImagePath: "/work/input/current.png",
      recordId: "record-001"
    },
    publishManifestEntries: cleanupResumeFolders.map((productFolder, index) => ({
      productFolder,
      runtimeKey: `shop__product-${index + 1}`,
      shopFolder: "/work/shop",
      watermarkNo: index + 1,
      sourceImagePath: "/work/input/current.png",
      recordId: "record-001",
      status: "published",
      finalVerifyStatus: "publish_signal_confirmed",
      message: "ok",
      updatedAt: new Date().toISOString()
    }))
  }),
  true
);
assert.equal(
  isProductFullyProcessed({
    task: {
      taskId: "image-resume-one-target",
      sequenceNo: 1,
      sourceImagePath: "/work/input/current.png",
      sourceImageName: "current.png",
      status: "done",
      lastUpdatedAt: new Date().toISOString(),
      generatedProductFolders: ["/work/shop/product-1"],
      notes: [],
      feishuProductRecord: {
        recordId: "record-001",
        userCognitionName: "医用面部补水喷雾",
        genericName: "医用透明质酸钠液体敷料",
        brand: "延草纲目",
        spu: "鄂械注准20232144654",
        sellingPointText: "测试卖点",
        deepseekPromptText: "测试提示词",
        mainImageInstructionText: "测试主图指令",
        positivePromptText: "测试正向提示词",
        negativePromptText: "测试反向提示词",
        titleKeywordText: "医用面部补水喷雾",
        titleSuffixText: "延草纲目",
        productPriceText: "149,139,89.9,79.9",
        shortTitle: "面部补水喷雾",
        productCategory: "医疗器械",
        whiteBackgroundImages: [],
        qualificationImages: [],
        rawFields: {}
      },
      shopDistributionArtifact: {
        distributedFolders: ["/work/shop/product-1"],
        simulated: false
      }
    },
    productIdentity: {
      sourceImagePath: "/work/input/current.png",
      recordId: "record-001",
      productCategory: "医疗器械"
    },
    publishManifestEntries: [
      {
        productFolder: "/work/shop/product-1",
        runtimeKey: "shop__product-1",
        shopFolder: "/work/shop",
        watermarkNo: 1,
        sourceImagePath: "/work/input/current.png",
        recordId: "record-001",
        productCategory: "医疗器械",
        status: "published",
        finalVerifyStatus: "publish_signal_confirmed",
        message: "ok",
        updatedAt: new Date().toISOString()
      }
    ]
  }),
  false,
  "A one-target publish-stage resume must not mark a medical-device Feishu product fully processed before all 20 planned targets are accepted."
);
const acceptedSubmitFolders = Array.from({ length: 20 }, (_, index) => `/work/shop/accepted-submit-product-${index + 1}`);
assert.equal(
  isProductFullyProcessed({
    task: {
      taskId: "image-accepted-submit",
      sequenceNo: 2,
      sourceImagePath: "/work/input/accepted-submit.png",
      sourceImageName: "accepted-submit.png",
      status: "done",
      lastUpdatedAt: new Date().toISOString(),
      generatedProductFolders: acceptedSubmitFolders,
      notes: [],
      shopDistributionArtifact: {
        distributedFolders: acceptedSubmitFolders,
        simulated: false
      }
    },
    productIdentity: {
      sourceImagePath: "/work/input/accepted-submit.png",
      recordId: "record-accepted-submit"
    },
    publishManifestEntries: acceptedSubmitFolders.map((productFolder, index) => ({
      productFolder,
      runtimeKey: `shop__accepted-submit-product-${index + 1}`,
      shopFolder: "/work/shop",
      watermarkNo: index + 1,
      sourceImagePath: "/work/input/accepted-submit.png",
      recordId: "record-accepted-submit",
      status: index === 12 ? "failed" : "published",
      finalVerifyStatus: index === 12 ? "submit_accepted_unconfirmed" : "publish_signal_confirmed",
      errorClass: index === 12 ? "final_publish_state_uncertain" : "",
      message: index === 12 ? "Publish button click was issued; platform success signal was not observed." : "ok",
      updatedAt: new Date().toISOString()
    }))
  }),
  true,
  "A platform-accepted submit with uncertain final signal must close Feishu batch processing instead of rediscovering a cleaned source image."
);
assert.equal(
  isProductFullyProcessed({
    task: {
      taskId: "image-needs-review",
      sequenceNo: 3,
      sourceImagePath: "/work/input/needs-review.png",
      sourceImageName: "needs-review.png",
      status: "done",
      lastUpdatedAt: new Date().toISOString(),
      generatedProductFolders: acceptedSubmitFolders,
      notes: [],
      shopDistributionArtifact: {
        distributedFolders: acceptedSubmitFolders,
        simulated: false
      },
      publishArtifact: {
        results: acceptedSubmitFolders.map((productFolder, index) => ({
          productFolder,
          ok: true,
          status: "published",
          finalVerifyStatus: index === 3 ? "needs_manual_review" : "publish_signal_confirmed",
          errorClass: index === 3 ? "unknown_publish_failure" : "",
          message: index === 3 ? "Publish button click was issued; platform success signal was not observed." : "ok"
        }))
      }
    },
    productIdentity: {
      sourceImagePath: "/work/input/needs-review.png",
      recordId: "record-needs-review"
    },
    publishManifestEntries: acceptedSubmitFolders.map((productFolder, index) => ({
      productFolder,
      runtimeKey: `shop__needs-review-product-${index + 1}`,
      shopFolder: "/work/shop",
      watermarkNo: index + 1,
      sourceImagePath: "/work/input/needs-review.png",
      recordId: "record-needs-review",
      status: index === 3 ? "failed" : "published",
      finalVerifyStatus: index === 3 ? "needs_manual_review" : "publish_signal_confirmed",
      errorClass: index === 3 ? "unknown_publish_failure" : "",
      message: index === 3 ? "Publish button click was issued; platform success signal was not observed." : "ok",
      updatedAt: new Date().toISOString()
    }))
  }),
  false,
  "Manual-review publish uncertainty must not mark the source image processed; cleanup must be blocked before source assets are removed."
);
const acceptedSubmitPublishAudit = auditPublishCoverage({
  tasks: [
    {
      taskId: "image-accepted-submit",
      sequenceNo: 2,
      sourceImagePath: "/work/input/accepted-submit.png",
      sourceImageName: "accepted-submit.png",
      status: "done",
      lastUpdatedAt: new Date().toISOString(),
      generatedProductFolders: acceptedSubmitFolders,
      notes: [],
      shopDistributionArtifact: {
        distributedFolders: acceptedSubmitFolders,
        simulated: false
      }
    }
  ],
  manifestEntries: acceptedSubmitFolders.map((productFolder, index) => ({
    productFolder,
    runtimeKey: `shop__accepted-submit-product-${index + 1}`,
    shopFolder: "/work/shop",
    watermarkNo: index + 1,
    sourceImagePath: "/work/input/accepted-submit.png",
    recordId: "record-accepted-submit",
    status: index === 12 ? "failed" : "published",
    finalVerifyStatus: index === 12 ? "submit_accepted_unconfirmed" : "publish_signal_confirmed",
    errorClass: index === 12 ? "final_publish_state_uncertain" : "",
    message: index === 12 ? "Publish button click was issued; platform success signal was not observed." : "ok",
    updatedAt: new Date().toISOString()
  }))
});
assert.equal(acceptedSubmitPublishAudit.ok, true);
assert.equal(acceptedSubmitPublishAudit.summary.safelyPublishedCount, 20);
assert.equal(acceptedSubmitPublishAudit.warnings.length, 1);
assert.equal(acceptedSubmitPublishAudit.warnings[0].code, "publish_result_submit_accepted_unconfirmed");
assert.equal(
  resolveAutoListingControllerStartAfterFeishuRefresh({
    currentBatchComplete: true,
    refreshedBatchChanged: true,
    refreshedBatchComplete: false
  }),
  "start_new_or_pending_batch"
);
assert.equal(
  resolveAutoListingControllerStartAfterFeishuRefresh({
    currentBatchComplete: true,
    refreshedBatchChanged: false,
    refreshedBatchComplete: true
  }),
  "require_rerun_confirmation"
);
assert.equal(
  resolveAutoListingControllerStartAfterFeishuRefresh({
    currentBatchComplete: true,
    refreshedBatchChanged: false,
    refreshedBatchComplete: true,
    forceRerunCurrentBatch: true
  }),
  "rerun_current_batch"
);
assert.equal(
  shouldSuppressHistoricalResultInAutoListingControllerStatus({
    running: true,
    publishProgressAvailable: true,
    resultOk: false,
    resultStatus: "failed",
    activeRuntimeDir: "/runs/active",
    resultRuntimeDir: "/runs/stale-result"
  }),
  true
);
assert.equal(
  shouldSuppressHistoricalResultInAutoListingControllerStatus({
    running: true,
    publishProgressAvailable: false,
    resultOk: false,
    resultStatus: "failed",
    activeRuntimeDir: "/runs/active",
    resultRuntimeDir: "/runs/stale-result"
  }),
  true
);
assert.equal(
  shouldSuppressHistoricalResultInAutoListingControllerStatus({
    running: false,
    publishProgressAvailable: true,
    resultOk: false,
    resultStatus: "failed",
    activeRuntimeDir: "/runs/active",
    resultRuntimeDir: "/runs/stale-result"
  }),
  false
);
assert.equal(
  shouldSuppressStateCurrentTaskInAutoListingControllerStatus({
    running: true,
    publishProgressAvailable: true,
    latestProgressStep: "published",
    currentTaskStatus: "source_images_discovered"
  }),
  true
);
assert.equal(
  shouldSuppressStateCurrentTaskInAutoListingControllerStatus({
    running: true,
    publishProgressAvailable: false,
    latestProgressStep: "main_images_generated",
    currentTaskStatus: "main_images_generated"
  }),
  false
);
assert.deepEqual(
  resolveImageGenerationHttpRetryPolicy({
    status: 503,
    responseText: '{"error":{"message":"system memory overloaded (current: 93.6%, threshold: 90%)","code":"system_memory_overloaded"}}',
    configuredMaxRetries: undefined
  }),
  {
    maxRetries: 8,
    delayMs: [60000, 90000, 120000, 180000, 180000, 180000, 180000, 180000],
    reason: "provider_resource_overloaded"
  }
);
assert.deepEqual(
  resolveImageGenerationHttpRetryPolicy({
    status: 503,
    responseText: '{"error":{"message":"temporary unavailable"}}',
    configuredMaxRetries: undefined
  }),
  {
    maxRetries: 8,
    delayMs: [60000, 90000, 120000, 180000, 180000, 180000, 180000, 180000],
    reason: "provider_gateway_unavailable"
  }
);
assert.deepEqual(
  resolveImageGenerationHttpRetryPolicy({
    status: 502,
    responseText: '{"error":{"message":"Upstream access forbidden, please contact administrator","type":"upstream_error"}}',
    configuredMaxRetries: undefined
  }),
  {
    maxRetries: 0,
    delayMs: [],
    reason: "provider_upstream_forbidden"
  }
);
assert.deepEqual(
  resolveImageGenerationHttpRetryPolicy({
    status: 500,
    responseText: '{"error":{"message":"upstream error: do request failed (request id: 202605250701525013041518268d9d621y2kdZ5)","code":"do_request_failed"}}',
    configuredMaxRetries: undefined
  }),
  {
    maxRetries: 8,
    delayMs: [60000, 90000, 120000, 180000, 180000, 180000, 180000, 180000],
    reason: "provider_upstream_failed"
  }
);
assert.deepEqual(
  resolveImageGenerationHttpRetryPolicy({
    status: 500,
    responseText: '{"error":{"message":"temporary unavailable"}}',
    configuredMaxRetries: undefined
  }),
  {
    maxRetries: 3,
    delayMs: [3000, 6000, 9000],
    reason: "http_transient"
  }
);
assert.deepEqual(
  resolveImageGenerationHttpRetryPolicy({
    status: 400,
    responseText: "<html><head><title>400 Bad Request</title></head><body><center>openresty</center></body></html>",
    configuredMaxRetries: undefined
  }),
  {
    maxRetries: 8,
    delayMs: [60000, 90000, 120000, 180000, 180000, 180000, 180000, 180000],
    reason: "provider_upstream_failed"
  },
  "a proxy-generated bare openresty 400 must stay inside long retry"
);
assert.deepEqual(
  resolveImageGenerationHttpRetryPolicy({
    status: 400,
    responseText: '{"error":{"message":"invalid request: prompt is required"}}',
    configuredMaxRetries: undefined
  }),
  {
    maxRetries: 3,
    delayMs: [3000, 6000, 9000],
    reason: "http_transient"
  },
  "a business validation 400 must not be reclassified as a proxy outage"
);
assert.deepEqual(evaluateImageGenerationEndpointProbe({ status: 404, statusText: "Not Found" }), {
  passed: true,
  issue: "",
  startAction: "continue"
});
assert.deepEqual(
  evaluateImageGenerationEndpointProbe({
    errorName: "TypeError",
    errorMessage: "fetch failed",
    errorCauseCode: "ENOTFOUND"
  }),
  {
    passed: false,
    issue: "Image generation endpoint is not reachable from this Node runtime: TypeError: fetch failed; cause=ENOTFOUND",
    startAction: "continue"
  }
);
assert.deepEqual(
  evaluateSpecTemplateCompletion({
    filledSpecValues: 4,
    expectedSpecValues: 4,
    priceRows: 4,
    blankSpecValueInputs: 1
  }),
  { passed: true, issue: "" }
);
assert.deepEqual(
  evaluateSpecTemplateCompletion({
    filledSpecValues: 3,
    expectedSpecValues: 4,
    priceRows: 4,
    blankSpecValueInputs: 1
  }),
  { passed: true, issue: "" }
);
assert.deepEqual(
  evaluateSpecTemplateCompletion({
    filledSpecValues: 0,
    expectedSpecValues: 4,
    priceRows: 4,
    blankSpecValueInputs: 0
  }),
  { passed: true, issue: "" }
);
assert.deepEqual(
  evaluatePriceInventoryEntryRule({
    specIssue: "Spec module error detected: 该项为必填，请输入"
  }),
  {
    action: "block_until_spec_template_complete",
    issue: "Spec module error detected: 该项为必填，请输入"
  }
);
assert.equal(
  shouldRetryImageGenerationWithPolicyPrompt({
    responseOk: false,
    responseText: '{"error":{"code":"content_policy_violation"}}'
  }),
  true
);
assert.equal(
  shouldRetryImageGenerationWithPolicyPrompt({
    responseOk: false,
    responseText: '{"error":{"code":"billing"}}'
  }),
  false
);

const exactMaxTitle = "标".repeat(60);
const exactMaxTitleDecision = normalizeTitleForDoudian(exactMaxTitle);
assert.equal(exactMaxTitleDecision.title, exactMaxTitle);
assert.equal(exactMaxTitleDecision.changed, false);
assert.equal(exactMaxTitleDecision.originalLength, 120);
assert.equal(exactMaxTitleDecision.maxLength, 120);

const overMaxTitle = `${"留".repeat(60)}删`;
const overMaxTitleDecision = normalizeTitleForDoudian(overMaxTitle);
assert.equal(overMaxTitleDecision.title, "留".repeat(60));
assert.equal(overMaxTitleDecision.changed, true);
assert.equal(overMaxTitleDecision.originalLength, 122);
assert.equal(overMaxTitleDecision.maxLength, 120);

assert.equal(countTitleCharacters("ABC123"), 6);
assert.equal(countTitleCharacters("标题ABC"), 7);

assert.doesNotThrow(() =>
  assertGeneratedTitlesBelongToProduct({
    titles: ["官方正品补水保湿医用聚乙二醇护创敷料延草纲目"],
    genericName: "医用聚乙二醇护创敷料",
    productCategory: "医疗器械"
  })
);
assert.throws(
  () =>
    assertGeneratedTitlesBelongToProduct({
      titles: ["官方正品补水保湿舒奈美医用医用重组Ⅲ型人源化胶原蛋白软膏延草纲目"],
      genericName: "医用聚乙二醇护创敷料",
      productCategory: "医疗器械"
    }),
  /do not match current product genericName/
);

const missingPendingAsset = auditAutoListingContinuity({
  records: [
    record("rec-1", "/work/input/auto-listing/feishu-images/product-1.png"),
    record("rec-2", "/work/input/auto-listing/feishu-images/product-2.png")
  ],
  processedImages: ["/work/input/auto-listing/feishu-images/product-1.png"],
  existingFiles: [],
  discoveredRunImageCount: 1
});

assert.equal(missingPendingAsset.ok, false);
assert.ok(missingPendingAsset.errors.some((issue) => issue.code === "pending_white_image_missing"));

const underDiscoveredRun = auditAutoListingContinuity({
  records: [
    record("rec-1", "/work/input/auto-listing/feishu-images/product-1.png"),
    record("rec-2", "/work/input/auto-listing/feishu-images/product-2.png"),
    record("rec-3", "/work/input/auto-listing/feishu-images/product-3.png")
  ],
  processedImages: ["/work/input/auto-listing/feishu-images/product-1.png"],
  existingFiles: [
    "/work/input/auto-listing/feishu-images/product-2.png",
    "/work/input/auto-listing/feishu-images/product-3.png"
  ],
  discoveredRunImageCount: 1
});

assert.equal(underDiscoveredRun.ok, false);
assert.ok(underDiscoveredRun.errors.some((issue) => issue.code === "run_discovered_too_few_images"));

const resumeDiscoveredRun = auditAutoListingContinuity({
  records: [
    record("rec-1", "/work/input/auto-listing/feishu-images/product-1.png"),
    record("rec-2", "/work/input/auto-listing/feishu-images/product-2.png"),
    record("rec-3", "/work/input/auto-listing/feishu-images/product-3.png")
  ],
  processedImages: [],
  existingFiles: [
    "/work/input/auto-listing/feishu-images/product-1.png",
    "/work/input/auto-listing/feishu-images/product-2.png",
    "/work/input/auto-listing/feishu-images/product-3.png"
  ],
  discoveredRunImageCount: 1,
  expectedDiscoveredRunImageCount: 1
});

assert.equal(resumeDiscoveredRun.ok, true);
assert.equal(resumeDiscoveredRun.summary.expectedDiscoveredRunImageCount, 1);

function taskWithMainImages(generatedFiles) {
  return {
    taskId: "image-001",
    sequenceNo: 1,
    sourceImagePath: "/work/input/source.png",
    sourceImageName: "source.png",
    status: "main_images_generated",
    lastUpdatedAt: "2026-05-23T00:00:00.000Z",
    generatedProductFolders: [],
    notes: [],
    feishuProductRecord: record("rec-main", "/work/input/source.png"),
    mainImageArtifact: {
      promptFile: "/work/run/tasks/image-001/main-image-prompts.txt",
      generatedFiles,
      simulated: false
    }
  };
}

const completeGeneratedFiles = [1, 2].flatMap((promptIndex) =>
  [1, 2, 3, 4].map((imageIndex) => ({
    imageFile: `/work/shop/product-${promptIndex}-${imageIndex}.png`,
    rawImageFile: `/work/run/raw/generated-${promptIndex}-${imageIndex}.png`,
    productFolder: `/work/shop/product-${promptIndex}`,
    storeName: `shop-${promptIndex}`,
    promptIndex,
    promptWordFile: `/work/prompts/${promptIndex}.docx`
  }))
);

const generationOk = auditMainImageGeneration({
  tasks: [taskWithMainImages(completeGeneratedFiles)],
  existingFiles: completeGeneratedFiles.flatMap((item) => [item.imageFile, item.rawImageFile, item.productFolder]),
  expectedPromptCount: 2,
  expectedImagesPerPrompt: 4,
  simulateOnly: false
});

assert.equal(generationOk.ok, true);
assert.equal(generationOk.summary.auditedTaskCount, 1);
assert.equal(generationOk.summary.generatedImageCount, 8);

const generationCleanedOk = auditMainImageGeneration({
  tasks: [
    {
      ...taskWithMainImages(completeGeneratedFiles),
      status: "done",
      cleanupArtifact: {
        removedPaths: completeGeneratedFiles.flatMap((item) => [item.imageFile, item.rawImageFile, item.productFolder]),
        simulated: false
      }
    }
  ],
  existingFiles: [],
  expectedPromptCount: 2,
  expectedImagesPerPrompt: 4,
  simulateOnly: false
});

assert.equal(
  generationCleanedOk.ok,
  true,
  "Completed tasks with recorded cleanup must audit generation counts without requiring deleted transient files to remain on disk."
);

const generationCleanedPathReuseOk = auditMainImageGeneration({
  tasks: [
    {
      ...taskWithMainImages(completeGeneratedFiles),
      taskId: "image-cleaned-a",
      status: "done",
      cleanupArtifact: {
        removedPaths: completeGeneratedFiles.flatMap((item) => [item.imageFile, item.rawImageFile, item.productFolder]),
        simulated: false
      }
    },
    {
      ...taskWithMainImages(completeGeneratedFiles),
      taskId: "image-cleaned-b",
      status: "done",
      cleanupArtifact: {
        removedPaths: completeGeneratedFiles.flatMap((item) => [item.imageFile, item.rawImageFile, item.productFolder]),
        simulated: false
      }
    }
  ],
  existingFiles: [],
  expectedPromptCount: 2,
  expectedImagesPerPrompt: 4,
  simulateOnly: false
});

assert.equal(
  generationCleanedPathReuseOk.ok,
  true,
  "Sequential completed tasks may reuse the same shop output paths after cleanup; audit must not treat historical path reuse as concurrent overwrite risk."
);

assert.equal(
  inferResumeStartStepForTask({
    status: "shop_distributed",
    generatedProductFolders: ["/work/shop/product-1"],
    shopDistributionArtifact: { distributedFolders: ["/work/shop/product-1"], simulated: false }
  }),
  "published"
);
assert.equal(
  inferResumeStartStepForTask({
    status: "failed",
    error: {
      step: "titles_generated",
      message: "Refusing to generate paid titles while product folders already contain workbook(s): /work/shop/product-1 -> title.xlsx"
    },
    generatedProductFolders: ["/work/shop/product-1"]
  }),
  "published"
);
assert.equal(
  inferResumeStartStepForTask({
    status: "failed",
    error: {
      step: "published",
      message:
        "Publish failed for /work/shop/product-1: Platform SPU query page was not ready after navigation: Doudian login is required before publishing can continue."
    },
    generatedProductFolders: ["/work/shop/product-1"],
    shopDistributionArtifact: { distributedFolders: ["/work/shop/product-1"], simulated: false }
  }),
  "published",
  "Publishing interruptions after assets are distributed must resume at published and must not regenerate main images."
);
const canonicalResumeFolders = Array.from({ length: 20 }, (_, index) => `/shops/${String(index + 1).padStart(2, "0")}/product-${index + 1}`);
const canonicalRecoveryTasks = [
  { taskId: "image-001", status: "failed", error: { step: "published" }, publishArtifact: { results: [{}] } },
  { taskId: "image-002", status: "source_images_discovered" },
  { taskId: "image-003", status: "source_images_discovered" }
];
assert.equal(
  resolveCanonicalRecoveryTask({ tasks: canonicalRecoveryTasks, currentTaskId: undefined })?.taskId,
  "image-001",
  "Terminal recovery must resolve the unique failed task instead of taking the last pre-created pending task."
);
assert.equal(
  resolveCanonicalRecoveryTask({ tasks: canonicalRecoveryTasks, currentTaskId: "image-003" })?.taskId,
  "image-001",
  "A stale pending currentTaskId must not override the unique failed task with durable publish evidence."
);
assert.throws(
  () => resolveCanonicalRecoveryTask({
    tasks: [...canonicalRecoveryTasks, { taskId: "image-004", status: "failed", error: { step: "published" } }]
  }),
  /multiple failed tasks/,
  "Ambiguous terminal recovery evidence must fail closed."
);
const canonicalResumeManifest = canonicalResumeFolders.map((productFolder, index) => ({
  targetIdentity: {
    batchFingerprint: "batch-a",
    recordId: "record-a",
    taskId: "image-001",
    shopCode: String(index + 1).padStart(2, "0"),
    watermarkNo: index + 1
  },
  productFolder,
  status: index === 19 ? "pending" : "published",
  finalVerifyStatus: index === 19 ? "not_checked" : "publish_signal_confirmed"
}));
assert.deepEqual(
  resolveCanonicalResumeDecision({
    batchFingerprint: "batch-a",
    recordId: "record-a",
    taskId: "image-001",
    inferredArtifactStartStep: "source_images_discovered",
    productFolders: canonicalResumeFolders,
    expectedTargetCount: 20,
    manifestEntries: [
      ...canonicalResumeManifest,
      {
        ...canonicalResumeManifest[0],
        targetIdentity: { ...canonicalResumeManifest[0].targetIdentity, batchFingerprint: "wrong-batch" },
        productFolder: "/shops/wrong-batch/product"
      }
    ]
  }),
  {
    startStep: "published",
    resumeProductFolderNames: ["product-20"],
    source: "publish-manifest"
  },
  "The exact canonical manifest must be the sole authority when publish work remains."
);
assert.deepEqual(
  resolveCanonicalResumeDecision({
    batchFingerprint: "batch-a",
    recordId: "record-a",
    taskId: "image-001",
    inferredArtifactStartStep: "published",
    productFolders: canonicalResumeFolders,
    expectedTargetCount: 20,
    manifestEntries: canonicalResumeManifest.map((entry) =>
      entry.status === "pending"
        ? { ...entry, status: "skipped", finalVerifyStatus: "submit_rejected_exhausted", errorClass: "final_publish_submit_transient" }
        : entry
    )
  }),
  {
    startStep: "cleaned",
    resumeProductFolderNames: canonicalResumeFolders.map((folder) => folder.split("/").pop()),
    source: "publish-manifest"
  },
  "Complete canonical manifest coverage must advance to cleanup instead of reporting another publish failure."
);
assert.throws(
  () => resolveCanonicalResumeDecision({
    batchFingerprint: "batch-a",
    recordId: "record-a",
    taskId: "image-001",
    inferredArtifactStartStep: "published",
    productFolders: canonicalResumeFolders,
    manifestEntries: canonicalResumeManifest.slice(0, 19),
    expectedTargetCount: 20
  }),
  /coverage is incomplete/,
  "Partial canonical manifest coverage must fail closed instead of guessing a resume plan."
);
assert.deepEqual(
  resolveCanonicalResumeDecision({
    batchFingerprint: "batch-a",
    recordId: "record-a",
    taskId: "image-001",
    inferredArtifactStartStep: "published",
    productFolders: canonicalResumeFolders,
    manifestEntries: canonicalResumeManifest.slice(0, 9),
    canonicalPlanEntries: canonicalResumeManifest.map((entry) => ({
      targetIdentity: entry.targetIdentity,
      productFolder: entry.productFolder
    })),
    expectedTargetCount: 20
  }),
  {
    startStep: "published",
    resumeProductFolderNames: canonicalResumeFolders.slice(9).map((folder) => folder.split("/").pop()),
    source: "publish-plan+manifest"
  },
  "A complete immutable canonical plan must authorize the not-yet-attempted tail when login expires before the manifest reaches all targets."
);
assert.deepEqual(
  resolveCanonicalResumeDecision({
    batchFingerprint: "batch-a",
    recordId: "record-a",
    taskId: "image-001",
    inferredArtifactStartStep: "published",
    productFolders: canonicalResumeFolders,
    manifestEntries: canonicalResumeManifest.slice(0, 17).map((entry, index) =>
      index === 16 ? { ...entry, status: "failed", finalVerifyStatus: "not_checked" } : entry
    ),
    canonicalPlanEntries: canonicalResumeManifest.slice(1).map((entry) => ({
      targetIdentity: entry.targetIdentity,
      productFolder: entry.productFolder
    })),
    expectedTargetCount: 20
  }),
  {
    startStep: "published",
    resumeProductFolderNames: canonicalResumeFolders.slice(16).map((folder) => folder.split("/").pop()),
    source: "publish-plan+manifest"
  },
  "A canonical manifest and a previously narrowed resume plan may recover only when their verified identity union still covers all targets exactly."
);
assert.throws(
  () => resolveCanonicalResumeDecision({
    batchFingerprint: "batch-a",
    recordId: "record-a",
    taskId: "image-001",
    inferredArtifactStartStep: "published",
    productFolders: canonicalResumeFolders,
    manifestEntries: canonicalResumeManifest.slice(0, 9),
    canonicalPlanEntries: canonicalResumeManifest.slice(0, 19),
    expectedTargetCount: 20
  }),
  /coverage is incomplete/,
  "A partial manifest must remain fail-closed when its immutable canonical plan is also incomplete."
);
assert.equal(
  inferResumeStartStepForTask({
    status: "published",
    generatedProductFolders: ["/work/shop/product-1", "/work/shop/product-2"],
    shopDistributionArtifact: { distributedFolders: ["/work/shop/product-1", "/work/shop/product-2"], simulated: false },
    publishArtifact: {
      results: [
        {
          ok: false,
          status: "failed",
          finalVerifyStatus: "needs_manual_review"
        }
      ]
    }
  }),
  "published",
  "Interrupted published-stage tasks without safe publish results must resume publishing, not cleanup."
);
assert.equal(
  inferResumeStartStepForTask({
    status: "published",
    generatedProductFolders: ["/work/shop/product-1"],
    shopDistributionArtifact: { distributedFolders: ["/work/shop/product-1"], simulated: false },
    publishArtifact: {
      results: [
        {
          ok: true,
          status: "published",
          finalVerifyStatus: "publish_signal_confirmed"
        }
      ]
    }
  }),
  "cleaned",
  "Published-stage tasks may advance to cleanup only after every distributed folder has a safe publish signal."
);
assert.equal(
  inferResumeStartStepForTask({
    status: "failed",
    error: {
      step: "published",
      message:
        "Publish preflight failed: /work/shop/product-1 -> No main image candidate matched current shop watermark: 延草纲目药品专营店"
    },
    generatedProductFolders: ["/work/shop/product-1"]
  }),
  "main_images_generated",
  "Resume jobs must rebuild product folders when staged images carry the wrong shop watermark."
);
assert.equal(
  inferResumeStartStepForTask({
    status: "failed",
    error: {
      step: "poster_prompts_generated",
      message: "DeepSeek returned latest content but it is not usable for the current product."
    },
    sellingPointArtifact: {
      sellingPointText: "用户认知名为医用唇部保湿凝胶，产品通用名称为医用聚乙二醇润护敷料。"
    }
  }),
  "selling_points_loaded",
  "Resume jobs must reload Feishu selling points before rerunning DeepSeek because generated resume jobs do not carry task artifacts."
);

const generationMissingPromptImage = auditMainImageGeneration({
  tasks: [taskWithMainImages(completeGeneratedFiles.slice(0, 7))],
  existingFiles: completeGeneratedFiles.flatMap((item) => [item.imageFile, item.rawImageFile, item.productFolder]),
  expectedPromptCount: 2,
  expectedImagesPerPrompt: 4,
  simulateOnly: false
});

assert.equal(generationMissingPromptImage.ok, false);
assert.ok(generationMissingPromptImage.errors.some((issue) => issue.code === "main_image_prompt_count_mismatch"));

const generationDuplicate = auditMainImageGeneration({
  tasks: [
    taskWithMainImages([
      completeGeneratedFiles[0],
      { ...completeGeneratedFiles[1], imageFile: completeGeneratedFiles[0].imageFile },
      ...completeGeneratedFiles.slice(2)
    ])
  ],
  existingFiles: completeGeneratedFiles.flatMap((item) => [item.imageFile, item.rawImageFile, item.productFolder]),
  expectedPromptCount: 2,
  expectedImagesPerPrompt: 4,
  simulateOnly: false
});

assert.equal(generationDuplicate.ok, false);
assert.ok(generationDuplicate.errors.some((issue) => issue.code === "main_image_duplicate_file"));

const generationNonSquareDimensions = new Map(
  completeGeneratedFiles.flatMap((item) => [
    [path.resolve(item.imageFile), { width: 1254, height: 1254 }],
    [path.resolve(item.rawImageFile), { width: 1254, height: 1254 }]
  ])
);
generationNonSquareDimensions.set(path.resolve(completeGeneratedFiles[7].rawImageFile), {
  width: 1199,
  height: 1312
});
const generationNonSquare = auditMainImageGeneration({
  tasks: [taskWithMainImages(completeGeneratedFiles)],
  existingFiles: completeGeneratedFiles.flatMap((item) => [item.imageFile, item.rawImageFile, item.productFolder]),
  imageDimensions: generationNonSquareDimensions,
  expectedPromptCount: 2,
  expectedImagesPerPrompt: 4,
  simulateOnly: false
});
assert.equal(generationNonSquare.ok, false);
assert.ok(generationNonSquare.errors.some((issue) => issue.code === "main_image_not_square"));

const publishSubsetOk = auditPublishMainImageSubset({
  taskId: "image-001",
  generatedFiles: [completeGeneratedFiles[4]],
  expectedProductFolders: [completeGeneratedFiles[4].productFolder],
  existingFiles: [
    completeGeneratedFiles[4].imageFile,
    completeGeneratedFiles[4].rawImageFile,
    completeGeneratedFiles[4].productFolder
  ],
  imageDimensions: new Map([
    [path.resolve(completeGeneratedFiles[4].imageFile), { width: 1312, height: 1312 }],
    [path.resolve(completeGeneratedFiles[4].rawImageFile), { width: 1312, height: 1312 }]
  ]),
  simulateOnly: false
});
assert.equal(
  publishSubsetOk.ok,
  true,
  "A known publish-stage resume may validate exactly its remaining target subset without pretending it regenerated all 20 images."
);
const publishSubsetMissing = auditPublishMainImageSubset({
  taskId: "image-001",
  generatedFiles: [completeGeneratedFiles[4]],
  expectedProductFolders: [completeGeneratedFiles[4].productFolder, "/work/shop/product-3"],
  existingFiles: [
    completeGeneratedFiles[4].imageFile,
    completeGeneratedFiles[4].rawImageFile,
    completeGeneratedFiles[4].productFolder
  ],
  imageDimensions: new Map([
    [path.resolve(completeGeneratedFiles[4].imageFile), { width: 1312, height: 1312 }],
    [path.resolve(completeGeneratedFiles[4].rawImageFile), { width: 1312, height: 1312 }]
  ]),
  simulateOnly: false
});
assert.equal(publishSubsetMissing.ok, false);
assert.ok(publishSubsetMissing.errors.some((issue) => issue.code === "publish_main_image_target_mismatch"));

const publishTask = {
  taskId: "image-001",
  sequenceNo: 1,
  sourceImagePath: "/work/input/source.png",
  sourceImageName: "source.png",
  status: "published",
  lastUpdatedAt: "2026-05-23T00:00:00.000Z",
  generatedProductFolders: ["/work/shop/product-1"],
  notes: [],
  shopDistributionArtifact: {
    distributedFolders: ["/work/shop/product-1"],
    simulated: false
  },
  publishArtifact: {
    results: [],
    simulated: false
  }
};

const publishOk = auditPublishCoverage({
  tasks: [publishTask],
  manifestEntries: [
    {
      productFolder: "/work/shop/product-1",
      runtimeKey: "shop__product-1",
      shopFolder: "/work/shop",
      watermarkNo: 1,
      status: "published",
      finalVerifyStatus: "publish_signal_confirmed",
      message: "ok",
      updatedAt: "2026-05-23T00:00:00.000Z"
    }
  ]
});

assert.equal(publishOk.ok, true);
assert.equal(publishOk.summary.expectedPublishCount, 1);
assert.equal(publishOk.summary.safelyPublishedCount, 1);

const canonicalCoverageKeys = buildCanonicalPublishTargetKeys({
  batchFingerprint: "batch-coverage",
  tasks: [{ taskId: "task-coverage", recordId: "record-coverage", productCategory: "保健食品" }]
});
const canonicalCoverage = auditPublishCoverage({
  batchFingerprint: "batch-coverage",
  tasks: [{
    ...publishTask,
    taskId: "task-coverage",
    feishuProductRecord: { recordId: "record-coverage", productCategory: "保健食品" },
    shopDistributionArtifact: {
      distributedFolders: Array.from({ length: 13 }, (_, index) => `/work/shop/product-${index + 8}`),
      simulated: false
    }
  }],
  manifestEntries: canonicalCoverageKeys.map((targetKey, index) => ({
    targetKey,
    targetIdentity: {
      batchFingerprint: "batch-coverage",
      recordId: "record-coverage",
      taskId: "task-coverage",
      shopCode: String(index + 1).padStart(2, "0"),
      watermarkNo: index + 1
    },
    productFolder: `/work/shop/product-${index + 1}`,
    runtimeKey: targetKey,
    shopFolder: `/work/shop/${String(index + 1).padStart(2, "0")}`,
    watermarkNo: index + 1,
    status: "published",
    finalVerifyStatus: "publish_signal_confirmed",
    message: "safe",
    updatedAt: "2026-05-23T00:00:00.000Z"
  }))
});
assert.equal(canonicalCoverage.ok, true);
assert.equal(canonicalCoverage.summary.expectedPublishCount, 20);
assert.equal(canonicalCoverage.summary.safelyPublishedCount, 20);

const publishMissing = auditPublishCoverage({
  tasks: [publishTask],
  manifestEntries: []
});

assert.equal(publishMissing.ok, false);
assert.ok(publishMissing.errors.some((issue) => issue.code === "publish_result_missing"));

const publishInProgress = auditPublishCoverage({
  tasks: [publishTask],
  manifestEntries: [
    {
      productFolder: "/work/shop/product-1",
      runtimeKey: "shop__product-1",
      shopFolder: "/work/shop",
      watermarkNo: 1,
      status: "pending",
      finalVerifyStatus: "not_checked",
      message: "basic_info_fill_attempt: 1",
      updatedAt: "2026-05-23T00:00:00.000Z"
    }
  ],
  allowInProgress: true
});

assert.equal(publishInProgress.ok, true);
assert.equal(publishInProgress.summary.safelyPublishedCount, 0);
assert.equal(publishInProgress.summary.inProgressPublishCount, 1);
assert.equal(publishInProgress.errors.length, 0);

const publishLoginWait = auditPublishCoverage({
  tasks: [publishTask],
  manifestEntries: [
    {
      productFolder: "/work/shop/product-1",
      runtimeKey: "shop__product-1",
      shopFolder: "/work/shop",
      watermarkNo: 1,
      status: "failed",
      finalVerifyStatus: "not_checked",
      errorClass: "doudian_login_required",
      message: "Doudian login required before any submit attempt.",
      updatedAt: "2026-05-23T00:00:00.000Z"
    }
  ],
  allowInProgress: true
});
assert.equal(publishLoginWait.ok, true);
assert.equal(publishLoginWait.summary.inProgressPublishCount, 1);
assert.equal(publishLoginWait.errors.length, 0);

const publishVerifiedPreSubmitFailure = auditPublishCoverage({
  tasks: [publishTask],
  manifestEntries: [
    {
      productFolder: "/work/shop/product-1",
      runtimeKey: "shop__product-1",
      shopFolder: "/work/shop",
      watermarkNo: 1,
      status: "failed",
      finalVerifyStatus: "not_checked",
      errorClass: "platform_spu_publish_navigation_failed",
      message: "Platform SPU publish navigation failed before click.",
      updatedAt: "2026-05-23T00:00:00.000Z"
    }
  ],
  allowInProgress: true
});
assert.equal(publishVerifiedPreSubmitFailure.ok, true, "A durable pre-submit failure with exact recovery must audit as pending, not unsafe");
assert.equal(publishVerifiedPreSubmitFailure.summary.inProgressPublishCount, 1);
assert.equal(publishVerifiedPreSubmitFailure.errors.length, 0);

const publishTerminalMissing = auditPublishCoverage({
  tasks: [publishTask],
  manifestEntries: [],
  allowInProgress: false
});

assert.equal(publishTerminalMissing.ok, false);
assert.ok(publishTerminalMissing.errors.some((issue) => issue.code === "publish_result_missing"));
