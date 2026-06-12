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

export function isRetryableExternalServiceAvailabilityFailure(message: string): boolean {
  if (/upstream access forbidden|access forbidden|please contact administrator|permission denied|forbidden/i.test(message)) {
    return false;
  }
  return (
    /main_images_generated|image generation|main image/i.test(message) &&
    (
      /HTTP\s*(429|502|503|504)/i.test(message) ||
      /temporarily unavailable|gateway unavailable|service unavailable|resource[_ -]?overloaded|server overloaded/i.test(message)
    )
  );
}

export function shouldConsumeSupervisorRecoveryAttempt(failureMessage: string): boolean {
  return !isRetryableExternalServiceAvailabilityFailure(failureMessage);
}

export function resolveSupervisorRecoveryDelayMs(input: {
  failureMessage: string;
  externalServiceWaitAttempts: number;
}): number {
  if (!isRetryableExternalServiceAvailabilityFailure(input.failureMessage)) {
    return 10000;
  }
  return Math.min(30 * 60 * 1000, 10 * 60 * 1000 * Math.pow(2, Math.max(0, input.externalServiceWaitAttempts)));
}

function isRetryablePublishPageFailure(message: string): boolean {
  return (
    /failed at published|publish failed|publish flow stopped/i.test(message) &&
    /基础信息模块未完成|Basic info gate failed|input not found on publish page|Spec template selection did not match|required keyword|publish create page did not become ready|page context was lost|Execution context was destroyed|Target closed/i.test(
      message
    )
  );
}

function isChildWatchdogFailure(message: string): boolean {
  return /no progress|watchdog/i.test(message);
}

