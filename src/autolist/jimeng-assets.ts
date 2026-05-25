import fs from "node:fs";
import path from "node:path";
import { sanitizeFileName } from "../doubao/paths.js";
import { assertNoGptPlusWebUrl } from "../utils/gpt-plus-guard.js";
import { readSimpleWordDocument } from "./docx-lite.js";
import {
  resolveImageDownloadTimeoutMs,
  resolveImageGenerationTransportRetryPolicy,
  shouldRetryImageGenerationWithPolicyPrompt
} from "./image-generation-rules.js";
import { applyLocalWatermark } from "./local-watermark.js";
import { shopCodeFromFolder } from "./product-category.js";
import { buildMainImageEditInstruction } from "./rule-text.js";
import type { ImageGenerationProvider, MainImageArtifact, MainImageCountStrategy, MainImageGeneratedFile } from "./types.js";

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

interface OpenAiCompatibleImageConfig {
  provider?: "openai-compatible";
  apiUrl: string;
  apiKey?: string;
  model: string;
  mode?: "generations" | "edits";
  size?: string;
  responseFormat?: "b64_json" | "url";
  timeoutMs?: number;
  maxTransientRetries?: number;
  requestExtra?: Record<string, unknown>;
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
    if (key === "url" && typeof nestedValue === "string") {
      redacted[key] = "[redacted generated image url]";
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

  return [
    "【产品海报设计】请基于输入参考图制作传统电商海报。产品主体必须直接来自输入参考图，保持包装盒和管体的数量、形状、颜色、角度关系、主要标识和可见文字，不要根据文字重新绘制产品，也不要减少参考图中的任何产品主体。",
    "海报文字只展示：主标题\"" + userCognitionName + "\"，副标题\"" + genericName + "\"，以及以下中性信息点：" + visualBadges + "。不要展示解释性词汇、约束性词汇、注册号、备案号、批文号或规则说明。",
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
      throw new Error("Shop folder not found for code " + spec.shopCode);
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
    IMAGE_EDIT_OUTPUT_GUARDRAIL,
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

async function generateWithOpenAiCompatibleProvider(options: {
  configFile: string;
  promptText: string;
  sourceImagePath: string;
  downloadDir: string;
  expectedImageCount: number;
  onProgress?: (message: string) => void;
}): Promise<Array<{ file: string; submitId: string }>> {
  fs.mkdirSync(options.downloadDir, { recursive: true });

  const config = readOpenAiCompatibleImageConfig(options.configFile);
  const mode = config.mode || (config.apiUrl.includes("/images/edits") ? "edits" : "generations");
  const count = Math.max(1, options.expectedImageCount || 1);
  const imageIndexOffset = generatedImageIndexOffset(options.downloadDir);
  const responseFormat = config.responseFormat || "b64_json";
  const timeoutMs = Math.max(30000, config.timeoutMs || 180000);
  const maxTransientRetries = Math.max(0, config.maxTransientRetries ?? 3);
  const transportRetryPolicy = resolveImageGenerationTransportRetryPolicy(config.maxTransientRetries);
  const sendRequest = async (requestBody: BodyInit, contentType?: string): Promise<{ response: Response; text: string }> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
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
    } catch (error) {
      throw normalizeImageGenerationError(error instanceof Error ? error.message : String(error));
    } finally {
      clearTimeout(timer);
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
            size: config.size || "1024x1024",
            response_format: responseFormat,
            image: path.basename(options.sourceImagePath),
            imagePath: options.sourceImagePath,
            requestExtra: redactImageGenerationLogValue(config.requestExtra || {})
          }
        : (redactImageGenerationLogValue(buildGenerationJsonBody(currentPromptText)) as Record<string, unknown>);
    const requestSummary = buildRequestSummary(promptText);
    writeImageGenerationJsonLog(requestFile, requestSummary);

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
    for (let attempt = 1; !response.ok && isTransientImageProviderStatus(response.status) && attempt <= maxTransientRetries; attempt += 1) {
      writeImageGenerationTextLog(
        path.join(options.downloadDir, "response-" + String(imageIndex).padStart(2, "0") + "-transient-" + attempt + ".json"),
        text
      );
      options.onProgress?.(`Image ${imageIndex}: transient HTTP ${response.status}; retry ${attempt}/${maxTransientRetries}.`);
      await sleep(3000 * attempt);
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
}): MainImageGeneratedFile[] {
  const generatedFiles: MainImageGeneratedFile[] = [];
  let imageIndex = 1;

  for (let promptIndex = 0; promptIndex < options.promptFiles.length; promptIndex += 1) {
    const shopFolder = options.shopFolders[promptIndex].shopFolder;
    for (let itemIndex = 0; itemIndex < options.expectedImageCount; itemIndex += 1) {
      const productFolder = path.join(
        options.taskDir,
        "simulated-shops",
        sanitizeFileName(path.basename(shopFolder)),
        sanitizeFileName(options.brandedGenericName + "水印" + String(imageIndex).padStart(2, "0"))
      );
      fs.mkdirSync(productFolder, { recursive: true });
      const imageFile = path.join(
        productFolder,
        path.basename(buildStagedImageFile(productFolder, options.brandedGenericName, options.shopFolders[promptIndex].watermarkText, imageIndex, options.sourceImagePath))
      );
      fs.copyFileSync(options.sourceImagePath, imageFile);
      generatedFiles.push({
        imageFile,
        rawImageFile: options.sourceImagePath,
        shopFolder,
        productFolder,
        storeName: path.basename(shopFolder),
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
  sellingPointText: string;
  brandedGenericName: string;
  wordFiles: string[];
  imageGenerationProvider: ImageGenerationProvider;
  imageGenerationConfigFile: string;
  mainImageExpectedCount: number;
  mainImageCountStrategy: MainImageCountStrategy;
  promptCount?: number;
  shopCodes?: string[];
  simulateOnly: boolean;
  onProgress?: (message: string) => void;
}): Promise<MainImageArtifact> {
  const taskDir = ensureTaskDir(options.runtimeDir, options.taskId);
  const promptFile = writePromptSummary(taskDir, options.wordFiles);
  const shopFolders = filterShopFoldersByCodes(resolveShopFolders(options.shopRootDir), options.shopCodes);
  const promptCount = options.promptCount || 5;
  if (options.wordFiles.length < promptCount) {
    throw new Error("Main image generation requires " + promptCount + " Word prompt file(s), got " + options.wordFiles.length + ".");
  }
  if (shopFolders.length < promptCount) {
    throw new Error("Main image generation requires " + promptCount + " shop folder(s), got " + shopFolders.length + ".");
  }
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
        expectedImageCount: options.mainImageExpectedCount
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

    const { shopFolder, watermarkText } = shopFolders[promptIndex];
    const roundDir = path.join(taskDir, "main-image-" + String(promptIndex + 1).padStart(2, "0"));
    const stageDir = path.join(taskDir, "staged", String(promptIndex + 1).padStart(2, "0"));
    const watermarkOutputDir = path.join(roundDir, "watermark");
    fs.mkdirSync(roundDir, { recursive: true });
    fs.writeFileSync(path.join(roundDir, "image2-prompt.txt"), promptText + "\n", "utf8");

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
      downloadDir: path.join(roundDir, "openai-compatible", "raw"),
      expectedImageCount: remainingImageCount,
      onProgress: (message) => options.onProgress?.(`Prompt ${promptIndex + 1}/${promptCount}: ${message}`)
    });

    const watermarkedFiles = await applyLocalWatermark({
      inputFiles: generationResults.map((item) => item.file),
      outputDir: watermarkOutputDir,
      watermarkText
    });

    if (watermarkedFiles.length === 0) {
      throw new Error("No watermarked files were saved for prompt " + (promptIndex + 1) + ".");
    }

    for (let itemIndex = 0; itemIndex < watermarkedFiles.length; itemIndex += 1) {
      const rawFile = generationResults[itemIndex]?.file;
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
