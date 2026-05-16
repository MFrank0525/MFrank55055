import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

interface FlowArgs {
  real: boolean;
  configFile: string;
}

interface LocalFeishuConfig {
  auth?: {
    appId?: string;
    appSecret?: string;
    tenantAccessToken?: string;
  };
}

function parseArgs(argv: string[]): FlowArgs {
  const configIndex = argv.indexOf("--config");
  return {
    real: argv.includes("--real"),
    configFile: configIndex >= 0 ? argv[configIndex + 1] || "./input/feishu-bitable.config.json" : "./input/feishu-bitable.config.json"
  };
}

function loadFeishuEnv(configFile: string): NodeJS.ProcessEnv {
  const resolved = path.resolve(configFile);
  if (!fs.existsSync(resolved)) {
    return process.env;
  }
  const parsed = JSON.parse(fs.readFileSync(resolved, "utf8")) as LocalFeishuConfig;
  return {
    ...process.env,
    FEISHU_APP_ID: process.env.FEISHU_APP_ID || parsed.auth?.appId || "",
    FEISHU_APP_SECRET: process.env.FEISHU_APP_SECRET || parsed.auth?.appSecret || "",
    FEISHU_TENANT_ACCESS_TOKEN: process.env.FEISHU_TENANT_ACCESS_TOKEN || parsed.auth?.tenantAccessToken || ""
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

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const jobFile = args.real
    ? "./input/auto-listing.job.mac-feishu-real.json"
    : "./input/auto-listing.job.mac-feishu-flow.json";

  console.log(`Flow mode: ${args.real ? "real" : "simulate"}`);
  console.log(`Job file: ${path.resolve(jobFile)}`);
  const feishuEnv = loadFeishuEnv(args.configFile);

  runStep("Feishu assets", "npm", [
    "run",
    "feishu:assets",
    "--",
    "--config",
    args.configFile,
    "--out",
    "./data/feishu/products.json"
  ], feishuEnv);
  runStep("Feishu doctor", "npm", ["run", "doctor:feishu"]);
  runStep(
    "Auto-listing doctor",
    "npm",
    args.real ? ["run", "doctor:auto-listing", "--", "--require-dreamina-generation"] : ["run", "doctor:auto-listing"]
  );
  runStep("Auto-listing", "npm", ["run", "business:auto-listing", "--", "--job", jobFile]);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