export function shouldResumeFeishuBatchAfterRetryableChildFailure(input: FeishuBatchRetryAfterFailureInput): boolean {
  const retryableFailureMessage = input.retryableFailureMessage || "";
  if (input.exitCode === 0 || input.batchComplete) {
    return false;
  }
  if (/upstream access forbidden|access forbidden|please contact administrator|permission denied|forbidden/i.test(retryableFailureMessage)) {
    return false;
  }
  if (isRetryableExternalServiceAvailabilityFailure(retryableFailureMessage)) {
    return true;
  }
  if (input.recoveryAttempts >= input.maxRecoveryAttempts) {
    return false;
  }
  if (isPaidMainImageTransportFailure(retryableFailureMessage)) {
    return false;
  }
  if (isRetryablePublishPageFailure(retryableFailureMessage)) {
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
  if (/published|Publishing product folder|Retrying publish|Publish failed/i.test(activeText)) {
    return false;
  }
  return input.childMode === "full" || isRetryablePublishPageFailure(failureMessage) || isChildWatchdogFailure(failureMessage);
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

export type HermesFeishuProgressDisplayInput = {
  running: boolean;
  mode?: string;
  batchComplete: boolean;
  activeResumeReusableArtifactCount: number;
};

export type HermesFeishuProgressDisplayMode = "current_batch" | "resume_artifact_completion";

export function resolveHermesFeishuProgressDisplayMode(
  input: HermesFeishuProgressDisplayInput
): HermesFeishuProgressDisplayMode {
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

export type HermesFeishuBatchDisplayCountsInput = {
  recordCount: number;
  processedRecordCount: number;
  pendingSourceImages: string[];
  currentSourceImagePath?: string;
};

export type HermesFeishuBatchDisplayCounts = {
  recordCount: number;
  completedCount: number;
  currentCount: number;
  notStartedCount: number;
};

export function resolveHermesFeishuBatchDisplayCounts(
  input: HermesFeishuBatchDisplayCountsInput
): HermesFeishuBatchDisplayCounts {
  const currentSourceImagePath = input.currentSourceImagePath || "";
  const currentCount = currentSourceImagePath && input.pendingSourceImages.includes(currentSourceImagePath) ? 1 : 0;
  return {
    recordCount: input.recordCount,
    completedCount: input.processedRecordCount,
    currentCount,
    notStartedCount: Math.max(0, input.pendingSourceImages.length - currentCount)
  };
}

export type HermesProgressAgeInput = {
  nowIso: string;
  latestProgressTimestamp?: string;
};

export function resolveHermesProgressAgeSeconds(input: HermesProgressAgeInput): number | undefined {
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

export type HermesChildStallTimeoutInput = {
  defaultTimeoutMs: number;
  activeStep?: string;
  activeMessage?: string;
};

export function resolveHermesChildStallTimeoutMs(input: HermesChildStallTimeoutInput): number {
  const defaultTimeoutMs = Math.max(180000, input.defaultTimeoutMs);
  const activeText = `${input.activeStep || ""} ${input.activeMessage || ""}`;
  if (
    /published|Publishing product folder|Retrying publish|Publish failed|page_context_lost|browser_remote_debugging_unavailable/i.test(activeText)
  ) {
    return Math.min(defaultTimeoutMs, 4 * 60 * 1000);
  }
  return defaultTimeoutMs;
}

export function isHermesProgressArtifactRelativePath(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\.?\//, "");
  return normalized.startsWith("publish/") && /\.(?:json|ndjson|png|jpe?g|webp)$/i.test(normalized);
}

export type HermesEffectiveProgressTimestampInput = {
  stateProgressTimestamp?: string;
  activePublishUpdatedAt?: string;
  latestArtifactUpdatedAt?: string;
  latestPublishedUpdatedAt?: string;
};

export type HermesEffectiveProgressTimestampResult = {
  timestamp: string;
  source: "state_progress" | "active_publish" | "latest_publish_artifact" | "latest_published";
};

export function resolveHermesEffectiveProgressTimestamp(
  input: HermesEffectiveProgressTimestampInput
): HermesEffectiveProgressTimestampResult | undefined {
  const candidates = [
    { timestamp: input.stateProgressTimestamp, source: "state_progress" as const },
    { timestamp: input.activePublishUpdatedAt, source: "active_publish" as const },
    { timestamp: input.latestArtifactUpdatedAt, source: "latest_publish_artifact" as const },
    { timestamp: input.latestPublishedUpdatedAt, source: "latest_published" as const }
  ]
    .filter((candidate): candidate is HermesEffectiveProgressTimestampResult =>
      Boolean(candidate.timestamp && Number.isFinite(Date.parse(candidate.timestamp)))
    )
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));

  return candidates[0];
}

export function selectHermesActiveRunIdFromLogLines(lines: string[]): string | undefined {
  const pattern = /auto-listing run started:\s*([0-9]{8}-[0-9]{6})/;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const match = pattern.exec(lines[index] || "");
    if (match) {
      return match[1];
    }
  }
  return undefined;
}

export type HermesExpectedResultFileInput = {
  running: boolean;
  activeRuntimeDir?: string;
};

export function shouldUseExpectedResultFileInRunningStatus(input: HermesExpectedResultFileInput): boolean {
  return !input.running || !input.activeRuntimeDir;
}

export type HermesStartPauseSignalInput = {
  pauseSignalExists: boolean;
  runnerJobRunning: boolean;
};

export function shouldClearPauseSignalOnHermesStart(input: HermesStartPauseSignalInput): boolean {
  return input.pauseSignalExists;
}

export type HermesPublishProgressExposureInput = {
  running: boolean;
  publishProgressAvailable: boolean;
  currentTaskStatus?: string;
  stateProgressTimestamp?: string;
  publishProgressTimestamp?: string;
};

export function shouldExposePublishProgressInHermesStatus(input: HermesPublishProgressExposureInput): boolean {
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

export type HermesHistoricalResultSuppressionInput = {
  running: boolean;
  publishProgressAvailable: boolean;
  resultOk?: boolean;
  resultStatus?: string;
  activeRuntimeDir?: string;
  resultRuntimeDir?: string;
};

export function shouldSuppressHistoricalResultInHermesStatus(input: HermesHistoricalResultSuppressionInput): boolean {
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

export type HermesStateCurrentTaskSuppressionInput = {
  running: boolean;
  publishProgressAvailable: boolean;
  latestProgressStep?: string;
  currentTaskStatus?: string;
};

export function shouldSuppressStateCurrentTaskInHermesStatus(input: HermesStateCurrentTaskSuppressionInput): boolean {
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

export type HermesStartAfterFeishuRefreshInput = {
  currentBatchComplete: boolean;
  refreshedBatchChanged: boolean;
  refreshedBatchComplete: boolean;
  forceRerunCurrentBatch?: boolean;
};

export type HermesStartAfterFeishuRefreshDecision =
  | "start_new_or_pending_batch"
  | "require_rerun_confirmation"
  | "rerun_current_batch";

export function resolveHermesStartAfterFeishuRefresh(
  input: HermesStartAfterFeishuRefreshInput
): HermesStartAfterFeishuRefreshDecision {
  if (input.forceRerunCurrentBatch && input.currentBatchComplete && !input.refreshedBatchChanged) {
    return "rerun_current_batch";
  }
  if (input.refreshedBatchChanged || !input.refreshedBatchComplete) {
    return "start_new_or_pending_batch";
  }
  return "require_rerun_confirmation";
}

export type FullFlowContinuationReason = "initial_full" | "same_batch_pending" | "new_batch_after_refresh";

export type FullFlowFeishuRefreshInput = {
  continuationReason: FullFlowContinuationReason;
  currentBatchComplete?: boolean;
  sameBatchRefreshAvailable?: boolean;
};

export function shouldRefreshFeishuAssetsBeforeFullFlow(input: FullFlowFeishuRefreshInput): boolean {
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
  return input.running && input.stateHasActiveTask && input.publishProgressAvailable;
}

export type HermesStatusResultCandidate = {
  resultFile?: string;
  mtimeMs?: number;
};

export type HermesStatusResultSelectionInput = {
  running: boolean;
  expected?: HermesStatusResultCandidate;
  log?: HermesStatusResultCandidate;
  latest?: HermesStatusResultCandidate;
};

export function selectHermesStatusResultFile(input: HermesStatusResultSelectionInput): string | undefined {
  if (input.running) {
    return input.log?.resultFile || input.expected?.resultFile;
  }

  const candidates = [input.log, input.latest, input.expected]
    .filter((candidate): candidate is Required<HermesStatusResultCandidate> =>
      Boolean(candidate?.resultFile && Number.isFinite(candidate.mtimeMs))
    )
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  return candidates[0]?.resultFile || input.log?.resultFile || input.latest?.resultFile || input.expected?.resultFile;
}

export type HermesStatusRuntimeDirSelectionInput = {
  running: boolean;
  activeRuntimeDir?: string;
  resultRuntimeDir?: string;
  resultFile?: string;
};

export function selectHermesStatusRuntimeDir(input: HermesStatusRuntimeDirSelectionInput): string | undefined {
  if (input.running && input.activeRuntimeDir) {
    return input.activeRuntimeDir;
  }
  return input.resultRuntimeDir || (input.resultFile ? input.resultFile.replace(/\/result\.json$/, "") : undefined) || input.activeRuntimeDir;
}

export function isHermesSupervisorProcessCommand(command: string): boolean {
  return /\bnode\b/.test(command) && /dist\/src\/cli\/hermes-auto-listing-supervisor\.js/.test(command);
}

export function isHermesChildProcessCommand(command: string): boolean {
  return (
    /\bnpm run business:auto-listing\b/.test(command) &&
    /auto-listing\.job\.mac-feishu-real\.resume\.generated\.json/.test(command)
  ) || (
    /\bnode\b/.test(command) &&
    /dist\/src\/cli\/flow-mac-feishu\.js\s+--real\b/.test(command)
  );
}

export function shouldTerminateRecordedHermesProcessGroup(input: {
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

export function isHermesRunningProcessConfirmed(input: { pidAlive: boolean; command?: string }): boolean {
  return input.pidAlive && Boolean(input.command && isHermesSupervisorProcessCommand(input.command));
}

export function selectHermesLatestResultFileForJobStatus(input: {
  hasControlJob: boolean;
  latestResultFile?: string;
}): string | undefined {
  return input.hasControlJob ? undefined : input.latestResultFile;
}

export type HermesImageGenerationEvent = {
  timestamp?: string;
  message?: string;
};

export type HermesImageGenerationSummary = {
  status: "reused_raw_images" | "ready" | "generating" | "in_progress";
  count?: number;
  latestMessage: string;
  latestSavedMessage?: string;
  latestSavedImage?: number;
  updatedAt?: string;
  latestSavedAt?: string;
};

export function summarizeHermesImageGenerationEvents(events: HermesImageGenerationEvent[]): HermesImageGenerationSummary | undefined {
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
import { canResumeFeishuBatchArtifacts } from "./feishu-batch-rules.js";
