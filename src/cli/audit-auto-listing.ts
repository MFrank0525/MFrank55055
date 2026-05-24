import fs from "node:fs";
import path from "node:path";
import { auditAutoListingContinuity, auditMainImageGeneration, auditPublishCoverage, summarizeFeishuBatchProgress } from "../autolist/audit-rules.js";
import { readProcessedImages } from "../autolist/file-batch.js";
import { loadFeishuProductRecords } from "../autolist/feishu-products.js";
import { loadPublishManifest } from "../autolist/publish-manifest.js";
import type { AutoListingJobFile, AutoListingRunState } from "../autolist/types.js";

interface Args {
  jobFile: string;
  json: boolean;
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

function latestRunState(runtimeRootDir: string): AutoListingRunState | undefined {
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
    try {
      return readJson<AutoListingRunState>(stateFile.filePath);
    } catch {
      continue;
    }
  }
  return undefined;
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
    mainImageWorkDir: path.resolve(job.input.mainImageWorkDir || job.input.jimengImageDir || "input/auto-listing/jimeng-images"),
    shopRootDir: path.resolve(job.input.shopRootDir),
    processedImageManifest: path.resolve(job.input.processedImageManifest || "data/auto-listing/processed-images.json"),
    runtimeRootDir: path.resolve(job.input.runtimeRootDir || "data/auto-listing/runs"),
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
  context: Record<string, string | number | undefined>;
}): void {
  const ok = mergeAuditResults([input.continuity, input.generation, input.publish]);
  const batchStatus = input.feishuBatch.batchComplete ? "完成" : "待继续";
  const lines = [
    `自动上架审计：${ok ? "通过" : "失败"}`,
    `连续性：飞书产品 ${input.continuity.summary.recordCount}，已处理 ${input.continuity.summary.processedRecordCount}，待处理 ${input.continuity.summary.pendingRecordCount}`,
    `飞书批次状态：${batchStatus}`,
    `生图：审计任务 ${input.generation.summary.auditedTaskCount}，生成图片 ${input.generation.summary.generatedImageCount}/${input.generation.summary.expectedImageCount}`,
    `发布：审计任务 ${input.publish.summary.auditedTaskCount}，安全发布 ${input.publish.summary.safelyPublishedCount}/${input.publish.summary.expectedPublishCount}`,
    `本地素材文件：${input.continuity.summary.existingFileCount}`,
    input.context.runStatus ? `最新运行状态：${input.context.runStatus}` : undefined,
    input.context.discoveredRunImageCount !== undefined ? `最新运行发现产品：${input.context.discoveredRunImageCount}` : undefined
  ].filter(Boolean) as string[];

  printIssueLines(lines, "错误：", [...input.continuity.errors, ...input.generation.errors, ...input.publish.errors]);
  printIssueLines(lines, "警告：", [...input.continuity.warnings, ...input.generation.warnings, ...input.publish.warnings]);

  console.log(lines.join("\n"));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const resolved = resolveFromJob(args.jobFile);
  const records = loadFeishuProductRecords(resolved.feishuProductDataFile);
  const processedImages = readProcessedImages(resolved.processedImageManifest);
  const existingFiles = [
    ...listFilesRecursive(resolved.feishuImageDir),
    ...listFilesRecursive(resolved.qualificationDir),
    ...listFilesRecursive(resolved.mainImageWorkDir),
    ...listFilesRecursive(resolved.shopRootDir),
    ...listFilesRecursive(resolved.runtimeRootDir)
  ];
  const state = latestRunState(resolved.runtimeRootDir);
  const discoveredRunImageCount = state?.status === "running" ? state.tasks.length : undefined;
  const latestRuntimeDir = state?.runId ? path.join(resolved.runtimeRootDir, state.runId) : resolved.runtimeRootDir;
  const manifest = loadPublishManifest(latestRuntimeDir);
  const continuity = auditAutoListingContinuity({
    records,
    processedImages,
    existingFiles,
    discoveredRunImageCount
  });
  const feishuBatch = summarizeFeishuBatchProgress({
    records,
    processedImages
  });
  const generation = auditMainImageGeneration({
    tasks: state?.tasks || [],
    existingFiles,
    expectedImagesPerPrompt: resolved.mainImageExpectedCount,
    simulateOnly: resolved.simulateOnly
  });
  const publish = auditPublishCoverage({
    tasks: state?.tasks || [],
    manifestEntries: manifest.entries
  });
  const ok = mergeAuditResults([continuity, generation, publish]);

  const output = {
    ok,
    jobFile: path.resolve(args.jobFile),
    feishuProductDataFile: resolved.feishuProductDataFile,
    feishuImageDir: resolved.feishuImageDir,
    qualificationDir: resolved.qualificationDir,
    mainImageWorkDir: resolved.mainImageWorkDir,
    shopRootDir: resolved.shopRootDir,
    processedImageManifest: resolved.processedImageManifest,
    runtimeRootDir: resolved.runtimeRootDir,
    runStatus: state?.status,
    runId: state?.runId,
    feishuBatch,
    continuity,
    generation,
    publish
  };

  if (args.json) {
    console.log(JSON.stringify(output, null, 2));
  } else {
    printText({
      continuity,
      feishuBatch,
      generation,
      publish,
      context: {
        runStatus: state?.status,
        discoveredRunImageCount
      }
    });
  }

  if (!ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
