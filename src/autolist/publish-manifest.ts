import fs from "node:fs";
import path from "node:path";
import { atomicWriteJson } from "../utils/atomic-file.js";
import type { PublishTargetIdentity } from "./publish-identity.js";

export type PublishFinalVerifyStatus =
  | "not_checked"
  | "publish_signal_confirmed"
  | "list_verified"
  | "submit_accepted_unconfirmed"
  | "needs_manual_review";

export const SAFE_PUBLISH_FINAL_VERIFY_STATUSES: PublishFinalVerifyStatus[] = [
  "publish_signal_confirmed",
  "list_verified"
];

export const BATCH_COMPLETION_FINAL_VERIFY_STATUSES: PublishFinalVerifyStatus[] = [
  ...SAFE_PUBLISH_FINAL_VERIFY_STATUSES,
  "submit_accepted_unconfirmed"
];

export interface PublishManifestEntry {
  targetKey: string;
  targetIdentity: PublishTargetIdentity;
  productFolder: string;
  runtimeKey: string;
  shopFolder: string;
  watermarkNo: number | null;
  batchFingerprint?: string;
  taskId?: string;
  sourceImagePath?: string;
  recordId?: string;
  userCognitionName?: string;
  genericName?: string;
  productCategory?: string;
  status: "pending" | "published" | "failed" | "skipped";
  finalVerifyStatus: PublishFinalVerifyStatus;
  resultFile?: string;
  message: string;
  errorClass?: string;
  updatedAt: string;
}

export interface PublishManifest {
  generatedAt: string;
  entries: PublishManifestEntry[];
}

export interface PublishPlanItem {
  targetKey: string;
  targetIdentity: PublishTargetIdentity;
  productFolder: string;
  runtimeKey: string;
  action: "skip" | "publish" | "review";
  reason: string;
  manifestStatus?: string;
  finalVerifyStatus?: PublishFinalVerifyStatus;
}

export interface PublishProductIdentity {
  batchFingerprint?: string;
  taskId?: string;
  sourceImagePath?: string;
  recordId?: string;
  userCognitionName?: string;
  genericName?: string;
  productCategory?: string;
}

const MANIFEST_FILE = "publish-manifest.json";
const PLAN_FILE = "publish-plan.json";

function normalizeIdentityText(value: string | undefined): string {
  return String(value || "").replace(/\s+/g, "").trim();
}

function normalizeIdentityPath(value: string | undefined): string {
  return value ? path.resolve(value) : "";
}

export function normalizePublishProductIdentity(identity: PublishProductIdentity | undefined): PublishProductIdentity | undefined {
  if (!identity) {
    return undefined;
  }
  const normalized: PublishProductIdentity = {
    batchFingerprint: normalizeIdentityText(identity.batchFingerprint),
    taskId: normalizeIdentityText(identity.taskId),
    sourceImagePath: normalizeIdentityPath(identity.sourceImagePath),
    recordId: normalizeIdentityText(identity.recordId),
    userCognitionName: normalizeIdentityText(identity.userCognitionName),
    genericName: normalizeIdentityText(identity.genericName),
    productCategory: normalizeIdentityText(identity.productCategory)
  };
  return Object.values(normalized).some(Boolean) ? normalized : undefined;
}

export function extractWatermarkNo(productFolder: string): number | null {
  const match = path.basename(productFolder).match(/水印(\d{1,3})$/);
  return match ? Number(match[1]) : null;
}

export function publishManifestFile(runtimeDir: string): string {
  return path.join(runtimeDir, MANIFEST_FILE);
}

export function publishPlanFile(runtimeDir: string): string {
  return path.join(runtimeDir, PLAN_FILE);
}

