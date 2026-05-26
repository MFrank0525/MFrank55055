import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  isHermesSupervisorProcessCommand,
  selectHermesStatusResultFile,
  shouldPreferActiveTaskStateSummary
} from "../autolist/batch-continuation-rules.js";
import { summarizeFeishuBatchProgress } from "../autolist/audit-rules.js";
import { buildFeishuBatchFingerprint } from "../autolist/feishu-batch-rules.js";
import { readProcessedImages } from "../autolist/file-batch.js";
import { evaluateImageGenerationEndpointProbe } from "../autolist/image-generation-rules.js";
import { loadFeishuProductRecords } from "../autolist/feishu-products.js";
import { readLatestTaskProgressEvent } from "../autolist/progress-events.js";

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

const rootDir = process.cwd();
const controlDir = path.resolve(rootDir, "data/auto-listing/control");
const jobFile = path.join(controlDir, "hermes-auto-listing-job.json");
const pauseFile = path.join(controlDir, "pause.requested");
const resumeJobFile = path.resolve(rootDir, "input/auto-listing/auto-listing.job.mac-feishu-real.resume.generated.json");
const fullRealJobFile = path.resolve(rootDir, "input/auto-listing.job.mac-feishu-real.json");
const activeRunStartedPattern = /auto-listing run started:\s*([0-9]{8}-[0-9]{6})/;

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
  if (!isPidRunning(job.pid)) {
    return false;
  }
  const command = readProcessCommand(job.pid);
  if (!command) {
    return true;
  }
  return isHermesSupervisorProcessCommand(command);
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

function findActiveRuntimeDirFromLog(logFile: string | undefined): string | undefined {
  if (!logFile || !fs.existsSync(logFile)) {
    return undefined;
  }
  for (const line of tailFile(logFile, 200).reverse()) {
    const match = activeRunStartedPattern.exec(line);
    if (match) {
      const runtimeDir = path.resolve(rootDir, "data/auto-listing/runs", match[1]);
      return fs.existsSync(runtimeDir) ? runtimeDir : undefined;
    }
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
      generatedProductFolders: task.generatedProductFolders || []
    })),
    error: failedTask?.error || result.error,
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
    currentTask,
    latestProgress
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
  const feishuProductDataFile = job?.input ? path.resolve(rootDir, (job.input as { feishuProductDataFile?: string }).feishuProductDataFile || "data/feishu/products.json") : "";
  const processedManifestFile = job?.input ? path.resolve(rootDir, (job.input as { processedImageManifest?: string }).processedImageManifest || "data/auto-listing/processed-images.json") : "";
  if (!feishuProductDataFile || !fs.existsSync(feishuProductDataFile)) {
    return undefined;
  }
  try {
    const records = loadFeishuProductRecords(feishuProductDataFile);
    const batchFingerprint = buildFeishuBatchFingerprint(records);
    return summarizeFeishuBatchProgress({
      records,
      processedImages: readProcessedImages(processedManifestFile, batchFingerprint)
    }) as unknown as Record<string, unknown>;
  } catch {
    return undefined;
  }
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
  const latestResultFile = running ? undefined : findLatestResultFile();
  const resultFile = selectHermesStatusResultFile({
    running,
    expected: {
      resultFile: job.expectedResultFile,
      mtimeMs: fileMtimeMs(job.expectedResultFile)
    },
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
  const runtimeDir = typeof result?.runtimeDir === "string" ? result.runtimeDir : activeRuntimeDir || (resultFile ? path.dirname(resultFile) : undefined);
  const publishProgress = summarizePublishProgress(runtimeDir);
  const feishuProgress = summarizeFeishuProgress();
  const state = summarizeState(runtimeDir);
  const preferStateSummary = shouldPreferActiveTaskStateSummary({
    running,
    stateHasActiveTask: Boolean(state),
    publishProgressAvailable: Boolean(publishProgress)
  });
  const latestArtifactUpdatedAt = (publishProgress?.latestArtifact as Record<string, unknown> | undefined)?.updatedAt;
  const activePublishUpdatedAt = (publishProgress?.active as Record<string, unknown> | undefined)?.updatedAt;
  const latestStateProgressAt = (state?.latestProgress as Record<string, unknown> | undefined)?.timestamp;
  const publishProgressHasNewerActive =
    Boolean(activePublishUpdatedAt) &&
    (!latestStateProgressAt || Date.parse(String(activePublishUpdatedAt)) > Date.parse(String(latestStateProgressAt)));
  const publishProgressHasNewerArtifact =
    Boolean(latestArtifactUpdatedAt) &&
    (!latestStateProgressAt || Date.parse(String(latestArtifactUpdatedAt)) > Date.parse(String(latestStateProgressAt)));
  const batchComplete = feishuProgress ? feishuProgress.batchComplete === true : true;
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
  const stateSummary = state
    ? `任务${resolvedStatus === "running" ? "正在运行" : "已结束"}，当前阶段：${String((state.latestProgress as Record<string, unknown> | undefined)?.step || (state.currentTask as Record<string, unknown> | undefined)?.status || state.status || "unknown")}` +
      ((state.latestProgress as Record<string, unknown> | undefined)?.message
        ? `，最新进度：${String((state.latestProgress as Record<string, unknown>).message)}`
        : "")
    : undefined;
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
      (publishProgressHasNewerActive || publishProgressHasNewerArtifact || !preferStateSummary ? publishProgress?.progressText || stateSummary : stateSummary) ||
      (running
          ? "任务正在运行，尚未写入发布进度。"
          : "任务进程已退出，查看 result 字段确认最终结果。"),
    resultNote:
      running && publishProgress
        ? "进程仍在运行时 result.json 可能保留上一次失败内容；实时进度以 publishProgress/publish-manifest 为准。"
        : undefined,
    result,
    state,
    publishProgress,
    feishuProgress,
    logTail: tailFile(job.logFile, 12)
  };
}

