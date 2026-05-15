import fs from "node:fs";
import path from "node:path";
import { readSimpleWordDocument } from "./docx-lite.js";
import { validateSellingPointText } from "./doubao-selling-points.js";
import type { DeepSeekArtifact, SellingPointArtifact, ShopDistributionArtifact } from "./types.js";

function existingOrFallback(filePath: string): string {
  return fs.existsSync(filePath) ? filePath : "";
}

export function recoverArtifactsFromWordFiles(options: {
  runtimeDir: string;
  taskId: string;
  jimengImageDir: string;
}): {
  sellingPointArtifact: SellingPointArtifact;
  deepseekArtifact: DeepSeekArtifact;
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

  const validated = validateSellingPointText(paragraphs[1]);
  const prompts = wordFiles.map((file) => {
    const parts = readSimpleWordDocument(file);
    if (parts.length < 3 || !parts[2]?.trim()) {
      throw new Error(`Word prompt file did not contain a DeepSeek prompt paragraph: ${file}`);
    }
    return parts[2].trim();
  });

  const taskDir = path.join(options.runtimeDir, "tasks", options.taskId);
  const sellingPointArtifact: SellingPointArtifact = {
    promptFile: existingOrFallback(path.join(taskDir, "doubao-selling-points-prompt.txt")),
    rawFile: existingOrFallback(path.join(taskDir, "doubao-selling-points-raw.txt")),
    screenshotFile: existingOrFallback(path.join(taskDir, "doubao-selling-points.png")),
    sellingPointText: validated.normalizedText,
    segments: validated.segments,
    brand: validated.brand,
    userCognitionName: validated.userCognitionName,
    brandedGenericName: validated.brandedGenericName,
    segmentCount: validated.segmentCount,
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
    deepseekArtifact
  };
}

export function recoverDistributedFoldersFromShopRoot(options: {
  shopRootDir: string;
}): {
  generatedProductFolders: string[];
  shopDistributionArtifact: ShopDistributionArtifact;
} {
  if (!fs.existsSync(options.shopRootDir)) {
    throw new Error(`Shop root directory did not exist: ${options.shopRootDir}`);
  }

  const distributedFolders = fs
    .readdirSync(options.shopRootDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(options.shopRootDir, entry.name))
    .flatMap((shopFolder) =>
      fs
        .readdirSync(shopFolder, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(shopFolder, entry.name))
    )
    .filter((productFolder) => {
      try {
        return fs.readdirSync(productFolder).some((name) => name.toLowerCase().endsWith(".xlsx"));
      } catch {
        return false;
      }
    })
    .sort((a, b) => a.localeCompare(b, "zh-CN"));

  if (!distributedFolders.length) {
    throw new Error(`No distributed product folders with workbook files were found in ${options.shopRootDir}.`);
  }

  return {
    generatedProductFolders: distributedFolders,
    shopDistributionArtifact: {
      distributedFolders,
      simulated: false
    }
  };
}
