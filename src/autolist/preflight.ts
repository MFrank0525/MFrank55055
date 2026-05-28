import fs from "node:fs";
import path from "node:path";
import { loadFeishuProductRecords } from "./feishu-products.js";
import { getProductCategoryPlan, shopCodeFromFolder } from "./product-category.js";
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

function listShopCodes(dir: string): Set<string> {
  if (!fs.existsSync(dir)) {
    return new Set();
  }
  return new Set(
    fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => shopCodeFromFolder(entry.name))
      .filter(Boolean)
  );
}

function expectedShopCodes(resolved: AutoListingResolvedJob): string[] {
  if (!resolved.input.feishuProductDataFile) {
    return ["01", "02", "03", "04", "05"];
  }
  return [
    ...new Set(
      loadFeishuProductRecords(resolved.input.feishuProductDataFile).flatMap((record) =>
        getProductCategoryPlan(record.productCategory).shopCodes
      )
    )
  ].sort();
}

export function buildAutoListingPreflightSummary(resolved: AutoListingResolvedJob): AutoListingPreflightSummary {
  const errors: string[] = [];
  const warnings: string[] = [];
  const sourceImages = resolved.input.feishuProductDataFile
    ? loadFeishuProductRecords(resolved.input.feishuProductDataFile).length
    : countImageFiles(resolved.input.feishuImageDir);
  const shops = countShopFolders(resolved.input.shopRootDir);
  const actualShopCodes = listShopCodes(resolved.input.shopRootDir);
  const missingShopCodes = expectedShopCodes(resolved).filter((shopCode) => !actualShopCodes.has(shopCode));

  if (!resolved.input.simulateOnly) {
    warnings.push(
      `Real mode is enabled. ${resolved.input.imageGenerationProvider} image generation, Feishu API calls, and Doudian publishing may consume external service quota.`
    );
  }
  if (sourceImages === 0) {
    errors.push(resolved.input.feishuProductDataFile ? "No Feishu product records were found." : "No source white-background images were found.");
  }
  if (missingShopCodes.length) {
    errors.push(`Missing required shop folders for codes: ${missingShopCodes.join(", ")}.`);
  }

  return {
    generatedAt: new Date().toISOString(),
    runId: path.basename(resolved.runtimeDir),
    simulateOnly: resolved.input.simulateOnly,
    source: {
      feishuProductDataFile: resolved.input.feishuProductDataFile || undefined,
      productInfoXlsx: resolved.input.productInfoXlsx || undefined,
      feishuImageDir: resolved.input.feishuImageDir,
      mainImageWorkDir: resolved.input.mainImageWorkDir,
      qualificationDir: resolved.input.qualificationDir,
      shopRootDir: resolved.input.shopRootDir,
      imageGenerationProvider: resolved.input.imageGenerationProvider,
      imageGenerationConfigFile: resolved.input.imageGenerationConfigFile || undefined,
      mainImageExpectedCount: resolved.input.mainImageExpectedCount,
      mainImageCountStrategy: resolved.input.mainImageCountStrategy,
      pauseSignalFile: resolved.pauseSignalFile
    },
    counts: {
      sourceImages,
      shops
    },
    errors,
    warnings
  };
}
