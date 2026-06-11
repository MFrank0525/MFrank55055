import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { summarizeFeishuBatchProgress } from "../autolist/audit-rules.js";
import { shouldRefreshFeishuAssetsBeforeFullFlow } from "../autolist/batch-continuation-rules.js";
import { validateFeishuPosterPromptBatch } from "../autolist/deepseek-prompts.js";
import { buildFeishuBatchFingerprint, buildFeishuBatchIdentityFingerprint } from "../autolist/feishu-batch-rules.js";
import { migrateLegacyProcessedImagesToBatch, readProcessedImages } from "../autolist/file-batch.js";
import { loadFeishuProductRecords } from "../autolist/feishu-products.js";

interface FlowArgs {
  real: boolean;
  configFile: string;
  imageGenerationConfigFile: string;
  skipFeishuAssetsRefresh: boolean;
  continuationReason: "initial_full" | "same_batch_pending" | "new_batch_after_refresh";
}

interface LocalFeishuConfig {
  auth?: {
    appId?: string;
    appSecret?: string;
    tenantAccessToken?: string;
  };
}

interface AutoListingJobSummary {
  input?: {
    simulateOnly?: boolean;
    imageGenerationProvider?: string;
    imageGenerationConfigFile?: string;
    feishuProductDataFile?: string;
    processedImageManifest?: string;
  };
}

function parseArgs(argv: string[]): FlowArgs {
  const configIndex = argv.indexOf("--config");
  return {
    real: argv.includes("--real"),
    configFile: configIndex >= 0 ? argv[configIndex + 1] || "./input/feishu-bitable.config.json" : "./input/feishu-bitable.config.json",
    imageGenerationConfigFile: "./input/image-generation.config.json",
    skipFeishuAssetsRefresh: argv.includes("--skip-feishu-assets-refresh"),
    continuationReason: argv.includes("--same-batch-pending")
      ? "same_batch_pending"
      : argv.includes("--new-batch-after-refresh")
        ? "new_batch_after_refresh"
        : "initial_full"
  };
}

function loadFeishuEnv(configFile: string): NodeJS.ProcessEnv {
  const resolved = path.resolve(configFile);
  if (!fs.existsSync(resolved)) {
    return process.env;
  }
  const parsed = JSON.parse(fs.readFileSync(resolved, "utf8")) as LocalFeishuConfig;
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

function runStep(label: string, command: string, args: string[], env: NodeJS.ProcessEnv = process.env): void {
  console.log(`\n== ${label} ==`);
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env
  });
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status ?? "unknown"}`);
  }
}

function runStepCaptured(label: string, command: string, args: string[], env: NodeJS.ProcessEnv = process.env): void {
  console.log(`\n== ${label} ==`);
  const result = spawnSync(command, args, {
    encoding: "utf8",
    env
  });
  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(`${label} failed with exit code ${result.status ?? "unknown"}: ${output}`);
  }
}

function loadJobSummary(jobFile: string): AutoListingJobSummary {
  const resolved = path.resolve(jobFile);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Job file not found: ${resolved}`);
  }
  return JSON.parse(fs.readFileSync(resolved, "utf8")) as AutoListingJobSummary;
}

function assertFlowModeMatchesJob(jobFile: string, real: boolean): void {
  const job = loadJobSummary(jobFile);
  const simulateOnly = job.input?.simulateOnly;
  if (real && simulateOnly !== false) {
    throw new Error(`Real flow requires job input.simulateOnly=false: ${path.resolve(jobFile)}`);
  }
  if (!real && simulateOnly === false) {
    throw new Error(`Simulate flow refuses to run a real job with input.simulateOnly=false: ${path.resolve(jobFile)}`);
  }
}

function printExternalCostSummary(jobFile: string, real: boolean): void {
  const job = loadJobSummary(jobFile);
  const provider = job.input?.imageGenerationProvider || "openai-compatible";
  console.log("\n== External service summary ==");
  console.log(`Mode: ${real ? "real paid-capable" : "simulate"}`);
  console.log(`Image generation provider: ${provider}`);
  if (real) {
    console.log("May consume: Feishu API quota, OpenAI-compatible image generation credits, and Doudian browser session.");
    console.log(`Image generation config file: ${path.resolve(job.input?.imageGenerationConfigFile || "./input/image-generation.config.json")}`);
  } else {
    console.log("Paid image generation and browser publishing must remain disabled by input.simulateOnly=true.");
  }
}

function migrateLegacyProcessedManifestForCurrentCache(jobFile: string): void {
  const job = loadJobSummary(jobFile);
  const feishuProductDataFile = path.resolve(job.input?.feishuProductDataFile || "./data/feishu/products.json");
  const processedImageManifest = path.resolve(job.input?.processedImageManifest || "./data/auto-listing/processed-images.json");
  if (!fs.existsSync(feishuProductDataFile)) {
    return;
  }
  const fingerprint = buildFeishuBatchFingerprint(loadFeishuProductRecords(feishuProductDataFile));
  if (migrateLegacyProcessedImagesToBatch(processedImageManifest, fingerprint)) {
    console.log(`Migrated legacy processed-image manifest to current Feishu batch: ${fingerprint}`);
  }
}

