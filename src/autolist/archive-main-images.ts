import fs from "node:fs";
import path from "node:path";
import { sanitizeFileName } from "../doubao/paths.js";
import type { MainImageArtifact } from "./types.js";

const DEFAULT_ARCHIVE_ROOT = "/Users/mfrank/Desktop/FFC的文件夹/工作/001电商/2026AI主图";

function isImageFile(filePath: string): boolean {
  return /\.(png|jpg|jpeg|webp)$/i.test(filePath);
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
  simulateOnly: boolean;
}): string[] {
  const archiveRootDir = options.archiveRootDir || DEFAULT_ARCHIVE_ROOT;
  const productFolderName = sanitizeFileName(options.productName || "未命名产品");
  const archiveFolderName = `${archiveTimestamp()}${productFolderName}`;
  const targetDir = resolveUniqueArchiveDir(path.join(archiveRootDir, archiveFolderName));
  const rawFiles = (options.mainImageArtifact?.generatedFiles || [])
    .map((item) => item.rawImageFile || "")
    .filter((filePath) => filePath && isImageFile(filePath) && fs.existsSync(filePath));

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
    }
    return targetFile;
  });
}

export { DEFAULT_ARCHIVE_ROOT, archiveTimestamp };
