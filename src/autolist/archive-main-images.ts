import fs from "node:fs";
import path from "node:path";
import { sanitizeFileName } from "../utils/path-names.js";
import type { MainImageArtifact } from "./types.js";

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

function listImageFilesDirect(dir: string): string[] {
  if (!dir || !fs.existsSync(dir)) {
    return [];
  }
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(dir, entry.name))
    .filter(isImageFile)
    .sort((a, b) => a.localeCompare(b, "zh-CN"));
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

function findCompleteProductArchive(options: {
  archiveRootDir: string;
  productFolderName: string;
  expectedImageCount: number;
}): string[] {
  if (!fs.existsSync(options.archiveRootDir) || options.expectedImageCount <= 0) {
    return [];
  }
  const archiveDirPattern = new RegExp(`^\\d{12}${options.productFolderName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:-\\d{2})?$`);
  const candidates = fs
    .readdirSync(options.archiveRootDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && archiveDirPattern.test(entry.name))
    .map((entry) => path.join(options.archiveRootDir, entry.name))
    .map((dir) => ({
      dir,
      files: listImageFilesDirect(dir),
      mtimeMs: fs.statSync(dir).mtimeMs
    }))
    .filter((candidate) => candidate.files.length >= options.expectedImageCount)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates[0]?.files.slice(0, options.expectedImageCount) || [];
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
  const recoveredRawFiles = artifactRawFiles.length
    ? []
    : listImageFilesRecursive(options.rawImageSearchDir || "").filter(isGeneratedRawMainImage);
  const currentRawFiles = artifactRawFiles.length ? artifactRawFiles : recoveredRawFiles;
  const archiveRecoveredFiles =
    options.expectedImageCount && currentRawFiles.length < options.expectedImageCount
      ? findCompleteProductArchive({
          archiveRootDir,
          productFolderName,
          expectedImageCount: options.expectedImageCount
        })
      : [];
  const rawFiles = archiveRecoveredFiles.length ? archiveRecoveredFiles : currentRawFiles;

  if (!rawFiles.length) {
    return [];
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

export { DEFAULT_ARCHIVE_ROOT, archiveTimestamp };
