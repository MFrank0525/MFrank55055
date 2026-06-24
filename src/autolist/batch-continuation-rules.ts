import { isManifestEntryAcceptedForBatchCompletion } from "./publish-manifest.js";

export type FeishuBatchContinuationInput = {
  exitCode: number | null;
  batchComplete: boolean;
};

export function shouldContinueFeishuBatchAfterChildExit(input: FeishuBatchContinuationInput): boolean {
  return input.exitCode === 0 && !input.batchComplete;
}

export type SupervisorChildMode = "resume" | "full";

export type SupervisorFullFlowContinuationInput = FeishuBatchContinuationInput & {
  childMode: SupervisorChildMode;
};

export function shouldContinueFullFlowAfterChildExit(input: SupervisorFullFlowContinuationInput): boolean {
  return shouldContinueFeishuBatchAfterChildExit(input);
}

export type FeishuBatchRetryAfterFailureInput = {
  exitCode: number | null;
  batchComplete: boolean;
  retryableFailureMessage?: string;
  recoveryAttempts: number;
  maxRecoveryAttempts: number;
};

export function resolveDefaultRetryableChildFailureRecoveryAttempts(): number {
  return 12;
}

function isPaidMainImageTransportFailure(message: string): boolean {
  return (
    /main_images_generated|main image/i.test(message) &&
    /fetch failed|network|socket|terminated|reset|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|UND_ERR/i.test(message)
  );
}

function isPaidImageSubmissionSafetyBlock(message: string): boolean {
  return /paid image ledger blocked slot|blocked_(?:reserved|ambiguous)|paid submission safety block/i.test(message);
}

function isRetryableVideosBase64NoAcceptanceTransportFailure(message: string): boolean {
  return (
    /main_images_generated|videos-base64/i.test(message) &&
    /videos-base64 paid image slots failed/i.test(message) &&
    /fetch failed|failed to fetch|fail_to_fetch_task|Bad Request|openresty|network|socket|terminated|reset|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|UND_ERR|AbortError|aborted/i.test(
      message
    ) &&
    !/blocked_(?:reserved|ambiguous)|paid submission safety block|ambiguous|reserved/i.test(message) &&
    !/videos-base64 task .*did not finish|videos-base64 task .*failed|provider task failed/i.test(message)
  );
}

function isRetryableVideosBase64ProviderTaskFailure(message: string): boolean {
  return (
    /main_images_generated|videos-base64/i.test(message) &&
    /videos-base64 task .* failed|provider task failed/i.test(message) &&
    !/upstream access forbidden|access forbidden|please contact administrator|permission denied|forbidden|余额|balance|quota|credit|insufficient|欠费|充值|billing/i.test(
      message
    )
  );
}

function isRetryableVideosBase64AcceptedQueueWait(message: string): boolean {
  return (
    /main_images_generated|main image|watchdog|no progress/i.test(message) &&
    /videos-base64 task \S+ status (?:queued|pending)\s+0\b/i.test(message)
  );
}

export function isRetryableExternalServiceAvailabilityFailure(message: string): boolean {
  if (
    isPaidImageSubmissionSafetyBlock(message) ||
    /upstream access forbidden|access forbidden|please contact administrator|permission denied|forbidden/i.test(message)
  ) {
    return false;
  }
  return (
    isRetryableVideosBase64AcceptedQueueWait(message) ||
    /paid image provider timeout circuit open/i.test(message) ||
    (!isRetryableVideosBase64NoAcceptanceTransportFailure(message) && isPaidMainImageTransportFailure(message)) ||
    (/main_images_generated/i.test(message) && /videos-base64 task .*did not finish/i.test(message)) ||
    (/main_images_generated|image generation|main image/i.test(message) &&
      (/HTTP\s*(429|502|503|504|520|521|522|523|524)/i.test(message) ||
        /temporarily unavailable|gateway unavailable|service unavailable|resource[_ -]?overloaded|server overloaded|timed out|timeout|aborted/i.test(message)))
  );
}

export function shouldConsumeSupervisorRecoveryAttempt(failureMessage: string): boolean {
  if (isRetryableVideosBase64NoAcceptanceTransportFailure(failureMessage)) {
    return false;
  }
  return !isRetryableExternalServiceAvailabilityFailure(failureMessage);
}

export function resolveSupervisorRecoveryDelayMs(input: {
  failureMessage: string;
  externalServiceWaitAttempts: number;
}): number {
  if (!isRetryableExternalServiceAvailabilityFailure(input.failureMessage)) {
    return 10000;
  }
  const normalDelayMs = 5 * 60 * 1000;
  const retryMatch = /paid image provider timeout circuit open[\s\S]*?retry after\s+(\d+)ms/i.exec(
    input.failureMessage
  );
  const slotDelayMs = retryMatch ? Number(retryMatch[1]) : Number.NaN;
  const validSlotDelay = slotDelayMs >= 1000 && slotDelayMs <= 6 * 60 * 60 * 1000;
  return validSlotDelay ? Math.min(normalDelayMs, slotDelayMs) : normalDelayMs;
}

function isDeterministicDetailQualificationFailure(message: string): boolean {
  return (
    /图文信息模块未完成/i.test(message) &&
    /Qualification detail upload was not acknowledged per file|Detail image count did not reach expected count/i.test(message)
  );
}

function isRetryablePublishPageFailure(message: string): boolean {
  if (/Doudian login (?:is )?required|抖店登录/i.test(message)) {
    return false;
  }
  return (
    /failed at published|publish failed|publish flow stopped/i.test(message) &&
    (/基础信息模块未完成|价格库存模块未完成|Price\/inventory verification failed|Basic info gate failed|input not found on publish page|Spec template selection did not match|required keyword|Manual spec template entry mode was not visible|Spec template entry control was not visible|publish create page did not become ready|publish create page has no publish sections after SPU query|Platform SPU query page was not ready|Platform SPU query controls are incomplete|page context was lost|Execution context was destroyed|Target closed/i.test(
      message
    ) || isDeterministicDetailQualificationFailure(message))
  );
}

function isRetryablePrePaidDoudianReadinessFailure(message: string): boolean {
  if (/Doudian login (?:is )?required|抖店登录/i.test(message)) {
    return false;
  }
  return /Platform SPU query page was not ready|Platform SPU query controls are incomplete|publish create page did not become ready|page context was lost|Execution context was destroyed|Target closed/i.test(
    message
  );
}

function isChildWatchdogFailure(message: string): boolean {
  return /no progress|watchdog/i.test(message);
}

function isSafeResumeTransitionFailure(message: string): boolean {
  return /product folders already contain workbook/i.test(message);
}

function isSafeManifestBackedPublishResumeFailure(message: string): boolean {
  return (
    isRetryablePublishPageFailure(message) &&
    (/基础信息模块未完成|价格库存模块未完成|Price\/inventory verification failed|Basic info gate failed|input not found on publish page|Spec template selection did not match|required keyword|Manual spec template entry mode was not visible|Spec template entry control was not visible|publish create page did not become ready|publish create page has no publish sections after SPU query|Platform SPU query page was not ready|Platform SPU query controls are incomplete/i.test(
      message
    ) || isDeterministicDetailQualificationFailure(message))
  );
}

