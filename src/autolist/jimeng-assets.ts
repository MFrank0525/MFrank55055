import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { sanitizeFileName } from "../doubao/paths.js";
import { extendPathEnv, getDreaminaWrapperPath, getPythonCommand } from "../utils/platform.js";
import { readSimpleWordDocument } from "./docx-lite.js";
import { applyLocalWatermark } from "./local-watermark.js";
import { shopCodeFromFolder } from "./product-category.js";
import { buildDreaminaImageEditInstruction } from "./rule-text.js";
import type { DreaminaImageCountStrategy, ImageGenerationProvider, JimengArtifact, JimengGeneratedFile } from "./types.js";

const execFileAsync = promisify(execFile);

const SHOP_SPECS = [
  {
    shopCode: "01",
    watermarkText: "延草纲目理疗器械旗舰店"
  },
  {
    shopCode: "02",
    watermarkText: "延草纲目健康护理专营店"
  },
  {
    shopCode: "03",
    watermarkText: "延草纲目个护保健专营店"
  },
  {
    shopCode: "04",
    watermarkText: "延草纲目康复理疗专营店"
  },
  {
    shopCode: "05",
    watermarkText: "延草纲目医疗保健专营店"
  }
] as const;

const DREAMINA_IMAGE2IMAGE_WRAPPER = getDreaminaWrapperPath("image2image.py");
const DREAMINA_QUERY_WRAPPER = getDreaminaWrapperPath("query_result.py");
const DREAMINA_USER_CREDIT_WRAPPER = getDreaminaWrapperPath("user_credit.py");

interface OpenAiCompatibleImageConfig {
  provider?: "openai-compatible";
  apiUrl: string;
  apiKey?: string;
  model: string;
  mode?: "generations" | "edits";
  size?: string;
  responseFormat?: "b64_json" | "url";
  timeoutMs?: number;
  requestExtra?: Record<string, unknown>;
}

function parseSellingPointFields(sellingPointText: string): {
  brand: string;
  userCognitionName: string;
  genericName: string;
} {
  const labeledUser = sellingPointText.match(/用户认知名[为是：:]\s*([^，,。]+)/)?.[1]?.trim() || "";
  const labeledGeneric = sellingPointText.match(/产品通用名称[为是：:]\s*([^，,。]+)/)?.[1]?.trim() || "";
  const labeledBrand = sellingPointText.match(/品牌[为是：:]\s*([^，,。]+)/)?.[1]?.trim() || "";
  const segments = sellingPointText
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const brand = labeledBrand || segments[0] || "";
  const userCognitionName = labeledUser || segments[1] || segments[0] || "";
  const genericName = labeledGeneric || segments[2] || segments[1] || segments[0] || "";
  return {
    brand,
    userCognitionName,
    genericName
  };
}

const PRODUCT_REFERENCE_GUARDRAIL =
  "产品主体必须来自输入参考图，不允许根据文字重新绘制产品；请把输入参考图里的产品当作锁定主体嵌入海报，不要重新设计包装，不要改写包装文字，不要改变盒子和管体的形状、数量、角度关系、颜色和标识。背景、光影、氛围、道具可以生成，但产品包装文字和产品细节必须尽量保持参考图一致。";
const IMAGE_EDIT_OUTPUT_GUARDRAIL =
  "严格按照提示词生成图片，不要擅自过滤、删减或改写提示词中要求展示的内容。用户认知名、产品通用名称、产品卖点、提示词、禁止展示、不展示、不要展示、批文注册号、注册号、备案号、说明、规则、要求等解释性或约束性词汇只是给模型理解的指令，不要作为海报文字出现在图片里；但提示词要求体现的产品使用部位、使用步骤、场景元素、标题、副标题和卖点内容需要在图片中展示。";

function buildImageVariationInstruction(imageIndex: number): string {
  const variants = [
    "本轮第1张：背景风格与本 Word 其他图片保持相近，主标题偏左上大字排版，副标题紧跟主标题下方，产品主体偏右且正面展示，卖点纵向排列。",
    "本轮第2张：背景风格与本 Word 其他图片保持相近，主标题居中或偏上横向排版，产品主体居中偏下且轻微侧角展示，卖点分组排列。",
    "本轮第3张：背景风格与本 Word 其他图片保持相近，主标题偏右上或斜向层次排版，产品主体偏左或居中放大，展示不同光影和道具层次。",
    "本轮第4张：背景风格与本 Word 其他图片保持相近，主标题采用更紧凑的艺术字排版，产品主体站位和角度区别于前三张，卖点布局更有节奏。"
  ];
  return variants[(imageIndex - 1) % variants.length];
}

function ensureTaskDir(runtimeDir: string, taskId: string): string {
  const taskDir = path.join(runtimeDir, "tasks", sanitizeFileName(taskId));
  fs.mkdirSync(taskDir, { recursive: true });
  return taskDir;
}

function writePromptSummary(taskDir: string, promptFiles: string[]): string {
  const promptFile = path.join(taskDir, "jimeng-prompts.txt");
  fs.writeFileSync(promptFile, `${promptFiles.join("\n")}\n`, "utf8");
  return promptFile;
}

function listImageFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs
    .readdirSync(dir)
    .filter((name) => /\.(png|jpg|jpeg|webp)$/i.test(name))
    .map((name) => path.join(dir, name))
    .sort((a, b) => a.localeCompare(b, "zh-CN"));
}

function listImageFilesRecursive(dir: string): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }

  const collected: string[] = [];
  const pending = [dir];
  while (pending.length > 0) {
    const currentDir = pending.pop() as string;
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        pending.push(fullPath);
        continue;
      }
      if (/\.(png|jpg|jpeg|webp)$/i.test(entry.name)) {
        collected.push(fullPath);
      }
    }
  }

  return collected.sort((a, b) => a.localeCompare(b, "zh-CN"));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isBillingError(message: string): boolean {
  return /余额|balance|quota|credit|insufficient|欠费|充值|billing/i.test(message);
}

