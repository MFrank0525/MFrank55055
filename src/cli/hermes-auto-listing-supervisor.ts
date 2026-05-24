import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { summarizeFeishuBatchProgress } from "../autolist/audit-rules.js";
import { shouldContinueFeishuBatchAfterChildExit } from "../autolist/batch-continuation-rules.js";
import { readProcessedImages } from "../autolist/file-batch.js";
import { loadFeishuProductRecords } from "../autolist/feishu-products.js";

type InitialMode = "resume" | "full";

interface AutoListingJobFile {
  input?: {
    feishuProductDataFile?: string;
    processedImageManifest?: string;
  };
}

const rootDir = process.cwd();
const fullRealJobFile = path.resolve(rootDir, "input/auto-listing.job.mac-feishu-real.json");
const resumeJobFile = path.resolve(rootDir, "input/auto-listing/auto-listing.job.mac-feishu-real.resume.generated.json");

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
  throw new Error("Usage: hermes-auto-listing-supervisor --initial <resume|full>");
}

function runChild(label: string, command: string, args: string[]): number | null {
  console.log(`\n== Hermes child: ${label} ==`);
  const result = spawnSync(command, args, {
    cwd: rootDir,
    env: process.env,
    stdio: "inherit"
  });
  if (result.error) {
    throw result.error;
  }
  return result.status;
}

function readBatchComplete(): boolean {
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
    return true;
  }
  const progress = summarizeFeishuBatchProgress({
    records: loadFeishuProductRecords(feishuProductDataFile),
    processedImages: readProcessedImages(processedManifestFile)
  });
  console.log(
    `Feishu batch progress: processed ${progress.processedRecordCount}/${progress.recordCount}, pending ${progress.pendingRecordCount}.`
  );
  return progress.batchComplete;
}

function runResume(): number | null {
  return runChild("resume-real-job", "npm", [
    "run",
    "business:auto-listing",
    "--",
    "--job",
    resumeJobFile,
    "--allow-real"
  ]);
}

function runFullFlow(): number | null {
  return runChild("full-real-flow", "node", ["dist/src/cli/flow-mac-feishu.js", "--real"]);
}

function main(): void {
  let nextMode: InitialMode | "" = parseInitialMode(process.argv.slice(2));
  while (nextMode) {
    const exitCode = nextMode === "resume" ? runResume() : runFullFlow();
    const batchComplete = readBatchComplete();
    if (!shouldContinueFeishuBatchAfterChildExit({ exitCode, batchComplete })) {
      process.exitCode = exitCode ?? 1;
      return;
    }
    console.log("Feishu batch still has pending products after a successful child run; continuing full real flow.");
    nextMode = "full";
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
