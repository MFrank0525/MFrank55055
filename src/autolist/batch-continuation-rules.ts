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
