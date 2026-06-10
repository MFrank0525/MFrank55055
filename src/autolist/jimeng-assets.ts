import fs from "node:fs";
import path from "node:path";
import { sanitizeFileName } from "../doubao/paths.js";
import { assertNoGptPlusWebUrl } from "../utils/gpt-plus-guard.js";
import { readSimpleWordDocument } from "./docx-lite.js";
import {
  resolveImageDownloadTimeoutMs,
  resolveImageGenerationRequestDeadlineMs,
  resolveImageGenerationHttpRetryPolicy,
  resolveImageGenerationTransportRetryPolicy,
  shouldRetryImageGenerationWithPolicyPrompt
} from "./image-generation-rules.js";
import { applyLocalWatermark } from "./local-watermark.js";
import { readManualTextBlock } from "./operation-manual.js";
import { getShopSpecs, resolveMainImageShopAssignments, shopCodeFromFolder } from "./product-category.js";
import { buildMainImageEditInstruction } from "./rule-text.js";
import type { ImageGenerationProvider, MainImageArtifact, MainImageCountStrategy, MainImageGeneratedFile } from "./types.js";

interface OpenAiCompatibleImageConfig {
  provider?: "openai-compatible";
  apiUrl: string;
  apiKey?: string;
  model: string;
  mode?: "generations" | "edits" | "media-generate";
  size?: string;
  responseFormat?: "b64_json" | "url";
  timeoutMs?: number;
  maxTransientRetries?: number;
  requestExtra?: Record<string, unknown>;
  mediaParams?: Record<string, unknown>;
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

function redactImageGenerationLogValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactImageGenerationLogValue(item));
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
  onProgress?: (message: string) => void;
}): Promise<Array<{ file: string; submitId: string }>> {
  fs.mkdirSync(options.downloadDir, { recursive: true });

  const config = readOpenAiCompatibleImageConfig(options.configFile);
  const mode = config.mode || (config.apiUrl.includes("/images/edits") ? "edits" : config.apiUrl.includes("/v1/media/generate") ? "media-generate" : "generations");
  const count = Math.max(1, options.expectedImageCount || 1);
  const imageIndexOffset = generatedImageIndexOffset(options.downloadDir);
  const responseFormat = config.responseFormat || "b64_json";
  const timeoutMs = Math.max(30000, config.timeoutMs || 180000);
  const requestDeadlineMs = resolveImageGenerationRequestDeadlineMs(timeoutMs);
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
  const sendRequest = async (requestBody: BodyInit, contentType?: string): Promise<{ response: Response; text: string }> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let deadlineTimer: NodeJS.Timeout | undefined;
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
    size: config.size || "3840x2160",
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

  const buildEditFormData = (includeResponseFormat: boolean, promptText: string): FormData => {
    if (!fs.existsSync(options.sourceImagePath)) {
      throw new Error("Source reference image not found for image edit: " + options.sourceImagePath);
    }
    const form = new FormData();
    form.set("model", config.model);
    form.set("prompt", promptText);
    form.set("n", "1");
    form.set("size", config.size || "3840x2160");
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

  const generated: Array<{ file: string; submitId: string }> = [];
  for (let imageIndex = 1; imageIndex <= count; imageIndex += 1) {
    let promptText = buildPromptForImageIndex(imageIndex);
    const requestFile = path.join(options.downloadDir, "request-" + String(imageIndex).padStart(2, "0") + ".json");
    const responseFile = path.join(options.downloadDir, "response-" + String(imageIndex).padStart(2, "0") + ".json");
    const buildRequestSummary = (currentPromptText: string): Record<string, unknown> =>
      mode === "edits"
        ? {
            endpoint: config.apiUrl,
            mode,
            contentType: "multipart/form-data",
            model: config.model,
            prompt: currentPromptText,
            n: 1,
            size: config.size || "3840x2160",
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
      options.onProgress?.(`Image ${imageIndex}: submitting media-generate request.`);
      const { response, text } = await sendRequestWithTransportRetries(
        imageIndex,
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
        const statusLogFile = path.join(options.downloadDir, "response-" + String(imageIndex).padStart(2, "0") + "-status-" + pollNo + ".json");
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
        options.onProgress?.(`Image ${imageIndex}: media task ${taskId} status ${statusText || "pending"} ${progress || ""}.`.trim());
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
      const targetFile = path.join(options.downloadDir, "generated-" + String(imageIndexOffset + imageIndex).padStart(2, "0") + getImageExtensionFromContentType(resultUrl));
      await downloadGeneratedImage(resultUrl, targetFile, config.apiKey || "", timeoutMs);
      options.onProgress?.(`Image ${imageIndex}: saved ${path.basename(targetFile)}.`);
      generated.push({ file: targetFile, submitId: taskId });
      continue;
    }

    options.onProgress?.(`Image ${imageIndex}: submitting ${mode} request.`);
    let { response, text } =
      mode === "edits"
        ? await sendRequestWithTransportRetries(imageIndex, "initial", () => buildEditFormData(true, promptText))
        : await sendRequestWithTransportRetries(imageIndex, "initial", () => JSON.stringify(buildGenerationJsonBody(promptText)), "application/json");
    if (!response.ok && /response_?format|unsupported parameter|unknown parameter|invalid parameter/i.test(text)) {
      if (mode === "edits") {
        const retrySummary = { ...(requestSummary as Record<string, unknown>) };
        delete retrySummary.response_format;
        writeImageGenerationJsonLog(path.join(options.downloadDir, "request-" + String(imageIndex).padStart(2, "0") + "-retry.json"), retrySummary);
        ({ response, text } = await sendRequestWithTransportRetries(imageIndex, "response-format-retry", () => buildEditFormData(false, promptText)));
      } else {
        const retryBody = buildGenerationJsonBody(promptText);
        delete (retryBody as Record<string, unknown>).response_format;
        writeImageGenerationJsonLog(path.join(options.downloadDir, "request-" + String(imageIndex).padStart(2, "0") + "-retry.json"), retryBody);
        ({ response, text } = await sendRequestWithTransportRetries(imageIndex, "response-format-retry", () => JSON.stringify(retryBody), "application/json"));
      }
    }
    if (shouldRetryImageGenerationWithPolicyPrompt({ responseOk: response.ok, responseText: text })) {
      ({ response, text, promptText } = await sendPolicyPromptRetry(imageIndex, promptText, buildRequestSummary, "initial"));
    }
    const httpRetryPolicy = resolveImageGenerationHttpRetryPolicy({
      status: response.status,
      responseText: text,
      configuredMaxRetries: config.maxTransientRetries
    });
    for (let attempt = 1; !response.ok && isTransientImageProviderStatus(response.status) && attempt <= httpRetryPolicy.maxRetries; attempt += 1) {
      writeImageGenerationTextLog(
        path.join(options.downloadDir, "response-" + String(imageIndex).padStart(2, "0") + "-transient-" + attempt + ".json"),
        text
      );
      options.onProgress?.(
        `Image ${imageIndex}: transient HTTP ${response.status} (${httpRetryPolicy.reason}); retry ${attempt}/${httpRetryPolicy.maxRetries}.`
      );
      await sleep(httpRetryPolicy.delayMs[attempt - 1] || httpRetryPolicy.delayMs.at(-1) || 3000 * attempt);
      ({ response, text } =
        mode === "edits"
          ? await sendRequestWithTransportRetries(imageIndex, "http-transient-retry", () => buildEditFormData(true, promptText))
          : await sendRequestWithTransportRetries(imageIndex, "http-transient-retry", () => JSON.stringify(buildGenerationJsonBody(promptText)), "application/json"));
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
          : path.join(options.downloadDir, "response-" + String(imageIndex).padStart(2, "0") + "-empty-data-retry-" + emptyAttempt + ".json"),
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
      options.onProgress?.(`Image ${imageIndex}: provider returned empty data; retry ${retryNo}/${maxTransientRetries}.`);
      await sleep(3000 * retryNo);
      ({ response, text } =
        mode === "edits"
          ? await sendRequestWithTransportRetries(imageIndex, "empty-data-retry", () => buildEditFormData(true, promptText))
          : await sendRequestWithTransportRetries(imageIndex, "empty-data-retry", () => JSON.stringify(buildGenerationJsonBody(promptText)), "application/json"));
      if (shouldRetryImageGenerationWithPolicyPrompt({ responseOk: response.ok, responseText: text })) {
        ({ response, text, promptText } = await sendPolicyPromptRetry(imageIndex, promptText, buildRequestSummary, "empty-data-retry-" + retryNo));
      }
      if (!response.ok) {
        writeImageGenerationTextLog(
          path.join(options.downloadDir, "response-" + String(imageIndex).padStart(2, "0") + "-empty-data-retry-http-error-" + retryNo + ".json"),
          text
        );
        throw normalizeImageGenerationError("Image generation retry failed with HTTP " + response.status + ": " + (text || response.statusText));
      }
    }
    const saved = await saveGeneratedImageItem({
      item: items[0],
      payload,
      targetDir: options.downloadDir,
      index: imageIndexOffset + imageIndex,
      apiKey: config.apiKey || "",
      timeoutMs
    });
    if (!saved) {
      throw normalizeImageGenerationError("Image generation returned no downloadable image payloads: " + text.slice(0, 500));
    }
    options.onProgress?.(`Image ${imageIndex}: saved ${path.basename(saved.file)}.`);
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

  let imageIndex = options.startImageIndex;
  const existingStagedFiles = listImageFiles(options.stageDir);
  for (const stagedFile of existingStagedFiles) {
    const expectedWatermarkText = options.resolveWatermarkText(imageIndex);
    if (!path.basename(stagedFile).includes(expectedWatermarkText)) {
      fs.rmSync(stagedFile, { force: true });
      imageIndex += 1;
      continue;
    }
    const rawCandidates = listImageFilesRecursive(options.roundDir).filter((file) => file.includes(path.sep + "raw" + path.sep));
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
  const existingRawFiles = listImageFilesRecursive(options.roundDir).filter((file) => file.includes(path.sep + "raw" + path.sep));
  if (existingRawFiles.length === 0) {
    return recovered;
  }

  const watermarkCandidates = existingRawFiles.filter((rawFile) => fs.existsSync(rawFile));
  if (watermarkCandidates.length === 0) {
    return recovered;
  }

  for (let itemIndex = 0; itemIndex < watermarkCandidates.length; itemIndex += 1) {
    const rawImageFile = watermarkCandidates[itemIndex];
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
    imageIndex += 1;
  }

  return recovered;
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

function readMainImageReuseIdentity(taskDir: string): MainImageReuseIdentity | undefined {
  const identityFile = path.join(taskDir, MAIN_IMAGE_REUSE_IDENTITY_FILE);
  if (!fs.existsSync(identityFile)) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(identityFile, "utf8")) as MainImageReuseIdentity;
    return {
      ...parsed,
      sourceImagePath: normalizeIdentityPath(parsed.sourceImagePath)
    };
  } catch {
    return undefined;
  }
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

function listTaskDirs(runtimeRootDir: string): string[] {
  if (!fs.existsSync(runtimeRootDir)) {
    return [];
  }
  return fs
    .readdirSync(runtimeRootDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const tasksDir = path.join(runtimeRootDir, entry.name, "tasks");
      if (!fs.existsSync(tasksDir)) {
        return [];
      }
      return fs
        .readdirSync(tasksDir, { withFileTypes: true })
        .filter((taskEntry) => taskEntry.isDirectory())
        .map((taskEntry) => path.join(tasksDir, taskEntry.name));
    });
}

function readStateTaskIdentity(taskDir: string): MainImageReuseIdentity | undefined {
  const runDir = path.dirname(path.dirname(taskDir));
  const taskId = path.basename(taskDir);
  const stateFile = path.join(runDir, "state.json");
  if (!fs.existsSync(stateFile)) {
    return undefined;
  }
  try {
    const state = JSON.parse(fs.readFileSync(stateFile, "utf8")) as {
      tasks?: Array<{
        taskId?: string;
        sourceImagePath?: string;
        sourceImageName?: string;
        feishuProductRecord?: { recordId?: string };
      }>;
    };
    const task = (state.tasks || []).find((item) => item.taskId === taskId);
    if (!task?.sourceImagePath) {
      return undefined;
    }
    return {
      sourceImagePath: normalizeIdentityPath(task.sourceImagePath),
      sourceImageName: task.sourceImageName,
      feishuRecordId: task.feishuProductRecord?.recordId
    };
  } catch {
    return undefined;
  }
}

function taskIdentityMatches(candidate: MainImageReuseIdentity | undefined, target: MainImageReuseIdentity): boolean {
  if (!candidate) {
    return false;
  }
  if (target.sourceImagePath && candidate.sourceImagePath === target.sourceImagePath) {
    return true;
  }
  return Boolean(target.feishuRecordId && candidate.feishuRecordId === target.feishuRecordId);
}

function listRoundRawFiles(taskDir: string, roundName: string): string[] {
  const rawDir = path.join(taskDir, roundName, "openai-compatible", "raw");
  if (!fs.existsSync(rawDir)) {
    return [];
  }
  return fs
    .readdirSync(rawDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^generated-\d+.*\.(png|jpg|jpeg|webp)$/i.test(entry.name))
    .map((entry) => path.join(rawDir, entry.name))
    .sort((a, b) => a.localeCompare(b, "zh-CN"));
}

function listRoundNames(taskDir: string): string[] {
  if (!fs.existsSync(taskDir)) {
    return [];
  }
  return fs
    .readdirSync(taskDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^main-image-\d+$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, "zh-CN"));
}

function countDirectReusableRawImages(taskDir: string): number {
  return listRoundNames(taskDir).reduce((count, roundName) => count + listRoundRawFiles(taskDir, roundName).length, 0);
}

function copyMissingReusableRawImages(sourceTaskDir: string, targetTaskDir: string): number {
  let copied = 0;
  for (const roundName of listRoundNames(sourceTaskDir)) {
    const sourceFiles = listRoundRawFiles(sourceTaskDir, roundName);
    if (sourceFiles.length === 0) {
      continue;
    }
    const targetRawDir = path.join(targetTaskDir, roundName, "openai-compatible", "raw");
    const targetFiles = listRoundRawFiles(targetTaskDir, roundName);
    if (targetFiles.length >= sourceFiles.length) {
      continue;
    }
    fs.mkdirSync(targetRawDir, { recursive: true });
    for (let index = targetFiles.length; index < sourceFiles.length; index += 1) {
      const targetFile = path.join(targetRawDir, path.basename(sourceFiles[index]));
      if (fs.existsSync(targetFile)) {
        continue;
      }
      fs.copyFileSync(sourceFiles[index], targetFile);
      copied += 1;
    }
  }
  return copied;
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

  const runtimeRootDir = path.dirname(options.runtimeDir);
  const candidates = listTaskDirs(runtimeRootDir)
    .filter((taskDir) => path.resolve(taskDir) !== path.resolve(targetTaskDir))
    .map((taskDir) => ({
      taskDir,
      identity: readMainImageReuseIdentity(taskDir) || readStateTaskIdentity(taskDir),
      rawCount: countDirectReusableRawImages(taskDir)
    }))
    .filter((candidate) => candidate.rawCount > countDirectReusableRawImages(targetTaskDir))
    .filter((candidate) => taskIdentityMatches(candidate.identity, targetIdentity))
    .sort((a, b) => b.rawCount - a.rawCount);

  for (const candidate of candidates) {
    const copiedRawImageCount = copyMissingReusableRawImages(candidate.taskDir, targetTaskDir);
    if (copiedRawImageCount > 0) {
      return { copiedRawImageCount, sourceTaskDir: candidate.taskDir };
    }
  }

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
      startImageIndex: imageIndex
    });

    for (const recovered of recoveredFiles) {
      const assignment = assignments[recovered.imageIndex - 1];
      const shop = assignment ? shopMap.get(assignment.shopCode) : undefined;
      if (!shop) {
        throw new Error(`Recovered main image assignment missing shop folder for image ${recovered.imageIndex}.`);
      }
      stagedFiles.push({
        stagedFile: recovered.stagedFile,
        rawImageFile: recovered.rawImageFile,
        shopFolder: shop.shopFolder,
        promptIndex: promptIndex + 1,
        promptWordFile,
        imageIndex: recovered.imageIndex
      });
      imageIndex = recovered.imageIndex + 1;
    }

    const remainingImageCount =
      options.mainImageCountStrategy === "accept_all" && recoveredFiles.length > 0
        ? 0
        : Math.max(0, options.mainImageExpectedCount - recoveredFiles.length);

    if (
      options.mainImageCountStrategy !== "accept_all" &&
      recoveredFiles.length >= options.mainImageExpectedCount
    ) {
      continue;
    }
    if (remainingImageCount === 0) {
      continue;
    }

    options.onProgress?.(`Prompt ${promptIndex + 1}/${promptCount}: generating ${remainingImageCount} image(s).`);
    const generationResults = await generateWithOpenAiCompatibleProvider({
      configFile: options.imageGenerationConfigFile,
      promptText,
      sourceImagePath: options.sourceImagePath,
      sourceImageReferenceUrl: options.sourceImageReferenceUrl,
      downloadDir: path.join(roundDir, "openai-compatible", "raw"),
      expectedImageCount: remainingImageCount,
      onProgress: (message) => options.onProgress?.(`Prompt ${promptIndex + 1}/${promptCount}: ${message}`)
    });

    const watermarkedFiles: string[] = [];
    for (let itemIndex = 0; itemIndex < generationResults.length; itemIndex += 1) {
      const assignedImageIndex = imageIndex + itemIndex;
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

      stagedFiles.push({
        stagedFile,
        rawImageFile: rawFile,
        shopFolder: shop.shopFolder,
        promptIndex: promptIndex + 1,
        promptWordFile,
        submitId: generationResults[itemIndex]?.submitId,
        imageIndex
      });
      imageIndex += 1;
    }
    options.onProgress?.(`Prompt ${promptIndex + 1}/${promptCount}: staged ${watermarkedFiles.length} image(s).`);
  }

  return {
    promptFile,
    generatedFiles: finalizeProductFolders(stagedFiles, productName),
    simulated: false
  };
}

export const generateJimengAssets = generateMainImageAssets;
