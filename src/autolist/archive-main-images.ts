import fs from "node:fs";
import path from "node:path";
import { sanitizeFileName } from "../doubao/paths.js";
import type { JimengArtifact } from "./types.js";

const DEFAULT_ARCHIVE_ROOT = "/Users/mfrank/Desktop/FFC的文件夹/工作/001电商/2026AI主图";

function isImageFile(filePath: string): boolean {
  return /\.(png|jpg|jpeg|webp)$/i.test(filePath);
}

export function archiveUnwatermarkedMainImages(options: {
  jimengArtifact?: JimengArtifact;
  productName: string;
  archiveRootDir?: string;
  simulateOnly: boolean;
}): string[] {
  const archiveRootDir = options.archiveRootDir || DEFAULT_ARCHIVE_ROOT;
  const productFolderName = sanitizeFileName(options.productName || "未命名产品");
  const targetDir = path.join(archiveRootDir, productFolderName);
  const rawFiles = (options.jimengArtifact?.generatedFiles || [])
    .map((item) => item.rawImageFile || "")
    .filter((filePath) => filePath && isImageFile(filePath) && fs.existsSync(filePath));

  if (!rawFiles.length) {
    return [];
  }

  if (!options.simulateOnly) {
    fs.rmSync(targetDir, { recursive: true, force: true });
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

export { DEFAULT_ARCHIVE_ROOT };

