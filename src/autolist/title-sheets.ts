import fs from "node:fs";
import path from "node:path";
import { formatTimestamp, sanitizeFileName } from "../doubao/paths.js";
import { runDoubaoJob } from "../doubao/run.js";
import { writeSimpleWorkbook } from "./xlsx-lite.js";
import type { TitleSheetArtifact, TitleSheetFile } from "./types.js";

const TITLE_CONVERSATION_URL = "https://www.doubao.com/chat/38420067428736258";
const TITLE_PROMPT_PREFIX = "请严格执行全套标题生成规范：";

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

function buildRealTitlePrompt(titleCount: number): string {
  return [
    TITLE_PROMPT_PREFIX,
    "一、产品识别与命名规则（优先级固定）",
    "基础信息提取：核心品牌提取包装最醒目品牌名；无品牌通用原名提取包装官方标注全称；包装凸显部位提取包装主视觉强调身体部位。",
    "用户认知产品名推导规则不可更改优先级：通用名含部位时用“医用 + 部位 + 剂型”；通用名无部位时用“医用 + 包装部位 + 剂型”；剂型判定优先级为实物容器形态（喷瓶 = 喷剂）＞包装印刷剂型（凝胶）＞质地描述。",
    "存档规则：单品独立建档，同品永久复用，新品绝不混用旧品信息。",
    "二、专属热搜词库构建规则",
    "双源采集：来源1为以图搜款 + 抖音实时检索原生热搜词；来源2为以用户认知产品名联想拓展品类词。",
    "处理规则：去重合并，仅使用原生热搜词，严禁自造词。",
    "管理规则：单品独立词库，动态更新累积，长期存档。",
    "三、标题前缀规则",
    "随机三选一：医用级 / 正品 / 官方正品。",
    "四、标题结构与字数规则",
    "强制包含：品牌 + 用户认知产品名。",
    "关键词布局：高转化热搜大词前置。",
    "成分补充：仅部分标题添加1种核心成分，不强制。",
    "字数要求：每条标题严格填满60个中文字符，标题内容本身无空格。",
    "统一后缀：无品牌通用原名 + 延草纲目。",
    "五、内容侧重规则",
    "每条标题只侧重单一场景 / 人群 / 用途，不重复堆砌。",
    "贴合抖音电商搜索转化逻辑，关键词自然融入。",
    "六、绝对禁用词清单",
    "严禁出现：抖音、商城、热销、买送、炎症、草本、草药、治病、治疗及同类违规词汇。",
    "七、格式输出规则",
    `仅输出${titleCount}条标题，无任何解释、说明、备注。`,
    "编号格式固定为：01 标题内容，依次顺延至指定数量。",
    "除编号后的一个分隔空格外，标题内容无换行、无空格、无特殊符号。"
  ].join("\n");
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
  titleCount: number;
  simulateOnly: boolean;
  runtimeDir: string;
}): Promise<TitleSheetArtifact> {
  if (!options.simulateOnly) {
    return generateTitleSheetsFromDoubao({
      titleDir: options.titleDir,
      sourceImagePath: options.sourceImagePath,
      sellingPointText: options.sellingPointText,
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
  titleCount: number;
  runtimeDir: string;
}): Promise<TitleSheetArtifact> {
  fs.mkdirSync(options.titleDir, { recursive: true });
  const productName = inferProductName(options.sellingPointText);
  const timestamp = formatTimestamp();
  const outputDir = path.join(options.runtimeDir, "doubao-title-output");
  fs.mkdirSync(outputDir, { recursive: true });

  const result = await runDoubaoJob({
    promptText: buildRealTitlePrompt(options.titleCount),
    imagePaths: [options.sourceImagePath],
    outputDir,
    titleCount: options.titleCount,
    runtimeDir: path.join(options.runtimeDir, "doubao-title-run"),
    cleanupOutputDir: true,
    freshConversation: false,
    conversationUrl: TITLE_CONVERSATION_URL
  });

  if (result.status !== "success" || result.items.length === 0) {
    throw new Error(result.error?.message || "Doubao title generation returned no items.");
  }

  const titles = readTitlesFromCsv(result.items[0].csvFile);
  if (titles.length < options.titleCount) {
    throw new Error(`Doubao title generation returned ${titles.length} titles, expected ${options.titleCount}.`);
  }

  const generatedFiles: TitleSheetFile[] = titles.slice(0, options.titleCount).map((title, index) => {
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
    fs.copyFileSync(workbookFile, targetFile);
    updatedFiles[index].distributedTo = targetFolder;
  }
  return {
    generatedFiles: updatedFiles,
    simulated: true
  };
}
