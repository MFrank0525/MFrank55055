import fs from "node:fs";
import path from "node:path";
import { sanitizeFileName } from "../doubao/paths.js";
import { assertNoGptPlusWebUrl } from "../utils/gpt-plus-guard.js";
import { readSimpleWordDocument } from "./docx-lite.js";
import {
  resolveImageDownloadTimeoutMs,
  resolveImageGenerationRequestDeadlineMs,
  resolveMissingFixedImageIndexes,
  resolveOpenAiCompatibleImageMode,
  resolvePaidImageLedgerFailureDisposition,
  resolveVideosBase64SubmitConcurrency,
  resolveVideosBase64SubmitTimeoutMs,
  resolveImageGenerationHttpRetryPolicy,
  resolveImageGenerationTransportRetryPolicy,
  providerExplicitlyProvesNoPaidTaskAccepted,
  shouldRetryImageGenerationWithPolicyPrompt
} from "./image-generation-rules.js";
import { applyLocalWatermark } from "./local-watermark.js";
import { readManualTextBlock } from "./operation-manual.js";
import {
  initializePaidImageProductLedger,
  migrateLegacyPaidImageProductLedgers,
  paidImageProductLedgerDir,
  recordPaidImageAmbiguous,
  recordPaidImageCompleted,
  recordPaidImageFailedBeforeAcceptance,
  recordPaidImageSubmitted,
  reservePaidImageSlot,
  resolvePaidImageSlotAction,
  sha256File,
  sha256Text,
  summarizePaidImageProductLedger
} from "./paid-image-submission-ledger.js";
import { getShopSpecs, resolveMainImageShopAssignments, shopCodeFromFolder } from "./product-category.js";
import { buildMainImageEditInstruction } from "./rule-text.js";
import type { ImageGenerationProvider, MainImageArtifact, MainImageCountStrategy, MainImageGeneratedFile } from "./types.js";

interface OpenAiCompatibleImageConfig {
  provider?: "openai-compatible";
  apiUrl: string;
  apiKey?: string;
  model: string;
  mode?: "generations" | "edits" | "media-generate" | "videos-base64";
  size?: string;
  responseFormat?: "b64_json" | "url";
  timeoutMs?: number;
  submitTimeoutMs?: number;
  submitConcurrency?: number;
  maxTransientRetries?: number;
  requestExtra?: Record<string, unknown>;
  mediaParams?: Record<string, unknown>;
  videoMetadata?: Record<string, unknown>;
  statusUrl?: string;
  pollIntervalMs?: number;
  maxPollMs?: number;
  allowMediaGenerateWithoutReference?: boolean;
  referenceImageUpload?: {
    provider?: "tmpfiles";
    apiUrl?: string;
    enabled?: boolean;
  };
}

interface ConcurrencyGate {
  run<T>(work: () => Promise<T>): Promise<T>;
}

function redactImageGenerationLogValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactImageGenerationLogValue(item));
  }
  if (typeof value === "string" && /^data:image\/[^;]+;base64,/i.test(value)) {
    return "[redacted base64 image data url]";
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  const redacted: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
    if (/api[-_]?key|authorization|bearer|secret|token|cookie/i.test(key)) {
      redacted[key] = "[redacted]";
      continue;
    }
    if (key === "b64_json") {
      redacted[key] = "[redacted base64 image payload]";
      continue;
    }
    if (/url|image|images|reference/i.test(key) && typeof nestedValue === "string" && /^https?:\/\//i.test(nestedValue)) {
      redacted[key] = "[redacted image url]";
      continue;
    }
    redacted[key] = redactImageGenerationLogValue(nestedValue);
  }
  return redacted;
}

function writeImageGenerationJsonLog(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(redactImageGenerationLogValue(value), null, 2) + "\n", "utf8");
}

