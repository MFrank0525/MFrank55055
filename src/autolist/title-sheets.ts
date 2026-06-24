import fs from "node:fs";
import path from "node:path";
import { formatTimestamp, sanitizeFileName } from "../utils/path-names.js";
import { countTitleCharacters, DOUDIAN_TITLE_MAX_CHARACTERS, normalizeTitleForDoudian } from "./title-rules.js";
import { writeSimpleWorkbook } from "./xlsx-lite.js";
import type { TitleSheetArtifact, TitleSheetFile } from "./types.js";

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

function findBestKeywordCombination(keywords: string[], targetLength: number, seed: number): string[] {
  if (targetLength <= 0 || keywords.length === 0) {
    return [];
  }

  const gcd = (left: number, right: number): number => {
    let a = left;
    let b = right;
    while (b !== 0) {
      [a, b] = [b, a % b];
    }
    return a;
  };
  const steps = Array.from({ length: keywords.length }, (_, index) => index + 1).filter(
    (step) => gcd(step, keywords.length) === 1
  );
  const start = seed % keywords.length;
  const family = Math.floor(seed / keywords.length);
  const step = steps[family % steps.length] || 1;
  const direction = Math.floor(family / steps.length) % 2 === 0 ? 1 : -1;
  const minKeywordLength = Math.min(...keywords.map(countTitleCharacters));
  const maxIterations = keywords.length * (Math.ceil(targetLength / Math.max(1, minKeywordLength)) + 1);
  const selected: string[] = [];
  let currentLength = 0;

  for (let index = 0; index < maxIterations && targetLength - currentLength >= minKeywordLength; index += 1) {
    const keywordIndex = (start + direction * step * index + keywords.length * maxIterations) % keywords.length;
    const keyword = keywords[keywordIndex];
    const length = countTitleCharacters(keyword);
    if (currentLength + length <= targetLength) {
      selected.push(keyword);
      currentLength += length;
    }
  }
  return selected;
}

export function buildTitlesFromFeishuKeywords(options: {
  keywordText: string;
  fixedSuffixText: string;
  productCategory?: string;
  titleCount: number;
}): string[] {
  const keywords = parseFeishuTitleKeywords(options.keywordText);
  const isHealthFood = options.productCategory === "保健食品";
  const suffix = isHealthFood ? "" : cleanTitleToken(options.fixedSuffixText);
  const maxCharacters = isHealthFood ? 60 : DOUDIAN_TITLE_MAX_CHARACTERS;
  if (!keywords.length) {
    throw new Error("Feishu 标题关键词 is required.");
  }
  if (!isHealthFood && !suffix) {
    throw new Error("Feishu 标题固定后缀 is required.");
  }

  const titles: string[] = [];
  const seen = new Set<string>();
  const bodyLength = maxCharacters - countTitleCharacters(suffix);
  if (bodyLength <= 0) {
    throw new Error(`Feishu 标题固定后缀 is too long; full title cannot exceed ${maxCharacters} characters.`);
  }
  for (let index = 0; titles.length < options.titleCount && index < options.titleCount * Math.max(16, keywords.length * 2); index += 1) {
    const bodyTokens = findBestKeywordCombination(keywords, bodyLength, index);
    if (!bodyTokens.length && bodyLength > 0) {
      continue;
    }
    const variedBodyTokens = index % 3 === 2 ? [...bodyTokens].reverse() : rotate(bodyTokens, index % bodyTokens.length);
    const title = `${variedBodyTokens.join("")}${suffix}`;
    if (countTitleCharacters(title) > maxCharacters || seen.has(title)) {
      continue;
    }
    seen.add(title);
    titles.push(title);
  }

  if (titles.length < options.titleCount) {
    throw new Error(
      `Feishu 标题关键词 could only compose ${titles.length}/${options.titleCount} unique title(s) without exceeding ${maxCharacters} characters. Add more varied keywords.`
    );
  }
  return titles;
}

function inferProductName(userCognitionName: string | undefined, genericName: string | undefined): string {
  return sanitizeFileName(userCognitionName?.trim() || genericName?.trim() || "未命名产品") || "未命名产品";
}

function buildWorkbookRows(title: string, productPriceText: string): string[][] {
  return [
    ["字段", "内容"],
    ["标题", title],
    ["导购短标题", ""],
    ["品牌", ""],
    ["SPU信息", ""],
    ["型号规格", "盒装"],
    ["产品价格", productPriceText]
  ];
}

function buildTitleWorkbookFiles(options: {
  titleDir: string;
  productName: string;
  titles: string[];
  timestamp: string;
  productPriceText: string;
}): TitleSheetFile[] {
  return options.titles.map((title, index) => {
    const normalized = normalizeTitleForDoudian(title);
    const workbookFile = path.join(
      options.titleDir,
      `${sanitizeFileName(`${options.productName}标题${String(index + 1).padStart(2, "0")}${options.timestamp}`)}.xlsx`
    );
    writeSimpleWorkbook(workbookFile, buildWorkbookRows(normalized.title, options.productPriceText));
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
  fixedSuffixText?: string;
  productPriceText?: string;
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
    fixedSuffixText: options.fixedSuffixText || "",
    productCategory: options.productCategory,
    titleCount: options.titleCount
  });

  return {
    generatedFiles: buildTitleWorkbookFiles({
      titleDir: outputDir,
      productName,
      titles,
      timestamp,
      productPriceText: options.productPriceText || ""
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
