import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  compactAutoListingTerminalFailureMessage, formatAutoListingControllerCompactStatusText,
  formatAutoListingControllerExternalServiceWaitSummary, isAutoListingControllerChildProcessCommand,
  isAutoListingControllerRunningProcessConfirmed, isAutoListingControllerSupervisorProcessCommand,
  isAutoListingDirectRunProcessCommand, isExternalMainImageRawReuseMessage,
  resolveAutoListingControllerDryRunStartDecision, resolveAutoListingControllerEffectiveProgressTimestamp,
  resolveAutoListingControllerFeishuBatchDisplayCounts, resolveAutoListingControllerFeishuProgressDisplayMode,
  resolveAutoListingControllerHermesStatusPayload, resolveAutoListingControllerIdleStatus,
  resolveAutoListingControllerLaunchPolicy, resolveAutoListingControllerPaidImageRecordId,
  resolveAutoListingControllerProgressAgeSeconds, resolveAutoListingControllerPublishGroupProgress,
  resolveAutoListingControllerRealtimeProgressSignal, resolveAutoListingControllerRuntimeStatus,
  resolveAutoListingControllerStartAfterFeishuRefresh, selectAutoListingControllerActiveRunIdFromLogLines,
  selectAutoListingControllerFailedResumeCandidate, selectAutoListingControllerLatestResultFileForJobStatus,
  selectAutoListingControllerStatusResultFile, selectAutoListingControllerStatusRuntimeDir,
  shouldClearPauseSignalOnAutoListingControllerStart, shouldExposeHistoricalRuntimeForCurrentFeishuBatch,
  shouldExposePublishProgressInAutoListingControllerStatus, shouldPreferActiveTaskStateSummary,
  shouldResumeHistoricalFailureForCurrentFeishuBatch, shouldResumeInterruptedTaskInPlace,
  shouldSuppressHistoricalResultInAutoListingControllerStatus, shouldSuppressStateCurrentTaskInAutoListingControllerStatus,
  shouldSuppressTerminalFailureBehindNewerProgress, shouldTerminateRecordedAutoListingControllerProcessGroup,
  shouldUseExpectedResultFileInRunningStatus, summarizeAutoListingControllerImageGenerationEvents,
  type AutoListingControllerLaunchIntent
} from "../autolist/batch-continuation-rules.js";
import { resolvePaidImageWaitStatus } from "../autolist/paid-image-wait-rules.js";
import { shouldFailAutoListingControllerStatusForFeishuCacheInvalid, shouldPreserveAutoListingControllerCompletedStatusForFeishuCacheInvalid } from "../autolist/controller-cache-status-rules.js";
import { summarizeFeishuBatchProgress } from "../autolist/audit-rules.js";
import { buildFeishuBatchFingerprint, canResumeFeishuBatchArtifacts } from "../autolist/feishu-batch-rules.js";
import { buildAutoListingBusinessRuleFingerprint } from "../autolist/business-rule-fingerprint.js";
import { removeInvalidRuntimeArtifactDirs } from "../autolist/runtime-artifact-lifecycle.js";
import { clearProcessedImagesForBatch, migrateLegacyProcessedImagesToBatch, readProcessedImages } from "../autolist/file-batch.js";
import { evaluateImageGenerationEndpointProbe } from "../autolist/image-generation-rules.js";
import { assertAutoListingControllerImageGenerationContract } from "../autolist/image-generation-config.js";
import type { ImageGenerationProvider } from "../autolist/image-generation-provider.js";
import { loadFeishuProductRecords } from "../autolist/feishu-products.js";
import { resolveControllerJobClosure, type ControllerJobStatus } from "../autolist/maintenance-rules.js";
import { isManifestEntryAcceptedForBatchCompletion } from "../autolist/publish-manifest.js";
import { readLatestTaskProgressEvent } from "../autolist/progress-events.js";
import {
  inferResumeStartStepForTask,
  shouldInvalidatePublishedResumeWithoutProductFolders,
  shouldReplaceStaleResumeStartStep
} from "../autolist/resume-rules.js";
import { hasIncompleteFixedMainImageRoundFiles, summarizeReusableTaskArtifacts } from "../autolist/resume-artifacts.js";
import { atomicWriteJson } from "../utils/atomic-file.js";
import {
  paidImageProductLedgerDir,
  removePaidImageBatchLedger,
  summarizePaidImageProductLedger,
  type PaidImageLedgerSummary
} from "../autolist/paid-image-submission-ledger.js";
import {
  buildFallbackSourceJobFromPreflight,
  findLatestUnsafePublishManifestForResume as selectLatestUnsafePublishManifestForResume,
  unsafePublishEntriesForResume
} from "../autolist/unsafe-publish-resume.js";

interface RunnerJob {
  pid: number;
  startedAt: string;
  cwd: string;
  command: string;
  args: string[];
  logFile: string;
  expectedResultFile?: string;
  mode: "full-real-flow" | "resume-real-job";
  status: ControllerJobStatus;
  batchFingerprint?: string;
  businessRuleFingerprint?: string;
  finishedAt?: string;
}

interface DirectAutoListingProcess {
  pid: number;
  command: string;
  jobFile: string;
  runtimeDir?: string;
}

interface ExternalServiceWait {
  supervisorPid?: number;
  status?: "external_service_wait";
  reason?: string;
  attempt?: number;
  retryAt?: string;
}

interface PauseSignalFile {
  requestedAt: string;
  reason: "operator" | "batch_mismatch";
  source: "auto-listing-controller";
  message: string;
  currentBatchFingerprint?: string;
  runtimeBatchFingerprint?: string;
  runId?: string;
  pid?: number;
}

interface AutoListingJobFile {
  input?: {
    [key: string]: unknown;
    startStep?: string;
    endStep?: string;
    resumeSourceImagePath?: string;
    resumeTaskId?: string;
    resumeProductFolderNames?: string[];
    feishuBatchFingerprint?: string;
    businessRuleFingerprint?: string;
    feishuProductDataFile?: string;
    processedImageManifest?: string;
    paidImageSubmissionLedgerDir?: string;
    imageGenerationConfigFile?: string;
    imageGenerationProvider?: ImageGenerationProvider;
    simulateOnly?: boolean;
    shopRootDir?: string;
    maxImagesPerRun?: number;
    clearTestOutputsBeforeRun?: boolean;
  };
  resultFile?: string;
  runtimeDir?: string;
  runId?: string;
  startStep?: string;
}

interface AutoListingTaskFile {
  taskId?: string;
  sourceImageName?: string;
  sourceImagePath?: string;
  status?: string;
  feishuProductRecord?: {
    recordId?: string;
    userCognitionName?: string;
    genericName?: string;
    spu?: string;
  };
  generatedProductFolders?: string[];
  mainImageArtifact?: { generatedFiles?: Array<{ productFolder?: string }> };
  shopDistributionArtifact?: { distributedFolders?: string[] };
  error?: { step?: string; message?: string };
}

interface AutoListingResultFile {
  ok?: boolean;
  feishuBatchFingerprint?: string;
  businessRuleFingerprint?: string;
  status?: string;
  runId?: string;
  runtimeDir?: string;
  artifacts?: { processedImageManifest?: string };
  discoveredImages?: string[];
  tasks?: AutoListingTaskFile[];
  error?: { message?: string };
}

interface AutoListingStateFile { runId?: string; feishuBatchFingerprint?: string; businessRuleFingerprint?: string; status?: string; tasks?: AutoListingTaskFile[] }

interface PublishManifestFile {
  generatedAt?: string;
  entries?: Array<{
    productFolder?: string;
    runtimeKey?: string;
    shopFolder?: string;
    watermarkNo?: number | null;
    sourceImagePath?: string;
    recordId?: string;
    userCognitionName?: string;
    genericName?: string;
    status?: "pending" | "published" | "failed" | "skipped";
    finalVerifyStatus?: string;
    errorClass?: string;
    message?: string;
    updatedAt?: string;
  }>;
}

interface PublishPlanFile {
  generatedAt?: string;
  plan?: Array<{
    productFolder?: string;
    runtimeKey?: string;
    action?: "skip" | "publish";
  }>;
}

interface DeferredMainImageRoundFile {
  batchFingerprint?: string;
  recordId?: string;
  createdAt?: string;
  round?: number;
  movedProductFolders?: Array<{
    from?: string;
    to?: string;
  }>;
}

interface LocalFeishuConfig {
  auth?: {
    appId?: string;
    appSecret?: string;
    tenantAccessToken?: string;
  };
}

const rootDir = process.cwd();
const controlDir = path.resolve(rootDir, "data/auto-listing/control");
const jobFile = path.join(controlDir, "auto-listing-controller-job.json");
const childControlFile = path.join(controlDir, "auto-listing-child.json");
const externalServiceWaitFile = path.join(controlDir, "auto-listing-wait.json");
const pauseFile = path.join(controlDir, "pause.requested");
const resumeJobFile = path.resolve(rootDir, "input/auto-listing/auto-listing.job.mac-feishu-real.resume.generated.json");
const fullRealJobFile = path.resolve(rootDir, "input/auto-listing.job.mac-feishu-real.json");
const deferredMainImageRoot = path.resolve(rootDir, "data/auto-listing/deferred-main-images");
const feishuConfigFile = path.resolve(rootDir, "input/feishu-bitable.config.json");

