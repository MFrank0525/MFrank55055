import type { AutoListingControllerResolvedStatus } from "./batch-continuation-rules.js";

export function shouldPreserveAutoListingControllerCompletedStatusForFeishuCacheInvalid(input: {
  feishuCacheInvalid?: boolean;
  latestResultOk?: boolean;
  latestResultStatus?: string;
}): boolean {
  return input.feishuCacheInvalid === true && input.latestResultOk === true && input.latestResultStatus !== "failed";
}

export function shouldFailAutoListingControllerStatusForFeishuCacheInvalid(input: {
  feishuCacheInvalid?: boolean;
  idleStatus?: AutoListingControllerResolvedStatus | "idle";
  latestResultOk?: boolean;
  latestResultStatus?: string;
}): boolean {
  const latestResultCompleted = shouldPreserveAutoListingControllerCompletedStatusForFeishuCacheInvalid(input);
  return input.feishuCacheInvalid === true && input.idleStatus !== "completed" && !latestResultCompleted;
}