export function resolveSupervisorRecoveryChildMode(failureMessage: string): SupervisorChildMode {
  return isSafeResumeTransitionFailure(failureMessage) || isSafeManifestBackedPublishResumeFailure(failureMessage)
    ? "resume"
    : "full";
}

export function shouldResumeFeishuBatchAfterRetryableChildFailure(input: FeishuBatchRetryAfterFailureInput): boolean {
  const retryableFailureMessage = input.retryableFailureMessage || "";
  if (input.exitCode === 0 || input.batchComplete) {
    return false;
  }
  if (isPaidImageSubmissionSafetyBlock(retryableFailureMessage)) {
    return false;
  }
  if (/upstream access forbidden|access forbidden|please contact administrator|permission denied|forbidden/i.test(retryableFailureMessage)) {
    return false;
  }
  if (isRetryableExternalServiceAvailabilityFailure(retryableFailureMessage)) {
    return true;
  }
  if (isRetryableVideosBase64NoAcceptanceTransportFailure(retryableFailureMessage)) {
    return true;
  }
  if (input.recoveryAttempts >= input.maxRecoveryAttempts) {
    return false;
  }
  if (isRetryableVideosBase64ProviderTaskFailure(retryableFailureMessage)) {
    return true;
  }
  if (isPaidMainImageTransportFailure(retryableFailureMessage)) {
    return true;
  }
  if (isRetryablePublishPageFailure(retryableFailureMessage)) {
    return true;
  }
  if (isRetryablePrePaidDoudianReadinessFailure(retryableFailureMessage)) {
    return true;
  }
  return /image generation|main image|timed out|timeout|fetch failed|network|socket|terminated|reset|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|UND_ERR|no progress|watchdog|product folders already contain workbook/i.test(
    retryableFailureMessage
  );
}

export type SupervisorFullFlowRecoveryInput = FeishuBatchRetryAfterFailureInput & {
  childMode: SupervisorChildMode;
  activeStep?: string;
  activeMessage?: string;
};

export function shouldRecoverFullFlowAfterChildFailure(input: SupervisorFullFlowRecoveryInput): boolean {
  if (!shouldResumeFeishuBatchAfterRetryableChildFailure(input)) {
    return false;
  }
  const failureMessage = input.retryableFailureMessage || "";
  const activeText = `${input.activeStep || ""} ${input.activeMessage || ""}`;
  const retryablePublishFailure = isRetryablePublishPageFailure(failureMessage);
  const safeManifestBackedPublishResume = isSafeManifestBackedPublishResumeFailure(failureMessage);
  if (
    /published|Publishing product folder|Retrying publish|Publish failed/i.test(activeText) &&
    !safeManifestBackedPublishResume
  ) {
    return false;
  }
  if (/main_images_generated|image generation|main image/i.test(`${failureMessage} ${activeText}`)) {
    return true;
  }
  return (
    input.childMode === "full" ||
    isSafeResumeTransitionFailure(failureMessage) ||
    safeManifestBackedPublishResume ||
    input.childMode === "resume" && retryablePublishFailure ||
    isChildWatchdogFailure(failureMessage)
  );
}

export type InterruptedTaskResumeInput = {
  runStatus?: string;
  taskStatus?: string;
  sourceImageExists: boolean;
  reusableRawImageCount: number;
};

export function shouldResumeInterruptedTaskInPlace(input: InterruptedTaskResumeInput): boolean {
  if (!input.sourceImageExists || input.reusableRawImageCount <= 0) {
    return false;
  }
  if (input.runStatus === "completed") {
    return false;
  }
  return !["done", "cleaned", "failed"].includes(input.taskStatus || "");
}

export type HistoricalFailureResumeInput = {
  currentBatchFingerprint?: string;
  resumeBatchFingerprint?: string;
  failedSourceImagePath?: string;
  pendingSourceImages: string[];
  batchComplete: boolean;
  reusableArtifactCount?: number;
};

export function shouldResumeHistoricalFailureForCurrentFeishuBatch(input: HistoricalFailureResumeInput): boolean {
  if (!canResumeFeishuBatchArtifacts(input)) {
    return false;
  }
  if (!input.failedSourceImagePath) {
    return false;
  }
  if (!input.batchComplete) {
    return input.pendingSourceImages[0] === input.failedSourceImagePath;
  }
  if ((input.reusableArtifactCount || 0) > 0) {
    return true;
  }
  return false;
}

export type AutoListingControllerFeishuProgressDisplayInput = {
  running: boolean;
  mode?: string;
  batchComplete: boolean;
  activeResumeReusableArtifactCount: number;
};

export type AutoListingControllerFeishuProgressDisplayMode = "current_batch" | "resume_artifact_completion";

export function resolveAutoListingControllerFeishuProgressDisplayMode(
  input: AutoListingControllerFeishuProgressDisplayInput
): AutoListingControllerFeishuProgressDisplayMode {
  if (
    input.running &&
    input.mode === "resume-real-job" &&
    input.batchComplete &&
    input.activeResumeReusableArtifactCount > 0
  ) {
    return "resume_artifact_completion";
  }
  return "current_batch";
}

export type AutoListingControllerFeishuBatchDisplayCountsInput = {
  recordCount: number;
  processedRecordCount: number;
  pendingSourceImages: string[];
  currentSourceImagePath?: string;
};

export type AutoListingControllerFeishuBatchDisplayCounts = {
  recordCount: number;
  completedCount: number;
  currentCount: number;
  notStartedCount: number;
};

export function resolveAutoListingControllerFeishuBatchDisplayCounts(
  input: AutoListingControllerFeishuBatchDisplayCountsInput
): AutoListingControllerFeishuBatchDisplayCounts {
  const currentSourceImagePath = input.currentSourceImagePath || "";
  const currentCount = currentSourceImagePath && input.pendingSourceImages.includes(currentSourceImagePath) ? 1 : 0;
  return {
    recordCount: input.recordCount,
    completedCount: input.processedRecordCount,
    currentCount,
    notStartedCount: Math.max(0, input.pendingSourceImages.length - currentCount)
  };
}

export type AutoListingControllerProgressAgeInput = {
  nowIso: string;
  latestProgressTimestamp?: string;
};

export function resolveAutoListingControllerProgressAgeSeconds(input: AutoListingControllerProgressAgeInput): number | undefined {
  if (!input.latestProgressTimestamp) {
    return undefined;
  }
  const nowMs = Date.parse(input.nowIso);
  const progressMs = Date.parse(input.latestProgressTimestamp);
  if (!Number.isFinite(nowMs) || !Number.isFinite(progressMs)) {
    return undefined;
  }
  return Math.max(0, Math.floor((nowMs - progressMs) / 1000));
}

export type AutoListingControllerChildStallTimeoutInput = {
  defaultTimeoutMs: number;
  activeStep?: string;
  activeMessage?: string;
};

export function resolveAutoListingControllerChildStallTimeoutMs(input: AutoListingControllerChildStallTimeoutInput): number {
  const defaultTimeoutMs = Math.max(180000, input.defaultTimeoutMs);
  const activeText = `${input.activeStep || ""} ${input.activeMessage || ""}`;
  if (
    /main_images_generated/i.test(activeText) &&
    /videos-base64 task \S+ status (?:queued|pending)\s+0\b/i.test(activeText)
  ) {
    return Math.max(defaultTimeoutMs, 35 * 60 * 1000);
  }
  if (
    /published|Publishing product folder|Retrying publish|Publish failed|page_context_lost|browser_remote_debugging_unavailable/i.test(activeText)
  ) {
    return Math.min(defaultTimeoutMs, 4 * 60 * 1000);
  }
  return defaultTimeoutMs;
}

