import fs from "node:fs";
import path from "node:path";
import {
  runPublishFromSpuJob,
  type PublishFromSpuJobInput,
  type PublishFromSpuJobResult
} from "../business/publish-from-spu.js";

interface CliArgs {
  jobFile: string;
  allowPublish: boolean;
  json: boolean;
}

interface PublishFromSpuJobFile {
  runtimeDir?: string;
  resultFile?: string;
  input: PublishFromSpuJobInput;
}

function parseArgs(argv: string[]): CliArgs {
  const args = new Map<string, string>();
  const flags = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key?.startsWith("--")) {
      continue;
    }
    if (key === "--allow-publish" || key === "--json") {
      flags.add(key);
      continue;
    }
    const value = argv[index + 1];
    if (value && !value.startsWith("--")) {
      args.set(key, value);
      index += 1;
    }
  }

  const jobFile = args.get("--job");
  if (!jobFile) {
    throw new Error("Usage: --job <publish-from-spu.job.json>");
  }

  return { jobFile, allowPublish: flags.has("--allow-publish"), json: flags.has("--json") };
}

function loadJob(jobFile: string): PublishFromSpuJobFile {
  const resolvedPath = path.resolve(jobFile);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Job file not found: ${resolvedPath}`);
  }

  const parsed = JSON.parse(fs.readFileSync(resolvedPath, "utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Publish job file must contain a JSON object.");
  }

  const job = parsed as PublishFromSpuJobFile;
  if (!job.input || typeof job.input !== "object" || Array.isArray(job.input)) {
    throw new Error("Publish job file missing required field: input");
  }

  return job;
}

function writeResult(result: PublishFromSpuJobResult): void {
  const resultFile = result.artifacts.resultFile || path.join(result.runtimeDir, "result.json");
  fs.mkdirSync(path.dirname(resultFile), { recursive: true });
  fs.writeFileSync(resultFile, `${JSON.stringify(result, null, 2)}\n`, "utf8");
}

function requiresPublishConfirmation(input: PublishFromSpuJobInput): boolean {
  const mode = input.mode || "prepare";
  return mode === "run_publish_flow" || mode === "run_pre_publish_flow" || mode === "run_graphic_flow";
}

async function main(): Promise<void> {
  const { jobFile, allowPublish, json } = parseArgs(process.argv.slice(2));
  const job = loadJob(jobFile);
  if (requiresPublishConfirmation(job.input) && !allowPublish) {
    throw new Error("Publish flow requires explicit --allow-publish to avoid accidental Doudian browser publishing.");
  }
  const runId = path.basename(path.resolve(jobFile), path.extname(jobFile));
  const result = await runPublishFromSpuJob(job.input, {
    runId,
    runtimeDir: job.runtimeDir,
    resultFile: job.resultFile
  });

  writeResult(result);
  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(
      JSON.stringify(
        {
          ok: result.ok,
          status: result.status,
          message: result.message,
          runtimeDir: result.runtimeDir,
          resultFile: result.artifacts.resultFile,
          screenshotCount: result.artifacts.screenshots.length,
          error: result.error?.message
        },
        null,
        2
      )
    );
  }
  if (!result.ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
