import fs from "node:fs";
import path from "node:path";
import { formatTimestamp, sanitizeFileName } from "../doubao/paths.js";
import { countTitleCharacters, DOUDIAN_TITLE_MAX_CHARACTERS, normalizeDoubaoGeneratedTitleForDoudian } from "./title-rules.js";
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

function totalTitleLength(tokens: string[]): number {
  return tokens.reduce((sum, token) => sum + countTitleCharacters(token), 0);
}

function findBestKeywordCombination(keywords: string[], targetLength: number, seed: number): string[] {
  if (targetLength <= 0) {
    return [];
  }

  let best: string[] = [];
  for (let offset = 0; offset < keywords.length; offset += 1) {
    const ordered = rotate(seed % 2 === 0 ? keywords : [...keywords].reverse(), offset + seed);
    const selected: string[] = [];
    let currentLength = 0;
    let changed = false;
    do {
      changed = false;
      for (let index = 0; index < ordered.length; index += 1) {
        const keyword = ordered[index];
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

export function buildTitlesFromFeishuKeywords(options: {
  keywordText: string;
  fixedSuffixText: string;
  productCategory?: string;
  titleCount: number;
}): string[] {
  const keywords = parseFeishuTitleKeywords(options.keywordText);
  const suffix = cleanTitleToken(options.fixedSuffixText);
  if (!keywords.length) {
    throw new Error("Feishu 标题关键词 is required.");
  }
  if (!suffix) {
    throw new Error("Feishu 标题固定后缀 is required.");
  }

  const titles: string[] = [];
  const seen = new Set<string>();
  const bodyLength = DOUDIAN_TITLE_MAX_CHARACTERS - countTitleCharacters(suffix);
  if (bodyLength <= 0) {
    throw new Error("Feishu 标题固定后缀 is too long; full title cannot exceed 120 characters.");
  }
  for (let index = 0; titles.length < options.titleCount && index < options.titleCount * Math.max(16, keywords.length * 2); index += 1) {
    const ordered = rotate(index % 2 === 0 ? keywords : [...keywords].reverse(), index);
    const bodyTokens = findBestKeywordCombination(ordered, bodyLength, index);
    if (!bodyTokens.length && bodyLength > 0) {
      continue;
    }
    const variedBodyTokens = index % 3 === 2 ? [...bodyTokens].reverse() : rotate(bodyTokens, index % bodyTokens.length);
    const title = `${variedBodyTokens.join("")}${suffix}`;
    if (countTitleCharacters(title) > DOUDIAN_TITLE_MAX_CHARACTERS || seen.has(title)) {
      continue;
    }
    seen.add(title);
    titles.push(title);
  }

  if (titles.length < options.titleCount) {
    throw new Error(
      `Feishu 标题关键词 could only compose ${titles.length}/${options.titleCount} unique title(s) without exceeding 120 characters. Add more varied keywords.`
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
    const normalized = normalizeDoubaoGeneratedTitleForDoudian(title);
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
