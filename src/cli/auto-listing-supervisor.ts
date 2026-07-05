import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { summarizeFeishuBatchProgress } from "../autolist/audit-rules.js";
import {
  resolveDefaultRetryableChildFailureRecoveryAttempts,
  resolveAutoListingControllerChildStallTimeoutMs,
  isAutoListingControllerProgressArtifactRelativePath,
  isRetryableExternalServiceAvailabilityFailure,
  resolveSupervisorRecoveryChildMode,
  resolveSupervisorRecoveryDelayMs,
  shouldConsumeSupervisorRecoveryAttempt,
  shouldRefreshAutoListingChildProgressSeenAt,
  shouldTerminateChildAfterTerminalResult,
  shouldContinueFullFlowAfterChildExit,
  shouldContinueFeishuAfterBatchRefresh,
  shouldRecoverFullFlowAfterChildFailure,
  shouldRefreshFeishuAssetsBeforeFullFlow,
  type FullFlowContinuationReason
} from "../autolist/batch-continuation-rules.js";
import { shouldRefreshFeishuAssetsToCandidateCache } from "../autolist/feishu-refresh-rules.js";
import { buildFeishuBatchFingerprint } from "../autolist/feishu-batch-rules.js";
import { migrateLegacyProcessedImagesToBatch, readProcessedImages } from "../autolist/file-batch.js";
import { findSharedFeishuWhiteBackgroundLocalFile, loadFeishuProductRecords } from "../autolist/feishu-products.js";
import { atomicWriteJson } from "../utils/atomic-file.js";
import { cleanupStaleRunHistory } from "../autolist/cleanup.js";
import { removePaidImageBatchLedger } from "../autolist/paid-image-submission-ledger.js";

type InitialMode = "resume" | "full";

interface AutoListingJobFile {
  input?: {
    feishuProductDataFile?: string;
    processedImageManifest?: string;
    paidImageSubmissionLedgerDir?: string;
  };
}

interface LocalFeishuConfig {
  auth?: {
    appId?: string;
    appSecret?: string;
    tenantAccessToken?: string;
  };
}

interface TerminalResultFile {
  file: string;
  ok: boolean;
  status: string;
  mtimeMs: number;
}

const rootDir = process.cwd();
const fullRealJobFile = path.resolve(rootDir, "input/auto-listing.job.mac-feishu-real.json");
const resumeJobFile = path.resolve(rootDir, "input/auto-listing/auto-listing.job.mac-feishu-real.resume.generated.json");
const feishuConfigFile = path.resolve(rootDir, "input/feishu-bitable.config.json");
const childControlFile = path.resolve(rootDir, "data/auto-listing/control/auto-listing-child.json");
const externalServiceWaitFile = path.resolve(rootDir, "data/auto-listing/control/auto-listing-wait.json");
const childStallExitCode = 124;
const terminalResultGracePeriodMs = 5000;
const childStallTimeoutMs = Math.max(180000, Number(process.env.AUTO_LISTING_CHILD_STALL_TIMEOUT_MS || 12 * 60 * 1000));
const maxChildRecoveryAttempts = Math.max(
  0,
  Number(process.env.AUTO_LISTING_CHILD_RECOVERY_ATTEMPTS || resolveDefaultRetryableChildFailureRecoveryAttempts())
);
let latestChildStallProgress: { activeStep?: string; activeMessage?: string } = {};