function readJsonFile<T>(file: string): T | undefined {
  if (!fs.existsSync(file)) {
    return undefined;
  }
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

function readPauseSignalFile(): PauseSignalFile | undefined {
  if (!fs.existsSync(pauseFile)) {
    return undefined;
  }
  const raw = fs.readFileSync(pauseFile, "utf8").trim();
  if (!raw) {
    return {
      requestedAt: new Date(fileMtimeMs(pauseFile) || Date.now()).toISOString(),
      reason: "operator",
      source: "auto-listing-controller",
      message: "项目已收到暂停请求；继续上架会清除暂停信号并从安全断点续跑。"
    };
  }
  if (raw.startsWith("{")) {
    try {
      const parsed = JSON.parse(raw) as Partial<PauseSignalFile>;
      return {
        requestedAt: typeof parsed.requestedAt === "string" ? parsed.requestedAt : new Date(fileMtimeMs(pauseFile) || Date.now()).toISOString(),
        reason: parsed.reason === "batch_mismatch" ? "batch_mismatch" : "operator",
        source: "auto-listing-controller",
        message:
          typeof parsed.message === "string" && parsed.message.trim()
            ? parsed.message.trim()
            : "项目已收到暂停请求；继续上架会清除暂停信号并从安全断点续跑。",
        currentBatchFingerprint:
          typeof parsed.currentBatchFingerprint === "string" ? parsed.currentBatchFingerprint : undefined,
        runtimeBatchFingerprint:
          typeof parsed.runtimeBatchFingerprint === "string" ? parsed.runtimeBatchFingerprint : undefined,
        runId: typeof parsed.runId === "string" ? parsed.runId : undefined,
        pid: typeof parsed.pid === "number" ? parsed.pid : undefined
      };
    } catch {
      // Fall through to legacy timestamp handling.
    }
  }
  return {
    requestedAt: raw,
    reason: "operator",
    source: "auto-listing-controller",
    message: "项目已收到暂停请求；继续上架会清除暂停信号并从安全断点续跑。"
  };
}

function writePauseSignalFile(signal: Omit<PauseSignalFile, "requestedAt" | "source"> & { requestedAt?: string }): PauseSignalFile {
  fs.mkdirSync(controlDir, { recursive: true });
  const payload: PauseSignalFile = {
    requestedAt: signal.requestedAt || new Date().toISOString(),
    reason: signal.reason,
    source: "auto-listing-controller",
    message: signal.message,
    currentBatchFingerprint: signal.currentBatchFingerprint,
    runtimeBatchFingerprint: signal.runtimeBatchFingerprint,
    runId: signal.runId,
    pid: signal.pid
  };
  atomicWriteJson(pauseFile, payload);
  return payload;
}

function formatPauseSignalSummary(signal: PauseSignalFile | undefined): string {
  if (signal?.reason === "batch_mismatch") {
    const runtime = signal.runtimeBatchFingerprint ? signal.runtimeBatchFingerprint.slice(0, 12) : "未知";
    const current = signal.currentBatchFingerprint ? signal.currentBatchFingerprint.slice(0, 12) : "未知";
    return `批次保护暂停：运行批次 ${runtime} 与当前飞书缓存 ${current} 不一致；已停止复用旧运行证据。继续上架会清除暂停信号并按当前飞书缓存安全续跑。`;
  }
  return signal?.message || "项目已收到暂停请求；继续上架会清除暂停信号并从安全断点续跑。";
}

function maybeUpgradeLegacyPauseSignalForBatchMismatch(input: {
  pauseSignal?: PauseSignalFile;
  currentBatchFingerprint?: string;
  runtimeBatchFingerprint?: string;
  latestResult?: AutoListingResultFile;
  runId?: string;
}): PauseSignalFile | undefined {
  if (!input.pauseSignal || input.pauseSignal.reason === "batch_mismatch") {
    return input.pauseSignal;
  }
  if (
    !input.currentBatchFingerprint ||
    !input.runtimeBatchFingerprint ||
    input.currentBatchFingerprint === input.runtimeBatchFingerprint
  ) {
    return input.pauseSignal;
  }
  const errorMessage = String((input.latestResult?.error as Record<string, unknown> | undefined)?.message || "");
  if (
    input.latestResult?.ok !== false ||
    !/pause requested|pause\.requested|Auto-listing pause requested/i.test(errorMessage)
  ) {
    return input.pauseSignal;
  }
  return writePauseSignalFile({
    requestedAt: input.pauseSignal.requestedAt,
    reason: "batch_mismatch",
    message: "旧暂停信号已根据运行结果升级：运行批次与当前飞书缓存不一致，继续前必须按当前缓存重新选择断点。",
    currentBatchFingerprint: input.currentBatchFingerprint,
    runtimeBatchFingerprint: input.runtimeBatchFingerprint,
    runId: input.runId
  });
}

function readProcessCommand(pid: number | undefined): string | undefined {
  if (!pid || !Number.isInteger(pid) || pid <= 0) {
    return undefined;
  }
  const result = spawnSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" });
  if (result.status !== 0) {
    return undefined;
  }
  return result.stdout.trim() || undefined;
}

function extractDirectAutoListingJobFile(command: string): string | undefined {
  const match = /\s--job\s+("[^"]+"|'[^']+'|\S+)/.exec(` ${command}`);
  const raw = match?.[1]?.replace(/^['"]|['"]$/g, "");
  return raw ? path.resolve(rootDir, raw) : undefined;
}

function findActiveDirectAutoListingProcess(): DirectAutoListingProcess | undefined {
  const result = spawnSync("ps", ["-ax", "-o", "pid=,command="], { encoding: "utf8" });
  let lines: string[] = [];
  if (result.status === 0 && typeof result.stdout === "string" && result.stdout.trim()) {
    lines = result.stdout.split(/\r?\n/);
  } else {
    const fallback = spawnSync("pgrep", ["-lf", "auto-listing.js"], { encoding: "utf8" });
    if (fallback.status !== 0 || typeof fallback.stdout !== "string" || !fallback.stdout.trim()) {
      return undefined;
    }
    lines = fallback.stdout.split(/\r?\n/);
  }
  if (!lines.length) {
    return undefined;
  }
  const candidates: DirectAutoListingProcess[] = [];
  for (const line of lines) {
    const match = /^\s*(\d+)\s+(.+)$/.exec(line);
    if (!match) {
      continue;
    }
    const pid = Number(match[1]);
    const command = match[2].trim();
    if (!Number.isInteger(pid) || pid === process.pid || !isAutoListingDirectRunProcessCommand(command)) {
      continue;
    }
    const directJobFile = extractDirectAutoListingJobFile(command);
    if (!directJobFile || !fs.existsSync(directJobFile)) {
      continue;
    }
    const directJob = readJsonFile<AutoListingJobFile>(directJobFile);
    candidates.push({
      pid,
      command,
      jobFile: directJobFile,
      runtimeDir: directJob?.runtimeDir ? path.resolve(rootDir, directJob.runtimeDir) : undefined
    });
  }
  const stateMtimeMs = (candidate: DirectAutoListingProcess | undefined): number =>
    candidate?.runtimeDir ? fileMtimeMs(path.join(candidate.runtimeDir, "state.json")) ?? 0 : 0;
  const [latest] = candidates.sort((a, b) => stateMtimeMs(b) - stateMtimeMs(a));
  return latest;
}

function isPidRunning(pid: number | undefined): boolean {
  if (!pid || !Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function isRunnerJobRunning(job: RunnerJob): boolean {
  if (job.status !== "running") {
    return false;
  }
  const command = readProcessCommand(job.pid);
  return isAutoListingControllerRunningProcessConfirmed({
    pidAlive: isPidRunning(job.pid),
    processGroupAlive: isProcessGroupRunning(job.pid),
    command
  });
}

function isProcessGroupRunning(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function cleanupRecordedAutoListingControllerChild(): Promise<void> {
  const child = readJsonFile<{ pid?: number }>(childControlFile);
  const pid = child?.pid;
  if (!pid) {
    fs.rmSync(childControlFile, { force: true });
    return;
  }
  const leaderRunning = isPidRunning(pid);
  const command = leaderRunning ? readProcessCommand(pid) : undefined;
  if (
    !shouldTerminateRecordedAutoListingControllerProcessGroup({
      leaderRunning,
      leaderCommandMatches: Boolean(command && isAutoListingControllerChildProcessCommand(command))
    })
  ) {
    fs.rmSync(childControlFile, { force: true });
    return;
  }
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    if (leaderRunning) {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        fs.rmSync(childControlFile, { force: true });
        return;
      }
    }
  }
  const deadline = Date.now() + 5000;
  while (isProcessGroupRunning(pid) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (isProcessGroupRunning(pid)) {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // Process exited between the liveness check and termination.
      }
    }
  }
  fs.rmSync(childControlFile, { force: true });
}

function timestampForFile(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join("");
}

function tailFile(file: string, maxLines: number): string[] {
  if (!fs.existsSync(file)) {
    return [];
  }
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  return lines.filter(Boolean).slice(-maxLines);
}

function compactStatusLine(line: string): string {
  const compact = line.replace(/\s+/g, " ").trim();
  const workbookCount = (compact.match(/\.xlsx\b/gi) || []).length;
  if (workbookCount > 2 && /product folders already contain workbook/i.test(compact)) {
    return `标题 workbook 已存在 ${workbookCount} 个；续跑应跳过标题生成并从发布阶段继续，原始路径列表已压缩。`;
  }
  const watermarkFailure = /Publish preflight failed for\s+(\d+)\s+issue\(s\).*No main image candidate matched current shop watermark/i.exec(compact);
  if (watermarkFailure) {
    const examples = Array.from(compact.matchAll(/([^|]+?)\s*->\s*No main image candidate matched current shop watermark:\s*([^|]+)/gi))
      .slice(0, 2)
      .map((match) => `${match[1].replace(/^Publish preflight failed for\s+\d+\s+issue\(s\):\s*/i, "").trim()} 应匹配 ${match[2].trim()}`);
    return `发布预检失败：${watermarkFailure[1]} 个商品文件夹主图水印与目标店铺不匹配；需从主图生成步骤重建水印后再发布${examples.length ? `。示例：${examples.join("；")}` : "。"}。`;
  }
  const freightFailure = /No visible freight template option matched keyword:\s*([^;]+); visibleOptions=([^;]+)/i.exec(compact);
  if (freightFailure) {
    const rawOptions = freightFailure[2] || "";
    const options =
      rawOptions === "<none>"
        ? "未读到下拉候选"
        : /标题推荐|必填项进度|重要属性|型号规格|商品类目/.test(rawOptions)
          ? "页面仍在其他模块或必填校验区域，未打开运费模板下拉候选"
          : rawOptions.length > 120
            ? `${rawOptions.slice(0, 120)}...`
            : rawOptions;
    return `发布服务与履约未完成：没有选中运费模板“${freightFailure[1].trim()}”。当前候选摘要：${options}`;
  }
  const freightComboFailure = /No visible freight template combobox matched keyword:\s*(.+)$/i.exec(compact);
  if (freightComboFailure) {
    return `发布服务与履约未完成：没有找到运费模板下拉框“${freightComboFailure[1].trim()}”，需要重新进入服务与履约模块后续跑。`;
  }
  const basicInfoFailure = /(?:Sequential publish flow stopped:\s*)?基础信息模块未完成。(.+)/i.exec(compact);
  if (basicInfoFailure) {
    const detail = basicInfoFailure[1]
      .replace(/Short title input not found on publish page\./i, "导购短标题输入框未稳定识别")
      .replace(/Title input not found on publish page\./i, "商品标题输入框未稳定识别")
      .replace(/Model spec input not found on publish page\./i, "型号规格输入框未稳定识别");
    return `发布基础信息未完成：${detail}；系统会按发布页控件未就绪处理并重试。`;
  }
  const finalPublishFailure = /(?:Sequential publish flow stopped:\s*)?最终发布动作未完成。(.+)/i.exec(compact);
  if (finalPublishFailure) {
    const detail = finalPublishFailure[1];
    if (/系统异常|请重试|稍后重试|操作ID/i.test(detail)) {
      return "最终点击发布时抖店返回系统异常：这通常是提交瞬时失败，系统会按可恢复发布错误重试。";
    }
    if (/系统将自动唤起图片编辑工具|商品完整边缘清晰/i.test(detail)) {
      return "最终点击发布时抖店触发图片质量/自动编辑提示：系统会按可恢复发布错误重试该商品。";
    }
    return `最终点击发布未确认成功：${detail.length > 120 ? `${detail.slice(0, 120)}...` : detail}`;
  }
  if (/Execution context was destroyed|most likely because of a navigation|page context was lost|context was lost|Target closed/i.test(compact)) {
    return "发布页正在跳转或刷新时被读取：这是页面导航竞态，系统会按可恢复页面上下文错误重试该商品。";
  }
  return compact.length > 500 ? `${compact.slice(0, 500)}... [truncated]` : compact;
}

function latestAutoListingChildFailureFromLog(logFile: string | undefined): string | undefined {
  const lines = tailFile(logFile || "", 40).map(compactStatusLine);
  let exitFailure: string | undefined;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (/^Error: /i.test(line)) {
      return line.replace(/^Error:\s*/i, "");
    }
    if (/Auto-listing failed with exit code/i.test(line)) {
      exitFailure = exitFailure || line;
    }
  }
  return exitFailure;
}

function compactStatusValue(value: string | undefined): string | undefined {
  return value ? compactStatusLine(value) : value;
}

function formatFeishuCacheValidationFailureForOperator(productDataFile: string): string | undefined {
  if (!fs.existsSync(productDataFile)) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(productDataFile, "utf8")) as {
      ok?: boolean;
      count?: number;
      invalidRecords?: Array<{ recordId?: string; missing?: string[] }>;
      missingMappedFields?: string[];
    };
    const invalidRecords = Array.isArray(parsed.invalidRecords) ? parsed.invalidRecords : [];
    const missingMappedFields = Array.isArray(parsed.missingMappedFields) ? parsed.missingMappedFields.filter(Boolean) : [];
    if (parsed.ok !== false && invalidRecords.length === 0 && missingMappedFields.length === 0) {
      return undefined;
    }
    const invalidSummary = invalidRecords
      .slice(0, 3)
      .map((record) => {
        const missing = Array.isArray(record.missing) ? record.missing.filter(Boolean) : [];
        const shown = missing.slice(0, 8).join(",");
        return `${record.recordId || "unknown"}缺字段:${shown}${missing.length > 8 ? `等${missing.length}项` : ""}`;
      })
      .join("；");
    const mappedSummary = missingMappedFields.length ? `字段映射缺失:${missingMappedFields.join(",")}` : "";
    return [
      "飞书刷新后缓存校验失败",
      `记录数=${Number(parsed.count ?? 0)}`,
      invalidSummary,
      mappedSummary
    ].filter(Boolean).join("；");
  } catch {
    return undefined;
  }
}

function publishModuleLabel(moduleName: string): string {
  if (moduleName === "basic_info") return "基础信息";
  if (moduleName === "graphic_info") return "图文信息";
  if (moduleName === "price_inventory") return "价格库存";
  if (moduleName === "service_fulfillment") return "服务履约";
  if (moduleName === "final_submit") return "最终提交";
  return moduleName;
}

function summarizePublishLogProgress(logFile: string | undefined): Record<string, unknown> | undefined {
  if (!logFile || !fs.existsSync(logFile)) {
    return undefined;
  }
  const lines = tailFile(logFile, 240);
  for (const line of [...lines].reverse()) {
    const compact = line.replace(/\s+/g, " ").trim();
    const timestamp = /^\[([^\]]+)\]/.exec(compact)?.[1];
    const moduleMatch = /publish module started:\s*([a-z_]+)\s*\(([^)]+)\)/i.exec(compact);
    if (moduleMatch) {
      return {
        timestamp,
        message: `发布模块：${publishModuleLabel(moduleMatch[1])}（${moduleMatch[2]}）`
      };
    }
    const spuMatch = /querying platform spu with brand=([^,]+),\s*spu=([^\s]+)/i.exec(compact);
    if (spuMatch) {
      return {
        timestamp,
        message: `标品检索：${spuMatch[1]} ${spuMatch[2]}`
      };
    }
  }
  return undefined;
}

function compactErrorObject<T extends { message?: string } | undefined>(error: T): T {
  if (!error?.message) {
    return error;
  }
  return {
    ...error,
    message: compactStatusLine(error.message)
  };
}

function compactProductFolders(folders: string[] | undefined): Record<string, unknown> {
  const values = folders || [];
  return {
    generatedProductFolderCount: values.length,
    generatedProductFolders: values.slice(0, 3)
  };
}

function compactTaskForStatus<
  T extends {
    taskId?: string;
    sourceImageName?: string;
    sourceImagePath?: string;
    status?: string;
    feishuProductRecord?: {
      recordId?: string;
      userCognitionName?: string;
      genericName?: string;
      spu?: string;
    };
    generatedProductFolders?: string[];
    error?: { step?: string; message?: string };
  }
>(task: T | undefined): Record<string, unknown> | undefined {
  if (!task) {
    return undefined;
  }
  return {
    taskId: task.taskId,
    sourceImageName: task.sourceImageName,
    sourceImagePath: task.sourceImagePath,
    recordId: task.feishuProductRecord?.recordId,
    userCognitionName: task.feishuProductRecord?.userCognitionName,
    genericName: task.feishuProductRecord?.genericName,
    spu: task.feishuProductRecord?.spu,
    status: task.status,
    ...compactProductFolders(task.generatedProductFolders),
    error: compactErrorObject(task.error)
  };
}

function findActiveRuntimeDirFromLog(logFile: string | undefined): string | undefined {
  if (!logFile || !fs.existsSync(logFile)) {
    return undefined;
  }
  const runId = selectAutoListingControllerActiveRunIdFromLogLines(fs.readFileSync(logFile, "utf8").split(/\r?\n/));
  if (runId) {
    const runtimeDir = path.resolve(rootDir, "data/auto-listing/runs", runId);
    return fs.existsSync(runtimeDir) ? runtimeDir : undefined;
  }
  return undefined;
}

function fileMtimeMs(file: string | undefined): number | undefined {
  if (!file || !fs.existsSync(file)) {
    return undefined;
  }
  return fs.statSync(file).mtimeMs;
}

function findLatestResultFile(): string | undefined {
  const runsDir = path.resolve(rootDir, "data/auto-listing/runs");
  if (!fs.existsSync(runsDir)) {
    return undefined;
  }
  const resultFiles = fs
    .readdirSync(runsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(runsDir, entry.name, "result.json"))
    .filter((file) => fs.existsSync(file))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return resultFiles[0];
}

function listResultFilesNewestFirst(): string[] {
  const runsDir = path.resolve(rootDir, "data/auto-listing/runs");
  if (!fs.existsSync(runsDir)) {
    return [];
  }
  return fs
    .readdirSync(runsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(runsDir, entry.name, "result.json"))
    .filter((file) => fs.existsSync(file))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
}

function summarizeResult(resultFile: string | undefined): Record<string, unknown> | undefined {
  if (!resultFile) {
    return undefined;
  }
  const result = readJsonFile<AutoListingResultFile>(resultFile);
  if (!result) {
    return undefined;
  }
  const tasks = result.tasks || [];
  const failedTask = tasks.find((task) => task.status === "failed" || task.error);
  return {
    resultFile,
    ok: result.ok === true,
    status: result.status || (result.ok === true ? "success" : "failed"),
    runId: result.runId,
    runtimeDir: result.runtimeDir,
    feishuBatchFingerprint: result.feishuBatchFingerprint,
    products: tasks.map((task) => ({
      sourceImageName: task.sourceImageName,
      status: task.status,
      ...compactProductFolders(task.generatedProductFolders)
    })),
    artifacts: {
      processedImageManifest: result.artifacts?.processedImageManifest
    },
    error: compactErrorObject(failedTask?.error || result.error),
    discoveredImages: result.discoveredImages || []
  };
}

function summarizeState(runtimeDir: string | undefined): Record<string, unknown> | undefined {
  if (!runtimeDir) {
    return undefined;
  }
  const stateFile = path.join(runtimeDir, "state.json");
  const state = readJsonFile<{
    runId?: string;
    feishuBatchFingerprint?: string;
    status?: string;
    tasks?: Array<{
      taskId?: string;
      sourceImageName?: string;
      status?: string;
      error?: { step?: string; message?: string };
    }>;
  }>(stateFile);
  if (!state) {
    return undefined;
  }
  const tasks = state.tasks || [];
  const currentTask = tasks.find((task) => task.status !== "done" && task.status !== "cleaned") || tasks[tasks.length - 1];
  const latestProgress = readLatestTaskProgressEvent(path.join(runtimeDir, "events.ndjson"), currentTask?.taskId);
  return {
    stateFile,
    runId: state.runId || path.basename(runtimeDir),
    feishuBatchFingerprint: state.feishuBatchFingerprint,
    status: state.status,
    currentTask: compactTaskForStatus(currentTask),
    latestProgress: latestProgress
      ? {
          ...latestProgress,
          ageSeconds: resolveAutoListingControllerProgressAgeSeconds({
            nowIso: new Date().toISOString(),
            latestProgressTimestamp: latestProgress.timestamp
          }),
          message: compactStatusValue(latestProgress.message)
        }
      : undefined
  };
}

function summarizeImageGenerationProgress(runtimeDir: string | undefined, taskId: string | undefined): Record<string, unknown> | undefined {
  if (!runtimeDir || !taskId) {
    return undefined;
  }
  const eventsFile = path.join(runtimeDir, "events.ndjson");
  if (!fs.existsSync(eventsFile)) {
    return undefined;
  }
  const events = fs
    .readFileSync(eventsFile, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as { timestamp?: string; taskId?: string; step?: string; message?: string };
      } catch {
        return undefined;
      }
    })
    .filter((event): event is { timestamp?: string; taskId?: string; step?: string; message?: string } =>
      Boolean(event?.taskId === taskId && event.step === "main_images_generated")
    );
  const latest = events.at(-1);
  if (!latest) {
    return undefined;
  }
  const latestReuseEvent = [...events]
    .reverse()
    .find((event) => /Reused\s+\d+\s+current-product raw main image/i.test(event.message || ""));
  const summary = summarizeAutoListingControllerImageGenerationEvents(events);
  return summary
    ? {
        ...summary,
        latestMessage: compactStatusValue(summary.latestMessage),
        latestSavedMessage: summary.latestSavedMessage ? compactStatusValue(summary.latestSavedMessage) : undefined,
        updatedAt: latestReuseEvent ? latestReuseEvent.timestamp : summary.updatedAt
      }
    : undefined;
}