export function loadPublishManifest(runtimeDir: string): PublishManifest {
  const filePath = publishManifestFile(runtimeDir);
  if (!fs.existsSync(filePath)) {
    return { generatedAt: new Date().toISOString(), entries: [] };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as PublishManifest;
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.entries)) {
      throw new Error("entries must be an array");
    }
    return {
      generatedAt: parsed.generatedAt || new Date().toISOString(),
      entries: parsed.entries
    };
  } catch (error) {
    throw new Error(`Invalid publish manifest ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function savePublishManifest(runtimeDir: string, manifest: PublishManifest): string {
  const filePath = publishManifestFile(runtimeDir);
  atomicWriteJson(filePath, { ...manifest, generatedAt: new Date().toISOString() });
  return filePath;
}

export function savePublishPlan(runtimeDir: string, plan: PublishPlanItem[]): string {
  const filePath = publishPlanFile(runtimeDir);
  atomicWriteJson(filePath, { generatedAt: new Date().toISOString(), plan });
  return filePath;
}

export function findPublishManifestEntry(manifest: PublishManifest, runtimeKey: string): PublishManifestEntry | undefined {
  return manifest.entries.find((entry) => entry.targetKey === runtimeKey);
}

export function isManifestEntrySafelyPublished(entry: PublishManifestEntry | undefined): boolean {
  return Boolean(entry && entry.status === "published" && SAFE_PUBLISH_FINAL_VERIFY_STATUSES.includes(entry.finalVerifyStatus));
}

export function isManifestEntryAcceptedForBatchCompletion(entry: PublishManifestEntry | undefined): boolean {
  if (!entry || !BATCH_COMPLETION_FINAL_VERIFY_STATUSES.includes(entry.finalVerifyStatus)) {
    return false;
  }
  if (entry.status === "published") {
    return true;
  }
  return entry.status === "failed" &&
    entry.finalVerifyStatus === "submit_accepted_unconfirmed" &&
    entry.errorClass === "final_publish_state_uncertain";
}

export function isManifestEntryAcceptedForBatchCompletionForIdentity(
  entry: PublishManifestEntry | undefined,
  identity?: PublishProductIdentity
): boolean {
  if (!isManifestEntryAcceptedForBatchCompletion(entry)) {
    return false;
  }
  const expected = normalizePublishProductIdentity(identity);
  if (!expected) {
    return true;
  }
  const actual = normalizePublishProductIdentity({
    batchFingerprint: entry?.batchFingerprint,
    taskId: entry?.taskId,
    sourceImagePath: entry?.sourceImagePath,
    recordId: entry?.recordId,
    userCognitionName: entry?.userCognitionName,
    genericName: entry?.genericName,
    productCategory: entry?.productCategory
  });
  if (!actual) {
    return false;
  }
  if (expected.batchFingerprint && actual.batchFingerprint !== expected.batchFingerprint) {
    return false;
  }
  if (expected.taskId && actual.taskId !== expected.taskId) {
    return false;
  }
  if (expected.sourceImagePath && actual.sourceImagePath !== expected.sourceImagePath) {
    return false;
  }
  if (expected.recordId && actual.recordId !== expected.recordId) {
    return false;
  }
  return true;
}

export function isManifestEntrySafelyPublishedForIdentity(
  entry: PublishManifestEntry | undefined,
  identity?: PublishProductIdentity
): boolean {
  if (!isManifestEntrySafelyPublished(entry)) {
    return false;
  }
  const expected = normalizePublishProductIdentity(identity);
  if (!expected) {
    return true;
  }
  const actual = normalizePublishProductIdentity({
    batchFingerprint: entry?.batchFingerprint,
    taskId: entry?.taskId,
    sourceImagePath: entry?.sourceImagePath,
    recordId: entry?.recordId,
    userCognitionName: entry?.userCognitionName,
    genericName: entry?.genericName
  });
  if (!actual) {
    return false;
  }
  if (expected.batchFingerprint && actual.batchFingerprint !== expected.batchFingerprint) {
    return false;
  }
  if (expected.taskId && actual.taskId !== expected.taskId) {
    return false;
  }
  if (expected.sourceImagePath && actual.sourceImagePath !== expected.sourceImagePath) {
    return false;
  }
  if (expected.recordId && actual.recordId !== expected.recordId) {
    return false;
  }
  return true;
}

export function upsertPublishManifestEntry(runtimeDir: string, entry: Omit<PublishManifestEntry, "updatedAt">): PublishManifest {
  const manifest = loadPublishManifest(runtimeDir);
  const identity = normalizePublishProductIdentity(entry);
  const updated: PublishManifestEntry = { ...entry, ...identity, updatedAt: new Date().toISOString() };
  const existingIndex = manifest.entries.findIndex((item) => item.targetKey === updated.targetKey);
  if (existingIndex >= 0) {
    manifest.entries[existingIndex] = updated;
  } else {
    manifest.entries.push(updated);
  }
  manifest.entries.sort((a, b) => {
    const shopDiff = a.shopFolder.localeCompare(b.shopFolder, "zh-CN");
    if (shopDiff !== 0) return shopDiff;
    return (a.watermarkNo ?? 9999) - (b.watermarkNo ?? 9999);
  });
  savePublishManifest(runtimeDir, manifest);
  return manifest;
}
