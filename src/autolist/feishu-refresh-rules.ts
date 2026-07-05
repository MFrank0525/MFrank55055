export function shouldRefreshFeishuAssetsToCandidateCache(input: {
  currentBatchComplete?: boolean;
}): boolean {
  return input.currentBatchComplete === true;
}
