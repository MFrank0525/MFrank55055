import fs from "node:fs";
import path from "node:path";
import { sanitizeFileName } from "../utils/path-names.js";
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
  resolveVideosBase64AcceptedTaskPollCeilingMs,
  resolveImageGenerationHttpRetryPolicy,
  resolveImageGenerationTransportRetryPolicy,
  providerExplicitlyProvesNoPaidTaskAccepted,
  isUnsafePaidImageReplayPayload,
  isUnsafePaidImageReplayReason,
  submitTransportFailureProvesNoPaidTaskAccepted,
  shouldRetryImageGenerationWithPolicyPrompt,
  shouldKeepPaidImagePolicyCompatiblePrompt,
  resolvePaidImageFixedSlotRecovery
} from "./image-generation-rules.js";
import { applyLocalWatermark } from "./local-watermark.js";
import { readManualTextBlock } from "./operation-manual.js";
import {
  initializePaidImageProductLedger,
  paidImageProductLedgerDir,
  recordPaidImageAmbiguous,
  recordPaidImageCompleted,
  recordPaidImageFailedAfterAcceptance,
  recordPaidImageFailedBeforeAcceptance,
  recordPaidImageSubmitted,
  reservePaidImageSlot,
  resolvePaidImageSlotAction,
  sha256File,
  sha256Text,
  summarizePaidImageProductLedger
} from "./paid-image-submission-ledger.js";
import { getShopSpecs, resolveMainImageShopAssignments, shopCodeFromFolder } from "./product-category.js";
import type { ImageGenerationProvider, MainImageArtifact, MainImageCountStrategy, MainImageGeneratedFile } from "./types.js";
import { requireOpenAiCompatibleImageProvider } from "./image-generation-provider.js";

interface OpenAiCompatibleImageConfig {
  provider: "openai-compatible";
  apiUrl: string;
  apiKey?: string;
  model: string;
  mode?: "videos-base64";
  size?: string;
  timeoutMs?: number;
  submitTimeoutMs?: number;
  submitConcurrency?: number;
  maxTransientRetries?: number;
  requestExtra?: Record<string, unknown>;
  videoMetadata?: Record<string, unknown>;
  pollIntervalMs?: number;
  maxPollMs?: number;
  acceptedQueueStaleMs?: number;
}

interface ConcurrencyGate {
  run<T>(work: () => Promise<T>): Promise<T>;
}

export interface VideosBase64PaidResumePlan {
  requestedSlots: number[];
  submitSlots: number[];
  reuseSlots: number[];
  pollSlots: number[];
  blockedSlots: number[];
}

export function shouldAllowPaidImagePolicyCompatibilityIdentityTransition(input: {
  recordedRequestDigest: string;
  recordedPromptDigest: string;
  originalRequestDigest: string;
  originalPromptDigest: string;
}): boolean {
  return Boolean(
    input.recordedRequestDigest &&
      input.recordedPromptDigest &&
      input.originalRequestDigest &&
      input.originalPromptDigest &&
      input.recordedRequestDigest === input.originalRequestDigest &&
      input.recordedPromptDigest === input.originalPromptDigest
  );
}

export function resolveLatestSubmittedPaidImageAuditTimestampMs(
  audit: Array<{ state?: string; at?: string }>,
  fallbackMs: number = Date.now()
): number {
  const submittedTimestamps = audit
    .filter((entry) => entry.state === "submitted")
    .map((entry) => Date.parse(entry.at || ""))
    .filter((timestamp) => Number.isFinite(timestamp));
  return submittedTimestamps.length > 0 ? Math.max(...submittedTimestamps) : fallbackMs;
}

