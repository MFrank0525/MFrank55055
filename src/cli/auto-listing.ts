import fs from "node:fs";
import path from "node:path";
import { disconnectAutomationBrowserConnections } from "../browser/launch.js";
import { runAutoListingJob } from "../autolist/orchestrator.js";
import { inferResumeStartStepForTask } from "../autolist/resume-rules.js";
import { AUTO_LISTING_STEPS, normalizeAutoListingStep } from "../autolist/types.js";
import { resolveImageGenerationProvider } from "../autolist/image-generation-provider.js";
import type { AutoListingJobFile, AutoListingRunState, AutoListingStep, ImageTaskState } from "../autolist/types.js";

interface AutoListingCliArgs {
  jobFile: string;
  resumeStateFile: string;
  resumeOutFile: string;
  allowReal: boolean;
  json: boolean;
}

function parseArgs(argv: string[]): AutoListingCliArgs {
  const args = new Map<string, string>();
  const flags = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key?.startsWith("--")) {
      continue;
    }
    if (key === "--allow-real" || key === "--json") {
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
    throw new Error("Usage: --job <auto-listing.job.json> [--resume-from-state <state.json> --out <resume.job.json>]");
  }

  return {
    jobFile,
    resumeStateFile: args.get("--resume-from-state") || "",
    resumeOutFile: args.get("--out") || "",
    allowReal: flags.has("--allow-real"),
    json: flags.has("--json")
  };
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

function loadRunState(stateFile: string): AutoListingRunState {
  const resolvedPath = path.resolve(stateFile);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`State file not found: ${resolvedPath}`);
  }
  const parsed = JSON.parse(fs.readFileSync(resolvedPath, "utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Auto listing state file must contain a JSON object.");
  }
  return parsed as AutoListingRunState;
}

function printExternalCostSummary(job: AutoListingJobFile): void {
  const simulateOnly = job.input?.simulateOnly !== false;
  const provider = job.input?.imageGenerationProvider || "openai-compatible";
  console.log(
    JSON.stringify(
      {
        mode: simulateOnly ? "simulate" : "real paid-capable",
        externalServices: simulateOnly
          ? ["Feishu assets may be read from local job data; paid generation and browser publishing should remain disabled."]
          : [
              "Feishu API quota",
              `${provider} image generation credits`,
              "Feishu prompt/title field reads",
              "Doudian browser session with publishing side effects"
            ],
        imageGenerationConfigFile: job.input?.imageGenerationConfigFile
          ? path.resolve(job.input.imageGenerationConfigFile)
          : undefined
      },
      null,
      2
    )
  );
}

function isTerminalTask(task: ImageTaskState): boolean {
  return task.status === "done" || task.status === "cleaned";
}

function selectResumeTask(state: AutoListingRunState): ImageTaskState {
  const current = state.currentTaskId ? state.tasks.find((task) => task.taskId === state.currentTaskId) : undefined;
  if (current && !isTerminalTask(current)) {
    return current;
  }
  const pending = state.tasks.find((task) => !isTerminalTask(task));
  if (!pending) {
    throw new Error("No resumable task found. All tasks are already done or cleaned.");
  }
  return pending;
}

function listFilesRecursive(dir: string): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }
  const files: string[] = [];
  const pending = [dir];
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

function inferResumeStartStepFromDisk(task: ImageTaskState, runtimeDir: string, fallback: AutoListingStep): AutoListingStep {
  if (fallback === "published") {
    return fallback;
  }
  const taskDir = path.join(runtimeDir, "tasks", task.taskId);
  const files = listFilesRecursive(taskDir);
  if (files.some((file) => file.includes(`${path.sep}staged${path.sep}`) && /\.(png|jpe?g|webp)$/i.test(file))) {
    return "main_images_generated";
  }
  if (files.some((file) => file.includes(`${path.sep}openai-compatible${path.sep}raw${path.sep}`) && /^generated-\d+/i.test(path.basename(file)))) {
    return "main_images_generated";
  }
  if (files.some((file) => file.includes(`${path.sep}poster-word-files${path.sep}`) && file.toLowerCase().endsWith(".docx"))) {
    return "main_images_generated";
  }
  if (files.some((file) => path.basename(file) === "selling-points.txt")) {
    return "poster_prompts_generated";
  }
  return fallback;
}