function normalizeImageGenerationError(message: string): Error {
  if (isBillingError(message)) {
    return new Error(`Image generation balance appears insufficient. Please recharge the relay account. Raw error: ${message}`);
  }
  if (/abort|timeout|timed out/i.test(message)) {
    return new Error(`Image generation request timed out. The provider did not respond in time. Raw error: ${message}`);
  }
  return new Error(message);
}

function isContentPolicyError(message: string): boolean {
  return /content[_ -]?policy|policy[_ -]?violation|safety|unsafe|moderation|violat/i.test(message);
}

function isTransientImageProviderStatus(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function extractTitleLine(promptText: string, label: string): string {
  const match = promptText.match(new RegExp(`${label}[：:]\\s*([^，,。\\n]+)`));
  return match?.[1]?.trim() || "";
}

function buildPolicyCompatibleImageEditPrompt(promptText: string, imageIndex: number): string {
  const userCognitionName = extractTitleLine(promptText, "主标题") || "产品海报";
  const genericName = extractTitleLine(promptText, "副标题") || "产品";
  const visualBadges = [
    "官方正品",
    "正品保障",
    "20g/支",
    "外包装展示",
    "使用步骤图示",
    "适用部位图示"
  ].join("，");

  return [
    "【产品海报设计】请基于输入参考图制作传统电商海报。产品主体必须直接来自输入参考图，保持包装盒和管体的数量、形状、颜色、角度关系、主要标识和可见文字，不要根据文字重新绘制产品，也不要减少参考图中的任何产品主体。",
    `海报文字只展示：主标题“${userCognitionName}”，副标题“${genericName}”，以及以下中性信息点：${visualBadges}。不要展示解释性词汇、约束性词汇、注册号、备案号、批文号或规则说明。`,
    "背景、光影、道具和氛围可以生成，风格为 C4D、OC 渲染、传统电商海报；产品主体尽可能放大并清晰可见，和整体海报光影自然融合。",
    "可以用图标或简洁画面表达使用步骤和适用部位，但不要添加功效承诺、治疗暗示、夸大宣传或医学诊断表达。",
    buildImageVariationInstruction(imageIndex)
  ].join("\n");
}

function resolveShopFolders(shopRootDir: string): Array<{ shopFolder: string; watermarkText: string }> {
  const existingFolders = fs
    .readdirSync(shopRootDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      fullPath: path.join(shopRootDir, entry.name)
    }));

  return SHOP_SPECS.map((spec) => {
    const match = existingFolders.find((folder) => folder.name.startsWith(spec.shopCode));

    if (!match) {
      throw new Error(`Shop folder not found for code ${spec.shopCode}`);
    }

    return {
      shopFolder: match.fullPath,
      watermarkText: spec.watermarkText
    };
  });
}

function filterShopFoldersByCodes(
  shopFolders: Array<{ shopFolder: string; watermarkText: string }>,
  shopCodes?: string[]
): Array<{ shopFolder: string; watermarkText: string }> {
  if (!shopCodes?.length) {
    return shopFolders;
  }
  const wanted = new Set(shopCodes);
  const filtered = shopFolders.filter((item) => wanted.has(shopCodeFromFolder(item.shopFolder)));
  if (filtered.length !== shopCodes.length) {
    throw new Error(`Shop folder category plan mismatch. expected=${shopCodes.join(",")}; actual=${filtered.map((item) => shopCodeFromFolder(item.shopFolder)).join(",")}`);
  }
  return filtered;
}

function inferBrandedGenericName(brandedGenericName: string, sellingPointText: string): string {
  if (brandedGenericName.trim()) {
    return brandedGenericName.trim();
  }
  const segments = sellingPointText
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return segments[1] || segments[0] || "未命名产品";
}

function buildDreaminaPromptFromWord(paragraphs: string[], promptWordFile: string): string {
  const cleaned = paragraphs.map((item) => item.trim()).filter(Boolean);
  if (cleaned.length !== 3) {
    throw new Error(`Prompt Word file must contain exactly 3 paragraphs (instruction1, selling points, deepseek prompt): ${promptWordFile}`);
  }

  const instruction = cleaned[0] || "";
  const sellingPoints = cleaned[1] || "";
  const deepseekPrompt = cleaned[cleaned.length - 1] || "";
  if (!instruction || !sellingPoints || !deepseekPrompt) {
    throw new Error(`Prompt Word file had empty required paragraph: ${promptWordFile}`);
  }
  const promptText = [
    instruction,
    PRODUCT_REFERENCE_GUARDRAIL,
    IMAGE_EDIT_OUTPUT_GUARDRAIL,
    deepseekPrompt
  ].join("\n");
  if (!promptText.trim()) {
    throw new Error(`Dreamina prompt could not be built from Word file: ${promptWordFile}`);
  }
  return promptText;
}

function buildImageEditPromptFromWord(options: {
  paragraphs: string[];
  promptWordFile: string;
  brand: string;
  userCognitionName: string;
  genericName: string;
}): string {
  const cleaned = options.paragraphs.map((item) => item.trim()).filter(Boolean);
  if (cleaned.length !== 3) {
    throw new Error(`Prompt Word file must contain exactly 3 paragraphs (instruction1, selling points, deepseek prompt): ${options.promptWordFile}`);
  }
  const sellingPoints = cleaned[1] || "";
  const deepseekPrompt = cleaned[cleaned.length - 1] || "";
  if (!sellingPoints || !deepseekPrompt) {
    throw new Error(`Prompt Word file had empty required paragraph: ${options.promptWordFile}`);
  }
  return [
    buildDreaminaImageEditInstruction(options.brand, options.userCognitionName, options.genericName, sellingPoints),
    IMAGE_EDIT_OUTPUT_GUARDRAIL,
    deepseekPrompt
  ].join("\n");
}

