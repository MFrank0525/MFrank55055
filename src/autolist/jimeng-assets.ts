import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { sanitizeFileName } from "../doubao/paths.js";
import { extendPathEnv, getDreaminaWrapperPath, getPythonCommand } from "../utils/platform.js";
import { readSimpleWordDocument } from "./docx-lite.js";
import { applyLocalWatermark } from "./local-watermark.js";
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

function sanitizeSellingPointsForImagePrompt(sellingPointText: string): string {
  const segments = sellingPointText
    .split(/[，,。；;]/)
    .map((item) => item.trim())
    .filter(Boolean);
  const safeSegments = segments.filter((segment) => {
    if (UNSAFE_SELLING_POINT_PATTERNS.some((pattern) => pattern.test(segment))) {
      return false;
    }
    return SAFE_SELLING_POINT_PATTERNS.some((pattern) => pattern.test(segment));
  });
  return Array.from(new Set(safeSegments)).slice(0, 8).join("，");
}

const PRODUCT_REFERENCE_GUARDRAIL =
  "产品主体必须来自输入参考图，不允许根据文字重新绘制产品；请把输入参考图里的产品当作锁定主体嵌入海报，不要重新设计包装，不要改写包装文字，不要改变盒子和管体的形状、数量、角度关系、颜色和标识。背景、光影、氛围、道具可以生成，但产品包装文字和产品细节必须尽量保持参考图一致。";
const IMAGE_EDIT_COMPLIANCE_GUARDRAIL =
  "合规要求：只生成电商海报背景、光影、材质、道具和信任感视觉元素；不要展示人体、骨骼、穴位、疼痛部位、治疗过程、功效渗透、能量进入身体、疾病对比或医疗效果示意。";
