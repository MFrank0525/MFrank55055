import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readLatestTaskProgressEvent } from "../dist/src/autolist/progress-events.js";
import { buildFeishuSellingPointText } from "../dist/src/autolist/selling-point-rules.js";
import {
  auditAutoListingContinuity,
  auditCompletedBatchResidue,
  summarizeFeishuBatchProgress,
  auditMainImageGeneration,
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
  shouldRefreshAutoListingChildProgressSeenAt,
  resolveAutoListingControllerChildStallTimeoutMs,
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
import {
  shouldFailAutoListingControllerStatusForFeishuCacheInvalid,
  shouldPreserveAutoListingControllerCompletedStatusForFeishuCacheInvalid
} from "../dist/src/autolist/controller-cache-status-rules.js";
import { buildFeishuBatchFingerprint, canResumeFeishuBatchArtifacts } from "../dist/src/autolist/feishu-batch-rules.js";
import { hasSharedFeishuWhiteBackgroundLocalFile, resolvePendingFeishuProductSourceImagesFromRecords } from "../dist/src/autolist/feishu-products.js";
import { appendProcessedImages, clearProcessedImagesForBatch, migrateLegacyProcessedImagesToBatch, readProcessedImages } from "../dist/src/autolist/file-batch.js";
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
  shouldInvalidatePublishedResumeWithoutProductFolders,
  shouldReplaceStaleResumeStartStep
} from "../dist/src/autolist/resume-rules.js";
import {
  hasIncompleteFixedMainImageRoundFiles,
  summarizeReusableTaskArtifacts
} from "../dist/src/autolist/resume-artifacts.js";
import { recoverDistributedFoldersFromShopRoot } from "../dist/src/autolist/resume.js";
import { isProductFullyProcessed } from "../dist/src/autolist/processed-completion-rules.js";
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
  evaluateSpecTemplateCompletion,
  isUploadPlaceholderGraphicContext,
  evaluateShopSwitchMenuState,
  shouldRetryPublishFailure,
  shouldStopPublishBatchAfterFailure,
  evaluatePublishResult
} from "../dist/src/business/publish-from-spu/publish-rules.js";
import { publishDistributedProducts, selectLatestFailedPublishResult } from "../dist/src/autolist/publish.js";

