import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  isHermesSupervisorProcessCommand,
  isHermesRunningProcessConfirmed,
  isExternalMainImageRawReuseMessage,
  resolveHermesEffectiveProgressTimestamp,
  resolveHermesFeishuBatchDisplayCounts,
  resolveHermesFeishuProgressDisplayMode,
  resolveHermesProgressAgeSeconds,
  resolveHermesStartAfterFeishuRefresh,
  selectHermesActiveRunIdFromLogLines,
  selectHermesLatestResultFileForJobStatus,
  selectHermesStatusResultFile,
  selectHermesStatusRuntimeDir,
  shouldExposePublishProgressInHermesStatus,
  shouldPreferActiveTaskStateSummary,
  shouldResumeHistoricalFailureForCurrentFeishuBatch,
  shouldResumeInterruptedTaskInPlace,
  shouldSuppressHistoricalResultInHermesStatus,
  shouldSuppressStateCurrentTaskInHermesStatus,
  shouldUseExpectedResultFileInRunningStatus
} from "../autolist/batch-continuation-rules.js";
import { summarizeFeishuBatchProgress } from "../autolist/audit-rules.js";
import { buildFeishuBatchFingerprint } from "../autolist/feishu-batch-rules.js";
import { clearProcessedImagesForBatch, migrateLegacyProcessedImagesToBatch, readProcessedImages } from "../autolist/file-batch.js";
import { evaluateImageGenerationEndpointProbe } from "../autolist/image-generation-rules.js";
import { loadFeishuProductRecords } from "../autolist/feishu-products.js";
import { readLatestTaskProgressEvent } from "../autolist/progress-events.js";
import { inferResumeStartStepForTask } from "../autolist/resume-rules.js";

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

interface AutoListingJobFile {
  input?: {
    startStep?: string;
    endStep?: string;
    resumeSourceImagePath?: string;
    resumeTaskId?: string;
    resumeProductFolderNames?: string[];
    feishuProductDataFile?: string;
    processedImageManifest?: string;
    imageGenerationConfigFile?: string;
    imageGenerationProvider?: string;
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
    command
  });
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
  return compact.length > 500 ? `${compact.slice(0, 500)}... [truncated]` : compact;
}