function redactImageGenerationLogText(text: string): string {
  return text
    .replace(/(authorization|bearer|api[-_]?key|secret|token|cookie)(["'\s:=]+)([^"'\s,}]+)/gi, "$1$2[redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "[redacted api key]")
    .replace(/https?:\/\/[^\s"',}]+/gi, "[redacted url]");
}

function writeImageGenerationTextLog(filePath: string, text: string): void {
  try {
    writeImageGenerationJsonLog(filePath, JSON.parse(text));
  } catch {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, redactImageGenerationLogText(text) + "\n", "utf8");
  }
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
  fs.writeFileSync(promptFile, promptFiles.join("\n") + "\n", "utf8");
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

function generatedImageIndexOffset(dir: string): number {
  return listImageFiles(dir).filter((file) => /^generated-\d+/i.test(path.basename(file))).length;
}

export function resolveOpenAiCompatibleGeneratedImageIndex(input: {
  imageIndexOffset: number;
  localImageIndex: number;
}): { absoluteImageIndex: number; paddedImageIndex: string } {
  const absoluteImageIndex = Math.max(0, input.imageIndexOffset) + Math.max(1, input.localImageIndex);
  return {
    absoluteImageIndex,
    paddedImageIndex: String(absoluteImageIndex).padStart(2, "0")
  };
}

function isBillingError(message: string): boolean {
  return /余额|balance|quota|credit|insufficient|欠费|充值|billing/i.test(message);
}

function normalizeImageGenerationError(message: string): Error {
  if (isBillingError(message)) {
    return new Error("Image generation balance appears insufficient. Please recharge the relay account. Raw error: " + message);
  }
  if (/abort|timeout|timed out/i.test(message)) {
    return new Error("Image generation request timed out. The provider did not respond in time. Raw error: " + message);
  }
  return new Error(message);
}

function isContentPolicyError(message: string): boolean {
  return shouldRetryImageGenerationWithPolicyPrompt({
    responseOk: false,
    responseText: message
  });
}

function isTransientImageProviderStatus(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function isTransientImageProviderErrorMessage(message: string): boolean {
  if (isBillingError(message)) {
    return false;
  }
  return /fetch failed|network|socket|terminated|reset|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|UND_ERR|abort|timeout|timed out/i.test(message);
}

async function settleConcurrentWork<T>(work: Array<Promise<T>>, label: string): Promise<T[]> {
  const settled = await Promise.allSettled(work);
  const failures = settled
    .map((result, index) => ({ result, index }))
    .filter((item): item is { result: PromiseRejectedResult; index: number } => item.result.status === "rejected");
  if (failures.length > 0) {
    const reasons = failures.map((item) =>
      item.result.reason instanceof Error ? item.result.reason.message : String(item.result.reason)
    );
    throw new AggregateError(
      failures.map((item) => item.result.reason),
      `${label} failed after all concurrent work settled; failed indexes: ${failures.map((item) => item.index + 1).join(", ")}; reasons: ${reasons.join(" | ")}`
    );
  }
  return settled.map((result) => (result as PromiseFulfilledResult<T>).value);
}

function createConcurrencyGate(maxConcurrent: number): ConcurrencyGate {
  let active = 0;
  const waiting: Array<() => void> = [];
  const acquire = async (): Promise<void> => {
    if (active < maxConcurrent) {
      active += 1;
      return;
    }
    await new Promise<void>((resolve) => {
      waiting.push(() => {
        active += 1;
        resolve();
      });
    });
  };
  const release = (): void => {
    active -= 1;
    waiting.shift()?.();
  };
  return {
    async run<T>(work: () => Promise<T>): Promise<T> {
      await acquire();
      try {
        return await work();
      } finally {
        release();
      }
    }
  };
}

function extractTitleLine(promptText: string, label: string): string {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(escapedLabel + "[：:]\\s*([^，,。\\n]+)");
  const match = promptText.match(pattern);
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

  return readManualTextBlock("main_images_generated", "内容策略兼容降级提示词模板")
    .replaceAll("{{主标题}}", userCognitionName)
    .replaceAll("{{副标题}}", genericName)
    .replaceAll("{{中性信息点}}", visualBadges)
    .replaceAll("{{差异化要求}}", buildImageVariationInstruction(imageIndex));
}

function resolveShopFolders(shopRootDir: string): Array<{ shopFolder: string; watermarkText: string }> {
  const existingFolders = fs
    .readdirSync(shopRootDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      fullPath: path.join(shopRootDir, entry.name)
    }));

  return getShopSpecs().map((spec) => {
    const codeMatches = existingFolders.filter((folder) => folder.name.startsWith(spec.shopCode));
    if (codeMatches.length > 1) {
      throw new Error(
        `Multiple shop folders found for code ${spec.shopCode}: ${codeMatches.map((folder) => folder.name).join(", ")}. Keep only the current rule folder.`
      );
    }
    const match = codeMatches[0];

    if (!match) {
      throw new Error("Shop folder not found for code " + spec.shopCode);
    }
    if (match.name !== `${spec.shopCode}${spec.watermarkText}`) {
      throw new Error(`Shop folder name mismatch for code ${spec.shopCode}. expected=${spec.shopCode}${spec.watermarkText}; actual=${match.name}`);
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
    throw new Error("Shop folder category plan mismatch. expected=" + shopCodes.join(",") + "; actual=" + filtered.map((item) => shopCodeFromFolder(item.shopFolder)).join(","));
  }
  return filtered;
}

function shopFolderByCode(shopFolders: Array<{ shopFolder: string; watermarkText: string }>): Map<string, { shopFolder: string; watermarkText: string }> {
  return new Map(shopFolders.map((item) => [shopCodeFromFolder(item.shopFolder), item]));
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

function buildImageEditPromptFromWord(options: {
  paragraphs: string[];
  promptWordFile: string;
  brand: string;
  userCognitionName: string;
  genericName: string;
}): string {
  const cleaned = options.paragraphs.map((item) => item.trim()).filter(Boolean);
  if (cleaned.length !== 3) {
    throw new Error("Prompt Word file must contain exactly 3 paragraphs (instruction1, selling points, deepseek prompt): " + options.promptWordFile);
  }
  const sellingPoints = cleaned[1] || "";
  const deepseekPrompt = cleaned[cleaned.length - 1] || "";
  if (!sellingPoints || !deepseekPrompt) {
    throw new Error("Prompt Word file had empty required paragraph: " + options.promptWordFile);
  }
  return [
    buildMainImageEditInstruction(options.brand, options.userCognitionName, options.genericName, sellingPoints),
    readManualTextBlock("main_images_generated", "主图输出文字护栏"),
    deepseekPrompt
  ].join("\n");
}

function readOpenAiCompatibleImageConfig(configFile: string): OpenAiCompatibleImageConfig {
  if (!configFile) {
    throw new Error("Image generation config file is required for openai-compatible provider.");
  }
  const resolved = path.resolve(configFile);
  if (!fs.existsSync(resolved)) {
    throw new Error("Image generation config file not found: " + resolved);
  }
  const parsed = JSON.parse(fs.readFileSync(resolved, "utf8")) as OpenAiCompatibleImageConfig;
  const apiKey = process.env.IMAGE_GENERATION_API_KEY || parsed.apiKey || "";
  if (!parsed.apiUrl) {
    throw new Error("Image generation config missing apiUrl: " + resolved);
  }
  assertNoGptPlusWebUrl(parsed.apiUrl, "image generation apiUrl in " + resolved);
  if (!apiKey) {
    throw new Error("Image generation API key missing. Set IMAGE_GENERATION_API_KEY or apiKey in " + resolved + ".");
  }
  if (!parsed.model) {
    throw new Error("Image generation config missing model: " + resolved);
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

async function downloadGeneratedImage(url: string, targetFile: string, apiKey: string, timeoutMs: number): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), resolveImageDownloadTimeoutMs(timeoutMs));
  try {
    const response = await fetch(url, {
      headers: url.includes("/v1/") ? { Authorization: "Bearer " + apiKey } : undefined,
      signal: controller.signal
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw normalizeImageGenerationError("Image download failed with HTTP " + response.status + ": " + (text || response.statusText));
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(targetFile, buffer);
  } catch (error) {
    throw normalizeImageGenerationError("Image download failed: " + (error instanceof Error ? error.message : String(error)));
  } finally {
    clearTimeout(timer);
  }
}

function extractGeneratedImageItems(payload: any, text: string): any[] {
  const items = Array.isArray(payload?.data) ? payload.data : [];
  if (items.length === 0) {
    throw normalizeImageGenerationError("Image generation returned no data items: " + text.slice(0, 500));
  }
  return items;
}

function getGeneratedImageItems(payload: any): any[] {
  return Array.isArray(payload?.data) ? payload.data : [];
}

async function saveGeneratedImageItem(options: {
  item: any;
  payload: any;
  targetDir: string;
  index: number;
  apiKey: string;
  timeoutMs: number;
}): Promise<{ file: string; submitId: string } | null> {
  const baseName = "generated-" + String(options.index).padStart(2, "0");
  if (typeof options.item?.b64_json === "string" && options.item.b64_json.trim()) {
    const file = path.join(options.targetDir, baseName + ".png");
    fs.writeFileSync(file, Buffer.from(options.item.b64_json, "base64"));
    return { file, submitId: String(options.payload?.created || "") };
  }
  if (typeof options.item?.url === "string" && options.item.url.trim()) {
    const targetFile = path.join(options.targetDir, baseName + getImageExtensionFromContentType(options.item.url));
    await downloadGeneratedImage(options.item.url, targetFile, options.apiKey, options.timeoutMs);
    return { file: targetFile, submitId: String(options.payload?.created || "") };
  }
  return null;
}

function resolveMediaGenerateStatusUrl(apiUrl: string, configuredStatusUrl?: string): string {
  if (configuredStatusUrl?.trim()) {
    return configuredStatusUrl.trim();
  }
  const url = new URL(apiUrl);
  url.pathname = "/v1/skills/task-status";
  url.search = "";
  return url.toString();
}

function resolveVideosBase64TaskUrl(apiUrl: string, taskId: string, content = false): string {
  const url = new URL(apiUrl);
  url.pathname = url.pathname.replace(/\/+$/, "") + "/" + encodeURIComponent(taskId) + (content ? "/content" : "");
  url.search = "";
  return url.toString();
}

function extractVideosBase64TaskId(payload: any): string {
  const taskId = payload?.id ?? payload?.task_id ?? payload?.data?.id ?? payload?.data?.task_id;
  if (taskId === undefined || taskId === null || String(taskId).trim() === "") {
    throw normalizeImageGenerationError(
      "videos-base64 response did not include task id: " + JSON.stringify(redactImageGenerationLogValue(payload)).slice(0, 500)
    );
  }
  return String(taskId);
}

function videosBase64Succeeded(payload: any): boolean {
  return ["completed", "succeeded", "success"].includes(String(payload?.status ?? payload?.data?.status ?? "").toLowerCase());
}

function videosBase64Failed(payload: any): boolean {
  return ["failed", "cancelled", "canceled"].includes(String(payload?.status ?? payload?.data?.status ?? "").toLowerCase());
}

function extractVideosBase64ResultUrl(payload: any): string {
  const resultUrl =
    payload?.video_url ??
    payload?.url ??
    payload?.data?.video_url ??
    payload?.data?.url ??
    payload?.result_url ??
    payload?.data?.result_url;
  return typeof resultUrl === "string" ? resultUrl.trim() : "";
}

function readVideosBase64SubmittedTask(responseFile: string): any | undefined {
  if (!fs.existsSync(responseFile)) {
    return undefined;
  }
  try {
    const payload = JSON.parse(fs.readFileSync(responseFile, "utf8"));
    extractVideosBase64TaskId(payload);
    return payload;
  } catch {
    return undefined;
  }
}

function extractMediaGenerateTaskId(payload: any): string {
  const taskId =
    payload?.data?.task_id ??
    payload?.data?.["任务id"] ??
    payload?.data?.["任务ID"] ??
    (Array.isArray(payload?.data?.["任务ids"]) ? payload.data["任务ids"][0] : undefined);
  if (taskId === undefined || taskId === null || String(taskId).trim() === "") {
    throw normalizeImageGenerationError("Media generation response did not include task_id: " + JSON.stringify(redactImageGenerationLogValue(payload)).slice(0, 500));
  }
  return String(taskId);
}

function extractMediaGenerateResultUrl(payload: any): string {
  const resultUrl = payload?.result_url ?? payload?.data?.result_url;
  if (Array.isArray(resultUrl)) {
    return String(resultUrl.find((item) => typeof item === "string" && item.trim()) || "");
  }
  return typeof resultUrl === "string" ? resultUrl.trim() : "";
}

function mediaGenerateSucceeded(payload: any): boolean {
  return (
    payload?.state === "success" ||
    payload?.data?.state === "success" ||
    payload?.status_group === "已完成" ||
    payload?.data?.status_group === "已完成"
  );
}

function mediaGenerateFailed(payload: any): boolean {
  return (
    payload?.state === "failed" ||
    payload?.data?.state === "failed" ||
    payload?.status_group === "失败" ||
    payload?.data?.status_group === "失败"
  );
}

function mediaGenerateIsFinal(payload: any): boolean {
  return payload?.is_final === true || payload?.data?.is_final === true;
}

const mediaGenerateReferenceUploadCache = new Map<string, string>();

function hasMediaGenerateReferenceImage(params: Record<string, unknown>): boolean {
  return ["images", "image_url", "img_url", "reference_urls"].some((key) => {
    const value = params[key];
    if (typeof value === "string") {
      return value.trim().startsWith("http");
    }
    return Array.isArray(value) && value.some((item) => typeof item === "string" && item.trim().startsWith("http"));
  });
}

function getMimeTypeForImage(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  return "image/png";
}

function sourceImageToDataUrl(sourceImagePath: string): string {
  if (!fs.existsSync(sourceImagePath)) {
    throw normalizeImageGenerationError("videos-base64 reference image not found: " + sourceImagePath);
  }
  const mimeType = getMimeTypeForImage(sourceImagePath);
  return `data:image/${mimeType.split("/")[1]};base64,${fs.readFileSync(sourceImagePath).toString("base64")}`;
}

function toTmpFilesDirectUrl(url: string): string {
  return url.replace(/^https:\/\/tmpfiles\.org\//, "https://tmpfiles.org/dl/");
}

async function uploadMediaGenerateReferenceImage(options: {
  config: OpenAiCompatibleImageConfig;
  sourceImagePath: string;
  timeoutMs: number;
}): Promise<string> {
  if (!fs.existsSync(options.sourceImagePath)) {
    throw normalizeImageGenerationError("Media generation reference image not found: " + options.sourceImagePath);
  }
  const stat = fs.statSync(options.sourceImagePath);
  const cacheKey = [path.resolve(options.sourceImagePath), stat.size, stat.mtimeMs].join("|");
  const cached = mediaGenerateReferenceUploadCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const uploadConfig = options.config.referenceImageUpload || {};
  if (uploadConfig.enabled === false) {
    throw normalizeImageGenerationError(
      "media-generate mode needs a public reference image URL, but referenceImageUpload.enabled=false and the Feishu URL is not provider-accessible."
    );
  }
  const apiUrl = uploadConfig.apiUrl || "https://tmpfiles.org/api/v1/upload";
  if (uploadConfig.provider && uploadConfig.provider !== "tmpfiles") {
    throw normalizeImageGenerationError("Unsupported media-generate reference image upload provider: " + uploadConfig.provider);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), resolveImageDownloadTimeoutMs(options.timeoutMs));
  try {
    const form = new FormData();
    const imageBlob = new Blob([fs.readFileSync(options.sourceImagePath)], { type: getMimeTypeForImage(options.sourceImagePath) });
    form.append("file", imageBlob, sanitizeFileName(path.basename(options.sourceImagePath)));
    const response = await fetch(apiUrl, {
      method: "POST",
      body: form,
      signal: controller.signal
    });
    const text = await response.text();
    if (!response.ok) {
      throw normalizeImageGenerationError("Reference image upload failed with HTTP " + response.status + ": " + text.slice(0, 300));
    }
    let payload: any;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { data: { url: text.trim() } };
    }
    const uploadedUrl = String(payload?.data?.url || payload?.url || "").trim();
    if (!uploadedUrl.startsWith("https://tmpfiles.org/")) {
      throw normalizeImageGenerationError("Reference image upload did not return a tmpfiles URL.");
    }
    const directUrl = toTmpFilesDirectUrl(uploadedUrl);
    mediaGenerateReferenceUploadCache.set(cacheKey, directUrl);
    return directUrl;
  } catch (error) {
    throw normalizeImageGenerationError(error instanceof Error ? error.message : String(error));
  } finally {
    clearTimeout(timer);
  }
}

async function generateWithOpenAiCompatibleProvider(options: {
  configFile: string;
  promptText: string;
  sourceImagePath: string;
  sourceImageReferenceUrl?: string;
  downloadDir: string;
  expectedImageCount: number;
  requestedImageIndexes?: number[];
  videosBase64SubmitGate?: ConcurrencyGate;
  paidImageLedger?: {
    rootDir: string;
    batchFingerprint: string;
    recordId: string;
    expectedSlotCount: number;
    slotOffset: number;
    owner: {
      runId?: string;
      taskId?: string;
      pid?: number;
    };
  };
  onProgress?: (message: string) => void;
}): Promise<Array<{ file: string; submitId: string }>> {
  fs.mkdirSync(options.downloadDir, { recursive: true });

  const config = readOpenAiCompatibleImageConfig(options.configFile);
  const mode = resolveOpenAiCompatibleImageMode(config.mode, config.apiUrl);
  const count = Math.max(1, options.expectedImageCount || 1);
  const imageIndexOffset = generatedImageIndexOffset(options.downloadDir);
  const responseFormat = config.responseFormat || "b64_json";
  const timeoutMs = Math.max(30000, config.timeoutMs || 180000);
  const videosBase64SubmitTimeoutMs = resolveVideosBase64SubmitTimeoutMs(config.submitTimeoutMs || timeoutMs, config.maxPollMs);
  const submitGate =
    options.videosBase64SubmitGate || createConcurrencyGate(resolveVideosBase64SubmitConcurrency(config.submitConcurrency));
  const maxTransientRetries = Math.max(0, config.maxTransientRetries ?? 3);
  const transportRetryPolicy = resolveImageGenerationTransportRetryPolicy(config.maxTransientRetries);
  const configuredMediaParams = config.mediaParams || {};
  const mediaGenerateReferenceUrl =
    mode === "media-generate" && !hasMediaGenerateReferenceImage(configuredMediaParams) && !config.allowMediaGenerateWithoutReference
      ? await uploadMediaGenerateReferenceImage({
          config,
          sourceImagePath: options.sourceImagePath,
          timeoutMs
        })
      : "";
  const sendRequest = async (
    requestBody: BodyInit,
    contentType?: string,
    operationTimeoutMs = timeoutMs
  ): Promise<{ response: Response; text: string }> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), operationTimeoutMs);
    let deadlineTimer: NodeJS.Timeout | undefined;
    const requestDeadlineMs = resolveImageGenerationRequestDeadlineMs(operationTimeoutMs);
    try {
      const request = (async () => {
        const response = await fetch(config.apiUrl, {
          method: "POST",
          headers: {
            Authorization: "Bearer " + config.apiKey,
            ...(contentType ? { "Content-Type": contentType } : {})
          },
          body: requestBody,
          signal: controller.signal
        });
        const text = await response.text();
        return { response, text };
      })();
      const deadline = new Promise<never>((_, reject) => {
        deadlineTimer = setTimeout(() => {
          controller.abort();
          reject(new Error(`image generation request exceeded hard deadline ${requestDeadlineMs}ms`));
        }, requestDeadlineMs);
      });
      return await Promise.race([request, deadline]);
    } catch (error) {
      throw normalizeImageGenerationError(error instanceof Error ? error.message : String(error));
    } finally {
      clearTimeout(timer);
      if (deadlineTimer) {
        clearTimeout(deadlineTimer);
      }
    }
  };
  const sendRequestWithTransportRetries = async (
    imageIndex: number,
    label: string,
    requestBodyFactory: () => BodyInit,
    contentType?: string
  ): Promise<{ response: Response; text: string }> => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await sendRequest(requestBodyFactory(), contentType);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!isTransientImageProviderErrorMessage(message) || attempt >= transportRetryPolicy.maxRetries) {
          throw error;
        }
        const retryNo = attempt + 1;
        const nextDelayMs = transportRetryPolicy.delayMs[attempt] || transportRetryPolicy.delayMs.at(-1) || 45000;
        writeImageGenerationJsonLog(
          path.join(
            options.downloadDir,
            "response-" + String(imageIndex).padStart(2, "0") + "-transport-transient-" + retryNo + ".json"
          ),
          {
            label,
            retryNo,
            maxTransientRetries: transportRetryPolicy.maxRetries,
            error: message,
            nextDelayMs
          }
        );
        options.onProgress?.(`Image ${imageIndex}: transient transport error during ${label}; retry ${retryNo}/${transportRetryPolicy.maxRetries}.`);
        await sleep(nextDelayMs);
      }
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

  const buildMediaGenerateJsonBody = (promptText: string): Record<string, unknown> => {
    const params = {
      ...(config.size ? { size: config.size } : {}),
      ...(options.sourceImageReferenceUrl ? { images: [options.sourceImageReferenceUrl] } : {}),
      ...(mediaGenerateReferenceUrl ? { images: [mediaGenerateReferenceUrl] } : {}),
      ...(config.mediaParams || {}),
      ...(config.requestExtra || {})
    };
    if (!config.allowMediaGenerateWithoutReference && !hasMediaGenerateReferenceImage(params)) {
      throw normalizeImageGenerationError(
        "media-generate mode requires a public reference image URL in mediaParams.images/image_url/img_url/reference_urls for product main images. The provider does not accept local multipart source images."
      );
    }
    return {
      model: config.model,
      prompt: promptText,
      count: 1,
      ...(Object.keys(params).length ? { params } : {})
    };
  };

  const buildVideosBase64JsonBody = (promptText: string): Record<string, unknown> => ({
    model: config.model,
    prompt: promptText,
    metadata: {
      ...(config.videoMetadata || {}),
      aspect_ratio: "1:1",
      size: config.size || "1024x1024",
      urls: [sourceImageToDataUrl(options.sourceImagePath)]
    }
  });

  const videosBase64Ledger =
    mode === "videos-base64" && options.paidImageLedger
      ? initializePaidImageProductLedger({
          rootDir: options.paidImageLedger.rootDir,
          batchFingerprint: options.paidImageLedger.batchFingerprint,
          recordId: options.paidImageLedger.recordId,
          expectedSlotCount: options.paidImageLedger.expectedSlotCount,
          providerIdentity: sha256Text(
            JSON.stringify({
              apiUrl: config.apiUrl,
              statusUrl: config.statusUrl || "",
              model: config.model,
              mode,
              size: config.size || "1024x1024",
              videoMetadata: config.videoMetadata || {},
              requestExtra: config.requestExtra || {}
            })
          ),
          sourceImageDigest: sha256File(options.sourceImagePath)
        })
      : undefined;
  if (videosBase64Ledger && options.paidImageLedger) {
    const relativeProductDir = path.relative(options.paidImageLedger.rootDir, videosBase64Ledger.productDir);
    const legacyRunsRoot = path.join(path.dirname(options.paidImageLedger.rootDir), "runs");
    const legacyProductDirs = fs.existsSync(legacyRunsRoot)
      ? fs.readdirSync(legacyRunsRoot, { withFileTypes: true }).flatMap((runEntry) => {
          const tasksRoot = path.join(legacyRunsRoot, runEntry.name, "tasks");
          if (!runEntry.isDirectory() || !fs.existsSync(tasksRoot)) {
            return [];
          }
          return fs.readdirSync(tasksRoot, { withFileTypes: true })
            .filter((taskEntry) => taskEntry.isDirectory())
            .map((taskEntry) => path.join(tasksRoot, taskEntry.name, "paid-image-ledger", relativeProductDir));
        })
      : [];
    const migrated = migrateLegacyPaidImageProductLedgers({
      productDir: videosBase64Ledger.productDir,
      legacyProductDirs
    });
    if (migrated > 0) {
      options.onProgress?.(`Imported ${migrated} paid image slot(s) from legacy runtime ledgers.`);
    }
  }

  const fetchMediaGenerateStatus = async (taskId: string): Promise<{ response: Response; text: string }> => {
    const statusUrl = new URL(resolveMediaGenerateStatusUrl(config.apiUrl, config.statusUrl));
    statusUrl.searchParams.set("task_id", taskId);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(statusUrl, {
        headers: {
          Authorization: "Bearer " + config.apiKey
        },
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

  const fetchVideosBase64Task = async (taskId: string, content = false): Promise<Response> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(resolveVideosBase64TaskUrl(config.apiUrl, taskId, content), {
        headers: {
          Authorization: "Bearer " + config.apiKey
        },
        signal: controller.signal
      });
    } catch (error) {
      throw normalizeImageGenerationError(error instanceof Error ? error.message : String(error));
    } finally {
      clearTimeout(timer);
    }
  };

  const waitBeforeVideosBase64ReadRetry = async (
    taskId: string,
    imageIndex: number,
    label: string,
    attempt: number,
    message: string
  ): Promise<void> => {
    const retryNo = attempt + 1;
    const nextDelayMs = transportRetryPolicy.delayMs[attempt] || transportRetryPolicy.delayMs.at(-1) || 45000;
    writeImageGenerationJsonLog(
      path.join(
        options.downloadDir,
        `response-${String(imageIndex).padStart(2, "0")}-${label}-transport-transient-${retryNo}.json`
      ),
      {
        taskId,
        label,
        retryNo,
        maxTransientRetries: transportRetryPolicy.maxRetries,
        error: message,
        nextDelayMs
      }
    );
    options.onProgress?.(
      `Image ${imageIndex}: transient transport error during videos-base64 ${label}; retry ${retryNo}/${transportRetryPolicy.maxRetries}.`
    );
    await sleep(nextDelayMs);
  };

  const fetchVideosBase64TaskWithTransportRetries = async (
    taskId: string,
    content: boolean,
    imageIndex: number,
    label: string
  ): Promise<Response> => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        const response = await fetchVideosBase64Task(taskId, content);
        if (!isTransientImageProviderStatus(response.status)) {
          return response;
        }
        if (attempt >= transportRetryPolicy.maxRetries) {
          return response;
        }
        const responseText = await response.text().catch(() => "");
        await waitBeforeVideosBase64ReadRetry(
          taskId,
          imageIndex,
          label,
          attempt,
          `videos-base64 ${label} transient HTTP ${response.status}: ${responseText || response.statusText}`
        );
        continue;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!isTransientImageProviderErrorMessage(message) || attempt >= transportRetryPolicy.maxRetries) {
          throw error;
        }
        await waitBeforeVideosBase64ReadRetry(taskId, imageIndex, label, attempt, message);
      }
    }
  };

  const downloadVideosBase64ResultWithTransportRetries = async (
    resultUrl: string,
    targetFile: string,
    taskId: string,
    imageIndex: number
  ): Promise<void> => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        await downloadGeneratedImage(resultUrl, targetFile, config.apiKey || "", timeoutMs);
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const transient =
          isTransientImageProviderErrorMessage(message) || /HTTP\s+(429|500|502|503|504)\b/i.test(message);
        if (!transient || attempt >= transportRetryPolicy.maxRetries) {
          throw error;
        }
        await waitBeforeVideosBase64ReadRetry(taskId, imageIndex, "result-download", attempt, message);
      }
    }
  };

  const buildEditFormData = (includeResponseFormat: boolean, promptText: string): FormData => {
    if (!fs.existsSync(options.sourceImagePath)) {
      throw new Error("Source reference image not found for image edit: " + options.sourceImagePath);
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

  const sendPolicyPromptRetry = async (
    imageIndex: number,
    currentPromptText: string,
    requestSummaryFactory: (currentPromptText: string) => Record<string, unknown>,
    label: string
  ): Promise<{ response: Response; text: string; promptText: string }> => {
    const nextPromptText = buildPolicyCompatibleImageEditPrompt(options.promptText, imageIndex);
    const policyRetrySummary = requestSummaryFactory(nextPromptText);
    writeImageGenerationJsonLog(
      path.join(options.downloadDir, "request-" + String(imageIndex).padStart(2, "0") + "-" + label + "-policy-retry.json"),
      policyRetrySummary
    );
    let result =
      mode === "edits"
        ? await sendRequestWithTransportRetries(imageIndex, label + "-policy-retry", () => buildEditFormData(true, nextPromptText))
        : await sendRequestWithTransportRetries(imageIndex, label + "-policy-retry", () => JSON.stringify(buildGenerationJsonBody(nextPromptText)), "application/json");
    if (!result.response.ok && mode === "edits" && /response_?format|unsupported parameter|unknown parameter|invalid parameter/i.test(result.text)) {
      const retrySummary = { ...policyRetrySummary };
      delete retrySummary.response_format;
      writeImageGenerationJsonLog(
        path.join(options.downloadDir, "request-" + String(imageIndex).padStart(2, "0") + "-" + label + "-policy-retry-no-response-format.json"),
        retrySummary
      );
      result = await sendRequestWithTransportRetries(imageIndex, label + "-policy-response-format-retry", () => buildEditFormData(false, nextPromptText));
    }
    return { ...result, promptText: nextPromptText || currentPromptText };
  };

  const generateVideosBase64Image = async (absoluteImageIndex: number): Promise<{ file: string; submitId: string }> => {
    const paddedImageIndex = String(absoluteImageIndex).padStart(2, "0");
    const ledgerSlot = (options.paidImageLedger?.slotOffset || 0) + absoluteImageIndex;
    const promptText = buildPromptForImageIndex(absoluteImageIndex);
    const requestBody = JSON.stringify(buildVideosBase64JsonBody(promptText));
    const requestDigest = sha256Text(requestBody);
    const promptDigest = sha256Text(promptText);
    const requestFile = path.join(options.downloadDir, "request-" + paddedImageIndex + ".json");
    const responseFile = path.join(options.downloadDir, "response-" + paddedImageIndex + ".json");
    const targetFile = path.join(options.downloadDir, "generated-" + paddedImageIndex + ".png");
    writeImageGenerationJsonLog(requestFile, {
      endpoint: config.apiUrl,
      mode,
      ...JSON.parse(requestBody)
    });

    let submitPayload: any | undefined;
    let taskId = "";
    if (videosBase64Ledger) {
      let slotAction = resolvePaidImageSlotAction({
        productDir: videosBase64Ledger.productDir,
        slot: ledgerSlot
      });
      if (slotAction.action === "missing" || slotAction.action === "retry_failed_before_acceptance") {
        slotAction = reservePaidImageSlot({
          productDir: videosBase64Ledger.productDir,
          slot: ledgerSlot,
          requestDigest,
          promptDigest,
          owner: options.paidImageLedger?.owner || { pid: process.pid }
        });
      }

      if (slotAction.action === "reuse") {
        fs.mkdirSync(path.dirname(targetFile), { recursive: true });
        if (!fs.existsSync(targetFile) || sha256File(targetFile) !== sha256File(slotAction.resultFile)) {
          fs.copyFileSync(slotAction.resultFile, targetFile);
        }
        options.onProgress?.(`Image ${absoluteImageIndex}: reused completed paid image ledger result.`);
        return { file: targetFile, submitId: slotAction.record.providerTaskId || "ledger-reuse" };
      }
      if (slotAction.action === "poll") {
        taskId = slotAction.providerTaskId;
        submitPayload = readVideosBase64SubmittedTask(responseFile) || { id: taskId };
        options.onProgress?.(`Image ${absoluteImageIndex}: resuming submitted videos-base64 task from paid image ledger.`);
      } else if (slotAction.action === "blocked_reserved" || slotAction.action === "blocked_ambiguous") {
        throw normalizeImageGenerationError(
          `videos-base64 paid image ledger blocked slot ${absoluteImageIndex}: ${slotAction.action}.`
        );
      } else {
        submitPayload = readVideosBase64SubmittedTask(responseFile);
        if (submitPayload) {
          taskId = extractVideosBase64TaskId(submitPayload);
          recordPaidImageSubmitted({
            productDir: videosBase64Ledger.productDir,
            slot: ledgerSlot,
            providerTaskId: taskId,
            providerResponse: submitPayload
          });
          options.onProgress?.(`Image ${absoluteImageIndex}: imported existing videos-base64 task into paid image ledger.`);
        }
      }
    } else {
      submitPayload = readVideosBase64SubmittedTask(responseFile);
      if (submitPayload) {
        options.onProgress?.(`Image ${absoluteImageIndex}: resuming submitted videos-base64 task.`);
      }
    }

    if (!submitPayload) {
      options.onProgress?.(`Image ${absoluteImageIndex}: submitting videos-base64 request.`);
      let response: Response;
      let text = "";
      try {
        const result = await submitGate.run(() => sendRequest(requestBody, "application/json", videosBase64SubmitTimeoutMs));
        response = result.response;
        text = result.text;
      } catch (error) {
        if (videosBase64Ledger) {
          recordPaidImageAmbiguous({
            productDir: videosBase64Ledger.productDir,
            slot: ledgerSlot,
            reason: error instanceof Error ? error.message : String(error)
          });
        }
        throw error;
      }
      writeImageGenerationTextLog(responseFile, text);
      if (!response.ok) {
        if (videosBase64Ledger) {
          const recordRejection = providerExplicitlyProvesNoPaidTaskAccepted(response.status, text)
            ? recordPaidImageFailedBeforeAcceptance
            : recordPaidImageAmbiguous;
          recordRejection({
            productDir: videosBase64Ledger.productDir,
            slot: ledgerSlot,
            reason: "HTTP " + response.status + ": " + (text || response.statusText)
          });
        }
        throw normalizeImageGenerationError("videos-base64 submit failed with HTTP " + response.status + ": " + (text || response.statusText));
      }
      try {
        submitPayload = JSON.parse(text);
      } catch {
        if (videosBase64Ledger) {
          recordPaidImageAmbiguous({
            productDir: videosBase64Ledger.productDir,
            slot: ledgerSlot,
            reason: "submit response was not JSON"
          });
        }
        throw new Error("videos-base64 submit response was not JSON: " + text.slice(0, 500));
      }
      taskId = extractVideosBase64TaskId(submitPayload);
      if (videosBase64Ledger) {
        recordPaidImageSubmitted({
          productDir: videosBase64Ledger.productDir,
          slot: ledgerSlot,
          providerTaskId: taskId,
          providerResponse: submitPayload
        });
      }
    }
    taskId = taskId || extractVideosBase64TaskId(submitPayload);
    const pollIntervalMs = Math.max(1000, config.pollIntervalMs || 10000);
    const maxPollMs = Math.max(pollIntervalMs, config.maxPollMs || 1800000);
    const startedAt = Date.now();
    let statusPayload: any = submitPayload;
    for (let pollNo = 1; !videosBase64Succeeded(statusPayload) && !videosBase64Failed(statusPayload); pollNo += 1) {
      if (Date.now() - startedAt > maxPollMs) {
        throw normalizeImageGenerationError(`videos-base64 task ${taskId} did not finish within ${maxPollMs}ms.`);
      }
      await sleep(pollIntervalMs);
      const statusResponse = await fetchVideosBase64TaskWithTransportRetries(taskId, false, absoluteImageIndex, "status");
      const statusText = await statusResponse.text();
      writeImageGenerationTextLog(path.join(options.downloadDir, "response-" + paddedImageIndex + "-status-" + pollNo + ".json"), statusText);
      if (!statusResponse.ok) {
        throw normalizeImageGenerationError(
          "videos-base64 status failed with HTTP " + statusResponse.status + ": " + (statusText || statusResponse.statusText)
        );
      }
      try {
        statusPayload = JSON.parse(statusText);
      } catch {
        throw new Error("videos-base64 status response was not JSON: " + statusText.slice(0, 500));
      }
      const status = statusPayload?.status ?? statusPayload?.data?.status ?? "pending";
      const progress = statusPayload?.progress ?? statusPayload?.data?.progress ?? "";
      options.onProgress?.(`Image ${absoluteImageIndex}: videos-base64 task ${taskId} status ${status} ${progress}.`.trim());
    }
    if (videosBase64Failed(statusPayload)) {
      const errorMessage = statusPayload?.error ?? statusPayload?.data?.error ?? "unknown error";
      if (videosBase64Ledger) {
        recordPaidImageAmbiguous({
          productDir: videosBase64Ledger.productDir,
          slot: ledgerSlot,
          reason: `provider task failed: ${errorMessage}`,
          providerResponse: statusPayload
        });
      }
      throw normalizeImageGenerationError(`videos-base64 task ${taskId} failed: ${errorMessage}`);
    }

    const resultUrl = extractVideosBase64ResultUrl(statusPayload);
    if (resultUrl) {
      await downloadVideosBase64ResultWithTransportRetries(resultUrl, targetFile, taskId, absoluteImageIndex);
    } else {
      const contentResponse = await fetchVideosBase64TaskWithTransportRetries(taskId, true, absoluteImageIndex, "content");
      if (!contentResponse.ok) {
        const contentError = await contentResponse.text().catch(() => "");
        throw normalizeImageGenerationError(
          "videos-base64 content download failed with HTTP " + contentResponse.status + ": " + (contentError || contentResponse.statusText)
        );
      }
      const contentType = contentResponse.headers.get("content-type") || "";
      if (contentType && !/^image\/|application\/octet-stream/i.test(contentType)) {
        throw normalizeImageGenerationError("videos-base64 content response was not an image: " + contentType);
      }
      fs.writeFileSync(targetFile, Buffer.from(await contentResponse.arrayBuffer()));
    }
    if (videosBase64Ledger) {
      recordPaidImageCompleted({
        productDir: videosBase64Ledger.productDir,
        slot: ledgerSlot,
        sourceFile: targetFile
      });
    }
    options.onProgress?.(`Image ${absoluteImageIndex}: saved ${path.basename(targetFile)}.`);
    return { file: targetFile, submitId: taskId };
  };

  if (mode === "videos-base64") {
    const videosBase64ImageIndexes =
      options.requestedImageIndexes?.length
        ? options.requestedImageIndexes
        : Array.from({ length: count }, (_, index) => imageIndexOffset + index + 1);
    return settleConcurrentWork(
      videosBase64ImageIndexes.map((absoluteImageIndex) => generateVideosBase64Image(absoluteImageIndex)),
      "videos-base64 paid image slots"
    );
  }

  const generated: Array<{ file: string; submitId: string }> = [];
  for (let imageIndex = 1; imageIndex <= count; imageIndex += 1) {
    const resolvedImageIndex = resolveOpenAiCompatibleGeneratedImageIndex({
      imageIndexOffset,
      localImageIndex: imageIndex
    });
    const absoluteImageIndex = resolvedImageIndex.absoluteImageIndex;
    const paddedImageIndex = resolvedImageIndex.paddedImageIndex;
    let promptText = buildPromptForImageIndex(absoluteImageIndex);
    const requestFile = path.join(options.downloadDir, "request-" + paddedImageIndex + ".json");
    const responseFile = path.join(options.downloadDir, "response-" + paddedImageIndex + ".json");
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
            requestExtra: redactImageGenerationLogValue(config.requestExtra || {})
          }
        : mode === "media-generate"
          ? (redactImageGenerationLogValue({
              endpoint: config.apiUrl,
              statusUrl: resolveMediaGenerateStatusUrl(config.apiUrl, config.statusUrl),
              mode,
              ...buildMediaGenerateJsonBody(currentPromptText)
            }) as Record<string, unknown>)
        : (redactImageGenerationLogValue(buildGenerationJsonBody(currentPromptText)) as Record<string, unknown>);
    const requestSummary = buildRequestSummary(promptText);
    writeImageGenerationJsonLog(requestFile, requestSummary);

    if (mode === "media-generate") {
      options.onProgress?.(`Image ${absoluteImageIndex}: submitting media-generate request.`);
      const { response, text } = await sendRequestWithTransportRetries(
        absoluteImageIndex,
        "initial",
        () => JSON.stringify(buildMediaGenerateJsonBody(promptText)),
        "application/json"
      );
      writeImageGenerationTextLog(responseFile, text);
      if (!response.ok) {
        throw normalizeImageGenerationError("Media generation submit failed with HTTP " + response.status + ": " + (text || response.statusText));
      }

      let submitPayload: any;
      try {
        submitPayload = JSON.parse(text);
      } catch {
        throw new Error("Media generation submit response was not JSON: " + text.slice(0, 500));
      }
      const taskId = extractMediaGenerateTaskId(submitPayload);
      const pollIntervalMs = Math.max(1000, config.pollIntervalMs || 5000);
      const maxPollMs = Math.max(pollIntervalMs, config.maxPollMs || timeoutMs);
      const startedAt = Date.now();
      let statusPayload: any;
      for (let pollNo = 1; ; pollNo += 1) {
        await sleep(pollIntervalMs);
        const statusResult = await fetchMediaGenerateStatus(taskId);
        const statusLogFile = path.join(options.downloadDir, "response-" + paddedImageIndex + "-status-" + pollNo + ".json");
        writeImageGenerationTextLog(statusLogFile, statusResult.text);
        if (!statusResult.response.ok) {
          throw normalizeImageGenerationError(
            "Media generation status failed with HTTP " + statusResult.response.status + ": " + (statusResult.text || statusResult.response.statusText)
          );
        }
        try {
          statusPayload = JSON.parse(statusResult.text);
        } catch {
          throw new Error("Media generation status response was not JSON: " + statusResult.text.slice(0, 500));
        }
        const progress = statusPayload?.progress ?? statusPayload?.data?.progress ?? "";
        const statusText = statusPayload?.status ?? statusPayload?.data?.status ?? "";
        options.onProgress?.(`Image ${absoluteImageIndex}: media task ${taskId} status ${statusText || "pending"} ${progress || ""}.`.trim());
        if (mediaGenerateIsFinal(statusPayload)) {
          break;
        }
        if (Date.now() - startedAt > maxPollMs) {
          throw normalizeImageGenerationError(`Media generation task ${taskId} did not finish within ${maxPollMs}ms.`);
        }
      }
      if (!mediaGenerateSucceeded(statusPayload) || mediaGenerateFailed(statusPayload)) {
        const errorMessage = statusPayload?.error ?? statusPayload?.data?.error ?? "unknown error";
        throw normalizeImageGenerationError(`Media generation task ${taskId} failed: ${errorMessage}`);
      }
      const resultUrl = extractMediaGenerateResultUrl(statusPayload);
      if (!resultUrl) {
        throw normalizeImageGenerationError("Media generation task returned no result_url: " + JSON.stringify(redactImageGenerationLogValue(statusPayload)).slice(0, 500));
      }
      const targetFile = path.join(options.downloadDir, "generated-" + paddedImageIndex + getImageExtensionFromContentType(resultUrl));
      await downloadGeneratedImage(resultUrl, targetFile, config.apiKey || "", timeoutMs);
      options.onProgress?.(`Image ${absoluteImageIndex}: saved ${path.basename(targetFile)}.`);
      generated.push({ file: targetFile, submitId: taskId });
      continue;
    }

    options.onProgress?.(`Image ${absoluteImageIndex}: submitting ${mode} request.`);
    let { response, text } =
      mode === "edits"
        ? await sendRequestWithTransportRetries(absoluteImageIndex, "initial", () => buildEditFormData(true, promptText))
        : await sendRequestWithTransportRetries(absoluteImageIndex, "initial", () => JSON.stringify(buildGenerationJsonBody(promptText)), "application/json");
    if (!response.ok && /response_?format|unsupported parameter|unknown parameter|invalid parameter/i.test(text)) {
      if (mode === "edits") {
        const retrySummary = { ...(requestSummary as Record<string, unknown>) };
        delete retrySummary.response_format;
        writeImageGenerationJsonLog(path.join(options.downloadDir, "request-" + paddedImageIndex + "-retry.json"), retrySummary);
        ({ response, text } = await sendRequestWithTransportRetries(absoluteImageIndex, "response-format-retry", () => buildEditFormData(false, promptText)));
      } else {
        const retryBody = buildGenerationJsonBody(promptText);
        delete (retryBody as Record<string, unknown>).response_format;
        writeImageGenerationJsonLog(path.join(options.downloadDir, "request-" + paddedImageIndex + "-retry.json"), retryBody);
        ({ response, text } = await sendRequestWithTransportRetries(absoluteImageIndex, "response-format-retry", () => JSON.stringify(retryBody), "application/json"));
      }
    }
    if (shouldRetryImageGenerationWithPolicyPrompt({ responseOk: response.ok, responseText: text })) {
      ({ response, text, promptText } = await sendPolicyPromptRetry(absoluteImageIndex, promptText, buildRequestSummary, "initial"));
    }
    const httpRetryPolicy = resolveImageGenerationHttpRetryPolicy({
      status: response.status,
      responseText: text,
      configuredMaxRetries: config.maxTransientRetries
    });
    for (let attempt = 1; !response.ok && isTransientImageProviderStatus(response.status) && attempt <= httpRetryPolicy.maxRetries; attempt += 1) {
      writeImageGenerationTextLog(
        path.join(options.downloadDir, "response-" + paddedImageIndex + "-transient-" + attempt + ".json"),
        text
      );
      options.onProgress?.(
        `Image ${absoluteImageIndex}: transient HTTP ${response.status} (${httpRetryPolicy.reason}); retry ${attempt}/${httpRetryPolicy.maxRetries}.`
      );
      await sleep(httpRetryPolicy.delayMs[attempt - 1] || httpRetryPolicy.delayMs.at(-1) || 3000 * attempt);
      ({ response, text } =
        mode === "edits"
          ? await sendRequestWithTransportRetries(absoluteImageIndex, "http-transient-retry", () => buildEditFormData(true, promptText))
          : await sendRequestWithTransportRetries(absoluteImageIndex, "http-transient-retry", () => JSON.stringify(buildGenerationJsonBody(promptText)), "application/json"));
    }
    if (!response.ok) {
      writeImageGenerationTextLog(responseFile, text);
      throw normalizeImageGenerationError("Image generation failed with HTTP " + response.status + ": " + (text || response.statusText));
    }

    let payload: any;
    let items: any[] = [];
    for (let emptyAttempt = 0; ; emptyAttempt += 1) {
      try {
        payload = JSON.parse(text);
      } catch {
        throw new Error("Image generation response was not JSON: " + text.slice(0, 500));
      }
      writeImageGenerationJsonLog(
        emptyAttempt === 0
          ? responseFile
          : path.join(options.downloadDir, "response-" + paddedImageIndex + "-empty-data-retry-" + emptyAttempt + ".json"),
        payload
      );

      items = getGeneratedImageItems(payload);
      if (items.length > 0) {
        break;
      }
      if (emptyAttempt >= maxTransientRetries) {
        extractGeneratedImageItems(payload, text);
      }

      const retryNo = emptyAttempt + 1;
      options.onProgress?.(`Image ${absoluteImageIndex}: provider returned empty data; retry ${retryNo}/${maxTransientRetries}.`);
      await sleep(3000 * retryNo);
      ({ response, text } =
        mode === "edits"
          ? await sendRequestWithTransportRetries(absoluteImageIndex, "empty-data-retry", () => buildEditFormData(true, promptText))
          : await sendRequestWithTransportRetries(absoluteImageIndex, "empty-data-retry", () => JSON.stringify(buildGenerationJsonBody(promptText)), "application/json"));
      if (shouldRetryImageGenerationWithPolicyPrompt({ responseOk: response.ok, responseText: text })) {
        ({ response, text, promptText } = await sendPolicyPromptRetry(absoluteImageIndex, promptText, buildRequestSummary, "empty-data-retry-" + retryNo));
      }
      if (!response.ok) {
        writeImageGenerationTextLog(
          path.join(options.downloadDir, "response-" + paddedImageIndex + "-empty-data-retry-http-error-" + retryNo + ".json"),
          text
        );
        throw normalizeImageGenerationError("Image generation retry failed with HTTP " + response.status + ": " + (text || response.statusText));
      }
    }
    const saved = await saveGeneratedImageItem({
      item: items[0],
      payload,
      targetDir: options.downloadDir,
      index: absoluteImageIndex,
      apiKey: config.apiKey || "",
      timeoutMs
    });
    if (!saved) {
      throw normalizeImageGenerationError("Image generation returned no downloadable image payloads: " + text.slice(0, 500));
    }
    options.onProgress?.(`Image ${absoluteImageIndex}: saved ${path.basename(saved.file)}.`);
    generated.push(saved);
  }

  if (generated.length < count) {
    throw new Error("Image generation returned " + generated.length + " image(s), expected " + count + ".");
  }
  return generated;
}

