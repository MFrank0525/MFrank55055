import fs from "node:fs";
import path from "node:path";
import { formatTimestamp, sanitizeFileName } from "../doubao/paths.js";
import { getProductCategoryPlan } from "./product-category.js";
import { assertGeneratedTitlesBelongToProduct, countTitleCharacters, normalizeDoubaoGeneratedTitleForDoudian } from "./title-rules.js";
import { writeSimpleWorkbook } from "./xlsx-lite.js";
import type { TitleSheetArtifact, TitleSheetFile } from "./types.js";

const TITLE_PREFIXES = ["医用级", "正品", "官方正品"];

function cleanTitleToken(value: string): string {
  return Array.from(value.replace(/\s+/g, "").trim())
    .filter((char) => /[\p{Script=Han}\p{L}\p{N}]/u.test(char))
    .join("");
}

export function parseFeishuTitleKeywords(keywordText: string): string[] {
  const tokens = keywordText
    .split(/[\n\r,，、;；|｜/]+/)
    .map(cleanTitleToken)
    .filter(Boolean);
  return Array.from(new Set(tokens));
}

function rotate<T>(items: T[], offset: number): T[] {
  if (!items.length) {
    return [];
  }
  const normalized = offset % items.length;
  return [...items.slice(normalized), ...items.slice(0, normalized)];
}

function totalTitleLength(tokens: string[]): number {
  return tokens.reduce((sum, token) => sum + countTitleCharacters(token), 0);
}

function findBestKeywordCombination(keywords: string[], targetLength: number): string[] {
  if (targetLength <= 0) {
    return [];
  }

  let best: string[] = [];
  for (let offset = 0; offset < keywords.length; offset += 1) {
    const ordered = rotate(keywords, offset);
    const selected: string[] = [];
    let currentLength = 0;
    let changed = false;
    do {
      changed = false;
      for (const keyword of ordered) {
        const length = countTitleCharacters(keyword);
        if (currentLength + length > targetLength) {
          continue;
        }
        selected.push(keyword);
        currentLength += length;
        changed = true;
        if (currentLength === targetLength) {
          return selected;
        }
      }
    } while (changed);
    if (currentLength > totalTitleLength(best)) {
      best = selected;
    }
  }
  return best;
}

function resolveTitleShape(options: { brand: string; genericName: string; productCategory?: string; index: number }): {
  prefix: string;
  suffix: string;
  targetLength: number;
} {
  const plan = getProductCategoryPlan(options.productCategory);
  if (plan.titleRule === "health_food") {
    return { prefix: "", suffix: "", targetLength: plan.titleCharacterCount };
  }
  const prefix = TITLE_PREFIXES[options.index % TITLE_PREFIXES.length];
  const suffix = plan.titleRule === "otc_drug" ? options.genericName.trim() : `${options.genericName.trim()}${options.brand.trim()}`;
  return { prefix, suffix, targetLength: plan.titleCharacterCount };
}

export function buildTitlesFromFeishuKeywords(options: {
  keywordText: string;
  brand: string;
  genericName: string;
  productCategory?: string;
  titleCount: number;
}): string[] {
  const keywords = parseFeishuTitleKeywords(options.keywordText);
  if (!keywords.length) {
    throw new Error("Feishu 标题关键词 is required.");
  }
  if (!options.genericName.trim()) {
    throw new Error("Feishu keyword title generation requires genericName.");
  }

  const titles: string[] = [];
  const seen = new Set<string>();
  for (let index = 0; titles.length < options.titleCount && index < options.titleCount * Math.max(8, keywords.length); index += 1) {
    const shape = resolveTitleShape({
      brand: options.brand,
      genericName: options.genericName,
      productCategory: options.productCategory,
      index
    });
    const fixedLength = countTitleCharacters(shape.prefix) + countTitleCharacters(shape.suffix);
    const bodyLength = shape.targetLength - fixedLength;
    const ordered = rotate(index % 2 === 0 ? keywords : [...keywords].reverse(), index);
    const bodyTokens = findBestKeywordCombination(ordered, bodyLength);
    if (!bodyTokens.length && bodyLength > 0) {
      continue;
    }
    const variedBodyTokens = index % 3 === 2 ? [...bodyTokens].reverse() : rotate(bodyTokens, index);
    const title = `${shape.prefix}${variedBodyTokens.join("")}${shape.suffix}`;
    if (countTitleCharacters(title) > shape.targetLength || seen.has(title)) {
      continue;
    }
    seen.add(title);
    titles.push(title);
  }

  if (titles.length < options.titleCount) {
    throw new Error(
      `Feishu 标题关键词 could only compose ${titles.length}/${options.titleCount} title(s) without exceeding category length. Add more varied keywords.`
    );
  }
  assertGeneratedTitlesBelongToProduct({
    titles,
    genericName: options.genericName,
    productCategory: options.productCategory
  });
  return titles;
}

