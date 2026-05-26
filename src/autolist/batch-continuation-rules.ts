export type FeishuBatchContinuationInput = {
  exitCode: number | null;
  batchComplete: boolean;
};

export function shouldContinueFeishuBatchAfterChildExit(input: FeishuBatchContinuationInput): boolean {
  return input.exitCode === 0 && !input.batchComplete;
}

export type FeishuBatchRetryAfterFailureInput = {
  exitCode: number | null;
  batchComplete: boolean;
  retryableFailureMessage?: string;
  recoveryAttempts: number;
  maxRecoveryAttempts: number;
};

export function shouldResumeFeishuBatchAfterRetryableChildFailure(input: FeishuBatchRetryAfterFailureInput): boolean {
  if (input.exitCode === 0 || input.batchComplete || input.recoveryAttempts >= input.maxRecoveryAttempts) {
    return false;
  }
  return /image generation|main image|timed out|timeout|fetch failed|network|socket|terminated|reset|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|UND_ERR|no progress|watchdog|product folders already contain workbook/i.test(
    input.retryableFailureMessage || ""
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

export type HermesHistoricalResultSuppressionInput = {
  running: boolean;
  publishProgressAvailable: boolean;
  resultOk?: boolean;
  resultStatus?: string;
};

export function shouldSuppressHistoricalResultInHermesStatus(input: HermesHistoricalResultSuppressionInput): boolean {
  if (!input.running || !input.publishProgressAvailable) {
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
  return input.exitCode === 0 && input.currentBatchComplete && input.refreshedBatchChanged && !input.refreshedBatchComplete;
}

export type FullFlowContinuationReason = "initial_full" | "same_batch_pending" | "new_batch_after_refresh";

export type FullFlowFeishuRefreshInput = {
  continuationReason: FullFlowContinuationReason;
  currentBatchComplete?: boolean;
};

export function shouldRefreshFeishuAssetsBeforeFullFlow(input: FullFlowFeishuRefreshInput): boolean {
  if (input.currentBatchComplete === false) {
    return false;
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

export function isHermesSupervisorProcessCommand(command: string): boolean {
  return /\bnode\b/.test(command) && /dist\/src\/cli\/hermes-auto-listing-supervisor\.js/.test(command);
}