async function runWrapperJson(args: string[]): Promise<any> {
  try {
    const commandArgs = ["-X", "utf8", ...args];
    const dreaminaBinDir = process.env.DREAMINA_BIN ? path.dirname(process.env.DREAMINA_BIN) : "";
    const { stdout, stderr } = await execFileAsync(getPythonCommand(), commandArgs, {
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 32,
      env: {
        ...extendPathEnv([dreaminaBinDir]),
        PYTHONIOENCODING: "utf-8",
      }
    });

    const text = `${stdout}\n${stderr}`.trim();
    const match = text.match(/(\{[\s\S]*\})\s*$/);
    if (!match) {
      throw new Error(`Dreamina wrapper did not return JSON: ${text.slice(-500)}`);
    }
    const payload = JSON.parse(match[1]);
    if (!payload.ok) {
      throw new Error(payload.error || "Dreamina wrapper returned failure.");
    }
    return payload;
  } catch (error) {
    const message =
      error && typeof error === "object" && "stdout" in error
        ? `${String((error as { stdout?: string }).stdout || "")}\n${String((error as { stderr?: string }).stderr || "")}`.trim()
        : error instanceof Error
          ? error.message
          : String(error);
    throw new Error(message || "Dreamina wrapper execution failed.");
  }
}

function collectNumericCreditCandidates(value: unknown, bucket: number[]): void {
  if (typeof value === "number" && Number.isFinite(value)) {
    bucket.push(value);
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectNumericCreditCandidates(item, bucket);
    }
    return;
  }

  for (const [key, item] of Object.entries(value)) {
    if (/credit|quota|remain|available|usable|left/i.test(key)) {
      collectNumericCreditCandidates(item, bucket);
    }
  }
}

function extractAvailableCredits(payload: any): number | null {
  const explicitSummedFields = [
    payload?.data?.vip_credit,
    payload?.data?.vipCredit,
    payload?.data?.gift_credit,
    payload?.data?.giftCredit,
    payload?.data?.purchase_credit,
    payload?.data?.purchaseCredit,
    payload?.data?.free_credit,
    payload?.data?.freeCredit
  ].filter((candidate) => typeof candidate === "number" && Number.isFinite(candidate)) as number[];

  if (explicitSummedFields.length > 0) {
    return explicitSummedFields.reduce((sum, value) => sum + value, 0);
  }

  const directCandidates = [
    payload?.data?.available_credit,
    payload?.data?.availableCredit,
    payload?.data?.remaining_credit,
    payload?.data?.remainingCredit,
    payload?.data?.usable_credit,
    payload?.data?.usableCredit,
    payload?.data?.total_credit,
    payload?.data?.totalCredit
  ];

  for (const candidate of directCandidates) {
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return candidate;
    }
  }

  const numericCandidates: number[] = [];
  collectNumericCreditCandidates(payload?.data, numericCandidates);
  if (numericCandidates.length === 0) {
    return null;
  }

  return Math.max(...numericCandidates);
}

async function assertDreaminaCredits(options: {
  dreaminaBin: string;
  taskDir: string;
  expectedImageCount: number;
  promptCount: number;
}): Promise<void> {
  const payload = await runWrapperJson([
    DREAMINA_USER_CREDIT_WRAPPER,
    "--dreamina-bin",
    options.dreaminaBin
  ]);
  fs.writeFileSync(path.join(options.taskDir, "dreamina-user-credit.json"), `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  const vipLevel = String(payload?.data?.vip_level || "").trim();
  if (!/maestro/i.test(vipLevel)) {
    throw new Error(`Dreamina image2image requires maestro vip. Current vip_level=${vipLevel || "unknown"}.`);
  }

  const availableCredits = extractAvailableCredits(payload);
  if (availableCredits === null) {
    return;
  }

  if (availableCredits <= 0) {
    throw new Error("Dreamina credits are unavailable. Please recharge or wait for credits before generation.");
  }

  const conservativeBatchFloor = Math.max(1, Math.min(options.promptCount, options.expectedImageCount || 1));
  if (availableCredits < conservativeBatchFloor) {
    throw new Error(
      `Dreamina credits appear insufficient for this batch. Available credits=${availableCredits}, required minimum=${conservativeBatchFloor}.`
    );
  }
}

async function queryResultWithRetry(options: {
  dreaminaBin: string;
  submitId: string;
  downloadDir: string;
  timeoutMs: number;
  intervalMs: number;
}): Promise<any> {
  const deadline = Date.now() + options.timeoutMs;
  let lastError = "Dreamina result query did not run.";

  while (Date.now() < deadline) {
    try {
      const payload = await runWrapperJson([
        DREAMINA_QUERY_WRAPPER,
        "--dreamina-bin",
        options.dreaminaBin,
        "--submit-id",
        options.submitId,
        "--download-dir",
        options.downloadDir
      ]);

      const genStatus = String(payload?.data?.gen_status || "").trim().toLowerCase();
      if (genStatus === "fail") {
        const failReason = String(payload?.data?.fail_reason || "").trim();
        throw new Error(failReason || `Dreamina task failed for submit_id=${options.submitId}`);
      }

      const downloadedFiles = listImageFiles(options.downloadDir);
      if (downloadedFiles.length > 0) {
        return payload;
      }
      lastError = `Dreamina query_result returned no files for submit_id=${options.submitId}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (/task failed|generation failed|gen_status=fail|final generation failed/i.test(lastError)) {
        throw new Error(lastError);
      }
    }

    await sleep(options.intervalMs);
  }

  throw new Error(`Dreamina query_result timed out for ${options.submitId}: ${lastError}`);
}