function readJsonFile<T>(file: string): T | undefined {
  if (!fs.existsSync(file)) {
    return undefined;
  }
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

function parseInitialMode(argv: string[]): InitialMode {
  const initialIndex = argv.indexOf("--initial");
  const value = initialIndex >= 0 ? argv[initialIndex + 1] : "full";
  if (value === "resume" || value === "full") {
    return value;
  }
  throw new Error("Usage: auto-listing-supervisor --initial <resume|full>");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function latestProgressMtimeMs(): number {
  const runsDir = path.resolve(rootDir, "data/auto-listing/runs");
  let latest = 0;
  if (fs.existsSync(runsDir)) {
    for (const runId of fs.readdirSync(runsDir)) {
      const runtimeDir = path.join(runsDir, runId);
      if (!fs.statSync(runtimeDir).isDirectory()) {
        continue;
      }
      for (const fileName of ["state.json", "events.ndjson", "result.json", "publish-manifest.json"]) {
        const file = path.join(runtimeDir, fileName);
        if (fs.existsSync(file)) {
          latest = Math.max(latest, fs.statSync(file).mtimeMs);
        }
      }
      const publishDir = path.join(runtimeDir, "publish");
      const pendingDirs = fs.existsSync(publishDir) ? [publishDir] : [];
      while (pendingDirs.length > 0) {
        const currentDir = pendingDirs.pop()!;
        for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
          const file = path.join(currentDir, entry.name);
          if (entry.isDirectory()) {
            pendingDirs.push(file);
            continue;
          }
          const relativePath = path.relative(runtimeDir, file);
          if (isAutoListingControllerProgressArtifactRelativePath(relativePath)) {
            latest = Math.max(latest, fs.statSync(file).mtimeMs);
          }
        }
      }
    }
  }
  const paidImageLedgerDir = path.resolve(rootDir, "data/auto-listing/paid-image-submissions");
  const ledgerDirs = fs.existsSync(paidImageLedgerDir) ? [paidImageLedgerDir] : [];
  while (ledgerDirs.length > 0) {
    const currentDir = ledgerDirs.pop()!;
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const file = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        ledgerDirs.push(file);
        continue;
      }
      latest = Math.max(latest, fs.statSync(file).mtimeMs);
    }
  }
  return latest;
}

function latestProgressSnapshot(): { activeStep?: string; activeMessage?: string } {
  const runsDir = path.resolve(rootDir, "data/auto-listing/runs");
  if (!fs.existsSync(runsDir)) {
    return {};
  }
  const eventFiles = fs
    .readdirSync(runsDir)
    .map((runId) => path.join(runsDir, runId, "events.ndjson"))
    .filter((file) => fs.existsSync(file))
    .map((file) => ({ file, mtimeMs: fs.statSync(file).mtimeMs }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  for (const { file } of eventFiles) {
    const lines = fs.readFileSync(file, "utf8").trim().split(/\r?\n/).filter(Boolean);
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      try {
        const event = JSON.parse(lines[index]) as { step?: string; message?: string };
        return {
          activeStep: event.step,
          activeMessage: event.message
        };
      } catch {
        continue;
      }
    }
  }
  return {};
}

function latestFailureMessage(): string {
  const runsDir = path.resolve(rootDir, "data/auto-listing/runs");
  if (!fs.existsSync(runsDir)) {
    return "";
  }
  const resultFiles = fs
    .readdirSync(runsDir)
    .map((runId) => path.join(runsDir, runId, "result.json"))
    .filter((file) => fs.existsSync(file))
    .map((file) => ({ file, mtimeMs: fs.statSync(file).mtimeMs }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  for (const { file } of resultFiles) {
    const result = readJsonFile<any>(file);
    if (!result || (result.ok !== false && result.status !== "failed")) {
      continue;
    }
    const failedTask = Array.isArray(result.tasks) ? result.tasks.find((task: any) => task.status === "failed" || task.error) : undefined;
    const message = String(failedTask?.error?.message || result.error?.message || result.error || "");
    const step = String(failedTask?.error?.step || failedTask?.status || result.error?.step || "");
    return step && message ? `failed at ${step}: ${message}` : message;
  }
  return "";
}

function latestTerminalResultAfter(startedAtMs: number): TerminalResultFile | undefined {
  const runsDir = path.resolve(rootDir, "data/auto-listing/runs");
  if (!fs.existsSync(runsDir)) {
    return undefined;
  }
  const resultFiles = fs
    .readdirSync(runsDir)
    .map((runId) => path.join(runsDir, runId, "result.json"))
    .filter((file) => fs.existsSync(file))
    .map((file) => ({ file, mtimeMs: fs.statSync(file).mtimeMs }))
    .filter((item) => item.mtimeMs >= startedAtMs)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  for (const { file, mtimeMs } of resultFiles) {
    const result = readJsonFile<any>(file);
    const status = String(result?.status || "");
    if (!result || (result.ok !== true && result.ok !== false && status !== "success" && status !== "failed")) {
      continue;
    }
    return {
      file,
      ok: result.ok === true || status === "success",
      status: status || (result.ok === true ? "success" : "failed"),
      mtimeMs
    };
  }
  return undefined;
}

function terminateProcessGroup(pid: number): void {
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      return;
    }
  }
}

function forceTerminateProcessGroup(pid: number): void {
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      return;
    }
  }
}

