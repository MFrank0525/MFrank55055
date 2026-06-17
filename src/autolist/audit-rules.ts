import path from "node:path";
import type { FeishuProductRecord } from "../feishu/types.js";
import { getProductCategoryPlan } from "./product-category.js";
import type { ImageTaskState, MainImageGeneratedFile } from "./types.js";
import { SAFE_PUBLISH_FINAL_VERIFY_STATUSES, BATCH_COMPLETION_FINAL_VERIFY_STATUSES, type PublishManifestEntry } from "./publish-manifest.js";

export type AutoListingAuditSeverity = "error" | "warning";

export interface AutoListingAuditIssue {
  severity: AutoListingAuditSeverity;
  code: string;
  message: string;
  recordId?: string;
  filePath?: string;
}

export interface AutoListingContinuityAuditInput {
  records: FeishuProductRecord[];
  processedImages: Iterable<string>;
  existingFiles: Iterable<string>;
  discoveredRunImageCount?: number;
}

export interface AutoListingContinuityAuditResult {
  ok: boolean;
  summary: {
    recordCount: number;
    processedRecordCount: number;
    pendingRecordCount: number;
    declaredWhiteImageCount: number;
    declaredQualificationImageCount: number;
    existingFileCount: number;
    unmatchedProcessedImageCount: number;
    discoveredRunImageCount?: number;
  };
  errors: AutoListingAuditIssue[];
  warnings: AutoListingAuditIssue[];
}

export interface FeishuBatchProgressInput {
  records: FeishuProductRecord[];
  processedImages: Iterable<string>;
}

export interface FeishuBatchProgressSummary {
  recordCount: number;
  processedRecordCount: number;
  pendingRecordCount: number;
  pendingSourceImages: string[];
  batchComplete: boolean;
}

export interface CompletedBatchResidueAuditResult {
  ok: boolean;
  summary: {
    runDirCount: number;
    paidLedgerBatchExists: boolean;
  };
  errors: AutoListingAuditIssue[];
  warnings: AutoListingAuditIssue[];
}

export interface MainImageGenerationAuditInput {
  tasks: ImageTaskState[];
  existingFiles: Iterable<string>;
  expectedPromptCount?: number;
  expectedImagesPerPrompt: number;
  simulateOnly: boolean;
}

export interface MainImageGenerationAuditResult {
  ok: boolean;
  summary: {
    auditedTaskCount: number;
    generatedImageCount: number;
    expectedImageCount: number;
  };
  errors: AutoListingAuditIssue[];
  warnings: AutoListingAuditIssue[];
}

export interface PublishCoverageAuditInput {
  tasks: ImageTaskState[];
  manifestEntries: PublishManifestEntry[];
}

export interface PublishCoverageAuditResult {
  ok: boolean;
  summary: {
    auditedTaskCount: number;
    expectedPublishCount: number;
    safelyPublishedCount: number;
  };
  errors: AutoListingAuditIssue[];
  warnings: AutoListingAuditIssue[];
}

function normalizePath(value: string): string {
  return path.resolve(value);
}

function localFiles(items: Array<{ localFile?: string }>): string[] {
  return items.map((item) => item.localFile || "").filter(Boolean).map(normalizePath);
}

export function collectFeishuProductAssetFiles(records: FeishuProductRecord[]): string[] {
  const seen = new Set<string>();
  const files: string[] = [];
  for (const record of records) {
    for (const filePath of [
      ...localFiles(record.whiteBackgroundImages || []),
      ...localFiles(record.qualificationImages || [])
    ]) {
      if (seen.has(filePath)) {
        continue;
      }
      seen.add(filePath);
      files.push(filePath);
    }
  }
  return files;
}

function isRecordProcessed(record: FeishuProductRecord, processedImages: Set<string>): boolean {
  return localFiles(record.whiteBackgroundImages || []).some((filePath) => processedImages.has(filePath));
}

function issue(
  severity: AutoListingAuditSeverity,
  code: string,
  message: string,
  recordId?: string,
  filePath?: string
): AutoListingAuditIssue {
  return { severity, code, message, recordId, filePath };
}

