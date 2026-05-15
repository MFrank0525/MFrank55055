import fs from "node:fs";
import path from "node:path";
import { runAutoListingJob } from "../autolist/orchestrator.js";
import type { AutoListingJobFile } from "../autolist/types.js";

function parseArgs(argv: string[]): { jobFile: string } {
  const args = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (key?.startsWith("--") && value) {
      args.set(key, value);
    }
  }

  const jobFile = args.get("--job");
  if (!jobFile) {
    throw new Error("Usage: --job <auto-listing.job.json>");
  }

  return { jobFile };
}

function loadJob(jobFile: string): AutoListingJobFile {
  const resolvedPath = path.resolve(jobFile);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Job file not found: ${resolvedPath}`);
  }

  const parsed = JSON.parse(fs.readFileSync(resolvedPath, "utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Auto listing job file must contain a JSON object.");
  }

  return parsed as AutoListingJobFile;
}

async function main(): Promise<void> {
  const { jobFile } = parseArgs(process.argv.slice(2));
  const result = await runAutoListingJob(loadJob(jobFile));
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