function summarizeLatestPublishArtifact(runtimeDir: string, runtimeKey: string | undefined): Record<string, unknown> | undefined {
  if (!runtimeKey) {
    return undefined;
  }
  const publishDir = path.join(runtimeDir, "publish", runtimeKey);
  const screenshotsDir = path.join(publishDir, "screenshots");
  const candidates = [path.join(publishDir, "result.json"), path.join(publishDir, "publish-checkpoint.json")];
  if (fs.existsSync(screenshotsDir)) {
    for (const file of fs.readdirSync(screenshotsDir)) {
      candidates.push(path.join(screenshotsDir, file));
    }
  }
  const existing = candidates
    .filter((file) => fs.existsSync(file))
    .map((file) => ({ file, mtimeMs: fs.statSync(file).mtimeMs }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  const latest = existing[0];
  if (!latest) {
    return undefined;
  }
  return {
    file: latest.file,
    name: path.basename(latest.file),
    updatedAt: new Date(latest.mtimeMs).toISOString()
  };
}

function summarizePublishProgress(runtimeDir: string | undefined): Record<string, unknown> | undefined {
  if (!runtimeDir) {
    return undefined;
  }
  const manifestFile = path.join(runtimeDir, "publish-manifest.json");
  const planFile = path.join(runtimeDir, "publish-plan.json");
  const manifest = readJsonFile<PublishManifestFile>(manifestFile);
  const plan = readJsonFile<PublishPlanFile>(planFile);
  const entries = manifest?.entries || [];
  const planItems = plan?.plan || [];
  if (!entries.length && !planItems.length) {
    return undefined;
  }

  const safelyPublished = entries.filter((entry) => isManifestEntryAcceptedForBatchCompletion(entry as never));
  const review: typeof entries = [];
  const failed = entries.filter((entry) => entry.status === "failed" && !isManifestEntryAcceptedForBatchCompletion(entry as never));
  const pending = entries.filter((entry) => entry.status === "pending");
  const total = Math.max(planItems.length, entries.length, ...entries.map((entry) => entry.watermarkNo || 0));
  const completedKeys = new Set(safelyPublished.map((entry) => entry.runtimeKey).filter(Boolean));
  const activeEntry =
    pending.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))[0] ||
    failed.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))[0] ||
    (() => {
      const nextPlanItem = planItems.find((item) => item.runtimeKey && !completedKeys.has(item.runtimeKey));
      return nextPlanItem
        ? {
            productFolder: nextPlanItem.productFolder,
            runtimeKey: nextPlanItem.runtimeKey,
            status: "pending" as const,
            message: "Waiting for publish result."
          }
        : undefined;
    })();
  const latestPublished = safelyPublished.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))[0];
  const publishGroupProgress = resolveAutoListingControllerPublishGroupProgress({
    entries,
    planEntries: planItems,
    activeRuntimeKey: activeEntry?.runtimeKey || latestPublished?.runtimeKey
  });
  const latestArtifact = summarizeLatestPublishArtifact(runtimeDir, activeEntry?.runtimeKey);
  const progressText =
    (publishGroupProgress
      ? `当前商品：${publishGroupProgress.productName}，发布 ${publishGroupProgress.productIndex}/${publishGroupProgress.productTotal}，店铺 ${publishGroupProgress.shopIndex}/${publishGroupProgress.shopTotal}`
      : safelyPublished.length > 0
        ? `发布清单初始化中，已确认发布 ${safelyPublished.length} 个`
        : "发布清单初始化中") +
    (latestArtifact?.name ? `，最近产物：${String(latestArtifact.name)}` : "");

  return {
    manifestFile,
    planFile: fs.existsSync(planFile) ? planFile : undefined,
    total,
    safelyPublished: safelyPublished.length,
    failed: failed.length,
    review: review.length,
    pending: pending.length,
    progressText,
    publishGroupProgress,
    active: activeEntry
      ? {
          productFolder: activeEntry.productFolder,
          runtimeKey: activeEntry.runtimeKey,
          shop: activeEntry.shopFolder ? path.basename(activeEntry.shopFolder) : undefined,
          watermarkNo: activeEntry.watermarkNo,
          status: activeEntry.status,
          message: activeEntry.message,
          updatedAt: activeEntry.updatedAt
        }
      : undefined,
    latestArtifact,
    latestPublished: latestPublished
      ? {
          productFolder: latestPublished.productFolder,
          shop: latestPublished.shopFolder ? path.basename(latestPublished.shopFolder) : undefined,
          watermarkNo: latestPublished.watermarkNo,
          updatedAt: latestPublished.updatedAt
        }
      : undefined
  };
}

function findLatestRuntimeDirWithPublishManifest(): string | undefined {
  const runsDir = path.join(rootDir, "data", "auto-listing", "runs");
  if (!fs.existsSync(runsDir)) {
    return undefined;
  }
  return fs
    .readdirSync(runsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const runtimeDir = path.join(runsDir, entry.name);
      const manifestFile = path.join(runtimeDir, "publish-manifest.json");
      return {
        runtimeDir,
        mtimeMs: fs.existsSync(manifestFile) ? fs.statSync(manifestFile).mtimeMs : 0
      };
    })
    .filter((item) => item.mtimeMs > 0)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.runtimeDir;
}

function isActiveManualRecoveryPublishProgress(publishProgress: Record<string, unknown> | undefined): boolean {
  const active = publishProgress?.active as Record<string, unknown> | undefined;
  const runtimeKey = String(active?.runtimeKey || "");
  return /__manual-republish-\d+__/i.test(runtimeKey) && Number(publishProgress?.pending || 0) > 0;
}

function isActivePublishProgress(publishProgress: Record<string, unknown> | undefined): boolean {
  const active = publishProgress?.active as Record<string, unknown> | undefined;
  return Boolean(active?.runtimeKey) && Number(publishProgress?.pending || 0) > 0;
}

function summarizeFeishuProgress(processedManifestOverride?: string): Record<string, unknown> | undefined {
  const job = readJsonFile<AutoListingJobFile>(fullRealJobFile);
  const feishuProductDataFile = path.resolve(rootDir, job?.input?.feishuProductDataFile || "data/feishu/products.json");
  const processedManifestFile = path.resolve(
    rootDir,
    processedManifestOverride || job?.input?.processedImageManifest || "data/auto-listing/processed-images.json"
  );
  if (!fs.existsSync(feishuProductDataFile)) {
    return undefined;
  }
  try {
    const records = loadFeishuProductRecords(feishuProductDataFile);
    const batchFingerprint = buildFeishuBatchFingerprint(records);
    const progress = summarizeFeishuBatchProgress({
      records,
      processedImages: readProcessedImages(processedManifestFile, batchFingerprint)
    }) as unknown as Record<string, unknown>;
    return {
      ...progress,
      batchFingerprint
    };
  } catch (error) {
    const validationIssue = formatFeishuCacheValidationFailureForOperator(feishuProductDataFile) || compactStatusValue(error instanceof Error ? error.message : String(error));
    return {
      cacheValid: false,
      validationIssue,
      recordCount: 0,
      processedRecordCount: 0,
      pendingRecordCount: 0,
      pendingSourceImages: [],
      batchComplete: false
    };
  }
}

function safeLoadFeishuProductRecords(productDataFile: string): ReturnType<typeof loadFeishuProductRecords> {
  try {
    return loadFeishuProductRecords(productDataFile);
  } catch {
    return [];
  }
}

function attachmentLocalFile(record: { whiteBackgroundImages?: Array<{ localFile?: string }> }): string {
  return path.resolve(String(record.whiteBackgroundImages?.[0]?.localFile || ""));
}

function summarizeFeishuCurrentProduct(input: {
  records: ReturnType<typeof loadFeishuProductRecords>;
  currentTask?: Record<string, unknown>;
  publishProgress?: Record<string, unknown>;
}): Record<string, unknown> | undefined {
  const total = input.records.length;
  if (total <= 0) {
    return undefined;
  }
  const active = input.publishProgress?.active as Record<string, unknown> | undefined;
  const latestPublished = input.publishProgress?.latestPublished as Record<string, unknown> | undefined;
  const candidates = [
    {
      recordId: String(input.currentTask?.recordId || ""),
      sourceImagePath: String(input.currentTask?.sourceImagePath || "")
    },
    {
      recordId: String(active?.recordId || ""),
      sourceImagePath: String(active?.sourceImagePath || "")
    },
    {
      recordId: String(latestPublished?.recordId || ""),
      sourceImagePath: String(latestPublished?.sourceImagePath || "")
    }
  ];
  for (const candidate of candidates) {
    const sourceImagePath = candidate.sourceImagePath ? path.resolve(rootDir, candidate.sourceImagePath) : "";
    const index = input.records.findIndex((record) =>
      (candidate.recordId && record.recordId === candidate.recordId) ||
      (sourceImagePath && attachmentLocalFile(record) === sourceImagePath)
    );
    if (index >= 0) {
      const record = input.records[index];
      return {
        current: index + 1,
        total,
        recordId: record.recordId,
        userCognitionName: record.userCognitionName,
        genericName: record.genericName,
        spu: record.spu
      };
    }
  }
  return undefined;
}

function loadFeishuEnv(configFile: string): NodeJS.ProcessEnv {
  if (!fs.existsSync(configFile)) {
    return process.env;
  }
  const parsed = JSON.parse(fs.readFileSync(configFile, "utf8")) as LocalFeishuConfig;
  if (!parsed.auth) {
    return process.env;
  }
  return {
    ...process.env,
    FEISHU_APP_ID: parsed.auth.appId?.trim() || "",
    FEISHU_APP_SECRET: parsed.auth.appSecret?.trim() || "",
    FEISHU_TENANT_ACCESS_TOKEN: parsed.auth.tenantAccessToken?.trim() || ""
  };
}

function migrateLegacyProcessedManifestForCurrentCache(): void {
  const job = readJsonFile<AutoListingJobFile>(fullRealJobFile);
  const feishuProductDataFile = path.resolve(rootDir, job?.input?.feishuProductDataFile || "data/feishu/products.json");
  const processedManifestFile = path.resolve(rootDir, job?.input?.processedImageManifest || "data/auto-listing/processed-images.json");
  if (!fs.existsSync(feishuProductDataFile)) {
    return;
  }
  const records = safeLoadFeishuProductRecords(feishuProductDataFile);
  if (!records.length) {
    return;
  }
  const fingerprint = buildFeishuBatchFingerprint(records);
  migrateLegacyProcessedImagesToBatch(processedManifestFile, fingerprint);
}

