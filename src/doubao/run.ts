import fs from "node:fs";
import path from "node:path";
import { captureConversation } from "./capture.js";
import { formatTimestamp, getDefaultRuntimeDir } from "./paths.js";
import { saveTitlesFromRaw } from "./save.js";
import { submitPrompt } from "./submit.js";
import type { DoubaoJobInput, DoubaoJobResolved, DoubaoRunResult } from "./types.js";
import { logInfo, setLogFile } from "../utils/logger.js";
import { assertNoGptPlusWebUrl } from "../utils/gpt-plus-guard.js";

const DEFAULT_IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"];

function resolveImagePaths(job: DoubaoJobInput): string[] {
  if (job.imagePaths?.length) {
    return job.imagePaths.map((item) => path.resolve(item));
  }

  if (!job.imageDir) {
    throw new Error("imagePaths or imageDir is required.");
  }

  const imageDir = path.resolve(job.imageDir);
  if (!fs.existsSync(imageDir)) {
    throw new Error(`Image dir not found: ${imageDir}`);
  }

  const extensions = new Set((job.imageExtensions || DEFAULT_IMAGE_EXTENSIONS).map((item) => item.toLowerCase()));
  return fs
    .readdirSync(imageDir)
    .filter((name) => extensions.has(path.extname(name).toLowerCase()))
    .sort((a, b) => a.localeCompare(b, "zh-CN"))
    .map((name) => path.join(imageDir, name));
}

function ensurePromptFile(job: DoubaoJobInput, runtimeDir: string): string {
  if (job.promptFile) {
    const promptFile = path.resolve(job.promptFile);
    if (!fs.existsSync(promptFile)) {
      throw new Error(`Prompt file not found: ${promptFile}`);
    }
    return promptFile;
  }

  if (!job.promptText?.trim()) {
    throw new Error("promptFile or promptText is required.");
  }

  const promptFile = path.join(runtimeDir, "prompt.txt");
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.writeFileSync(promptFile, job.promptText.trim(), "utf8");
  return promptFile;
}

function removeIfExists(targetPath: string): void {
  if (targetPath && fs.existsSync(targetPath)) {
    fs.rmSync(targetPath, { force: true });
  }
}

function cleanupOutputDir(outputDir: string): void {
  const patterns = [/^doubao-response-raw-.*\.txt$/i, /^doubao-result-.*\.png$/i, /\.md$/i, /\.csv$/i];
  for (const name of fs.readdirSync(outputDir)) {
    if (patterns.some((pattern) => pattern.test(name))) {
      fs.rmSync(path.join(outputDir, name), { force: true });
    }
  }
}

function resolveJob(job: DoubaoJobInput): DoubaoJobResolved {
  const runId = formatTimestamp().replace(/[^0-9]/g, "");
  const runtimeDir = path.resolve(job.runtimeDir || path.join(getDefaultRuntimeDir(), runId));
  const promptFile = ensurePromptFile(job, runtimeDir);
  const imagePaths = resolveImagePaths(job);
  if (imagePaths.length === 0) {
    throw new Error("No images found to process.");
  }

  const outputDir = path.resolve(job.outputDir);
  fs.mkdirSync(outputDir, { recursive: true });

  const resultFile = path.resolve(job.resultFile || path.join(runtimeDir, "result.json"));
  const conversationUrl = job.conversationUrl?.trim() || undefined;
  if (conversationUrl) {
    assertNoGptPlusWebUrl(conversationUrl, "Doubao conversationUrl");
  }
  return {
    promptFile,
    outputDir,
    imagePaths,
    titleCount: job.titleCount ?? 12,
    resultFile,
    runtimeDir,
    cleanupOutputDir: job.cleanupOutputDir ?? true,
    freshConversation: job.freshConversation ?? false,
    conversationUrl,
    attachImages: job.attachImages ?? true,
    captureWaitMs: job.captureWaitMs
  };
}

function writeResult(resultFile: string, result: DoubaoRunResult): void {
  fs.mkdirSync(path.dirname(resultFile), { recursive: true });
  fs.writeFileSync(resultFile, `${JSON.stringify(result, null, 2)}\n`, "utf8");
}

export async function runDoubaoJob(jobInput: DoubaoJobInput): Promise<DoubaoRunResult> {
  const job = resolveJob(jobInput);
  const runId = path.basename(job.runtimeDir);
  const startedAt = new Date().toISOString();
  const logFile = path.join(job.runtimeDir, "logs", "run.log");
  const result: DoubaoRunResult = {
    status: "failed",
    runId,
    startedAt,
    finishedAt: startedAt,
    logFile,
    job,
    items: []
  };

  setLogFile(logFile);
  fs.mkdirSync(path.join(job.runtimeDir, "temp"), { recursive: true });

  try {
    logInfo(`run started: ${runId}`);
    logInfo(`images queued: ${job.imagePaths.length}`);
    if (job.cleanupOutputDir) {
      cleanupOutputDir(job.outputDir);
      logInfo("output directory cleanup complete");
    }

    for (let index = 0; index < job.imagePaths.length; index += 1) {
      const imagePath = job.imagePaths[index];
      const rawFile = path.join(job.runtimeDir, "temp", `raw-${String(index + 1).padStart(2, "0")}.txt`);
      removeIfExists(rawFile);

      logInfo(`processing image ${index + 1}/${job.imagePaths.length}: ${imagePath}`);
      const submitResult = await submitPrompt({
        imagePath,
        promptFile: job.promptFile,
        freshConversation: job.freshConversation,
        conversationUrl: job.conversationUrl,
        attachImage: job.attachImages
      });
      logInfo(`submitted image ${index + 1} at ${submitResult.submittedAt}`);

      const captureResult = await captureConversation({
        outputDir: job.outputDir,
        rawFileOut: rawFile,
        waitMs: job.captureWaitMs,
        conversationUrl: job.conversationUrl,
        mode: "titles",
        titleCount: job.titleCount
      });
      logInfo(`captured response for image ${index + 1}`);

      const saveResult = saveTitlesFromRaw({
        rawFile: captureResult.rawFile,
        outputDir: job.outputDir,
        titleCount: job.titleCount,
        promptText: fs.readFileSync(job.promptFile, "utf8")
      });
      logInfo(`saved csv for image ${index + 1}: ${saveResult.csvFile}`);

      result.items.push({
        imagePath: path.resolve(imagePath),
        rawFile: captureResult.rawFile,
        csvFile: saveResult.csvFile,
        productName: saveResult.productName,
        titleCount: saveResult.titleCount,
        submittedAt: submitResult.submittedAt,
        capturedAt: captureResult.capturedAt
      });
    }

    result.status = "success";
    result.finishedAt = new Date().toISOString();
    writeResult(job.resultFile, result);
    logInfo(`run finished successfully: ${runId}`);
    return result;
  } catch (error) {
    result.finishedAt = new Date().toISOString();
    result.error = {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    };
    writeResult(job.resultFile, result);
    throw error;
  } finally {
    setLogFile(undefined);
  }
}