async function generateWithDreamina(options: {
  dreaminaBin: string;
  sourceImagePath: string;
  promptText: string;
  downloadDir: string;
  pollSeconds: number;
  modelVersion: string;
  resolutionType: string;
  ratio: string;
}): Promise<{ submitId: string; downloadedFiles: string[] }> {
  fs.mkdirSync(options.downloadDir, { recursive: true });
  for (const existing of listImageFiles(options.downloadDir)) {
    fs.rmSync(existing, { force: true });
  }

  const submitPayload = await runWrapperJson([
    DREAMINA_IMAGE2IMAGE_WRAPPER,
    "--dreamina-bin",
    options.dreaminaBin,
    "--images",
    options.sourceImagePath,
    "--prompt",
    options.promptText,
    "--ratio",
    options.ratio,
    "--resolution-type",
    options.resolutionType,
    "--model-version",
    options.modelVersion,
    "--poll",
    String(Math.max(0, options.pollSeconds))
  ]);
  fs.writeFileSync(path.join(options.downloadDir, "submit-result.json"), `${JSON.stringify(submitPayload, null, 2)}\n`, "utf8");

  const submitId = String(submitPayload.data?.submit_id || "").trim();
  if (!submitId) {
    throw new Error("Dreamina submit_id was missing.");
  }

  const queryPayload = await queryResultWithRetry({
    dreaminaBin: options.dreaminaBin,
    submitId,
    downloadDir: options.downloadDir,
    timeoutMs: Math.max(180000, options.pollSeconds * 3000),
    intervalMs: 8000
  });
  fs.writeFileSync(path.join(options.downloadDir, "query-result.json"), `${JSON.stringify(queryPayload, null, 2)}\n`, "utf8");

  const downloadedFiles = listImageFiles(options.downloadDir);
  if (downloadedFiles.length === 0) {
    throw new Error(`Dreamina query_result downloaded no image files for submit_id=${submitId}`);
  }

  return {
    submitId,
    downloadedFiles
  };
}

async function generateDreaminaBatch(options: {
  dreaminaBin: string;
  sourceImagePath: string;
  promptText: string;
  batchWorkDir: string;
  pollSeconds: number;
  modelVersion: string;
  resolutionType: string;
  ratio: string;
  expectedImageCount: number;
  imageCountStrategy: DreaminaImageCountStrategy;
}): Promise<Array<{ file: string; submitId: string }>> {
  if (options.imageCountStrategy === "accept_all" || options.expectedImageCount <= 0) {
    const singleResult = await generateWithDreamina({
      dreaminaBin: options.dreaminaBin,
      sourceImagePath: options.sourceImagePath,
      promptText: options.promptText,
      downloadDir: path.join(options.batchWorkDir, "attempt-01", "raw"),
      pollSeconds: options.pollSeconds,
      modelVersion: options.modelVersion,
      resolutionType: options.resolutionType,
      ratio: options.ratio
    });

    return singleResult.downloadedFiles.map((file) => ({
      file,
      submitId: singleResult.submitId
    }));
  }

  const maxAttempts = Math.max(options.expectedImageCount, 1);
  const collected: Array<{ file: string; submitId: string }> = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (collected.length >= options.expectedImageCount) {
      break;
    }

    const result = await generateWithDreamina({
      dreaminaBin: options.dreaminaBin,
      sourceImagePath: options.sourceImagePath,
      promptText: options.promptText,
      downloadDir: path.join(options.batchWorkDir, `attempt-${String(attempt).padStart(2, "0")}`, "raw"),
      pollSeconds: options.pollSeconds,
      modelVersion: options.modelVersion,
      resolutionType: options.resolutionType,
      ratio: options.ratio
    });

    for (const file of result.downloadedFiles) {
      collected.push({
        file,
        submitId: result.submitId
      });
    }
  }

  if (options.imageCountStrategy === "require_exact") {
    if (collected.length !== options.expectedImageCount) {
      throw new Error(`Dreamina generated ${collected.length} image(s), expected exactly ${options.expectedImageCount}.`);
    }
    return collected;
  }

  if (options.imageCountStrategy === "limit_to_count") {
    if (collected.length < options.expectedImageCount) {
      throw new Error(`Dreamina generated ${collected.length} image(s), expected at least ${options.expectedImageCount}.`);
    }
    return collected.slice(0, options.expectedImageCount);
  }

  return collected;
}

function readOpenAiCompatibleImageConfig(configFile: string): OpenAiCompatibleImageConfig {
  if (!configFile) {
    throw new Error("Image generation config file is required for openai-compatible provider.");
  }
  const resolved = path.resolve(configFile);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Image generation config file not found: ${resolved}`);
  }
  const parsed = JSON.parse(fs.readFileSync(resolved, "utf8")) as OpenAiCompatibleImageConfig;
  const apiKey = process.env.IMAGE_GENERATION_API_KEY || parsed.apiKey || "";
  if (!parsed.apiUrl) {
    throw new Error(`Image generation config missing apiUrl: ${resolved}`);
  }
  if (!apiKey) {
    throw new Error(`Image generation API key missing. Set IMAGE_GENERATION_API_KEY or apiKey in ${resolved}.`);
  }
  if (!parsed.model) {
    throw new Error(`Image generation config missing model: ${resolved}`);
  }
  return {
    ...parsed,
    apiKey
  };
}

function getImageExtensionFromContentType(contentType: string): string {
  if (/webp/i.test(contentType)) {
    return ".webp";
  }
  if (/jpe?g/i.test(contentType)) {
    return ".jpg";
  }
  return ".png";
}

async function downloadGeneratedImage(url: string, targetFile: string, apiKey: string): Promise<void> {
  const response = await fetch(url, { headers: url.includes("/v1/") ? { Authorization: `Bearer ${apiKey}` } : undefined });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw normalizeImageGenerationError(`Image download failed with HTTP ${response.status}: ${text || response.statusText}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(targetFile, buffer);
}

function extractGeneratedImageItems(payload: any, text: string): any[] {
  const items = Array.isArray(payload?.data) ? payload.data : [];
  if (items.length === 0) {
    throw normalizeImageGenerationError(`Image generation returned no data items: ${text.slice(0, 500)}`);
  }
  return items;
}