export async function generateOpenAiCompatibleImagePreview(options: {
  configFile: string;
  sourceImagePath: string;
  sourceImageReferenceUrl?: string;
  promptWordFile: string;
  outputDir: string;
  sellingPointText: string;
}): Promise<{ file: string; requestFile: string; promptFile: string }> {
  const paragraphs = readSimpleWordDocument(options.promptWordFile);
  const promptText = buildImageEditPromptFromWord({
    paragraphs,
    promptWordFile: options.promptWordFile,
    ...parseSellingPointFields(options.sellingPointText)
  });
  fs.mkdirSync(options.outputDir, { recursive: true });
  const promptFile = path.join(options.outputDir, "prompt.txt");
  fs.writeFileSync(promptFile, promptText + "\n", "utf8");
  const [generated] = await generateWithOpenAiCompatibleProvider({
    configFile: options.configFile,
    promptText,
    sourceImagePath: options.sourceImagePath,
    sourceImageReferenceUrl: options.sourceImageReferenceUrl,
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
  const baseName = sanitizeFileName(productName + watermarkText + String(imageIndex).padStart(2, "0"));
  return path.join(stageDir, baseName + ext);
}

function buildProductFolder(shopFolder: string, productName: string, imageIndex: number): string {
  return path.join(shopFolder, sanitizeFileName(productName + "水印" + String(imageIndex).padStart(2, "0")));
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
  resolveWatermarkText: (imageIndex: number) => string;
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

  const startImageIndex = options.startImageIndex;
  const rawCandidates = listImageFilesRecursive(options.roundDir).filter((file) => file.includes(path.sep + "raw" + path.sep));
  const rawByLocalIndex = new Map(
    rawCandidates.flatMap((file) => {
      const match = /^generated-(\d+)/i.exec(path.basename(file));
      return match ? [[Number(match[1]), file] as const] : [];
    })
  );
  const existingStagedFiles = listImageFiles(options.stageDir);
  let invalidStagedFileFound = false;
  for (const stagedFile of existingStagedFiles) {
    const globalIndexMatch = /(\d+)(?=\.[^.]+$)/.exec(path.basename(stagedFile));
    const imageIndex = Number(globalIndexMatch?.[1]);
    const localIndex = imageIndex - startImageIndex + 1;
    const rawImageFile = rawByLocalIndex.get(localIndex);
    const expectedWatermarkText = Number.isInteger(imageIndex) ? options.resolveWatermarkText(imageIndex) : "";
    if (!rawImageFile || !expectedWatermarkText || !path.basename(stagedFile).includes(expectedWatermarkText)) {
      fs.rmSync(stagedFile, { force: true });
      invalidStagedFileFound = true;
      continue;
    }
    recovered.push({
      stagedFile,
      rawImageFile,
      imageIndex
    });
  }
  recovered.sort((left, right) => left.imageIndex - right.imageIndex);
  if (existingStagedFiles.length > 0 && !invalidStagedFileFound) {
    return recovered;
  }
  if (invalidStagedFileFound) {
    for (const item of recovered) {
      fs.rmSync(item.stagedFile, { force: true });
    }
    recovered.length = 0;
  }

  const watermarkDir = path.join(options.roundDir, "watermark");
  const existingRawFiles = [...rawByLocalIndex.entries()].sort((left, right) => left[0] - right[0]);
  if (existingRawFiles.length === 0) {
    return recovered;
  }

  const watermarkCandidates = existingRawFiles.filter(([, rawFile]) => fs.existsSync(rawFile));
  if (watermarkCandidates.length === 0) {
    return recovered;
  }

  for (const [localIndex, rawImageFile] of watermarkCandidates) {
    const imageIndex = startImageIndex + localIndex - 1;
    const watermarkText = options.resolveWatermarkText(imageIndex);
    const [watermarkedFile] = await applyLocalWatermark({
      inputFiles: [rawImageFile],
      outputDir: path.join(watermarkDir, String(imageIndex).padStart(2, "0")),
      watermarkText
    });
    const stagedFile = stageWatermarkedFile({
      stageDir: options.stageDir,
      productName: options.productName,
      watermarkText,
      imageIndex,
      watermarkedFile
    });
    recovered.push({
      stagedFile,
      rawImageFile,
      imageIndex
    });
  }

  return recovered.sort((left, right) => left.imageIndex - right.imageIndex);
}

export const MAIN_IMAGE_REUSE_IDENTITY_FILE = "reuse-identity.json";

interface MainImageReuseIdentity {
  sourceImagePath?: string;
  sourceImageName?: string;
  feishuRecordId?: string;
}

function normalizeIdentityPath(filePath: string | undefined): string {
  return filePath ? path.resolve(filePath) : "";
}

function writeMainImageReuseIdentity(taskDir: string, identity: MainImageReuseIdentity): void {
  fs.mkdirSync(taskDir, { recursive: true });
  fs.writeFileSync(
    path.join(taskDir, MAIN_IMAGE_REUSE_IDENTITY_FILE),
    JSON.stringify(
      {
        ...identity,
        sourceImagePath: normalizeIdentityPath(identity.sourceImagePath)
      },
      null,
      2
    ) + "\n",
    "utf8"
  );
}

export function seedCurrentProductMainImageReuse(options: {
  runtimeDir: string;
  taskId: string;
  sourceImagePath: string;
  sourceImageName?: string;
  feishuRecordId?: string;
}): { copiedRawImageCount: number; sourceTaskDir?: string } {
  const targetTaskDir = ensureTaskDir(options.runtimeDir, options.taskId);
  const targetIdentity: MainImageReuseIdentity = {
    sourceImagePath: normalizeIdentityPath(options.sourceImagePath),
    sourceImageName: options.sourceImageName || path.basename(options.sourceImagePath),
    feishuRecordId: options.feishuRecordId
  };
  writeMainImageReuseIdentity(targetTaskDir, targetIdentity);
  return { copiedRawImageCount: 0 };
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
): MainImageGeneratedFile[] {
  const generatedFiles: MainImageGeneratedFile[] = [];

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
  imagesPerShop: number;
  shopCodes: string[];
}): MainImageGeneratedFile[] {
  const generatedFiles: MainImageGeneratedFile[] = [];
  const shopMap = shopFolderByCode(options.shopFolders);
  const assignments = resolveMainImageShopAssignments({
    shopCodes: options.shopCodes,
    imagesPerShop: options.imagesPerShop,
    totalImageCount: options.promptFiles.length * options.expectedImageCount
  });
  let imageIndex = 1;

  for (let promptIndex = 0; promptIndex < options.promptFiles.length; promptIndex += 1) {
    for (let itemIndex = 0; itemIndex < options.expectedImageCount; itemIndex += 1) {
      const assignment = assignments[imageIndex - 1];
      const shop = shopMap.get(assignment.shopCode);
      if (!shop) {
        throw new Error(`Simulated main image assignment missing shop folder for code: ${assignment.shopCode}`);
      }
      const productFolder = path.join(
        options.taskDir,
        "simulated-shops",
        sanitizeFileName(path.basename(shop.shopFolder)),
        sanitizeFileName(options.brandedGenericName + "水印" + String(imageIndex).padStart(2, "0"))
      );
      fs.mkdirSync(productFolder, { recursive: true });
      const imageFile = path.join(
        productFolder,
        path.basename(buildStagedImageFile(productFolder, options.brandedGenericName, shop.watermarkText, imageIndex, options.sourceImagePath))
      );
      fs.copyFileSync(options.sourceImagePath, imageFile);
      generatedFiles.push({
        imageFile,
        rawImageFile: options.sourceImagePath,
        shopFolder: shop.shopFolder,
        productFolder,
        storeName: path.basename(shop.shopFolder),
        promptIndex: promptIndex + 1,
        promptWordFile: options.promptFiles[promptIndex]
      });
      imageIndex += 1;
    }
  }

  fs.writeFileSync(
    path.join(options.taskDir, "main-image-generation-simulated.txt"),
    generatedFiles.map((item) => item.imageFile).join("\n") + "\n",
    "utf8"
  );
  return generatedFiles;
}

export async function generateMainImageAssets(options: {
  runtimeDir: string;
  taskId: string;
  shopRootDir: string;
  sourceImagePath: string;
  sourceImageReferenceUrl?: string;
  sellingPointText: string;
  brandedGenericName: string;
  wordFiles: string[];
  imageGenerationProvider: ImageGenerationProvider;
  imageGenerationConfigFile: string;
  mainImageExpectedCount: number;
  mainImageCountStrategy: MainImageCountStrategy;
  promptCount?: number;
  shopCodes?: string[];
  imagesPerShop?: number;
  feishuRecordId?: string;
  feishuBatchFingerprint?: string;
  paidImageSubmissionLedgerDir?: string;
  simulateOnly: boolean;
  onProgress?: (message: string) => void;
}): Promise<MainImageArtifact> {
  const taskDir = ensureTaskDir(options.runtimeDir, options.taskId);
  const promptFile = writePromptSummary(taskDir, options.wordFiles);
  const shopFolders = filterShopFoldersByCodes(resolveShopFolders(options.shopRootDir), options.shopCodes);
  const promptCount = options.promptCount || 5;
  const shopCodes = options.shopCodes || shopFolders.map((item) => shopCodeFromFolder(item.shopFolder));
  const imagesPerShop = options.imagesPerShop || options.mainImageExpectedCount;
  const totalExpectedImageCount = promptCount * options.mainImageExpectedCount;
  const shopMap = shopFolderByCode(shopFolders);
  const assignments = resolveMainImageShopAssignments({
    shopCodes,
    imagesPerShop,
    totalImageCount: totalExpectedImageCount
  });
  if (options.wordFiles.length < promptCount) {
    throw new Error("Main image generation requires " + promptCount + " Word prompt file(s), got " + options.wordFiles.length + ".");
  }
  if (shopFolders.length < shopCodes.length) {
    throw new Error("Main image generation requires " + shopCodes.length + " shop folder(s), got " + shopFolders.length + ".");
  }
  const productName = inferBrandedGenericName(options.brandedGenericName, options.sellingPointText);
  const reuseSeed = seedCurrentProductMainImageReuse({
    runtimeDir: options.runtimeDir,
    taskId: options.taskId,
    sourceImagePath: options.sourceImagePath,
    sourceImageName: path.basename(options.sourceImagePath),
    feishuRecordId: options.feishuRecordId
  });
  if (reuseSeed.copiedRawImageCount > 0) {
    options.onProgress?.(
      `Reused ${reuseSeed.copiedRawImageCount} current-product raw main image(s) from ${reuseSeed.sourceTaskDir || "previous task"}.`
    );
  }

  if (options.simulateOnly) {
    return {
      promptFile,
      generatedFiles: buildSimulatedFiles({
        taskDir,
        shopFolders,
        brandedGenericName: productName,
        sourceImagePath: options.sourceImagePath,
        promptFiles: options.wordFiles.slice(0, promptCount),
        expectedImageCount: options.mainImageExpectedCount,
        imagesPerShop,
        shopCodes
      }),
      simulated: true
    };
  }

  readOpenAiCompatibleImageConfig(options.imageGenerationConfigFile);

  const imageGenerationConfig = readOpenAiCompatibleImageConfig(options.imageGenerationConfigFile);
  const imageGenerationMode = resolveOpenAiCompatibleImageMode(imageGenerationConfig.mode, imageGenerationConfig.apiUrl);
  const videosBase64SubmitGate =
    imageGenerationMode === "videos-base64"
      ? createConcurrencyGate(resolveVideosBase64SubmitConcurrency(imageGenerationConfig.submitConcurrency))
      : undefined;
  if (
    imageGenerationMode === "videos-base64" &&
    (!options.feishuBatchFingerprint || !options.feishuRecordId || !options.paidImageSubmissionLedgerDir)
  ) {
    throw new Error(
      "videos-base64 paid submission requires project-owned feishuBatchFingerprint, feishuRecordId, and paidImageSubmissionLedgerDir."
    );
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
  const processPromptRound = async (promptIndex: number) => {
    const roundStagedFiles: typeof stagedFiles = [];
    const roundStartImageIndex = promptIndex * options.mainImageExpectedCount + 1;
    const promptWordFile = options.wordFiles[promptIndex];
    const wordParagraphs = readSimpleWordDocument(promptWordFile);
    const promptText = buildImageEditPromptFromWord({
      paragraphs: wordParagraphs,
      promptWordFile,
      ...parseSellingPointFields(options.sellingPointText)
    });

    const roundDir = path.join(taskDir, "main-image-" + String(promptIndex + 1).padStart(2, "0"));
    const stageDir = path.join(taskDir, "staged", String(promptIndex + 1).padStart(2, "0"));
    const watermarkOutputDir = path.join(roundDir, "watermark");
    fs.mkdirSync(roundDir, { recursive: true });
    fs.writeFileSync(path.join(roundDir, "image2-prompt.txt"), promptText + "\n", "utf8");

    const recoveredFiles = await recoverExistingRoundOutputs({
      roundDir,
      stageDir,
      productName,
      resolveWatermarkText: (candidateImageIndex) => {
        const assignment = assignments[candidateImageIndex - 1];
        const shop = assignment ? shopMap.get(assignment.shopCode) : undefined;
        if (!shop) {
          throw new Error(`Recovered main image assignment missing shop folder for image ${candidateImageIndex}.`);
        }
        return shop.watermarkText;
      },
      startImageIndex: roundStartImageIndex
    });

    for (const recovered of recoveredFiles) {
      const assignment = assignments[recovered.imageIndex - 1];
      const shop = assignment ? shopMap.get(assignment.shopCode) : undefined;
      if (!shop) {
        throw new Error(`Recovered main image assignment missing shop folder for image ${recovered.imageIndex}.`);
      }
      roundStagedFiles.push({
        stagedFile: recovered.stagedFile,
        rawImageFile: recovered.rawImageFile,
        shopFolder: shop.shopFolder,
        promptIndex: promptIndex + 1,
        promptWordFile,
        imageIndex: recovered.imageIndex
      });
    }

    const recoveredLocalIndexes = recoveredFiles.map((recovered) => recovered.imageIndex - roundStartImageIndex + 1);
    const missingLocalIndexes = resolveMissingFixedImageIndexes(recoveredLocalIndexes, options.mainImageExpectedCount);
    const remainingImageCount =
      options.mainImageCountStrategy === "accept_all" && recoveredFiles.length > 0
        ? 0
        : missingLocalIndexes.length;

    if (
      options.mainImageCountStrategy !== "accept_all" &&
      recoveredFiles.length >= options.mainImageExpectedCount
    ) {
      return roundStagedFiles;
    }
    if (remainingImageCount === 0) {
      return roundStagedFiles;
    }

    options.onProgress?.(`Prompt ${promptIndex + 1}/${promptCount}: generating ${remainingImageCount} image(s).`);
    const generationResults = await generateWithOpenAiCompatibleProvider({
      configFile: options.imageGenerationConfigFile,
      promptText,
      sourceImagePath: options.sourceImagePath,
      sourceImageReferenceUrl: options.sourceImageReferenceUrl,
      downloadDir: path.join(roundDir, "openai-compatible", "raw"),
      expectedImageCount: remainingImageCount,
      requestedImageIndexes: missingLocalIndexes,
      videosBase64SubmitGate,
      paidImageLedger: {
        rootDir: options.paidImageSubmissionLedgerDir as string,
        batchFingerprint: options.feishuBatchFingerprint as string,
        recordId: options.feishuRecordId as string,
        expectedSlotCount: totalExpectedImageCount,
        slotOffset: promptIndex * options.mainImageExpectedCount,
        owner: {
          runId: path.basename(options.runtimeDir),
          taskId: options.taskId,
          pid: process.pid
        }
      },
      onProgress: (message) => options.onProgress?.(`Prompt ${promptIndex + 1}/${promptCount}: ${message}`)
    });

    const watermarkedFiles: string[] = [];
    for (let itemIndex = 0; itemIndex < generationResults.length; itemIndex += 1) {
      const assignedImageIndex = roundStartImageIndex + missingLocalIndexes[itemIndex] - 1;
      const assignment = assignments[assignedImageIndex - 1];
      const shop = assignment ? shopMap.get(assignment.shopCode) : undefined;
      if (!shop) {
        throw new Error(`Generated main image assignment missing shop folder for image ${assignedImageIndex}.`);
      }
      const [watermarkedFile] = await applyLocalWatermark({
        inputFiles: [generationResults[itemIndex].file],
        outputDir: path.join(watermarkOutputDir, assignment.shopCode),
        watermarkText: shop.watermarkText
      });
      watermarkedFiles.push(watermarkedFile);
    }

    if (watermarkedFiles.length === 0) {
      throw new Error("No watermarked files were saved for prompt " + (promptIndex + 1) + ".");
    }

    for (let itemIndex = 0; itemIndex < watermarkedFiles.length; itemIndex += 1) {
      const rawFile = generationResults[itemIndex]?.file;
      const watermarkedFile = watermarkedFiles[itemIndex];
      const imageIndex = roundStartImageIndex + missingLocalIndexes[itemIndex] - 1;
      const assignment = assignments[imageIndex - 1];
      const shop = assignment ? shopMap.get(assignment.shopCode) : undefined;
      if (!shop) {
        throw new Error(`Staged main image assignment missing shop folder for image ${imageIndex}.`);
      }

      const stagedFile = stageWatermarkedFile({
        stageDir,
        productName,
        watermarkText: shop.watermarkText,
        imageIndex,
        watermarkedFile
      });

      roundStagedFiles.push({
        stagedFile,
        rawImageFile: rawFile,
        shopFolder: shop.shopFolder,
        promptIndex: promptIndex + 1,
        promptWordFile,
        submitId: generationResults[itemIndex]?.submitId,
        imageIndex
      });
    }
    options.onProgress?.(`Prompt ${promptIndex + 1}/${promptCount}: staged ${watermarkedFiles.length} image(s).`);
    return roundStagedFiles;
  };

  const promptIndexes = Array.from({ length: promptCount }, (_, index) => index);
  if (imageGenerationMode === "videos-base64") {
    try {
      const concurrentRounds = await settleConcurrentWork(
        promptIndexes.map((promptIndex) => processPromptRound(promptIndex)),
        "videos-base64 prompt rounds"
      );
      stagedFiles.push(...concurrentRounds.flat());
    } catch (error) {
      const productDir = paidImageProductLedgerDir(
        options.paidImageSubmissionLedgerDir as string,
        options.feishuBatchFingerprint as string,
        options.feishuRecordId as string
      );
      if (fs.existsSync(productDir)) {
        const summary = summarizePaidImageProductLedger(productDir);
        if (resolvePaidImageLedgerFailureDisposition(summary) === "safety_block") {
          const original = error instanceof Error ? error.message : String(error);
          throw normalizeImageGenerationError(
            `paid submission safety block: paid image ledger has ambiguous=${summary.ambiguous}, reserved=${summary.reserved}; original: ${original}`
          );
        }
      }
      throw error;
    }
  } else {
    for (const promptIndex of promptIndexes) {
      stagedFiles.push(...(await processPromptRound(promptIndex)));
    }
  }
  stagedFiles.sort((left, right) => left.imageIndex - right.imageIndex);

  return {
    promptFile,
    generatedFiles: finalizeProductFolders(stagedFiles, productName),
    simulated: false
  };
}

export const generateJimengAssets = generateMainImageAssets;