export function auditCompletedBatchResidue(input: {
  batchComplete: boolean;
  runDirCount: number;
  paidLedgerBatchExists: boolean;
}): CompletedBatchResidueAuditResult {
  const errors: AutoListingAuditIssue[] = [];
  if (input.batchComplete && input.runDirCount > 1) {
    errors.push(issue("error", "completed_batch_stale_runs", `Completed batch retains ${input.runDirCount} run directories; at most the latest status run may remain.`));
  }
  if (input.batchComplete && input.paidLedgerBatchExists) {
    errors.push(issue("error", "completed_batch_paid_ledger_residue", "Completed batch still retains a paid-image submission ledger."));
  }
  return {
    ok: errors.length === 0,
    summary: {
      runDirCount: input.runDirCount,
      paidLedgerBatchExists: input.paidLedgerBatchExists
    },
    errors,
    warnings: []
  };
}

export function auditAutoListingContinuity(input: AutoListingContinuityAuditInput): AutoListingContinuityAuditResult {
  const processedImages = new Set(Array.from(input.processedImages || []).filter(Boolean).map(normalizePath));
  const existingFiles = new Set(Array.from(input.existingFiles || []).filter(Boolean).map(normalizePath));
  const errors: AutoListingAuditIssue[] = [];
  const warnings: AutoListingAuditIssue[] = [];
  let processedRecordCount = 0;
  let declaredWhiteImageCount = 0;
  let declaredQualificationImageCount = 0;
  const matchedProcessedImages = new Set<string>();

  for (const [index, record] of input.records.entries()) {
    const rowLabel = `row ${index + 1}${record.recordId ? ` (${record.recordId})` : ""}`;
    const whiteImages = localFiles(record.whiteBackgroundImages || []);
    const qualificationImages = localFiles(record.qualificationImages || []);
    declaredWhiteImageCount += whiteImages.length;
    declaredQualificationImageCount += qualificationImages.length;

    if (whiteImages.length === 0) {
      errors.push(issue("error", "white_image_not_declared", `Feishu ${rowLabel} has no downloaded white background image.`, record.recordId));
      continue;
    }

    const processed = isRecordProcessed(record, processedImages);
    if (processed) {
      processedRecordCount += 1;
      for (const filePath of whiteImages) {
        if (processedImages.has(filePath)) {
          matchedProcessedImages.add(filePath);
        }
      }
      continue;
    }

    for (const filePath of whiteImages) {
      if (!existingFiles.has(filePath)) {
        errors.push(issue("error", "pending_white_image_missing", `Pending Feishu ${rowLabel} white background image is missing.`, record.recordId, filePath));
      }
    }

    for (const filePath of qualificationImages) {
      if (!existingFiles.has(filePath)) {
        errors.push(issue("error", "pending_qualification_image_missing", `Pending Feishu ${rowLabel} qualification image is missing.`, record.recordId, filePath));
      }
    }
  }

  const pendingRecordCount = input.records.length - processedRecordCount;
  for (const filePath of processedImages) {
    if (!matchedProcessedImages.has(filePath)) {
      warnings.push(issue("warning", "processed_image_not_in_feishu_records", "Processed image is not referenced by the current Feishu product cache.", undefined, filePath));
    }
  }

  if (input.discoveredRunImageCount !== undefined && input.discoveredRunImageCount < pendingRecordCount) {
    errors.push(issue(
      "error",
      "run_discovered_too_few_images",
      `Current run discovered ${input.discoveredRunImageCount} image(s), but ${pendingRecordCount} Feishu product(s) are still pending.`
    ));
  }

  return {
    ok: errors.length === 0,
    summary: {
      recordCount: input.records.length,
      processedRecordCount,
      pendingRecordCount,
      declaredWhiteImageCount,
      declaredQualificationImageCount,
      existingFileCount: existingFiles.size,
      unmatchedProcessedImageCount: processedImages.size - matchedProcessedImages.size,
      discoveredRunImageCount: input.discoveredRunImageCount
    },
    errors,
    warnings
  };
}

export function summarizeFeishuBatchProgress(input: FeishuBatchProgressInput): FeishuBatchProgressSummary {
  const processedImages = new Set(Array.from(input.processedImages || []).filter(Boolean).map(normalizePath));
  let processedRecordCount = 0;
  const pendingSourceImages: string[] = [];

  for (const record of input.records) {
    if (isRecordProcessed(record, processedImages)) {
      processedRecordCount += 1;
      continue;
    }
    const sourceImage = localFiles(record.whiteBackgroundImages || [])[0];
    if (sourceImage) {
      pendingSourceImages.push(sourceImage);
    }
  }

  const pendingRecordCount = input.records.length - processedRecordCount;
  return {
    recordCount: input.records.length,
    processedRecordCount,
    pendingRecordCount,
    pendingSourceImages,
    batchComplete: pendingRecordCount === 0
  };
}