function runFeishuAssetsRefreshForStart(): number | null {
  migrateLegacyProcessedManifestForCurrentCache();
  const result = spawnSync("npm", [
    "run",
    "feishu:assets",
    "--",
    "--config",
    "./input/feishu-bitable.config.json",
    "--out",
    "./data/feishu/products.json",
    "--cleanup-stale-assets"
  ], {
    cwd: rootDir,
    env: loadFeishuEnv(feishuConfigFile),
    encoding: "utf8"
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    const messagePrefix = "Feishu assets refresh failed before project controller start";
    const cacheValidationFailure = formatFeishuCacheValidationFailureForOperator(path.resolve(rootDir, "data/feishu/products.json"));
    throw new Error(`${messagePrefix}: ${cacheValidationFailure || compactStatusValue(output) || result.status || "unknown"}`);
  }
  return result.status;
}

function clearCurrentBatchProcessedImages(): boolean {
  const job = readJsonFile<AutoListingJobFile>(fullRealJobFile);
  const progress = summarizeFeishuProgress();
  const fingerprint = typeof progress?.batchFingerprint === "string" ? progress.batchFingerprint : "";
  const processedManifestFile = path.resolve(rootDir, job?.input?.processedImageManifest || "data/auto-listing/processed-images.json");
  return clearProcessedImagesForBatch(processedManifestFile, fingerprint);
}

function clearCurrentBatchPaidImageLedger(): boolean {
  const job = readJsonFile<AutoListingJobFile>(fullRealJobFile);
  const progress = summarizeFeishuProgress();
  const fingerprint = typeof progress?.batchFingerprint === "string" ? progress.batchFingerprint : "";
  if (!fingerprint) {
    return false;
  }
  const ledgerRoot = path.resolve(
    rootDir,
    job?.input?.paidImageSubmissionLedgerDir || "data/auto-listing/paid-image-submissions"
  );
  return removePaidImageBatchLedger(ledgerRoot, fingerprint);
}

function cleanupNonCurrentBatchResidue(currentBatchFingerprint: string): string[] {
  const removed: string[] = [];
  if (!currentBatchFingerprint) {
    return removed;
  }
  const pauseSignal = readPauseSignalFile();
  if (
    pauseSignal &&
    pauseSignal.reason === "batch_mismatch" &&
    pauseSignal.currentBatchFingerprint === currentBatchFingerprint &&
    pauseSignal.runtimeBatchFingerprint !== currentBatchFingerprint
  ) {
    fs.rmSync(pauseFile, { force: true });
    removed.push(pauseFile);
  }

  const resumeJob = readJsonFile<AutoListingJobFile>(resumeJobFile);
  const currentBusinessRuleFingerprint = buildAutoListingBusinessRuleFingerprint();
  if (
    resumeJob?.input &&
    (resumeJob.input.feishuBatchFingerprint !== currentBatchFingerprint ||
      resumeJob.input.businessRuleFingerprint !== currentBusinessRuleFingerprint)
  ) {
    fs.rmSync(resumeJobFile, { force: true });
    removed.push(resumeJobFile);
  }

  const runsDir = path.resolve(rootDir, "data/auto-listing/runs");
  removed.push(...removeInvalidRuntimeArtifactDirs({ runsDir, currentBatchFingerprint, currentBusinessRuleFingerprint }));

  const job = readJsonFile<AutoListingJobFile>(fullRealJobFile);
  const ledgerRoot = path.resolve(
    rootDir,
    job?.input?.paidImageSubmissionLedgerDir || "data/auto-listing/paid-image-submissions"
  );
  if (fs.existsSync(ledgerRoot)) {
    for (const entry of fs.readdirSync(ledgerRoot, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.name.startsWith(`${currentBatchFingerprint}-`)) {
        const ledgerDir = path.join(ledgerRoot, entry.name);
        fs.rmSync(ledgerDir, { recursive: true, force: true });
        removed.push(ledgerDir);
      }
    }
  }

  const processedManifestFile = path.resolve(rootDir, job?.input?.processedImageManifest || "data/auto-listing/processed-images.json");
  const manifest = readJsonFile<{ version?: number; currentBatchFingerprint?: string; batches?: Record<string, unknown> }>(processedManifestFile);
  if (manifest?.batches) {
    const nextBatches = Object.fromEntries(
      Object.entries(manifest.batches).filter(([fingerprint]) => fingerprint === currentBatchFingerprint)
    );
    if (
      manifest.currentBatchFingerprint !== currentBatchFingerprint ||
      Object.keys(nextBatches).length !== Object.keys(manifest.batches).length
    ) {
      atomicWriteJson(processedManifestFile, {
        ...manifest,
        currentBatchFingerprint,
        batches: nextBatches
      });
      removed.push(processedManifestFile);
    }
  }
  return removed;
}

function summarizeCurrentPaidImageProgress(input: {
  job?: AutoListingJobFile;
  batchFingerprint?: string;
  currentTask?: Record<string, unknown>;
  feishuCurrentProduct?: Record<string, unknown>;
}): PaidImageLedgerSummary | undefined {
  const batchFingerprint = input.batchFingerprint || "";
  const productRecord = input.currentTask?.feishuProductRecord as Record<string, unknown> | undefined;
  const recordId = resolveAutoListingControllerPaidImageRecordId({
    currentTaskRecordId:
      typeof input.currentTask?.recordId === "string"
        ? input.currentTask.recordId
        : typeof productRecord?.recordId === "string"
          ? productRecord.recordId
          : undefined,
    feishuCurrentProductRecordId:
      typeof input.feishuCurrentProduct?.recordId === "string" ? input.feishuCurrentProduct.recordId : undefined
  });
  if (!batchFingerprint || !recordId) {
    return undefined;
  }
  const ledgerRoot = path.resolve(
    rootDir,
    input.job?.input?.paidImageSubmissionLedgerDir || "data/auto-listing/paid-image-submissions"
  );
  const productDir = paidImageProductLedgerDir(ledgerRoot, batchFingerprint, recordId);
  if (!fs.existsSync(productDir)) {
    return undefined;
  }
  try {
    return summarizePaidImageProductLedger(productDir);
  } catch {
    return undefined;
  }
}

function summarizeCurrentFeishuBatchForResume(): { batchComplete: boolean; pendingSourceImages: string[] } | undefined {
  const progress = summarizeFeishuProgress();
  if (!progress) {
    return undefined;
  }
  const pendingSourceImages = Array.isArray(progress.pendingSourceImages)
    ? progress.pendingSourceImages.map((sourceImagePath) => path.resolve(rootDir, String(sourceImagePath)))
    : [];
  return {
    batchComplete: progress.batchComplete === true,
    pendingSourceImages
  };
}

function shouldResumeSourceImageForCurrentFeishuBatch(
  sourceImagePath: string | undefined,
  reusableArtifactCount = 0,
  resumeBatchFingerprint?: string
): boolean {
  const batch = summarizeCurrentFeishuBatchForResume();
  const progress = summarizeFeishuProgress();
  const currentBatchFingerprint = typeof progress?.batchFingerprint === "string" ? progress.batchFingerprint : undefined;
  if (
    !batch ||
    !canResumeFeishuBatchArtifacts({
      currentBatchFingerprint,
      resumeBatchFingerprint
    })
  ) {
    return false;
  }
  return shouldResumeHistoricalFailureForCurrentFeishuBatch({
    currentBatchFingerprint,
    resumeBatchFingerprint,
    failedSourceImagePath: sourceImagePath ? path.resolve(rootDir, sourceImagePath) : undefined,
    pendingSourceImages: batch.pendingSourceImages,
    batchComplete: batch.batchComplete,
    reusableArtifactCount
  });
}

function summarizeActiveDirectAutoListingStatus(directProcess: DirectAutoListingProcess): Record<string, unknown> {
  const directJob = readJsonFile<AutoListingJobFile>(directProcess.jobFile);
  const state = summarizeState(directProcess.runtimeDir);
  const currentTask = state?.currentTask as Record<string, unknown> | undefined;
  const publishProgress = summarizePublishProgress(directProcess.runtimeDir);
  const activePublishRunning = isActivePublishProgress(publishProgress);
  const imageProgress = summarizeImageGenerationProgress(
    directProcess.runtimeDir,
    typeof currentTask?.taskId === "string" ? String(currentTask.taskId) : undefined
  );
  const feishuProgress = summarizeFeishuProgress();
  const feishuProductDataFile = path.resolve(rootDir, directJob?.input?.feishuProductDataFile || "data/feishu/products.json");
  const feishuProductRecordsForStatus = fs.existsSync(feishuProductDataFile) ? safeLoadFeishuProductRecords(feishuProductDataFile) : [];
  const feishuCurrentProduct = feishuProductRecordsForStatus.length
    ? summarizeFeishuCurrentProduct({
        records: feishuProductRecordsForStatus,
        currentTask,
        publishProgress
      })
    : undefined;
  const paidImageProgress = summarizeCurrentPaidImageProgress({
    job: directJob,
    batchFingerprint:
      typeof state?.feishuBatchFingerprint === "string"
        ? String(state.feishuBatchFingerprint)
        : typeof feishuProgress?.batchFingerprint === "string"
          ? String(feishuProgress.batchFingerprint)
          : undefined,
    currentTask,
    feishuCurrentProduct
  });
  const stateSummary = state
    ? `任务正在运行，当前阶段：${String((state.latestProgress as Record<string, unknown> | undefined)?.step || currentTask?.status || state.status || "unknown")}` +
      ((state.latestProgress as Record<string, unknown> | undefined)?.message
        ? `，最新进度：${compactStatusValue(String((state.latestProgress as Record<string, unknown>).message))}`
        : "")
    : "直接启动的自动上架进程正在运行。";
  const directTerminalFailureMessage = String((currentTask?.error as Record<string, unknown> | undefined)?.message || "") || undefined;
  const directResolvedStatus = resolvePaidImageWaitStatus({
    baseStatus: "running",
    activeMainImageGeneration: String(currentTask?.status || (state?.latestProgress as Record<string, unknown> | undefined)?.step || "") === "main_images_generated",
    paidImageSubmitted: paidImageProgress?.submitted,
    publishProgressActive: activePublishRunning,
    terminalFailureMessage: directTerminalFailureMessage
  });
  return {
    ok: true,
    status: directResolvedStatus,
    pid: directProcess.pid,
    mode: "direct-auto-listing",
    command: directProcess.command,
    jobFile: directProcess.jobFile,
    activeRuntimeDir: directProcess.runtimeDir,
    statusSource: activePublishRunning ? "publish-manifest" : "state",
    state,
    imageProgress,
    paidImageProgress,
    publishProgress: activePublishRunning ? publishProgress : undefined,
    feishuProgress,
    feishuCurrentProduct,
    feishuBatchDisplayCounts: feishuProgress
      ? resolveAutoListingControllerFeishuBatchDisplayCounts({
          recordCount: Number(feishuProgress.recordCount || 0),
          processedRecordCount: Number(feishuProgress.processedRecordCount || 0),
          pendingSourceImages: Array.isArray(feishuProgress.pendingSourceImages)
            ? feishuProgress.pendingSourceImages.map((item) => path.resolve(rootDir, String(item)))
            : [],
          currentSourceImagePath:
            typeof currentTask?.sourceImagePath === "string" ? path.resolve(rootDir, String(currentTask.sourceImagePath)) : undefined
        })
      : undefined,
    summary: activePublishRunning ? publishProgress?.progressText || stateSummary : stateSummary
  };
}

function existingStatus(): Record<string, unknown> {
  const directProcess = findActiveDirectAutoListingProcess();
  if (directProcess?.runtimeDir) {
    return summarizeActiveDirectAutoListingStatus(directProcess);
  }
  const job = readJsonFile<RunnerJob>(jobFile);
  if (!job) {
    const latestResultFile = findLatestResultFile();
    const historicalResult = summarizeResult(latestResultFile);
    const historicalProcessedManifest =
      typeof ((historicalResult?.artifacts as Record<string, unknown> | undefined)?.processedImageManifest) === "string"
        ? String((historicalResult?.artifacts as Record<string, unknown>).processedImageManifest)
        : undefined;
    const feishuProgress = summarizeFeishuProgress(historicalProcessedManifest);
    const exposeHistoricalRuntime = shouldExposeHistoricalRuntimeForCurrentFeishuBatch({
      currentBatchFingerprint:
        typeof feishuProgress?.batchFingerprint === "string" ? String(feishuProgress.batchFingerprint) : undefined,
      historicalBatchFingerprint:
        typeof historicalResult?.feishuBatchFingerprint === "string" ? String(historicalResult.feishuBatchFingerprint) : undefined
    });
    const latestResult = exposeHistoricalRuntime ? historicalResult : undefined;
    const latestRuntimeDir = typeof latestResult?.runtimeDir === "string" ? latestResult.runtimeDir : latestResultFile ? path.dirname(latestResultFile) : undefined;
    const publishRuntimeDir =
      exposeHistoricalRuntime && latestRuntimeDir && fs.existsSync(path.join(latestRuntimeDir, "publish-manifest.json"))
        ? latestRuntimeDir
        : undefined;
    const publishProgress = summarizePublishProgress(publishRuntimeDir);
    const latestRuntimeProgressMtimeMs = Math.max(
      fileMtimeMs(publishRuntimeDir ? path.join(publishRuntimeDir, "publish-manifest.json") : undefined) || 0,
      fileMtimeMs(publishRuntimeDir ? path.join(publishRuntimeDir, "state.json") : undefined) || 0,
      fileMtimeMs(publishRuntimeDir ? path.join(publishRuntimeDir, "events.ndjson") : undefined) || 0
    );
    const activePublishRunning =
      Boolean(publishRuntimeDir && publishProgress && isActivePublishProgress(publishProgress)) &&
      latestRuntimeProgressMtimeMs > (fileMtimeMs(latestResultFile) || 0);
    const pauseSignal = maybeUpgradeLegacyPauseSignalForBatchMismatch({
      pauseSignal: readPauseSignalFile(),
      currentBatchFingerprint:
        typeof feishuProgress?.batchFingerprint === "string" ? String(feishuProgress.batchFingerprint) : undefined,
      runtimeBatchFingerprint:
        typeof historicalResult?.feishuBatchFingerprint === "string" ? String(historicalResult.feishuBatchFingerprint) : undefined,
      latestResult: historicalResult,
      runId: typeof historicalResult?.runId === "string" ? String(historicalResult.runId) : undefined
    });
    const idleStatus = resolveAutoListingControllerIdleStatus({
      pauseSignalExists: fs.existsSync(pauseFile),
      batchComplete: typeof feishuProgress?.batchComplete === "boolean" ? feishuProgress.batchComplete : undefined,
      latestResultOk: typeof latestResult?.ok === "boolean" ? latestResult.ok : undefined,
      latestResultStatus: typeof latestResult?.status === "string" ? latestResult.status : undefined
    });
    const latestResultTasks = Array.isArray(latestResult?.tasks) ? (latestResult.tasks as Array<Record<string, unknown>>) : [];
    const latestResultProductsForProgress = Array.isArray(latestResult?.products) ? (latestResult.products as Array<Record<string, unknown>>) : [];
    const latestResultDoneTaskCount = Math.max(
      latestResultTasks.filter((task) => ["done", "cleaned"].includes(String(task.status || ""))).length,
      latestResultProductsForProgress.filter((product) => ["done", "cleaned", "published"].includes(String(product.status || ""))).length
    );
    const latestResultDiscoveredCount = Array.isArray(latestResult?.discoveredImages) ? latestResult.discoveredImages.length : latestResultTasks.length;
    const feishuProgressReliable =
      !(latestResult?.ok === true && idleStatus === "pending_products" && Number(feishuProgress?.processedRecordCount || 0) < latestResultDoneTaskCount);
    const feishuCacheInvalid = feishuProgress?.cacheValid === false;
    const failForFeishuCacheInvalid = shouldFailAutoListingControllerStatusForFeishuCacheInvalid({
      feishuCacheInvalid,
      idleStatus,
      latestResultOk: typeof historicalResult?.ok === "boolean" ? historicalResult.ok : undefined,
      latestResultStatus: typeof historicalResult?.status === "string" ? historicalResult.status : undefined
    });
    const preserveCompletedForFeishuCacheInvalid = shouldPreserveAutoListingControllerCompletedStatusForFeishuCacheInvalid({
      feishuCacheInvalid,
      latestResultOk: typeof historicalResult?.ok === "boolean" ? historicalResult.ok : undefined,
      latestResultStatus: typeof historicalResult?.status === "string" ? historicalResult.status : undefined
    });
    const status = failForFeishuCacheInvalid
      ? "failed"
      : activePublishRunning
        ? "running"
        : preserveCompletedForFeishuCacheInvalid
          ? "completed"
          : idleStatus;
    const interrupted = status === "pause_requested" ? findLatestInterruptedStateForResume() : undefined;
    const activePublishState = activePublishRunning ? summarizeState(publishRuntimeDir) : undefined;
    const interruptedState = activePublishState || summarizeState(interrupted?.runtimeDir);
    const interruptedCurrentTask = interruptedState?.currentTask as Record<string, unknown> | undefined;
    const interruptedImageProgress = summarizeImageGenerationProgress(
      interrupted?.runtimeDir,
      typeof interruptedCurrentTask?.taskId === "string" ? String(interruptedCurrentTask.taskId) : undefined
    );
    const interruptedPaidImageProgress = summarizeCurrentPaidImageProgress({
      batchFingerprint:
        typeof interruptedState?.feishuBatchFingerprint === "string" ? String(interruptedState.feishuBatchFingerprint) : undefined,
      currentTask: interruptedCurrentTask,
      feishuCurrentProduct: undefined
    });
    const latestResultProducts = Array.isArray(latestResult?.products) ? (latestResult.products as Array<Record<string, unknown>>) : [];
    const failedResultProduct = latestResultProducts.find((product) => product.status === "failed" || product.error);
    const discoveredImages = Array.isArray(latestResult?.discoveredImages)
      ? latestResult.discoveredImages.map((item) => path.resolve(rootDir, String(item)))
      : [];
    const failedSourceImagePath =
      typeof failedResultProduct?.sourceImageName === "string"
        ? discoveredImages.find((item) => path.basename(item) === String(failedResultProduct.sourceImageName))
        : undefined;
    const feishuProductDataFile = path.resolve(rootDir, "data/feishu/products.json");
    const feishuProductRecordsForStatus = fs.existsSync(feishuProductDataFile) ? safeLoadFeishuProductRecords(feishuProductDataFile) : [];
    const activeFeishuCurrentProduct =
      activePublishRunning && feishuProductRecordsForStatus.length
        ? summarizeFeishuCurrentProduct({
            records: feishuProductRecordsForStatus,
            currentTask: interruptedCurrentTask,
            publishProgress
          })
        : undefined;
    const failedFeishuCurrentProduct =
      !activeFeishuCurrentProduct && failedSourceImagePath && feishuProductRecordsForStatus.length
        ? summarizeFeishuCurrentProduct({
            records: feishuProductRecordsForStatus,
            currentTask: { sourceImagePath: failedSourceImagePath }
          })
        : undefined;
    return {
      ok: true,
      status,
      jobFile,
      latestResult: activePublishRunning ? undefined : latestResult,
      activeRuntimeDir: publishRuntimeDir || interrupted?.runtimeDir,
      statusSource: activePublishRunning ? "publish-manifest" : interruptedState ? "state" : "idle",
      historicalRuntimeSuppressed: !exposeHistoricalRuntime && Boolean(historicalResult),
      pauseSignal,
      publishProgress: activePublishRunning ? publishProgress : undefined,
      state: interruptedState,
      imageProgress: interruptedImageProgress,
      paidImageProgress: interruptedPaidImageProgress,
      feishuProgress,
      feishuProgressReliable,
      feishuCurrentProduct: activeFeishuCurrentProduct || failedFeishuCurrentProduct,
      feishuBatchDisplayCounts: feishuProgress
        ? resolveAutoListingControllerFeishuBatchDisplayCounts({
            recordCount: Number(feishuProgress.recordCount || 0),
            processedRecordCount: Number(feishuProgress.processedRecordCount || 0),
            pendingSourceImages: Array.isArray(feishuProgress.pendingSourceImages)
              ? feishuProgress.pendingSourceImages.map((item) => path.resolve(rootDir, String(item)))
              : [],
            currentSourceImagePath:
              failedSourceImagePath ||
              (typeof interruptedCurrentTask?.sourceImagePath === "string"
                ? path.resolve(rootDir, String(interruptedCurrentTask.sourceImagePath))
                : undefined)
          })
        : undefined,
      summary:
        activePublishRunning
          ? publishProgress?.progressText || "手动恢复发布正在运行。"
          : failForFeishuCacheInvalid
          ? String(feishuProgress?.validationIssue || "飞书缓存校验失败，开始上架前必须修复当前批次数据。")
          : status === "pause_requested"
          ? formatPauseSignalSummary(pauseSignal)
          : status === "completed"
          ? "当前飞书批次已全部处理完成。"
          : status === "pending_products"
            ? latestResult?.ok === true && latestResultDoneTaskCount > 0
              ? `最近运行已完成 ${latestResultDoneTaskCount}/${latestResultDiscoveredCount || latestResultDoneTaskCount} 个产品；当前飞书批次仍有待处理产品。`
              : "当前飞书批次仍有待处理产品。"
            : undefined
    };
  }
  const running = isRunnerJobRunning(job);
  const waitState = readJsonFile<ExternalServiceWait>(externalServiceWaitFile);
  const activeWaitState =
    running && waitState?.status === "external_service_wait" && waitState.supervisorPid === job.pid
      ? waitState
      : undefined;
  const activeRuntimeDir = findActiveRuntimeDirFromLog(job.logFile);
  const activeResultFile = activeRuntimeDir ? path.join(activeRuntimeDir, "result.json") : undefined;
  const latestResultFile = running
    ? undefined
    : selectAutoListingControllerLatestResultFileForJobStatus({
        hasControlJob: Boolean(job),
        latestResultFile: findLatestResultFile()
      });
  const resultFile = selectAutoListingControllerStatusResultFile({
    running,
    expected: shouldUseExpectedResultFileInRunningStatus({ running, activeRuntimeDir })
      ? {
          resultFile: job.expectedResultFile,
          mtimeMs: fileMtimeMs(job.expectedResultFile)
        }
      : undefined,
    log: {
      resultFile: activeResultFile && fs.existsSync(activeResultFile) ? activeResultFile : undefined,
      mtimeMs: fileMtimeMs(activeResultFile)
    },
    latest: {
      resultFile: latestResultFile,
      mtimeMs: fileMtimeMs(latestResultFile)
    }
  });
  const result = summarizeResult(resultFile);
  const runtimeDir = selectAutoListingControllerStatusRuntimeDir({
    running,
    activeRuntimeDir,
    resultRuntimeDir: typeof result?.runtimeDir === "string" ? result.runtimeDir : undefined,
    resultFile
  });
  const publishProgress = summarizePublishProgress(runtimeDir);
  const feishuProgress = summarizeFeishuProgress();
  const state = summarizeState(runtimeDir);
  const runtimeBatchFingerprint =
    (typeof state?.feishuBatchFingerprint === "string" ? String(state.feishuBatchFingerprint) : undefined) ||
    (typeof result?.feishuBatchFingerprint === "string" ? String(result.feishuBatchFingerprint) : undefined) ||
    job.batchFingerprint;
  const runtimeMatchesCurrentBatch = shouldExposeHistoricalRuntimeForCurrentFeishuBatch({
    currentBatchFingerprint:
      typeof feishuProgress?.batchFingerprint === "string" ? String(feishuProgress.batchFingerprint) : undefined,
    historicalBatchFingerprint: runtimeBatchFingerprint
  });
  if (!runtimeMatchesCurrentBatch) {
    if (!running) {
      fs.rmSync(jobFile, { force: true });
      return existingStatus();
    }
    const pauseSignal = writePauseSignalFile({
      reason: "batch_mismatch",
      message: "运行中的控制器批次指纹与当前飞书缓存不一致；已请求在安全边界暂停，并停止展示和复用该运行证据。",
      currentBatchFingerprint:
        typeof feishuProgress?.batchFingerprint === "string" ? String(feishuProgress.batchFingerprint) : undefined,
      runtimeBatchFingerprint,
      runId: activeRuntimeDir ? path.basename(activeRuntimeDir) : undefined,
      pid: job.pid
    });
    return {
      ok: true,
      status: "failed",
      pid: job.pid,
      mode: job.mode,
      startedAt: job.startedAt,
      jobFile,
      historicalRuntimeSuppressed: true,
      pauseSignal,
      feishuProgress,
      summary: formatPauseSignalSummary(pauseSignal)
    };
  }
  const publishLogProgress = summarizePublishLogProgress(job.logFile);
  const currentTask = state?.currentTask as Record<string, unknown> | undefined;
  const fullJob = readJsonFile<AutoListingJobFile>(fullRealJobFile);
  const feishuProductDataFile = path.resolve(rootDir, fullJob?.input?.feishuProductDataFile || "data/feishu/products.json");
  const feishuProductRecordsForStatus = fs.existsSync(feishuProductDataFile) ? safeLoadFeishuProductRecords(feishuProductDataFile) : [];
  const feishuCurrentProduct = feishuProductRecordsForStatus.length
    ? summarizeFeishuCurrentProduct({
        records: feishuProductRecordsForStatus,
        currentTask,
        publishProgress
      })
    : undefined;
  const imageProgress = summarizeImageGenerationProgress(runtimeDir, currentTask?.taskId ? String(currentTask.taskId) : undefined);
  const paidImageProgress = summarizeCurrentPaidImageProgress({
    job: fullJob,
    batchFingerprint:
      typeof feishuProgress?.batchFingerprint === "string" ? String(feishuProgress.batchFingerprint) : undefined,
    currentTask,
    feishuCurrentProduct
  });
  const activeResumeReusableArtifactCount =
    job.mode === "resume-real-job" && runtimeDir && currentTask?.taskId
      ? summarizeReusableTaskArtifacts({ runtimeDir, taskId: String(currentTask.taskId) }).reusableArtifactCount
      : 0;
  const preferStateSummary = shouldPreferActiveTaskStateSummary({
    running,
    stateHasActiveTask: Boolean(state),
    publishProgressAvailable: Boolean(publishProgress)
  });
  const latestArtifactUpdatedAt = (publishProgress?.latestArtifact as Record<string, unknown> | undefined)?.updatedAt;
  const activePublishUpdatedAt = (publishProgress?.active as Record<string, unknown> | undefined)?.updatedAt;
  const latestPublishedUpdatedAt = (publishProgress?.latestPublished as Record<string, unknown> | undefined)?.updatedAt;
  const latestStateProgressAt = (state?.latestProgress as Record<string, unknown> | undefined)?.timestamp;
  const publishProgressTimestamp =
    typeof activePublishUpdatedAt === "string"
      ? activePublishUpdatedAt
      : typeof latestArtifactUpdatedAt === "string"
        ? latestArtifactUpdatedAt
        : typeof latestPublishedUpdatedAt === "string"
          ? latestPublishedUpdatedAt
          : undefined;
  const exposePublishProgress = shouldExposePublishProgressInAutoListingControllerStatus({
    running,
    publishProgressAvailable: Boolean(publishProgress),
    currentTaskStatus: String((state?.currentTask as Record<string, unknown> | undefined)?.status || ""),
    stateProgressTimestamp: typeof latestStateProgressAt === "string" ? latestStateProgressAt : undefined,
    publishProgressTimestamp
  });
  const effectiveProgress = resolveAutoListingControllerEffectiveProgressTimestamp({
    stateProgressTimestamp: typeof latestStateProgressAt === "string" ? latestStateProgressAt : undefined,
    activePublishUpdatedAt: exposePublishProgress && typeof activePublishUpdatedAt === "string" ? activePublishUpdatedAt : undefined,
    latestArtifactUpdatedAt: exposePublishProgress && typeof latestArtifactUpdatedAt === "string" ? latestArtifactUpdatedAt : undefined,
    latestPublishedUpdatedAt: exposePublishProgress && typeof latestPublishedUpdatedAt === "string" ? latestPublishedUpdatedAt : undefined
  });
  const progressHeartbeat = effectiveProgress
    ? {
        ...effectiveProgress,
        ageSeconds: resolveAutoListingControllerProgressAgeSeconds({
          nowIso: new Date().toISOString(),
          latestProgressTimestamp: effectiveProgress.timestamp
        })
      }
    : undefined;
  const publishProgressHasNewerActive =
    exposePublishProgress &&
    Boolean(activePublishUpdatedAt) &&
    (!latestStateProgressAt || Date.parse(String(activePublishUpdatedAt)) > Date.parse(String(latestStateProgressAt)));
  const publishProgressHasNewerArtifact =
    exposePublishProgress &&
    Boolean(latestArtifactUpdatedAt) &&
    (!latestStateProgressAt || Date.parse(String(latestArtifactUpdatedAt)) > Date.parse(String(latestStateProgressAt)));
  const shouldUsePublishRealtime = publishProgressHasNewerActive || publishProgressHasNewerArtifact || !preferStateSummary;
  const activePublishRuntimeKey = String((publishProgress?.active as Record<string, unknown> | undefined)?.runtimeKey || "");
  const manualRecoveryPublishRunning =
    /__manual-republish-\d+__/i.test(activePublishRuntimeKey) &&
    Number(publishProgress?.pending || 0) > 0 &&
    Boolean(publishProgressTimestamp) &&
    (!latestStateProgressAt || Date.parse(String(publishProgressTimestamp)) > Date.parse(String(latestStateProgressAt)));
  const batchComplete = feishuProgress ? feishuProgress.batchComplete === true : true;
  const feishuProgressDisplayMode = resolveAutoListingControllerFeishuProgressDisplayMode({
    running,
    mode: job.mode,
    batchComplete,
    activeResumeReusableArtifactCount
  });
  const completed =
    !running &&
    batchComplete &&
    ((result?.ok === true && String(result.status || "") !== "failed") ||
      (state?.status === "completed") ||
      (publishProgress && publishProgress.total === publishProgress.safelyPublished && publishProgress.failed === 0));
  const childFailureMessage = !running ? latestAutoListingChildFailureFromLog(job.logFile) : undefined;
  const failed =
    !running &&
    !completed &&
    ((result && result.ok === false) ||
      (state?.status === "failed") ||
      (publishProgress && Number(publishProgress.failed || 0) > 0) ||
      Boolean(childFailureMessage));
  const hasPendingFeishuProducts = !running && !batchComplete;
  const resultError = result?.error as Record<string, unknown> | undefined;
  const stateError = (state?.currentTask as Record<string, unknown> | undefined)?.error as Record<string, unknown> | undefined;
  const resultFailureText = resultError
    ? [resultError.step, resultError.message].filter(Boolean).map(String).join(": ")
    : undefined;
  const stateFailureText = stateError ? [stateError.step, stateError.message].filter(Boolean).map(String).join(": ") : undefined;
  const terminalFailureMtimeMs = fileMtimeMs(resultFile);
  const suppressTerminalFailureForNewerProgress = shouldSuppressTerminalFailureBehindNewerProgress({
    running,
    terminalFailureMtimeMs,
    latestProgressTimestamp: typeof latestStateProgressAt === "string" ? latestStateProgressAt : undefined
  });
  const terminalFailureMessage =
    !suppressTerminalFailureForNewerProgress && running && ((result && (result.ok === false || result.status === "failed")) || state?.status === "failed")
      ? compactStatusValue(resultFailureText || stateFailureText || "")
      : childFailureMessage
        ? compactStatusValue(childFailureMessage)
        : undefined;
  const baseResolvedStatus = resolveAutoListingControllerRuntimeStatus({
    running,
    activeWaitState: Boolean(activeWaitState),
    pauseSignalExists: fs.existsSync(pauseFile),
    completed: Boolean(completed),
    failed: Boolean(failed),
    hasPendingFeishuProducts,
    stateStatus: typeof state?.status === "string" ? state.status : undefined,
    resultStatus: typeof result?.status === "string" ? result.status : undefined,
    terminalFailureMessage
  });
  const paidImageResolvedStatus = resolvePaidImageWaitStatus({
    baseStatus: baseResolvedStatus,
    activeMainImageGeneration: String(currentTask?.status || (state?.latestProgress as Record<string, unknown> | undefined)?.step || "") === "main_images_generated",
    paidImageSubmitted: typeof paidImageProgress?.submitted === "number" ? Number(paidImageProgress.submitted) : 0,
    publishProgressActive: exposePublishProgress,
    terminalFailureMessage
  });
  const resolvedStatus =
    manualRecoveryPublishRunning && paidImageResolvedStatus !== "completed" && paidImageResolvedStatus !== "failed"
      ? "running"
      : paidImageResolvedStatus;
  const pauseSignal = readPauseSignalFile();
  const terminalResult = resolvedStatus === "completed" ? "completed" : resolvedStatus === "failed" ? "failed" : undefined;
  const closure = resolveControllerJobClosure({
    declaredStatus: job.status,
    processAlive: running,
    terminalResult
  });
  if (closure.action === "write_terminal" && job.status !== closure.status) {
    atomicWriteJson(jobFile, { ...job, status: closure.status, finishedAt: new Date().toISOString() });
  } else if (closure.action === "clear_stale") {
    fs.rmSync(jobFile, { force: true });
  }
  const suppressHistoricalResult = shouldSuppressHistoricalResultInAutoListingControllerStatus({
    running,
    publishProgressAvailable: exposePublishProgress,
    resultOk: typeof result?.ok === "boolean" ? result.ok : undefined,
    resultStatus: typeof result?.status === "string" ? result.status : undefined,
    activeRuntimeDir,
    resultRuntimeDir: typeof result?.runtimeDir === "string" ? result.runtimeDir : undefined
  });
  const suppressStateCurrentTask = shouldSuppressStateCurrentTaskInAutoListingControllerStatus({
    running,
    publishProgressAvailable: exposePublishProgress,
    latestProgressStep: String((state?.latestProgress as Record<string, unknown> | undefined)?.step || ""),
    currentTaskStatus: String((state?.currentTask as Record<string, unknown> | undefined)?.status || "")
  });
  const statusState =
    state && suppressStateCurrentTask
      ? {
          ...state,
          currentTask: undefined,
          latestProgress: undefined,
          note: "运行中发布进度以 publishProgress 为准；state.currentTask 来自旧任务状态，已从状态载荷中隐藏以避免误判。"
        }
      : state;
  const shouldExposeImageProgressInSummary = !exposePublishProgress || !publishProgress;
  const imageProgressSummaryMessage =
    shouldExposeImageProgressInSummary && typeof (imageProgress as Record<string, unknown> | undefined)?.latestMessage === "string"
      ? String((imageProgress as Record<string, unknown>).latestMessage)
      : undefined;
  const stateSummary = state
    ? `任务${resolvedStatus === "running" ? "正在运行" : "已结束"}，当前阶段：${String((state.latestProgress as Record<string, unknown> | undefined)?.step || (state.currentTask as Record<string, unknown> | undefined)?.status || state.status || "unknown")}` +
      (imageProgressSummaryMessage
        ? `，最新进度：${compactStatusValue(imageProgressSummaryMessage)}`
        : (state.latestProgress as Record<string, unknown> | undefined)?.message
          ? `，最新进度：${compactStatusValue(String((state.latestProgress as Record<string, unknown>).message))}`
        : "")
    : undefined;
  const failedError = stateError || resultError;
  const failureSummary = failedError?.message
    ? compactStatusValue(String(failedError.message))
    : terminalFailureMessage;
  const externalWaitReason = activeWaitState?.reason || terminalFailureMessage;
  const terminalRealtimeMessage =
    resolvedStatus === "failed"
      ? compactAutoListingTerminalFailureMessage(failureSummary || "自动上架失败，请查看项目终态结果。")
      : resolvedStatus === "external_service_wait" && terminalFailureMessage
        ? `图片服务暂时不可用：${terminalFailureMessage}`
        : undefined;
  const publishGroupProgress = publishProgress?.publishGroupProgress as Record<string, unknown> | undefined;
  const realtimeProgress = resolveAutoListingControllerRealtimeProgressSignal({
    jobStartedAt: job.startedAt,
    activeRunId: activeRuntimeDir ? path.basename(activeRuntimeDir) : typeof result?.runId === "string" ? result.runId : undefined,
    status: resolvedStatus,
    preferStatusMessage: Boolean(terminalRealtimeMessage),
    statusMessage: terminalRealtimeMessage,
    statusTimestamp: terminalFailureMtimeMs ? new Date(terminalFailureMtimeMs).toISOString() : undefined,
    statusSource:
      shouldUsePublishRealtime
        ? publishProgress
          ? "publish-manifest"
          : state
            ? "state"
            : "result-log"
        : "state",
    publishSafelyPublished: Number(publishProgress?.safelyPublished ?? 0),
    publishTotal: publishProgress?.total === undefined ? undefined : Number(publishProgress.total),
    publishFailed: typeof publishGroupProgress?.failed === "number" ? Number(publishGroupProgress.failed) : Number(publishProgress?.failed ?? 0),
    publishProductIndex: publishGroupProgress?.productIndex === undefined ? undefined : Number(publishGroupProgress.productIndex),
    publishProductTotal: publishGroupProgress?.productTotal === undefined ? undefined : Number(publishGroupProgress.productTotal),
    publishShopIndex: publishGroupProgress?.shopIndex === undefined ? undefined : Number(publishGroupProgress.shopIndex),
    publishShopTotal: publishGroupProgress?.shopTotal === undefined ? undefined : Number(publishGroupProgress.shopTotal),
    publishActiveRuntimeKey: shouldUsePublishRealtime
      ? String((publishProgress?.active as Record<string, unknown> | undefined)?.runtimeKey || "")
      : undefined,
    publishActiveUpdatedAt:
      shouldUsePublishRealtime && typeof activePublishUpdatedAt === "string" ? activePublishUpdatedAt : undefined,
    publishActiveMessage:
      shouldUsePublishRealtime && typeof (publishProgress?.active as Record<string, unknown> | undefined)?.message === "string"
        ? String((publishProgress?.active as Record<string, unknown>).message)
        : undefined,
    latestArtifactUpdatedAt:
      shouldUsePublishRealtime && typeof latestArtifactUpdatedAt === "string" ? latestArtifactUpdatedAt : undefined,
    latestArtifactName:
      shouldUsePublishRealtime && typeof (publishProgress?.latestArtifact as Record<string, unknown> | undefined)?.name === "string"
        ? String((publishProgress?.latestArtifact as Record<string, unknown>).name)
        : undefined,
    publishLogTimestamp:
      shouldUsePublishRealtime && typeof publishLogProgress?.timestamp === "string" ? String(publishLogProgress.timestamp) : undefined,
    publishLogMessage:
      shouldUsePublishRealtime && typeof publishLogProgress?.message === "string" ? String(publishLogProgress.message) : undefined,
    stateLatestProgressTimestamp:
      typeof latestStateProgressAt === "string" ? latestStateProgressAt : undefined,
    stateLatestProgressMessage:
      typeof (state?.latestProgress as Record<string, unknown> | undefined)?.message === "string"
        ? String((state?.latestProgress as Record<string, unknown>).message)
        : undefined
  });
  return {
    ok: true,
    status: resolvedStatus,
    pid: job.pid,
    mode: job.mode,
    startedAt: job.startedAt,
    command: [job.command, ...job.args].join(" "),
    logFile: job.logFile,
    jobFile,
    activeRuntimeDir,
    statusSource: shouldUsePublishRealtime ? (publishProgress ? "publish-manifest" : state ? "state" : "result-log") : "state",
    summary:
      (resolvedStatus === "pause_requested"
        ? formatPauseSignalSummary(pauseSignal)
        : resolvedStatus === "external_service_wait"
        ? formatAutoListingControllerExternalServiceWaitSummary({
            retryAt: activeWaitState?.retryAt,
            nowMs: Date.now(),
            reason: externalWaitReason
          })
        : resolvedStatus === "failed"
        ? failureSummary || stateSummary
        : shouldUsePublishRealtime
          ? publishProgress?.progressText || stateSummary
          : stateSummary) ||
      (running
          ? "任务正在运行，尚未写入发布进度。"
          : "任务进程已退出，查看 result 字段确认最终结果。"),
    resultNote:
      running && exposePublishProgress
        ? "进程仍在运行时历史 result.json 可能保留上一次失败内容；实时进度以 publishProgress/publish-manifest 为准，历史失败 result 已从状态载荷中隐藏。"
        : undefined,
    result: suppressHistoricalResult ? undefined : result,
    externalServiceWait: activeWaitState,
    pauseSignal,
    state: statusState,
    progressHeartbeat,
    realtimeProgress,
    imageProgress,
    paidImageProgress,
    publishLogProgress,
    publishProgress: exposePublishProgress ? publishProgress : undefined,
    feishuProgress,
    feishuCurrentProduct,
    feishuProgressDisplayMode,
    feishuBatchDisplayCounts: feishuProgress
      ? resolveAutoListingControllerFeishuBatchDisplayCounts({
          recordCount: Number(feishuProgress.recordCount || 0),
          processedRecordCount: Number(feishuProgress.processedRecordCount || 0),
          pendingSourceImages: Array.isArray(feishuProgress.pendingSourceImages)
            ? feishuProgress.pendingSourceImages.map((item) => path.resolve(rootDir, String(item)))
            : [],
          currentSourceImagePath:
            typeof currentTask?.sourceImagePath === "string" ? path.resolve(rootDir, currentTask.sourceImagePath) : undefined
        })
      : undefined,
    activeResumeReusableArtifactCount,
    logTail: tailFile(job.logFile, 12).map(compactStatusLine)
  };
}

function formatStatusText(status: Record<string, unknown>): string {
  const state = status.state as Record<string, unknown> | undefined;
  const progress = status.publishProgress as Record<string, unknown> | undefined;
  const feishuProgress = status.feishuProgress as Record<string, unknown> | undefined;
  const feishuCurrentProduct = status.feishuCurrentProduct as Record<string, unknown> | undefined;
  const latestResult = status.latestResult as Record<string, unknown> | undefined;
  const counts = status.feishuBatchDisplayCounts as Record<string, unknown> | undefined;
  const currentTask = state?.currentTask as Record<string, unknown> | undefined;
  const latestProgress = state?.latestProgress as Record<string, unknown> | undefined;
  const publishLogProgress = status.publishLogProgress as Record<string, unknown> | undefined;
  const paidImageProgress = status.paidImageProgress as Record<string, unknown> | undefined;
  const active = progress?.active as Record<string, unknown> | undefined;
  const publishGroupProgress = progress?.publishGroupProgress as Record<string, unknown> | undefined;
  const latestArtifact = progress?.latestArtifact as Record<string, unknown> | undefined;
  const artifactIsNewerThanActive =
    typeof latestArtifact?.updatedAt === "string" &&
    (!active?.updatedAt || Date.parse(String(latestArtifact.updatedAt)) > Date.parse(String(active.updatedAt)));
  const publishArtifactMessage =
    artifactIsNewerThanActive && typeof latestArtifact?.name === "string"
      ? `最近产物：${String(latestArtifact.name)}`
      : undefined;
  const publishActiveMessage = publishArtifactMessage || (typeof active?.message === "string" ? compactStatusValue(String(active.message)) : undefined);
  const latestResultError = latestResult?.error as Record<string, unknown> | undefined;
  const latestResultProducts = Array.isArray(latestResult?.products) ? (latestResult.products as Array<Record<string, unknown>>) : [];
  const failedResultProduct = latestResultProducts.find((product) => product.status === "failed" || product.error);
  const latestResultFailureMessage =
    String(status.status || "") === "failed" && typeof latestResultError?.message === "string"
      ? compactStatusValue(String(latestResultError.message))
      : undefined;
  const latestProgressText =
    publishActiveMessage ||
    (typeof publishLogProgress?.message === "string"
      ? String(publishLogProgress.message)
      : latestProgress?.message
        ? compactStatusValue(String(latestProgress.message))
        : latestResultFailureMessage);
  const shouldExposeImageGenerationProgress = !progress;
  const imageGenerationProgressMessage =
    shouldExposeImageGenerationProgress && typeof (status.imageProgress as Record<string, unknown> | undefined)?.latestMessage === "string"
      ? String((status.imageProgress as Record<string, unknown>).latestMessage)
      : shouldExposeImageGenerationProgress &&
          String(currentTask?.status || "") === "main_images_generated" &&
          typeof paidImageProgress?.completed === "number"
        ? `Main images ready: ${Number(paidImageProgress.completed)} file(s).`
        : undefined;
  return formatAutoListingControllerCompactStatusText({
    status: String(status.status || "unknown"),
    showPublishProgress: Boolean(progress || currentTask || publishLogProgress),
    summary: String(status.summary || latestResultFailureMessage || ""),
    productName:
      typeof publishGroupProgress?.productName === "string"
        ? String(publishGroupProgress.productName)
        : currentTask?.sourceImageName
          ? String(currentTask.sourceImageName)
          : typeof failedResultProduct?.sourceImageName === "string"
            ? String(failedResultProduct.sourceImageName)
          : undefined,
    activeItemName: active?.productFolder ? path.basename(String(active.productFolder)) : undefined,
    latestProgress: latestProgressText,
    imageGenerationProgress: imageGenerationProgressMessage,
    mainImageCompleted:
      shouldExposeImageGenerationProgress && typeof paidImageProgress?.completed === "number"
        ? Number(paidImageProgress.completed)
        : undefined,
    mainImageExpected:
      shouldExposeImageGenerationProgress && typeof paidImageProgress?.expectedSlotCount === "number" ? Number(paidImageProgress.expectedSlotCount) : undefined,
    publishSafelyPublished: Number(progress?.safelyPublished ?? 0),
    publishTotal: progress?.total === undefined ? undefined : Number(progress.total),
    publishFailed: Number(progress?.failed ?? 0),
    publishProductIndex:
      typeof publishGroupProgress?.productIndex === "number" ? Number(publishGroupProgress.productIndex) : undefined,
    publishProductTotal:
      typeof publishGroupProgress?.productTotal === "number" ? Number(publishGroupProgress.productTotal) : undefined,
    publishShopIndex:
      typeof publishGroupProgress?.shopIndex === "number" ? Number(publishGroupProgress.shopIndex) : undefined,
    publishShopTotal:
      typeof publishGroupProgress?.shopTotal === "number" ? Number(publishGroupProgress.shopTotal) : undefined,
    publishFailedWatermarkNo:
      typeof publishGroupProgress?.failedWatermarkNo === "number" ? Number(publishGroupProgress.failedWatermarkNo) : undefined,
    publishReviewWatermarkNo:
      typeof publishGroupProgress?.reviewWatermarkNo === "number" ? Number(publishGroupProgress.reviewWatermarkNo) : undefined,
    publishLatestAttemptedWatermarkNo:
      typeof publishGroupProgress?.latestAttemptedWatermarkNo === "number" ? Number(publishGroupProgress.latestAttemptedWatermarkNo) : undefined,
    feishuProductIndex:
      status.feishuProgressReliable === false ? undefined : typeof feishuCurrentProduct?.current === "number" ? Number(feishuCurrentProduct.current) : undefined,
    feishuCompleted:
      status.feishuProgressReliable === false
        ? undefined
        : counts?.completedCount === undefined ? Number(feishuProgress?.processedRecordCount ?? 0) : Number(counts.completedCount),
    feishuTotal:
      status.feishuProgressReliable === false
        ? undefined
        : counts?.recordCount === undefined ? Number(feishuProgress?.recordCount ?? 0) : Number(counts.recordCount)
  });
}

function writePauseSignal(): Record<string, unknown> {
  const pauseSignal = writePauseSignalFile({
    reason: "operator",
    message: "项目已收到手动暂停请求；任务会在安全边界停止并保留当前产物。继续上架会清除暂停信号并从安全断点续跑。"
  });
  return {
    ok: true,
    status: "pause_requested",
    pauseFile,
    pauseSignal,
    message: pauseSignal.message
  };
}

function clearPauseSignal(): Record<string, unknown> {
  fs.rmSync(pauseFile, { force: true });
  return {
    ok: true,
    status: "resume_ready",
    pauseFile,
    message: "暂停信号已清除；下一次开始/继续上架将由项目控制器安全续跑。"
  };
}

function formatStartText(result: Record<string, unknown>): string {
  const status = String(result.status || "unknown");
  if (status === "already_running") {
    return [
      "上架任务已在运行。",
      result.summary ? `摘要：${String(result.summary)}` : undefined,
      result.pid ? `PID：${String(result.pid)}` : undefined,
      result.logFile ? `日志：${String(result.logFile)}` : undefined
    ].filter(Boolean).join("\n");
  }
  if (status === "started") {
    return [
      "已启动新的上架后台任务。",
      result.mode ? `模式：${String(result.mode)}` : undefined,
      result.pid ? `PID：${String(result.pid)}` : undefined,
      result.logFile ? `日志：${String(result.logFile)}` : undefined
    ].filter(Boolean).join("\n");
  }
  if (status === "would_start") {
    return `将启动上架任务：${String(result.command || "")}`;
  }
  if (status === "rerun_confirmation_required") {
    return [
      "当前飞书批次产品已全部上架完成，刷新后没有发现新的产品批次。",
      "如需重新跑原批次，请确认后使用重跑当前批次入口；否则任务会停止等待你更新飞书表格。"
    ].join("\n");
  }
  return String(result.message || `上架启动命令已执行：${status}`);
}

function shouldResumeCurrentFailure(): boolean {
  const resumeJob = readJsonFile<AutoListingJobFile>(resumeJobFile);
  if (resumeJob?.input?.businessRuleFingerprint !== buildAutoListingBusinessRuleFingerprint()) {
    fs.rmSync(resumeJobFile, { force: true });
    return false;
  }
  const startStep = resumeJob?.input?.startStep || resumeJob?.startStep;
  if (!startStep || startStep === "done") {
    return false;
  }

  const resumeSourceImagePath = resumeJob?.input?.resumeSourceImagePath;
  if (!resumeSourceImagePath || !fs.existsSync(path.resolve(rootDir, resumeSourceImagePath))) {
    return false;
  }
  const resumeRuntimeDir = path.resolve(rootDir, resumeJob.runtimeDir || path.dirname(path.resolve(rootDir, resumeJob.resultFile || "")));
  if (
    resumeJob.input?.resumeTaskId &&
    hasIncompleteFixedMainImageRoundFiles({
      runtimeDir: resumeRuntimeDir,
      taskId: resumeJob.input.resumeTaskId,
      expectedImagesPerRound: 4
    })
  ) {
    fs.rmSync(resumeJobFile, { force: true });
    return false;
  }
  const state = readJsonFile<AutoListingStateFile>(path.join(resumeRuntimeDir, "state.json"));
  const stateTask = (state?.tasks || []).find((task) =>
    (resumeJob.input?.resumeTaskId && task.taskId === resumeJob.input.resumeTaskId) ||
    (task.sourceImagePath && path.resolve(rootDir, task.sourceImagePath) === path.resolve(rootDir, resumeSourceImagePath))
  );
  if (stateTask && resumeJob.input?.resumeProductFolderNames?.length) {
    const resolvedShopRootDir = resolveResumeShopRootDir({
      sourceJob: resumeJob,
      task: stateTask,
      batchFingerprint: resumeJob.input.feishuBatchFingerprint || state?.feishuBatchFingerprint,
      productFolderNames: resumeJob.input.resumeProductFolderNames
    });
    if (resolvedShopRootDir && resolvedShopRootDir !== resumeJob.input.shopRootDir) {
      resumeJob.input.shopRootDir = resolvedShopRootDir;
      atomicWriteJson(resumeJobFile, resumeJob);
    }
  }
  const resumeProductFolderCount = countResumeProductFolders(resumeJob);
  const declaredProductFolderCount = countDeclaredResumeProductFolders(resumeJob);
  if (
    shouldInvalidatePublishedResumeWithoutProductFolders({
      resumeStartStep: String(startStep),
      declaredProductFolderCount,
      actualProductFolderCount: resumeProductFolderCount
    })
  ) {
    fs.rmSync(resumeJobFile, { force: true });
    return false;
  }
  const reusableTaskArtifacts = summarizeReusableTaskArtifacts({
    runtimeDir: resumeRuntimeDir,
    taskId: resumeJob.input?.resumeTaskId
  });
  const reusableArtifactCount = Math.max(reusableTaskArtifacts.reusableArtifactCount, resumeProductFolderCount);
  if (
    !shouldResumeSourceImageForCurrentFeishuBatch(
      resumeSourceImagePath,
      reusableArtifactCount,
      resumeJob.input?.feishuBatchFingerprint
    )
  ) {
    fs.rmSync(resumeJobFile, { force: true });
    return false;
  }

  if (stateTask) {
    const inferredStateStartStep = inferResumeStartStepForTask(stateTask);
    if (
      shouldReplaceStaleResumeStartStep({
        resumeStartStep: String(startStep),
        inferredStateStartStep,
        stateProductFolderCount: collectResumeProductFolderNames(stateTask).length,
        safelyPublishedCount: countSafelyPublishedManifestEntries(resumeRuntimeDir)
      })
    ) {
      fs.rmSync(resumeJobFile, { force: true });
      return false;
    }
  }

  if (!resumeJob?.resultFile) {
    return true;
  }

  const resultFile = path.resolve(rootDir, resumeJob.resultFile);
  const result = readJsonFile<AutoListingResultFile>(resultFile);
  const unsafePublishResumeNeedsWork =
    unsafePublishEntriesForResume(resumeRuntimeDir).some((entry) =>
      entry.sourceImagePath && path.resolve(rootDir, entry.sourceImagePath) === path.resolve(rootDir, resumeSourceImagePath)
    );
  const publishResumeNeedsWork =
    startStep === "published" &&
    resumeProductFolderCount > 0 &&
    countSafelyPublishedManifestEntries(resumeRuntimeDir) < resumeProductFolderCount;
  const shouldResume = unsafePublishResumeNeedsWork || publishResumeNeedsWork || !result || (result.ok !== true && result.status !== "success");
  const latestRelevantFailure = findLatestFailedResultForResume();
  if (!unsafePublishResumeNeedsWork && !publishResumeNeedsWork && (!latestRelevantFailure || path.resolve(latestRelevantFailure.resultFile) !== resultFile)) {
    fs.rmSync(resumeJobFile, { force: true });
    return false;
  }
  if (!shouldResume && fs.existsSync(resumeJobFile)) {
    fs.rmSync(resumeJobFile, { force: true });
  }
  const failedTask = (result?.tasks || []).find((task) => task.status === "failed" || task.error);
  if (shouldResume && failedTask && !publishResumeNeedsWork) {
    if (taskHasExternalMainImageRawReuse(path.dirname(resultFile), failedTask.taskId)) {
      fs.rmSync(resumeJobFile, { force: true });
      return false;
    }
    const expectedStartStep = inferResumeStartStepForTask(failedTask);
    if (startStep !== expectedStartStep) {
      fs.rmSync(resumeJobFile, { force: true });
      return false;
    }
  }
  return shouldResume;
}

function collectResumeProductFolderNames(task: NonNullable<AutoListingResultFile["tasks"]>[number]): string[] {
  return Array.from(
    new Set(
      [
        ...(task.generatedProductFolders || []),
        ...(task.mainImageArtifact?.generatedFiles || []).map((item) => item.productFolder || ""),
        ...(task.shopDistributionArtifact?.distributedFolders || [])
      ]
        .map((folder) => path.basename(folder))
        .filter(Boolean)
    )
  );
}

function listStateFilesNewestFirst(): string[] {
  const runsDir = path.resolve(rootDir, "data/auto-listing/runs");
  if (!fs.existsSync(runsDir)) {
    return [];
  }
  return fs
    .readdirSync(runsDir)
    .map((runId) => path.join(runsDir, runId, "state.json"))
    .filter((file) => fs.existsSync(file))
    .map((file) => ({ file, mtimeMs: fs.statSync(file).mtimeMs }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .map((item) => item.file);
}

function countResumeProductFolders(job: AutoListingJobFile | undefined): number {
  const names = new Set((job?.input?.resumeProductFolderNames || []).map((item) => String(item || "")).filter(Boolean));
  const shopRootDir = path.resolve(rootDir, job?.input?.shopRootDir || "input/auto-listing/shops");
  return countMatchingProductFoldersInShopRoot(shopRootDir, names, false);
}

function countMatchingProductFoldersInShopRoot(shopRootDir: string, names: Set<string>, requireWorkbook: boolean): number {
  if (names.size === 0 || !fs.existsSync(shopRootDir)) {
    return 0;
  }
  let count = 0;
  for (const shopEntry of fs.readdirSync(shopRootDir, { withFileTypes: true })) {
    if (!shopEntry.isDirectory()) {
      continue;
    }
    const shopFolder = path.join(shopRootDir, shopEntry.name);
    for (const productEntry of fs.readdirSync(shopFolder, { withFileTypes: true })) {
      if (productEntry.isDirectory() && names.has(productEntry.name)) {
        if (!requireWorkbook) {
          count += 1;
          continue;
        }
        const productFolder = path.join(shopFolder, productEntry.name);
        if (fs.readdirSync(productFolder).some((name) => name.toLowerCase().endsWith(".xlsx"))) {
          count += 1;
        }
      }
    }
  }
  return count;
}

function findDeferredMainImageShopRootForResume(options: {
  batchFingerprint?: string;
  recordId?: string;
  productFolderNames: string[];
}): string | undefined {
  const names = new Set(options.productFolderNames.filter(Boolean));
  if (!options.batchFingerprint || !options.recordId || names.size === 0 || !fs.existsSync(deferredMainImageRoot)) {
    return undefined;
  }

  const candidates = fs
    .readdirSync(deferredMainImageRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const roundDir = path.join(deferredMainImageRoot, entry.name);
      const manifestFile = path.join(roundDir, "deferred-round.json");
      const manifest = readJsonFile<DeferredMainImageRoundFile>(manifestFile);
      const shopsDir = path.join(roundDir, "shops");
      if (!manifest || manifest.batchFingerprint !== options.batchFingerprint || manifest.recordId !== options.recordId || !fs.existsSync(shopsDir)) {
        return undefined;
      }
      const matchedCount = countMatchingProductFoldersInShopRoot(shopsDir, names, true);
      if (matchedCount < names.size) {
        return undefined;
      }
      return {
        shopsDir,
        createdAtMs: manifest.createdAt ? Date.parse(manifest.createdAt) || 0 : 0,
        round: Number(manifest.round || 0),
        mtimeMs: fs.statSync(manifestFile).mtimeMs
      };
    })
    .filter((item): item is { shopsDir: string; createdAtMs: number; round: number; mtimeMs: number } => Boolean(item))
    .sort((a, b) => b.createdAtMs - a.createdAtMs || b.round - a.round || b.mtimeMs - a.mtimeMs);

  return candidates[0]?.shopsDir;
}

function resolveResumeShopRootDir(options: {
  sourceJob: AutoListingJobFile;
  task: NonNullable<AutoListingResultFile["tasks"]>[number] | NonNullable<AutoListingStateFile["tasks"]>[number];
  batchFingerprint?: string;
  productFolderNames: string[];
}): string | undefined {
  const configuredShopRoot = path.resolve(rootDir, options.sourceJob.input?.shopRootDir || "input/auto-listing/shops");
  const names = new Set(options.productFolderNames.filter(Boolean));
  if (countMatchingProductFoldersInShopRoot(configuredShopRoot, names, true) >= names.size) {
    return options.sourceJob.input?.shopRootDir;
  }
  const deferredShopRoot = findDeferredMainImageShopRootForResume({
    batchFingerprint: options.batchFingerprint,
    recordId: options.task.feishuProductRecord?.recordId,
    productFolderNames: options.productFolderNames
  });
  return deferredShopRoot ? path.relative(rootDir, deferredShopRoot) : options.sourceJob.input?.shopRootDir;
}

function countDeclaredResumeProductFolders(job: AutoListingJobFile | undefined): number {
  return new Set((job?.input?.resumeProductFolderNames || []).map((item) => String(item || "")).filter(Boolean)).size;
}

function listFilesRecursive(dir: string): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }
  const files: string[] = [];
  const pending = [dir];
  while (pending.length > 0) {
    const currentDir = pending.pop() as string;
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        pending.push(fullPath);
      } else {
        files.push(fullPath);
      }
    }
  }
  return files;
}

