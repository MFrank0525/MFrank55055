import path from "node:path";
import type { FeishuProductRecord } from "../feishu/types.js";

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