const hermesRunnerSource = fs.readFileSync("src/cli/auto-listing-controller.ts", "utf8");
const hermesSupervisorSource = fs.readFileSync("src/cli/auto-listing-supervisor.ts", "utf8");
const orchestratorSource = fs.readFileSync("src/autolist/orchestrator.ts", "utf8");
const processedCompletionRulesSource = fs.readFileSync("src/autolist/processed-completion-rules.ts", "utf8");
const publishSource = fs.readFileSync("src/autolist/publish.ts", "utf8");
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
  /verifyPublishedProductInDoudianList[\s\S]*finalVerifyStatus === "submit_accepted_unconfirmed"[\s\S]*finalVerifyStatus:\s*"list_verified"/,
  "Auto-listing publish must resolve uncertain final submits by read-only Doudian 全部 tab full-title verification before treating the target as unsafe"
);
assert.match(
  publishSource,
  /listVerification\?\.found === false[\s\S]*Retrying publish after Doudian list verification returned no product/,
  "Auto-listing publish may only replay a final-submit-uncertain target after the Doudian 全部 tab full-title verification returns no product"
);
assert.match(
  publishSource,
  /existingDecision\.finalVerifyStatus === "submit_accepted_unconfirmed"[\s\S]*verifyPublishedProductInDoudianList[\s\S]*finalVerifyStatus:\s*"list_verified"[\s\S]*continue;/,
  "Auto-listing resume must verify an existing uncertain final submit in the Doudian 全部 tab before replaying publish"
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
  /const candidates = resolveSpecTemplateKeywordCandidates\(keyword\);[\s\S]*const clickTarget = await findSpecTemplateDropdownClickTargetOnPage\(page\);[\s\S]*await clickTarget\.click\(\{ timeout: 1000 \}\);[\s\S]*const visibleClickedText = await clickSpecTemplateOptionByDomStructure\(page, candidates\)[\s\S]*return visibleClickedText;[\s\S]*const input = await findSpecTemplateInputInFieldRootOnPage\(page\);[\s\S]*await clickTarget\.click\(\{ timeout: 1000 \}\);[\s\S]*await input\.fill\(candidate\)[\s\S]*await page\.waitForTimeout\(80\);[\s\S]*clickSpecTemplateOptionByDomStructure\(page, candidates\)[\s\S]*return clickedText;/,
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
  /shouldRefreshAutoListingChildProgressSeenAt/,
  "supervisor watchdog must not treat repeated provider queue heartbeats as business progress"
);
assert.equal(
  shouldRefreshAutoListingChildProgressSeenAt({
    activeStep: "main_images_generated",
    activeMessage: "Prompt 3/5: Image 4: videos-base64 task task_qn0 status queued 0."
  }),
  false,
  "videos-base64 queued 0 is an external-service heartbeat, not business progress"
);
assert.equal(
  shouldRefreshAutoListingChildProgressSeenAt({
    activeStep: "main_images_generated",
    activeMessage: "Prompt 3/5: Image 4: videos-base64 task task_qn0 status pending 0."
  }),
  false,
  "videos-base64 pending 0 is an external-service heartbeat, not business progress"
);
assert.equal(
  shouldRefreshAutoListingChildProgressSeenAt({
    activeStep: "main_images_generated",
    activeMessage: "Prompt 3/5: Image 4: videos-base64 task task_qn0 status completed 100."
  }),
  true,
  "completed provider status is real progress"
);
assert.equal(
  shouldRefreshAutoListingChildProgressSeenAt({
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
  /preflight\.json[\s\S]*simulateOnly[\s\S]*latestRunState\(resolved\.runtimeRootDir, resolved\.simulateOnly, batchFingerprint\)/,
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
  /canResumeFeishuBatchArtifacts/,
  "The orchestrator must independently reject stale or unscoped resume jobs before using their artifacts"
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
  /isProductFullyProcessed[\s\S]*appendProcessedImages[\s\S]*removePaidImageProductLedger/,
  "A safely completed product must be atomically marked processed before its project-owned paid-image ledger is deleted"
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
  /findLatestInterruptedStateForResume\(\)[\s\S]*summarizeState\([\s\S]*interrupted[\s\S]*runtimeDir[\s\S]*summarizeImageGenerationProgress/,
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
  /publishResumeNeedsWork[\s\S]*startStep === "published"[\s\S]*resumeProductFolderCount > 0[\s\S]*countSafelyPublishedManifestEntries\(resumeRuntimeDir\) < resumeProductFolderCount/,
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
  "飞书产品 4/4；任务链已完成",
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
  summary: "当前商品：延草纲目宝元堂痛风医用远红外治疗凝胶，发布 20/20，店铺 10/10",
  realtimeProgress: groupedHermesRealtimeProgress,
  feishuCurrentProduct: {
    current: 4,
    total: 7,
    userCognitionName: "宝元堂痛风凝胶"
  },
  publishProgress: {
    safelyPublished: 39,
    total: 40,
    failed: 0,
    progressText: "当前商品：延草纲目宝元堂痛风医用远红外治疗凝胶，发布 20/20，店铺 10/10",
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
  /^飞书产品 4\/7；/,
  "Hermes progress message must lead with the current Feishu table product ordinal"
);
assert.match(
  String(groupedHermesPayload.hermesProgress?.message || ""),
  /当前商品：.*发布 20\/20，店铺 10\/10/,
  "Hermes progress message must use the current product-group progress text"
);
const publishProgressOnlyHermesPayload = resolveAutoListingControllerHermesStatusPayload({
  status: "running",
  publishProgress: {
    progressText: "当前商品：延草纲目宝元堂腱鞘医用喷雾，发布 17/20，店铺 9/10，最近产物：publish-page-spec-editor.png",
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
    userCognitionName: "宝元堂腱鞘部位喷剂"
  }
});
assert.deepEqual(
  publishProgressOnlyHermesPayload.hermesProgress,
  {
    source: "publish_progress",
    message: "飞书产品 6/6；当前商品：延草纲目宝元堂腱鞘医用喷雾，发布 17/20，店铺 9/10，最近产物：规格编辑截图",
    key: "publish_progress|延草纲目宝元堂腱鞘医用喷雾|17|20|9|10|0"
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
    progressText: "当前商品：延草纲目测试品，发布 11/20，店铺 6/10，最近产物：publish-page-basic-filled.png"
  }
}).hermesProgress?.message;
assert.equal(
  dedupedHermesPayloadMessage,
  "当前商品：延草纲目测试品，发布 11/20，店铺 6/10，最近产物：基础信息截图",
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
  "飞书产品 5/6；最近产物：基础信息截图",
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
    progressText: "当前商品：延草纲目测试品，发布 11/20，店铺 6/10",
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
  "当前商品：延草纲目测试品，发布 11/20，店铺 6/10",
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
  /发布 2\/20｜店铺 1\/10｜飞书产品 3\/6/,
  "Hermes compact text must label watermark/publish ordinal as publish progress and use the current Feishu record ordinal"
);
assert.doesNotMatch(
  hermesPublishOrdinalText,
  /产品 2\/20｜店铺 1\/10｜飞书产品 1\/6/,
  "Hermes compact text must not confuse publish target ordinal with Feishu product progress"
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
  shouldRetryPublishFailure(basicFieldLocatorClass, 0),
  true,
  "basic-info field readiness failures are transient publish-page failures and must retry with a fresh SPU-prefilled page"
);
const detailQualificationClass = classifyPublishFailure(
  "Sequential publish flow stopped: 图文信息模块未完成。Qualification detail upload was not acknowledged per file. expected=2; acknowledged=0; baseline=6; final=6"
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
  resolveAutoListingControllerChildStallTimeoutMs({
    defaultTimeoutMs: 12 * 60 * 1000,
    activeStep: "published",
    activeMessage: "Retrying publish for 延草纲目医用面部冷敷贴水印03 (02延草纲目药品专营店): page_context_lost; attempt 1"
  }),
  4 * 60 * 1000
);
assert.equal(
  resolveAutoListingControllerChildStallTimeoutMs({
    defaultTimeoutMs: 12 * 60 * 1000,
    activeStep: "main_images_generated",
    activeMessage: "Prompt 4/5: Image 2: transient transport error during initial; retry 6/8."
  }),
  12 * 60 * 1000
);
assert.equal(
  resolveAutoListingControllerChildStallTimeoutMs({
    defaultTimeoutMs: 12 * 60 * 1000,
    activeStep: "main_images_generated",
    activeMessage: "Prompt 5/5: Image 4: videos-base64 task task_queued status queued 0."
  }),
  3 * 60 * 1000,
  "The supervisor must let the provider's three-minute accepted-task poll deadline finish before declaring a queue stall"
);

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

const pendingFeishuSourceImages = resolvePendingFeishuProductSourceImagesFromRecords({
  records: [
    record("rec-1", "/work/input/auto-listing/feishu-images/product-1.png"),
    record("rec-2", "/work/input/auto-listing/feishu-images/product-2.png")
  ],
  processedImages: ["/work/input/auto-listing/feishu-images/product-1.png"],
  fileExists: (filePath) => filePath.endsWith("product-2.png")
});
assert.deepEqual(pendingFeishuSourceImages, [path.resolve("/work/input/auto-listing/feishu-images/product-2.png")]);

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
appendProcessedImages(legacyManifest, ["/work/input/auto-listing/feishu-images/legacy-product.png"]);
assert.equal(migrateLegacyProcessedImagesToBatch(legacyManifest, repeatedBatchAFingerprint), true);
assert.equal(readProcessedImages(legacyManifest, repeatedBatchAFingerprint).has("/work/input/auto-listing/feishu-images/legacy-product.png"), true);
assert.equal(readProcessedImages(legacyManifest, repeatedBatchBFingerprint).has("/work/input/auto-listing/feishu-images/legacy-product.png"), false);

const appendMigratedManifest = path.join(tempDir, "append-migrated-processed-images.json");
appendProcessedImages(appendMigratedManifest, ["/work/input/auto-listing/feishu-images/current-batch-first.png"]);
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
    running: true,
    publishProgressAvailable: true,
    currentTaskStatus: "published",
    stateProgressTimestamp: "2026-05-28T02:12:13.117Z",
    publishProgressTimestamp: "2026-05-28T02:13:13.117Z"
  }),
  true
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
    "状态：失败｜发布 15/20｜店铺 8/10｜飞书产品 2/3",
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
  "状态：运行中｜提交槽位 20/20｜飞书产品 1/7",
  "A submission slot index must not be reported as a completed main-image count before ledger completion is available"
);
assert.deepEqual(
  compactImageGenerationStatus.split("\n"),
  [
    "状态：运行中｜主图 15/20｜飞书产品 0/4",
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
    "状态：运行中｜主图 11/20｜飞书产品 4/4",
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
    "状态：运行中｜发布 11/20｜店铺 6/10｜飞书产品 0/2",
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
    "状态：运行中｜发布 20/20｜店铺 10/10｜飞书产品 0/0",
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
    "状态：失败｜发布 15/20｜店铺 8/10｜飞书产品 2/3",
    "商品：医用面部生物膜",
    "原因：标品检索页控件未加载完整，已停止，可续跑。"
  ],
  "AutoListingController text status must summarize Platform SPU query readiness failures without long local paths"
);

