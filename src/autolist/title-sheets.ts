import fs from "node:fs";
import path from "node:path";
import { formatTimestamp, sanitizeFileName } from "../doubao/paths.js";
import { runDoubaoJob } from "../doubao/run.js";
import { readManualTextBlock } from "./operation-manual.js";
import { getProductCategoryPlan } from "./product-category.js";
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

function buildMedicalDeviceTitleRule(titleCount: number): string {
  return getTitleGenerationRule(titleCount);
}

function buildOtcDrugTitleRule(titleCount: number, genericName: string): string {
  return `一、关键词采集规则【真实抖音商城热搜词】
只采集抖音商城搜索下拉词、商品流量大词、成交热搜词，严禁乱填词，杜绝自创词、凑数词、冷门词
关键词统一以中文逗号隔开排列，只保留和产品强相关实用词汇
二、标题硬性格式规则
标题开头固定三选一随机使用：医用级、正品、官方正品
标题结尾固定填写指定统一后缀，不添加符号、空格、特殊字符，后缀固定为：${genericName}
全篇标题无任何空格，字体连贯紧凑
固定禁用词汇：抖音、热销、买送、炎症、草本、草药、治病，全程严禁出现
内容构成：只拼接采集好的真实热搜关键词，禁止私自添加修饰句、宣传语、多余文案
字数标准：单条标题严格锁定58个汉字，逐字核对，不多一字、不少一字
三、排版输出规则
标题编号统一格式：01、02、03……依次排序至${titleCount}条
仅输出成品标题内容，不附带关键词列表、解释、备注、话术、说明
${titleCount}条全部生成完毕即可终止输出，无额外多余内容
四、按照这些规则，生成电商标题
采集用户认知名和产品通用名称在抖音商城真实高热度高转化高频搜索关键词，逗号分隔排版，不用自创冷门词汇。依据以上全套执行规则组合创作标题，每条严格58个汉字，开头轮换医用级、正品、官方正品，结尾固定指定后缀产品通用名称，无空格无违规词，仅拼接热搜词凑齐字数，逐条核对字数无误，按01至${titleCount}编号输出${titleCount}条成品标题，不添加任何多余内容。`;
}

function buildHealthFoodTitleRule(titleCount: number): string {
  return `一、关键词采集规则【真实抖音商城热搜词】
只采集抖音商城搜索下拉词、商品流量大词、成交热搜词，严禁乱填词，杜绝自创词、凑数词、冷门词
关键词统一以中文逗号隔开排列，只保留和产品强相关实用词汇
二、标题硬性格式规则
标题取消固定前缀，不使用“医用级、正品、官方正品”等固定开头
标题取消固定后缀，不添加统一后缀
全篇标题无任何空格，字体连贯紧凑
固定禁用词汇：抖音、热销、买送、炎症、草本、草药、治病，全程严禁出现
内容构成：只拼接采集好的真实热搜关键词，禁止私自添加修饰句、宣传语、多余文案
字数标准：单条标题严格锁定28个汉字，逐字核对，不多一字、不少一字
三、排版输出规则
标题编号统一格式：01、02、03……依次排序至${titleCount}条
仅输出成品标题内容，不附带关键词列表、解释、备注、话术、说明
${titleCount}条全部生成完毕即可终止输出，无额外多余内容
四、按照这些规则，生成电商标题
采集用户认知名和产品通用名称在抖音商城真实高热度高转化高频搜索关键词，逗号分隔排版，不用自创冷门词汇。依据以上全套执行规则组合创作标题，每条严格28个汉字，无固定前缀，无固定后缀，无空格无违规词，仅拼接热搜词凑齐字数，逐条核对字数无误，按01至${titleCount}编号输出${titleCount}条成品标题，不添加任何多余内容。`;
}

function buildCategoryTitleRule(titleCount: number, userCognitionName: string, genericName: string, productCategory?: string): string {
  const plan = getProductCategoryPlan(productCategory);
  if (plan.titleRule === "otc_drug") {
    return buildOtcDrugTitleRule(titleCount, genericName);
  }
  if (plan.titleRule === "health_food") {
    return buildHealthFoodTitleRule(titleCount);
  }
  return buildMedicalDeviceTitleRule(titleCount);
}

function buildRealTitlePrompt(titleCount: number, userCognitionName: string, genericName: string, productCategory?: string): string {
  return replaceProductPlaceholders(
    [getTitlePromptPrefix(), buildCategoryTitleRule(titleCount, userCognitionName, genericName, productCategory)].join("\n"),
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

function titleLength(title: string): number {
  return Array.from(title).length;
}

function validateGeneratedTitles(titles: string[], productCategory: string | undefined, genericName: string): void {
  const plan = getProductCategoryPlan(productCategory);
  const forbiddenWords = ["抖音", "热销", "买送", "炎症", "草本", "草药", "治病"];
  const errors: string[] = [];

  titles.forEach((title, index) => {
    const label = String(index + 1).padStart(2, "0");
    if (titleLength(title) !== plan.titleCharacterCount) {
      errors.push(`${label} length=${titleLength(title)}, expected=${plan.titleCharacterCount}`);
    }
    if (/\s/.test(title)) {
      errors.push(`${label} contains whitespace`);
    }
    const forbidden = forbiddenWords.find((word) => title.includes(word));
    if (forbidden) {
      errors.push(`${label} contains forbidden word: ${forbidden}`);
    }
    if (plan.titleRule === "otc_drug") {
      if (!/^(医用级|正品|官方正品)/.test(title)) {
        errors.push(`${label} missing OTC prefix`);
      }
      if (!title.endsWith(genericName)) {
        errors.push(`${label} missing OTC suffix: ${genericName}`);
      }
    }
    if (plan.titleRule === "health_food" && /^(医用级|正品|官方正品)/.test(title)) {
      errors.push(`${label} health food title uses fixed prefix`);
    }
  });

  if (errors.length > 0) {
    throw new Error(`Doubao title validation failed: ${errors.join(" | ")}`);
  }
}

export async function generateTitleSheets(options: {
  titleDir: string;
  sourceImagePath: string;
  sellingPointText: string;
  userCognitionName?: string;
  genericName?: string;
  productCategory?: string;
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
      productCategory: options.productCategory,
      titleCount: options.titleCount,
      runtimeDir: options.runtimeDir
    });
  }

  const titleOutputDir = path.join(options.runtimeDir, "simulated-titles");
  fs.mkdirSync(titleOutputDir, { recursive: true });
  const productName = inferProductName(options.sellingPointText);
  const timestamp = formatTimestamp();
  const titles = buildSimulatedTitles(productName, options.titleCount);
  const generatedFiles: TitleSheetFile[] = titles.map((title, index) => {
    const workbookFile = path.join(
      titleOutputDir,
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
  productCategory?: string;
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
    promptText: buildRealTitlePrompt(options.titleCount, userCognitionName, genericName, options.productCategory),
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
  validateGeneratedTitles(titles, options.productCategory, genericName);

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
