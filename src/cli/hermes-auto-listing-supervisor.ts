import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { summarizeFeishuBatchProgress } from "../autolist/audit-rules.js";
import {
  shouldContinueFeishuAfterBatchRefresh,
  shouldContinueFeishuBatchAfterChildExit
} from "../autolist/batch-continuation-rules.js";
import { buildFeishuBatchFingerprint } from "../autolist/feishu-batch-rules.js";
import { migrateLegacyProcessedImagesToBatch, readProcessedImages } from "../autolist/file-batch.js";
import { loadFeishuProductRecords } from "../autolist/feishu-products.js";

type InitialMode = "resume" | "full";

interface AutoListingJobFile {
  input?: {
    feishuProductDataFile?: string;
    processedImageManifest?: string;
  };
}

interface LocalFeishuConfig {
  auth?: {
    appId?: string;
    appSecret?: string;
    tenantAccessToken?: string;
  };
}

const rootDir = process.cwd();
const fullRealJobFile = path.resolve(rootDir, "input/auto-listing.job.mac-feishu-real.json");
const resumeJobFile = path.resolve(rootDir, "input/auto-listing/auto-listing.job.mac-feishu-real.resume.generated.json");
const feishuConfigFile = path.resolve(rootDir, "input/feishu-bitable.config.json");

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

function runFeishuAssetsRefresh(): number | null {
  migrateLegacyProcessedManifestForCurrentCache();
  console.log("\n== Hermes child: refresh-feishu-assets ==");
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
    stdio: "inherit"
  });
  if (result.error) {
    throw result.error;
  }
  return result.status;
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
    const currentBatch = readBatchProgress();
    if (shouldContinueFeishuBatchAfterChildExit({ exitCode, batchComplete: currentBatch.batchComplete })) {
      console.log("Feishu batch still has pending products after a successful child run; continuing full real flow.");
      nextMode = "full";
      continue;
    }

    if (exitCode === 0 && currentBatch.batchComplete) {
      const refreshExitCode = runFeishuAssetsRefresh();
      if (refreshExitCode !== 0) {
        process.exitCode = refreshExitCode ?? 1;
        return;
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
        continue;
      }
    }

    process.exitCode = exitCode ?? 1;
    return;
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
