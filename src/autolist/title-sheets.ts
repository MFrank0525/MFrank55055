import fs from "node:fs";
import path from "node:path";
import { formatTimestamp, sanitizeFileName } from "../doubao/paths.js";
import { runDoubaoJob } from "../doubao/run.js";
import { readManualTextBlock } from "./operation-manual.js";
import { writeSimpleWorkbook } from "./xlsx-lite.js";
import type { TitleSheetArtifact, TitleSheetFile } from "./types.js";

function getTitleConversationUrl(): string {
  return readManualTextBlock("titles_generated", "固定标题对话");
}

function getTitlePromptPrefix(): string {
  return readManualTextBlock("titles_generated", "标题指令前缀");
}

function getTitleGenerationRule(titleCount: number): string {
  return readManualTextBlock("titles_generated", "标题生成规则").replaceAll("{{titleCount}}", String(titleCount));
}

function replaceProductPlaceholders(text: string, userCognitionName: string, genericName: string): string {
  return text
    .replaceAll("用户认知名", userCognitionName)
    .replaceAll("产品通用名称", genericName)
    .replaceAll("{{userCognitionName}}", userCognitionName)
    .replaceAll("{{genericName}}", genericName);
}

function inferProductName(sellingPointText: string): string {
  const firstSegment = sellingPointText.split(",").map((item) => item.trim()).filter(Boolean)[0] || "未命名产品";
  return sanitizeFileName(firstSegment) || "未命名产品";
}

function buildSimulatedTitles(productName: string, count: number): string[] {
  const suffixes = [
    "官方正品",
    "匠心甄选",
    "核心成分清晰",
    "图示步骤直观",
    "规格含量清楚",
    "适用部位明确",
    "电商主图同款",
    "店铺上新推荐",
    "品牌通用名称",
    "居家常备"
  ];
  return Array.from({ length: count }, (_, index) => {
    const suffix = suffixes[index % suffixes.length];
    return `${productName}${suffix}${String(index + 1).padStart(2, "0")}`;
  });
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

function buildRealTitlePrompt(titleCount: number, userCognitionName: string, genericName: string): string {
  return replaceProductPlaceholders(
    [getTitlePromptPrefix(), getTitleGenerationRule(titleCount)].join("\n"),
    userCognitionName,
    genericName
  );
}

function readTitlesFromCsv(csvFile: string): string[] {
  const lines = fs.readFileSync(csvFile, "utf8").split(/\r?\n/).filter(Boolean);
  return lines
    .slice(1)
    .map((line) => {
      const match = line.match(/^"?(?<index>\d+)"?,(?<title>".*"|[^,]+)$/);
      if (!match?.groups?.title) {
        return "";
      }
      const rawTitle = match.groups.title;
      return rawTitle.replace(/^"/, "").replace(/"$/, "").replace(/""/g, '"').trim();
    })
    .filter(Boolean);
}

export async function generateTitleSheets(options: {
  titleDir: string;
  sourceImagePath: string;
  sellingPointText: string;
  userCognitionName?: string;
  genericName?: string;
  titleCount: number;
  simulateOnly: boolean;
  runtimeDir: string;
}): Promise<TitleSheetArtifact> {
  if (!options.simulateOnly) {
    return generateTitleSheetsFromDoubao({
      titleDir: options.titleDir,
      sourceImagePath: options.sourceImagePath,
      sellingPointText: options.sellingPointText,
      userCognitionName: options.userCognitionName,
      genericName: options.genericName,
      titleCount: options.titleCount,
      runtimeDir: options.runtimeDir
    });
  }

  fs.mkdirSync(options.titleDir, { recursive: true });
  const productName = inferProductName(options.sellingPointText);
  const timestamp = formatTimestamp();
  const titles = buildSimulatedTitles(productName, options.titleCount);
  const generatedFiles: TitleSheetFile[] = titles.map((title, index) => {
    const workbookFile = path.join(
      options.titleDir,
      `${sanitizeFileName(`${productName}豆包${String(index + 1).padStart(2, "0")}${timestamp}`)}.xlsx`
    );
    writeSimpleWorkbook(workbookFile, buildWorkbookRows(title));
    return {
      title,
      workbookFile
    };
  });

  return {
    generatedFiles,
    simulated: options.simulateOnly
  };
}

export async function generateTitleSheetsFromDoubao(options: {
  titleDir: string;
  sourceImagePath: string;
  sellingPointText: string;
  userCognitionName?: string;
  genericName?: string;
  titleCount: number;
  runtimeDir: string;
}): Promise<TitleSheetArtifact> {
  fs.mkdirSync(options.titleDir, { recursive: true });
  const productName = inferProductName(options.sellingPointText);
  const userCognitionName = options.userCognitionName?.trim() || productName;
  const genericName = options.genericName?.trim();
  if (!genericName) {
    throw new Error("Doubao title generation requires Feishu genericName.");
  }
  const timestamp = formatTimestamp();
  const outputDir = path.join(options.runtimeDir, "doubao-title-output");
  fs.mkdirSync(outputDir, { recursive: true });

  const result = await runDoubaoJob({
    promptText: buildRealTitlePrompt(options.titleCount, userCognitionName, genericName),
    imagePaths: [options.sourceImagePath],
    outputDir,
    titleCount: options.titleCount,
    runtimeDir: path.join(options.runtimeDir, "doubao-title-run"),
    cleanupOutputDir: true,
    freshConversation: false,
    conversationUrl: getTitleConversationUrl(),
    attachImages: false,
    captureWaitMs: 90000
  });

  if (result.status !== "success" || result.items.length === 0) {
    throw new Error(result.error?.message || "Doubao title generation returned no items.");
  }

  const titles = readTitlesFromCsv(result.items[0].csvFile).slice(0, options.titleCount);
  if (titles.length < options.titleCount) {
    throw new Error(`Doubao title generation returned ${titles.length} titles, expected ${options.titleCount}.`);
  }

  const generatedFiles: TitleSheetFile[] = titles.map((title, index) => {
    const workbookFile = path.join(
      options.titleDir,
      `${sanitizeFileName(`${productName}豆包${String(index + 1).padStart(2, "0")}${timestamp}`)}.xlsx`
    );
    writeSimpleWorkbook(workbookFile, buildWorkbookRows(title));
    return {
      title,
      workbookFile
    };
  });

  return {
    generatedFiles,
    simulated: false
  };
}

export function distributeTitleSheets(productFolders: string[], generatedFiles: TitleSheetFile[]): TitleSheetArtifact {
  const updatedFiles = generatedFiles.map((item) => ({ ...item }));
  for (let index = 0; index < productFolders.length && index < updatedFiles.length; index += 1) {
    const targetFolder = productFolders[index];
    const workbookFile = updatedFiles[index].workbookFile;
    const targetFile = path.join(targetFolder, path.basename(workbookFile));
    for (const name of fs.readdirSync(targetFolder)) {
      if (name.toLowerCase().endsWith(".xlsx")) {
        fs.rmSync(path.join(targetFolder, name), { force: true });
      }
    }
    fs.copyFileSync(workbookFile, targetFile);
    updatedFiles[index].distributedTo = targetFolder;
  }
  return {
    generatedFiles: updatedFiles,
    simulated: true
  };
}
