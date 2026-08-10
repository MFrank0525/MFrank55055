import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  compactAutoListingTerminalFailureMessage, formatAutoListingControllerCompactStatusText,
  isAutoListingControllerChildProcessCommand,
  isAutoListingControllerSupervisorProcessCommand,
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
import { formatAutoListingControllerWaitSummary, resolveDoudianLoginWaitRealtimeMessage } from "../autolist/doudian-login-recovery-rules.js";
import { formatPaidImageAcceptedTaskWaitSummary, resolvePaidImageWaitStatus } from "../autolist/paid-image-wait-rules.js";
import { shouldFailAutoListingControllerStatusForFeishuCacheInvalid, shouldPreserveAutoListingControllerCompletedStatusForFeishuCacheInvalid } from "../autolist/controller-cache-status-rules.js";
import { formatAutoListingPublishProgressLabel, shouldRetainStoppedControllerPublishCheckpoint } from "../autolist/status-progress-rules.js";
import { summarizeFeishuBatchProgress } from "../autolist/audit-rules.js";
import { buildFeishuBatchFingerprint, canResumeFeishuBatchArtifacts } from "../autolist/feishu-batch-rules.js";
import { buildAutoListingBusinessRuleFingerprint } from "../autolist/business-rule-fingerprint.js";
import { removeInvalidRuntimeArtifactDirs } from "../autolist/runtime-artifact-lifecycle.js";
import { clearProcessedImagesForBatch, readProcessedImages } from "../autolist/file-batch.js";
import { evaluateImageGenerationEndpointProbe } from "../autolist/image-generation-rules.js";
import { assertAutoListingControllerImageGenerationContract } from "../autolist/image-generation-config.js";
import type { ImageGenerationProvider } from "../autolist/image-generation-provider.js";
import { loadFeishuProductRecords } from "../autolist/feishu-products.js";
import { resolveControllerJobClosure, type ControllerJobStatus } from "../autolist/maintenance-rules.js";
import { cleanupInertControllerSupervisor, isControllerRunnerJobRunning } from "./controller-process-liveness.js";
import { isManifestEntryAcceptedForBatchCompletion } from "../autolist/publish-manifest.js";
import { readLatestTaskProgressEvent } from "../autolist/progress-events.js";
import {
  inferResumeStartStepForTask,
  selectRemainingResumeProductFolderNames
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

import type { RunnerJob, DirectAutoListingProcess, ExternalServiceWait, PauseSignalFile, AutoListingJobFile, AutoListingTaskFile, AutoListingResultFile, AutoListingStateFile, PublishManifestFile, PublishPlanFile, DeferredMainImageRoundFile, LocalFeishuConfig } from "./auto-listing-controller-contract.js";
import { rootDir, controlDir, jobFile, childControlFile, externalServiceWaitFile, pauseFile, resumeJobFile, fullRealJobFile, deferredMainImageRoot, feishuConfigFile } from "./auto-listing-controller-contract.js";

export function readJsonFile<T>(file: string): T | undefined {
  if (!fs.existsSync(file)) {
    return undefined;
  }
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

export function readPauseSignalFile(): PauseSignalFile | undefined {
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

export function writePauseSignalFile(signal: Omit<PauseSignalFile, "requestedAt" | "source"> & { requestedAt?: string }): PauseSignalFile {
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

export function formatPauseSignalSummary(signal: PauseSignalFile | undefined): string {
  if (signal?.reason === "batch_mismatch") {
    const runtime = signal.runtimeBatchFingerprint ? signal.runtimeBatchFingerprint.slice(0, 12) : "未知";
    const current = signal.currentBatchFingerprint ? signal.currentBatchFingerprint.slice(0, 12) : "未知";
    return `批次保护暂停：运行批次 ${runtime} 与当前飞书缓存 ${current} 不一致；已停止复用旧运行证据。继续上架会清除暂停信号并按当前飞书缓存安全续跑。`;
  }
  return signal?.message || "项目已收到暂停请求；继续上架会清除暂停信号并从安全断点续跑。";
}

export function maybeUpgradeLegacyPauseSignalForBatchMismatch(input: {
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

export function readProcessCommand(pid: number | undefined): string | undefined {
  if (!pid || !Number.isInteger(pid) || pid <= 0) {
    return undefined;
  }
  const result = spawnSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" });
  if (result.status !== 0) {
    return undefined;
  }
  return result.stdout.trim() || undefined;
}

export function extractDirectAutoListingJobFile(command: string): string | undefined {
  const match = /\s--job\s+("[^"]+"|'[^']+'|\S+)/.exec(` ${command}`);
  const raw = match?.[1]?.replace(/^['"]|['"]$/g, "");
  return raw ? path.resolve(rootDir, raw) : undefined;
}

export function findActiveDirectAutoListingProcess(): DirectAutoListingProcess | undefined {
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

export function isPidRunning(pid: number | undefined): boolean {
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

export function isRunnerJobRunning(job: RunnerJob): boolean {
  return isControllerRunnerJobRunning({
    job,
    childControlFile,
    waitStateFile: externalServiceWaitFile,
    latestResultFile: findLatestResultFile()
  });
}

export function isProcessGroupRunning(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export async function cleanupRecordedAutoListingControllerChild(): Promise<void> {
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
export function timestampForFile(date = new Date()): string {
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

export function tailFile(file: string, maxLines: number): string[] {
  if (!fs.existsSync(file)) {
    return [];
  }
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  return lines.filter(Boolean).slice(-maxLines);
}

export function compactStatusLine(line: string): string {
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
  if (/Spec template field root was not found in 商品规格\/规格模板 DOM structure/i.test(compact)) return "当前商品发布页缺少规格模板栏；系统会关闭异常发布页，回到标品管理重新查询品牌和 SPU 后重建当前目标。";
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

export function latestAutoListingChildFailureFromLog(logFile: string | undefined): string | undefined {
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

export function compactStatusValue(value: string | undefined): string | undefined {
  return value ? compactStatusLine(value) : value;
}

export function formatFeishuCacheValidationFailureForOperator(productDataFile: string): string | undefined {
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

export function publishModuleLabel(moduleName: string): string {
  if (moduleName === "basic_info") return "基础信息";
  if (moduleName === "graphic_info") return "图文信息";
  if (moduleName === "price_inventory") return "价格库存";
  if (moduleName === "service_fulfillment") return "服务履约";
  if (moduleName === "final_submit") return "最终提交";
  return moduleName;
}

export function summarizePublishLogProgress(logFile: string | undefined): Record<string, unknown> | undefined {
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

export function compactErrorObject<T extends { message?: string } | undefined>(error: T): T {
  if (!error?.message) {
    return error;
  }
  return {
    ...error,
    message: compactStatusLine(error.message)
  };
}

export function compactProductFolders(folders: string[] | undefined): Record<string, unknown> {
  const values = folders || [];
  return {
    generatedProductFolderCount: values.length,
    generatedProductFolders: values.slice(0, 3)
  };
}

export function compactTaskForStatus<
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

export function findActiveRuntimeDirFromLog(logFile: string | undefined): string | undefined {
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

export function fileMtimeMs(file: string | undefined): number | undefined {
  if (!file || !fs.existsSync(file)) {
    return undefined;
  }
  return fs.statSync(file).mtimeMs;
}

export function findLatestResultFile(): string | undefined {
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

export function listResultFilesNewestFirst(): string[] {
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

export function summarizeResult(resultFile: string | undefined): Record<string, unknown> | undefined {
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

export function summarizeState(runtimeDir: string | undefined): Record<string, unknown> | undefined {
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

export function summarizeImageGenerationProgress(runtimeDir: string | undefined, taskId: string | undefined): Record<string, unknown> | undefined {
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

export function summarizeLatestPublishArtifact(runtimeDir: string, runtimeKey: string | undefined): Record<string, unknown> | undefined {
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

export function summarizePublishProgress(runtimeDir: string | undefined): Record<string, unknown> | undefined {
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
      ? `当前商品：${publishGroupProgress.productName}，${formatAutoListingPublishProgressLabel({ completed: publishGroupProgress.completed, current: publishGroupProgress.productIndex, total: publishGroupProgress.productTotal, shopCurrent: publishGroupProgress.shopIndex, shopTotal: publishGroupProgress.shopTotal }).replace(/｜/g, "，")}`
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

export function findLatestRuntimeDirWithPublishManifest(): string | undefined {
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

export function isActiveManualRecoveryPublishProgress(publishProgress: Record<string, unknown> | undefined): boolean {
  const active = publishProgress?.active as Record<string, unknown> | undefined;
  const runtimeKey = String(active?.runtimeKey || "");
  return /__manual-republish-\d+__/i.test(runtimeKey) && Number(publishProgress?.pending || 0) > 0;
}

export function isActivePublishProgress(publishProgress: Record<string, unknown> | undefined): boolean {
  const active = publishProgress?.active as Record<string, unknown> | undefined;
  return Boolean(active?.runtimeKey) && Number(publishProgress?.pending || 0) > 0;
}

export function summarizeFeishuProgress(processedManifestOverride?: string): Record<string, unknown> | undefined {
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
