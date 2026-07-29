import fs from "node:fs";
import path from "node:path";
import { recoverMainImageArtifactForPublish } from "./main-image-square-action.js";
import type { MainImageArtifact } from "./types.js";

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function recoverCompleteMainImageArtifactForAudit(input: {
  taskRuntimeDir: string;
  shopRootDir: string;
  recordId: string;
  expectedImageCount: number;
  imagesPerPrompt: number;
}): MainImageArtifact | undefined {
  if (!input.recordId || !fs.existsSync(input.taskRuntimeDir) || !fs.existsSync(input.shopRootDir)) {
    return undefined;
  }
  const productPattern = new RegExp(
    `-${escapeRegex(input.recordId)}-水印(\\d+)$`
  );
  const byImageIndex = new Map<number, string>();
  for (const shopEntry of fs.readdirSync(input.shopRootDir, { withFileTypes: true })) {
    if (!shopEntry.isDirectory()) {
      continue;
    }
    const shopDir = path.join(input.shopRootDir, shopEntry.name);
    for (const productEntry of fs.readdirSync(shopDir, { withFileTypes: true })) {
      if (!productEntry.isDirectory()) {
        continue;
      }
      const match = productPattern.exec(productEntry.name);
      const imageIndex = Number(match?.[1]);
      if (!Number.isInteger(imageIndex) || imageIndex < 1 || imageIndex > input.expectedImageCount) {
        continue;
      }
      if (byImageIndex.has(imageIndex)) {
        return undefined;
      }
      byImageIndex.set(imageIndex, path.join(shopDir, productEntry.name));
    }
  }
  if (byImageIndex.size !== input.expectedImageCount) {
    return undefined;
  }
  try {
    const artifact = recoverMainImageArtifactForPublish({
      taskRuntimeDir: input.taskRuntimeDir,
      distributedFolders: Array.from(
        { length: input.expectedImageCount },
        (_, index) => byImageIndex.get(index + 1) as string
      ),
      imagesPerPrompt: input.imagesPerPrompt
    });
    return artifact.generatedFiles.length === input.expectedImageCount &&
      artifact.generatedFiles.every((item) => item.rawImageFile && fs.existsSync(item.rawImageFile))
      ? artifact
      : undefined;
  } catch {
    return undefined;
  }
}