export async function observeVideosBase64AcceptedTask<T>(input: {
  resumed: boolean;
  pollIntervalMs: number;
  submittedAtMs: number;
  ceilingMs: number;
  sleep: (ms: number) => Promise<unknown>;
  query: (pollNo: number) => Promise<T>;
  now: () => number;
  succeeded: (payload: T) => boolean;
  failed: (payload: T) => boolean;
}): Promise<{ kind: "success" | "failure" | "stale"; payload: T; pollNo: number }> {
  if (!Number.isFinite(input.pollIntervalMs) || input.pollIntervalMs <= 0) {
    throw new Error("videos-base64 poll interval must be positive finite");
  }
  if (!Number.isFinite(input.ceilingMs) || input.ceilingMs <= 0) {
    throw new Error("videos-base64 accepted-task ceiling must be positive finite");
  }
  if (!Number.isFinite(input.submittedAtMs)) {
    throw new Error("videos-base64 submittedAt must be finite");
  }
  if (!Number.isFinite(input.now())) {
    throw new Error("videos-base64 now value must be finite");
  }
  for (let pollNo = 1; ; pollNo += 1) {
    if (!input.resumed || pollNo > 1) {
      await input.sleep(input.pollIntervalMs);
    }
    const payload = await input.query(pollNo);
    if (input.succeeded(payload)) {
      return { kind: "success", payload, pollNo };
    }
    if (input.failed(payload)) {
      return { kind: "failure", payload, pollNo };
    }
    const nowMs = input.now();
    if (!Number.isFinite(nowMs)) {
      throw new Error("videos-base64 now value must be finite");
    }
    if (nowMs - input.submittedAtMs >= input.ceilingMs) {
      return { kind: "stale", payload, pollNo };
    }
  }
}

function formatSlotList(slots: number[]): string {
  return slots.length ? slots.join(",") : "none";
}

export function summarizeVideosBase64PaidResumePlan(
  productDir: string | undefined,
  requestedSlots: number[]
): VideosBase64PaidResumePlan {
  const plan: VideosBase64PaidResumePlan = {
    requestedSlots: [...requestedSlots],
    submitSlots: [],
    reuseSlots: [],
    pollSlots: [],
    blockedSlots: []
  };
  if (!productDir || !fs.existsSync(productDir)) {
    plan.submitSlots.push(...requestedSlots);
    return plan;
  }
  for (const slot of requestedSlots) {
    const action = resolvePaidImageSlotAction({ productDir, slot }).action;
    if (
      action === "submit" ||
      action === "missing" ||
      action === "retry_failed_before_acceptance" ||
      action === "retry_failed_after_acceptance"
    ) {
      plan.submitSlots.push(slot);
    } else if (action === "reuse") {
      plan.reuseSlots.push(slot);
    } else if (action === "poll") {
      plan.pollSlots.push(slot);
    } else {
      plan.blockedSlots.push(slot);
    }
  }
  return plan;
}

function redactImageGenerationLogValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactImageGenerationLogValue(item));
  }
  if (typeof value === "string" && /^data:image\/[^;]+;base64,/i.test(value)) {
    return "[redacted base64 image data url]";
  }
  if (typeof value === "string") {
    return redactImageGenerationLogText(value);
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

function ensureTaskDir(runtimeDir: string, taskId: string): string {
  const taskDir = path.join(runtimeDir, "tasks", sanitizeFileName(taskId));
  fs.mkdirSync(taskDir, { recursive: true });
  return taskDir;
}

function writePromptSummary(taskDir: string, promptFiles: string[]): string {
  const promptFile = path.join(taskDir, "main-image-prompts.txt");
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
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504 ||
    status === 520 || status === 521 || status === 522 || status === 523 || status === 524;
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

function buildPolicyCompatibleImageEditPrompt(promptText: string, _imageIndex: number): string {
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
    .replaceAll("{{差异化要求}}", "");
}

function isPolicyCompatibleRetryFailureReason(reason: string): boolean {
  return /content[_ -]?policy|policy[_ -]?violation|safety|unsafe|moderation|violat|违规|安全策略|内容策略/i.test(reason);
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

export function buildImageEditPromptFromWord(options: {
  paragraphs: string[];
  promptWordFile: string;
}): string {
  const cleaned = options.paragraphs.map((item) => item.trim()).filter(Boolean);
  if (cleaned.length !== 5) {
    throw new Error("Prompt Word file must contain exactly 5 paragraphs (main instruction, selling points, DeepSeek prompt, positive prompt, negative prompt): " + options.promptWordFile);
  }
  if (cleaned.some((item) => !item)) {
    throw new Error("Prompt Word file had empty required paragraph: " + options.promptWordFile);
  }
  return cleaned.join("\n");
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
  requireOpenAiCompatibleImageProvider(parsed.provider, `Image generation config in ${resolved}`);
  resolveOpenAiCompatibleImageMode(parsed.mode, parsed.apiUrl);
  if (parsed.model !== "gpt-image-2") {
    throw new Error("OpenAI-compatible image generation model must be gpt-image-2: " + resolved);
  }
  return {
    ...parsed,
    apiKey
  };
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

function formatProviderFailureReason(value: unknown): string {
  if (value === undefined || value === null) {
    return "unknown error";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(redactImageGenerationLogValue(value)).slice(0, 500);
  } catch {
    return String(value);
  }
}

export function formatVideosBase64ProviderFailureReason(payload: any): string {
  const nested = payload?.data;
  const nestedError = payload?.error ?? nested?.error;
  const errorObject = nestedError && typeof nestedError === "object" ? nestedError : undefined;
  const evidence = Object.fromEntries(
    Object.entries({
      code: payload?.code ?? nested?.code ?? errorObject?.code,
      message: payload?.message ?? nested?.message ?? errorObject?.message,
      error: nestedError
    }).filter(([, value]) => value !== undefined && value !== null && value !== "")
  );
  return Object.keys(evidence).length > 0 ? formatProviderFailureReason(evidence) : "unknown error";
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

async function generateWithOpenAiCompatibleProvider(options: {
  configFile: string;
  promptText: string;
  sourceImagePath: string;
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
  const timeoutMs = Math.max(30000, config.timeoutMs || 180000);
  const videosBase64SubmitTimeoutMs = resolveVideosBase64SubmitTimeoutMs(config.submitTimeoutMs || timeoutMs, config.maxPollMs);
  const submitGate =
    options.videosBase64SubmitGate || createConcurrencyGate(resolveVideosBase64SubmitConcurrency(config.submitConcurrency));
  const transportRetryPolicy = resolveImageGenerationTransportRetryPolicy(config.maxTransientRetries);
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
    options.paidImageLedger
      ? initializePaidImageProductLedger({
          rootDir: options.paidImageLedger.rootDir,
          batchFingerprint: options.paidImageLedger.batchFingerprint,
          recordId: options.paidImageLedger.recordId,
          expectedSlotCount: options.paidImageLedger.expectedSlotCount,
          providerIdentity: sha256Text(
            JSON.stringify({
              apiUrl: config.apiUrl,
              statusUrl: "",
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

  const sendVideosBase64SubmitWithTransientRetries = async (
    imageIndex: number,
    requestBody: string
  ): Promise<{ response: Response; text: string }> => {
    for (let attempt = 0; ; attempt += 1) {
      const result = await sendRequest(requestBody, "application/json", videosBase64SubmitTimeoutMs);
      if (!isTransientImageProviderStatus(result.response.status)) {
        return result;
      }
      const retryPolicy = resolveImageGenerationHttpRetryPolicy({
        status: result.response.status,
        responseText: result.text,
        configuredMaxRetries: config.maxTransientRetries
      });
      if (attempt >= retryPolicy.maxRetries) {
        return result;
      }
      const retryNo = attempt + 1;
      const nextDelayMs = retryPolicy.delayMs[attempt] || retryPolicy.delayMs.at(-1) || 45000;
      writeImageGenerationJsonLog(
        path.join(options.downloadDir, `response-${String(imageIndex).padStart(2, "0")}-videos-submit-transient-${retryNo}.json`),
        {
          label: "videos-base64-submit",
          status: result.response.status,
          reason: retryPolicy.reason,
          retryNo,
          maxTransientRetries: retryPolicy.maxRetries,
          responseText: result.text.slice(0, 1000),
          nextDelayMs
        }
      );
      options.onProgress?.(
        `Image ${imageIndex}: transient HTTP ${result.response.status} during videos-base64 submit; retry ${retryNo}/${retryPolicy.maxRetries}.`
      );
      await sleep(nextDelayMs);
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

  const buildPromptForImageIndex = (_imageIndex: number): string => options.promptText;

  const generateVideosBase64ImageAttempt = async (absoluteImageIndex: number): Promise<{ file: string; submitId: string }> => {
    const paddedImageIndex = String(absoluteImageIndex).padStart(2, "0");
    const ledgerSlot = (options.paidImageLedger?.slotOffset || 0) + absoluteImageIndex;
    let promptText = buildPromptForImageIndex(absoluteImageIndex);
    let requestBody = JSON.stringify(buildVideosBase64JsonBody(promptText));
    let requestDigest = sha256Text(requestBody);
    let promptDigest = sha256Text(promptText);
    const originalRequestDigest = requestDigest;
    const originalPromptDigest = promptDigest;
    const policyCompatiblePromptText = buildPolicyCompatibleImageEditPrompt(promptText, absoluteImageIndex);
    const policyCompatiblePromptDigest = sha256Text(policyCompatiblePromptText);
    const rebuildVideosBase64Request = (): void => {
      requestBody = JSON.stringify(buildVideosBase64JsonBody(promptText));
      requestDigest = sha256Text(requestBody);
      promptDigest = sha256Text(promptText);
    };
    const requestFile = path.join(options.downloadDir, "request-" + paddedImageIndex + ".json");
    const responseFile = path.join(options.downloadDir, "response-" + paddedImageIndex + ".json");
    const targetFile = path.join(options.downloadDir, "generated-" + paddedImageIndex + ".png");

    let submitPayload: any | undefined;
    let taskId = "";
    let acceptedTaskStartedAt: number | undefined;
    let queryPersistedTaskImmediately = false;
    let allowExistingSubmittedTaskImport = true;
    if (videosBase64Ledger) {
      let slotAction = resolvePaidImageSlotAction({
        productDir: videosBase64Ledger.productDir,
        slot: ledgerSlot
      });
      if (
        slotAction.action === "missing" ||
        slotAction.action === "retry_failed_before_acceptance" ||
        slotAction.action === "retry_failed_after_acceptance"
      ) {
        const failedRetryReason =
          slotAction.action !== "missing" && "record" in slotAction
            ? (slotAction.record?.reason || "")
            : "";
        const persistedNonReplayable =
          slotAction.action !== "missing" &&
          "record" in slotAction &&
          slotAction.record?.replayDisposition === "non_replayable";
        if (
          slotAction.action !== "missing" &&
          (persistedNonReplayable || isUnsafePaidImageReplayReason(failedRetryReason))
        ) {
          throw normalizeImageGenerationError(
            `paid image slot ${ledgerSlot} is not safe to replay: ${failedRetryReason || "unknown retry failure"}`
          );
        }
        const failedAfterAcceptanceReason =
          slotAction.action === "retry_failed_after_acceptance" && "record" in slotAction
            ? (slotAction.record?.reason || "")
            : "";
        const fixedSlotRecovery =
          slotAction.action === "retry_failed_after_acceptance" && "record" in slotAction
            ? resolvePaidImageFixedSlotRecovery({
                failureReason: failedAfterAcceptanceReason,
                audit: slotAction.record?.audit || [],
                recordedPromptDigest: slotAction.record?.promptDigest || "",
                policyCompatiblePromptDigest,
                nowMs: Date.now()
              })
            : { action: "bubble" as const, usePolicyCompatiblePrompt: false, deferMs: 0 };
        if (fixedSlotRecovery.action === "defer_to_supervisor") {
          throw normalizeImageGenerationError(
            `paid image provider timeout circuit open for slot ${ledgerSlot}; retry after ${fixedSlotRecovery.deferMs}ms.`
          );
        }
        const keepPolicyCompatiblePrompt =
          slotAction.action === "retry_failed_after_acceptance" &&
          "record" in slotAction &&
          (fixedSlotRecovery.usePolicyCompatiblePrompt ||
            shouldKeepPaidImagePolicyCompatiblePrompt({
              failureReason: failedAfterAcceptanceReason,
              recordedPromptDigest: slotAction.record?.promptDigest || "",
              originalPromptDigest,
              policyCompatiblePromptDigest
            }));
        const allowFailedAfterAcceptanceDigestChange =
          slotAction.action === "retry_failed_after_acceptance" &&
          (fixedSlotRecovery.usePolicyCompatiblePrompt ||
            isPolicyCompatibleRetryFailureReason(failedAfterAcceptanceReason)) &&
          shouldAllowPaidImagePolicyCompatibilityIdentityTransition({
            recordedRequestDigest: slotAction.record?.requestDigest || "",
            recordedPromptDigest: slotAction.record?.promptDigest || "",
            originalRequestDigest,
            originalPromptDigest
          }) &&
          slotAction.record?.promptDigest !== policyCompatiblePromptDigest;
        if (
          keepPolicyCompatiblePrompt
        ) {
          promptText = policyCompatiblePromptText;
          rebuildVideosBase64Request();
          writeImageGenerationJsonLog(
            path.join(options.downloadDir, "request-" + paddedImageIndex + "-policy-retry.json"),
            {
              endpoint: config.apiUrl,
              mode,
              ...JSON.parse(requestBody)
            }
          );
        }
        allowExistingSubmittedTaskImport =
          slotAction.action !== "retry_failed_before_acceptance" && slotAction.action !== "retry_failed_after_acceptance";
        slotAction = reservePaidImageSlot({
          productDir: videosBase64Ledger.productDir,
          slot: ledgerSlot,
          requestDigest,
          promptDigest,
          owner: options.paidImageLedger?.owner || { pid: process.pid },
          allowFailedAfterAcceptanceDigestChange
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
        acceptedTaskStartedAt = resolveLatestSubmittedPaidImageAuditTimestampMs(slotAction.record.audit);
        queryPersistedTaskImmediately = true;
        submitPayload = readVideosBase64SubmittedTask(responseFile) || { id: taskId };
        options.onProgress?.(`Image ${absoluteImageIndex}: resuming submitted videos-base64 task from paid image ledger.`);
      } else if (slotAction.action === "blocked_reserved" || slotAction.action === "blocked_ambiguous") {
        throw normalizeImageGenerationError(
          `videos-base64 paid image ledger blocked slot ${absoluteImageIndex}: ${slotAction.action}.`
        );
      } else {
        submitPayload = allowExistingSubmittedTaskImport ? readVideosBase64SubmittedTask(responseFile) : undefined;
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

    writeImageGenerationJsonLog(requestFile, {
      endpoint: config.apiUrl,
      mode,
      ...JSON.parse(requestBody)
    });

    if (!submitPayload) {
      options.onProgress?.(`Image ${absoluteImageIndex}: submitting videos-base64 request.`);
      let response: Response;
      let text = "";
      try {
        const result = await submitGate.run(() => sendVideosBase64SubmitWithTransientRetries(absoluteImageIndex, requestBody));
        response = result.response;
        text = result.text;
      } catch (error) {
        if (videosBase64Ledger) {
          const message = error instanceof Error ? error.message : String(error);
          const recordFailure = submitTransportFailureProvesNoPaidTaskAccepted(message)
            ? recordPaidImageFailedBeforeAcceptance
            : recordPaidImageAmbiguous;
          recordFailure({
            productDir: videosBase64Ledger.productDir,
            slot: ledgerSlot,
            reason: message,
            replayDisposition: isUnsafePaidImageReplayReason(message) ? "non_replayable" : undefined
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
          const rejectionReason = "HTTP " + response.status + ": " + (text || response.statusText);
          recordRejection({
            productDir: videosBase64Ledger.productDir,
            slot: ledgerSlot,
            reason: rejectionReason,
            replayDisposition: isUnsafePaidImageReplayReason(rejectionReason) ? "non_replayable" : undefined
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
    const maxPollMs = resolveVideosBase64AcceptedTaskPollCeilingMs(config.acceptedQueueStaleMs ?? config.maxPollMs);
    const pollIntervalMs = Math.min(maxPollMs, Math.max(1000, config.pollIntervalMs || 10000));
    const startedAt = acceptedTaskStartedAt ?? Date.now();
    const observation = await observeVideosBase64AcceptedTask<any>({
      resumed: queryPersistedTaskImmediately,
      pollIntervalMs,
      submittedAtMs: startedAt,
      ceilingMs: maxPollMs,
      sleep,
      now: Date.now,
      succeeded: videosBase64Succeeded,
      failed: videosBase64Failed,
      query: async (pollNo) => {
        const statusResponse = await fetchVideosBase64TaskWithTransportRetries(taskId, false, absoluteImageIndex, "status");
        const statusText = await statusResponse.text();
        writeImageGenerationTextLog(path.join(options.downloadDir, "response-" + paddedImageIndex + "-status-" + pollNo + ".json"), statusText);
        if (!statusResponse.ok) {
          throw normalizeImageGenerationError(
            "videos-base64 status failed with HTTP " + statusResponse.status + ": " + (statusText || statusResponse.statusText)
          );
        }
        let parsedStatusPayload: any;
        try {
          parsedStatusPayload = JSON.parse(statusText);
        } catch {
          throw new Error("videos-base64 status response was not JSON: " + statusText.slice(0, 500));
        }
        const status = parsedStatusPayload?.status ?? parsedStatusPayload?.data?.status ?? "pending";
        const progress = parsedStatusPayload?.progress ?? parsedStatusPayload?.data?.progress ?? "";
        options.onProgress?.(`Image ${absoluteImageIndex}: videos-base64 task ${taskId} status ${status} ${progress}.`.trim());
        return parsedStatusPayload;
      }
    });
    const statusPayload = observation.payload;
    if (observation.kind === "failure") {
      const replayDisposition = isUnsafePaidImageReplayPayload(statusPayload) ? "non_replayable" : undefined;
      const errorMessage = formatVideosBase64ProviderFailureReason(statusPayload);
      const failureReason = `provider task failed: ${errorMessage}`;
      if (videosBase64Ledger) {
        recordPaidImageFailedAfterAcceptance({
          productDir: videosBase64Ledger.productDir,
          slot: ledgerSlot,
          providerTaskId: taskId,
          reason: failureReason,
          providerResponse: statusPayload,
          replayDisposition
        });
      }
      throw normalizeImageGenerationError(`videos-base64 task ${taskId} failed: ${errorMessage}`);
    }
    if (observation.kind === "stale") {
      if (videosBase64Ledger) {
        recordPaidImageFailedAfterAcceptance({
          productDir: videosBase64Ledger.productDir,
          slot: ledgerSlot,
          providerTaskId: taskId,
          reason: `videos-base64 accepted task stayed queued/pending beyond ${maxPollMs}ms; retrying fixed slot ${ledgerSlot}.`,
          providerResponse: statusPayload
        });
      }
      throw normalizeImageGenerationError(`videos-base64 task ${taskId} timed out after ${maxPollMs}ms.`);
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
        providerTaskId: taskId,
        sourceFile: targetFile
      });
    }
    options.onProgress?.(`Image ${absoluteImageIndex}: saved ${path.basename(targetFile)}.`);
    return { file: targetFile, submitId: taskId };
  };

  const generateVideosBase64Image = async (absoluteImageIndex: number): Promise<{ file: string; submitId: string }> => {
    const ledgerSlot = (options.paidImageLedger?.slotOffset || 0) + absoluteImageIndex;
    for (;;) {
      try {
        return await generateVideosBase64ImageAttempt(absoluteImageIndex);
      } catch (error) {
        if (!videosBase64Ledger) {
          throw error;
        }
        const slotAction = resolvePaidImageSlotAction({
          productDir: videosBase64Ledger.productDir,
          slot: ledgerSlot
        });
        if (slotAction.action !== "retry_failed_after_acceptance" || !slotAction.record) {
          throw error;
        }
        const originalPromptText = buildPromptForImageIndex(absoluteImageIndex);
        const policyCompatiblePromptDigest = sha256Text(
          buildPolicyCompatibleImageEditPrompt(originalPromptText, absoluteImageIndex)
        );
        const recovery = resolvePaidImageFixedSlotRecovery({
          failureReason: slotAction.record.reason || "",
          audit: slotAction.record.audit || [],
          recordedPromptDigest: slotAction.record.promptDigest || "",
          policyCompatiblePromptDigest,
          nowMs: Date.now()
        });
        if (recovery.action === "defer_to_supervisor") {
          throw normalizeImageGenerationError(
            `paid image provider timeout circuit open for slot ${ledgerSlot}; retry after ${recovery.deferMs}ms.`
          );
        }
        if (recovery.action !== "retry_fixed_slot_now") {
          throw error;
        }
        options.onProgress?.(
          `Image ${absoluteImageIndex}: provider task timed out; retrying fixed paid slot ${ledgerSlot} in current run.`
        );
      }
    }
  };

  const videosBase64ImageIndexes =
    options.requestedImageIndexes?.length
      ? options.requestedImageIndexes
      : Array.from({ length: count }, (_, index) => imageIndexOffset + index + 1);
  return settleConcurrentWork(
    videosBase64ImageIndexes.map((absoluteImageIndex) => generateVideosBase64Image(absoluteImageIndex)),
    "videos-base64 paid image slots"
  );
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
    promptWordFile: options.promptWordFile
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

function buildProductFolder(shopFolder: string, productName: string, recordIdentity: string, imageIndex: number): string {
  return path.join(
    shopFolder,
    sanitizeFileName(`${productName}-${recordIdentity}-水印${String(imageIndex).padStart(2, "0")}`)
  );
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
  productName: string,
  recordIdentity: string
): MainImageGeneratedFile[] {
  const generatedFiles: MainImageGeneratedFile[] = [];

  for (const item of stagedFiles) {
    const productFolder = buildProductFolder(item.shopFolder, productName, recordIdentity, item.imageIndex);
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
  recordIdentity: string;
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
        sanitizeFileName(`${options.brandedGenericName}-${options.recordIdentity}-水印${String(imageIndex).padStart(2, "0")}`)
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
  archiveMainImageDir?: string;
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
        shopCodes,
        recordIdentity: options.feishuRecordId || options.taskId
      }),
      simulated: true
    };
  }

  requireOpenAiCompatibleImageProvider(options.imageGenerationProvider, "Main image generation");
  const imageGenerationConfig = readOpenAiCompatibleImageConfig(options.imageGenerationConfigFile);
  const videosBase64SubmitGate = createConcurrencyGate(
    resolveVideosBase64SubmitConcurrency(imageGenerationConfig.submitConcurrency)
  );
  if (!options.feishuBatchFingerprint || !options.feishuRecordId || !options.paidImageSubmissionLedgerDir) {
    throw new Error(
      "videos-base64 paid submission requires project-owned feishuBatchFingerprint, feishuRecordId, and paidImageSubmissionLedgerDir."
    );
  }
  const videosBase64ProductLedgerDir = paidImageProductLedgerDir(
    options.paidImageSubmissionLedgerDir,
    options.feishuBatchFingerprint,
    options.feishuRecordId
  );

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
      promptWordFile
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

    const requestedPaidSlots = missingLocalIndexes.map((localIndex) => promptIndex * options.mainImageExpectedCount + localIndex);
    const paidResumePlan = summarizeVideosBase64PaidResumePlan(videosBase64ProductLedgerDir, requestedPaidSlots);
    options.onProgress?.(
      paidResumePlan
        ? `Prompt ${promptIndex + 1}/${promptCount}: missing fixed slots=${formatSlotList(
            requestedPaidSlots
          )}; paid submit slots=${formatSlotList(paidResumePlan.submitSlots)}; reuse slots=${formatSlotList(
            paidResumePlan.reuseSlots
          )}; poll slots=${formatSlotList(paidResumePlan.pollSlots)}.`
        : `Prompt ${promptIndex + 1}/${promptCount}: generating ${remainingImageCount} image(s).`
    );
    const generationResults = await generateWithOpenAiCompatibleProvider({
      configFile: options.imageGenerationConfigFile,
      promptText,
      sourceImagePath: options.sourceImagePath,
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
  try {
    const concurrentRounds = await settleConcurrentWork(
      promptIndexes.map((promptIndex) => processPromptRound(promptIndex)),
      "videos-base64 prompt rounds"
    );
    stagedFiles.push(...concurrentRounds.flat());
  } catch (error) {
    const productDir = paidImageProductLedgerDir(
      options.paidImageSubmissionLedgerDir,
      options.feishuBatchFingerprint,
      options.feishuRecordId
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
  stagedFiles.sort((left, right) => left.imageIndex - right.imageIndex);

  return {
    promptFile,
    generatedFiles: finalizeProductFolders(stagedFiles, productName, options.feishuRecordId || options.taskId),
    simulated: false
  };
}
