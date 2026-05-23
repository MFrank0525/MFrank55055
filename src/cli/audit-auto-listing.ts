import fs from "node:fs";
import path from "node:path";
import { auditAutoListingContinuity } from "../autolist/audit-rules.js";
import { readProcessedImages } from "../autolist/file-batch.js";
import { loadFeishuProductRecords } from "../autolist/feishu-products.js";
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
  const files: string[] = [];
  const pending = [resolved];
  while (pending.length > 0) {
    const current = pending.pop() as string;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(fullPath);
      } else {
        files.push(fullPath);
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
  processedImageManifest: string;
  runtimeRootDir: string;
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
    processedImageManifest: path.resolve(job.input.processedImageManifest || "data/auto-listing/processed-images.json"),
    runtimeRootDir: path.resolve(job.input.runtimeRootDir || "data/auto-listing/runs")
  };
}

function printText(result: ReturnType<typeof auditAutoListingContinuity>, context: Record<string, string | number | undefined>): void {
  const lines = [
    `自动上架连续性审计：${result.ok ? "通过" : "失败"}`,
    `飞书产品：${result.summary.recordCount}`,
    `已处理产品：${result.summary.processedRecordCount}`,
    `待处理产品：${result.summary.pendingRecordCount}`,
    `本地素材文件：${result.summary.existingFileCount}`,
    context.runStatus ? `最新运行状态：${context.runStatus}` : undefined,
    context.discoveredRunImageCount !== undefined ? `最新运行发现产品：${context.discoveredRunImageCount}` : undefined
  ].filter(Boolean);

  if (result.errors.length > 0) {
    lines.push("错误：");
    for (const item of result.errors) {
      lines.push(`  - [${item.code}] ${item.message}${item.filePath ? ` ${item.filePath}` : ""}`);
    }
  }

  if (result.warnings.length > 0) {
    lines.push("警告：");
    for (const item of result.warnings) {
      lines.push(`  - [${item.code}] ${item.message}${item.filePath ? ` ${item.filePath}` : ""}`);
    }
  }

  console.log(lines.join("\n"));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const resolved = resolveFromJob(args.jobFile);
  const records = loadFeishuProductRecords(resolved.feishuProductDataFile);
  const processedImages = readProcessedImages(resolved.processedImageManifest);
  const existingFiles = [
    ...listFilesRecursive(resolved.feishuImageDir),
    ...listFilesRecursive(resolved.qualificationDir)
  ];
  const state = latestRunState(resolved.runtimeRootDir);
  const discoveredRunImageCount = state?.status === "running" ? state.tasks.length : undefined;
  const result = auditAutoListingContinuity({
    records,
    processedImages,
    existingFiles,
    discoveredRunImageCount
  });

  const output = {
    jobFile: path.resolve(args.jobFile),
    feishuProductDataFile: resolved.feishuProductDataFile,
    feishuImageDir: resolved.feishuImageDir,
    qualificationDir: resolved.qualificationDir,
    processedImageManifest: resolved.processedImageManifest,
    runtimeRootDir: resolved.runtimeRootDir,
    runStatus: state?.status,
    runId: state?.runId,
    ...result
  };

  if (args.json) {
    console.log(JSON.stringify(output, null, 2));
  } else {
    printText(result, {
      runStatus: state?.status,
      discoveredRunImageCount
    });
  }

  if (!result.ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
