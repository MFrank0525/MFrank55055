import fs from "node:fs";
import path from "node:path";
import { sanitizeFileName } from "../utils/path-names.js";
import type { MainImageArtifact } from "./types.js";
import {
  readPaidImageProductLedger,
  readPaidImageSlotRecord,
  sha256File,
  type PaidImageResultProvenance
} from "./paid-image-submission-ledger.js";

const DEFAULT_ARCHIVE_ROOT = "/Users/mfrank/Desktop/FFC的文件夹/工作/001电商/2026AI主图";

function isImageFile(filePath: string): boolean {
  return /\.(png|jpg|jpeg|webp)$/i.test(filePath);
}

function isGeneratedRawMainImage(filePath: string): boolean {
  return (
    isImageFile(filePath) &&
    filePath.includes(`${path.sep}openai-compatible${path.sep}raw${path.sep}`) &&
    /^generated-\d+/i.test(path.basename(filePath))
  );
}

function listImageFilesRecursive(dir: string): string[] {
  if (!dir || !fs.existsSync(dir)) {
    return [];
  }
  const collected: string[] = [];
  const pending = [dir];
  while (pending.length > 0) {
    const currentDir = pending.pop() as string;
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        pending.push(fullPath);
        continue;
      }
      if (isImageFile(fullPath)) {
        collected.push(fullPath);
      }
    }
  }
  return collected.sort((a, b) => a.localeCompare(b, "zh-CN"));
}

function archiveTimestamp(date = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes())
  ].join("");
}

function resolveUniqueArchiveDir(baseDir: string): string {
  if (!fs.existsSync(baseDir)) {
    return baseDir;
  }
  for (let index = 2; index <= 99; index += 1) {
    const candidate = `${baseDir}-${String(index).padStart(2, "0")}`;
    if (!fs.existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error(`Archive target already exists and no unique suffix was available: ${baseDir}`);
}

export function archiveUnwatermarkedMainImages(options: {
  mainImageArtifact?: MainImageArtifact;
  productName: string;
  archiveRootDir?: string;
  rawImageSearchDir?: string;
  expectedImageCount?: number;
  simulateOnly: boolean;
}): string[] {
  const archiveRootDir = options.archiveRootDir || DEFAULT_ARCHIVE_ROOT;
  const productFolderName = sanitizeFileName(options.productName || "未命名产品");
  const archiveFolderName = `${archiveTimestamp()}${productFolderName}`;
  const targetDir = resolveUniqueArchiveDir(path.join(archiveRootDir, archiveFolderName));
  const artifactRawFiles = (options.mainImageArtifact?.generatedFiles || [])
    .map((item) => item.rawImageFile || "")
    .filter((filePath) => filePath && fs.existsSync(filePath) && isGeneratedRawMainImage(filePath));
  const recoveredRawFiles = listImageFilesRecursive(options.rawImageSearchDir || "").filter(isGeneratedRawMainImage);
  const rawFiles = Array.from(
    new Set([...artifactRawFiles, ...recoveredRawFiles].map((filePath) => path.resolve(filePath)))
  ).sort((a, b) => a.localeCompare(b, "zh-CN"));

  if (!rawFiles.length) {
    return [];
  }
  if (!options.simulateOnly && options.expectedImageCount && rawFiles.length !== options.expectedImageCount) {
    throw new Error(
      `Archive guard failed: expected ${options.expectedImageCount} current unwatermarked main image(s), got ${rawFiles.length}.`
    );
  }

  if (!options.simulateOnly) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  return rawFiles.map((sourceFile, index) => {
    const ext = path.extname(sourceFile) || ".png";
    const targetFile = path.join(targetDir, `${productFolderName}无水印主图${String(index + 1).padStart(2, "0")}${ext}`);
    if (!options.simulateOnly) {
      fs.copyFileSync(sourceFile, targetFile);
      if (!fs.existsSync(targetFile) || fs.statSync(targetFile).size <= 0) {
        throw new Error(`Archived unwatermarked main image was not written correctly: ${targetFile}`);
      }
    }
    return targetFile;
  });
}

export interface PaidImageLedgerSnapshotArtifact {
  archiveDir: string;
  files: string[];
  manifestFile: string;
}

export function archivePaidImageLedgerSnapshot(options: {
  productDir: string;
  productName: string;
  archiveRootDir?: string;
  label: string;
  now?: Date;
}): PaidImageLedgerSnapshotArtifact {
  const ledger = readPaidImageProductLedger(options.productDir);
  const archiveRootDir = options.archiveRootDir || DEFAULT_ARCHIVE_ROOT;
  const productName = sanitizeFileName(options.productName || "未命名产品");
  const label = sanitizeFileName(options.label || "恢复快照");
  const archiveDir = resolveUniqueArchiveDir(
    path.join(archiveRootDir, `${archiveTimestamp(options.now)}${productName}-${label}`)
  );
  fs.mkdirSync(archiveDir, { recursive: true });
  const files: string[] = [];
  const slots: Array<{
    slot: number;
    resultDigest: string;
    archivedFile: string;
    resultProvenance?: PaidImageResultProvenance;
  }> = [];
  const missingSlots: number[] = [];
  for (let slot = 1; slot <= ledger.expectedSlotCount; slot += 1) {
    const record = readPaidImageSlotRecord({ productDir: options.productDir, slot });
    if (
      record?.state !== "completed" ||
      !record.resultFile ||
      !record.resultDigest ||
      !fs.existsSync(record.resultFile) ||
      sha256File(record.resultFile) !== record.resultDigest
    ) {
      missingSlots.push(slot);
      continue;
    }
    const ext = path.extname(record.resultFile) || ".png";
    const targetFile = path.join(archiveDir, `${productName}无水印主图${String(slot).padStart(2, "0")}${ext}`);
    fs.copyFileSync(record.resultFile, targetFile, fs.constants.COPYFILE_EXCL);
    if (sha256File(targetFile) !== record.resultDigest) {
      throw new Error(`Paid image ledger snapshot digest mismatch for slot ${slot}`);
    }
    files.push(targetFile);
    slots.push({
      slot,
      resultDigest: record.resultDigest,
      archivedFile: path.basename(targetFile),
      ...(record.resultProvenance ? { resultProvenance: record.resultProvenance } : {})
    });
  }
  const manifestFile = path.join(archiveDir, "manifest.json");
  fs.writeFileSync(
    manifestFile,
    JSON.stringify(
      {
        version: 1,
        batchFingerprint: ledger.batchFingerprint,
        recordId: ledger.recordId,
        productName,
        label,
        capturedAt: (options.now || new Date()).toISOString(),
        expectedSlotCount: ledger.expectedSlotCount,
        completedSlotCount: files.length,
        missingSlots,
        slots
      },
      null,
      2
    ) + "\n",
    "utf8"
  );
  return { archiveDir, files, manifestFile };
}

export function resolveArchiveProductName(input: {
  shortTitle?: string;
  userCognitionName?: string;
  fallbackName?: string;
}): string {
  return input.shortTitle?.trim() || input.userCognitionName?.trim() || input.fallbackName?.trim() || "未命名产品";
}

export { DEFAULT_ARCHIVE_ROOT, archiveTimestamp };