export function shouldRefreshAutoListingChildProgressSeenAt(input: {
  activeStep?: string;
  activeMessage?: string;
}): boolean {
  const activeText = `${input.activeStep || ""} ${input.activeMessage || ""}`;
  if (
    /main_images_generated/i.test(activeText) &&
    /videos-base64 task \S+ status (?:queued|pending)\s+0\b/i.test(activeText)
  ) {
    return false;
  }
  return true;
}

export function isAutoListingControllerProgressArtifactRelativePath(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\.?\//, "");
  return normalized.startsWith("publish/") && /\.(?:json|ndjson|png|jpe?g|webp)$/i.test(normalized);
}

export type AutoListingControllerEffectiveProgressTimestampInput = {
  stateProgressTimestamp?: string;
  activePublishUpdatedAt?: string;
  latestArtifactUpdatedAt?: string;
  latestPublishedUpdatedAt?: string;
};

export type AutoListingControllerEffectiveProgressTimestampResult = {
  timestamp: string;
  source: "state_progress" | "active_publish" | "latest_publish_artifact" | "latest_published";
};

export function resolveAutoListingControllerEffectiveProgressTimestamp(
  input: AutoListingControllerEffectiveProgressTimestampInput
): AutoListingControllerEffectiveProgressTimestampResult | undefined {
  const candidates = [
    { timestamp: input.stateProgressTimestamp, source: "state_progress" as const },
    { timestamp: input.activePublishUpdatedAt, source: "active_publish" as const },
    { timestamp: input.latestArtifactUpdatedAt, source: "latest_publish_artifact" as const },
    { timestamp: input.latestPublishedUpdatedAt, source: "latest_published" as const }
  ]
    .filter((candidate): candidate is AutoListingControllerEffectiveProgressTimestampResult =>
      Boolean(candidate.timestamp && Number.isFinite(Date.parse(candidate.timestamp)))
    )
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));

  return candidates[0];
}

export function selectAutoListingControllerActiveRunIdFromLogLines(lines: string[]): string | undefined {
  const pattern = /auto-listing run started:\s*([0-9]{8}-[0-9]{6})/;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const match = pattern.exec(lines[index] || "");
    if (match) {
      return match[1];
    }
  }
  return undefined;
}

export type AutoListingControllerExpectedResultFileInput = {
  running: boolean;
  activeRuntimeDir?: string;
};

export function shouldUseExpectedResultFileInRunningStatus(input: AutoListingControllerExpectedResultFileInput): boolean {
  return !input.running || !input.activeRuntimeDir;
}

export type AutoListingControllerStartPauseSignalInput = {
  pauseSignalExists: boolean;
  runnerJobRunning: boolean;
};

export function shouldClearPauseSignalOnAutoListingControllerStart(input: AutoListingControllerStartPauseSignalInput): boolean {
  return input.pauseSignalExists;
}

export type AutoListingControllerPublishProgressExposureInput = {
  running: boolean;
  publishProgressAvailable: boolean;
  currentTaskStatus?: string;
  stateProgressTimestamp?: string;
  publishProgressTimestamp?: string;
};

export function shouldExposePublishProgressInAutoListingControllerStatus(input: AutoListingControllerPublishProgressExposureInput): boolean {
  if (!input.publishProgressAvailable) {
    return false;
  }
  if (!input.running) {
    return true;
  }
  if (input.currentTaskStatus === "published") {
    return true;
  }
  if (!input.stateProgressTimestamp || !input.publishProgressTimestamp) {
    return true;
  }
  return Date.parse(input.publishProgressTimestamp) >= Date.parse(input.stateProgressTimestamp);
}

export type AutoListingControllerHistoricalResultSuppressionInput = {
  running: boolean;
  publishProgressAvailable: boolean;
  resultOk?: boolean;
  resultStatus?: string;
  activeRuntimeDir?: string;
  resultRuntimeDir?: string;
};

export function shouldSuppressHistoricalResultInAutoListingControllerStatus(input: AutoListingControllerHistoricalResultSuppressionInput): boolean {
  if (!input.running) {
    return false;
  }
  if (input.activeRuntimeDir && input.resultRuntimeDir && input.activeRuntimeDir !== input.resultRuntimeDir) {
    return true;
  }
  if (!input.publishProgressAvailable) {
    return false;
  }
  return input.resultOk === false || input.resultStatus === "failed";
}

export type AutoListingControllerStateCurrentTaskSuppressionInput = {
  running: boolean;
  publishProgressAvailable: boolean;
  latestProgressStep?: string;
  currentTaskStatus?: string;
};

export function shouldSuppressStateCurrentTaskInAutoListingControllerStatus(input: AutoListingControllerStateCurrentTaskSuppressionInput): boolean {
  if (!input.running || !input.publishProgressAvailable) {
    return false;
  }
  return Boolean(input.latestProgressStep && input.currentTaskStatus && input.latestProgressStep !== input.currentTaskStatus);
}

export type FeishuBatchRefreshContinuationInput = {
  exitCode: number | null;
  currentBatchComplete: boolean;
  refreshedBatchChanged: boolean;
  refreshedBatchComplete: boolean;
};

export function shouldContinueFeishuAfterBatchRefresh(input: FeishuBatchRefreshContinuationInput): boolean {
  return input.exitCode === 0 && input.currentBatchComplete && !input.refreshedBatchComplete;
}

export type AutoListingControllerStartAfterFeishuRefreshInput = {
  currentBatchComplete: boolean;
  refreshedBatchChanged: boolean;
  refreshedBatchComplete: boolean;
  forceRerunCurrentBatch?: boolean;
};

export type AutoListingControllerStartAfterFeishuRefreshDecision =
  | "start_new_or_pending_batch"
  | "require_rerun_confirmation"
  | "rerun_current_batch";

export type AutoListingControllerLaunchIntent = "start_new_batch" | "continue_current_batch";

export function resolveAutoListingControllerLaunchPolicy(intent: AutoListingControllerLaunchIntent): {
  refreshBeforeSelection: boolean;
  allowHistoricalResume: boolean;
  forceFullFlow: boolean;
} {
  if (intent === "start_new_batch") {
    return {
      refreshBeforeSelection: true,
      allowHistoricalResume: false,
      forceFullFlow: true
    };
  }
  return {
    refreshBeforeSelection: false,
    allowHistoricalResume: true,
    forceFullFlow: false
  };
}

export function shouldExposeHistoricalRuntimeForCurrentFeishuBatch(input: {
  currentBatchFingerprint?: string;
  historicalBatchFingerprint?: string;
}): boolean {
  return Boolean(
    input.currentBatchFingerprint &&
      input.historicalBatchFingerprint &&
      input.currentBatchFingerprint === input.historicalBatchFingerprint
  );
}

export function resolveAutoListingControllerStartAfterFeishuRefresh(
  input: AutoListingControllerStartAfterFeishuRefreshInput
): AutoListingControllerStartAfterFeishuRefreshDecision {
  if (input.forceRerunCurrentBatch && input.currentBatchComplete && !input.refreshedBatchChanged) {
    return "rerun_current_batch";
  }
  if (input.refreshedBatchChanged || !input.refreshedBatchComplete) {
    return "start_new_or_pending_batch";
  }
  return "require_rerun_confirmation";
}