async function saveGeneratedImageItem(options: {
  item: any;
  payload: any;
  targetDir: string;
  index: number;
  apiKey: string;
}): Promise<{ file: string; submitId: string } | null> {
  const baseName = `generated-${String(options.index).padStart(2, "0")}`;
  if (typeof options.item?.b64_json === "string" && options.item.b64_json.trim()) {
    const file = path.join(options.targetDir, `${baseName}.png`);
    fs.writeFileSync(file, Buffer.from(options.item.b64_json, "base64"));
    return { file, submitId: String(options.payload?.created || "") };
  }
  if (typeof options.item?.url === "string" && options.item.url.trim()) {
    const targetFile = path.join(options.targetDir, `${baseName}${getImageExtensionFromContentType(options.item.url)}`);
    await downloadGeneratedImage(options.item.url, targetFile, options.apiKey);
    return { file: targetFile, submitId: String(options.payload?.created || "") };
  }
  return null;
}

async function generateWithOpenAiCompatibleProvider(options: {
  configFile: string;
  promptText: string;
  sourceImagePath: string;
  downloadDir: string;
  expectedImageCount: number;
}): Promise<Array<{ file: string; submitId: string }>> {
  fs.mkdirSync(options.downloadDir, { recursive: true });
  for (const existing of listImageFiles(options.downloadDir)) {
    fs.rmSync(existing, { force: true });
  }

  const config = readOpenAiCompatibleImageConfig(options.configFile);
  const mode = config.mode || (config.apiUrl.includes("/images/edits") ? "edits" : "generations");
  const count = Math.max(1, options.expectedImageCount || 1);
  const responseFormat = config.responseFormat || "b64_json";
  const timeoutMs = Math.max(30000, config.timeoutMs || 180000);
  const sendRequest = async (requestBody: BodyInit, contentType?: string): Promise<{ response: Response; text: string }> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(config.apiUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          ...(contentType ? { "Content-Type": contentType } : {})
        },
        body: requestBody,
        signal: controller.signal
      });
      const text = await response.text();
      return { response, text };
    } catch (error) {
      throw normalizeImageGenerationError(error instanceof Error ? error.message : String(error));
    } finally {
      clearTimeout(timer);
    }
  };

  const buildGenerationJsonBody = (promptText: string): Record<string, unknown> => ({
    model: config.model,
    prompt: promptText,
    n: 1,
    size: config.size || "1024x1024",
    response_format: responseFormat,
    ...(config.requestExtra || {})
  });

  const buildEditFormData = (includeResponseFormat: boolean, promptText: string): FormData => {
    if (!fs.existsSync(options.sourceImagePath)) {
      throw new Error(`Source reference image not found for image edit: ${options.sourceImagePath}`);
    }
    const form = new FormData();
    form.set("model", config.model);
    form.set("prompt", promptText);
    form.set("n", "1");
    form.set("size", config.size || "1024x1024");
    if (includeResponseFormat) {
      form.set("response_format", responseFormat);
    }
    for (const [key, value] of Object.entries(config.requestExtra || {})) {
      if (value === undefined || value === null) {
        continue;
      }
      form.set(key, typeof value === "string" ? value : JSON.stringify(value));
    }
    const ext = path.extname(options.sourceImagePath).toLowerCase();
    const mimeType = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : ext === ".webp" ? "image/webp" : "image/png";
    const imageBlob = new Blob([fs.readFileSync(options.sourceImagePath)], { type: mimeType });
    form.append("image", imageBlob, path.basename(options.sourceImagePath));
    return form;
  };

  const buildPromptForImageIndex = (imageIndex: number): string =>
    [options.promptText, buildImageVariationInstruction(imageIndex)].join("\n");

  const generated: Array<{ file: string; submitId: string }> = [];
  for (let imageIndex = 1; imageIndex <= count; imageIndex += 1) {
    let promptText = buildPromptForImageIndex(imageIndex);
    const requestFile = path.join(options.downloadDir, `request-${String(imageIndex).padStart(2, "0")}.json`);
    const responseFile = path.join(options.downloadDir, `response-${String(imageIndex).padStart(2, "0")}.json`);
    const buildRequestSummary = (currentPromptText: string): Record<string, unknown> =>
      mode === "edits"
        ? {
            endpoint: config.apiUrl,
            mode,
            contentType: "multipart/form-data",
            model: config.model,
            prompt: currentPromptText,
            n: 1,
            size: config.size || "1024x1024",
            response_format: responseFormat,
            image: path.basename(options.sourceImagePath),
            imagePath: options.sourceImagePath,
            requestExtra: config.requestExtra || {}
          }
        : buildGenerationJsonBody(currentPromptText);
    const requestSummary = buildRequestSummary(promptText);
    fs.writeFileSync(requestFile, `${JSON.stringify(requestSummary, null, 2)}\n`, "utf8");

    let { response, text } =
      mode === "edits"
        ? await sendRequest(buildEditFormData(true, promptText))
        : await sendRequest(JSON.stringify(buildGenerationJsonBody(promptText)), "application/json");
    if (!response.ok && /response_?format|unsupported parameter|unknown parameter|invalid parameter/i.test(text)) {
      if (mode === "edits") {
        const retrySummary = { ...(requestSummary as Record<string, unknown>) };
        delete retrySummary.response_format;
        fs.writeFileSync(
          path.join(options.downloadDir, `request-${String(imageIndex).padStart(2, "0")}-retry.json`),
          `${JSON.stringify(retrySummary, null, 2)}\n`,
          "utf8"
        );
        ({ response, text } = await sendRequest(buildEditFormData(false, promptText)));
      } else {
        const retryBody = buildGenerationJsonBody(promptText);
        delete (retryBody as Record<string, unknown>).response_format;
        fs.writeFileSync(
          path.join(options.downloadDir, `request-${String(imageIndex).padStart(2, "0")}-retry.json`),
          `${JSON.stringify(retryBody, null, 2)}\n`,
          "utf8"
        );
        ({ response, text } = await sendRequest(JSON.stringify(retryBody), "application/json"));
      }
    }
    if (!response.ok && isContentPolicyError(text)) {
      promptText = buildPolicyCompatibleImageEditPrompt(options.promptText, imageIndex);
      const policyRetrySummary = buildRequestSummary(promptText);
      fs.writeFileSync(
        path.join(options.downloadDir, `request-${String(imageIndex).padStart(2, "0")}-policy-retry.json`),
        `${JSON.stringify(policyRetrySummary, null, 2)}\n`,
        "utf8"
      );
      ({ response, text } =
        mode === "edits"
          ? await sendRequest(buildEditFormData(true, promptText))
          : await sendRequest(JSON.stringify(buildGenerationJsonBody(promptText)), "application/json"));
      if (!response.ok && mode === "edits" && /response_?format|unsupported parameter|unknown parameter|invalid parameter/i.test(text)) {
        const retrySummary = { ...policyRetrySummary };
        delete retrySummary.response_format;
        fs.writeFileSync(
          path.join(options.downloadDir, `request-${String(imageIndex).padStart(2, "0")}-policy-retry-no-response-format.json`),
          `${JSON.stringify(retrySummary, null, 2)}\n`,
          "utf8"
        );
        ({ response, text } = await sendRequest(buildEditFormData(false, promptText)));
      }
    }
    for (let attempt = 1; !response.ok && isTransientImageProviderStatus(response.status) && attempt <= 3; attempt += 1) {
      fs.writeFileSync(
        path.join(options.downloadDir, `response-${String(imageIndex).padStart(2, "0")}-transient-${attempt}.json`),
        `${text}\n`,
        "utf8"
      );
      await sleep(3000 * attempt);
      ({ response, text } =
        mode === "edits"
          ? await sendRequest(buildEditFormData(true, promptText))
          : await sendRequest(JSON.stringify(buildGenerationJsonBody(promptText)), "application/json"));
    }
    fs.writeFileSync(responseFile, `${text}\n`, "utf8");
    if (!response.ok) {
      throw normalizeImageGenerationError(`Image generation failed with HTTP ${response.status}: ${text || response.statusText}`);
    }

    let payload: any;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error(`Image generation response was not JSON: ${text.slice(0, 500)}`);
    }

    const items = extractGeneratedImageItems(payload, text);
    const saved = await saveGeneratedImageItem({
      item: items[0],
      payload,
      targetDir: options.downloadDir,
      index: imageIndex,
      apiKey: config.apiKey || ""
    });
    if (!saved) {
      throw normalizeImageGenerationError(`Image generation returned no downloadable image payloads: ${text.slice(0, 500)}`);
    }
    generated.push(saved);
  }

  if (generated.length < count) {
    throw new Error(`Image generation returned ${generated.length} image(s), expected ${count}.`);
  }
  return generated;
}

