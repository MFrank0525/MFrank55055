export type FeishuBatchContinuationInput = {
  exitCode: number | null;
  batchComplete: boolean;
};

export function shouldContinueFeishuBatchAfterChildExit(input: FeishuBatchContinuationInput): boolean {
  return input.exitCode === 0 && !input.batchComplete;
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

export type ActiveTaskStatusSummaryInput = {
  running: boolean;
  stateHasActiveTask: boolean;
  publishProgressAvailable: boolean;
};

export function shouldPreferActiveTaskStateSummary(input: ActiveTaskStatusSummaryInput): boolean {
  return input.running && input.stateHasActiveTask && input.publishProgressAvailable;
}