export function resolveAutoListingControllerDryRunStartDecision(input: {
  batchComplete?: boolean;
  forceRerunCurrentBatch: boolean;
}): "start_pending_batch" | "require_rerun_confirmation" | "rerun_current_batch" {
  if (input.batchComplete !== true) {
    return "start_pending_batch";
  }
  return input.forceRerunCurrentBatch ? "rerun_current_batch" : "require_rerun_confirmation";
}

export type FullFlowContinuationReason = "initial_full" | "same_batch_pending" | "new_batch_after_refresh";

export type FullFlowFeishuRefreshInput = {
  continuationReason: FullFlowContinuationReason;
  currentBatchComplete?: boolean;
  sameBatchRefreshAvailable?: boolean;
  localAssetCacheUnsafe?: boolean;
};

export function shouldRefreshFeishuAssetsBeforeFullFlow(input: FullFlowFeishuRefreshInput): boolean {
  if (input.localAssetCacheUnsafe) {
    return true;
  }
  if (input.currentBatchComplete === false) {
    return input.sameBatchRefreshAvailable === true;
  }
  return input.continuationReason === "initial_full";
}

export type ActiveTaskStatusSummaryInput = {
  running: boolean;
  stateHasActiveTask: boolean;
  publishProgressAvailable: boolean;
};

export function shouldPreferActiveTaskStateSummary(input: ActiveTaskStatusSummaryInput): boolean {
  return input.running && input.stateHasActiveTask;
}

export type AutoListingControllerStatusResultCandidate = {
  resultFile?: string;
  mtimeMs?: number;
};

export type AutoListingControllerStatusResultSelectionInput = {
  running: boolean;
  expected?: AutoListingControllerStatusResultCandidate;
  log?: AutoListingControllerStatusResultCandidate;
  latest?: AutoListingControllerStatusResultCandidate;
};

export function selectAutoListingControllerStatusResultFile(input: AutoListingControllerStatusResultSelectionInput): string | undefined {
  if (input.running) {
    return input.log?.resultFile || input.expected?.resultFile;
  }

  const candidates = [input.log, input.latest, input.expected]
    .filter((candidate): candidate is Required<AutoListingControllerStatusResultCandidate> =>
      Boolean(candidate?.resultFile && Number.isFinite(candidate.mtimeMs))
    )
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  return candidates[0]?.resultFile || input.log?.resultFile || input.latest?.resultFile || input.expected?.resultFile;
}

export type AutoListingControllerStatusRuntimeDirSelectionInput = {
  running: boolean;
  activeRuntimeDir?: string;
  resultRuntimeDir?: string;
  resultFile?: string;
};

export function selectAutoListingControllerStatusRuntimeDir(input: AutoListingControllerStatusRuntimeDirSelectionInput): string | undefined {
  if (input.running && input.activeRuntimeDir) {
    return input.activeRuntimeDir;
  }
  return input.resultRuntimeDir || (input.resultFile ? input.resultFile.replace(/\/result\.json$/, "") : undefined) || input.activeRuntimeDir;
}

export function isAutoListingControllerSupervisorProcessCommand(command: string): boolean {
  return /\bnode\b/.test(command) && /dist\/src\/cli\/auto-listing-supervisor\.js/.test(command);
}

export function isAutoListingControllerChildProcessCommand(command: string): boolean {
  return (
    /\bnpm run business:auto-listing\b/.test(command) &&
    /auto-listing\.job\.mac-feishu-real\.resume\.generated\.json/.test(command)
  ) || (
    /\bnode\b/.test(command) &&
    /dist\/src\/cli\/flow-mac-feishu\.js\s+--real\b/.test(command)
  );
}

export function shouldTerminateRecordedAutoListingControllerProcessGroup(input: {
  leaderRunning: boolean;
  leaderCommandMatches?: boolean;
}): boolean {
  return !input.leaderRunning || input.leaderCommandMatches === true;
}

export function shouldTerminateChildAfterTerminalResult(input: {
  terminalResultFound: boolean;
  terminalResultAgeMs: number;
  gracePeriodMs: number;
}): boolean {
  return input.terminalResultFound && input.terminalResultAgeMs >= Math.max(0, input.gracePeriodMs);
}

export function isAutoListingControllerRunningProcessConfirmed(input: {
  pidAlive: boolean;
  processGroupAlive?: boolean;
  command?: string;
}): boolean {
  return input.pidAlive && (Boolean(input.command && isAutoListingControllerSupervisorProcessCommand(input.command)) || input.processGroupAlive === true);
}

export function selectAutoListingControllerLatestResultFileForJobStatus(input: {
  hasControlJob: boolean;
  latestResultFile?: string;
}): string | undefined {
  return input.hasControlJob ? undefined : input.latestResultFile;
}

export type AutoListingControllerImageGenerationEvent = {
  timestamp?: string;
  message?: string;
};

export type AutoListingControllerImageGenerationSummary = {
  status: "reused_raw_images" | "ready" | "generating" | "in_progress";
  count?: number;
  latestMessage: string;
  latestSavedMessage?: string;
  latestSavedImage?: number;
  updatedAt?: string;
  latestSavedAt?: string;
};

export function summarizeAutoListingControllerImageGenerationEvents(events: AutoListingControllerImageGenerationEvent[]): AutoListingControllerImageGenerationSummary | undefined {
  const latest = events.at(-1);
  if (!latest) {
    return undefined;
  }
  const latestReuseEvent = [...events]
    .reverse()
    .find((event) => /Reused\s+\d+\s+current-product raw main image/i.test(event.message || ""));
  const latestSavedEvent = [...events]
    .reverse()
    .find((event) => /saved generated-(\d+)/i.test(event.message || ""));
  const reused = /Reused\s+(\d+)\s+current-product raw main image/i.exec(latestReuseEvent?.message || "");
  const ready = /Main images ready:\s*(\d+)\s*file/i.exec(latest.message || "");
  const saved = /saved generated-(\d+)/i.exec(latest.message || "");
  const latestSaved = /saved generated-(\d+)/i.exec(latestSavedEvent?.message || "");
  const submitting = /Prompt\s+(\d+)\/(\d+):\s*Image\s+(\d+)/i.exec(latest.message || "");
  return {
    status: reused ? "reused_raw_images" : ready ? "ready" : saved ? "generating" : submitting ? "generating" : "in_progress",
    count: reused ? Number(reused[1]) : ready ? Number(ready[1]) : undefined,
    latestMessage: reused ? latestReuseEvent?.message || "" : latest.message || "",
    latestSavedMessage: latestSavedEvent?.message,
    latestSavedImage: latestSaved ? Number(latestSaved[1]) : undefined,
    updatedAt: reused ? latestReuseEvent?.timestamp : latest.timestamp,
    latestSavedAt: latestSavedEvent?.timestamp
  };
}

export type AutoListingControllerHermesStatusPayload = Record<string, unknown> & {
  hermesProgress?: Record<string, unknown>;
};

function formatFeishuProductProgress(value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const progress = value as Record<string, unknown>;
  const current = Number(progress.current ?? progress.index ?? 0);
  const total = Number(progress.total ?? 0);
  if (!Number.isFinite(current) || !Number.isFinite(total) || current <= 0 || total <= 0) {
    return undefined;
  }
  return `飞书产品 ${Math.min(total, current)}/${total}`;
}

