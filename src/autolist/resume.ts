import fs from "node:fs";
import path from "node:path";
import { readSimpleWordDocument } from "./docx-lite.js";
import { validateSellingPointText } from "./doubao-selling-points.js";
import { loadFeishuProductRuntimeRecord } from "./feishu-products.js";
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
    .filter((name) => /^即梦提示词\d{2}\.docx$/i.test(name))
    .sort((a, b) => a.localeCompare(b, "zh-CN"))
    .map((name) => path.join(options.jimengImageDir, name));

  if (wordFiles.length < 5) {
    throw new Error(`Expected 5 Word prompt files in ${options.jimengImageDir}, got ${wordFiles.length}.`);
  }

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
  const validated = feishuRuntimeRecord ? null : validateSellingPointText(paragraphs[1]);
  const prompts = wordFiles.map((file) => {
    const parts = readSimpleWordDocument(file);
    if (parts.length < 3 || !parts[2]?.trim()) {
      throw new Error(`Word prompt file did not contain a DeepSeek prompt paragraph: ${file}`);
    }
    return parts[2].trim();
  });

  const taskDir = path.join(options.runtimeDir, "tasks", options.taskId);
  const sellingPointArtifact: SellingPointArtifact =
    feishuRuntimeRecord?.sellingPointArtifact || {
      promptFile: existingOrFallback(path.join(taskDir, "doubao-selling-points-prompt.txt")),
      rawFile: existingOrFallback(path.join(taskDir, "doubao-selling-points-raw.txt")),
      screenshotFile: existingOrFallback(path.join(taskDir, "doubao-selling-points.png")),
      sellingPointText: (validated as NonNullable<typeof validated>).normalizedText,
      segments: (validated as NonNullable<typeof validated>).segments,
      brand: (validated as NonNullable<typeof validated>).brand,
      userCognitionName: (validated as NonNullable<typeof validated>).userCognitionName,
      brandedGenericName: (validated as NonNullable<typeof validated>).brandedGenericName,
      segmentCount: (validated as NonNullable<typeof validated>).segmentCount,
      simulated: false
    };

  const deepseekArtifact: DeepSeekArtifact = {
    promptFile: existingOrFallback(path.join(taskDir, "deepseek-poster-prompt.txt")),
    rawFile: existingOrFallback(path.join(taskDir, "deepseek-raw.txt")),
    extractedFile: existingOrFallback(path.join(taskDir, "deepseek-extracted.txt")),
    screenshotFile: existingOrFallback(path.join(taskDir, "deepseek.png")),
    prompts,
    wordFiles,
    simulated: false
  };

  return {
    sellingPointArtifact,
    deepseekArtifact,
    feishuProductRecord: feishuRuntimeRecord?.record
  };
}

export function recoverDistributedFoldersFromShopRoot(options: {
  shopRootDir: string;
  requireWorkbook?: boolean;
  expectedCount?: number;
}): {
  generatedProductFolders: string[];
  shopDistributionArtifact: ShopDistributionArtifact;
} {
  if (!fs.existsSync(options.shopRootDir)) {
    throw new Error(`Shop root directory did not exist: ${options.shopRootDir}`);
  }

  const shopFolders = readShopFolders(options.shopRootDir);
  const distributedFolders = shopFolders
    .flatMap((shopFolder) =>
      fs
        .readdirSync(shopFolder, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(shopFolder, entry.name))
    )
    .filter((productFolder) => {
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
    throw new Error(`No distributed product folders with workbook files were found in ${options.shopRootDir}.`);
  }

  return {
    generatedProductFolders: selectedFolders,
    shopDistributionArtifact: {
      distributedFolders: selectedFolders,
      simulated: false
    }
  };
}
