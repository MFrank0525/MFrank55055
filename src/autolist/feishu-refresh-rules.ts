import type { FullFlowContinuationReason } from "./batch-continuation-rules.js";

export function shouldRefreshFeishuAssetsToCandidateCache(input: {
  currentBatchComplete?: boolean;
}): boolean {
  return input.currentBatchComplete === true;
}

export function shouldSupervisorSkipFeishuAssetsRefresh(
  reason: FullFlowContinuationReason,
  localAssetCacheUnsafe = false
): boolean {
  return (reason === "same_batch_pending" || reason === "new_batch_after_refresh") && !localAssetCacheUnsafe;
}