function compactImageProviderQueueWaitProgress(message?: string): string | undefined {
  const text = String(message || "").replace(/\s+/g, " ").trim();
  const match = /(Prompt\s+\d+\/\d+:\s*Image\s+\d+:\s*videos-base64 task \S+ status (?:queued|pending)\s+0\.?)/i.exec(text);
  if (!match) {
    return undefined;
  }
  return `等待图片服务队列：${match[1].replace(/\.$/, "")}`;
}

export function resolveAutoListingControllerHermesStatusPayload(
  status: Record<string, unknown>
): AutoListingControllerHermesStatusPayload {
  const publishProgress = status.publishProgress as Record<string, unknown> | undefined;
  const realtimeProgress = status.realtimeProgress as Record<string, unknown> | undefined;
  const payload: AutoListingControllerHermesStatusPayload = { ...status };
  const feishuProductProgress = formatFeishuProductProgress(status.feishuCurrentProduct);
  if (realtimeProgress && typeof realtimeProgress === "object") {
    const publishProgressText =
      publishProgress && typeof publishProgress.progressText === "string"
        ? String(publishProgress.progressText)
        : undefined;
    const realtimeMessage =
      typeof realtimeProgress.message === "string"
        ? compactImageProviderQueueWaitProgress(String(realtimeProgress.message)) || String(realtimeProgress.message)
        : undefined;
    const message = publishProgressText || realtimeMessage;
    const feishuPrefixedMessage =
      feishuProductProgress && message && !message.includes(feishuProductProgress)
        ? `${feishuProductProgress}；${message}`
        : message || feishuProductProgress;
    const publishGroupProgress = publishProgress?.publishGroupProgress as Record<string, unknown> | undefined;
    const stablePublishKey = publishProgressText
      ? [
          "publish_progress",
          publishGroupProgress?.productName,
          publishGroupProgress?.productIndex,
          publishGroupProgress?.productTotal,
          publishGroupProgress?.shopIndex,
          publishGroupProgress?.shopTotal,
          publishGroupProgress?.failed
        ]
          .filter((value) => value !== undefined && value !== "")
          .join("|")
      : undefined;
    const hermesProgress = {
      source: realtimeProgress.source,
      message: feishuPrefixedMessage,
      timestamp: realtimeProgress.timestamp,
      key: stablePublishKey || realtimeProgress.key
    };
    payload.hermesProgress = Object.fromEntries(Object.entries(hermesProgress).filter(([, value]) => value !== undefined));
  }
  if (publishProgress) {
    delete payload.imageProgress;
    delete payload.publishProgress;
  }
  return payload;
}

export function isExternalMainImageRawReuseMessage(input: {
  message?: string;
  currentRuntimeDir: string;
}): boolean {
  const match = /Reused\s+\d+\s+current-product raw main image\(s\)\s+from\s+(.+?)\.?$/i.exec(input.message || "");
  if (!match) {
    return false;
  }
  const sourceDir = match[1].trim();
  const normalizedSource = sourceDir.replace(/\/+$/, "");
  const normalizedRuntime = input.currentRuntimeDir.replace(/\/+$/, "");
  return normalizedSource !== normalizedRuntime && !normalizedSource.startsWith(normalizedRuntime + "/");
}

export type AutoListingControllerCompactStatusTextInput = {
  status?: string;
  summary?: string;
  productName?: string;
  activeItemName?: string;
  imageGenerationProgress?: string;
  mainImageCompleted?: number;
  latestProgress?: string;
  publishSafelyPublished?: number;
  publishTotal?: number;
  publishFailed?: number;
  publishProductIndex?: number;
  publishProductTotal?: number;
  publishShopIndex?: number;
  publishShopTotal?: number;
  publishFailedWatermarkNo?: number;
  publishReviewWatermarkNo?: number;
  publishLatestAttemptedWatermarkNo?: number;
  feishuProductIndex?: number;
  feishuCompleted?: number;
  feishuTotal?: number;
  showPublishProgress?: boolean;
};

export function resolveAutoListingControllerPaidImageRecordId(input: {
  currentTaskRecordId?: string;
  feishuCurrentProductRecordId?: string;
}): string {
  return input.currentTaskRecordId?.trim() || input.feishuCurrentProductRecordId?.trim() || "";
}

export type AutoListingControllerPublishGroupProgressEntry = {
  productFolder?: string;
  runtimeKey?: string;
  shopFolder?: string;
  watermarkNo?: number | null;
  status?: string;
  finalVerifyStatus?: string;
  errorClass?: string;
  updatedAt?: string;
};

export type AutoListingControllerPublishGroupProgress = {
  productName: string;
  productIndex: number;
  productTotal: number;
  shopName: string;
  shopIndex: number;
  shopTotal: number;
  failed: number;
  review?: number;
  failedWatermarkNo?: number;
  reviewWatermarkNo?: number;
  latestAttemptedWatermarkNo?: number;
};

export type AutoListingControllerRealtimeProgressSignalInput = {
  jobStartedAt?: string;
  activeRunId?: string;
  status?: string;
  statusSource?: string;
  preferStatusMessage?: boolean;
  statusMessage?: string;
  statusTimestamp?: string;
  publishSafelyPublished?: number;
  publishTotal?: number;
  publishFailed?: number;
  publishProductIndex?: number;
  publishProductTotal?: number;
  publishShopIndex?: number;
  publishShopTotal?: number;
  publishActiveRuntimeKey?: string;
  publishActiveUpdatedAt?: string;
  publishActiveMessage?: string;
  latestArtifactUpdatedAt?: string;
  latestArtifactName?: string;
  publishLogTimestamp?: string;
  publishLogMessage?: string;
  stateLatestProgressTimestamp?: string;
  stateLatestProgressMessage?: string;
};

export type AutoListingControllerRealtimeProgressSignal = {
  key: string;
  timestamp?: string;
  source: "publish_log" | "latest_artifact" | "publish_active" | "state" | "status";
  message: string;
};

export function compactAutoListingTerminalFailureMessage(message: string): string {
  return message
    .replace(/^published:\s*/i, "")
    .replace(/^Publish failed for [^:]+:\s*/i, "")
    .trim();
}