export async function generateOpenAiCompatibleImagePreview(options: {
  configFile: string;
  sourceImagePath: string;
  promptWordFile: string;
  outputDir: string;
  sellingPointText?: string;
}): Promise<{ file: string; requestFile: string; promptFile: string }> {
  const paragraphs = readSimpleWordDocument(options.promptWordFile);
  const promptText = options.sellingPointText
    ? buildImageEditPromptFromWord({
        paragraphs,
        promptWordFile: options.promptWordFile,
        ...parseSellingPointFields(options.sellingPointText)
      })
    : buildDreaminaPromptFromWord(paragraphs, options.promptWordFile);
  fs.mkdirSync(options.outputDir, { recursive: true });
  const promptFile = path.join(options.outputDir, "prompt.txt");
  fs.writeFileSync(promptFile, `${promptText}\n`, "utf8");
  const [generated] = await generateWithOpenAiCompatibleProvider({
    configFile: options.configFile,
    promptText,
    sourceImagePath: options.sourceImagePath,
    downloadDir: options.outputDir,
    expectedImageCount: 1
  });
  return {
    file: generated.file,
    requestFile: path.join(options.outputDir, "request-01.json"),
    promptFile
  };
}

function moveFile(sourceFile: string, targetFile: string): void {
  fs.mkdirSync(path.dirname(targetFile), { recursive: true });
  try {
    fs.renameSync(sourceFile, targetFile);
  } catch {
    fs.copyFileSync(sourceFile, targetFile);
    fs.rmSync(sourceFile, { force: true });
  }
}

function buildStagedImageFile(
  stageDir: string,
  productName: string,
  watermarkText: string,
  imageIndex: number,
  sourceFile: string
): string {
  const ext = path.extname(sourceFile) || ".png";
  const baseName = sanitizeFileName(`${productName}${watermarkText}${String(imageIndex).padStart(2, "0")}`);
  return path.join(stageDir, `${baseName}${ext}`);
}

function buildProductFolder(shopFolder: string, productName: string, imageIndex: number): string {
  return path.join(shopFolder, sanitizeFileName(`${productName}水印${String(imageIndex).padStart(2, "0")}`));
}

function stageWatermarkedFile(options: {
  stageDir: string;
  productName: string;
  watermarkText: string;
  imageIndex: number;
  watermarkedFile: string;
}): string {
  const stagedFile = buildStagedImageFile(
    options.stageDir,
    options.productName,
    options.watermarkText,
    options.imageIndex,
    options.watermarkedFile
  );
  if (fs.existsSync(stagedFile)) {
    fs.rmSync(stagedFile, { force: true });
  }
  moveFile(options.watermarkedFile, stagedFile);
  return stagedFile;
}

async function recoverExistingRoundOutputs(options: {
  roundDir: string;
  stageDir: string;
  productName: string;
  watermarkText: string;
  startImageIndex: number;
}): Promise<
  Array<{
    stagedFile: string;
    rawImageFile?: string;
    imageIndex: number;
  }>
