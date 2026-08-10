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
import { getProductCategoryPlan } from "../autolist/product-category.js";
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
  findLatestIncompletePublishManifestForResume,
  findLatestUnsafePublishManifestForResume as selectLatestUnsafePublishManifestForResume,
  unsafePublishEntriesForResume
} from "../autolist/unsafe-publish-resume.js";
import { sanitizePythonRuntimeEnv } from "../utils/platform.js";

import type { RunnerJob, DirectAutoListingProcess, ExternalServiceWait, PauseSignalFile, AutoListingJobFile, AutoListingTaskFile, AutoListingResultFile, AutoListingStateFile, PublishManifestFile, PublishPlanFile, DeferredMainImageRoundFile, LocalFeishuConfig } from "./auto-listing-controller-contract.js";
import { rootDir, controlDir, jobFile, childControlFile, externalServiceWaitFile, pauseFile, resumeJobFile, fullRealJobFile, deferredMainImageRoot, feishuConfigFile } from "./auto-listing-controller-contract.js";
import { readJsonFile, readPauseSignalFile, writePauseSignalFile, formatPauseSignalSummary, maybeUpgradeLegacyPauseSignalForBatchMismatch, readProcessCommand, extractDirectAutoListingJobFile, findActiveDirectAutoListingProcess, isPidRunning, isRunnerJobRunning, isProcessGroupRunning, cleanupRecordedAutoListingControllerChild, timestampForFile, tailFile, compactStatusLine, latestAutoListingChildFailureFromLog, compactStatusValue, formatFeishuCacheValidationFailureForOperator, publishModuleLabel, summarizePublishLogProgress, compactErrorObject, compactProductFolders, compactTaskForStatus, findActiveRuntimeDirFromLog, fileMtimeMs, findLatestResultFile, listResultFilesNewestFirst, summarizeResult, summarizeState, summarizeImageGenerationProgress, summarizeLatestPublishArtifact, summarizePublishProgress, findLatestRuntimeDirWithPublishManifest, isActiveManualRecoveryPublishProgress, isActivePublishProgress, summarizeFeishuProgress } from "./auto-listing-controller-runtime.js";
import { safeLoadFeishuProductRecords, attachmentLocalFile, summarizeFeishuCurrentProduct, loadFeishuEnv, runFeishuAssetsRefreshForStart, clearCurrentBatchProcessedImages, clearCurrentBatchPaidImageLedger, cleanupNonCurrentBatchResidue, summarizeCurrentPaidImageProgress, summarizeCurrentFeishuBatchForResume, shouldResumeSourceImageForCurrentFeishuBatch, summarizeActiveDirectAutoListingStatus, existingStatus } from "./auto-listing-controller-status.js";

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
  const currentCategoryPlan = getProductCategoryPlan(
    typeof feishuCurrentProduct?.productCategory === "string" ? String(feishuCurrentProduct.productCategory) : undefined
  );
  const latestArtifact = progress?.latestArtifact as Record<string, unknown> | undefined;
  const artifactIsNewerThanActive =
    typeof latestArtifact?.updatedAt === "string" &&
    (!active?.updatedAt || Date.parse(String(latestArtifact.updatedAt)) > Date.parse(String(active.updatedAt)));
  const publishArtifactMessage =
    artifactIsNewerThanActive && typeof latestArtifact?.name === "string"
      ? `最近产物：${String(latestArtifact.name)}`
      : undefined;
  const publishActiveMessage = publishArtifactMessage || (typeof active?.message === "string" ? compactStatusValue(String(active.message)) : undefined);
  const stateLatestProgressMessage = latestProgress?.message ? compactStatusValue(String(latestProgress.message)) : undefined;
  const stateLatestProgressAt = Date.parse(String(latestProgress?.timestamp || ""));
  const publishActiveAt = Math.max(
    Date.parse(String(active?.updatedAt || "")) || 0,
    Date.parse(String(latestArtifact?.updatedAt || "")) || 0,
    Date.parse(String(publishLogProgress?.timestamp || "")) || 0
  );
  const preferStateLatestProgress =
    String(status.status || "") === "running" &&
    Boolean(stateLatestProgressMessage) &&
    Number.isFinite(stateLatestProgressAt) &&
    stateLatestProgressAt > publishActiveAt;
  const latestResultError = latestResult?.error as Record<string, unknown> | undefined;
  const latestResultProducts = Array.isArray(latestResult?.products) ? (latestResult.products as Array<Record<string, unknown>>) : [];
  const failedResultProduct = latestResultProducts.find((product) => product.status === "failed" || product.error);
  const latestResultFailureMessage =
    String(status.status || "") === "failed" && typeof latestResultError?.message === "string"
      ? compactStatusValue(String(latestResultError.message))
      : undefined;
  const latestProgressText =
    (preferStateLatestProgress ? stateLatestProgressMessage : undefined) ||
    publishActiveMessage ||
    (typeof publishLogProgress?.message === "string"
      ? String(publishLogProgress.message)
      : latestProgress?.message
        ? stateLatestProgressMessage
        : latestResultFailureMessage);
  const currentWatermarkMatch = /水印\s*0*(\d+)/i.exec(
    [latestProgressText, active?.productFolder, stateLatestProgressMessage].filter(Boolean).join(" ")
  );
  const publishCurrentWatermarkNo = currentWatermarkMatch ? Number(currentWatermarkMatch[1]) : undefined;
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
    showPublishProgress: Boolean(progress || publishLogProgress),
    summary: String(status.summary || latestResultFailureMessage || ""),
    productName:
      typeof publishGroupProgress?.productName === "string"
        ? String(publishGroupProgress.productName)
        : currentTask?.sourceImageName
          ? String(currentTask.sourceImageName)
          : typeof failedResultProduct?.sourceImageName === "string"
            ? String(failedResultProduct.sourceImageName)
          : undefined,
    activeItemName: typeof feishuCurrentProduct?.userCognitionName === "string" ? String(feishuCurrentProduct.userCognitionName) : active?.productFolder ? path.basename(String(active.productFolder)) : undefined,
    latestProgress: latestProgressText,
    imageGenerationProgress: imageGenerationProgressMessage,
    mainImageCompleted:
      shouldExposeImageGenerationProgress && typeof paidImageProgress?.completed === "number"
        ? Number(paidImageProgress.completed)
        : undefined,
    mainImageExpected:
      shouldExposeImageGenerationProgress && typeof paidImageProgress?.expectedSlotCount === "number" ? Number(paidImageProgress.expectedSlotCount) : undefined,
    publishSafelyPublished: Number(publishGroupProgress?.completed ?? progress?.safelyPublished ?? 0),
    publishTotal: progress?.total === undefined ? undefined : Number(progress.total),
    publishFailed: Number(progress?.failed ?? 0),
    publishProductIndex:
      typeof publishGroupProgress?.productIndex === "number" ? Number(publishGroupProgress.productIndex) : undefined,
    publishProductTotal:
      typeof publishGroupProgress?.productTotal === "number" ? Number(publishGroupProgress.productTotal) : undefined,
    publishShopIndex:
      typeof publishGroupProgress?.shopIndex === "number" ? Number(publishGroupProgress.shopIndex) : undefined,
    publishShopTotal:
      typeof publishGroupProgress?.shopTotal === "number"
        ? Number(publishGroupProgress.shopTotal)
        : currentCategoryPlan.shopCodes.length,
    publishImagesPerShop: currentCategoryPlan.imagesPerShop,
    publishFailedWatermarkNo:
      typeof publishGroupProgress?.failedWatermarkNo === "number" ? Number(publishGroupProgress.failedWatermarkNo) : undefined,
    publishReviewWatermarkNo:
      typeof publishGroupProgress?.reviewWatermarkNo === "number" ? Number(publishGroupProgress.reviewWatermarkNo) : undefined,
    publishLatestAttemptedWatermarkNo:
      typeof publishGroupProgress?.latestAttemptedWatermarkNo === "number" ? Number(publishGroupProgress.latestAttemptedWatermarkNo) : undefined,
    publishCurrentWatermarkNo,
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
    hasPendingResumeProductFolders({ resumeProductFolderNames: resumeJob.input?.resumeProductFolderNames || [], manifestEntries: readJsonFile<PublishManifestFile>(path.join(resumeRuntimeDir, "publish-manifest.json"))?.entries || [] });
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
      const runtimeManifest = readJsonFile<PublishManifestFile>(path.join(unsafeLatest.runtimeDir, "publish-manifest.json"));
      const resumeProductFolderNames = selectRemainingResumeProductFolderNames({ allProductFolderNames: collectResumeProductFolderNames(task), manifestEntries: runtimeManifest?.entries || [] });
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

  const incompleteLatest = findLatestIncompletePublishManifestForResume({
    rootDir,
    resultFiles: listResultFilesNewestFirst(),
    fileMtimeMs,
    countSafelyPublishedManifestEntries,
    shouldResumeSourceImageForCurrentFeishuBatch
  });
  if (incompleteLatest?.result.businessRuleFingerprint === buildAutoListingBusinessRuleFingerprint() && incompleteLatest.task.sourceImagePath) {
    const resumeJob: AutoListingJobFile = {
      ...sourceJob,
      runtimeDir: incompleteLatest.runtimeDir,
      resultFile: incompleteLatest.resultFile,
      runId: incompleteLatest.result.runId || path.basename(incompleteLatest.runtimeDir),
      input: {
        ...sourceJob.input,
        startStep: "published",
        endStep: "done",
        resumeSourceImagePath: incompleteLatest.task.sourceImagePath,
        resumeTaskId: incompleteLatest.task.taskId,
        resumeProductFolderNames: incompleteLatest.remainingProductFolderNames,
        feishuBatchFingerprint: incompleteLatest.result.feishuBatchFingerprint,
        businessRuleFingerprint: incompleteLatest.result.businessRuleFingerprint,
        maxImagesPerRun: 1,
        clearTestOutputsBeforeRun: false
      }
    };
    atomicWriteJson(resumeJobFile, resumeJob);
    return resumeJob;
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
    const status = existingStatus(findLatestInterruptedStateForResume);
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
    await cleanupInertControllerSupervisor({ job: current });
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
    env: sanitizePythonRuntimeEnv({
      ...process.env,
      AUTO_LISTING_STARTED_BY: "project-controller"
    }),
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
    const status = existingStatus(findLatestInterruptedStateForResume);
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