function writeAutoListingControllerChildControl(pid: number, label: string): void {
  atomicWriteJson(childControlFile, { pid, label, startedAt: new Date().toISOString() });
}

function clearAutoListingControllerChildControl(pid: number): void {
  const current = readJsonFile<{ pid?: number }>(childControlFile);
  if (current?.pid === pid) {
    fs.rmSync(childControlFile, { force: true });
  }
}

function writeExternalServiceWait(reason: string, retryDelayMs: number, attempt: number): void {
  atomicWriteJson(externalServiceWaitFile, {
    supervisorPid: process.pid,
    status: "external_service_wait",
    reason,
    attempt,
    retryAt: new Date(Date.now() + retryDelayMs).toISOString()
  });
}

function clearExternalServiceWait(): void {
  fs.rmSync(externalServiceWaitFile, { force: true });
}

async function runChild(label: string, command: string, args: string[]): Promise<number | null> {
  console.log(`\n== Auto-listing child: ${label} ==`);
  const child = spawn(command, args, {
    cwd: rootDir,
    detached: true,
    env: process.env,
    stdio: "inherit"
  });
  if (child.pid) {
    writeAutoListingControllerChildControl(child.pid, label);
  }
  const childStartedAtMs = Date.now();
  let lastProgressMtime = latestProgressMtimeMs();
  let lastProgressSeenAt = Date.now();
  let killedForStall = false;
  let terminalResultExitCode: number | null | undefined;
  latestChildStallProgress = {};
  const watchdog = setInterval(() => {
    const terminalResult = latestTerminalResultAfter(childStartedAtMs);
    if (
      terminalResult &&
      shouldTerminateChildAfterTerminalResult({
        terminalResultFound: true,
        terminalResultAgeMs: Date.now() - terminalResult.mtimeMs,
        gracePeriodMs: terminalResultGracePeriodMs
      })
    ) {
      terminalResultExitCode = terminalResult.ok ? 0 : 1;
      console.error(
        `Child ${label} wrote terminal result ${terminalResult.status} but remained alive after ${terminalResultGracePeriodMs}ms; terminating process group ${child.pid}. result=${terminalResult.file}`
      );
      if (child.pid) {
        terminateProcessGroup(child.pid);
        setTimeout(() => {
          if (!child.killed && child.pid) {
            forceTerminateProcessGroup(child.pid);
          }
        }, 15000).unref();
      }
      return;
    }
    const progressMtime = latestProgressMtimeMs();
    let activeProgress: { activeStep?: string; activeMessage?: string } | undefined;
    if (progressMtime > lastProgressMtime) {
      lastProgressMtime = progressMtime;
      activeProgress = latestProgressSnapshot();
      if (shouldRefreshAutoListingChildProgressSeenAt(activeProgress)) {
        lastProgressSeenAt = Date.now();
        return;
      }
      latestChildStallProgress = activeProgress;
    }
    activeProgress = activeProgress || latestProgressSnapshot();
    const effectiveStallTimeoutMs = resolveAutoListingControllerChildStallTimeoutMs({
      defaultTimeoutMs: childStallTimeoutMs,
      activeStep: activeProgress.activeStep,
      activeMessage: activeProgress.activeMessage
    });
    if (Date.now() - lastProgressSeenAt < effectiveStallTimeoutMs) {
      return;
    }
    killedForStall = true;
    latestChildStallProgress = activeProgress;
    console.error(
      `Child ${label} made no progress for ${effectiveStallTimeoutMs}ms during ${activeProgress.activeStep || "unknown"}; terminating process group ${child.pid}. latest=${activeProgress.activeMessage || ""}`
    );
    if (child.pid) {
      terminateProcessGroup(child.pid);
      setTimeout(() => {
        if (!child.killed && child.pid) {
          forceTerminateProcessGroup(child.pid);
        }
      }, 15000).unref();
    }
  }, 5000);
  watchdog.unref();

  return await new Promise<number | null>((resolve, reject) => {
    child.once("error", (error) => {
      clearInterval(watchdog);
      if (child.pid) {
        clearAutoListingControllerChildControl(child.pid);
      }
      reject(error);
    });
    child.once("exit", (code) => {
      clearInterval(watchdog);
      if (child.pid) {
        clearAutoListingControllerChildControl(child.pid);
      }
      resolve(terminalResultExitCode !== undefined ? terminalResultExitCode : killedForStall ? childStallExitCode : code);
    });
  });
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

const feishuProductDataFile = path.resolve(rootDir, "data/feishu/products.json");
const feishuRefreshCandidateFile = path.resolve(rootDir, "data/auto-listing/control/feishu-products.refresh-candidate.json");

function runFeishuAssetsRefresh(options: { currentBatchComplete?: boolean } = {}): { status: number | null; outFile: string } {
  migrateLegacyProcessedManifestForCurrentCache();
  console.log("\n== Auto-listing child: refresh-feishu-assets ==");
  const outFile = shouldRefreshFeishuAssetsToCandidateCache({ currentBatchComplete: options.currentBatchComplete })
    ? feishuRefreshCandidateFile
    : feishuProductDataFile;
  const result = spawnSync("npm", [
    "run",
    "feishu:assets",
    "--",
    "--config",
    "./input/feishu-bitable.config.json",
    "--out",
    path.relative(rootDir, outFile),
    "--cleanup-stale-assets"
  ], {
    cwd: rootDir,
    env: loadFeishuEnv(feishuConfigFile),
    stdio: "inherit"
  });
  if (result.error) {
    throw result.error;
  }
  return { status: result.status, outFile };
}

function migrateLegacyProcessedManifestForCurrentCache(): void {
  const job = readJsonFile<AutoListingJobFile>(fullRealJobFile);
  const feishuProductDataFile = path.resolve(
    rootDir,
    job?.input?.feishuProductDataFile || "data/feishu/products.json"
  );
  const processedManifestFile = path.resolve(
    rootDir,
    job?.input?.processedImageManifest || "data/auto-listing/processed-images.json"
  );
  if (!fs.existsSync(feishuProductDataFile)) {
    return;
  }
  const fingerprint = buildFeishuBatchFingerprint(loadFeishuProductRecords(feishuProductDataFile));
  if (migrateLegacyProcessedImagesToBatch(processedManifestFile, fingerprint)) {
    console.log(`Migrated legacy processed-image manifest to current Feishu batch: ${fingerprint}`);
  }
}

function readBatchProgress(): { batchComplete: boolean; fingerprint: string; recordCount: number; pendingRecordCount: number } {
  const job = readJsonFile<AutoListingJobFile>(fullRealJobFile);
  const feishuProductDataFile = path.resolve(
    rootDir,
    job?.input?.feishuProductDataFile || "data/feishu/products.json"
  );
  const processedManifestFile = path.resolve(
    rootDir,
    job?.input?.processedImageManifest || "data/auto-listing/processed-images.json"
  );
  if (!fs.existsSync(feishuProductDataFile)) {
    return { batchComplete: true, fingerprint: "", recordCount: 0, pendingRecordCount: 0 };
  }
  const records = loadFeishuProductRecords(feishuProductDataFile);
  const fingerprint = buildFeishuBatchFingerprint(records);
  const progress = summarizeFeishuBatchProgress({
    records,
    processedImages: readProcessedImages(processedManifestFile, fingerprint)
  });
  console.log(
    `Feishu batch progress: processed ${progress.processedRecordCount}/${progress.recordCount}, pending ${progress.pendingRecordCount}, batch=${fingerprint || "none"}.`
  );
  return {
    batchComplete: progress.batchComplete,
    fingerprint,
    recordCount: progress.recordCount,
    pendingRecordCount: progress.pendingRecordCount
  };
}

function currentFeishuAssetCacheUnsafe(): boolean {
  const job = readJsonFile<AutoListingJobFile>(fullRealJobFile);
  const feishuProductDataFile = path.resolve(
    rootDir,
    job?.input?.feishuProductDataFile || "data/feishu/products.json"
  );
  if (!fs.existsSync(feishuProductDataFile)) {
    return false;
  }
  const duplicate = findSharedFeishuWhiteBackgroundLocalFile(loadFeishuProductRecords(feishuProductDataFile));
  if (duplicate) {
    console.log(
      `Feishu local asset cache is unsafe; records ${duplicate.previousRecordId} and ${duplicate.recordId} share ${duplicate.filePath}. Refreshing assets before continuing.`
    );
    return true;
  }
  return false;
}

function cleanupCompletedBatchArtifacts(batchFingerprint: string): void {
  const job = readJsonFile<AutoListingJobFile>(fullRealJobFile);
  const paidImageSubmissionLedgerDir = path.resolve(
    rootDir,
    job?.input?.paidImageSubmissionLedgerDir || "data/auto-listing/paid-image-submissions"
  );
  removePaidImageBatchLedger(paidImageSubmissionLedgerDir, batchFingerprint);
  const latestResult = latestTerminalResultAfter(0);
  const activeRuntimeDir = latestResult ? path.dirname(latestResult.file) : "";
  if (!activeRuntimeDir) {
    return;
  }
  cleanupStaleRunHistory({
    runtimeRootDir: path.resolve(rootDir, "data/auto-listing/runs"),
    activeRuntimeDir,
    cleanupAfterPublish: true,
    simulateOnly: false
  });
}

function runResume(): Promise<number | null> {
  return runChild("resume-real-job", "npm", [
    "run",
    "business:auto-listing",
    "--",
    "--job",
    resumeJobFile,
    "--allow-real"
  ]);
}

function prepareResumeJob(): boolean {
  const result = spawnSync("node", ["dist/src/cli/auto-listing-controller.js", "prepare-resume"], {
    cwd: rootDir,
    stdio: "inherit"
  });
  return result.status === 0 && fs.existsSync(resumeJobFile);
}

function runFullFlow(reason: FullFlowContinuationReason): Promise<number | null> {
  const args = ["dist/src/cli/flow-mac-feishu.js", "--real"];
  if (!shouldRefreshFeishuAssetsBeforeFullFlow({
    continuationReason: reason,
    localAssetCacheUnsafe: currentFeishuAssetCacheUnsafe()
  })) {
    args.push("--skip-feishu-assets-refresh");
  }
  if (reason === "same_batch_pending") {
    args.push("--same-batch-pending");
  }
  if (reason === "new_batch_after_refresh") {
    args.push("--new-batch-after-refresh");
  }
  return runChild("full-real-flow", "node", args);
}

async function main(): Promise<void> {
  clearExternalServiceWait();
  let nextMode: InitialMode | "" = parseInitialMode(process.argv.slice(2));
  let fullFlowReason: FullFlowContinuationReason = "initial_full";
  let childRecoveryAttempts = 0;
  let externalServiceWaitAttempts = 0;
  while (nextMode) {
    clearExternalServiceWait();
    const childMode = nextMode;
    const exitCode = childMode === "resume" ? await runResume() : await runFullFlow(fullFlowReason);
    fullFlowReason = "initial_full";
    const currentBatch = readBatchProgress();
    if (
      shouldContinueFullFlowAfterChildExit({
        childMode,
        exitCode,
        batchComplete: currentBatch.batchComplete
      })
    ) {
      if (childMode === "resume" && prepareResumeJob()) {
        console.log("Resume child completed a manifest-backed segment; continuing resume targets before returning to full flow.");
        nextMode = "resume";
        childRecoveryAttempts = 0;
        externalServiceWaitAttempts = 0;
        continue;
      }
      console.log("Feishu batch still has pending products after a successful child run; continuing full real flow with the locked current Feishu cache.");
      nextMode = "full";
      fullFlowReason = "same_batch_pending";
      childRecoveryAttempts = 0;
      externalServiceWaitAttempts = 0;
      continue;
    }

    const failureProgress =
      latestChildStallProgress.activeStep || latestChildStallProgress.activeMessage
        ? latestChildStallProgress
        : latestProgressSnapshot();
    const failureMessage =
      exitCode === childStallExitCode
        ? `child made no progress before watchdog timeout during ${failureProgress.activeStep || "unknown"}: ${failureProgress.activeMessage || ""}`.trim()
        : latestFailureMessage();
    if (
      shouldRecoverFullFlowAfterChildFailure({
        childMode,
        exitCode,
        batchComplete: currentBatch.batchComplete,
        retryableFailureMessage: failureMessage,
        activeStep: failureProgress.activeStep,
        activeMessage: failureProgress.activeMessage,
        recoveryAttempts: childRecoveryAttempts,
        maxRecoveryAttempts: maxChildRecoveryAttempts
      })
    ) {
      const consumeRecoveryAttempt = shouldConsumeSupervisorRecoveryAttempt(failureMessage);
      if (consumeRecoveryAttempt) {
        childRecoveryAttempts += 1;
        externalServiceWaitAttempts = 0;
      } else {
        externalServiceWaitAttempts += 1;
      }
      const recoveryDelayMs = resolveSupervisorRecoveryDelayMs({
        failureMessage,
        externalServiceWaitAttempts: Math.max(0, externalServiceWaitAttempts - 1)
      });
      const recoveryMode = resolveSupervisorRecoveryChildMode(failureMessage);
      if (recoveryMode === "resume" && !prepareResumeJob()) {
        console.error("Safe resume transition was detected, but the project controller could not rebuild a resume job.");
        process.exitCode = 1;
        return;
      }
      console.log(
        isRetryableExternalServiceAvailabilityFailure(failureMessage)
          ? `External image service is temporarily unavailable; preserving the locked current Feishu batch and retrying after ${recoveryDelayMs}ms. serviceWait=${externalServiceWaitAttempts}. Reason: ${failureMessage || "unknown"}`
          : `Retryable child failure while current Feishu batch still has pending products; recovery ${childRecoveryAttempts}/${maxChildRecoveryAttempts}. Reason: ${failureMessage || "unknown"}`
      );
      if (!consumeRecoveryAttempt) {
        writeExternalServiceWait(failureMessage, recoveryDelayMs, externalServiceWaitAttempts);
      }
      await sleep(recoveryDelayMs);
      clearExternalServiceWait();
      nextMode = recoveryMode;
      fullFlowReason = "same_batch_pending";
      continue;
    }

    if (exitCode === 0 && currentBatch.batchComplete) {
      cleanupCompletedBatchArtifacts(currentBatch.fingerprint);
      const refresh = runFeishuAssetsRefresh({ currentBatchComplete: currentBatch.batchComplete });
      if (refresh.status !== 0) {
        console.log("Feishu refresh candidate is invalid after completed batch; preserving completed batch cache.");
        process.exitCode = 0;
        return;
      }
      if (path.resolve(refresh.outFile) !== feishuProductDataFile) {
        fs.copyFileSync(refresh.outFile, feishuProductDataFile);
      }
      const refreshedBatch = readBatchProgress();
      if (shouldContinueFeishuAfterBatchRefresh({
        exitCode,
        currentBatchComplete: currentBatch.batchComplete,
        refreshedBatchChanged: currentBatch.fingerprint !== refreshedBatch.fingerprint,
        refreshedBatchComplete: refreshedBatch.batchComplete
      })) {
        console.log("Feishu table has a new batch after refresh; continuing full real flow.");
        nextMode = "full";
        fullFlowReason = "new_batch_after_refresh";
        continue;
      }
    }

    process.exitCode = exitCode ?? 1;
    return;
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
