import fs from "node:fs";
import path from "node:path";
import type { AutoListingPreflightSummary, AutoListingResolvedJob } from "./types.js";

function countImageFiles(dir: string): number {
  if (!fs.existsSync(dir)) {
    return 0;
  }
  return fs.readdirSync(dir).filter((name) => /\.(png|jpg|jpeg|webp)$/i.test(name)).length;
}

function countShopFolders(dir: string): number {
  if (!fs.existsSync(dir)) {
    return 0;
  }
  return fs.readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).length;
}

export function buildAutoListingPreflightSummary(resolved: AutoListingResolvedJob): AutoListingPreflightSummary {
  const warnings: string[] = [];
  const sourceImages = countImageFiles(resolved.input.feishuImageDir);
  const shops = countShopFolders(resolved.input.shopRootDir);

  if (!resolved.input.simulateOnly) {
    warnings.push(
      `Real mode is enabled. ${resolved.input.imageGenerationProvider} image generation and Doubao title generation may consume external service quota.`
    );
  }
  if (sourceImages === 0) {
    warnings.push("No source white-background images were found.");
  }
  if (shops < 5) {
    warnings.push(`Expected at least 5 shop folders, found ${shops}.`);
  }

  return {
    generatedAt: new Date().toISOString(),
    runId: path.basename(resolved.runtimeDir),
    simulateOnly: resolved.input.simulateOnly,
    source: {
      feishuProductDataFile: resolved.input.feishuProductDataFile || undefined,
      productInfoXlsx: resolved.input.productInfoXlsx || undefined,
      feishuImageDir: resolved.input.feishuImageDir,
      qualificationDir: resolved.input.qualificationDir,
      shopRootDir: resolved.input.shopRootDir,
      imageGenerationProvider: resolved.input.imageGenerationProvider,
      imageGenerationConfigFile: resolved.input.imageGenerationConfigFile || undefined
    },
    counts: {
      sourceImages,
      shops
    },
    warnings
  };
}