function compactRealtimeProgressPart(value: string | undefined): string {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function resolveRealtimeProgressDisplayCounts(input: AutoListingControllerRealtimeProgressSignalInput): string[] {
  if (
    input.publishProductIndex !== undefined &&
    input.publishProductTotal !== undefined &&
    input.publishShopIndex !== undefined &&
    input.publishShopTotal !== undefined
  ) {
    return [
      `${input.publishProductIndex}/${input.publishProductTotal}`,
      `${input.publishShopIndex}/${input.publishShopTotal}`,
      String(input.publishFailed ?? 0)
    ];
  }
  return [`${input.publishSafelyPublished ?? 0}/${input.publishTotal ?? "?"}/${input.publishFailed ?? 0}`];
}

export function resolveAutoListingControllerRealtimeProgressSignal(
  input: AutoListingControllerRealtimeProgressSignalInput
): AutoListingControllerRealtimeProgressSignal | undefined {
  const statusCandidate = {
    source: "status" as const,
    timestamp: input.statusTimestamp,
    message: input.statusMessage || input.status
  };
  const candidates = [
    {
      source: "publish_log" as const,
      timestamp: input.publishLogTimestamp,
      message: input.publishLogMessage,
      priority: 0
    },
    {
      source: "publish_active" as const,
      timestamp: input.publishActiveUpdatedAt,
      message: input.publishActiveMessage,
      priority: 1
    },
    {
      source: "latest_artifact" as const,
      timestamp: input.latestArtifactUpdatedAt,
      message: input.latestArtifactName ? `最近产物：${input.latestArtifactName}` : undefined,
      priority: 2
    },
    {
      source: "state" as const,
      timestamp: input.stateLatestProgressTimestamp,
      message: input.stateLatestProgressMessage,
      priority: 3
    }
  ]
    .filter((candidate) => Boolean(candidate.message || candidate.timestamp))
    .sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      const aTime = a.timestamp && Number.isFinite(Date.parse(a.timestamp)) ? Date.parse(a.timestamp) : 0;
      const bTime = b.timestamp && Number.isFinite(Date.parse(b.timestamp)) ? Date.parse(b.timestamp) : 0;
      return bTime - aTime;
    });

  const selected = input.preferStatusMessage && statusCandidate.message ? statusCandidate : candidates[0] || statusCandidate;
  const activeKey = compactRealtimeProgressPart(input.publishActiveRuntimeKey || input.activeRunId);
  const message = compactRealtimeProgressPart(selected.message || input.status || "unknown");
  const key = [
    compactRealtimeProgressPart(input.jobStartedAt),
    compactRealtimeProgressPart(input.activeRunId),
    compactRealtimeProgressPart(input.status),
    selected.source,
    ...resolveRealtimeProgressDisplayCounts(input),
    activeKey,
    compactRealtimeProgressPart(selected.timestamp),
    message
  ].join("|");
  if (!key.replace(/\|/g, "")) {
    return undefined;
  }
  return {
    key,
    timestamp: selected.timestamp,
    source: selected.source,
    message
  };
}

export type AutoListingControllerResolvedStatus =
  | "running"
  | "pause_requested"
  | "paused"
  | "completed"
  | "failed"
  | "external_service_wait"
  | "pending_products"
  | "exited_unknown";

export function resolveAutoListingControllerIdleStatus(input: {
  pauseSignalExists?: boolean;
  batchComplete?: boolean;
  latestResultOk?: boolean;
  latestResultStatus?: string;
}): AutoListingControllerResolvedStatus | "idle" {
  if (input.pauseSignalExists) {
    return "pause_requested";
  }
  if (input.batchComplete === true) {
    return "completed";
  }
  if (input.batchComplete === false) {
    return "pending_products";
  }
  if (input.latestResultOk === false || input.latestResultStatus === "failed") {
    return "failed";
  }
  return "idle";
}

export type AutoListingControllerRuntimeStatusInput = {
  running: boolean;
  activeWaitState: boolean;
  pauseSignalExists?: boolean;
  completed: boolean;
  failed: boolean;
  hasPendingFeishuProducts: boolean;
  stateStatus?: string;
  resultStatus?: string;
  terminalFailureMessage?: string;
};

export function resolveAutoListingControllerRuntimeStatus(input: AutoListingControllerRuntimeStatusInput): AutoListingControllerResolvedStatus {
  if (input.pauseSignalExists) {
    return "pause_requested";
  }
  if (input.activeWaitState) {
    return "external_service_wait";
  }
  if (input.running && isRetryableExternalServiceAvailabilityFailure(input.terminalFailureMessage || "")) {
    return "external_service_wait";
  }
  if (input.running) {
    return "running";
  }
  if (
    input.stateStatus === "paused" ||
    input.resultStatus === "paused" ||
    /pause requested|pause\.requested|Auto-listing pause requested/i.test(input.terminalFailureMessage || "")
  ) {
    return "paused";
  }
  if (input.completed) {
    return "completed";
  }
  if (input.failed) {
    return "failed";
  }
  if (input.hasPendingFeishuProducts) {
    return "pending_products";
  }
  return "exited_unknown";
}

function normalizeAutoListingControllerStatusLabel(status?: string): string {
  if (status === "running") return "运行中";
  if (status === "pause_requested") return "正在安全暂停";
  if (status === "paused") return "已暂停";
  if (status === "failed") return "失败";
  if (status === "completed") return "完成";
  if (status === "external_service_wait") return "等待图片服务";
  if (status === "pending_products") return "待继续";
  if (status === "idle") return "空闲";
  return status || "未知";
}

function cleanAutoListingControllerProductName(name?: string): string {
  const base = (name || "").split(/[\\/]/).pop() || "";
  const withoutExtension = base.replace(/\.(png|jpe?g|webp)$/i, "");
  const productFolderMatch = withoutExtension.match(/^(.+?)-rec[a-zA-Z0-9]+-水印\d+$/i);
  if (productFolderMatch?.[1]) {
    return productFolderMatch[1].trim();
  }
  return withoutExtension
    .replace(/\.(png|jpe?g|webp)$/i, "")
    .replace(/^[^-]+-/, "")
    .replace(/-白底图-\d+$/i, "")
    .replace(/水印\d+$/i, "")
    .trim() || "未知商品";
}

function publishGroupNameFromFolder(folder?: string): string {
  return cleanAutoListingControllerProductName(folder).replace(/水印\d+$/i, "").trim() || "未知商品";
}

function publishShopIndexFromName(shopName?: string): number | undefined {
  const match = /^(\d+)/.exec(String(shopName || "").split(/[\\/]/).pop() || "");
  return match ? Number(match[1]) : undefined;
}

function publishWatermarkNoFromEntry(entry: AutoListingControllerPublishGroupProgressEntry): number {
  const explicit = Number(entry.watermarkNo || 0);
  if (Number.isFinite(explicit) && explicit > 0) {
    return explicit;
  }
  const match = String(entry.productFolder || "").split(/[\\/]/).pop()?.match(/水印(\d{1,3})$/i);
  return match ? Number(match[1]) : 0;
}

function publishShopFolderFromEntry(entry: AutoListingControllerPublishGroupProgressEntry): string | undefined {
  if (entry.shopFolder) {
    return entry.shopFolder;
  }
  const folder = String(entry.productFolder || "");
  return folder ? folder.split(/[\\/]/).slice(0, -1).join("/") : undefined;
}

function isSafelyPublishedPublishEntry(entry: AutoListingControllerPublishGroupProgressEntry): boolean {
  return isManifestEntryAcceptedForBatchCompletion(entry as never);
}

function isFinalPublishReviewEntry(entry: AutoListingControllerPublishGroupProgressEntry): boolean {
  return false;
}

function publishEntryUpdatedAtMs(entry: AutoListingControllerPublishGroupProgressEntry | undefined): number {
  const value = Date.parse(String(entry?.updatedAt || ""));
  return Number.isFinite(value) ? value : 0;
}