> {
  const recovered: Array<{
    stagedFile: string;
    rawImageFile?: string;
    imageIndex: number;
  }> = [];

  let imageIndex = options.startImageIndex;
  const existingStagedFiles = listImageFiles(options.stageDir);
  for (const stagedFile of existingStagedFiles) {
    const rawCandidates = listImageFilesRecursive(options.roundDir).filter((file) => file.includes(`${path.sep}raw${path.sep}`));
    recovered.push({
      stagedFile,
      rawImageFile: rawCandidates[recovered.length],
      imageIndex
    });
    imageIndex += 1;
  }
  if (existingStagedFiles.length > 0) {
    return recovered;
  }

  const watermarkDir = path.join(options.roundDir, "watermark");
  const existingRawFiles = listImageFilesRecursive(options.roundDir).filter((file) => file.includes(`${path.sep}raw${path.sep}`));
  if (existingRawFiles.length === 0) {
    return recovered;
  }

  const watermarkCandidates = existingRawFiles.filter((rawFile) => fs.existsSync(rawFile));
  if (watermarkCandidates.length === 0) {
    return recovered;
  }

  const recoveredWatermarkedFiles = await applyLocalWatermark({
    inputFiles: watermarkCandidates,
    outputDir: watermarkDir,
    watermarkText: options.watermarkText
  });

  for (let itemIndex = 0; itemIndex < recoveredWatermarkedFiles.length; itemIndex += 1) {
    const watermarkedFile = recoveredWatermarkedFiles[itemIndex];
    const rawImageFile = watermarkCandidates[itemIndex];
    const stagedFile = stageWatermarkedFile({
      stageDir: options.stageDir,
      productName: options.productName,
      watermarkText: options.watermarkText,
      imageIndex,
      watermarkedFile
    });
    recovered.push({
      stagedFile,
      rawImageFile,
      imageIndex
    });
    imageIndex += 1;
  }

  return recovered;
}

function finalizeProductFolders(
  stagedFiles: Array<{
    stagedFile: string;
    rawImageFile?: string;
    shopFolder: string;
    promptIndex: number;
    promptWordFile?: string;
    submitId?: string;
    imageIndex: number;
  }>,
  productName: string
): JimengGeneratedFile[] {
  const generatedFiles: JimengGeneratedFile[] = [];

  for (const item of stagedFiles) {
    const productFolder = buildProductFolder(item.shopFolder, productName, item.imageIndex);
    fs.mkdirSync(productFolder, { recursive: true });
    const shopRootFile = path.join(item.shopFolder, path.basename(item.stagedFile));
    if (fs.existsSync(shopRootFile)) {
      fs.rmSync(shopRootFile, { force: true });
    }
    moveFile(item.stagedFile, shopRootFile);
    const finalImageFile = path.join(productFolder, path.basename(shopRootFile));
    if (fs.existsSync(finalImageFile)) {
      fs.rmSync(finalImageFile, { force: true });
    }
    moveFile(shopRootFile, finalImageFile);
    generatedFiles.push({
      imageFile: finalImageFile,
      rawImageFile: item.rawImageFile,
      shopFolder: item.shopFolder,
      productFolder,
      storeName: path.basename(item.shopFolder),
      promptIndex: item.promptIndex,
      promptWordFile: item.promptWordFile,
      submitId: item.submitId
    });
  }

  return generatedFiles;
}

function buildSimulatedFiles(options: {
  taskDir: string;
  shopFolders: Array<{ shopFolder: string; watermarkText: string }>;
  brandedGenericName: string;
  sourceImagePath: string;
  promptFiles: string[];
  expectedImageCount: number;
}): JimengGeneratedFile[] {
  const stagedFiles: Array<{
    stagedFile: string;
    rawImageFile?: string;
    shopFolder: string;
    promptIndex: number;
    promptWordFile: string;
    imageIndex: number;
  }> = [];
  let imageIndex = 1;

  for (let promptIndex = 0; promptIndex < options.promptFiles.length; promptIndex += 1) {
    const shopFolder = options.shopFolders[promptIndex].shopFolder;
    for (let itemIndex = 0; itemIndex < options.expectedImageCount; itemIndex += 1) {
      const stageDir = path.join(options.taskDir, "staged", String(promptIndex + 1).padStart(2, "0"));
      const stagedFile = buildStagedImageFile(
        stageDir,
        options.brandedGenericName,
        options.shopFolders[promptIndex].watermarkText,
        imageIndex,
        options.sourceImagePath
      );
      fs.mkdirSync(path.dirname(stagedFile), { recursive: true });
      fs.copyFileSync(options.sourceImagePath, stagedFile);
      stagedFiles.push({
        stagedFile,
        rawImageFile: options.sourceImagePath,
        shopFolder,
        promptIndex: promptIndex + 1,
        promptWordFile: options.promptFiles[promptIndex],
        imageIndex
      });
      imageIndex += 1;
    }
  }

  const generatedFiles = finalizeProductFolders(stagedFiles, options.brandedGenericName);
  fs.writeFileSync(
    path.join(options.taskDir, "dreamina-simulated.txt"),
    generatedFiles.map((item) => item.imageFile).join("\n"),
    "utf8"
  );
  return generatedFiles;
}