function countByPrompt(files: MainImageGeneratedFile[]): Map<number, number> {
  const counts = new Map<number, number>();
  for (const file of files) {
    counts.set(file.promptIndex, (counts.get(file.promptIndex) || 0) + 1);
  }
  return counts;
}

function pushDuplicatePathIssue(
  seen: Set<string>,
  errors: AutoListingAuditIssue[],
  code: string,
  message: string,
  filePath: string,
  taskId: string
): void {
  const normalized = normalizePath(filePath);
  if (seen.has(normalized)) {
    errors.push(issue("error", code, message, taskId, normalized));
    return;
  }
  seen.add(normalized);
}

export function auditMainImageGeneration(input: MainImageGenerationAuditInput): MainImageGenerationAuditResult {
  const existingFiles = new Set(Array.from(input.existingFiles || []).filter(Boolean).map(normalizePath));
  const errors: AutoListingAuditIssue[] = [];
  const warnings: AutoListingAuditIssue[] = [];
  const activeImageFilePaths = new Set<string>();
  const activeProductFolders = new Set<string>();
  const tasks = input.tasks.filter((task) => Boolean(task.mainImageArtifact));
  let generatedImageCount = 0;
  let expectedImageCount = 0;

  for (const task of tasks) {
    const generatedFiles = task.mainImageArtifact?.generatedFiles || [];
    const cleanedArtifactsWereRemoved =
      ["cleaned", "done"].includes(task.status) &&
      (task.cleanupArtifact?.removedPaths || []).length > 0;
    const taskImageFilePaths = new Set<string>();
    const taskProductFolders = new Set<string>();
    const promptCount = input.expectedPromptCount ?? getProductCategoryPlan(task.feishuProductRecord?.productCategory).promptCount;
    const expectedForTask = promptCount * input.expectedImagesPerPrompt;
    expectedImageCount += expectedForTask;
    generatedImageCount += generatedFiles.length;

    if (generatedFiles.length !== expectedForTask) {
      errors.push(issue(
        "error",
        "main_image_total_count_mismatch",
        `Task ${task.taskId} generated ${generatedFiles.length} main image(s), expected ${expectedForTask}.`,
        task.taskId
      ));
    }

    const promptCounts = countByPrompt(generatedFiles);
    for (let promptIndex = 1; promptIndex <= promptCount; promptIndex += 1) {
      const actual = promptCounts.get(promptIndex) || 0;
      if (actual !== input.expectedImagesPerPrompt) {
        errors.push(issue(
          "error",
          "main_image_prompt_count_mismatch",
          `Task ${task.taskId} prompt ${promptIndex} generated ${actual} image(s), expected ${input.expectedImagesPerPrompt}.`,
          task.taskId
        ));
      }
    }

    for (const file of generatedFiles) {
      if (file.imageFile) {
        pushDuplicatePathIssue(
          taskImageFilePaths,
          errors,
          "main_image_duplicate_file",
          `Generated main image path is duplicated: ${file.imageFile}`,
          file.imageFile,
          task.taskId
        );
        if (!cleanedArtifactsWereRemoved) {
          pushDuplicatePathIssue(
            activeImageFilePaths,
            errors,
            "main_image_duplicate_file",
            `Generated main image path is duplicated: ${file.imageFile}`,
            file.imageFile,
            task.taskId
          );
        }
        if (!cleanedArtifactsWereRemoved && !input.simulateOnly && !existingFiles.has(normalizePath(file.imageFile))) {
          errors.push(issue("error", "main_image_file_missing", `Generated main image file is missing: ${file.imageFile}`, task.taskId, file.imageFile));
        }
      }

      if (file.productFolder) {
        const normalizedProductFolder = normalizePath(file.productFolder);
        const firstSeenProductFolder = !taskProductFolders.has(normalizedProductFolder);
        taskProductFolders.add(normalizedProductFolder);
        if (!cleanedArtifactsWereRemoved && firstSeenProductFolder) {
          pushDuplicatePathIssue(
            activeProductFolders,
            errors,
            "main_image_duplicate_product_folder",
            `Generated product folder path is duplicated across active tasks: ${file.productFolder}`,
            file.productFolder,
            task.taskId
          );
        }
        if (!cleanedArtifactsWereRemoved && firstSeenProductFolder && !input.simulateOnly && !existingFiles.has(normalizedProductFolder)) {
          errors.push(issue("error", "main_image_product_folder_missing", `Generated product folder is missing: ${file.productFolder}`, task.taskId, file.productFolder));
        }
      }

      if (file.rawImageFile && !cleanedArtifactsWereRemoved && !input.simulateOnly && !existingFiles.has(normalizePath(file.rawImageFile))) {
        errors.push(issue("error", "main_image_raw_file_missing", `Generated raw main image file is missing: ${file.rawImageFile}`, task.taskId, file.rawImageFile));
      }
    }
  }

  return {
    ok: errors.length === 0,
    summary: {
      auditedTaskCount: tasks.length,
      generatedImageCount,
      expectedImageCount
    },
    errors,
    warnings
  };
}