const UNSAFE_IMAGE_PROMPT_PATTERNS = [
  /颈椎|肩周|腰椎|膝盖|关节|骨骼|穴位|风池穴|督脉|人体|身体|疼痛|哪痛|痛点/,
  /治疗|治愈|缓解|消炎|修复|康复|止痛|镇痛|疗效|药效/,
  /渗透|吸收|进入身体|能量波纹|能量感|发光|热力沿|微粒.*身体|螺旋.*身体/,
  /医疗器械认证|注册证|备案注册号|国药准字|保健食品注册/
];
const UNSAFE_SELLING_POINT_PATTERNS = [
  /颈椎|肩周|腰椎|膝盖|关节|穴位|风池穴|督脉|疼痛|哪痛|痛点|不适|问题|部位/,
  /治疗|治愈|缓解|改善|辅助改善|消炎|修复|康复|止痛|镇痛|疗效|药效/,
  /持续发热|发热|热感|渗透|吸收|理疗技术|远红外理疗|进入身体/
  ,/二类医疗器械|医疗器械|药监备案|备案|注册证|资质|认证/
];
const SAFE_SELLING_POINT_PATTERNS = [
  /官方正品|正品保障|正品/,
  /成分科学|科学简单|无科技狠活|核心成分|远红外陶瓷粉/,
  /红色纸盒|红色管状|包装|20g|支/,
  /品牌|出品|通用名称|用户认知名/
];

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
  const safeDeepseekPrompt = deepseekPrompt
    .split(/[，,]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => !UNSAFE_IMAGE_PROMPT_PATTERNS.some((pattern) => pattern.test(item)))
    .join(",");
  const promptText = [
    instruction,
    PRODUCT_REFERENCE_GUARDRAIL,
    IMAGE_EDIT_COMPLIANCE_GUARDRAIL,
    safeDeepseekPrompt || "高质感电商海报背景,产品摄影棚光影,品牌信任感标签,高级材质纹理,干净构图,突出输入参考图产品主体"
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
  const safeSellingPoints = sanitizeSellingPointsForImagePrompt(sellingPoints);
  const safeDeepseekPrompt = deepseekPrompt
    .split(/[，,]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => !UNSAFE_IMAGE_PROMPT_PATTERNS.some((pattern) => pattern.test(item)))
    .join(",");
  return [
    buildDreaminaImageEditInstruction(options.brand, options.userCognitionName, options.genericName, safeSellingPoints || sellingPoints),
    "卖点筛选规则：只展示产品事实、规格、成分、正品保障、备案资质、包装外观等合规卖点；不要展示适用身体部位、疼痛、缓解、治疗、改善、发热、渗透、理疗过程等功效表达。",
    safeDeepseekPrompt || "高质感电商海报背景,产品摄影棚光影,品牌信任感标签,高级材质纹理,干净构图,突出输入参考图产品主体"
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

  const buildGenerationJsonBody = (): Record<string, unknown> => ({
    model: config.model,
    prompt: options.promptText,
    n: 1,
    size: config.size || "1024x1024",
    response_format: responseFormat,
    ...(config.requestExtra || {})
  });

  const buildEditFormData = (includeResponseFormat: boolean): FormData => {
    if (!fs.existsSync(options.sourceImagePath)) {
      throw new Error(`Source reference image not found for image edit: ${options.sourceImagePath}`);
    }
    const form = new FormData();
    form.set("model", config.model);
    form.set("prompt", options.promptText);
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

  const generated: Array<{ file: string; submitId: string }> = [];
  for (let imageIndex = 1; imageIndex <= count; imageIndex += 1) {
    const requestFile = path.join(options.downloadDir, `request-${String(imageIndex).padStart(2, "0")}.json`);
    const responseFile = path.join(options.downloadDir, `response-${String(imageIndex).padStart(2, "0")}.json`);
    const requestSummary =
      mode === "edits"
        ? {
            endpoint: config.apiUrl,
            mode,
            contentType: "multipart/form-data",
            model: config.model,
            prompt: options.promptText,
            n: 1,
            size: config.size || "1024x1024",
            response_format: responseFormat,
            image: path.basename(options.sourceImagePath),
            imagePath: options.sourceImagePath,
            requestExtra: config.requestExtra || {}
          }
        : buildGenerationJsonBody();
    fs.writeFileSync(requestFile, `${JSON.stringify(requestSummary, null, 2)}\n`, "utf8");

    let { response, text } =
      mode === "edits"
        ? await sendRequest(buildEditFormData(true))
        : await sendRequest(JSON.stringify(buildGenerationJsonBody()), "application/json");
    if (!response.ok && /response_?format|unsupported parameter|unknown parameter|invalid parameter/i.test(text)) {
      if (mode === "edits") {
        const retrySummary = { ...(requestSummary as Record<string, unknown>) };
        delete retrySummary.response_format;
        fs.writeFileSync(
          path.join(options.downloadDir, `request-${String(imageIndex).padStart(2, "0")}-retry.json`),
          `${JSON.stringify(retrySummary, null, 2)}\n`,
          "utf8"
        );
        ({ response, text } = await sendRequest(buildEditFormData(false)));
      } else {
        const retryBody = buildGenerationJsonBody();
        delete (retryBody as Record<string, unknown>).response_format;
        fs.writeFileSync(
          path.join(options.downloadDir, `request-${String(imageIndex).padStart(2, "0")}-retry.json`),
          `${JSON.stringify(retryBody, null, 2)}\n`,
          "utf8"
        );
        ({ response, text } = await sendRequest(JSON.stringify(retryBody), "application/json"));
      }
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
    recovered.push({
      stagedFile,
      imageIndex
    });
    imageIndex += 1;
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
    if (rawImageFile && fs.existsSync(rawImageFile)) {
      fs.rmSync(rawImageFile, { force: true });
    }
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
}): JimengGeneratedFile[] {
  const stagedFiles: Array<{
    stagedFile: string;
    shopFolder: string;
    promptIndex: number;
    promptWordFile: string;
    imageIndex: number;
  }> = [];
  let imageIndex = 1;

  for (let promptIndex = 0; promptIndex < options.promptFiles.length; promptIndex += 1) {
    const shopFolder = options.shopFolders[promptIndex].shopFolder;
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
      shopFolder,
      promptIndex: promptIndex + 1,
      promptWordFile: options.promptFiles[promptIndex],
      imageIndex
    });
    imageIndex += 1;
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
  simulateOnly: boolean;
}): Promise<JimengArtifact> {
  const taskDir = ensureTaskDir(options.runtimeDir, options.taskId);
  const promptFile = writePromptSummary(taskDir, options.wordFiles);
  const shopFolders = resolveShopFolders(options.shopRootDir);
  const productName = inferBrandedGenericName(options.brandedGenericName, options.sellingPointText);

  if (options.simulateOnly) {
    return {
      promptFile,
      generatedFiles: buildSimulatedFiles({
        taskDir,
        shopFolders,
        brandedGenericName: productName,
        sourceImagePath: options.sourceImagePath,
        promptFiles: options.wordFiles.slice(0, Math.min(5, shopFolders.length))
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
      promptCount: Math.min(5, options.wordFiles.length, shopFolders.length)
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

  for (let promptIndex = 0; promptIndex < Math.min(5, options.wordFiles.length, shopFolders.length); promptIndex += 1) {
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
      if (rawFile && fs.existsSync(rawFile)) {
        fs.rmSync(rawFile, { force: true });
      }

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
