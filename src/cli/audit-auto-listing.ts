import fs from "node:fs";
import path from "node:path";
import { readImageDimensions } from "../utils/image-dimensions.js";
import { auditAutoListingContinuity, auditCompletedBatchResidue, auditIntermediateArtifactResidue, auditMainImageGeneration, auditPublishCoverage, buildCanonicalPublishTargetKeys, summarizeFeishuBatchProgress } from "../autolist/audit-rules.js";
import { buildFeishuBatchFingerprint, canResumeFeishuBatchArtifacts } from "../autolist/feishu-batch-rules.js";
import { buildAutoListingBusinessRuleFingerprint } from "../autolist/business-rule-fingerprint.js";
import {
  auditCanonicalPublishEvidence,
  auditRuleContradictions,
  auditRuntimeControllerConsistency,
  runDeepAuditRules,
  scopeCanonicalPublishManifestKeys,
  shouldRequireCompletePublishAudit,
  shouldRequirePublishTargetIdentity,
  type DeepAuditIssue
} from "../autolist/deep-audit-rules.js";
import { imageServiceWaitCeilingMs, videosBase64AcceptedTaskPollCeilingMs } from "../autolist/image-generation-rules.js";
import { readProcessedImages } from "../autolist/file-batch.js";
import { loadFeishuProductRecords } from "../autolist/feishu-products.js";
import { auditCurrentPaidImageLedgers } from "../autolist/paid-image-audit.js";
import { loadPublishManifest } from "../autolist/publish-manifest.js";
import { getProductCategoryPlan, type ProductCategory } from "../autolist/product-category.js";
import { paidImageBatchLedgerDir } from "../autolist/paid-image-submission-ledger.js";
import type { AutoListingJobFile, AutoListingRunResult, AutoListingRunState } from "../autolist/types.js";
import { loadFeishuBitableConfig } from "../feishu/config.js";
import type { FeishuProductRecord } from "../feishu/types.js";

interface Args {
  jobFile: string;
  json: boolean;
}

interface ControllerJobFile {
  mode?: "full-real-flow" | "resume-real-job";
  status?: "running" | "completed" | "failed";
  pid?: number;
  batchFingerprint?: string;
  businessRuleFingerprint?: string;
}

function parseArgs(argv: string[]): Args {
  const args = new Map<string, string>();
  const flags = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key?.startsWith("--")) {
      continue;
    }
    if (key === "--json") {
      flags.add(key);
      continue;
    }
    const value = argv[index + 1];
    if (value && !value.startsWith("--")) {
      args.set(key, value);
      index += 1;
    }
  }

  return {
    jobFile: args.get("--job") || defaultJobFile(),
    json: flags.has("--json")
  };
}

function defaultJobFile(): string {
  const candidates = [
    "input/auto-listing.job.mac-feishu-real.json",
    "input/auto-listing.job.mac-feishu-flow.json",
    "input/auto-listing.job.example.json"
  ];
  const found = candidates.find((candidate) => fs.existsSync(path.resolve(candidate)));
  if (!found) {
    throw new Error("No auto-listing job file found. Pass --job <job.json>.");
  }
  return found;
}

function readJson<T>(filePath: string): T {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`File not found: ${resolved}`);
  }
  return JSON.parse(fs.readFileSync(resolved, "utf8")) as T;
}

function readOptionalJson<T>(filePath: string): T | undefined {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    return undefined;
  }
  return JSON.parse(fs.readFileSync(resolved, "utf8")) as T;
}

