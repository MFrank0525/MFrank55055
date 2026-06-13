import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  isHermesChildProcessCommand,
  isHermesSupervisorProcessCommand,
  isHermesRunningProcessConfirmed,
  isExternalMainImageRawReuseMessage,
  resolveHermesEffectiveProgressTimestamp,
  resolveHermesFeishuBatchDisplayCounts,
  resolveHermesFeishuProgressDisplayMode,
  resolveHermesProgressAgeSeconds,
  resolveHermesRuntimeStatus,
  resolveHermesStartAfterFeishuRefresh,
  selectHermesActiveRunIdFromLogLines,
  selectHermesLatestResultFileForJobStatus,
  selectHermesStatusResultFile,
  selectHermesStatusRuntimeDir,
  resolveHermesRealtimeProgressSignal,
  shouldClearPauseSignalOnHermesStart,
  shouldExposePublishProgressInHermesStatus,
  shouldPreferActiveTaskStateSummary,
  shouldResumeHistoricalFailureForCurrentFeishuBatch,
  shouldResumeInterruptedTaskInPlace,
  shouldSuppressHistoricalResultInHermesStatus,
  shouldSuppressStateCurrentTaskInHermesStatus,
  shouldTerminateRecordedHermesProcessGroup,
  shouldUseExpectedResultFileInRunningStatus,
  summarizeHermesImageGenerationEvents,
  formatHermesCompactStatusText,
  selectHermesFailedResumeCandidate
} from "../autolist/batch-continuation-rules.js";
import { summarizeFeishuBatchProgress } from "../autolist/audit-rules.js";
import { buildFeishuBatchFingerprint, canResumeFeishuBatchArtifacts } from "../autolist/feishu-batch-rules.js";
import { clearProcessedImagesForBatch, migrateLegacyProcessedImagesToBatch, readProcessedImages } from "../autolist/file-batch.js";
import { evaluateImageGenerationEndpointProbe } from "../autolist/image-generation-rules.js";
import { loadFeishuProductRecords } from "../autolist/feishu-products.js";
import { readLatestTaskProgressEvent } from "../autolist/progress-events.js";
import {
  inferResumeStartStepForTask,
  shouldInvalidatePublishedResumeWithoutProductFolders,
  shouldReplaceStaleResumeStartStep
} from "../autolist/resume-rules.js";

interface RunnerJob {
  pid: number;
  startedAt: string;
  cwd: string;
  command: string;
  args: string[];
  logFile: string;
  expectedResultFile?: string;
  mode: "full-real-flow" | "resume-real-job";
  status: "running";
}

interface ExternalServiceWait {
  supervisorPid?: number;
  status?: "external_service_wait";
  reason?: string;
  attempt?: number;
  retryAt?: string;
}

interface AutoListingJobFile {
  input?: {
    startStep?: string;
    endStep?: string;
    resumeSourceImagePath?: string;
    resumeTaskId?: string;
    resumeProductFolderNames?: string[];
    feishuBatchFingerprint?: string;
    feishuProductDataFile?: string;
    processedImageManifest?: string;
    imageGenerationConfigFile?: string;
    imageGenerationProvider?: string;
    shopRootDir?: string;
    maxImagesPerRun?: number;
    clearTestOutputsBeforeRun?: boolean;
  };
  resultFile?: string;
  runtimeDir?: string;
  runId?: string;
  startStep?: string;
}

interface AutoListingResultFile {
  ok?: boolean;
  feishuBatchFingerprint?: string;
  status?: string;
  runId?: string;
  runtimeDir?: string;
  discoveredImages?: string[];
  tasks?: Array<{
    taskId?: string;
    sourceImageName?: string;
    sourceImagePath?: string;
    status?: string;
    generatedProductFolders?: string[];
    mainImageArtifact?: {
      generatedFiles?: Array<{
        productFolder?: string;
      }>;
    };
    shopDistributionArtifact?: {
      distributedFolders?: string[];
    };
    error?: {
      step?: string;
      message?: string;
    };
  }>;
  error?: {
    message?: string;
  };
}

