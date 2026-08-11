import type { PublishManifestEntry, PublishProductIdentity } from "./publish-manifest.js";
import {
  isManifestEntryAcceptedForBatchCompletionForIdentity,
  isPublishOutcomeAcceptedForBatchCompletion
} from "./publish-manifest.js";
import { getProductCategoryPlan } from "./product-category.js";
import type { ImageTaskState } from "./types.js";

function taskHasAcceptedPublishArtifact(task: ImageTaskState, expectedPublishCount: number): boolean {
  const publishResults = task.publishArtifact?.results || [];
  if (publishResults.length < expectedPublishCount) {
    return false;
  }
  return publishResults.every((result) => isPublishOutcomeAcceptedForBatchCompletion(result));
}

function manifestHasSafePublishCoverage(
  entries: PublishManifestEntry[],
  expectedPublishCount: number,
  identity: PublishProductIdentity
): boolean {
  return entries.filter((entry) => isManifestEntryAcceptedForBatchCompletionForIdentity(entry, identity)).length >= expectedPublishCount;
}

function resolveExpectedPublishCount(task: ImageTaskState, identity: PublishProductIdentity): number {
  const artifactCount = task.shopDistributionArtifact?.distributedFolders?.length || task.generatedProductFolders.length;
  const productCategory = identity.productCategory || task.feishuProductRecord?.productCategory;
  if (!productCategory) {
    return artifactCount;
  }
  const categoryPlan = getProductCategoryPlan(productCategory);
  return Math.max(artifactCount, categoryPlan.shopCodes.length * categoryPlan.imagesPerShop);
}

export function isProductFullyProcessed(input: {
  task: ImageTaskState;
  publishManifestEntries?: PublishManifestEntry[];
  productIdentity: PublishProductIdentity;
}): boolean {
  if (input.task.status !== "cleaned" && input.task.status !== "done") {
    return false;
  }
  return hasCompleteProductPublishCoverage(input);
}

export function hasCompleteProductPublishCoverage(input: {
  task: ImageTaskState;
  publishManifestEntries?: PublishManifestEntry[];
  productIdentity: PublishProductIdentity;
}): boolean {
  const expectedPublishCount = resolveExpectedPublishCount(input.task, input.productIdentity);
  if (expectedPublishCount <= 0) {
    return false;
  }
  return (
    taskHasAcceptedPublishArtifact(input.task, expectedPublishCount) ||
    manifestHasSafePublishCoverage(input.publishManifestEntries || [], expectedPublishCount, input.productIdentity)
  );
}