function isSafePublishSignal(status?: string, finalVerifyStatus?: string): boolean {
  return status === "published" && SAFE_PUBLISH_FINAL_VERIFY_STATUSES.includes(finalVerifyStatus as never);
}

function isAcceptedBatchCompletionSignal(status?: string, finalVerifyStatus?: string, errorClass?: string): boolean {
  if (!BATCH_COMPLETION_FINAL_VERIFY_STATUSES.includes(finalVerifyStatus as never)) {
    return false;
  }
  if (isSafePublishSignal(status, finalVerifyStatus)) {
    return true;
  }
  return status === "failed" &&
    finalVerifyStatus === "submit_accepted_unconfirmed" &&
    errorClass === "final_publish_state_uncertain";
}

function taskExpectedPublishFolders(task: ImageTaskState): string[] {
  if (task.shopDistributionArtifact?.distributedFolders?.length) {
    return task.shopDistributionArtifact.distributedFolders;
  }
  if (task.publishArtifact?.results?.length) {
    return task.publishArtifact.results.map((item) => item.productFolder);
  }
  if (["published", "cleaned", "done"].includes(task.status)) {
    return task.generatedProductFolders || [];
  }
  return [];
}

export function auditPublishCoverage(input: PublishCoverageAuditInput): PublishCoverageAuditResult {
  const errors: AutoListingAuditIssue[] = [];
  const warnings: AutoListingAuditIssue[] = [];
  const tasks = input.tasks.filter((task) => taskExpectedPublishFolders(task).length > 0 || Boolean(task.publishArtifact));
  let expectedPublishCount = 0;
  let safelyPublishedCount = 0;
  const manifestByFolder = new Map(input.manifestEntries.map((entry) => [normalizePath(entry.productFolder), entry]));

  for (const task of tasks) {
    const resultByFolder = new Map((task.publishArtifact?.results || []).map((result) => [normalizePath(result.productFolder), result]));
    for (const folder of taskExpectedPublishFolders(task)) {
      expectedPublishCount += 1;
      const normalizedFolder = normalizePath(folder);
      const result = resultByFolder.get(normalizedFolder);
      const manifest = manifestByFolder.get(normalizedFolder);
      const resultSafe = isSafePublishSignal(result?.status, result?.finalVerifyStatus);
      const manifestSafe = isSafePublishSignal(manifest?.status, manifest?.finalVerifyStatus);
      if (resultSafe || manifestSafe) {
        safelyPublishedCount += 1;
        continue;
      }
      const resultAccepted = isAcceptedBatchCompletionSignal(result?.status, result?.finalVerifyStatus, result?.errorClass);
      const manifestAccepted = isAcceptedBatchCompletionSignal(manifest?.status, manifest?.finalVerifyStatus, manifest?.errorClass);
      if (resultAccepted || manifestAccepted) {
        safelyPublishedCount += 1;
        warnings.push(issue(
          "warning",
          "publish_result_submit_accepted_unconfirmed",
          `Publish submit was accepted but final platform success was not observed for product folder: ${folder}`,
          task.taskId,
          folder
        ));
        continue;
      }
      const failedResult = result && (result.status === "failed" || result.ok === false || result.finalVerifyStatus === "needs_manual_review");
      const failedManifest = manifest && (manifest.status === "failed" || manifest.finalVerifyStatus === "needs_manual_review");
      errors.push(issue(
        "error",
        failedResult || failedManifest ? "publish_result_unsafe" : "publish_result_missing",
        failedResult || failedManifest
          ? `Publish result is not safe for product folder: ${folder}`
          : `No safe publish result was found for product folder: ${folder}`,
        task.taskId,
        folder
      ));
    }
  }

  return {
    ok: errors.length === 0,
    summary: {
      auditedTaskCount: tasks.length,
      expectedPublishCount,
      safelyPublishedCount
    },
    errors,
    warnings
  };
}