export function resolveAutoListingControllerPublishGroupProgress(input: {
  entries: AutoListingControllerPublishGroupProgressEntry[];
  planEntries?: AutoListingControllerPublishGroupProgressEntry[];
  activeRuntimeKey?: string;
}): AutoListingControllerPublishGroupProgress | undefined {
  const entries = input.entries.filter((entry) => entry.productFolder || entry.shopFolder || entry.watermarkNo);
  const planEntries = (input.planEntries || []).filter((entry) => entry.productFolder || entry.shopFolder || entry.watermarkNo);
  const progressEntries = entries.length ? entries : planEntries;
  if (!progressEntries.length) {
    return undefined;
  }
  const activeEntry =
    (input.activeRuntimeKey ? entries.find((entry) => String((entry as { runtimeKey?: string }).runtimeKey || "") === input.activeRuntimeKey) : undefined) ||
    (input.activeRuntimeKey ? planEntries.find((entry) => String((entry as { runtimeKey?: string }).runtimeKey || "") === input.activeRuntimeKey) : undefined) ||
    [...entries].sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))[0] ||
    planEntries[0];
  const productName = publishGroupNameFromFolder(activeEntry.productFolder);
  const groupEntries = entries.filter((entry) => publishGroupNameFromFolder(entry.productFolder) === productName);
  const plannedGroupEntries = planEntries.filter((entry) => publishGroupNameFromFolder(entry.productFolder) === productName);
  const scopeEntries = plannedGroupEntries.length ? plannedGroupEntries : groupEntries;
  const activeEntryUpdatedAtMs = publishEntryUpdatedAtMs(activeEntry);
  const activeWatermark = publishWatermarkNoFromEntry(activeEntry);
  const isActiveAttemptInProgress = ["pending", "running", "in_progress"].includes(String(activeEntry.status || ""));
  const displayGroupEntries =
    isActiveAttemptInProgress && activeEntryUpdatedAtMs > 0
      ? groupEntries.filter((entry) => {
          if (publishEntryUpdatedAtMs(entry) >= activeEntryUpdatedAtMs) {
            return true;
          }
          if (isSafelyPublishedPublishEntry(entry)) {
            return true;
          }
          return publishWatermarkNoFromEntry(entry) <= activeWatermark;
        })
      : groupEntries;
  const safelyPublished = groupEntries.filter(isSafelyPublishedPublishEntry);
  const reviewEntries = displayGroupEntries.filter(isFinalPublishReviewEntry);
  const failedEntries = displayGroupEntries.filter((entry) => entry.status === "failed" && !isFinalPublishReviewEntry(entry) && !isSafelyPublishedPublishEntry(entry));
  const failed = failedEntries.length;
  const review = reviewEntries.length;
  const productTotal = Math.max(20, scopeEntries.length, ...scopeEntries.map(publishWatermarkNoFromEntry).filter(Number.isFinite));
  const maxCompletedWatermark = Math.max(0, ...safelyPublished.map(publishWatermarkNoFromEntry).filter(Number.isFinite));
  const latestAttemptedWatermark = Math.max(
    0,
    ...displayGroupEntries
      .filter((entry) => entry.status === "published" || entry.status === "failed" || entry.status === "pending")
      .map(publishWatermarkNoFromEntry)
      .filter(Number.isFinite)
  );
  const latestAttemptedEntry = latestAttemptedWatermark
    ? [...displayGroupEntries]
        .filter((entry) => publishWatermarkNoFromEntry(entry) === latestAttemptedWatermark)
        .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))[0]
    : undefined;
  const failedWatermark = Math.max(0, ...failedEntries.map(publishWatermarkNoFromEntry).filter(Number.isFinite));
  const reviewWatermark = Math.max(0, ...reviewEntries.map(publishWatermarkNoFromEntry).filter(Number.isFinite));
  const productIndex = Math.max(1, Math.min(productTotal, (failed > 0 && latestAttemptedWatermark > activeWatermark ? latestAttemptedWatermark : activeWatermark) || latestAttemptedWatermark || maxCompletedWatermark || safelyPublished.length + (failed > 0 ? 1 : 0) || 1));
  const shopNames = Array.from(new Set(scopeEntries.map((entry) => cleanAutoListingControllerProductName(publishShopFolderFromEntry(entry))).filter(Boolean)))
    .sort((a, b) => (publishShopIndexFromName(a) || 0) - (publishShopIndexFromName(b) || 0) || a.localeCompare(b, "zh-CN"));
  const displayEntry = failed > 0 && latestAttemptedEntry ? latestAttemptedEntry : activeEntry;
  const activeShopName = cleanAutoListingControllerProductName(publishShopFolderFromEntry(displayEntry));
  const shopTotal = Math.max(1, plannedGroupEntries.length ? shopNames.length : Math.max(shopNames.length, Math.ceil(productTotal / 2)));
  const shopIndex =
    publishShopIndexFromName(activeShopName) ||
    (activeShopName && shopNames.includes(activeShopName) ? shopNames.indexOf(activeShopName) + 1 : undefined) ||
    Math.max(1, Math.ceil(productIndex / 2));
  return {
    productName,
    productIndex,
    productTotal,
    shopName: activeShopName || "未知店铺",
    shopIndex: Math.min(shopTotal, shopIndex),
    shopTotal,
    failed,
    ...(review ? { review } : {}),
    ...(failedWatermark ? { failedWatermarkNo: failedWatermark } : {}),
    ...(reviewWatermark ? { reviewWatermarkNo: reviewWatermark } : {}),
    ...(failed > 0 && latestAttemptedWatermark ? { latestAttemptedWatermarkNo: latestAttemptedWatermark } : {})
  };
}

function compactAutoListingControllerReason(summary?: string): string {
  const text = String(summary || "").replace(/\s+/g, " ").trim();
  const paidSafety = /paid submission safety block: paid image ledger has ambiguous=(\d+), reserved=(\d+)/i.exec(text);
  if (paidSafety) {
    const ambiguous = Number(paidSafety[1] || 0);
    const reserved = Number(paidSafety[2] || 0);
    return `付费生图提交状态不明确：${ambiguous} 个槽位 ambiguous，${reserved} 个槽位 reserved；已停止自动重提，需先做供应商对账或无受理对账后再续跑。`;
  }
  if (/videos-base64 submit failed with HTTP\s+502/i.test(text) && /Bad gateway|Host.*Error|Cloudflare/i.test(text)) {
    return "图片中转站 Cloudflare 502，供应商主机不可用；已保留当前飞书批次和断点。";
  }
  if (/Expected short-title field is missing|导购短标题.*缺失|short-title/i.test(text)) {
    return "导购短标题字段缺失，已停止，可续跑。";
  }
  if (/page context was lost|Execution context was destroyed|Target closed/i.test(text)) {
    return "发布页上下文丢失，已停止，可续跑。";
  }
  if (/Platform SPU query page was not ready|Platform SPU query controls are incomplete|标品检索页.*控件/i.test(text)) {
    return "标品检索页控件未加载完整，已停止，可续跑。";
  }
  if (/Doudian login (?:is )?required|抖店登录/i.test(text)) {
    return "抖店登录已失效，已停止；请在自动化浏览器完成登录后从断点续跑。";
  }
  if (/Spec template left .*blank required spec value input|Spectemplateleft.*blankspecvalueinput/i.test(text)) {
    return "规格模板存在空白占位值；按模板内容为准，续跑时不补写也不删除该空白项。";
  }
  if (/Price\/inventory verification failed|价格库存模块未完成/i.test(text)) {
    return "价格库存读回校验失败，已停止；需重试失败水印，三次仍失败则人工处理。";
  }
  if (/批次保护暂停：运行批次 .* 与当前飞书缓存 .* 不一致/i.test(text)) {
    const match = /批次保护暂停：运行批次\s+(\S+)\s+与当前飞书缓存\s+(\S+)\s+不一致/i.exec(text);
    return match
      ? `批次保护暂停：旧批次 ${match[1]}，当前批次 ${match[2]}；继续会按当前飞书缓存重选断点。`
      : "批次保护暂停：旧运行与当前飞书缓存不一致；继续会按当前飞书缓存重选断点。";
  }
  if (/fetch failed|network|socket|timeout|UND_ERR|ECONNRESET|ETIMEDOUT/i.test(text)) {
    return "网络/中转站瞬断，已保留断点，可续跑。";
  }
  return text
    .replace(/^发布基础信息未完成[:：]?/i, "基础信息失败：")
    .replace(/；系统会按发布页控件未就绪处理并重试。?/g, "")
    .slice(0, 80) || "暂无原因";
}

