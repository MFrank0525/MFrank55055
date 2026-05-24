import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { buildFeishuBatchFingerprint } from "../autolist/feishu-batch-rules.js";
import { migrateLegacyProcessedImagesToBatch } from "../autolist/file-batch.js";
import { loadFeishuProductRecords } from "../autolist/feishu-products.js";

interface FlowArgs {
  real: boolean;
  configFile: string;
  imageGenerationConfigFile: string;
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
    imageGenerationConfigFile: "./input/image-generation.config.json"
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
    console.log("May consume: Feishu API quota, OpenAI-compatible image generation credits, Doubao web account quota, Doudian browser session.");
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
