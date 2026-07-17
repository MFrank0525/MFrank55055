import path from "node:path";
import type { FeishuProductRecord } from "../feishu/types.js";
import type { ImageDimensions } from "../utils/image-dimensions.js";
import { getProductCategoryPlan, resolveMainImageShopAssignments } from "./product-category.js";
import { buildPublishTargetIdentity, publishTargetKey } from "./publish-identity.js";
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
  expectedDiscoveredRunImageCount?: number;
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
    expectedDiscoveredRunImageCount?: number;
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

export interface IntermediateArtifactResidueAuditInput {
  tasks: Array<{
    taskId: string;
    status: string;
    publishArtifact?: {
      results: Array<{
        productFolder: string;
        resultFile?: string;
      }>;
    };
    cleanupArtifact?: {
      removedPaths: string[];
    };
  }>;
  existingPaths: Iterable<string>;
}

export interface IntermediateArtifactResidueAuditResult {
  ok: boolean;
  summary: {
    auditedTaskCount: number;
    residualPublishRuntimeCount: number;
    missingCleanupEvidenceCount: number;
  };
  errors: AutoListingAuditIssue[];
  warnings: AutoListingAuditIssue[];
}

export interface MainImageGenerationAuditInput {
  tasks: ImageTaskState[];
  existingFiles: Iterable<string>;
  imageDimensions?: ReadonlyMap<string, ImageDimensions>;
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

export interface PublishMainImageSubsetAuditInput {
  taskId: string;
  generatedFiles: MainImageGeneratedFile[];
  expectedProductFolders: string[];
  existingFiles: Iterable<string>;
  imageDimensions?: ReadonlyMap<string, ImageDimensions>;
  simulateOnly: boolean;
}

export interface PublishCoverageAuditInput {
  tasks: ImageTaskState[];
  manifestEntries: PublishManifestEntry[];
  batchFingerprint?: string;
  allowInProgress?: boolean;
}

export interface PublishCoverageAuditResult {
  ok: boolean;
  summary: {
    auditedTaskCount: number;
    expectedPublishCount: number;
    safelyPublishedCount: number;
    inProgressPublishCount: number;
  };
  errors: AutoListingAuditIssue[];
  warnings: AutoListingAuditIssue[];
}

export function buildCanonicalPublishTargetKeys(input: {
  batchFingerprint: string;
  tasks: Array<{
    taskId: string;
    recordId?: string;
    productCategory?: string;
  }>;
}): string[] {
  return input.tasks.flatMap((task) => {
    const plan = getProductCategoryPlan(task.productCategory);
    const assignments = resolveMainImageShopAssignments({
      shopCodes: plan.shopCodes,
      imagesPerShop: plan.imagesPerShop,
      totalImageCount: plan.titleCount
    });
    return assignments.map((assignment, index) => publishTargetKey(buildPublishTargetIdentity({
      batchFingerprint: input.batchFingerprint,
      recordId: task.recordId || "",
      taskId: task.taskId,
      shopCode: assignment.shopCode,
      watermarkNo: index + 1
    })));
  });
}

function normalizePath(value: string): string {
  return path.resolve(value);
}

function pathContains(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function localFiles(items: Array<{ localFile?: string }>): string[] {
  return items.map((item) => item.localFile || "").filter(Boolean).map(normalizePath);
}

function recordDuplicateLocalFileIssues(input: {
  files: string[];
  ownerRecordId: string;
  label: string;
  seenByFile: Map<string, string>;
  errors: AutoListingAuditIssue[];
}): void {
  for (const filePath of input.files) {
    const previousRecordId = input.seenByFile.get(filePath);
    if (previousRecordId && previousRecordId !== input.ownerRecordId) {
      input.errors.push(issue(
        "error",
        input.label === "white" ? "duplicate_white_image_local_file" : "duplicate_qualification_image_local_file",
        `Feishu records ${previousRecordId} and ${input.ownerRecordId} share one local ${input.label} image path; refresh assets before continuing.`,
        input.ownerRecordId,
        filePath
      ));
      continue;
    }
    input.seenByFile.set(filePath, input.ownerRecordId);
  }
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
  if (localFiles(record.whiteBackgroundImages || []).some((filePath) => processedImages.has(filePath))) {
    return true;
  }
  return Boolean(record.recordId && Array.from(processedImages).some((filePath) => filePath.includes(`-${record.recordId}-白底图-`)));
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

export function auditIntermediateArtifactResidue(input: IntermediateArtifactResidueAuditInput): IntermediateArtifactResidueAuditResult {
  const errors: AutoListingAuditIssue[] = [];
  const warnings: AutoListingAuditIssue[] = [];
  const existingPaths = new Set(Array.from(input.existingPaths || []).filter(Boolean).map(normalizePath));
  const existingPathList = [...existingPaths];
  let auditedTaskCount = 0;
  let residualPublishRuntimeCount = 0;
  let missingCleanupEvidenceCount = 0;

  for (const task of input.tasks) {
    if (!["cleaned", "done"].includes(task.status)) {
      continue;
    }
    auditedTaskCount += 1;
    const removedPaths = new Set((task.cleanupArtifact?.removedPaths || []).filter(Boolean).map(normalizePath));
    const publishRuntimeDirs = new Set(
      (task.publishArtifact?.results || [])
        .map((result) => result.resultFile ? path.dirname(result.resultFile) : "")
        .filter(Boolean)
        .map(normalizePath)
    );

    for (const runtimeDir of publishRuntimeDirs) {
      const hasRemovalEvidence = removedPaths.has(runtimeDir) || [...removedPaths].some((removedPath) => pathContains(runtimeDir, removedPath));
      const residualPath = existingPathList.find((existingPath) => existingPath === runtimeDir || pathContains(runtimeDir, existingPath));
      if (residualPath) {
        residualPublishRuntimeCount += 1;
        errors.push(issue(
          "error",
          "completed_product_publish_runtime_residue",
          `Completed product still retains publish runtime artifacts: ${runtimeDir}`,
          task.taskId,
          residualPath
        ));
        continue;
      }
      if (!hasRemovalEvidence) {
        missingCleanupEvidenceCount += 1;
      }
    }
  }

  if (missingCleanupEvidenceCount > 0) {
    warnings.push(issue(
      "warning",
      "completed_product_publish_runtime_cleanup_missing",
      `Completed product cleanup lacks explicit publish runtime removal evidence for ${missingCleanupEvidenceCount} target(s), but no publish runtime residue exists.`
    ));
  }

  return {
    ok: errors.length === 0,
    summary: {
      auditedTaskCount,
      residualPublishRuntimeCount,
      missingCleanupEvidenceCount
    },
    errors,
    warnings
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
  const whiteLocalFileOwners = new Map<string, string>();
  const qualificationLocalFileOwners = new Map<string, string>();

  for (const [index, record] of input.records.entries()) {
    const ownerRecordId = record.recordId || `row-${index + 1}`;
    const rowLabel = `row ${index + 1}${record.recordId ? ` (${record.recordId})` : ""}`;
    const processed = isRecordProcessed(record, processedImages);
    const whiteImages = localFiles(record.whiteBackgroundImages || []);
    const qualificationImages = localFiles(record.qualificationImages || []);
    declaredWhiteImageCount += whiteImages.length;
    declaredQualificationImageCount += qualificationImages.length;

    recordDuplicateLocalFileIssues({
      files: whiteImages,
      ownerRecordId,
      label: "white",
      seenByFile: whiteLocalFileOwners,
      errors
    });
    recordDuplicateLocalFileIssues({
      files: qualificationImages,
      ownerRecordId,
      label: "qualification",
      seenByFile: qualificationLocalFileOwners,
      errors
    });

    if (whiteImages.length === 0 && !processed) {
      errors.push(issue("error", "white_image_not_declared", `Feishu ${rowLabel} has no downloaded white background image.`, record.recordId));
      continue;
    }

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

  const expectedDiscoveredRunImageCount = input.expectedDiscoveredRunImageCount ?? pendingRecordCount;
  if (input.discoveredRunImageCount !== undefined && input.discoveredRunImageCount < expectedDiscoveredRunImageCount) {
    errors.push(issue(
      "error",
      "run_discovered_too_few_images",
      `Current run discovered ${input.discoveredRunImageCount} image(s), but ${expectedDiscoveredRunImageCount} image(s) are required for this run mode.`
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
      discoveredRunImageCount: input.discoveredRunImageCount,
      expectedDiscoveredRunImageCount
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

      if (!cleanedArtifactsWereRemoved && !input.simulateOnly && input.imageDimensions) {
        for (const candidate of [file.imageFile, file.rawImageFile].filter(Boolean) as string[]) {
          const normalizedCandidate = normalizePath(candidate);
          if (!existingFiles.has(normalizedCandidate)) {
            continue;
          }
          const dimensions = input.imageDimensions.get(normalizedCandidate);
          if (!dimensions) {
            errors.push(
              issue(
                "error",
                "main_image_dimensions_unreadable",
                `Main image dimensions could not be read: ${candidate}`,
                task.taskId,
                candidate
              )
            );
            continue;
          }
          if (dimensions.width !== dimensions.height) {
            errors.push(
              issue(
                "error",
                "main_image_not_square",
                `Main image must be square before downstream steps: ${candidate} (${dimensions.width}x${dimensions.height}).`,
                task.taskId,
                candidate
              )
            );
          }
        }
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

export function auditPublishMainImageSubset(input: PublishMainImageSubsetAuditInput): MainImageGenerationAuditResult {
  const errors: AutoListingAuditIssue[] = [];
  const warnings: AutoListingAuditIssue[] = [];
  const existingFiles = new Set(Array.from(input.existingFiles || []).filter(Boolean).map(normalizePath));
  const expectedFolders = new Set(input.expectedProductFolders.filter(Boolean).map(normalizePath));
  const actualFolders = new Set(input.generatedFiles.map((item) => normalizePath(item.productFolder)).filter(Boolean));

  if (
    expectedFolders.size === 0 ||
    actualFolders.size !== expectedFolders.size ||
    [...expectedFolders].some((folder) => !actualFolders.has(folder))
  ) {
    errors.push(
      issue(
        "error",
        "publish_main_image_target_mismatch",
        `Publish-stage main image recovery did not match the exact remaining target set. expected=${expectedFolders.size}; actual=${actualFolders.size}.`,
        input.taskId
      )
    );
  }

  const seenImages = new Set<string>();
  const seenRawImages = new Set<string>();
  for (const file of input.generatedFiles) {
    const requiredPaths = [file.productFolder, file.imageFile, file.rawImageFile].filter(Boolean) as string[];
    if (!file.rawImageFile) {
      errors.push(
        issue(
          "error",
          "main_image_raw_file_missing",
          `Publish-stage recovery is missing the raw main image for ${file.productFolder}.`,
          input.taskId,
          file.productFolder
        )
      );
    }
    for (const requiredPath of requiredPaths) {
      if (!input.simulateOnly && !existingFiles.has(normalizePath(requiredPath))) {
        errors.push(
          issue(
            "error",
            requiredPath === file.productFolder ? "main_image_product_folder_missing" : "main_image_file_missing",
            `Publish-stage main image artifact is missing: ${requiredPath}`,
            input.taskId,
            requiredPath
          )
        );
      }
    }

    for (const [candidate, seen] of [
      [file.imageFile, seenImages],
      [file.rawImageFile, seenRawImages]
    ] as Array<[string | undefined, Set<string>]>) {
      if (!candidate) continue;
      const normalized = normalizePath(candidate);
      if (!input.simulateOnly && seen.has(normalized)) {
        errors.push(issue("error", "main_image_duplicate_file", `Publish-stage main image path is duplicated: ${candidate}`, input.taskId, candidate));
      }
      seen.add(normalized);
      if (input.simulateOnly || !existingFiles.has(normalized)) continue;
      const dimensions = input.imageDimensions?.get(normalized);
      if (!dimensions) {
        errors.push(issue("error", "main_image_dimensions_unreadable", `Main image dimensions could not be read: ${candidate}`, input.taskId, candidate));
      } else if (dimensions.width !== dimensions.height) {
        errors.push(issue("error", "main_image_not_square", `Main image must be square before publishing: ${candidate} (${dimensions.width}x${dimensions.height}).`, input.taskId, candidate));
      }
    }
  }

  return {
    ok: errors.length === 0,
    summary: {
      auditedTaskCount: 1,
      generatedImageCount: input.generatedFiles.length,
      expectedImageCount: expectedFolders.size
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
  let inProgressPublishCount = 0;
  const manifestByFolder = new Map(input.manifestEntries.map((entry) => [normalizePath(entry.productFolder), entry]));
  const manifestByTargetKey = new Map(input.manifestEntries.map((entry) => [entry.targetKey, entry]));

  for (const task of tasks) {
    const resultByFolder = new Map((task.publishArtifact?.results || []).map((result) => [normalizePath(result.productFolder), result]));
    const canonicalTargetKeys = input.batchFingerprint && task.feishuProductRecord?.recordId
      ? buildCanonicalPublishTargetKeys({
          batchFingerprint: input.batchFingerprint,
          tasks: [{
            taskId: task.taskId,
            recordId: task.feishuProductRecord.recordId,
            productCategory: task.feishuProductRecord.productCategory
          }]
        })
      : [];
    if (canonicalTargetKeys.length > 0) {
      const resultByTargetKey = new Map((task.publishArtifact?.results || []).map((result) => [result.targetKey, result]));
      for (const targetKey of canonicalTargetKeys) {
        expectedPublishCount += 1;
        const result = resultByTargetKey.get(targetKey);
        const manifest = manifestByTargetKey.get(targetKey);
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
            `Publish submit was accepted but final platform success was not observed for canonical target: ${targetKey}`,
            task.taskId
          ));
          continue;
        }
        const failedResult = result && (result.status === "failed" || result.ok === false || result.finalVerifyStatus === "needs_manual_review");
        const failedManifest = manifest && (manifest.status === "failed" || manifest.finalVerifyStatus === "needs_manual_review");
        if (!failedResult && !failedManifest && input.allowInProgress) {
          inProgressPublishCount += 1;
          continue;
        }
        errors.push(issue(
          "error",
          failedResult || failedManifest ? "publish_result_unsafe" : "publish_result_missing",
          failedResult || failedManifest
            ? `Publish result is not safe for canonical target: ${targetKey}`
            : `No safe publish result was found for canonical target: ${targetKey}`,
          task.taskId
        ));
      }
      continue;
    }
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
      if (!failedResult && !failedManifest && input.allowInProgress) {
        inProgressPublishCount += 1;
        continue;
      }
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
      safelyPublishedCount,
      inProgressPublishCount
    },
    errors,
    warnings
  };
}