function isProcessAlive(pid: number | undefined): boolean {
  if (!pid || !Number.isFinite(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function listFilesRecursive(dir: string): string[] {
  const resolved = path.resolve(dir);
  if (!fs.existsSync(resolved)) {
    return [];
  }
  const files: string[] = [resolved];
  const pending = [resolved];
  while (pending.length > 0) {
    const current = pending.pop() as string;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      files.push(fullPath);
      if (entry.isDirectory()) {
        pending.push(fullPath);
      }
    }
  }
  return files;
}

function runMatchesAuditMode(stateFile: string, simulateOnly: boolean): boolean {
  const preflightFile = path.join(path.dirname(stateFile), "preflight.json");
  if (!fs.existsSync(preflightFile)) {
    return true;
  }
  try {
    const preflight = readJson<{ simulateOnly?: boolean }>(preflightFile);
    return preflight.simulateOnly === simulateOnly;
  } catch {
    return true;
  }
}

function latestRunState(
  runtimeRootDir: string,
  simulateOnly: boolean,
  currentBatchFingerprint: string,
  currentBusinessRuleFingerprint: string
): AutoListingRunState | undefined {
  const root = path.resolve(runtimeRootDir);
  if (!fs.existsSync(root)) {
    return undefined;
  }
  const stateFiles = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name, "state.json"))
    .filter((filePath) => fs.existsSync(filePath))
    .map((filePath) => ({
      filePath,
      mtimeMs: fs.statSync(filePath).mtimeMs
    }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  if (!stateFiles.length) {
    return undefined;
  }

  for (const stateFile of stateFiles) {
    if (!runMatchesAuditMode(stateFile.filePath, simulateOnly)) {
      continue;
    }
    try {
      const state = readJson<AutoListingRunState>(stateFile.filePath);
      if (
        state.feishuBatchFingerprint === currentBatchFingerprint &&
        state.businessRuleFingerprint === currentBusinessRuleFingerprint
      ) {
        return state;
      }
    } catch {
      continue;
    }
  }
  return undefined;
}

function resolveProcessedImageManifestForAudit(input: {
  defaultProcessedImageManifest: string;
  runtimeRootDir: string;
  currentBatchFingerprint: string;
  state?: AutoListingRunState;
}): string {
  const resultFile = input.state?.runId ? path.join(input.runtimeRootDir, input.state.runId, "result.json") : undefined;
  if (!resultFile || !fs.existsSync(resultFile)) {
    return input.defaultProcessedImageManifest;
  }
  try {
    const result = readJson<AutoListingRunResult>(resultFile);
    const processedImageManifest = result.artifacts?.processedImageManifest;
    if (result.feishuBatchFingerprint === input.currentBatchFingerprint && typeof processedImageManifest === "string" && processedImageManifest.trim()) {
      return path.resolve(processedImageManifest);
    }
  } catch {
    return input.defaultProcessedImageManifest;
  }
  return input.defaultProcessedImageManifest;
}

function resolveFromJob(jobFile: string): {
  job: AutoListingJobFile;
  feishuProductDataFile: string;
  feishuImageDir: string;
  qualificationDir: string;
  mainImageWorkDir: string;
  shopRootDir: string;
  processedImageManifest: string;
  runtimeRootDir: string;
  paidImageSubmissionLedgerDir: string;
  mainImageExpectedCount: number;
  simulateOnly: boolean;
} {
  const job = readJson<AutoListingJobFile>(jobFile);
  if (!job.input) {
    throw new Error(`Auto-listing job missing input: ${path.resolve(jobFile)}`);
  }
  return {
    job,
    feishuProductDataFile: path.resolve(job.input.feishuProductDataFile || "data/feishu/products.json"),
    feishuImageDir: path.resolve(job.input.feishuImageDir),
    qualificationDir: path.resolve(job.input.qualificationDir),
    mainImageWorkDir: path.resolve(job.input.mainImageWorkDir || job.input.mainImageWorkDir || "input/auto-listing/main-images"),
    shopRootDir: path.resolve(job.input.shopRootDir),
    processedImageManifest: path.resolve(job.input.processedImageManifest || "data/auto-listing/processed-images.json"),
    runtimeRootDir: path.resolve(job.input.runtimeRootDir || "data/auto-listing/runs"),
    paidImageSubmissionLedgerDir: path.resolve(job.input.paidImageSubmissionLedgerDir || "data/auto-listing/paid-image-submissions"),
    mainImageExpectedCount: job.input.mainImageExpectedCount ?? 4,
    simulateOnly: job.input.simulateOnly ?? true
  };
}

function mergeAuditResults(results: Array<{ ok: boolean; errors: unknown[]; warnings: unknown[] }>): boolean {
  return results.every((result) => result.ok);
}

function printIssueLines(lines: string[], label: string, issues: Array<{ code: string; message: string; filePath?: string }>): void {
  if (issues.length === 0) {
    return;
  }
  lines.push(label);
  for (const item of issues) {
    lines.push(`  - [${item.code}] ${item.message}${item.filePath ? ` ${item.filePath}` : ""}`);
  }
}

function printText(input: {
  continuity: ReturnType<typeof auditAutoListingContinuity>;
  feishuBatch: ReturnType<typeof summarizeFeishuBatchProgress>;
  generation: ReturnType<typeof auditMainImageGeneration>;
  publish: ReturnType<typeof auditPublishCoverage>;
  residue: ReturnType<typeof auditCompletedBatchResidue>;
  context: Record<string, string | number | undefined>;
}): void {
  const ok = mergeAuditResults([input.continuity, input.generation, input.publish, input.residue]);
  const batchStatus = input.feishuBatch.batchComplete ? "完成" : "待继续";
  const lines = [
    `自动上架审计：${ok ? "通过" : "失败"}`,
    `连续性：飞书产品 ${input.continuity.summary.recordCount}，已处理 ${input.continuity.summary.processedRecordCount}，待处理 ${input.continuity.summary.pendingRecordCount}`,
    `飞书批次状态：${batchStatus}`,
    `生图：审计任务 ${input.generation.summary.auditedTaskCount}，生成图片 ${input.generation.summary.generatedImageCount}/${input.generation.summary.expectedImageCount}`,
    `发布：审计任务 ${input.publish.summary.auditedTaskCount}，安全发布 ${input.publish.summary.safelyPublishedCount}/${input.publish.summary.expectedPublishCount}，进行中 ${input.publish.summary.inProgressPublishCount}`,
    `本地素材文件：${input.continuity.summary.existingFileCount}`,
    `历史运行目录：${input.residue.summary.runDirCount}`,
    input.context.runStatus ? `最新运行状态：${input.context.runStatus}` : undefined,
    input.context.discoveredRunImageCount !== undefined ? `最新运行发现产品：${input.context.discoveredRunImageCount}` : undefined
  ].filter(Boolean) as string[];

  printIssueLines(lines, "错误：", [...input.continuity.errors, ...input.generation.errors, ...input.publish.errors, ...input.residue.errors]);
  printIssueLines(lines, "警告：", [...input.continuity.warnings, ...input.generation.warnings, ...input.publish.warnings, ...input.residue.warnings]);

  console.log(lines.join("\n"));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const resolved = resolveFromJob(args.jobFile);
  const ruleErrors: DeepAuditIssue[] = [];
  let records: FeishuProductRecord[] = [];
  try {
    loadFeishuBitableConfig("input/feishu-bitable.config.json");
  } catch (error) {
    ruleErrors.push({
      code: "feishu_config_invalid",
      message: error instanceof Error ? error.message : String(error)
    });
  }
  try {
    records = loadFeishuProductRecords(resolved.feishuProductDataFile);
  } catch (error) {
    ruleErrors.push({
      code: "feishu_cache_invalid",
      message: error instanceof Error ? error.message : String(error)
    });
  }
  const batchFingerprint = buildFeishuBatchFingerprint(records);
  const businessRuleFingerprint = buildAutoListingBusinessRuleFingerprint();
  const state = latestRunState(resolved.runtimeRootDir, resolved.simulateOnly, batchFingerprint, businessRuleFingerprint);
  const effectiveProcessedImageManifest = resolveProcessedImageManifestForAudit({
    defaultProcessedImageManifest: resolved.processedImageManifest,
    runtimeRootDir: resolved.runtimeRootDir,
    currentBatchFingerprint: batchFingerprint,
    state
  });
  const processedImages = readProcessedImages(effectiveProcessedImageManifest, batchFingerprint);
  const existingFiles = [
    ...listFilesRecursive(resolved.feishuImageDir),
    ...listFilesRecursive(resolved.qualificationDir),
    ...listFilesRecursive(resolved.mainImageWorkDir),
    ...listFilesRecursive(resolved.shopRootDir),
    ...listFilesRecursive(resolved.runtimeRootDir)
  ];
  const discoveredRunImageCount = state?.status === "running" ? state.tasks.length : undefined;
  const controllerJob = readOptionalJson<ControllerJobFile>("data/auto-listing/control/auto-listing-controller-job.json");
  const controllerProcessAlive = controllerJob?.status === "running" && isProcessAlive(controllerJob.pid);
  const controllerMatchesCurrentBatch = canResumeFeishuBatchArtifacts({
    currentBatchFingerprint: batchFingerprint,
    resumeBatchFingerprint: controllerJob?.batchFingerprint
  }) && controllerJob?.businessRuleFingerprint === businessRuleFingerprint;
  const activeControllerRunning = controllerProcessAlive && controllerMatchesCurrentBatch;
  const expectedDiscoveredRunImageCount =
    discoveredRunImageCount !== undefined && activeControllerRunning && controllerJob.mode === "resume-real-job"
      ? 1
      : undefined;
  const latestRuntimeDir = state?.runId ? path.join(resolved.runtimeRootDir, state.runId) : resolved.runtimeRootDir;
  let manifest = { generatedAt: new Date().toISOString(), entries: [] as ReturnType<typeof loadPublishManifest>["entries"] };
  const runtimeErrors: DeepAuditIssue[] = [];
  const invalidBusinessRuleRunDirs = fs.existsSync(resolved.runtimeRootDir)
    ? fs.readdirSync(resolved.runtimeRootDir, { withFileTypes: true }).filter((entry) => {
        if (!entry.isDirectory()) return false;
        const runState = readOptionalJson<AutoListingRunState>(path.join(resolved.runtimeRootDir, entry.name, "state.json"));
        return Boolean(runState && runState.businessRuleFingerprint !== businessRuleFingerprint);
      })
    : [];
  if (invalidBusinessRuleRunDirs.length > 0) {
    runtimeErrors.push({
      code: "runtime_business_rule_fingerprint_mismatch",
      message: `${invalidBusinessRuleRunDirs.length} runtime directories were produced under obsolete business rules.`
    });
  }
  if (controllerProcessAlive && !controllerMatchesCurrentBatch) {
    runtimeErrors.push({
      code: "controller_process_batch_fingerprint_mismatch",
      message: "Active controller process batch fingerprint does not match the current Feishu cache."
    });
  }
  try {
    manifest = loadPublishManifest(latestRuntimeDir);
  } catch (error) {
    runtimeErrors.push({ code: "publish_manifest_invalid", message: error instanceof Error ? error.message : String(error) });
  }
  const continuity = auditAutoListingContinuity({
    records,
    processedImages,
    existingFiles,
    discoveredRunImageCount,
    expectedDiscoveredRunImageCount
  });
  const feishuBatch = summarizeFeishuBatchProgress({
    records,
    processedImages
  });
  const mainImageDimensions = new Map(
    (state?.tasks || [])
      .flatMap((task) =>
        (task.mainImageArtifact?.generatedFiles || []).flatMap((file) =>
          [file.imageFile, file.rawImageFile].filter(Boolean) as string[]
        )
      )
      .filter((filePath) => fs.existsSync(filePath))
      .flatMap((filePath) => {
        try {
          return [[path.resolve(filePath), readImageDimensions(filePath)] as const];
        } catch {
          return [];
        }
      })
  );
  const completedGeneration = auditMainImageGeneration({
    tasks: state?.tasks || [],
    existingFiles,
    imageDimensions: mainImageDimensions,
    expectedImagesPerPrompt: resolved.mainImageExpectedCount,
    simulateOnly: resolved.simulateOnly
  });
  const currentPaidImageAudit = auditCurrentPaidImageLedgers({
    records,
    processedImages,
    rootDir: resolved.paidImageSubmissionLedgerDir,
    batchFingerprint,
    completedGeneration,
    completedProducts: (state?.tasks || [])
      .filter((task) => Boolean(task.mainImageArtifact))
      .map((task) => ({
        recordId: task.feishuProductRecord?.recordId,
        expectedImageCount:
          getProductCategoryPlan(task.feishuProductRecord?.productCategory).promptCount * resolved.mainImageExpectedCount,
        generatedImageCount: task.mainImageArtifact?.generatedFiles.length || 0
      }))
  });
  const generation = currentPaidImageAudit.generation;
  const requireCompletePublishAudit = shouldRequireCompletePublishAudit({
    runStatus: state?.status,
    taskStatuses: (state?.tasks || []).map((task) => task.status)
  });
  const publish = auditPublishCoverage({
    tasks: state?.tasks || [],
    manifestEntries: manifest.entries,
    batchFingerprint: state?.feishuBatchFingerprint,
    allowInProgress: !requireCompletePublishAudit
  });
  const runDirCount = fs.existsSync(resolved.runtimeRootDir)
    ? fs.readdirSync(resolved.runtimeRootDir, { withFileTypes: true }).filter((entry) => entry.isDirectory() && /^[0-9]{8}-[0-9]{6}$/.test(entry.name)).length
    : 0;
  const residue = auditCompletedBatchResidue({
    batchComplete: feishuBatch.batchComplete,
    runDirCount,
    paidLedgerBatchExists: fs.existsSync(paidImageBatchLedgerDir(resolved.paidImageSubmissionLedgerDir, batchFingerprint))
  });
  const intermediateResidue = auditIntermediateArtifactResidue({
    tasks: state?.tasks || [],
    existingPaths: existingFiles
  });
  const controllerRuntimeAudit = auditRuntimeControllerConsistency({
    controllerStatus: controllerMatchesCurrentBatch ? controllerJob?.status : undefined,
    controllerActive: activeControllerRunning,
    runStatus: state?.status
  });
  runtimeErrors.push(...controllerRuntimeAudit.errors);
  if (state?.status === "completed" && state.feishuBatchFingerprint && records.length > 0 && state.feishuBatchFingerprint !== batchFingerprint) {
    runtimeErrors.push({ code: "runtime_batch_fingerprint_mismatch", message: "Latest run fingerprint does not match the current Feishu cache." });
  }

  const expectedTargetKeys: string[] = [];
  const auditedTaskScopes: Array<{ batchFingerprint: string; recordId: string; taskId: string }> = [];
  const identityBuildErrors: DeepAuditIssue[] = [];
  for (const task of state?.tasks || []) {
    if (
      !shouldRequirePublishTargetIdentity({
        recordId: task.feishuProductRecord?.recordId,
        status: task.status,
        hasMainImageArtifact: Boolean(task.mainImageArtifact),
        generatedProductFolderCount: task.generatedProductFolders.length,
        distributedProductFolderCount: task.shopDistributionArtifact?.distributedFolders.length,
        publishResultCount: task.publishArtifact?.results.length
      })
    ) {
      continue;
    }
    try {
      const taskScope = {
        batchFingerprint: state?.feishuBatchFingerprint || "",
        recordId: task.feishuProductRecord?.recordId || "",
        taskId: task.taskId
      };
      expectedTargetKeys.push(...buildCanonicalPublishTargetKeys({
        batchFingerprint: taskScope.batchFingerprint,
        tasks: [{
          taskId: taskScope.taskId,
          recordId: taskScope.recordId,
          productCategory: task.feishuProductRecord?.productCategory
        }]
      }));
      auditedTaskScopes.push(taskScope);
    } catch (error) {
      identityBuildErrors.push({
        code: "publish_target_identity_invalid",
        message: `${task.taskId}: ${error instanceof Error ? error.message : String(error)}`
      });
    }
  }
  const identityAudit = auditCanonicalPublishEvidence({
    expectedTargetKeys,
    manifestTargetKeys: scopeCanonicalPublishManifestKeys({ taskScopes: auditedTaskScopes, entries: manifest.entries }),
    artifactTargetKeys: (state?.tasks || []).flatMap((task) => task.publishArtifact?.results.map((result) => result.targetKey).filter((targetKey): targetKey is string => Boolean(targetKey)) || []),
    requireComplete: requireCompletePublishAudit
  });
  identityAudit.errors.unshift(...identityBuildErrors);
  const categories: ProductCategory[] = ["医疗器械", "非处方药", "保健食品"];
  const contradictionAudit = auditRuleContradictions({
    categoryPlans: categories.map((category) => {
      const plan = getProductCategoryPlan(category);
      return { category, titleCount: plan.titleCount, shopCount: plan.shopCodes.length, promptCount: plan.promptCount };
    }),
    titleRuleText: fs.readFileSync("docs/auto-listing/steps/05-title-generation.md", "utf8"),
    shopRuleText: fs.readFileSync("docs/auto-listing/steps/09-shop-distribution.md", "utf8"),
    promptRuleText: fs.readFileSync("docs/auto-listing/steps/02-deepseek-prompts.md", "utf8"),
    imageRuleText: fs.readFileSync("docs/auto-listing/steps/03-main-image-generation.md", "utf8"),
    stabilityRuleText: fs.readFileSync("docs/auto-listing/stability-checklist.md", "utf8"),
    imageWaitCeilingMs: imageServiceWaitCeilingMs,
    videosBase64AcceptedTaskPollCeilingMs: videosBase64AcceptedTaskPollCeilingMs
  });

  const toDeepIssues = (issues: Array<{ code: string; message: string }>): DeepAuditIssue[] =>
    issues.map((issue) => ({ code: issue.code, message: issue.message }));
  const artifactErrors = [
    ...toDeepIssues(completedGeneration.errors),
    ...toDeepIssues(publish.errors),
    ...currentPaidImageAudit.artifacts.errors
  ];
  if (resolved.simulateOnly && (state?.tasks.length || 0) === 0) {
    artifactErrors.push({ code: "simulation_not_representative", message: "Zero-task simulation does not exercise the business workflow." });
  }
  const deepAudit = runDeepAuditRules({
    rules: { errors: ruleErrors, warnings: [], evidence: [`records=${records.length}`] },
    contradictions: contradictionAudit,
    runtime: { errors: runtimeErrors, warnings: [], evidence: controllerRuntimeAudit.evidence },
    identities: identityAudit,
    recovery: {
      errors: state?.feishuBatchFingerprint && records.length > 0 && state.feishuBatchFingerprint !== batchFingerprint
        ? [{ code: "recovery_batch_fingerprint_mismatch", message: "Runtime artifacts cannot be reused for the current Feishu batch." }]
        : [],
      warnings: [],
      evidence: [`cacheFingerprint=${batchFingerprint}`, `runFingerprint=${state?.feishuBatchFingerprint || "missing"}`]
    },
    sideEffects: {
      errors: [],
      warnings: manifest.entries
        .filter((entry) => entry.finalVerifyStatus === "submit_accepted_unconfirmed")
        .map((entry) => ({ code: "publish_submit_unconfirmed", message: `Manual platform review required: ${entry.targetKey || entry.productFolder}` })),
      evidence: [`unconfirmed=${manifest.entries.filter((entry) => entry.finalVerifyStatus === "submit_accepted_unconfirmed").length}`]
    },
    artifacts: {
      errors: artifactErrors,
      warnings: [
        ...toDeepIssues(completedGeneration.warnings),
        ...toDeepIssues(publish.warnings),
        ...currentPaidImageAudit.artifacts.warnings
      ],
      evidence: [
        ...identityAudit.evidence,
        ...currentPaidImageAudit.artifacts.evidence
      ]
    },
    residue: {
      errors: [...toDeepIssues(residue.errors), ...toDeepIssues(intermediateResidue.errors)],
      warnings: [...toDeepIssues(residue.warnings), ...toDeepIssues(intermediateResidue.warnings)],
      evidence: [
        `runDirs=${runDirCount}`,
        `completedProductRuntimeResidue=${intermediateResidue.summary.residualPublishRuntimeCount}`,
        `completedProductRuntimeCleanupMissing=${intermediateResidue.summary.missingCleanupEvidenceCount}`
      ]
    }
  });
  const ok = deepAudit.ok;

  const output = {
    ok,
    jobFile: path.resolve(args.jobFile),
    feishuProductDataFile: resolved.feishuProductDataFile,
    feishuImageDir: resolved.feishuImageDir,
    qualificationDir: resolved.qualificationDir,
    mainImageWorkDir: resolved.mainImageWorkDir,
    shopRootDir: resolved.shopRootDir,
    processedImageManifest: effectiveProcessedImageManifest,
    runtimeRootDir: resolved.runtimeRootDir,
    runStatus: state?.status,
    runId: state?.runId,
    feishuBatch,
    continuity,
    generation,
    publish,
    residue,
    intermediateResidue,
    deepAudit
  };

  if (args.json) {
    console.log(JSON.stringify(output, null, 2));
  } else {
    printText({
      continuity,
      feishuBatch,
      generation,
      publish,
      residue,
      context: {
        runStatus: state?.status,
        discoveredRunImageCount
      }
    });
    console.log(
      deepAudit.dimensions
        .map((dimension) => `${dimension.ok ? "通过" : "失败"} ${dimension.name}: errors=${dimension.errors.length}, warnings=${dimension.warnings.length}`)
        .join("\n")
    );
  }

  if (!ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
