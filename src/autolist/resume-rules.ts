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

export interface CanonicalResumeManifestEntry {
  targetKey?: string;
  targetIdentity?: {
    batchFingerprint?: string;
    recordId?: string;
    taskId?: string;
    shopCode?: string;
    watermarkNo?: number;
  };
  productFolder?: string;
  status?: string;
  finalVerifyStatus?: string;
  errorClass?: string;
}

export function resolveCanonicalRecoveryTask<T extends {
  taskId?: string;
  status?: string;
  error?: unknown;
  publishArtifact?: { results?: unknown[] };
}>(input: { tasks: T[]; currentTaskId?: string }): T | undefined {
  const hasTerminalEvidence = (task: T): boolean =>
    task.status === "failed" || Boolean(task.error) || (task.publishArtifact?.results?.length || 0) > 0;
  const explicit = input.currentTaskId
    ? input.tasks.find((task) => task.taskId === input.currentTaskId && hasTerminalEvidence(task))
    : undefined;
  if (explicit) {
    return explicit;
  }
  const failedTasks = input.tasks.filter((task) => task.status === "failed" || Boolean(task.error));
  if (failedTasks.length > 1) {
    throw new Error(`Canonical recovery is ambiguous: multiple failed tasks (${failedTasks.map((task) => task.taskId || "<missing>").join(", ")}).`);
  }
  if (failedTasks.length === 1) {
    return failedTasks[0];
  }
  const publishEvidenceTasks = input.tasks.filter((task) => (task.publishArtifact?.results?.length || 0) > 0);
  if (publishEvidenceTasks.length > 1) {
    throw new Error(`Canonical recovery is ambiguous: multiple tasks contain publish evidence (${publishEvidenceTasks.map((task) => task.taskId || "<missing>").join(", ")}).`);
  }
  return publishEvidenceTasks[0];
}

export function resolveCanonicalResumeDecision(input: {
  batchFingerprint: string;
  recordId?: string;
  taskId: string;
  inferredArtifactStartStep: AutoListingStep;
  productFolders: string[];
  manifestEntries: CanonicalResumeManifestEntry[];
  expectedTargetCount?: number;
}): {
  startStep: AutoListingStep;
  resumeProductFolderNames: string[];
  source: "publish-manifest" | "task-artifacts";
} {
  const scopedManifest = input.manifestEntries.filter((entry) => {
    const identity = entry.targetIdentity;
    return Boolean(
      identity &&
      identity.batchFingerprint === input.batchFingerprint &&
      identity.taskId === input.taskId &&
      (!input.recordId || identity.recordId === input.recordId)
    );
  });
  const orderedManifest = [...scopedManifest].sort(
    (left, right) => Number(left.targetIdentity?.watermarkNo || 0) - Number(right.targetIdentity?.watermarkNo || 0)
  );
  if (scopedManifest.length > 0 && input.expectedTargetCount !== undefined) {
    if (scopedManifest.length !== input.expectedTargetCount) {
      throw new Error(
        `Canonical publish manifest coverage is incomplete for ${input.taskId}: expected ${input.expectedTargetCount}, got ${scopedManifest.length}.`
      );
    }
    const targetKeys = scopedManifest.map((entry) => entry.targetKey || [
      entry.targetIdentity?.batchFingerprint,
      entry.targetIdentity?.recordId,
      entry.targetIdentity?.taskId,
      entry.targetIdentity?.shopCode,
      entry.targetIdentity?.watermarkNo
    ].join("|"));
    if (new Set(targetKeys).size !== targetKeys.length) {
      throw new Error(`Canonical publish manifest contains duplicate target identities for ${input.taskId}.`);
    }
  }
  const folderName = (folder: string | undefined): string => String(folder || "").split(/[\\/]/).pop() || "";
  const allProductFolderNames = Array.from(new Set([
    ...orderedManifest.map((entry) => folderName(entry.productFolder)),
    ...input.productFolders.map(folderName)
  ].filter(Boolean)));
  if (scopedManifest.length > 0) {
    const acceptedNames = new Set(
      scopedManifest
        .filter((entry) => isManifestEntryAcceptedForBatchCompletion(entry as never))
        .map((entry) => folderName(entry.productFolder))
        .filter(Boolean)
    );
    const remainingNames = allProductFolderNames.filter((name) => !acceptedNames.has(name));
    return remainingNames.length > 0
      ? { startStep: "published", resumeProductFolderNames: remainingNames, source: "publish-manifest" }
      : { startStep: "cleaned", resumeProductFolderNames: allProductFolderNames, source: "publish-manifest" };
  }
  return {
    startStep: input.inferredArtifactStartStep,
    resumeProductFolderNames: allProductFolderNames,
    source: "task-artifacts"
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