export async function generateJimengAssets(options: {
  runtimeDir: string;
  taskId: string;
  shopRootDir: string;
  sourceImagePath: string;
  sellingPointText: string;
  brandedGenericName: string;
  wordFiles: string[];
  imageGenerationProvider: ImageGenerationProvider;
  imageGenerationConfigFile: string;
  dreaminaBin: string;
  dreaminaPollSeconds: number;
  dreaminaModelVersion: string;
  dreaminaResolutionType: string;
  dreaminaRatio: string;
  dreaminaExpectedImageCount: number;
  dreaminaImageCountStrategy: DreaminaImageCountStrategy;
  promptCount?: number;
  shopCodes?: string[];
  simulateOnly: boolean;
}): Promise<JimengArtifact> {
  const taskDir = ensureTaskDir(options.runtimeDir, options.taskId);
  const promptFile = writePromptSummary(taskDir, options.wordFiles);
  const shopFolders = filterShopFoldersByCodes(resolveShopFolders(options.shopRootDir), options.shopCodes);
  const promptCount = Math.min(options.promptCount || 5, options.wordFiles.length, shopFolders.length);
  const productName = inferBrandedGenericName(options.brandedGenericName, options.sellingPointText);

  if (options.simulateOnly) {
    return {
      promptFile,
      generatedFiles: buildSimulatedFiles({
        taskDir,
        shopFolders,
        brandedGenericName: productName,
        sourceImagePath: options.sourceImagePath,
        promptFiles: options.wordFiles.slice(0, promptCount),
        expectedImageCount: options.dreaminaExpectedImageCount
      }),
      simulated: true
    };
  }

  if (options.imageGenerationProvider === "dreamina" && !fs.existsSync(options.dreaminaBin)) {
    throw new Error(`Dreamina executable not found: ${options.dreaminaBin}`);
  }

  if (options.imageGenerationProvider === "dreamina") {
    await assertDreaminaCredits({
      dreaminaBin: options.dreaminaBin,
      taskDir,
      expectedImageCount: options.dreaminaExpectedImageCount,
      promptCount
    });
  } else {
    readOpenAiCompatibleImageConfig(options.imageGenerationConfigFile);
  }

  const stagedFiles: Array<{
    stagedFile: string;
    rawImageFile?: string;
    shopFolder: string;
    promptIndex: number;
    promptWordFile?: string;
    submitId?: string;
    imageIndex: number;
  }> = [];
  let imageIndex = 1;

  for (let promptIndex = 0; promptIndex < promptCount; promptIndex += 1) {
    const promptWordFile = options.wordFiles[promptIndex];
    const wordParagraphs = readSimpleWordDocument(promptWordFile);
    const promptText =
      options.imageGenerationProvider === "openai-compatible"
        ? buildImageEditPromptFromWord({
            paragraphs: wordParagraphs,
            promptWordFile,
            ...parseSellingPointFields(options.sellingPointText)
          })
        : buildDreaminaPromptFromWord(wordParagraphs, promptWordFile);

    const { shopFolder, watermarkText } = shopFolders[promptIndex];
    const roundDir = path.join(taskDir, `dreamina-${String(promptIndex + 1).padStart(2, "0")}`);
    const stageDir = path.join(taskDir, "staged", String(promptIndex + 1).padStart(2, "0"));
    const watermarkOutputDir = path.join(roundDir, "watermark");
    fs.mkdirSync(roundDir, { recursive: true });
    fs.writeFileSync(path.join(roundDir, "dreamina-prompt.txt"), `${promptText}\n`, "utf8");

    const recoveredFiles = await recoverExistingRoundOutputs({
      roundDir,
      stageDir,
      productName,
      watermarkText,
      startImageIndex: imageIndex
    });

    for (const recovered of recoveredFiles) {
      stagedFiles.push({
        stagedFile: recovered.stagedFile,
        rawImageFile: recovered.rawImageFile,
        shopFolder,
        promptIndex: promptIndex + 1,
        promptWordFile,
        imageIndex: recovered.imageIndex
      });
      imageIndex = recovered.imageIndex + 1;
    }

    const remainingImageCount =
      options.dreaminaImageCountStrategy === "accept_all"
        ? 0
        : Math.max(0, options.dreaminaExpectedImageCount - recoveredFiles.length);

    if (
      options.dreaminaImageCountStrategy !== "accept_all" &&
      recoveredFiles.length >= options.dreaminaExpectedImageCount
    ) {
      continue;
    }

    const dreaminaResults =
      options.imageGenerationProvider === "openai-compatible"
        ? await generateWithOpenAiCompatibleProvider({
            configFile: options.imageGenerationConfigFile,
            promptText,
            sourceImagePath: options.sourceImagePath,
            downloadDir: path.join(roundDir, "openai-compatible", "raw"),
            expectedImageCount: remainingImageCount
          })
        : await generateDreaminaBatch({
            dreaminaBin: options.dreaminaBin,
            sourceImagePath: options.sourceImagePath,
            promptText,
            batchWorkDir: roundDir,
            pollSeconds: options.dreaminaPollSeconds,
            modelVersion: options.dreaminaModelVersion,
            resolutionType: options.dreaminaResolutionType,
            ratio: options.dreaminaRatio,
            expectedImageCount: remainingImageCount,
            imageCountStrategy: options.dreaminaImageCountStrategy
          });

    const watermarkedFiles = await applyLocalWatermark({
      inputFiles: dreaminaResults.map((item) => item.file),
      outputDir: watermarkOutputDir,
      watermarkText
    });

    if (watermarkedFiles.length === 0) {
      throw new Error(`No watermarked files were saved for prompt ${promptIndex + 1}.`);
    }

    for (let itemIndex = 0; itemIndex < watermarkedFiles.length; itemIndex += 1) {
      const rawFile = dreaminaResults[itemIndex]?.file;
      const watermarkedFile = watermarkedFiles[itemIndex];

      const stagedFile = stageWatermarkedFile({
        stageDir,
        productName,
        watermarkText,
        imageIndex,
        watermarkedFile
      });

      stagedFiles.push({
        stagedFile,
        rawImageFile: rawFile,
        shopFolder,
        promptIndex: promptIndex + 1,
        promptWordFile,
        submitId: dreaminaResults[itemIndex]?.submitId,
        imageIndex
      });
      imageIndex += 1;
    }
  }

  return {
    promptFile,
    generatedFiles: finalizeProductFolders(stagedFiles, productName),
    simulated: false
  };
}