function readCurrentBatchComplete(jobFile: string): boolean | undefined {
  const job = loadJobSummary(jobFile);
  const feishuProductDataFile = path.resolve(job.input?.feishuProductDataFile || "./data/feishu/products.json");
  const processedImageManifest = path.resolve(job.input?.processedImageManifest || "./data/auto-listing/processed-images.json");
  if (!fs.existsSync(feishuProductDataFile)) {
    return undefined;
  }
  const records = loadFeishuProductRecords(feishuProductDataFile);
  const fingerprint = buildFeishuBatchFingerprint(records);
  const progress = summarizeFeishuBatchProgress({
    records,
    processedImages: readProcessedImages(processedImageManifest, fingerprint)
  });
  return progress.batchComplete;
}

function assertFeishuPosterPromptsReady(jobFile: string): void {
  const job = loadJobSummary(jobFile);
  const feishuProductDataFile = path.resolve(job.input?.feishuProductDataFile || "./data/feishu/products.json");
  if (!fs.existsSync(feishuProductDataFile)) {
    return;
  }
  const validation = validateFeishuPosterPromptBatch(loadFeishuProductRecords(feishuProductDataFile));
  if (!validation.ok) {
    throw new Error(validation.summary);
  }
  console.log(validation.summary);
}

function isOnlineFeishuSameBatch(jobFile: string, configFile: string, feishuEnv: NodeJS.ProcessEnv): boolean {
  const job = loadJobSummary(jobFile);
  const feishuProductDataFile = path.resolve(job.input?.feishuProductDataFile || "./data/feishu/products.json");
  if (!fs.existsSync(feishuProductDataFile)) {
    return true;
  }
  const currentRecords = loadFeishuProductRecords(feishuProductDataFile);
  const currentIdentity = buildFeishuBatchIdentityFingerprint(currentRecords);
  const candidateFile = path.resolve("data/auto-listing/control/feishu-products.refresh-candidate.json");
  fs.mkdirSync(path.dirname(candidateFile), { recursive: true });
  runStepCaptured("Feishu current-batch identity probe", "npm", [
    "run",
    "feishu:dump",
    "--",
    "--config",
    configFile,
    "--out",
    candidateFile
  ], feishuEnv);
  const candidateRecords = loadFeishuProductRecords(candidateFile);
  const candidateIdentity = buildFeishuBatchIdentityFingerprint(candidateRecords);
  if (candidateIdentity === currentIdentity) {
    console.log(`Online Feishu table is the same batch (${currentIdentity}); refreshing mutable fields and attachments.`);
    return true;
  }
  console.log(
    `Online Feishu table identity changed (${currentIdentity} -> ${candidateIdentity}); keeping locked current batch cache until pending products finish.`
  );
  return false;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const jobFile = args.real
    ? "./input/auto-listing.job.mac-feishu-real.json"
    : "./input/auto-listing.job.mac-feishu-flow.json";

  console.log(`Flow mode: ${args.real ? "real" : "simulate"}`);
  console.log(`Job file: ${path.resolve(jobFile)}`);
  assertFlowModeMatchesJob(jobFile, args.real);
  printExternalCostSummary(jobFile, args.real);
  const feishuEnv = loadFeishuEnv(args.configFile);

  runStep("Feishu doctor", "npm", ["run", "doctor:feishu"], feishuEnv);
  runStep(
    "Auto-listing doctor",
    "npm",
    args.real
      ? [
          "run",
          "doctor:auto-listing",
          "--",
          "--require-image-generation",
          "--image-generation-provider",
          "openai-compatible",
          "--image-generation-config",
          args.imageGenerationConfigFile
        ]
      : ["run", "doctor:auto-listing", "--", "--image-generation-provider", "openai-compatible"]
  );
  migrateLegacyProcessedManifestForCurrentCache(jobFile);
  const currentBatchComplete = readCurrentBatchComplete(jobFile);
  const sameBatchRefreshAvailable =
    currentBatchComplete === false && !args.skipFeishuAssetsRefresh
      ? isOnlineFeishuSameBatch(jobFile, args.configFile, feishuEnv)
      : false;
  const shouldRefreshFeishuAssets =
    !args.skipFeishuAssetsRefresh &&
    shouldRefreshFeishuAssetsBeforeFullFlow({
      continuationReason: args.continuationReason,
      currentBatchComplete,
      sameBatchRefreshAvailable
    });
  if (!shouldRefreshFeishuAssets) {
    console.log("\n== Feishu assets ==");
    console.log("Skipped Feishu assets refresh; continuing with the locked current Feishu cache.");
  } else {
    runStep("Feishu assets", "npm", [
      "run",
      "feishu:assets",
      "--",
      "--config",
      args.configFile,
      "--out",
      "./data/feishu/products.json",
      "--cleanup-stale-assets"
    ], feishuEnv);
  }
  assertFeishuPosterPromptsReady(jobFile);
  runStep("Auto-listing", "npm", [
    "run",
    "business:auto-listing",
    "--",
    "--job",
    jobFile,
    ...(args.real ? ["--allow-real"] : [])
  ]);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