function formatStatusText(status: Record<string, unknown>): string {
  const state = status.state as Record<string, unknown> | undefined;
  const progress = status.publishProgress as Record<string, unknown> | undefined;
  const result = status.result as Record<string, unknown> | undefined;
  const logTail = Array.isArray(status.logTail) ? status.logTail as string[] : [];
  const lines = [
    `上架状态：${String(status.status || "unknown")}`,
    `摘要：${String(status.summary || "暂无摘要")}`
  ];
  if (status.mode) {
    lines.push(`模式：${String(status.mode)}`);
  }
  if (status.startedAt) {
    lines.push(`启动时间：${String(status.startedAt)}`);
  }
  if (progress) {
    lines.push(`发布：${String(progress.safelyPublished ?? 0)}/${String(progress.total ?? "?")}，失败 ${String(progress.failed ?? 0)}，待处理 ${String(progress.pending ?? 0)}`);
  }
  const feishuProgress = status.feishuProgress as Record<string, unknown> | undefined;
  if (feishuProgress) {
    lines.push(`飞书批次：已处理 ${String(feishuProgress.processedRecordCount ?? "?")}/${String(feishuProgress.recordCount ?? "?")}，待处理 ${String(feishuProgress.pendingRecordCount ?? "?")}`);
  } else if (state) {
    const currentTask = state.currentTask as Record<string, unknown> | undefined;
    const latestProgress = state.latestProgress as Record<string, unknown> | undefined;
    lines.push(`运行批次：${String(state.runId || path.basename(String(status.activeRuntimeDir || "")) || "unknown")}`);
    if (currentTask?.sourceImageName) {
      lines.push(
        `当前商品：${String(currentTask.sourceImageName)}（${String(latestProgress?.step || currentTask.status || "unknown")}）`
      );
    }
    if (latestProgress?.message) {
      lines.push(`最新进度：${String(latestProgress.message)}`);
    }
  } else if (result) {
    lines.push(`最近结果：${String(result.status || "unknown")}，批次 ${String(result.runId || "unknown")}`);
  }
  if (logTail.length) {
    lines.push("最近日志：");
    lines.push(...logTail.slice(-4));
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

  if (!resumeJob?.resultFile) {
    return true;
  }

  const resultFile = path.resolve(rootDir, resumeJob.resultFile);
  const result = readJsonFile<AutoListingResultFile>(resultFile);
  const shouldResume = !result || (result.ok !== true && result.status !== "success");
  if (!shouldResume && fs.existsSync(resumeJobFile)) {
    fs.rmSync(resumeJobFile, { force: true });
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

function findLatestFailedResultForResume(): { resultFile: string; result: AutoListingResultFile } | undefined {
  for (const resultFile of listResultFilesNewestFirst()) {
    const result = readJsonFile<AutoListingResultFile>(resultFile);
    if (!result || result.ok === true || result.status === "success") {
      continue;
    }
    const failedTask = (result.tasks || []).find((task) => task.status === "failed" || task.error);
    if (failedTask?.sourceImagePath && fs.existsSync(path.resolve(rootDir, failedTask.sourceImagePath))) {
      return { resultFile, result };
    }
  }
  return undefined;
}

function ensureResumeJobFromLatestFailure(): AutoListingJobFile | undefined {
  const latest = findLatestFailedResultForResume();
  if (shouldResumeCurrentFailure()) {
    const currentResume = readJsonFile<AutoListingJobFile>(resumeJobFile);
    const currentResultFile = currentResume?.resultFile ? path.resolve(rootDir, currentResume.resultFile) : "";
    if (!latest || currentResultFile === path.resolve(rootDir, latest.resultFile)) {
      return currentResume;
    }
  }

  if (!latest) {
    return undefined;
  }
  const sourceJob = readJsonFile<AutoListingJobFile>(fullRealJobFile);
  const failedTask = (latest.result.tasks || []).find((task) => task.status === "failed" || task.error);
  if (!sourceJob?.input || !failedTask?.sourceImagePath) {
    return undefined;
  }

  const failedStep = failedTask.error?.step || "source_images_discovered";
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

async function start(dryRun: boolean, text: boolean): Promise<void> {
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
    await start(rest.includes("--dry-run"), text);
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
  throw new Error("Usage: hermes-auto-listing-runner <start|status|pause> [--dry-run] [--text]");
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