function compactAutoListingControllerImageProgress(progress?: string): string {
  const queueWait = compactImageProviderQueueWaitProgress(progress);
  if (queueWait) {
    return queueWait;
  }
  const text = String(progress || "").replace(/\s+/g, " ").trim();
  return text.length > 180 ? `${text.slice(0, 180)}...` : text;
}

function resolveAutoListingControllerMainImageProgressIndex(progress?: string, total = 20): number {
  const text = String(progress || "");
  const promptMatch = /Prompt\s+(\d+)\/\d+:\s*Image\s+(\d+)/i.exec(text);
  if (promptMatch) {
    return Math.max(1, Math.min(total, (Number(promptMatch[1]) - 1) * 4 + Number(promptMatch[2])));
  }
  const readyMatch = /Main images ready:\s*(\d+)/i.exec(text);
  if (readyMatch) {
    return Math.max(1, Math.min(total, Number(readyMatch[1])));
  }
  return Math.max(1, Math.min(total, total));
}

function shouldPreferAutoListingControllerPublishProgress(input: AutoListingControllerCompactStatusTextInput): boolean {
  if (!input.latestProgress) {
    return false;
  }
  if (input.publishProductIndex !== undefined || input.publishShopIndex !== undefined) {
    return true;
  }
  return /发布|publish|basic_info|商品|店铺|spu/i.test(input.latestProgress);
}

export function formatAutoListingControllerExternalServiceWaitSummary(input: {
  retryAt?: string;
  nowMs: number;
  reason?: string;
}): string {
  const retryAtMs = Date.parse(input.retryAt || "");
  const remainingSeconds = Number.isFinite(retryAtMs)
    ? Math.max(0, Math.ceil((retryAtMs - input.nowMs) / 1000))
    : undefined;
  const countdown =
    remainingSeconds === undefined
      ? "供应商恢复后"
      : `${Math.floor(remainingSeconds / 60)}分${remainingSeconds % 60}秒后`;
  const slot = /timeout circuit open for slot\s+(\d+)/i.exec(input.reason || "")?.[1];
  const slotText = slot ? `槽位 ${slot}；` : "";
  return `图片服务冷却中：${slotText}${countdown}（${input.retryAt || "时间待定"}）自动重试。`;
}

export function formatAutoListingControllerCompactStatusText(input: AutoListingControllerCompactStatusTextInput): string {
  const productTotal = input.publishProductTotal ?? 20;
  const fallbackProductIndex = (input.publishSafelyPublished || 0) + (input.publishFailed ? 1 : 0) || 1;
  const productIndex = Math.max(1, Math.min(productTotal, input.publishProductIndex ?? fallbackProductIndex));
  const shopTotal = input.publishShopTotal ?? Math.max(1, Math.ceil(productTotal / 2));
  const shopIndex = Math.max(1, Math.min(shopTotal, input.publishShopIndex ?? Math.ceil(productIndex / 2)));
  const feishuCompleted = input.feishuProductIndex ?? input.feishuCompleted ?? "?";
  const feishuTotal = input.feishuTotal ?? "?";
  const feishuLabel = `飞书产品 ${feishuCompleted}/${feishuTotal}`;
  if (input.showPublishProgress === false && !input.imageGenerationProgress) {
    const lines = [`状态：${normalizeAutoListingControllerStatusLabel(input.status)}｜${feishuLabel}`];
    if (input.summary) {
      lines.push(`进度：${compactAutoListingControllerReason(input.summary)}`);
    }
    return lines.join("\n");
  }
  const preferPublishProgress = shouldPreferAutoListingControllerPublishProgress(input);
  const mainImageProgressIndex =
    input.mainImageCompleted === undefined
      ? resolveAutoListingControllerMainImageProgressIndex(input.imageGenerationProgress, productTotal)
      : Math.max(0, Math.min(productTotal, input.mainImageCompleted));
  const lines = [
    !preferPublishProgress && input.imageGenerationProgress
      ? `状态：${normalizeAutoListingControllerStatusLabel(input.status)}｜${input.mainImageCompleted === undefined ? "提交槽位" : "主图"} ${mainImageProgressIndex}/${productTotal}｜${feishuLabel}`
      : `状态：${normalizeAutoListingControllerStatusLabel(input.status)}｜产品 ${productIndex}/${productTotal}｜店铺 ${shopIndex}/${shopTotal}${input.publishFailedWatermarkNo ? `｜失败项 水印${input.publishFailedWatermarkNo}` : ""}${input.publishReviewWatermarkNo ? `｜待复核 水印${input.publishReviewWatermarkNo}` : ""}｜${feishuLabel}`
  ];

  if (input.status === "failed") {
    lines.push(`商品：${cleanAutoListingControllerProductName(input.productName || input.activeItemName)}`);
    lines.push(`原因：${compactAutoListingControllerReason(input.summary)}`);
    return lines.join("\n");
  }

  const active = cleanAutoListingControllerProductName(input.activeItemName || input.productName);
  lines.push(`当前：${active}`);
  const latestProgress =
    input.status === "external_service_wait" || input.status === "pause_requested" || input.status === "paused"
      ? input.summary
      : preferPublishProgress
        ? input.latestProgress
        : input.imageGenerationProgress || input.latestProgress;
  if (latestProgress) {
    lines.push(`进度：${!preferPublishProgress && input.imageGenerationProgress ? compactAutoListingControllerImageProgress(latestProgress) : compactAutoListingControllerReason(latestProgress)}`);
  } else if (input.summary) {
    lines.push(`进度：${compactAutoListingControllerReason(input.summary)}`);
  }
  return lines.slice(0, 3).join("\n");
}

export type AutoListingControllerFailedResumeCandidate = {
  resultFile: string;
  mtimeMs: number;
  safelyPublishedCount?: number;
  resumeProductFolderCount?: number;
  reusableRawImageCount?: number;
};

export function selectAutoListingControllerFailedResumeCandidate<T extends AutoListingControllerFailedResumeCandidate>(candidates: T[]): T | undefined {
  return [...candidates].sort(
    (a, b) =>
      (b.safelyPublishedCount || 0) - (a.safelyPublishedCount || 0) ||
      (b.resumeProductFolderCount || 0) - (a.resumeProductFolderCount || 0) ||
      (b.reusableRawImageCount || 0) - (a.reusableRawImageCount || 0) ||
      b.mtimeMs - a.mtimeMs
  )[0];
}
import { canResumeFeishuBatchArtifacts } from "./feishu-batch-rules.js";