function inferResumeStartStepFromRuntimeFiles(
  task: NonNullable<AutoListingStateFile["tasks"]>[number] | NonNullable<AutoListingResultFile["tasks"]>[number],
  runtimeDir: string,
  fallback: ReturnType<typeof inferResumeStartStepForTask>
): ReturnType<typeof inferResumeStartStepForTask> {
  if (
    task.taskId &&
    hasIncompleteFixedMainImageRoundFiles({
      runtimeDir,
      taskId: task.taskId,
      expectedImagesPerRound: 4
    })
  ) {
    return "main_images_generated";
  }
  if (fallback === "published") {
    return fallback;
  }
  if (!task.taskId) {
    return fallback;
  }
  const taskDir = path.join(runtimeDir, "tasks", task.taskId);
  const files = listFilesRecursive(taskDir);
  if (files.some((file) => file.includes(`${path.sep}staged${path.sep}`) && /\.(png|jpe?g|webp)$/i.test(file))) {
    return "main_images_generated";
  }
  if (files.some((file) => file.includes(`${path.sep}openai-compatible${path.sep}raw${path.sep}`) && /^generated-\d+/i.test(path.basename(file)))) {
    return "main_images_generated";
  }
  if (files.some((file) => file.includes(`${path.sep}poster-word-files${path.sep}`) && file.toLowerCase().endsWith(".docx"))) {
    return "main_images_generated";
  }
  if (files.some((file) => path.basename(file) === "selling-points.txt")) {
    return "poster_prompts_generated";
  }
  return fallback;
}

