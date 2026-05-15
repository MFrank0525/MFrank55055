import fs from "node:fs";
import path from "node:path";
import { runDoubaoJob } from "../doubao/run.js";
import type { DoubaoJobInput } from "../doubao/types.js";

interface CliArgs {
  jobFile: string;
}

function parseArgs(argv: string[]): CliArgs {
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
    throw new Error("Usage: --job <job.json>");
  }

  return { jobFile };
}

function loadJob(jobFile: string): DoubaoJobInput {
  const resolvedPath = path.resolve(jobFile);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Job file not found: ${resolvedPath}`);
  }

  return JSON.parse(fs.readFileSync(resolvedPath, "utf8")) as DoubaoJobInput;
}

async function main(): Promise<void> {
  const { jobFile } = parseArgs(process.argv.slice(2));
  const result = await runDoubaoJob(loadJob(jobFile));
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