const groupedPublishProgress = resolveAutoListingControllerPublishGroupProgress({
  entries: [
    ...Array.from({ length: 20 }, (_, index) => ({
      productFolder: `/shops/${String(Math.floor(index / 2) + 1).padStart(2, "0")}店/延草纲目医用疼痛凝胶水印${String(index + 1).padStart(2, "0")}`,
      shopFolder: `/shops/${String(Math.floor(index / 2) + 1).padStart(2, "0")}店`,
      watermarkNo: index + 1,
      status: "published",
      finalVerifyStatus: "publish_signal_confirmed",
      updatedAt: `2026-06-13T20:${String(index).padStart(2, "0")}:00.000Z`
    })),
    ...Array.from({ length: 20 }, (_, index) => ({
      productFolder: `/shops/${String(Math.floor(index / 2) + 1).padStart(2, "0")}店/延草纲目医用重组胶原蛋白护理软膏水印${String(index + 1).padStart(2, "0")}`,
      shopFolder: `/shops/${String(Math.floor(index / 2) + 1).padStart(2, "0")}店`,
      watermarkNo: index + 1,
      status: "published",
      finalVerifyStatus: "publish_signal_confirmed",
      updatedAt: `2026-06-13T21:${String(index).padStart(2, "0")}:00.000Z`
    })),
    ...Array.from({ length: 20 }, (_, index) => ({
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
    productName: "延草纲目遠紅外治療貼",
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
  compactCompletedGroupedStatus.split("\n")[0],
  "状态：完成｜发布 20/20｜店铺 10/10｜飞书产品 4/5",
  "Hermes-facing compact text must not expose cumulative publish totals such as 60/60"
);
assert.equal(/发布 60\/60/.test(compactCompletedGroupedStatus), false);

const partialManifestWithFullPublishPlanProgress = resolveAutoListingControllerPublishGroupProgress({
  entries: Array.from({ length: 9 }, (_, index) => ({
    productFolder: `/shops/${String(Math.floor(index / 2) + 1).padStart(2, "0")}店/延草纲目宝元堂痛风医用远红外治疗凝胶水印${String(index + 1).padStart(2, "0")}`,
    shopFolder: `/shops/${String(Math.floor(index / 2) + 1).padStart(2, "0")}店`,
    watermarkNo: index + 1,
    status: index === 8 ? "pending" : "published",
    finalVerifyStatus: index === 8 ? "not_checked" : "publish_signal_confirmed",
    updatedAt: `2026-06-14T03:${String(index).padStart(2, "0")}:00.000Z`
  })),
  planEntries: Array.from({ length: 20 }, (_, index) => ({
    productFolder: `/shops/${String(Math.floor(index / 2) + 1).padStart(2, "0")}店/延草纲目宝元堂痛风医用远红外治疗凝胶水印${String(index + 1).padStart(2, "0")}`,
    runtimeKey: `${String(Math.floor(index / 2) + 1).padStart(2, "0")}店__延草纲目宝元堂痛风医用远红外治疗凝胶水印${String(index + 1).padStart(2, "0")}`
  })),
  activeRuntimeKey: "05店__延草纲目宝元堂痛风医用远红外治疗凝胶水印09"
});
assert.deepEqual(
  partialManifestWithFullPublishPlanProgress,
  {
    productName: "延草纲目宝元堂痛风医用远红外治疗凝胶",
    productIndex: 9,
    productTotal: 20,
    shopName: "05店",
    shopIndex: 5,
    shopTotal: 10,
    failed: 0
  },
  "AutoListingController publish display must use the full publish plan for shop total instead of currently touched shops"
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
      productFolder: `/shops/01延草纲目大药房专营店/延草纲目远红外磁疗舒痛贴水印${String(index + 1).padStart(2, "0")}`,
      shopFolder: "/shops/01延草纲目大药房专营店",
      runtimeKey: `01延草纲目大药房专营店__延草纲目远红外磁疗舒痛贴水印${String(index + 1).padStart(2, "0")}`,
      watermarkNo: index + 1,
      status: "published",
      finalVerifyStatus: "publish_signal_confirmed",
      updatedAt: `2026-06-18T16:1${index + 4}:00.000Z`
    })),
    {
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
    productName: "延草纲目远红外磁疗舒痛贴",
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
  "状态：运行中｜发布 3/20｜店铺 2/10｜飞书产品 1/4",
  "Hermes compact status must not display historical future failures while an earlier watermark is actively being retried"
);
assert.doesNotMatch(compactResumedPublishWithHistoricalFutureFailuresStatus, /失败项|20\/20|10\/10/);
const failedMiddleWithLaterPublishedProgress = resolveAutoListingControllerPublishGroupProgress({
  entries: [
    ...Array.from({ length: 15 }, (_, index) => ({
      productFolder: `/shops/${String(Math.floor(index / 2) + 1).padStart(2, "0")}店/延草纲目遠紅外治療貼水印${String(index + 1).padStart(2, "0")}`,
      shopFolder: `/shops/${String(Math.floor(index / 2) + 1).padStart(2, "0")}店`,
      watermarkNo: index + 1,
      status: "published",
      finalVerifyStatus: "publish_signal_confirmed",
      updatedAt: `2026-06-15T01:${String(index).padStart(2, "0")}:00.000Z`
    })),
    {
      productFolder: "/shops/08店/延草纲目遠紅外治療貼水印16",
      shopFolder: "/shops/08店",
      watermarkNo: 16,
      status: "failed",
      finalVerifyStatus: "needs_manual_review",
      updatedAt: "2026-06-15T01:16:00.000Z"
    },
    ...Array.from({ length: 4 }, (_, index) => ({
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
    productName: "延草纲目遠紅外治療貼",
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
  publishFailed: failedMiddleWithLaterPublishedProgress.failed,
  publishFailedWatermarkNo: failedMiddleWithLaterPublishedProgress.failedWatermarkNo,
  publishLatestAttemptedWatermarkNo: failedMiddleWithLaterPublishedProgress.latestAttemptedWatermarkNo,
  feishuCompleted: 0,
  feishuTotal: 4
});
assert.deepEqual(
  compactFailedMiddleStatus.split("\n"),
  [
    "状态：失败｜发布 20/20｜店铺 10/10｜失败项 水印16｜飞书产品 0/4",
    "商品：延草纲目遠紅外治療貼",
    "原因：价格库存读回校验失败，已停止；需重试失败水印，三次仍失败则人工处理。"
  ],
  "Hermes compact status must not report a failed middle watermark as the latest publish position"
);
const reviewMiddleWithLaterPublishedProgress = resolveAutoListingControllerPublishGroupProgress({
  entries: [
    ...Array.from({ length: 12 }, (_, index) => ({
      productFolder: `/shops/${String(Math.floor(index / 2) + 1).padStart(2, "0")}店/延草纲目胶原蛋白敷料水印${String(index + 1).padStart(2, "0")}`,
      shopFolder: `/shops/${String(Math.floor(index / 2) + 1).padStart(2, "0")}店`,
      watermarkNo: index + 1,
      status: "published",
      finalVerifyStatus: "publish_signal_confirmed",
      updatedAt: `2026-06-16T01:${String(index).padStart(2, "0")}:00.000Z`
    })),
    {
      productFolder: "/shops/07店/延草纲目胶原蛋白敷料水印13",
      shopFolder: "/shops/07店",
      watermarkNo: 13,
      status: "failed",
      finalVerifyStatus: "submit_accepted_unconfirmed",
      errorClass: "final_publish_state_uncertain",
      updatedAt: "2026-06-16T01:13:00.000Z"
    },
    ...Array.from({ length: 5 }, (_, index) => ({
      productFolder: `/shops/${String(Math.floor((index + 13) / 2) + 1).padStart(2, "0")}店/延草纲目胶原蛋白敷料水印${String(index + 14).padStart(2, "0")}`,
      shopFolder: `/shops/${String(Math.floor((index + 13) / 2) + 1).padStart(2, "0")}店`,
      watermarkNo: index + 14,
      status: "published",
      finalVerifyStatus: "publish_signal_confirmed",
      updatedAt: `2026-06-16T01:${String(index + 14).padStart(2, "0")}:00.000Z`
    }))
  ]
});
assert.equal(reviewMiddleWithLaterPublishedProgress.failed, 0);
assert.equal(reviewMiddleWithLaterPublishedProgress.review || 0, 0);
assert.equal(reviewMiddleWithLaterPublishedProgress.reviewWatermarkNo || 0, 0);
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
  /飞书产品 待确认/,
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
  publishFailedWatermarkNo: 16,
  feishuCompleted: 0,
  feishuTotal: 4
});
assert.deepEqual(
  compactBlankSpecStatus.split("\n"),
  [
    "状态：失败｜发布 20/20｜店铺 10/10｜失败项 水印16｜飞书产品 0/4",
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
  "状态：正在安全暂停｜发布 15/20｜店铺 8/10｜飞书产品 0/1\n当前：延草纲目万通鉴筋骨痛膏贴\n进度：项目已收到手动暂停请求；任务会在安全边界停止并保留当前产物。继续上架会清除暂停信号并从安全断点续跑。",
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
  ["状态：待继续｜飞书产品 0/7", "进度：当前飞书批次仍有待处理产品。"],
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
  statusMessage: "规格模板未找到等价项：买二送一/买2送1/2送1",
  statusTimestamp: "2026-06-21T22:22:12.400Z",
  publishLogTimestamp: "2026-06-21T22:18:39.022Z",
  publishLogMessage: "发布模块：图文信息（07延草纲目健康护理专营店）"
});
assert.equal(terminalPublishFailureRealtimeProgress?.source, "status");
assert.match(terminalPublishFailureRealtimeProgress?.message || "", /规格模板未找到等价项/);
assert.equal(
  compactAutoListingTerminalFailureMessage(
    "Publish failed for /shops/07店/延草纲目商品-水印14: Sequential publish flow stopped: 价格库存模块未完成。No visible spec template dropdown option matched controlled aliases: 买二送一/买2送1/2送1"
  ),
  "Sequential publish flow stopped: 价格库存模块未完成。No visible spec template dropdown option matched controlled aliases: 买二送一/买2送1/2送1",
  "Terminal feedback must remove long local paths before truncation so Hermes receives the real failure reason"
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
    publishFailed: 1,
    publishFailedWatermarkNo: 18,
    feishuCompleted: 3,
    feishuTotal: 3
  }).split("\n"),
  [
    "状态：失败｜发布 18/20｜店铺 9/10｜失败项 水印18｜飞书产品 3/3",
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
  "Supervisor must stop on Doudian login loss so Hermes can notify the user instead of looping"
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
  selectLatestFailedPublishResult([
    { productFolder: "/shops/04/水印07", ok: false, message: "旧的标品页未就绪" },
    { productFolder: "/shops/05/水印09", ok: true, message: "published" },
    { productFolder: "/shops/07/水印14", ok: false, message: "当前规格模板未找到" }
  ]),
  { productFolder: "/shops/07/水印14", ok: false, message: "当前规格模板未找到" },
  "Task failure and Hermes summary must report the latest actionable blocker, not the first historical failure"
);
assert.equal(
  selectLatestFailedPublishResult([
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
  3 * 60 * 1000,
  "The supervisor must cap every slot cooldown at the requested three-minute wait"
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
    recoveryAttempts: 0,
    maxRecoveryAttempts: 3
  }),
  false,
  "AutoListingController must not automatically retry an interrupted publish with uncertain external side effects"
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
assert.equal(
  shouldReplaceStaleResumeStartStep({
    resumeStartStep: "main_images_generated",
    inferredStateStartStep: "published",
    stateProductFolderCount: 20,
    safelyPublishedCount: 2
  }),
  true,
  "AutoListingController must replace stale resume jobs when state/publish-manifest proves the flow has advanced to publishing."
);
assert.equal(
  shouldReplaceStaleResumeStartStep({
    resumeStartStep: "main_images_generated",
    inferredStateStartStep: "main_images_generated",
    stateProductFolderCount: 0,
    safelyPublishedCount: 0
  }),
  false
);
assert.equal(
  shouldInvalidatePublishedResumeWithoutProductFolders({
    resumeStartStep: "published",
    declaredProductFolderCount: 20,
    actualProductFolderCount: 0
  }),
  true,
  "Published-stage resume jobs must be invalidated when their declared product folders are missing on disk."
);
assert.equal(
  shouldInvalidatePublishedResumeWithoutProductFolders({
    resumeStartStep: "published",
    declaredProductFolderCount: 20,
    actualProductFolderCount: 20
  }),
  false
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

const publishTerminalMissing = auditPublishCoverage({
  tasks: [publishTask],
  manifestEntries: [],
  allowInProgress: false
});

assert.equal(publishTerminalMissing.ok, false);
assert.ok(publishTerminalMissing.errors.some((issue) => issue.code === "publish_result_missing"));
