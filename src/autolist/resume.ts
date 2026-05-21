import fs from "node:fs";
import path from "node:path";
import { sanitizeFileName } from "../doubao/paths.js";
import { readSimpleWordDocument } from "./docx-lite.js";
import { loadFeishuProductRuntimeRecord } from "./feishu-products.js";
import { getProductCategoryPlan } from "./product-category.js";
import type { FeishuProductRecord } from "../feishu/types.js";
import type { DeepSeekArtifact, SellingPointArtifact, ShopDistributionArtifact } from "./types.js";

function existingOrFallback(filePath: string): string {
  return fs.existsSync(filePath) ? filePath : "";
}

function readShopFolders(shopRootDir: string): string[] {
  return fs
    .readdirSync(shopRootDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(shopRootDir, entry.name))
    .sort((a, b) => path.basename(a).localeCompare(path.basename(b), "zh-CN"));
}

function trailingNumber(filePath: string): number | null {
  const match = path.basename(filePath).match(/(\d+)(?!.*\d)/);
  return match ? Number(match[1]) : null;
}

function selectExpectedProductFolders(options: {
  productFolders: string[];
  shopFolders: string[];
  expectedCount?: number;
}): string[] {
  if (!options.expectedCount || options.productFolders.length <= options.expectedCount) {
    return options.productFolders;
  }

  const perShopCount = Math.ceil(options.expectedCount / Math.max(1, options.shopFolders.length));
  const selected: string[] = [];
  for (let index = 1; index <= options.expectedCount; index += 1) {
    const candidates = options.productFolders.filter((folder) => trailingNumber(folder) === index);
    if (!candidates.length) {
      return options.productFolders;
    }
    const expectedShopFolder = options.shopFolders[Math.min(options.shopFolders.length - 1, Math.floor((index - 1) / perShopCount))];
    const preferred =
      candidates.find((folder) => path.dirname(folder) === expectedShopFolder) ||
      candidates.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
    selected.push(preferred);
  }

  return selected;
}

export function recoverArtifactsFromWordFiles(options: {
  runtimeDir: string;
  taskId: string;
  jimengImageDir: string;
  feishuProductDataFile?: string;
  sourceImagePath?: string;
}): {
  sellingPointArtifact: SellingPointArtifact;
  deepseekArtifact: DeepSeekArtifact;
  feishuProductRecord?: FeishuProductRecord;
} {
  const wordFiles = fs
    .readdirSync(options.jimengImageDir)
    .filter((name) => /^(主图提示词|即梦提示词)\d{2}\.docx$/i.test(name))
    .sort((a, b) => a.localeCompare(b, "zh-CN"))
    .map((name) => path.join(options.jimengImageDir, name));

  const paragraphs = readSimpleWordDocument(wordFiles[0]);
  if (paragraphs.length < 3) {
    throw new Error(`Word prompt file did not contain enough paragraphs: ${wordFiles[0]}`);
  }

  const feishuRuntimeRecord =
    options.feishuProductDataFile && options.sourceImagePath
      ? loadFeishuProductRuntimeRecord({
          productDataFile: options.feishuProductDataFile,
          sourceImagePath: options.sourceImagePath,
          runtimeDir: options.runtimeDir,
          taskId: options.taskId
        })
      : null;
  if (!feishuRuntimeRecord) {
    throw new Error("Selling points must come from Feishu product data. feishuProductDataFile is required for resume.");
  }
  const expectedPromptCount = getProductCategoryPlan(feishuRuntimeRecord.record.productCategory).promptCount;
  if (wordFiles.length < expectedPromptCount) {
    throw new Error(`Expected ${expectedPromptCount} Word prompt files in ${options.jimengImageDir}, got ${wordFiles.length}.`);
  }

  const prompts = wordFiles.map((file) => {
    const parts = readSimpleWordDocument(file);
    if (parts.length < 3 || !parts[2]?.trim()) {
      throw new Error(`Word prompt file did not contain a DeepSeek prompt paragraph: ${file}`);
    }
    return parts[2].trim();
  });

  const sellingPointArtifact: SellingPointArtifact = feishuRuntimeRecord.sellingPointArtifact;

  const deepseekArtifact: DeepSeekArtifact = {
    promptFile: existingOrFallback(path.join(options.runtimeDir, "tasks", options.taskId, "deepseek-poster-prompt.txt")),
    rawFile: existingOrFallback(path.join(options.runtimeDir, "tasks", options.taskId, "deepseek-raw.txt")),
    extractedFile: existingOrFallback(path.join(options.runtimeDir, "tasks", options.taskId, "deepseek-extracted.txt")),
    screenshotFile: existingOrFallback(path.join(options.runtimeDir, "tasks", options.taskId, "deepseek.png")),
    prompts,
    wordFiles,
    simulated: false
  };

  return {
    sellingPointArtifact,
    deepseekArtifact,
    feishuProductRecord: feishuRuntimeRecord.record
  };
}

export function recoverDistributedFoldersFromShopRoot(options: {
  shopRootDir: string;
  requireWorkbook?: boolean;
  expectedCount?: number;
  productNameCandidates?: string[];
  expectedProductFolderNames?: string[];
}): {
  generatedProductFolders: string[];
  shopDistributionArtifact: ShopDistributionArtifact;
} {
  if (!fs.existsSync(options.shopRootDir)) {
    throw new Error(`Shop root directory did not exist: ${options.shopRootDir}`);
  }

  const shopFolders = readShopFolders(options.shopRootDir);
  const productNameCandidates = Array.from(
    new Set((options.productNameCandidates || []).map((item) => sanitizeFileName(item)).filter(Boolean))
  );
  const expectedProductFolderNames = new Set(
    (options.expectedProductFolderNames || []).map((item) => sanitizeFileName(item)).filter(Boolean)
  );
  const distributedFolders = shopFolders
    .flatMap((shopFolder) =>
      fs
        .readdirSync(shopFolder, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(shopFolder, entry.name))
    )
    .filter((productFolder) => {
      if (expectedProductFolderNames.size > 0) {
        return expectedProductFolderNames.has(path.basename(productFolder));
      }
      if (
        productNameCandidates.length > 0 &&
        !productNameCandidates.some((productName) => path.basename(productFolder).includes(productName))
      ) {
        return false;
      }
      if (options.requireWorkbook === false) {
        return true;
      }
      try {
        return fs.readdirSync(productFolder).some((name) => name.toLowerCase().endsWith(".xlsx"));
      } catch {
        return false;
      }
    })
    .sort((a, b) => a.localeCompare(b, "zh-CN"));
  const selectedFolders = selectExpectedProductFolders({
    productFolders: distributedFolders,
    shopFolders,
    expectedCount: options.expectedCount
  });

  if (!selectedFolders.length) {
    const productFilter = productNameCandidates.length ? ` matching ${productNameCandidates.join(" / ")}` : "";
    throw new Error(`No distributed product folders${productFilter} with workbook files were found in ${options.shopRootDir}.`);
  }

  return {
    generatedProductFolders: selectedFolders,
    shopDistributionArtifact: {
      distributedFolders: selectedFolders,
      simulated: false
    }
  };
}