function collectResumeProductFolderNames(task: ImageTaskState): string[] {
  return Array.from(
    new Set(
      [
        ...task.generatedProductFolders,
        ...(task.mainImageArtifact?.generatedFiles.map((item) => item.productFolder) || []),
        ...(task.shopDistributionArtifact?.distributedFolders || [])
      ]
        .map((folder) => path.basename(folder))
        .filter(Boolean)
    )
  );
}

function writeResumeJob(options: {
  sourceJob: AutoListingJobFile;
  state: AutoListingRunState;
  stateFile: string;
  outFile: string;
}): AutoListingJobFile {
  const task = selectResumeTask(options.state);
  const runtimeDir = path.dirname(path.resolve(options.stateFile));
  const explicitStartStep =
    options.sourceJob.input?.startStep || (options.sourceJob as AutoListingJobFile & { startStep?: AutoListingStep }).startStep;
  const startStep = explicitStartStep
    ? normalizeAutoListingStep(explicitStartStep as any)
    : inferResumeStartStepFromDisk(task, runtimeDir, inferResumeStartStepForTask(task));
  const resumeJob: AutoListingJobFile = {
    ...options.sourceJob,
    runtimeDir,
    resultFile: path.join(runtimeDir, "result.json"),
    runId: options.state.runId,
    input: {
      ...options.sourceJob.input,
      startStep,
      resumeSourceImagePath: task.sourceImagePath,
      resumeTaskId: task.taskId,
      resumeProductFolderNames: collectResumeProductFolderNames(task),
      feishuBatchFingerprint: options.state.feishuBatchFingerprint,
      maxImagesPerRun: 1,
      clearTestOutputsBeforeRun: false
    }
  };
  const resolvedOut = path.resolve(options.outFile);
  fs.mkdirSync(path.dirname(resolvedOut), { recursive: true });
  fs.writeFileSync(resolvedOut, `${JSON.stringify(resumeJob, null, 2)}\n`, "utf8");
  return resumeJob;
}

async function main(): Promise<void> {
  const { jobFile, resumeStateFile, resumeOutFile, allowReal, json } = parseArgs(process.argv.slice(2));
  const job = loadJob(jobFile);
  resolveImageGenerationProvider(
    job.input?.imageGenerationProvider,
    job.input?.simulateOnly !== false,
    "Auto listing CLI job"
  );
  if (resumeStateFile) {
    if (!resumeOutFile) {
      throw new Error("Missing required argument --out <resume.job.json> when using --resume-from-state.");
    }
    const resumeJob = writeResumeJob({
      sourceJob: job,
      state: loadRunState(resumeStateFile),
      stateFile: resumeStateFile,
      outFile: resumeOutFile
    });
    if (json) {
      console.log(JSON.stringify({ ok: true, resumeJobFile: path.resolve(resumeOutFile), resumeJob }, null, 2));
    } else {
      console.log(
        JSON.stringify(
          {
            ok: true,
            resumeJobFile: path.resolve(resumeOutFile),
            runId: resumeJob.runId,
            startStep: resumeJob.input.startStep,
            resumeTaskId: resumeJob.input.resumeTaskId,
            resumeSourceImagePath: resumeJob.input.resumeSourceImagePath
          },
          null,
          2
        )
      );
    }
    return;
  }

  if (job.input?.simulateOnly === false && !allowReal) {
    throw new Error("Real mode job requires explicit --allow-real. Use npm run auto-listing:hermes-start for normal starts, or pass --allow-real only for direct maintenance runs after confirming external service costs.");
  }
  printExternalCostSummary(job);

  const result = await runAutoListingJob(job).finally(() => disconnectAutomationBrowserConnections());
  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(
      JSON.stringify(
        {
          ok: result.ok,
          runId: result.runId,
          runtimeDir: result.runtimeDir,
          resultFile: result.artifacts.resultFile,
          stateFile: result.artifacts.stateFile,
          taskCount: result.tasks.length,
          completedTasks: result.tasks.filter((task) => task.status === "done" || task.status === "cleaned").length,
          failedTasks: result.tasks.filter((task) => task.status === "failed").length,
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
