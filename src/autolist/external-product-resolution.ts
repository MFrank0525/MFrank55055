import fs from "node:fs";
import path from "node:path";

export type ExternalProductConflictStatus = "unresolved" | "resolved_retain_and_skip";

export interface ExternalProductConflict {
  version: 1;
  status: ExternalProductConflictStatus;
  disposition?: "retain_existing_and_skip_exact_target";
  detectedAt: string;
  resolvedAt?: string;
  batchFingerprint: string;
  recordId: string;
  taskId?: string;
  shopCode: string;
  watermarkNo?: number;
  shopName: string;
  externalProductId: string;
  externalStatus?: string;
  exactTitle: string;
  evidenceScreenshot?: string;
  message: string;
}

export type ExternalPublishTargetIdentity = {
  batchFingerprint: string;
  recordId: string;
  taskId: string;
  shopCode: string;
  watermarkNo: number;
};

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`External product conflict ${field} must be a non-empty string.`);
  }
  return value.trim();
}

export function externalProductConflictFilePath(rootDir = process.cwd()): string {
  return path.resolve(rootDir, "data/auto-listing/control/external-product-conflict.json");
}

export function validateExternalProductConflict(value: unknown): ExternalProductConflict {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("External product conflict must be a JSON object.");
  }
  const input = value as Record<string, unknown>;
  if (input.version !== 1) {
    throw new Error("External product conflict version must be 1.");
  }
  if (input.status !== "unresolved" && input.status !== "resolved_retain_and_skip") {
    throw new Error("External product conflict status is invalid.");
  }
  const result: ExternalProductConflict = {
    version: 1,
    status: input.status,
    detectedAt: requiredString(input.detectedAt, "detectedAt"),
    batchFingerprint: requiredString(input.batchFingerprint, "batchFingerprint"),
    recordId: requiredString(input.recordId, "recordId"),
    shopCode: requiredString(input.shopCode, "shopCode"),
    shopName: requiredString(input.shopName, "shopName"),
    externalProductId: requiredString(input.externalProductId, "externalProductId"),
    exactTitle: requiredString(input.exactTitle, "exactTitle"),
    message: requiredString(input.message, "message")
  };
  if (typeof input.externalStatus === "string" && input.externalStatus.trim()) result.externalStatus = input.externalStatus.trim();
  if (typeof input.evidenceScreenshot === "string" && input.evidenceScreenshot.trim()) result.evidenceScreenshot = input.evidenceScreenshot.trim();

  if (result.status === "resolved_retain_and_skip") {
    if (input.disposition !== "retain_existing_and_skip_exact_target") {
      throw new Error("Resolved external product conflict disposition must retain and skip the exact target.");
    }
    result.disposition = input.disposition;
    result.resolvedAt = requiredString(input.resolvedAt, "resolvedAt");
    result.taskId = requiredString(input.taskId, "taskId");
    if (!Number.isInteger(input.watermarkNo) || Number(input.watermarkNo) <= 0) {
      throw new Error("Resolved external product conflict watermarkNo must be a positive integer.");
    }
    result.watermarkNo = Number(input.watermarkNo);
  }
  return result;
}

export function readExternalProductConflict(file = externalProductConflictFilePath()): ExternalProductConflict | undefined {
  if (!fs.existsSync(file)) {
    return undefined;
  }
  return validateExternalProductConflict(JSON.parse(fs.readFileSync(file, "utf8")) as unknown);
}

export function matchRetainedExternalProductTarget(
  conflict: ExternalProductConflict | undefined,
  target: ExternalPublishTargetIdentity
): ExternalProductConflict | undefined {
  if (
    conflict?.status !== "resolved_retain_and_skip" ||
    conflict.disposition !== "retain_existing_and_skip_exact_target"
  ) {
    return undefined;
  }
  return conflict.batchFingerprint === target.batchFingerprint &&
    conflict.recordId === target.recordId &&
    conflict.taskId === target.taskId &&
    conflict.shopCode === target.shopCode &&
    conflict.watermarkNo === target.watermarkNo
    ? conflict
    : undefined;
}
