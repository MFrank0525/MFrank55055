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
  hasPendingResumeProductFolders,
  selectRemainingResumeProductFolderNames,
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

import type { RunnerJob, DirectAutoListingProcess, ExternalServiceWait, PauseSignalFile, AutoListingJobFile, AutoListingTaskFile, AutoListingResultFile, AutoListingStateFile, PublishManifestFile, PublishPlanFile, DeferredMainImageRoundFile, LocalFeishuConfig } from "./auto-listing-controller-contract.js";
import { rootDir, controlDir, jobFile, childControlFile, externalServiceWaitFile, pauseFile, resumeJobFile, fullRealJobFile, deferredMainImageRoot, feishuConfigFile } from "./auto-listing-controller-contract.js";
import { readJsonFile, readPauseSignalFile, writePauseSignalFile, formatPauseSignalSummary, maybeUpgradeLegacyPauseSignalForBatchMismatch, readProcessCommand, extractDirectAutoListingJobFile, findActiveDirectAutoListingProcess, isPidRunning, isRunnerJobRunning, isProcessGroupRunning, cleanupRecordedAutoListingControllerChild, timestampForFile, tailFile, compactStatusLine, latestAutoListingChildFailureFromLog, compactStatusValue, formatFeishuCacheValidationFailureForOperator, publishModuleLabel, summarizePublishLogProgress, compactErrorObject, compactProductFolders, compactTaskForStatus, findActiveRuntimeDirFromLog, fileMtimeMs, findLatestResultFile, listResultFilesNewestFirst, summarizeResult, summarizeState, summarizeImageGenerationProgress, summarizeLatestPublishArtifact, summarizePublishProgress, findLatestRuntimeDirWithPublishManifest, isActiveManualRecoveryPublishProgress, isActivePublishProgress, summarizeFeishuProgress } from "./auto-listing-controller-runtime.js";

export function safeLoadFeishuProductRecords(productDataFile: string): ReturnType<typeof loadFeishuProductRecords> {
  try {
    return loadFeishuProductRecords(productDataFile);
  } catch {
    return [];
  }
}

export function attachmentLocalFile(record: { whiteBackgroundImages?: Array<{ localFile?: string }> }): string {
  return path.resolve(String(record.whiteBackgroundImages?.[0]?.localFile || ""));
}

export function summarizeFeishuCurrentProduct(input: {
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

export function loadFeishuEnv(configFile: string): NodeJS.ProcessEnv {
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

export function runFeishuAssetsRefreshForStart(): number | null {
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

export function clearCurrentBatchProcessedImages(): boolean {
  const job = readJsonFile<AutoListingJobFile>(fullRealJobFile);
  const progress = summarizeFeishuProgress();
  const fingerprint = typeof progress?.batchFingerprint === "string" ? progress.batchFingerprint : "";
  const processedManifestFile = path.resolve(rootDir, job?.input?.processedImageManifest || "data/auto-listing/processed-images.json");
  return clearProcessedImagesForBatch(processedManifestFile, fingerprint);
}

export function clearCurrentBatchPaidImageLedger(): boolean {
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

export function cleanupNonCurrentBatchResidue(currentBatchFingerprint: string): string[] {
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

export function summarizeCurrentPaidImageProgress(input: {
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

export function summarizeCurrentFeishuBatchForResume(): { batchComplete: boolean; pendingSourceImages: string[] } | undefined {
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

export function shouldResumeSourceImageForCurrentFeishuBatch(
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

export function summarizeActiveDirectAutoListingStatus(directProcess: DirectAutoListingProcess): Record<string, unknown> {
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

export function existingStatus(
  findInterruptedState: () => { runtimeDir: string } | undefined = () => undefined
): Record<string, unknown> {
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
    const interrupted = status === "pause_requested" ? findInterruptedState() : undefined;
    const activePublishState = activePublishRunning ? summarizeState(publishRuntimeDir) : undefined;
    const interruptedState = activePublishState || summarizeState(interrupted?.runtimeDir);
    const interruptedCurrentTask = interruptedState?.currentTask as Record<string, unknown> | undefined;
    const exposePublishCheckpoint = activePublishRunning || shouldRetainStoppedControllerPublishCheckpoint({ controllerStatus: status, currentTaskStatus: String(interruptedCurrentTask?.status || ""), publishProgressAvailable: Boolean(publishProgress) });
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
      exposePublishCheckpoint && feishuProductRecordsForStatus.length
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
      statusSource: exposePublishCheckpoint ? "publish-manifest" : interruptedState ? "state" : "idle",
      historicalRuntimeSuppressed: !exposeHistoricalRuntime && Boolean(historicalResult),
      pauseSignal,
      publishProgress: exposePublishCheckpoint ? publishProgress : undefined,
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
    running && ["external_service_wait", "doudian_login_wait"].includes(String(waitState?.status || "")) && waitState?.supervisorPid === job.pid
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
      return existingStatus(findInterruptedState);
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
    running, publishProgressAvailable: Boolean(publishProgress),
    currentTaskStatus: String(currentTask?.status || ""), currentTaskRecordId: String(currentTask?.recordId || ""),
    publishRecordId: String((publishProgress?.publishGroupProgress as Record<string, unknown> | undefined)?.recordId || ""),
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
    activeWaitState: activeWaitState?.status === "external_service_wait", activeLoginWaitState: activeWaitState?.status === "doudian_login_wait",
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
  const acceptedTaskQueueSummary =
    resolvedStatus === "external_service_wait" && !activeWaitState && Number(paidImageProgress?.submitted || 0) > 0
      ? formatPaidImageAcceptedTaskWaitSummary({ completed: Number(paidImageProgress?.completed || 0), expected: Number(paidImageProgress?.expectedSlotCount || 20), submitted: Number(paidImageProgress?.submitted || 0), latestProgressAt: typeof latestStateProgressAt === "string" ? latestStateProgressAt : undefined })
      : undefined;
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
        : resolveDoudianLoginWaitRealtimeMessage(resolvedStatus);
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
        : resolvedStatus === "external_service_wait" || resolvedStatus === "doudian_login_wait"
        ? acceptedTaskQueueSummary || formatAutoListingControllerWaitSummary({ status: resolvedStatus, retryAt: activeWaitState?.retryAt, nowMs: Date.now(), reason: externalWaitReason })
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
