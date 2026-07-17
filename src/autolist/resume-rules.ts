import { AUTO_LISTING_STEPS, normalizeAutoListingStep, type AutoListingStep } from "./types.js";
import { isManifestEntryAcceptedForBatchCompletion, SAFE_PUBLISH_FINAL_VERIFY_STATUSES, type PublishFinalVerifyStatus } from "./publish-manifest.js";

export interface ResumeTaskLike {
  status?: string;
  error?: {
    step?: string;
    message?: string;
  };
  sellingPointArtifact?: {
    sellingPointText?: string;
  };
  deepseekArtifact?: {
    wordFiles?: string[];
    prompts?: string[];
  };
  generatedProductFolders?: string[];
  shopDistributionArtifact?: {
    distributedFolders?: string[];
  };
  publishArtifact?: {
    results?: Array<{
      ok?: boolean;
      status?: string;
      finalVerifyStatus?: string;
    }>;
  };
}

function hasSafePublishCompletion(task: ResumeTaskLike, distributedFolderCount: number): boolean {
  const results = task.publishArtifact?.results || [];
  if (distributedFolderCount <= 0 || results.length < distributedFolderCount) {
    return false;
  }
  return results.every((result) =>
    result.ok === true &&
    result.status === "published" &&
    SAFE_PUBLISH_FINAL_VERIFY_STATUSES.includes(result.finalVerifyStatus as PublishFinalVerifyStatus)
  );
}

export function inferResumeStartStepForTask(task: ResumeTaskLike): AutoListingStep {
  const distributedFolders = task.shopDistributionArtifact?.distributedFolders || task.generatedProductFolders || [];
  if (task.status === "failed") {
    if (
      distributedFolders.length > 0 &&
      /product folders already contain workbook/i.test(task.error?.message || "")
    ) {
      return "published";
    }
    if (/No main image candidate matched current shop watermark|shop watermark/i.test(task.error?.message || "")) {
      return "main_images_generated";
    }
    const failedStep = task.error?.step;
    if (failedStep === "poster_prompts_generated") {
      return "selling_points_loaded";
    }
    if (failedStep && (AUTO_LISTING_STEPS as readonly string[]).includes(failedStep)) {
      return failedStep as AutoListingStep;
    }
    if (/image generation|generated main image|main image|data items|downloadable image/i.test(task.error?.message || "")) {
      return "main_images_generated";
    }
    if (task.deepseekArtifact?.wordFiles?.length || task.deepseekArtifact?.prompts?.length) {
      return "main_images_generated";
    }
    if (task.sellingPointArtifact?.sellingPointText) {
      return "poster_prompts_generated";
    }
    return "source_images_discovered";
  }

  if (task.status === "shop_distributed" && distributedFolders.length > 0) {
    return "published";
  }

  const normalizedStatus = normalizeAutoListingStep(task.status as any);
  if (normalizedStatus === "published") {
    return hasSafePublishCompletion(task, distributedFolders.length) ? "cleaned" : "published";
  }
  if (normalizedStatus === "source_images_discovered") {
    return "source_images_discovered";
  }
  const currentIndex = AUTO_LISTING_STEPS.indexOf(normalizedStatus);
  if (currentIndex < 0) {
    return "source_images_discovered";
  }
  return AUTO_LISTING_STEPS[Math.min(currentIndex + 1, AUTO_LISTING_STEPS.length - 1)];
}

export function shouldReplaceStaleResumeStartStep(input: {
  resumeStartStep?: string;
  inferredStateStartStep?: string;
  stateProductFolderCount: number;
  safelyPublishedCount: number;
}): boolean {
  if (!input.resumeStartStep || !input.inferredStateStartStep || input.resumeStartStep === input.inferredStateStartStep) {
    return false;
  }
  return input.stateProductFolderCount > 0 || input.safelyPublishedCount > 0;
}

export function shouldInvalidatePublishedResumeWithoutProductFolders(input: {
  resumeStartStep?: string;
  declaredProductFolderCount: number;
  actualProductFolderCount: number;
}): boolean {
  return (
    input.resumeStartStep === "published" &&
    input.declaredProductFolderCount > 0 &&
    input.actualProductFolderCount < input.declaredProductFolderCount
  );
}

export function selectRemainingResumeProductFolderNames(input: {
  allProductFolderNames: string[];
  manifestEntries: Array<{ productFolder?: string; status?: string; finalVerifyStatus?: string; errorClass?: string }>;
}): string[] {
  const safelyPublishedNames = new Set(input.manifestEntries
    .filter((entry) => isManifestEntryAcceptedForBatchCompletion(entry as never))
    .map((entry) => entry.productFolder?.split(/[\\/]/).pop() || "")
    .filter(Boolean));
  return [...new Set(input.allProductFolderNames.filter(Boolean))].filter((name) => !safelyPublishedNames.has(name));
}

export function hasPendingResumeProductFolders(input: {
  resumeProductFolderNames: string[];
  manifestEntries: Array<{ productFolder?: string; status?: string; finalVerifyStatus?: string; errorClass?: string }>;
}): boolean {
  return selectRemainingResumeProductFolderNames({
    allProductFolderNames: input.resumeProductFolderNames,
    manifestEntries: input.manifestEntries
  }).length > 0;
}