function inferProductName(userCognitionName: string | undefined, genericName: string | undefined): string {
  return sanitizeFileName(userCognitionName?.trim() || genericName?.trim() || "未命名产品") || "未命名产品";
}

function buildWorkbookRows(title: string): string[][] {
  return [
    ["字段", "内容"],
    ["标题", title],
    ["导购短标题", ""],
    ["品牌", ""],
    ["SPU信息", ""],
    ["型号规格", "盒装"]
  ];
}

function buildTitleWorkbookFiles(options: {
  titleDir: string;
  productName: string;
  titles: string[];
  timestamp: string;
}): TitleSheetFile[] {
  return options.titles.map((title, index) => {
    const normalized = normalizeDoubaoGeneratedTitleForDoudian(title);
    const workbookFile = path.join(
      options.titleDir,
      `${sanitizeFileName(`${options.productName}标题${String(index + 1).padStart(2, "0")}${options.timestamp}`)}.xlsx`
    );
    writeSimpleWorkbook(workbookFile, buildWorkbookRows(normalized.title));
    return {
      title: normalized.title,
      workbookFile
    };
  });
}

export async function generateTitleSheets(options: {
  titleDir: string;
  sourceImagePath: string;
  sellingPointText: string;
  titleKeywordText?: string;
  brand?: string;
  userCognitionName?: string;
  genericName?: string;
  productCategory?: string;
  titleCount: number;
  simulateOnly: boolean;
  runtimeDir: string;
}): Promise<TitleSheetArtifact> {
  fs.mkdirSync(options.titleDir, { recursive: true });
  const productName = inferProductName(options.userCognitionName, options.genericName);
  const timestamp = formatTimestamp();
  const outputDir = options.simulateOnly ? path.join(options.runtimeDir, "simulated-titles") : options.titleDir;
  fs.mkdirSync(outputDir, { recursive: true });
  const titles = buildTitlesFromFeishuKeywords({
    keywordText: options.titleKeywordText || "",
    brand: options.brand || "",
    genericName: options.genericName || "",
    productCategory: options.productCategory,
    titleCount: options.titleCount
  });

  return {
    generatedFiles: buildTitleWorkbookFiles({
      titleDir: outputDir,
      productName,
      titles,
      timestamp
    }),
    simulated: options.simulateOnly
  };
}

export function assertTitleDistributionTargets(productFolders: string[], titleCount: number): void {
  if (productFolders.length !== titleCount) {
    throw new Error(`Title distribution target count mismatch: productFolders=${productFolders.length}, titles=${titleCount}.`);
  }
  const occupiedFolders = productFolders
    .map((folder) => ({
      folder,
      workbookFiles: fs.existsSync(folder)
        ? fs.readdirSync(folder).filter((name) => name.toLowerCase().endsWith(".xlsx"))
        : []
    }))
    .filter((item) => item.workbookFiles.length > 0);
  if (occupiedFolders.length > 0) {
    throw new Error(
      `Refusing to generate paid titles while product folders already contain workbook(s): ${occupiedFolders
        .map((item) => `${item.folder} -> ${item.workbookFiles.join(", ")}`)
        .join(" | ")}`
    );
  }
}

export function distributeTitleSheets(productFolders: string[], generatedFiles: TitleSheetFile[], simulateOnly: boolean): TitleSheetArtifact {
  assertTitleDistributionTargets(productFolders, generatedFiles.length);
  const updatedFiles = generatedFiles.map((item) => ({ ...item }));
  for (let index = 0; index < productFolders.length && index < updatedFiles.length; index += 1) {
    const targetFolder = productFolders[index];
    const workbookFile = updatedFiles[index].workbookFile;
    const targetFile = path.join(targetFolder, path.basename(workbookFile));
    if (!simulateOnly) {
      const existingWorkbookFiles = fs
        .readdirSync(targetFolder)
        .filter((name) => name.toLowerCase().endsWith(".xlsx") && path.join(targetFolder, name) !== targetFile);
      if (existingWorkbookFiles.length > 0) {
        throw new Error(
          `Refusing to remove existing workbook(s) in ${targetFolder}: ${existingWorkbookFiles.join(", ")}`
        );
      }
      fs.copyFileSync(workbookFile, targetFile);
    }
    updatedFiles[index].distributedTo = targetFolder;
  }
  return {
    generatedFiles: updatedFiles,
    simulated: simulateOnly
  };
}