interface AutoListingStateFile {
  runId?: string;
  feishuBatchFingerprint?: string;
  status?: string;
  tasks?: Array<{
    taskId?: string;
    sourceImageName?: string;
    sourceImagePath?: string;
    status?: string;
    generatedProductFolders?: string[];
    mainImageArtifact?: {
      generatedFiles?: Array<{
        productFolder?: string;
      }>;
    };
    shopDistributionArtifact?: {
      distributedFolders?: string[];
    };
    error?: {
      step?: string;
      message?: string;
    };
  }>;
}

interface PublishManifestFile {
  generatedAt?: string;
  entries?: Array<{
    productFolder?: string;
    runtimeKey?: string;
    shopFolder?: string;
    watermarkNo?: number | null;
    status?: "pending" | "published" | "failed" | "skipped";
    finalVerifyStatus?: string;
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

interface LocalFeishuConfig {
  auth?: {
    appId?: string;
    appSecret?: string;
    tenantAccessToken?: string;
  };
}

const rootDir = process.cwd();
const controlDir = path.resolve(rootDir, "data/auto-listing/control");
const jobFile = path.join(controlDir, "hermes-auto-listing-job.json");
const childControlFile = path.join(controlDir, "hermes-auto-listing-child.json");
const externalServiceWaitFile = path.join(controlDir, "hermes-auto-listing-wait.json");
const pauseFile = path.join(controlDir, "pause.requested");
const resumeJobFile = path.resolve(rootDir, "input/auto-listing/auto-listing.job.mac-feishu-real.resume.generated.json");
const fullRealJobFile = path.resolve(rootDir, "input/auto-listing.job.mac-feishu-real.json");
const feishuConfigFile = path.resolve(rootDir, "input/feishu-bitable.config.json");

function readJsonFile<T>(file: string): T | undefined {
  if (!fs.existsSync(file)) {
    return undefined;
  }
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
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
  const command = readProcessCommand(job.pid);
  return isHermesRunningProcessConfirmed({
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

async function cleanupRecordedHermesChild(): Promise<void> {
  const child = readJsonFile<{ pid?: number }>(childControlFile);
  const pid = child?.pid;
  if (!pid) {
    fs.rmSync(childControlFile, { force: true });
    return;
  }
  const leaderRunning = isPidRunning(pid);
  const command = leaderRunning ? readProcessCommand(pid) : undefined;
  if (
    !shouldTerminateRecordedHermesProcessGroup({
      leaderRunning,
      leaderCommandMatches: Boolean(command && isHermesChildProcessCommand(command))
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

function compactStatusValue(value: string | undefined): string | undefined {
  return value ? compactStatusLine(value) : value;
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
    status: task.status,
    ...compactProductFolders(task.generatedProductFolders),
    error: compactErrorObject(task.error)
  };
}

function findActiveRuntimeDirFromLog(logFile: string | undefined): string | undefined {
  if (!logFile || !fs.existsSync(logFile)) {
    return undefined;
  }
  const runId = selectHermesActiveRunIdFromLogLines(fs.readFileSync(logFile, "utf8").split(/\r?\n/));
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
    products: tasks.map((task) => ({
      sourceImageName: task.sourceImageName,
      status: task.status,
      ...compactProductFolders(task.generatedProductFolders)
    })),
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
    status: state.status,
    currentTask: compactTaskForStatus(currentTask),
    latestProgress: latestProgress
      ? {
          ...latestProgress,
          ageSeconds: resolveHermesProgressAgeSeconds({
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
  const summary = summarizeHermesImageGenerationEvents(events);
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

  const safelyPublished = entries.filter(
    (entry) => entry.status === "published" && ["publish_signal_confirmed", "list_verified"].includes(entry.finalVerifyStatus || "")
  );
  const failed = entries.filter((entry) => entry.status === "failed");
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
  const latestArtifact = summarizeLatestPublishArtifact(runtimeDir, activeEntry?.runtimeKey);
  const progressText =
    `发布进度 ${safelyPublished.length}/${total || "?"}` +
    (activeEntry?.productFolder ? `，当前/下一项：${path.basename(activeEntry.productFolder)}` : "") +
    (latestPublished?.productFolder ? `，最近完成：${path.basename(latestPublished.productFolder)}` : "") +
    (latestArtifact?.name ? `，最近产物：${String(latestArtifact.name)}` : "");

  return {
    manifestFile,
    planFile: fs.existsSync(planFile) ? planFile : undefined,
    total,
    safelyPublished: safelyPublished.length,
    failed: failed.length,
    pending: pending.length,
    progressText,
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

function summarizeFeishuProgress(): Record<string, unknown> | undefined {
  const job = readJsonFile<AutoListingJobFile>(fullRealJobFile);
  const feishuProductDataFile = job?.input ? path.resolve(rootDir, job.input.feishuProductDataFile || "data/feishu/products.json") : "";
  const processedManifestFile = job?.input ? path.resolve(rootDir, job.input.processedImageManifest || "data/auto-listing/processed-images.json") : "";
  if (!feishuProductDataFile || !fs.existsSync(feishuProductDataFile)) {
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
  } catch {
    return undefined;
  }
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
  const fingerprint = buildFeishuBatchFingerprint(loadFeishuProductRecords(feishuProductDataFile));
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
    throw new Error(`Feishu assets refresh failed before Hermes start: ${output || result.status || "unknown"}`);
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

function existingStatus(): Record<string, unknown> {
  const job = readJsonFile<RunnerJob>(jobFile);
  if (!job) {
    const latestResultFile = findLatestResultFile();
    const latestResult = summarizeResult(latestResultFile);
    const latestRuntimeDir = typeof latestResult?.runtimeDir === "string" ? latestResult.runtimeDir : latestResultFile ? path.dirname(latestResultFile) : undefined;
    return {
      ok: true,
      status: "idle",
      jobFile,
      latestResult,
      publishProgress: summarizePublishProgress(latestRuntimeDir)
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
    : selectHermesLatestResultFileForJobStatus({
        hasControlJob: Boolean(job),
        latestResultFile: findLatestResultFile()
      });
  const resultFile = selectHermesStatusResultFile({
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
  const runtimeDir = selectHermesStatusRuntimeDir({
    running,
    activeRuntimeDir,
    resultRuntimeDir: typeof result?.runtimeDir === "string" ? result.runtimeDir : undefined,
    resultFile
  });
  const publishProgress = summarizePublishProgress(runtimeDir);
  const feishuProgress = summarizeFeishuProgress();
  const state = summarizeState(runtimeDir);
  const publishLogProgress = summarizePublishLogProgress(job.logFile);
  const currentTask = state?.currentTask as Record<string, unknown> | undefined;
  const imageProgress = summarizeImageGenerationProgress(runtimeDir, currentTask?.taskId ? String(currentTask.taskId) : undefined);
  const activeResumeReusableArtifactCount =
    job.mode === "resume-real-job" && runtimeDir && currentTask?.taskId
      ? Math.max(
          countReusableRawImages(runtimeDir, String(currentTask.taskId)),
          countReusablePaidImageLedgerSlots(runtimeDir, String(currentTask.taskId))
        )
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
  const exposePublishProgress = shouldExposePublishProgressInHermesStatus({
    running,
    publishProgressAvailable: Boolean(publishProgress),
    currentTaskStatus: String((state?.currentTask as Record<string, unknown> | undefined)?.status || ""),
    stateProgressTimestamp: typeof latestStateProgressAt === "string" ? latestStateProgressAt : undefined,
    publishProgressTimestamp
  });
  const effectiveProgress = resolveHermesEffectiveProgressTimestamp({
    stateProgressTimestamp: typeof latestStateProgressAt === "string" ? latestStateProgressAt : undefined,
    activePublishUpdatedAt: exposePublishProgress && typeof activePublishUpdatedAt === "string" ? activePublishUpdatedAt : undefined,
    latestArtifactUpdatedAt: exposePublishProgress && typeof latestArtifactUpdatedAt === "string" ? latestArtifactUpdatedAt : undefined,
    latestPublishedUpdatedAt: exposePublishProgress && typeof latestPublishedUpdatedAt === "string" ? latestPublishedUpdatedAt : undefined
  });
  const progressHeartbeat = effectiveProgress
    ? {
        ...effectiveProgress,
        ageSeconds: resolveHermesProgressAgeSeconds({
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
  const batchComplete = feishuProgress ? feishuProgress.batchComplete === true : true;
  const feishuProgressDisplayMode = resolveHermesFeishuProgressDisplayMode({
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
  const failed =
    !running &&
    !completed &&
    ((result && result.ok === false) ||
      (state?.status === "failed") ||
      (publishProgress && Number(publishProgress.failed || 0) > 0));
  const hasPendingFeishuProducts = !running && !batchComplete;
  const resultError = result?.error as Record<string, unknown> | undefined;
  const stateError = (state?.currentTask as Record<string, unknown> | undefined)?.error as Record<string, unknown> | undefined;
  const resultFailureText = resultError
    ? [resultError.step, resultError.message].filter(Boolean).map(String).join(": ")
    : undefined;
  const stateFailureText = stateError ? [stateError.step, stateError.message].filter(Boolean).map(String).join(": ") : undefined;
  const terminalFailureMessage =
    running && ((result && (result.ok === false || result.status === "failed")) || state?.status === "failed")
      ? compactStatusValue(resultFailureText || stateFailureText || "")
      : undefined;
  const resolvedStatus = resolveHermesRuntimeStatus({
    running,
    activeWaitState: Boolean(activeWaitState),
    completed: Boolean(completed),
    failed: Boolean(failed),
    hasPendingFeishuProducts,
    stateStatus: typeof state?.status === "string" ? state.status : undefined,
    resultStatus: typeof result?.status === "string" ? result.status : undefined,
    terminalFailureMessage
  });
  const suppressHistoricalResult = shouldSuppressHistoricalResultInHermesStatus({
    running,
    publishProgressAvailable: exposePublishProgress,
    resultOk: typeof result?.ok === "boolean" ? result.ok : undefined,
    resultStatus: typeof result?.status === "string" ? result.status : undefined,
    activeRuntimeDir,
    resultRuntimeDir: typeof result?.runtimeDir === "string" ? result.runtimeDir : undefined
  });
  const suppressStateCurrentTask = shouldSuppressStateCurrentTaskInHermesStatus({
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
  const imageProgressSummaryMessage =
    typeof (imageProgress as Record<string, unknown> | undefined)?.latestMessage === "string"
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
  const failureSummary = failedError?.message ? compactStatusValue(String(failedError.message)) : undefined;
  const terminalFailureMtimeMs = fileMtimeMs(resultFile);
  const externalWaitReason = activeWaitState?.reason || terminalFailureMessage;
  const externalRetryAt = activeWaitState?.retryAt || "供应商恢复后";
  const realtimeProgress = resolveHermesRealtimeProgressSignal({
    jobStartedAt: job.startedAt,
    activeRunId: activeRuntimeDir ? path.basename(activeRuntimeDir) : typeof result?.runId === "string" ? result.runId : undefined,
    status: resolvedStatus,
    preferStatusMessage: Boolean(terminalFailureMessage && resolvedStatus === "external_service_wait"),
    statusMessage:
      terminalFailureMessage && resolvedStatus === "external_service_wait"
        ? `图片服务暂时不可用：${terminalFailureMessage}`
        : undefined,
    statusTimestamp: terminalFailureMtimeMs ? new Date(terminalFailureMtimeMs).toISOString() : undefined,
    statusSource:
      publishProgressHasNewerActive || publishProgressHasNewerArtifact || !preferStateSummary
        ? publishProgress
          ? "publish-manifest"
          : state
            ? "state"
            : "result-log"
        : "state",
    publishSafelyPublished: Number(publishProgress?.safelyPublished ?? 0),
    publishTotal: publishProgress?.total === undefined ? undefined : Number(publishProgress.total),
    publishFailed: Number(publishProgress?.failed ?? 0),
    publishActiveRuntimeKey: String((publishProgress?.active as Record<string, unknown> | undefined)?.runtimeKey || ""),
    publishActiveUpdatedAt:
      typeof activePublishUpdatedAt === "string" ? activePublishUpdatedAt : undefined,
    publishActiveMessage:
      typeof (publishProgress?.active as Record<string, unknown> | undefined)?.message === "string"
        ? String((publishProgress?.active as Record<string, unknown>).message)
        : undefined,
    latestArtifactUpdatedAt:
      typeof latestArtifactUpdatedAt === "string" ? latestArtifactUpdatedAt : undefined,
    latestArtifactName:
      typeof (publishProgress?.latestArtifact as Record<string, unknown> | undefined)?.name === "string"
        ? String((publishProgress?.latestArtifact as Record<string, unknown>).name)
        : undefined,
    publishLogTimestamp:
      typeof publishLogProgress?.timestamp === "string" ? String(publishLogProgress.timestamp) : undefined,
    publishLogMessage:
      typeof publishLogProgress?.message === "string" ? String(publishLogProgress.message) : undefined,
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
    statusSource: publishProgressHasNewerActive || publishProgressHasNewerArtifact || !preferStateSummary ? (publishProgress ? "publish-manifest" : state ? "state" : "result-log") : "state",
    summary:
      (resolvedStatus === "external_service_wait"
        ? `图片服务暂时不可用，已保留当前飞书批次和断点；将在 ${String(externalRetryAt)} 自动重试。原因：${compactStatusValue(externalWaitReason)}`
        : resolvedStatus === "failed"
        ? failureSummary || stateSummary
        : publishProgressHasNewerActive || publishProgressHasNewerArtifact || !preferStateSummary
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
    state: statusState,
    progressHeartbeat,
    realtimeProgress,
    imageProgress,
    publishLogProgress,
    publishProgress: exposePublishProgress ? publishProgress : undefined,
    feishuProgress,
    feishuProgressDisplayMode,
    feishuBatchDisplayCounts: feishuProgress
      ? resolveHermesFeishuBatchDisplayCounts({
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
  const counts = status.feishuBatchDisplayCounts as Record<string, unknown> | undefined;
  const currentTask = state?.currentTask as Record<string, unknown> | undefined;
  const latestProgress = state?.latestProgress as Record<string, unknown> | undefined;
  const publishLogProgress = status.publishLogProgress as Record<string, unknown> | undefined;
  const latestProgressText =
    typeof publishLogProgress?.message === "string"
      ? String(publishLogProgress.message)
      : latestProgress?.message
        ? compactStatusValue(String(latestProgress.message))
        : undefined;
  const active = progress?.active as Record<string, unknown> | undefined;
  return formatHermesCompactStatusText({
    status: String(status.status || "unknown"),
    summary: String(status.summary || ""),
    productName: currentTask?.sourceImageName ? String(currentTask.sourceImageName) : undefined,
    activeItemName: active?.productFolder ? path.basename(String(active.productFolder)) : undefined,
    latestProgress: latestProgressText,
    imageGenerationProgress:
      typeof (status.imageProgress as Record<string, unknown> | undefined)?.latestMessage === "string"
        ? String((status.imageProgress as Record<string, unknown>).latestMessage)
        : undefined,
    publishSafelyPublished: Number(progress?.safelyPublished ?? 0),
    publishTotal: progress?.total === undefined ? undefined : Number(progress.total),
    publishFailed: Number(progress?.failed ?? 0),
    feishuCompleted: counts?.completedCount === undefined ? Number(feishuProgress?.processedRecordCount ?? 0) : Number(counts.completedCount),
    feishuTotal: counts?.recordCount === undefined ? Number(feishuProgress?.recordCount ?? 0) : Number(counts.recordCount)
  });
}

function writePauseSignal(): Record<string, unknown> {
  fs.mkdirSync(controlDir, { recursive: true });
  fs.writeFileSync(pauseFile, new Date().toISOString() + "\n", "utf8");
  return {
    ok: true,
    status: "pause_requested",
    pauseFile,
    message: "已请求暂停；任务会在安全边界停止并保留当前产物。"
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
  const startStep = resumeJob?.input?.startStep || resumeJob?.startStep;
  if (!startStep || startStep === "done") {
    return false;
  }

  const resumeSourceImagePath = resumeJob?.input?.resumeSourceImagePath;
  if (!resumeSourceImagePath || !fs.existsSync(path.resolve(rootDir, resumeSourceImagePath))) {
    return false;
  }
  const resumeRuntimeDir = path.resolve(rootDir, resumeJob.runtimeDir || path.dirname(path.resolve(rootDir, resumeJob.resultFile || "")));
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
  const reusableRawImageCount = countReusableRawImages(
    resumeRuntimeDir,
    resumeJob.input?.resumeTaskId
  );
  const reusablePaidImageLedgerSlotCount = countReusablePaidImageLedgerSlots(
    resumeRuntimeDir,
    resumeJob.input?.resumeTaskId
  );
  const reusableArtifactCount = Math.max(reusableRawImageCount, reusablePaidImageLedgerSlotCount, resumeProductFolderCount);
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

  const state = readJsonFile<AutoListingStateFile>(path.join(resumeRuntimeDir, "state.json"));
  const stateTask = (state?.tasks || []).find((task) =>
    (resumeJob.input?.resumeTaskId && task.taskId === resumeJob.input.resumeTaskId) ||
    (task.sourceImagePath && path.resolve(rootDir, task.sourceImagePath) === path.resolve(rootDir, resumeSourceImagePath))
  );
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
  const publishResumeNeedsWork =
    startStep === "published" &&
    resumeProductFolderCount > 0 &&
    countSafelyPublishedManifestEntries(resumeRuntimeDir) < resumeProductFolderCount;
  const shouldResume = publishResumeNeedsWork || !result || (result.ok !== true && result.status !== "success");
  const latestRelevantFailure = findLatestFailedResultForResume();
  if (!publishResumeNeedsWork && (!latestRelevantFailure || path.resolve(latestRelevantFailure.resultFile) !== resultFile)) {
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

function countReusableRawImages(runtimeDir: string, taskId: string | undefined): number {
  if (!taskId) {
    return 0;
  }
  const taskDir = path.join(runtimeDir, "tasks", taskId);
  if (!fs.existsSync(taskDir)) {
    return 0;
  }
  let count = 0;
  const pending = [taskDir];
  while (pending.length > 0) {
    const currentDir = pending.pop() as string;
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        pending.push(fullPath);
        continue;
      }
      if (currentDir.includes(path.sep + "raw") && /^generated-\d+.*\.(png|jpg|jpeg|webp)$/i.test(entry.name)) {
        count += 1;
      }
    }
  }
  return count;
}

function countReusablePaidImageLedgerSlots(runtimeDir: string, taskId: string | undefined): number {
  if (!taskId) {
    return 0;
  }
  const taskDir = path.join(runtimeDir, "tasks", taskId);
  if (!fs.existsSync(taskDir)) {
    return 0;
  }
  let count = 0;
  const pending = [taskDir];
  while (pending.length > 0) {
    const currentDir = pending.pop() as string;
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        pending.push(fullPath);
        continue;
      }
      if (path.basename(currentDir) !== "slots" || !/^\d+\.json$/i.test(entry.name)) {
        continue;
      }
      try {
        const slot = JSON.parse(fs.readFileSync(fullPath, "utf8")) as { state?: string; providerTaskId?: string };
        if ((slot.state === "submitted" || slot.state === "completed") && typeof slot.providerTaskId === "string" && slot.providerTaskId) {
          count += 1;
        }
      } catch {
        // Ignore malformed ledger fragments; the main flow will fail closed if it reaches them.
      }
    }
  }
  return count;
}

function countResumeProductFolders(job: AutoListingJobFile | undefined): number {
  const names = new Set((job?.input?.resumeProductFolderNames || []).map((item) => String(item || "")).filter(Boolean));
  const shopRootDir = path.resolve(rootDir, job?.input?.shopRootDir || "input/auto-listing/shops");
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
        count += 1;
      }
    }
  }
  return count;
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
  return (manifest?.entries || []).filter(
    (entry) => entry.status === "published" && ["publish_signal_confirmed", "list_verified"].includes(entry.finalVerifyStatus || "")
  ).length;
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
    const runtimeDir = path.dirname(stateFile);
    const task = (state?.tasks || []).find((item) => item.status !== "done" && item.status !== "cleaned" && item.status !== "failed");
    if (!state || !task?.sourceImagePath) {
      continue;
    }
    const sourceImageExists = fs.existsSync(path.resolve(rootDir, task.sourceImagePath));
    const reusableRawImageCount = countReusableRawImages(runtimeDir, task.taskId);
    const reusablePaidImageLedgerSlotCount = countReusablePaidImageLedgerSlots(runtimeDir, task.taskId);
    const reusableArtifactCount = Math.max(reusableRawImageCount, reusablePaidImageLedgerSlotCount);
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
    if (!result || result.ok === true || result.status === "success") {
      continue;
    }
    const failedTask = (result.tasks || []).find((task) => task.status === "failed" || task.error);
    if (failedTask?.sourceImagePath && fs.existsSync(path.resolve(rootDir, failedTask.sourceImagePath))) {
      const runtimeDir = result.runtimeDir || path.dirname(resultFile);
      const reusableRawImageCount = countReusableRawImages(runtimeDir, failedTask.taskId);
      const reusablePaidImageLedgerSlotCount = countReusablePaidImageLedgerSlots(runtimeDir, failedTask.taskId);
      const resumeProductFolderCount = collectResumeProductFolderNames(failedTask).length;
      const reusableArtifactCount = Math.max(reusableRawImageCount, reusablePaidImageLedgerSlotCount, resumeProductFolderCount);
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
  const selected = selectHermesFailedResumeCandidate(candidates);
  return selected ? { resultFile: selected.resultFile, result: selected.result } : undefined;
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
  const resumeJob: AutoListingJobFile = {
    ...sourceJob,
    runtimeDir: interrupted.runtimeDir,
    resultFile: path.join(interrupted.runtimeDir, "result.json"),
    runId: interrupted.state.runId || path.basename(interrupted.runtimeDir),
    input: {
      ...sourceJob.input,
      startStep,
      endStep: "done",
      resumeSourceImagePath: interrupted.task.sourceImagePath,
      resumeTaskId: interrupted.task.taskId,
      resumeProductFolderNames: collectResumeProductFolderNames(interrupted.task),
      feishuBatchFingerprint: interrupted.state.feishuBatchFingerprint,
      maxImagesPerRun: 1,
      clearTestOutputsBeforeRun: false
    }
  };
  fs.mkdirSync(path.dirname(resumeJobFile), { recursive: true });
  fs.writeFileSync(resumeJobFile, JSON.stringify(resumeJob, null, 2) + "\n", "utf8");
  return resumeJob;
}

function ensureResumeJobFromLatestFailure(): AutoListingJobFile | undefined {
  const sourceJob = readJsonFile<AutoListingJobFile>(fullRealJobFile);
  if (!sourceJob?.input) {
    return undefined;
  }

  if (shouldResumeCurrentFailure()) {
    return readJsonFile<AutoListingJobFile>(resumeJobFile);
  }

  const interrupted = findLatestInterruptedStateForResume();
  if (interrupted?.task.sourceImagePath) {
    return writeResumeJobFromInterruptedState(sourceJob, interrupted);
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
  const resumeJob: AutoListingJobFile = {
    ...sourceJob,
    runtimeDir: failedRuntimeDir,
    resultFile: latest.resultFile,
    runId: latest.result.runId || path.basename(path.dirname(latest.resultFile)),
    input: {
      ...sourceJob.input,
      startStep: failedStep,
      endStep: "done",
      resumeSourceImagePath: failedTask.sourceImagePath,
      resumeTaskId: failedTask.taskId,
      resumeProductFolderNames: collectResumeProductFolderNames(failedTask),
      feishuBatchFingerprint: latest.result.feishuBatchFingerprint,
      maxImagesPerRun: 1,
      clearTestOutputsBeforeRun: false
    }
  };

  fs.mkdirSync(path.dirname(resumeJobFile), { recursive: true });
  fs.writeFileSync(resumeJobFile, JSON.stringify(resumeJob, null, 2) + "\n", "utf8");
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

function selectCommand(): {
  command: string;
  args: string[];
  mode: RunnerJob["mode"];
  expectedResultFile?: string;
  imageGenerationConfigFile?: string;
} {
  const resumeJob = ensureResumeJobFromLatestFailure();
  if (resumeJob) {
    return {
      command: "node",
      args: ["dist/src/cli/hermes-auto-listing-supervisor.js", "--initial", "resume"],
      mode: "resume-real-job",
      expectedResultFile: resumeJob?.resultFile ? path.resolve(rootDir, resumeJob.resultFile) : undefined,
      imageGenerationConfigFile: resolveImageGenerationConfigFile(resumeJob)
    };
  }
  const fullJob = readJsonFile<AutoListingJobFile>(fullRealJobFile);
  return {
    command: "node",
    args: ["dist/src/cli/hermes-auto-listing-supervisor.js", "--initial", "full"],
    mode: "full-real-flow",
    imageGenerationConfigFile: resolveImageGenerationConfigFile(fullJob)
  };
}

async function start(dryRun: boolean, text: boolean, forceRerunCurrentBatch: boolean): Promise<void> {
  fs.mkdirSync(controlDir, { recursive: true });
  const current = readJsonFile<RunnerJob>(jobFile);
  const runnerJobRunning = Boolean(current && isRunnerJobRunning(current));
  if (
    shouldClearPauseSignalOnHermesStart({
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
    await cleanupRecordedHermesChild();
  }

  const beforeRefreshProgress = summarizeFeishuProgress();
  if (!dryRun && beforeRefreshProgress?.batchComplete === true) {
    runFeishuAssetsRefreshForStart();
    const afterRefreshProgress = summarizeFeishuProgress();
    const decision = resolveHermesStartAfterFeishuRefresh({
      currentBatchComplete: beforeRefreshProgress.batchComplete === true,
      refreshedBatchChanged: beforeRefreshProgress.batchFingerprint !== afterRefreshProgress?.batchFingerprint,
      refreshedBatchComplete: afterRefreshProgress?.batchComplete === true,
      forceRerunCurrentBatch
    });
    if (decision === "require_rerun_confirmation") {
      const result = {
        ok: true,
        status: "rerun_confirmation_required",
        feishuProgress: afterRefreshProgress,
        message: "当前飞书批次产品已全部上架完成；刷新后没有发现新的产品批次。确认要重新跑原批次后，再使用重跑当前批次入口。"
      };
      console.log(text ? formatStartText(result) : JSON.stringify(result, null, 2));
      return;
    }
    if (decision === "rerun_current_batch") {
      clearCurrentBatchProcessedImages();
    }
  }
  const selected = selectCommand();
  const logFile = path.join(controlDir, `hermes-auto-listing-${timestampForFile()}.log`);
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

  await assertRealFlowNetworkPreflight(selected.imageGenerationConfigFile);

  const logFd = fs.openSync(logFile, "a");
  const child = spawn(selected.command, selected.args, {
    cwd: rootDir,
    detached: true,
    env: {
      ...process.env,
      HERMES_AUTOLIST_STARTED_BY: "hermes"
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
    status: "running"
  };
  fs.writeFileSync(jobFile, JSON.stringify(job, null, 2) + "\n");
  const result = {
    ok: true,
    status: "started",
    pid: job.pid,
    mode: job.mode,
    command: [job.command, ...job.args].join(" "),
    logFile: job.logFile,
    jobFile,
    message: "后台任务已启动；后续发送状态查询时读取发布清单进度，不需要 Hermes 持续等待进程结束。"
  };
  console.log(text ? formatStartText(result) : JSON.stringify(result, null, 2));
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const text = rest.includes("--text");
  if (command === "start") {
    await start(rest.includes("--dry-run"), text, rest.includes("--rerun-current-batch"));
    return;
  }
  if (command === "status") {
    const status = existingStatus();
    console.log(text ? formatStatusText(status) : JSON.stringify(status, null, 2));
    return;
  }
  if (command === "pause") {
    const result = writePauseSignal();
    console.log(text ? String(result.message) : JSON.stringify(result, null, 2));
    return;
  }
  throw new Error("Usage: hermes-auto-listing-runner <start|status|pause> [--dry-run] [--text] [--rerun-current-batch]");
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