function taskHasExternalMainImageRawReuse(runtimeDir: string, taskId: string | undefined): boolean {
  if (!taskId) {
    return false;
  }
  const eventsFile = path.join(runtimeDir, "events.ndjson");
  if (!fs.existsSync(eventsFile)) {
    return false;
  }
  return fs
    .readFileSync(eventsFile, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .some((line) => {
      try {
        const event = JSON.parse(line) as { taskId?: string; step?: string; message?: string };
        return (
          event.taskId === taskId &&
          event.step === "main_images_generated" &&
          isExternalMainImageRawReuseMessage({
            message: event.message,
            currentRuntimeDir: runtimeDir
          })
        );
      } catch {
        return false;
      }
    });
}

function countSafelyPublishedManifestEntries(runtimeDir: string): number {
  const manifest = readJsonFile<PublishManifestFile>(path.join(runtimeDir, "publish-manifest.json"));
  return (manifest?.entries || []).filter((entry) => isManifestEntryAcceptedForBatchCompletion(entry as never)).length;
}

function findLatestInterruptedStateForResume(): {
  stateFile: string;
  runtimeDir: string;
  state: AutoListingStateFile;
  task: NonNullable<AutoListingStateFile["tasks"]>[number];
  reusableRawImageCount: number;
  safelyPublishedCount: number;
} | undefined {
  const candidates: Array<{
    stateFile: string;
    runtimeDir: string;
    state: AutoListingStateFile;
    task: NonNullable<AutoListingStateFile["tasks"]>[number];
    reusableRawImageCount: number;
    safelyPublishedCount: number;
    mtimeMs: number;
  }> = [];
  for (const stateFile of listStateFilesNewestFirst()) {
    const state = readJsonFile<AutoListingStateFile>(stateFile);
    if (state?.businessRuleFingerprint !== buildAutoListingBusinessRuleFingerprint()) {
      continue;
    }
    const runtimeDir = path.dirname(stateFile);
    const task = (state?.tasks || []).find((item) => item.status !== "done" && item.status !== "cleaned" && item.status !== "failed");
    if (!state || !task?.sourceImagePath) {
      continue;
    }
    const sourceImageExists = fs.existsSync(path.resolve(rootDir, task.sourceImagePath));
    const reusableTaskArtifacts = summarizeReusableTaskArtifacts({
      runtimeDir,
      taskId: task.taskId
    });
    const reusableArtifactCount = reusableTaskArtifacts.reusableArtifactCount;
    if (taskHasExternalMainImageRawReuse(runtimeDir, task.taskId)) {
      continue;
    }
    if (
      !shouldResumeSourceImageForCurrentFeishuBatch(
        task.sourceImagePath,
        reusableArtifactCount,
        state.feishuBatchFingerprint
      )
    ) {
      continue;
    }
    if (
      shouldResumeInterruptedTaskInPlace({
        runStatus: state.status,
        taskStatus: task.status,
        sourceImageExists,
        reusableRawImageCount: reusableArtifactCount
      })
    ) {
      candidates.push({
        stateFile,
        runtimeDir,
        state,
        task,
        reusableRawImageCount: reusableArtifactCount,
        safelyPublishedCount: countSafelyPublishedManifestEntries(runtimeDir),
        mtimeMs: fs.statSync(stateFile).mtimeMs
      });
    }
  }
  return candidates.sort((a, b) => b.safelyPublishedCount - a.safelyPublishedCount || b.reusableRawImageCount - a.reusableRawImageCount || b.mtimeMs - a.mtimeMs)[0];
}

function findLatestFailedResultForResume(): { resultFile: string; result: AutoListingResultFile } | undefined {
  const candidates: Array<{
    resultFile: string;
    result: AutoListingResultFile;
    mtimeMs: number;
    safelyPublishedCount: number;
    resumeProductFolderCount: number;
    reusableRawImageCount: number;
  }> = [];
  for (const resultFile of listResultFilesNewestFirst()) {
    const result = readJsonFile<AutoListingResultFile>(resultFile);
    if (
      !result ||
      result.businessRuleFingerprint !== buildAutoListingBusinessRuleFingerprint() ||
      result.ok === true ||
      result.status === "success"
    ) {
      continue;
    }
    const failedTask = (result.tasks || []).find((task) => task.status === "failed" || task.error);
    if (failedTask?.sourceImagePath && fs.existsSync(path.resolve(rootDir, failedTask.sourceImagePath))) {
      const runtimeDir = result.runtimeDir || path.dirname(resultFile);
      const resumeProductFolderCount = collectResumeProductFolderNames(failedTask).length;
      const reusableTaskArtifacts = summarizeReusableTaskArtifacts({
        runtimeDir,
        taskId: failedTask.taskId
      });
      const reusableArtifactCount = Math.max(reusableTaskArtifacts.reusableArtifactCount, resumeProductFolderCount);
      if (
        shouldResumeSourceImageForCurrentFeishuBatch(
          failedTask.sourceImagePath,
          reusableArtifactCount,
          result.feishuBatchFingerprint
        )
      ) {
        if (taskHasExternalMainImageRawReuse(runtimeDir, failedTask.taskId)) {
          continue;
        }
        candidates.push({
          resultFile,
          result,
          mtimeMs: fileMtimeMs(resultFile) || 0,
          safelyPublishedCount: countSafelyPublishedManifestEntries(runtimeDir),
          resumeProductFolderCount,
          reusableRawImageCount: reusableArtifactCount
        });
      }
    }
  }
  const selected = selectAutoListingControllerFailedResumeCandidate(candidates);
  return selected ? { resultFile: selected.resultFile, result: selected.result } : undefined;
}

function findLatestUnsafePublishManifestForResume(): {
  runtimeDir: string;
  resultFile: string;
  result: AutoListingResultFile;
  unsafeEntries: NonNullable<PublishManifestFile["entries"]>;
} | undefined {
  return selectLatestUnsafePublishManifestForResume({
    rootDir,
    resultFiles: listResultFilesNewestFirst(),
    fileMtimeMs,
    countSafelyPublishedManifestEntries,
    shouldResumeSourceImageForCurrentFeishuBatch
  }) as ReturnType<typeof findLatestUnsafePublishManifestForResume>;
}

function writeResumeJobFromInterruptedState(
  sourceJob: AutoListingJobFile,
  interrupted: NonNullable<ReturnType<typeof findLatestInterruptedStateForResume>>
): AutoListingJobFile {
  const startStep = inferResumeStartStepFromRuntimeFiles(
    interrupted.task,
    interrupted.runtimeDir,
    inferResumeStartStepForTask(interrupted.task)
  );
  const resumeProductFolderNames = collectResumeProductFolderNames(interrupted.task);
  const shopRootDir = resolveResumeShopRootDir({
    sourceJob,
    task: interrupted.task,
    batchFingerprint: interrupted.state.feishuBatchFingerprint,
    productFolderNames: resumeProductFolderNames
  });
  const resumeJob: AutoListingJobFile = {
    ...sourceJob,
    runtimeDir: interrupted.runtimeDir,
    resultFile: path.join(interrupted.runtimeDir, "result.json"),
    runId: interrupted.state.runId || path.basename(interrupted.runtimeDir),
    input: {
      ...sourceJob.input,
      ...(shopRootDir ? { shopRootDir } : {}),
      startStep,
      endStep: "done",
      resumeSourceImagePath: interrupted.task.sourceImagePath,
      resumeTaskId: interrupted.task.taskId,
      resumeProductFolderNames,
      feishuBatchFingerprint: interrupted.state.feishuBatchFingerprint,
      businessRuleFingerprint: interrupted.state.businessRuleFingerprint,
      maxImagesPerRun: 1,
      clearTestOutputsBeforeRun: false
    }
  };
  atomicWriteJson(resumeJobFile, resumeJob);
  return resumeJob;
}

function ensureResumeJobFromLatestFailure(): AutoListingJobFile | undefined {
  let sourceJob = readJsonFile<AutoListingJobFile>(fullRealJobFile);
  if (!sourceJob?.input) {
    const unsafeLatest = findLatestUnsafePublishManifestForResume();
    sourceJob = unsafeLatest ? buildFallbackSourceJobFromPreflight(rootDir, unsafeLatest.runtimeDir) as AutoListingJobFile | undefined : undefined;
    if (!sourceJob?.input) {
      return undefined;
    }
  }

  if (shouldResumeCurrentFailure()) {
    return readJsonFile<AutoListingJobFile>(resumeJobFile);
  }

  const interrupted = findLatestInterruptedStateForResume();
  if (interrupted?.task.sourceImagePath) {
    return writeResumeJobFromInterruptedState(sourceJob, interrupted);
  }

  const unsafeLatest = findLatestUnsafePublishManifestForResume();
  if (unsafeLatest?.result.businessRuleFingerprint === buildAutoListingBusinessRuleFingerprint()) {
    const sourceImagePath = unsafeLatest.unsafeEntries[0]?.sourceImagePath;
    const task = (unsafeLatest.result.tasks || []).find((item) =>
      sourceImagePath && item.sourceImagePath && path.resolve(rootDir, item.sourceImagePath) === path.resolve(rootDir, sourceImagePath)
    );
    if (task?.sourceImagePath) {
      const resumeProductFolderNames = Array.from(
        new Set(unsafeLatest.unsafeEntries.map((entry) => path.basename(entry.productFolder || "")).filter(Boolean))
      );
      const resumeJob: AutoListingJobFile = {
        ...sourceJob,
        runtimeDir: unsafeLatest.runtimeDir,
        resultFile: unsafeLatest.resultFile,
        runId: unsafeLatest.result.runId || path.basename(unsafeLatest.runtimeDir),
        input: {
          ...sourceJob.input,
          startStep: "published",
          endStep: "done",
          resumeSourceImagePath: task.sourceImagePath,
          resumeTaskId: task.taskId,
          resumeProductFolderNames,
          feishuBatchFingerprint: unsafeLatest.result.feishuBatchFingerprint,
          businessRuleFingerprint: unsafeLatest.result.businessRuleFingerprint,
          maxImagesPerRun: 1,
          clearTestOutputsBeforeRun: false
        }
      };
      atomicWriteJson(resumeJobFile, resumeJob);
      return resumeJob;
    }
  }

  const latest = findLatestFailedResultForResume();
  if (!latest) {
    return undefined;
  }

  const failedTask = (latest.result.tasks || []).find((task) => task.status === "failed" || task.error);
  if (!failedTask?.sourceImagePath) {
    return undefined;
  }

  const failedRuntimeDir = latest.result.runtimeDir || path.dirname(latest.resultFile);
  const failedStep = inferResumeStartStepFromRuntimeFiles(
    failedTask,
    failedRuntimeDir,
    inferResumeStartStepForTask(failedTask)
  );
  const resumeProductFolderNames = collectResumeProductFolderNames(failedTask);
  const shopRootDir = resolveResumeShopRootDir({
    sourceJob,
    task: failedTask,
    batchFingerprint: latest.result.feishuBatchFingerprint,
    productFolderNames: resumeProductFolderNames
  });
  const resumeJob: AutoListingJobFile = {
    ...sourceJob,
    runtimeDir: failedRuntimeDir,
    resultFile: latest.resultFile,
    runId: latest.result.runId || path.basename(path.dirname(latest.resultFile)),
    input: {
      ...sourceJob.input,
      ...(shopRootDir ? { shopRootDir } : {}),
      startStep: failedStep,
      endStep: "done",
      resumeSourceImagePath: failedTask.sourceImagePath,
      resumeTaskId: failedTask.taskId,
      resumeProductFolderNames,
      feishuBatchFingerprint: latest.result.feishuBatchFingerprint,
      businessRuleFingerprint: latest.result.businessRuleFingerprint,
      maxImagesPerRun: 1,
      clearTestOutputsBeforeRun: false
    }
  };

  atomicWriteJson(resumeJobFile, resumeJob);
  return resumeJob;
}

function resolveImageGenerationConfigFile(job: AutoListingJobFile | undefined): string {
  return path.resolve(rootDir, job?.input?.imageGenerationConfigFile || "input/image-generation.config.json");
}

function readImageGenerationApiUrl(configFile: string): string | undefined {
  if (!fs.existsSync(configFile)) {
    return undefined;
  }
  const parsed = JSON.parse(fs.readFileSync(configFile, "utf8")) as { apiUrl?: string };
  return parsed.apiUrl;
}

async function probeImageGenerationEndpoint(apiUrl: string): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(apiUrl, {
      method: "HEAD",
      signal: controller.signal
    });
    const evaluation = evaluateImageGenerationEndpointProbe({
      status: response.status,
      statusText: response.statusText
    });
    if (!evaluation.passed) {
      throw new Error(evaluation.issue);
    }
  } catch (error) {
    const cause = error instanceof Error ? ((error as Error & { cause?: { code?: string } }).cause?.code || "") : "";
    const evaluation = evaluateImageGenerationEndpointProbe({
      errorName: error instanceof Error ? error.name : "Error",
      errorMessage: error instanceof Error ? error.message : String(error),
      errorCauseCode: cause
    });
    if (evaluation.startAction === "continue") {
      console.error(
        `${evaluation.issue}。将启动项目 supervisor 并交由外部服务等待/断点续跑规则处理，避免入口硬失败。`
      );
      return;
    }
    throw new Error(
      evaluation.issue +
        "。请在非沙盒、可访问外网的环境启动真实上架流程，避免图片生成阶段反复 fetch failed。"
    );
  } finally {
    clearTimeout(timer);
  }
}

