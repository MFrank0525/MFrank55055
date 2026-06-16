import type { PublishFinalVerifyStatus, PublishManifestEntry, PublishProductIdentity } from "./publish-manifest.js";
import {
  isManifestEntryAcceptedForBatchCompletionForIdentity,
  SAFE_PUBLISH_FINAL_VERIFY_STATUSES,
  BATCH_COMPLETION_FINAL_VERIFY_STATUSES
} from "./publish-manifest.js";
import type { ImageTaskState } from "./types.js";

function taskHasSafePublishArtifact(task: ImageTaskState, expectedPublishCount: number): boolean {
  const publishResults = task.publishArtifact?.results || [];
  if (publishResults.length < expectedPublishCount) {
    return false;
  }
  return publishResults.every((result) =>
    (
      result.ok === true &&
      result.status === "published" &&
      SAFE_PUBLISH_FINAL_VERIFY_STATUSES.includes(result.finalVerifyStatus as PublishFinalVerifyStatus)
    ) ||
    (
      result.status === "failed" &&
      result.finalVerifyStatus === "submit_accepted_unconfirmed" &&
      result.errorClass === "final_publish_state_uncertain" &&
      BATCH_COMPLETION_FINAL_VERIFY_STATUSES.includes(result.finalVerifyStatus as PublishFinalVerifyStatus)
    )
  );
}

function manifestHasSafePublishCoverage(
  entries: PublishManifestEntry[],
  expectedPublishCount: number,
  identity: PublishProductIdentity
): boolean {
  return entries.filter((entry) => isManifestEntryAcceptedForBatchCompletionForIdentity(entry, identity)).length >= expectedPublishCount;
}

export function isProductFullyProcessed(input: {
  task: ImageTaskState;
  publishManifestEntries?: PublishManifestEntry[];
  productIdentity: PublishProductIdentity;
}): boolean {
  if (input.task.status !== "cleaned" && input.task.status !== "done") {
    return false;
  }
  const expectedPublishCount =
    input.task.shopDistributionArtifact?.distributedFolders?.length || input.task.generatedProductFolders.length;
  if (expectedPublishCount <= 0) {
    return false;
  }
  return (
    taskHasSafePublishArtifact(input.task, expectedPublishCount) ||
    manifestHasSafePublishCoverage(input.publishManifestEntries || [], expectedPublishCount, input.productIdentity)
  );
}
