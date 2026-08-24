import fs from "node:fs";
import path from "node:path";
import { sanitizeFileName } from "../utils/path-names.js";
import { assertNoGptPlusWebUrl } from "../utils/gpt-plus-guard.js";
import { readSimpleWordDocument } from "./docx-lite.js";
import {
  resolveImageDownloadTimeoutMs,
  resolveImageGenerationRequestDeadlineMs,
  resolveOpenAiCompatibleImageMode,
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
  resolvePaidImageFixedSlotRecovery,
  shouldFallbackToAuthenticatedTaskContent,
  shouldReplaceAcceptedPaidImageAfterResultDeliveryExhausted
} from "./image-generation-rules.js";
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
  resolvePaidImageProviderIdentityProofCandidate,
  resolvePaidImageSlotAction,
  rotatePaidImageProviderIdentityWithAuthenticatedTaskProof,
  sha256File,
  sha256Text
} from "./paid-image-submission-ledger.js";
import { getShopSpecs, shopCodeFromFolder } from "./product-category.js";
import { requireOpenAiCompatibleImageProvider } from "./image-generation-provider.js";
import { writeFullyValidatedImageAtomic } from "../utils/image-integrity.js";

export interface OpenAiCompatibleImageConfig {
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

export const MAIN_IMAGE_ASPECT_RATIO = "1:1";
export const MAIN_IMAGE_PROVIDER_SIZE = "1024x1024";
const MAIN_IMAGE_SQUARE_PROMPT_CONTRACT =
  "强制画幅约束：最终输出必须为严格的1:1正方形画布（宽度=高度）；不得输出3:4、4:3、2:3、3:2或其他非正方形画幅。完整商品与所有文字、装饰均须在正方形安全区内，不得依赖后续裁剪。";
const NON_SQUARE_MAIN_IMAGE_PROMPT_DIRECTIVE =
  /(?:3\s*[:：]\s*4|4\s*[:：]\s*3|2\s*[:：]\s*3|3\s*[:：]\s*2|9\s*[:：]\s*16|16\s*[:：]\s*9|竖版|竖屏|横版|横屏|portrait\s+(?:image|canvas|layout|orientation)|landscape\s+(?:image|canvas|layout|orientation))/iu;

export function assertSquareMainImageProviderConfig(config: {
  size?: string;
  videoMetadata?: Record<string, unknown>;
}): void {
  const configuredSize = config.size || MAIN_IMAGE_PROVIDER_SIZE;
  const metadataAspectRatio = config.videoMetadata?.aspect_ratio;
  const metadataSize = config.videoMetadata?.size;
  if (configuredSize !== MAIN_IMAGE_PROVIDER_SIZE) {
    throw new Error(
      `Main image generation size must be ${MAIN_IMAGE_PROVIDER_SIZE}; received ${configuredSize}.`
    );
  }
  if (metadataAspectRatio !== undefined && metadataAspectRatio !== MAIN_IMAGE_ASPECT_RATIO) {
    throw new Error(
      `Main image generation aspect_ratio must be ${MAIN_IMAGE_ASPECT_RATIO}; received ${String(metadataAspectRatio)}.`
    );
  }
  if (metadataSize !== undefined && metadataSize !== MAIN_IMAGE_PROVIDER_SIZE) {
    throw new Error(
      `Main image generation metadata.size must be ${MAIN_IMAGE_PROVIDER_SIZE}; received ${String(metadataSize)}.`
    );
  }
}

export interface ConcurrencyGate {
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

export function formatSlotList(slots: number[]): string {
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

export function redactImageGenerationLogValue(value: unknown): unknown {
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
    if (/api(?:[-_\s]?key)|authorization|bearer|secret|token|cookie/i.test(key)) {
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

export function writeImageGenerationJsonLog(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(redactImageGenerationLogValue(value), null, 2) + "\n", "utf8");
}

export function redactImageGenerationLogText(text: string): string {
  return text
    .replace(/(authorization|bearer|api(?:[-_\s]?key)|secret|token|cookie)(["'\s:=]+)([^"'\s,}]+)/gi, "$1$2[redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "[redacted api key]")
    .replace(/https?:\/\/[^\s"',}]+/gi, "[redacted url]");
}

export function sanitizeImageGenerationProviderErrorText(text: string, fallback: string): string {
  return redactImageGenerationLogText(text || fallback);
}

export function writeImageGenerationTextLog(filePath: string, text: string): void {
  try {
    writeImageGenerationJsonLog(filePath, JSON.parse(text));
  } catch {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, redactImageGenerationLogText(text) + "\n", "utf8");
  }
}

export function parseSellingPointFields(sellingPointText: string): {
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

export function ensureTaskDir(runtimeDir: string, taskId: string): string {
  const taskDir = path.join(runtimeDir, "tasks", sanitizeFileName(taskId));
  fs.mkdirSync(taskDir, { recursive: true });
  return taskDir;
}

export function writePromptSummary(taskDir: string, promptFiles: string[]): string {
  const promptFile = path.join(taskDir, "main-image-prompts.txt");
  fs.writeFileSync(promptFile, promptFiles.join("\n") + "\n", "utf8");
  return promptFile;
}

export function listImageFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs
    .readdirSync(dir)
    .filter((name) => /\.(png|jpg|jpeg|webp)$/i.test(name))
    .map((name) => path.join(dir, name))
    .sort((a, b) => a.localeCompare(b, "zh-CN"));
}

export function listImageFilesRecursive(dir: string): string[] {
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

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function generatedImageIndexOffset(dir: string): number {
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

export function isBillingError(message: string): boolean {
  return /余额|balance|quota|credit|insufficient|欠费|充值|billing/i.test(message);
}

export function normalizeImageGenerationError(message: string): Error {
  if (isBillingError(message)) {
    return new Error("Image generation balance appears insufficient. Please recharge the relay account. Raw error: " + message);
  }
  if (/abort|timeout|timed out/i.test(message)) {
    return new Error("Image generation request timed out. The provider did not respond in time. Raw error: " + message);
  }
  return new Error(message);
}

export function isContentPolicyError(message: string): boolean {
  return shouldRetryImageGenerationWithPolicyPrompt({
    responseOk: false,
    responseText: message
  });
}

export function isTransientImageProviderStatus(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504 ||
    status === 520 || status === 521 || status === 522 || status === 523 || status === 524;
}

export function isTransientImageProviderErrorMessage(message: string): boolean {
  if (isBillingError(message)) {
    return false;
  }
  return /fetch failed|network|socket|terminated|reset|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|UND_ERR|abort|timeout|timed out|full decode validation|image artifact.*decode|image file is truncated/i.test(message);
}

export async function settleConcurrentWork<T>(work: Array<Promise<T>>, label: string): Promise<T[]> {
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

export function createConcurrencyGate(maxConcurrent: number): ConcurrencyGate {
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

export function extractTitleLine(promptText: string, label: string): string {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(escapedLabel + "[：:]\\s*([^，,。\\n]+)");
  const match = promptText.match(pattern);
  return match?.[1]?.trim() || "";
}

export function buildPolicyCompatibleImageEditPrompt(promptText: string, _imageIndex: number): string {
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

export function isPolicyCompatibleRetryFailureReason(reason: string): boolean {
  return /content[_ -]?policy|policy[_ -]?violation|safety|unsafe|moderation|violat|违规|安全策略|内容策略/i.test(reason);
}

export function resolveShopFolders(shopRootDir: string): Array<{ shopFolder: string; watermarkText: string }> {
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

export function filterShopFoldersByCodes(
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

export function shopFolderByCode(shopFolders: Array<{ shopFolder: string; watermarkText: string }>): Map<string, { shopFolder: string; watermarkText: string }> {
  return new Map(shopFolders.map((item) => [shopCodeFromFolder(item.shopFolder), item]));
}

export function inferBrandedGenericName(brandedGenericName: string, sellingPointText: string): string {
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
  const conflictingDirective = cleaned.find((item) => NON_SQUARE_MAIN_IMAGE_PROMPT_DIRECTIVE.test(item));
  if (conflictingDirective) {
    throw new Error(
      `Main image prompt contains a non-square aspect directive and cannot be submitted: ${options.promptWordFile}.`
    );
  }
  return `${cleaned.join("\n")}\n\n${MAIN_IMAGE_SQUARE_PROMPT_CONTRACT}`;
}

export function readOpenAiCompatibleImageConfig(configFile: string): OpenAiCompatibleImageConfig {
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
  assertSquareMainImageProviderConfig(parsed);
  return {
    ...parsed,
    apiKey
  };
}

export async function downloadGeneratedImage(url: string, targetFile: string, apiKey: string, timeoutMs: number): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), resolveImageDownloadTimeoutMs(timeoutMs));
  try {
    const response = await fetch(url, {
      headers: url.includes("/v1/") ? { Authorization: "Bearer " + apiKey } : undefined,
      signal: controller.signal
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      const safeDownloadText = sanitizeImageGenerationProviderErrorText(text, response.statusText);
      throw normalizeImageGenerationError("Image download failed with HTTP " + response.status + ": " + safeDownloadText);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    writeFullyValidatedImageAtomic(targetFile, buffer);
  } catch (error) {
    const safeErrorText = sanitizeImageGenerationProviderErrorText(
      error instanceof Error ? error.message : String(error),
      "unknown download error"
    );
    throw normalizeImageGenerationError("Image download failed: " + safeErrorText);
  } finally {
    clearTimeout(timer);
  }
}

export function resolveVideosBase64TaskUrl(apiUrl: string, taskId: string, content = false): string {
  const url = new URL(apiUrl);
  url.pathname = url.pathname.replace(/\/+$/, "") + "/" + encodeURIComponent(taskId) + (content ? "/content" : "");
  url.search = "";
  return url.toString();
}

export function extractVideosBase64TaskId(payload: any): string {
  const taskId = payload?.id ?? payload?.task_id ?? payload?.data?.id ?? payload?.data?.task_id;
  if (taskId === undefined || taskId === null || String(taskId).trim() === "") {
    throw normalizeImageGenerationError(
      "videos-base64 response did not include task id: " + JSON.stringify(redactImageGenerationLogValue(payload)).slice(0, 500)
    );
  }
  return String(taskId);
}

export function videosBase64Succeeded(payload: any): boolean {
  return ["completed", "succeeded", "success"].includes(String(payload?.status ?? payload?.data?.status ?? "").toLowerCase());
}

export function videosBase64Failed(payload: any): boolean {
  return ["failed", "cancelled", "canceled"].includes(String(payload?.status ?? payload?.data?.status ?? "").toLowerCase());
}

export function formatProviderFailureReason(value: unknown): string {
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

export function extractVideosBase64ResultUrl(payload: any): string {
  const resultUrl =
    payload?.video_url ??
    payload?.url ??
    payload?.data?.video_url ??
    payload?.data?.url ??
    payload?.result_url ??
    payload?.data?.result_url;
  return typeof resultUrl === "string" ? resultUrl.trim() : "";
}

export function readVideosBase64SubmittedTask(responseFile: string): any | undefined {
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

export function getMimeTypeForImage(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  return "image/png";
}

export function sourceImageToDataUrl(sourceImagePath: string): string {
  if (!fs.existsSync(sourceImagePath)) {
    throw normalizeImageGenerationError("videos-base64 reference image not found: " + sourceImagePath);
  }
  const mimeType = getMimeTypeForImage(sourceImagePath);
  return `data:image/${mimeType.split("/")[1]};base64,${fs.readFileSync(sourceImagePath).toString("base64")}`;
}

export async function generateWithOpenAiCompatibleProvider(options: {
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
      aspect_ratio: MAIN_IMAGE_ASPECT_RATIO,
      size: MAIN_IMAGE_PROVIDER_SIZE,
      urls: [sourceImageToDataUrl(options.sourceImagePath)]
    }
  });

  const providerIdentity = sha256Text(
    JSON.stringify({
      apiUrl: config.apiUrl,
      credentialFingerprint: sha256Text(config.apiKey || ""),
      model: config.model,
      mode,
      size: MAIN_IMAGE_PROVIDER_SIZE,
      videoMetadata: config.videoMetadata || {},
      requestExtra: config.requestExtra || {}
    })
  );
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
  let videosBase64Ledger: ReturnType<typeof initializePaidImageProductLedger> | undefined;
  if (options.paidImageLedger) {
    const productDir = paidImageProductLedgerDir(
      options.paidImageLedger.rootDir,
      options.paidImageLedger.batchFingerprint,
      options.paidImageLedger.recordId
    );
    if (fs.existsSync(productDir)) {
      const proof = resolvePaidImageProviderIdentityProofCandidate(productDir);
      if (proof && proof.currentProviderIdentity !== providerIdentity) {
        const proofResponse = await fetchVideosBase64Task(proof.providerTaskId, false);
        if (!proofResponse.ok) {
          throw new Error(
            `Paid image provider credential identity changed and same-account proof failed with HTTP ${proofResponse.status}.`
          );
        }
        const proofPayload = await proofResponse.json().catch(() => undefined);
        const proofTaskId = proofPayload ? extractVideosBase64TaskId(proofPayload) : "";
        const proofStatus = String(proofPayload?.status ?? proofPayload?.data?.status ?? "").toLowerCase();
        const proofModel = String(proofPayload?.model ?? proofPayload?.data?.model ?? "");
        const proofSize = String(proofPayload?.size ?? proofPayload?.data?.size ?? "");
        if (
          proofTaskId !== proof.providerTaskId ||
          !["completed", "succeeded", "success"].includes(proofStatus) ||
          proofModel !== config.model ||
          proofSize !== MAIN_IMAGE_PROVIDER_SIZE
        ) {
          throw new Error("Paid image provider credential identity changed and authenticated task proof did not match the ledger contract.");
        }
        rotatePaidImageProviderIdentityWithAuthenticatedTaskProof({
          productDir,
          previousProviderIdentity: proof.currentProviderIdentity,
          nextProviderIdentity: providerIdentity,
          proofProviderTaskId: proof.providerTaskId,
          proofResultDigest: proof.resultDigest
        });
      }
    }
    videosBase64Ledger = initializePaidImageProductLedger({
      rootDir: options.paidImageLedger.rootDir,
      batchFingerprint: options.paidImageLedger.batchFingerprint,
      recordId: options.paidImageLedger.recordId,
      expectedSlotCount: options.paidImageLedger.expectedSlotCount,
      providerIdentity,
      sourceImageDigest: sha256File(options.sourceImagePath)
    });
  }

  const sendVideosBase64SubmitWithTransientRetries = async (
    imageIndex: number,
    requestBody: string
  ): Promise<{ response: Response; text: string }> => {
    for (let attempt = 0; ; attempt += 1) {
      const result = await sendRequest(requestBody, "application/json", videosBase64SubmitTimeoutMs);
      const retryPolicy = resolveImageGenerationHttpRetryPolicy({
        status: result.response.status,
        responseText: result.text,
        configuredMaxRetries: config.maxTransientRetries
      });
      if (
        !isTransientImageProviderStatus(result.response.status) &&
        retryPolicy.reason === "http_transient"
      ) {
        return result;
      }
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
        if (shouldFallbackToAuthenticatedTaskContent(message)) {
          throw error;
        }
        const transient =
          isTransientImageProviderErrorMessage(message) || /HTTP\s+(429|500|502|503|504)\b/i.test(message);
        if (!transient || attempt >= transportRetryPolicy.maxRetries) {
          throw error;
        }
        await waitBeforeVideosBase64ReadRetry(taskId, imageIndex, "result-download", attempt, message);
      }
    }
  };

  const downloadVideosBase64TaskContentOnce = async (
    taskId: string,
    targetFile: string,
    imageIndex: number
  ): Promise<void> => {
    const contentResponse = await fetchVideosBase64Task(taskId, true);
    if (!contentResponse.ok) {
      const contentError = await contentResponse.text().catch(() => "");
      const safeContentError = sanitizeImageGenerationProviderErrorText(contentError, contentResponse.statusText);
      throw normalizeImageGenerationError(
        "videos-base64 content download failed with HTTP " + contentResponse.status + ": " + safeContentError
      );
    }
    const contentType = contentResponse.headers.get("content-type") || "";
    if (contentType && !/^image\/|application\/octet-stream/i.test(contentType)) {
      throw normalizeImageGenerationError("videos-base64 content response was not an image: " + contentType);
    }
    writeFullyValidatedImageAtomic(targetFile, Buffer.from(await contentResponse.arrayBuffer()));
  };

  const downloadVideosBase64TaskContent = async (
    taskId: string,
    targetFile: string,
    imageIndex: number
  ): Promise<void> => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        await downloadVideosBase64TaskContentOnce(taskId, targetFile, imageIndex);
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const transient =
          isTransientImageProviderErrorMessage(message) || /HTTP\s+(429|500|502|503|504)\b/i.test(message);
        if (!transient || attempt >= transportRetryPolicy.maxRetries) {
          throw error;
        }
        await waitBeforeVideosBase64ReadRetry(taskId, imageIndex, "content-delivery", attempt, message);
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
        const definitiveNoAcceptanceWithLossyReason =
          slotAction.action === "retry_failed_before_acceptance" &&
          failedRetryReason.trim().toLowerCase() === "[redacted]";
        if (
          slotAction.action !== "missing" &&
          (persistedNonReplayable ||
            (!definitiveNoAcceptanceWithLossyReason && isUnsafePaidImageReplayReason(failedRetryReason)))
        ) {
          const safeFailedRetryReason = sanitizeImageGenerationProviderErrorText(
            failedRetryReason,
            "unknown retry failure"
          );
          throw normalizeImageGenerationError(
            `paid image slot ${ledgerSlot} is not safe to replay: ${safeFailedRetryReason}`
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
            `paid image provider circuit open for slot ${ledgerSlot}; retry after ${fixedSlotRecovery.deferMs}ms.`
          );
        }
        const keepPolicyCompatiblePrompt =
          slotAction.action !== "missing" &&
          "record" in slotAction &&
          ((slotAction.action === "retry_failed_after_acceptance" && fixedSlotRecovery.usePolicyCompatiblePrompt) ||
            shouldKeepPaidImagePolicyCompatiblePrompt({
              failureReason: failedRetryReason,
              recordedPromptDigest: slotAction.record?.promptDigest || "",
              originalPromptDigest,
              policyCompatiblePromptDigest
            }));
        const allowFailedAfterAcceptanceDigestChange =
          slotAction.action === "retry_failed_after_acceptance" &&
          isPolicyCompatibleRetryFailureReason(failedAfterAcceptanceReason) &&
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
        writeImageGenerationJsonLog(`${targetFile}.provenance.json`, {
          kind: slotAction.record.resultProvenance?.kind || "paid_ledger_reuse",
          slot: ledgerSlot,
          sourceSlot: slotAction.record.resultProvenance?.sourceSlot,
          resultDigest: slotAction.record.resultDigest,
          providerSubmissionPerformed: false
        });
        options.onProgress?.(
          slotAction.record.resultProvenance?.kind === "operator_approved_existing_result"
            ? `Image ${absoluteImageIndex}: materialized operator-approved existing result from slot ${slotAction.record.resultProvenance.sourceSlot}; no provider submission.`
            : `Image ${absoluteImageIndex}: materialized completed paid ledger result; no provider submission.`
        );
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
        const safeResponseText = sanitizeImageGenerationProviderErrorText(text, response.statusText);
        throw normalizeImageGenerationError("videos-base64 submit failed with HTTP " + response.status + ": " + safeResponseText);
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
        const safeSubmitText = sanitizeImageGenerationProviderErrorText(text, "empty response");
        throw new Error("videos-base64 submit response was not JSON: " + safeSubmitText.slice(0, 500));
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
          const safeStatusText = sanitizeImageGenerationProviderErrorText(statusText, statusResponse.statusText);
          if (statusResponse.status === 404 && videosBase64Ledger) {
            recordPaidImageFailedAfterAcceptance({
              productDir: videosBase64Ledger.productDir,
              slot: ledgerSlot,
              providerTaskId: taskId,
              reason: `accepted provider task expired: status endpoint returned HTTP 404 task_not_found`,
              providerResponse: { status: statusResponse.status, message: safeStatusText }
            });
          }
          throw normalizeImageGenerationError(
            "videos-base64 status failed with HTTP " + statusResponse.status + ": " + safeStatusText
          );
        }
        let parsedStatusPayload: any;
        try {
          parsedStatusPayload = JSON.parse(statusText);
        } catch {
          const safeStatusText = sanitizeImageGenerationProviderErrorText(statusText, "empty response");
          throw new Error("videos-base64 status response was not JSON: " + safeStatusText.slice(0, 500));
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

    let resultUrlStatus: number | undefined;
    let resultUrlArtifactInvalid = false;
    try {
      const resultUrl = extractVideosBase64ResultUrl(statusPayload);
      if (resultUrl) {
        try {
          await downloadVideosBase64ResultWithTransportRetries(resultUrl, targetFile, taskId, absoluteImageIndex);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (!shouldFallbackToAuthenticatedTaskContent(message)) {
            throw error;
          }
          resultUrlStatus = /HTTP\s+404\b/i.test(message) ? 404 : undefined;
          resultUrlArtifactInvalid = /full decode validation|image artifact.*decode|image file is truncated/i.test(message);
          options.onProgress?.(
            `Image ${absoluteImageIndex}: result URL delivery was unusable; falling back to authenticated content for accepted task ${taskId}.`
          );
          await downloadVideosBase64TaskContent(taskId, targetFile, absoluteImageIndex);
        }
      } else {
        await downloadVideosBase64TaskContent(taskId, targetFile, absoluteImageIndex);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const contentStatusMatch = /videos-base64 content download failed with HTTP\s+(\d{3})\b/i.exec(message);
      const contentStatus = contentStatusMatch ? Number(contentStatusMatch[1]) : undefined;
      const contentArtifactInvalid = /full decode validation|image artifact.*decode|image file is truncated/i.test(message);
      const completedResultDeliveryExhausted = shouldReplaceAcceptedPaidImageAfterResultDeliveryExhausted({
        taskCompleted: videosBase64Succeeded(statusPayload),
        resultUrlStatus,
        contentStatus,
        contentRetriesExhausted: true,
        resultUrlArtifactInvalid,
        contentArtifactInvalid
      });
      if ((contentStatus === 404 || completedResultDeliveryExhausted) && videosBase64Ledger) {
        recordPaidImageFailedAfterAcceptance({
          productDir: videosBase64Ledger.productDir,
          slot: ledgerSlot,
          providerTaskId: taskId,
          reason: completedResultDeliveryExhausted
            ? contentArtifactInvalid
              ? "accepted provider task returned invalid image bytes from both result URL and authenticated content after completed status"
              : `accepted provider task missing result after completed status: result URL HTTP 404; authenticated content HTTP ${contentStatus} exhausted transient retries`
            : "accepted provider task expired: authenticated content endpoint returned HTTP 404 after completed status",
          providerResponse: statusPayload
        });
      }
      throw error;
    }
    if (videosBase64Ledger) {
      recordPaidImageCompleted({
        productDir: videosBase64Ledger.productDir,
        slot: ledgerSlot,
        providerTaskId: taskId,
        sourceFile: targetFile
      });
      writeImageGenerationJsonLog(`${targetFile}.provenance.json`, {
        kind: "provider_task_result",
        slot: ledgerSlot,
        resultDigest: sha256File(targetFile),
        providerSubmissionPerformed: true
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
            `paid image provider circuit open for slot ${ledgerSlot}; retry after ${recovery.deferMs}ms.`
          );
        }
        if (recovery.action !== "retry_fixed_slot_now") {
          throw error;
        }
        options.onProgress?.(`Image ${absoluteImageIndex}: provider recovered; retrying fixed paid slot ${ledgerSlot}.`);
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
