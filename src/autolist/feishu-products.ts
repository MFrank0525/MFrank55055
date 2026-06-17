import fs from "node:fs";
import path from "node:path";
import { sanitizeFeishuProductRecord } from "../feishu/product-records.js";
import type { FeishuProductRecord } from "../feishu/types.js";
import { buildFeishuSellingPointText } from "./selling-point-rules.js";
import type { SellingPointArtifact } from "./types.js";

interface FeishuProductPayload {
  records?: FeishuProductRecord[];
}

export interface FeishuProductRuntimeRecord {
  record: FeishuProductRecord;
  sellingPointArtifact: SellingPointArtifact;
}

export interface PendingFeishuProductSourceImageInput {
  records: FeishuProductRecord[];
  processedImages?: Iterable<string>;
  maxImagesPerRun?: number;
  fileExists?: (filePath: string) => boolean;
}

function normalize(value: string): string {
  return value.replace(/\s+/g, "").replace(/[^\p{L}\p{N}]+/gu, "").toLowerCase();
}

function readPayload(filePath: string): FeishuProductRecord[] {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Feishu product data file not found: ${resolved}`);
  }
  const parsed = JSON.parse(fs.readFileSync(resolved, "utf8")) as FeishuProductPayload | FeishuProductRecord[];
  const records = Array.isArray(parsed) ? parsed : parsed.records || [];
  return records
    .filter((record) => record && typeof record === "object")
    .map((record) => sanitizeFeishuProductRecord(record));
}

export function loadFeishuProductRecords(productDataFile: string): FeishuProductRecord[] {
  return readPayload(productDataFile);
}

function assertRecordReady(record: FeishuProductRecord): void {
  const missing: string[] = [];
  if (!record.userCognitionName) missing.push("userCognitionName");
  if (!record.genericName) missing.push("genericName");
  if (!record.brand) missing.push("brand");
  if (!record.spu) missing.push("spu");
  if (!record.sellingPointText) missing.push("sellingPointText");
  if (!record.shortTitle) missing.push("shortTitle");
  if (missing.length > 0) {
    throw new Error(`Feishu product record ${record.recordId} is incomplete: ${missing.join(", ")}`);
  }
}

function buildSellingPointText(record: FeishuProductRecord): string {
  return buildFeishuSellingPointText({
    userCognitionName: record.userCognitionName,
    brandedGenericName: `${record.brand}${record.genericName}`,
    sellingPointText: record.sellingPointText
  });
}

function writeFeishuSellingPointArtifact(runtimeDir: string, taskId: string, record: FeishuProductRecord): SellingPointArtifact {
  const taskDir = path.join(runtimeDir, "tasks", taskId, "feishu-selling-points");
  fs.mkdirSync(taskDir, { recursive: true });
  const sellingPointText = buildSellingPointText(record);
  const segments = sellingPointText.split(",").map((item) => item.trim()).filter(Boolean);
  const promptFile = path.join(taskDir, "source.txt");
  const rawFile = path.join(taskDir, "selling-points.txt");
  fs.writeFileSync(promptFile, `Feishu record: ${record.recordId}\n`, "utf8");
  fs.writeFileSync(rawFile, `${sellingPointText}\n`, "utf8");
  return {
    promptFile,
    rawFile,
    screenshotFile: "",
    sellingPointText,
    segments,
    brand: record.brand,
    userCognitionName: record.userCognitionName,
    brandedGenericName: `${record.brand}${record.genericName}`,
    segmentCount: segments.length,
    capturedAt: new Date().toISOString(),
    simulated: false
  };
}

function attachmentLocalFiles(record: FeishuProductRecord): string[] {
  return record.whiteBackgroundImages
    .map((attachment) => attachment.localFile || "")
    .filter(Boolean)
    .map((filePath) => path.resolve(filePath));
}

function assertUniqueWhiteBackgroundLocalFiles(records: FeishuProductRecord[]): void {
  const duplicate = findSharedFeishuWhiteBackgroundLocalFile(records);
  if (duplicate) {
    throw new Error(
      `Feishu records ${duplicate.previousRecordId} and ${duplicate.recordId} share one local white background image path: ${duplicate.filePath}`
    );
  }
}

export function findSharedFeishuWhiteBackgroundLocalFile(records: FeishuProductRecord[]): {
  filePath: string;
  previousRecordId: string;
  recordId: string;
} | undefined {
  const owners = new Map<string, string>();
  for (const [index, record] of records.entries()) {
    const owner = record.recordId || `row ${index + 1}`;
    for (const filePath of attachmentLocalFiles(record)) {
      const previousOwner = owners.get(filePath);
      if (previousOwner && previousOwner !== owner) {
        return {
          filePath,
          previousRecordId: previousOwner,
          recordId: owner
        };
      }
      owners.set(filePath, owner);
    }
  }
  return undefined;
}

export function hasSharedFeishuWhiteBackgroundLocalFile(records: FeishuProductRecord[]): boolean {
  return Boolean(findSharedFeishuWhiteBackgroundLocalFile(records));
}

export function resolveFeishuProductSourceImages(productDataFile: string): string[] {
  return resolvePendingFeishuProductSourceImagesFromRecords({
    records: readPayload(productDataFile)
  });
}

export function resolvePendingFeishuProductSourceImagesFromRecords(input: PendingFeishuProductSourceImageInput): string[] {
  assertUniqueWhiteBackgroundLocalFiles(input.records);
  const processedImages = new Set(Array.from(input.processedImages || []).filter(Boolean).map((filePath) => path.resolve(filePath)));
  const exists = input.fileExists || fs.existsSync;
  const pendingImages: string[] = [];

  input.records.forEach((record, index) => {
    const sourceImage = attachmentLocalFiles(record)[0];
    if (sourceImage && processedImages.has(path.resolve(sourceImage))) {
      return;
    }
    if (!sourceImage) {
      throw new Error(
        `Feishu product row ${index + 1} (${record.recordId || "unknown"}) has no downloaded white background image.`
      );
    }
    if (!exists(sourceImage)) {
      throw new Error(
        `Feishu product row ${index + 1} (${record.recordId || "unknown"}) white background image was missing: ${sourceImage}`
      );
    }
    pendingImages.push(sourceImage);
  });

  return input.maxImagesPerRun && input.maxImagesPerRun > 0 ? pendingImages.slice(0, input.maxImagesPerRun) : pendingImages;
}

function matchRecordByImage(records: FeishuProductRecord[], imagePath: string): FeishuProductRecord | null {
  const resolved = path.resolve(imagePath);
  const basename = normalize(path.basename(imagePath));

  const byLocalFile = records.filter((record) => attachmentLocalFiles(record).includes(resolved));
  if (byLocalFile.length > 1) {
    throw new Error(
      `Multiple Feishu product records share source image ${resolved}: ${byLocalFile
        .map((record) => record.recordId || "unknown")
        .join(", ")}`
    );
  }
  if (byLocalFile.length === 1) {
    return byLocalFile[0];
  }

  const byFileName = records.find((record) => {
    const keys = [record.recordId, record.spu, record.userCognitionName, record.genericName].map(normalize).filter(Boolean);
    return keys.some((key) => basename.includes(key));
  });
  if (byFileName) {
    return byFileName;
  }

  return records.length === 1 ? records[0] : null;
}

export function loadFeishuProductRuntimeRecord(options: {
  productDataFile: string;
  sourceImagePath: string;
  runtimeDir: string;
  taskId: string;
}): FeishuProductRuntimeRecord {
  const records = readPayload(options.productDataFile);
  if (records.length === 0) {
    throw new Error(`Feishu product data file had no records: ${path.resolve(options.productDataFile)}`);
  }
  assertUniqueWhiteBackgroundLocalFiles(records);
  const record = matchRecordByImage(records, options.sourceImagePath);
  if (!record) {
    throw new Error(`No Feishu product record matched source image: ${options.sourceImagePath}`);
  }
  assertRecordReady(record);
  return {
    record,
    sellingPointArtifact: writeFeishuSellingPointArtifact(options.runtimeDir, options.taskId, record)
  };
}