function compactStatusValue(value: string | undefined): string | undefined {
  return value ? compactStatusLine(value) : value;
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
  const reused = /Reused\s+(\d+)\s+current-product raw main image/i.exec(latestReuseEvent?.message || "");
  const ready = /Main images ready:\s*(\d+)\s*file/i.exec(latest.message || "");
  const saved = /saved generated-(\d+)/i.exec(latest.message || "");
  const submitting = /Prompt\s+(\d+)\/(\d+):\s*Image\s+(\d+)/i.exec(latest.message || "");
  return {
    status: reused ? "reused_raw_images" : ready ? "ready" : saved ? "generating" : submitting ? "generating" : "in_progress",
    count: reused ? Number(reused[1]) : ready ? Number(ready[1]) : undefined,
    latestMessage: compactStatusValue(reused ? latestReuseEvent?.message || "" : latest.message || ""),
    updatedAt: reused ? latestReuseEvent?.timestamp : latest.timestamp
  };
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

function shouldResumeSourceImageForCurrentFeishuBatch(sourceImagePath: string | undefined, reusableArtifactCount = 0): boolean {
  const batch = summarizeCurrentFeishuBatchForResume();
  if (!batch) {
    return true;
  }
  return shouldResumeHistoricalFailureForCurrentFeishuBatch({
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
  const currentTask = state?.currentTask as Record<string, unknown> | undefined;
  const imageProgress = summarizeImageGenerationProgress(runtimeDir, currentTask?.taskId ? String(currentTask.taskId) : undefined);
  const activeResumeReusableArtifactCount =
    job.mode === "resume-real-job" && runtimeDir && currentTask?.taskId
      ? countReusableRawImages(runtimeDir, String(currentTask.taskId))
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
  const resolvedStatus = running ? "running" : completed ? "completed" : failed ? "failed" : hasPendingFeishuProducts ? "pending_products" : "exited_unknown";
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
  const stateSummary = state
    ? `任务${resolvedStatus === "running" ? "正在运行" : "已结束"}，当前阶段：${String((state.latestProgress as Record<string, unknown> | undefined)?.step || (state.currentTask as Record<string, unknown> | undefined)?.status || state.status || "unknown")}` +
      ((state.latestProgress as Record<string, unknown> | undefined)?.message
        ? `，最新进度：${compactStatusValue(String((state.latestProgress as Record<string, unknown>).message))}`
        : "")
    : undefined;
  const failedError = (state?.currentTask as Record<string, unknown> | undefined)?.error as Record<string, unknown> | undefined;
  const failureSummary = failedError?.message ? compactStatusValue(String(failedError.message)) : undefined;
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
      (resolvedStatus === "failed"
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
    state: statusState,
    progressHeartbeat,
    imageProgress,
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
  const result = status.result as Record<string, unknown> | undefined;
  const lines = [
    `上架状态：${String(status.status || "unknown")}`,
    `${status.status === "failed" ? "失败原因" : "摘要"}：${String(status.summary || "暂无摘要")}`
  ];
  if (state) {
    const currentTask = state.currentTask as Record<string, unknown> | undefined;
    const latestProgress = state.latestProgress as Record<string, unknown> | undefined;
    lines.push(`运行批次：${String(state.runId || path.basename(String(status.activeRuntimeDir || "")) || "unknown")}`);
    if (currentTask?.sourceImageName) {
      const error = currentTask.error as Record<string, unknown> | undefined;
      const stage = currentTask.status === "failed" && error?.step ? `failed at ${String(error.step)}` : String(latestProgress?.step || currentTask.status || "unknown");
      lines.push(`当前商品：${String(currentTask.sourceImageName)}（${stage}）`);
    }
    if (latestProgress?.message && currentTask?.status !== "failed") {
      lines.push(`最新进度：${compactStatusValue(String(latestProgress.message))}`);
    }
    const error = currentTask?.error as Record<string, unknown> | undefined;
    if (error?.message && status.status !== "failed") {
      lines.push(`异常原因：${compactStatusValue(String(error.message))}`);
    }
  }
  const imageProgress = status.imageProgress as Record<string, unknown> | undefined;
  if (imageProgress) {
    if (imageProgress.status === "reused_raw_images") {
      lines.push(`生图：已复用当前商品 raw 主图 ${String(imageProgress.count ?? "?")} 张；不会重新调用中转站生成。`);
    } else {
      lines.push(`生图：${String(imageProgress.latestMessage || imageProgress.status || "进行中")}`);
    }
  }
  if (progress) {
    if (status.status === "failed" && Number(progress.safelyPublished || 0) === 0 && Number(progress.failed || 0) === 0) {
      lines.push("发布：未开始真实发布；发布前预检已拦截。");
    } else {
      lines.push(`发布：${String(progress.safelyPublished ?? 0)}/${String(progress.total ?? "?")}，失败 ${String(progress.failed ?? 0)}，待处理 ${String(progress.pending ?? 0)}`);
    }
  }
  const feishuProgress = status.feishuProgress as Record<string, unknown> | undefined;
  if (feishuProgress) {
    if (status.feishuProgressDisplayMode === "resume_artifact_completion") {
      lines.push(
        `飞书批次：旧批次已完成 ${String(feishuProgress.processedRecordCount ?? "?")}/${String(feishuProgress.recordCount ?? "?")}；当前在收尾已有生图产物，完成后自动刷新新批次`
      );
    } else {
      const counts = status.feishuBatchDisplayCounts as Record<string, unknown> | undefined;
      if (counts) {
        lines.push(
          `飞书批次：已完成 ${String(counts.completedCount ?? "?")}/${String(counts.recordCount ?? "?")}，当前处理 ${String(counts.currentCount ?? 0)}，未开始 ${String(counts.notStartedCount ?? "?")}`
        );
      } else {
        lines.push(`飞书批次：已处理 ${String(feishuProgress.processedRecordCount ?? "?")}/${String(feishuProgress.recordCount ?? "?")}，待处理 ${String(feishuProgress.pendingRecordCount ?? "?")}`);
      }
    }
  } else if (result) {
    lines.push(`最近结果：${String(result.status || "unknown")}，批次 ${String(result.runId || "unknown")}`);
  }
  return lines.join("\n");
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
  const reusableRawImageCount = countReusableRawImages(
    path.resolve(rootDir, resumeJob.runtimeDir || path.dirname(path.resolve(rootDir, resumeJob.resultFile || ""))),
    resumeJob.input?.resumeTaskId
  );
  if (!shouldResumeSourceImageForCurrentFeishuBatch(resumeSourceImagePath, reusableRawImageCount)) {
    fs.rmSync(resumeJobFile, { force: true });
    return false;
  }

  if (!resumeJob?.resultFile) {
    return true;
  }

  const resultFile = path.resolve(rootDir, resumeJob.resultFile);
  const result = readJsonFile<AutoListingResultFile>(resultFile);
  const shouldResume = !result || (result.ok !== true && result.status !== "success");
  const latestRelevantFailure = findLatestFailedResultForResume();
  if (!latestRelevantFailure || path.resolve(latestRelevantFailure.resultFile) !== resultFile) {
    fs.rmSync(resumeJobFile, { force: true });
    return false;
  }
  if (!shouldResume && fs.existsSync(resumeJobFile)) {
    fs.rmSync(resumeJobFile, { force: true });
  }
  const failedTask = (result?.tasks || []).find((task) => task.status === "failed" || task.error);
  if (shouldResume && failedTask) {
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
    if (taskHasExternalMainImageRawReuse(runtimeDir, task.taskId)) {
      continue;
    }
    if (!shouldResumeSourceImageForCurrentFeishuBatch(task.sourceImagePath, reusableRawImageCount)) {
      continue;
    }
    if (
      shouldResumeInterruptedTaskInPlace({
        runStatus: state.status,
        taskStatus: task.status,
        sourceImageExists,
        reusableRawImageCount
      })
    ) {
      candidates.push({
        stateFile,
        runtimeDir,
        state,
        task,
        reusableRawImageCount,
        safelyPublishedCount: countSafelyPublishedManifestEntries(runtimeDir),
        mtimeMs: fs.statSync(stateFile).mtimeMs
      });
    }
  }
  return candidates.sort((a, b) => b.safelyPublishedCount - a.safelyPublishedCount || b.reusableRawImageCount - a.reusableRawImageCount || b.mtimeMs - a.mtimeMs)[0];
}

function findLatestFailedResultForResume(): { resultFile: string; result: AutoListingResultFile } | undefined {
  for (const resultFile of listResultFilesNewestFirst()) {
    const result = readJsonFile<AutoListingResultFile>(resultFile);
    if (!result || result.ok === true || result.status === "success") {
      continue;
    }
    const failedTask = (result.tasks || []).find((task) => task.status === "failed" || task.error);
    if (failedTask?.sourceImagePath && fs.existsSync(path.resolve(rootDir, failedTask.sourceImagePath))) {
      const runtimeDir = result.runtimeDir || path.dirname(resultFile);
      if (
        shouldResumeSourceImageForCurrentFeishuBatch(
          failedTask.sourceImagePath,
          countReusableRawImages(runtimeDir, failedTask.taskId)
        )
      ) {
        if (taskHasExternalMainImageRawReuse(runtimeDir, failedTask.taskId)) {
          return undefined;
        }
        return { resultFile, result };
      }
    }
  }
  return undefined;
}

function writeResumeJobFromInterruptedState(
  sourceJob: AutoListingJobFile,
  interrupted: NonNullable<ReturnType<typeof findLatestInterruptedStateForResume>>
): AutoListingJobFile {
  const resumeJob: AutoListingJobFile = {
    ...sourceJob,
    runtimeDir: interrupted.runtimeDir,
    resultFile: path.join(interrupted.runtimeDir, "result.json"),
    runId: interrupted.state.runId || path.basename(interrupted.runtimeDir),
    input: {
      ...sourceJob.input,
      startStep: inferResumeStartStepForTask(interrupted.task),
      endStep: "done",
      resumeSourceImagePath: interrupted.task.sourceImagePath,
      resumeTaskId: interrupted.task.taskId,
      resumeProductFolderNames: collectResumeProductFolderNames(interrupted.task),
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

  const interrupted = findLatestInterruptedStateForResume();
  if (interrupted?.task.sourceImagePath) {
    return writeResumeJobFromInterruptedState(sourceJob, interrupted);
  }

  if (shouldResumeCurrentFailure()) {
    return readJsonFile<AutoListingJobFile>(resumeJobFile);
  }

  const latest = findLatestFailedResultForResume();
  if (!latest) {
    return undefined;
  }

  const failedTask = (latest.result.tasks || []).find((task) => task.status === "failed" || task.error);
  if (!failedTask?.sourceImagePath) {
    return undefined;
  }

  const failedStep = inferResumeStartStepForTask(failedTask);
  const resumeJob: AutoListingJobFile = {
    ...sourceJob,
    runtimeDir: latest.result.runtimeDir || path.dirname(latest.resultFile),
    resultFile: latest.resultFile,
    runId: latest.result.runId || path.basename(path.dirname(latest.resultFile)),
    input: {
      ...sourceJob.input,
      startStep: failedStep,
      endStep: "done",
      resumeSourceImagePath: failedTask.sourceImagePath,
      resumeTaskId: failedTask.taskId,
      resumeProductFolderNames: collectResumeProductFolderNames(failedTask),
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
  if (current && isRunnerJobRunning(current)) {
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

  if (fs.existsSync(pauseFile)) {
    fs.rmSync(pauseFile);
  }

  const selected = selectCommand();
  const beforeRefreshProgress = summarizeFeishuProgress();
  if (!dryRun && selected.mode === "full-real-flow" && beforeRefreshProgress?.batchComplete === true) {
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