async function assertRealFlowNetworkPreflight(imageGenerationConfigFile: string | undefined): Promise<void> {
  if (!imageGenerationConfigFile) {
    return;
  }
  const apiUrl = readImageGenerationApiUrl(imageGenerationConfigFile);
  if (!apiUrl) {
    return;
  }
  await probeImageGenerationEndpoint(apiUrl);
}

function selectCommand(forceFullFlow = false): {
  command: string;
  args: string[];
  mode: RunnerJob["mode"];
  expectedResultFile?: string;
  imageGenerationConfigFile?: string;
  job: AutoListingJobFile;
} {
  const resumeJob = forceFullFlow ? undefined : ensureResumeJobFromLatestFailure();
  if (resumeJob) {
    return {
      command: "node",
      args: ["dist/src/cli/auto-listing-supervisor.js", "--initial", "resume"],
      mode: "resume-real-job",
      expectedResultFile: resumeJob?.resultFile ? path.resolve(rootDir, resumeJob.resultFile) : undefined,
      imageGenerationConfigFile: resolveImageGenerationConfigFile(resumeJob),
      job: resumeJob
    };
  }
  const fullJob = readJsonFile<AutoListingJobFile>(fullRealJobFile);
  return {
    command: "node",
    args: ["dist/src/cli/auto-listing-supervisor.js", "--initial", "full"],
    mode: "full-real-flow",
    imageGenerationConfigFile: resolveImageGenerationConfigFile(fullJob),
    job: fullJob || {}
  };
}

