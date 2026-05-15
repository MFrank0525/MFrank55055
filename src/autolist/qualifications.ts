import fs from "node:fs";
import path from "node:path";
import type { QualificationArtifact } from "./types.js";

function normalize(value: string): string {
  return value.replace(/\s+/g, "").replace(/[，,。、“”"'`·\-_/\\|:：;；()（）[\]【】]/g, "").toLowerCase();
}

function inferProductName(sellingPointText: string): string {
  return sellingPointText.split(",").map((item) => item.trim()).filter(Boolean)[0] || "";
}

function listImageFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs
    .readdirSync(dir)
    .filter((name) => /\.(png|jpg|jpeg|webp)$/i.test(name))
    .map((name) => path.join(dir, name));
}

export function attachQualificationFiles(options: {
  qualificationDir: string;
  productFolders: string[];
  sellingPointText: string;
  productName?: string;
  simulateOnly: boolean;
}): QualificationArtifact {
  const productName = (options.productName || "").trim() || inferProductName(options.sellingPointText);
  const target = normalize(productName);
  const sourceFiles = listImageFiles(options.qualificationDir);
  const matches = sourceFiles.filter((file) => normalize(path.basename(file)).includes(target));
  const copiedFiles: string[] = [];

  for (const productFolder of options.productFolders) {
    const productImages = listImageFiles(productFolder);
    const filesToCopy = matches.length > 0 ? matches : options.simulateOnly && productImages.length > 0 ? [productImages[0]] : [];
    for (const sourceFile of filesToCopy) {
      const targetName =
        matches.length > 0 ? path.basename(sourceFile) : `资质图片-模拟${path.extname(sourceFile) || ".png"}`;
      const targetFile = path.join(productFolder, targetName);
      fs.copyFileSync(sourceFile, targetFile);
      copiedFiles.push(targetFile);
    }
  }

  if (copiedFiles.length === 0 && !options.simulateOnly) {
    throw new Error(`No qualification files matched product name: ${productName}`);
  }

  return {
    copiedFiles,
    simulated: options.simulateOnly
  };
}