async function start(
  intent: AutoListingControllerLaunchIntent,
  dryRun: boolean,
  text: boolean,
  forceRerunCurrentBatch: boolean
): Promise<void> {
  fs.mkdirSync(controlDir, { recursive: true });
  const current = readJsonFile<RunnerJob>(jobFile);
  const runnerJobRunning = Boolean(current && isRunnerJobRunning(current));
  if (
    shouldClearPauseSignalOnAutoListingControllerStart({
      pauseSignalExists: fs.existsSync(pauseFile),
      runnerJobRunning
    })
  ) {
    fs.rmSync(pauseFile);
  }
  if (current && runnerJobRunning) {
    const status = existingStatus();
    const result = {
      ok: true,
      status: "already_running",
      pid: current.pid,
      mode: current.mode,
      startedAt: current.startedAt,
      logFile: current.logFile,
      jobFile,
      summary: status.summary,
      publishProgress: status.publishProgress
    };
    console.log(text ? formatStartText(result) : JSON.stringify(result, null, 2));
    return;
  }
  if (!dryRun) {
    await cleanupRecordedAutoListingControllerChild();
  }

  const launchPolicy = resolveAutoListingControllerLaunchPolicy(intent);
  const beforeRefreshProgress = launchPolicy.refreshBeforeSelection ? undefined : summarizeFeishuProgress();
  if (!dryRun && launchPolicy.refreshBeforeSelection) {
    runFeishuAssetsRefreshForStart();
  }
  const currentProgress = launchPolicy.refreshBeforeSelection ? summarizeFeishuProgress() : beforeRefreshProgress;
  const selectedBatchFingerprint =
    typeof currentProgress?.batchFingerprint === "string" ? String(currentProgress.batchFingerprint) : "";
  if (!dryRun && !selectedBatchFingerprint) {
    throw new Error(
      typeof currentProgress?.validationIssue === "string"
        ? String(currentProgress.validationIssue)
        : "Cannot start auto-listing without a validated Feishu batch fingerprint."
    );
  }
  const nonCurrentBatchCleanup = !dryRun ? cleanupNonCurrentBatchResidue(selectedBatchFingerprint) : [];
  const dryRunDecision = dryRun
    ? resolveAutoListingControllerDryRunStartDecision({
        batchComplete: typeof currentProgress?.batchComplete === "boolean" ? currentProgress.batchComplete : undefined,
        forceRerunCurrentBatch
      })
    : undefined;
  if (dryRunDecision === "require_rerun_confirmation") {
    const result = {
      ok: true,
      dryRun: true,
      status: "rerun_confirmation_required",
      feishuProgress: beforeRefreshProgress,
      message: "当前飞书批次产品已全部上架完成；只读检查不会选择历史失败断点。"
    };
    console.log(text ? formatStartText(result) : JSON.stringify(result, null, 2));
    return;
  }
  let forceFullFlow = !launchPolicy.allowHistoricalResume || launchPolicy.forceFullFlow || dryRunDecision === "rerun_current_batch";
  if (!dryRun && launchPolicy.refreshBeforeSelection && currentProgress?.batchComplete === true) {
    const decision = resolveAutoListingControllerStartAfterFeishuRefresh({
      currentBatchComplete: true,
      refreshedBatchChanged: false,
      refreshedBatchComplete: true,
      forceRerunCurrentBatch
    });
    if (decision === "require_rerun_confirmation") {
      const result = {
        ok: true,
        status: "rerun_confirmation_required",
        feishuProgress: currentProgress,
        message: "当前飞书批次产品已全部上架完成；刷新后没有发现新的产品批次。确认要重新跑原批次后，再使用重跑当前批次入口。"
      };
      console.log(text ? formatStartText(result) : JSON.stringify(result, null, 2));
      return;
    }
    if (decision === "rerun_current_batch") {
      clearCurrentBatchPaidImageLedger();
      clearCurrentBatchProcessedImages();
      forceFullFlow = true;
    }
  }
  const selected = selectCommand(forceFullFlow);
  const logFile = path.join(controlDir, `auto-listing-controller-${timestampForFile()}.log`);
  if (dryRun) {
    const result = {
      ok: true,
      dryRun: true,
      status: "would_start",
      mode: selected.mode,
      command: [selected.command, ...selected.args].join(" "),
      expectedResultFile: selected.expectedResultFile,
      logFile,
      jobFile
    };
    console.log(text ? formatStartText(result) : JSON.stringify(result, null, 2));
    return;
  }

  assertAutoListingControllerImageGenerationContract(selected.job.input, rootDir);
  await assertRealFlowNetworkPreflight(selected.imageGenerationConfigFile);

  const logFd = fs.openSync(logFile, "a");
  const child = spawn(selected.command, selected.args, {
    cwd: rootDir,
    detached: true,
    env: {
      ...process.env,
      AUTO_LISTING_STARTED_BY: "project-controller"
    },
    stdio: ["ignore", logFd, logFd]
  });
  child.unref();
  fs.closeSync(logFd);

  const job: RunnerJob = {
    pid: child.pid || 0,
    startedAt: new Date().toISOString(),
    cwd: rootDir,
    command: selected.command,
    args: selected.args,
    logFile,
    expectedResultFile: selected.expectedResultFile,
    mode: selected.mode,
    status: "running",
    batchFingerprint: selectedBatchFingerprint,
    businessRuleFingerprint: buildAutoListingBusinessRuleFingerprint()
  };
  atomicWriteJson(jobFile, job);
  const result = {
    ok: true,
    status: "started",
    pid: job.pid,
    mode: job.mode,
    command: [job.command, ...job.args].join(" "),
    logFile: job.logFile,
    jobFile,
    message: "后台任务已启动；后续发送状态查询时读取项目发布清单进度，不需要外部触发器持续等待进程结束。",
    nonCurrentBatchCleanup
  };
  console.log(text ? formatStartText(result) : JSON.stringify(result, null, 2));
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const text = rest.includes("--text");
  if (command === "start-new" || command === "start") {
    await start("start_new_batch", rest.includes("--dry-run"), text, rest.includes("--rerun-current-batch"));
    return;
  }
  if (command === "continue") {
    await start("continue_current_batch", rest.includes("--dry-run"), text, false);
    return;
  }
  if (command === "status") {
    const status = existingStatus();
    console.log(text ? formatStatusText(status) : JSON.stringify(resolveAutoListingControllerHermesStatusPayload(status), null, 2));
    return;
  }
  if (command === "pause") {
    const result = writePauseSignal();
    console.log(text ? String(result.message) : JSON.stringify(result, null, 2));
    return;
  }
  if (command === "resume-ready") {
    const result = clearPauseSignal();
    console.log(text ? String(result.message) : JSON.stringify(result, null, 2));
    return;
  }
  if (command === "prepare-resume") {
    const resumeJob = ensureResumeJobFromLatestFailure();
    if (!resumeJob) {
      throw new Error("No recoverable auto-listing failure was found for resume preparation.");
    }
    console.log(
      JSON.stringify(
        {
          ok: true,
          resumeJobFile,
          startStep: resumeJob.input?.startStep || resumeJob.startStep,
          resumeTaskId: resumeJob.input?.resumeTaskId
        },
        null,
        2
      )
    );
    return;
  }
  throw new Error("Usage: auto-listing-controller <start|status|pause|resume-ready|prepare-resume> [--dry-run] [--text] [--rerun-current-batch]");
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
