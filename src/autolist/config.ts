import fs from "node:fs";
import path from "node:path";
import { formatTimestamp } from "../doubao/paths.js";
import { AUTO_LISTING_STEPS, normalizeAutoListingStep } from "./types.js";
import type { AutoListingJobFile, AutoListingJobInput, AutoListingResolvedJob } from "./types.js";

const DEFAULT_IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"];

function ensureDirExists(targetPath: string, label: string): string {
  const resolved = path.resolve(targetPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`${label} not found: ${resolved}`);
  }
  return resolved;
}

function withDefaults(input: AutoListingJobInput): Required<AutoListingJobInput> {
  const startStep = normalizeAutoListingStep(input.startStep || "source_images_discovered");
  const endStep = normalizeAutoListingStep(input.endStep || "done");
  const feishuProductDataFile = input.feishuProductDataFile
    ? ensureDirExists(input.feishuProductDataFile, "Feishu product data file")
    : "";
  if (!AUTO_LISTING_STEPS.includes(startStep)) {
    throw new Error(`Invalid startStep: ${startStep}`);
  }
  if (!AUTO_LISTING_STEPS.includes(endStep)) {
    throw new Error(`Invalid endStep: ${endStep}`);
  }

  return {
    feishuImageDir: ensureDirExists(input.feishuImageDir, "Feishu image dir"),
    mainImageWorkDir: ensureDirExists(input.mainImageWorkDir || input.jimengImageDir || "", "Main image work dir"),
    jimengImageDir: ensureDirExists(input.mainImageWorkDir || input.jimengImageDir || "", "Main image work dir"),
    titleDir: ensureDirExists(input.titleDir, "Title dir"),
    qualificationDir: ensureDirExists(input.qualificationDir, "Qualification dir"),
    productInfoXlsx: input.productInfoXlsx
      ? ensureDirExists(input.productInfoXlsx, "Product info workbook")
      : feishuProductDataFile
        ? ""
        : (() => {
            throw new Error("Product info workbook not configured. Set productInfoXlsx or feishuProductDataFile.");
          })(),
    productInfoKeyMapFile: input.productInfoKeyMapFile
      ? path.resolve(input.productInfoKeyMapFile)
      : path.resolve(process.cwd(), "data", "auto-listing", "product-info-key-map.json"),
    feishuProductDataFile,
    shopRootDir: ensureDirExists(input.shopRootDir, "Shop root dir"),
    imageGenerationProvider: input.imageGenerationProvider || "openai-compatible",
    imageGenerationConfigFile: input.imageGenerationConfigFile
      ? ensureDirExists(input.imageGenerationConfigFile, "Image generation config file")
      : "",
    mainImageExpectedCount: input.mainImageExpectedCount ?? 4,
    mainImageCountStrategy: input.mainImageCountStrategy || "require_exact",
    runtimeRootDir: path.resolve(input.runtimeRootDir || path.join(process.cwd(), "data", "auto-listing", "runs")),
    processedImageManifest: path.resolve(
      input.processedImageManifest || path.join(process.cwd(), "data", "auto-listing", "processed-images.json")
    ),
    pauseSignalFile: path.resolve(
      input.pauseSignalFile || path.join(process.cwd(), "data", "auto-listing", "control", "pause.requested")
    ),
    imageExtensions: (input.imageExtensions || DEFAULT_IMAGE_EXTENSIONS).map((item) => item.toLowerCase()),
    serialOnly: input.serialOnly ?? true,
    stopOnError: input.stopOnError ?? true,
    cleanupAfterPublish: input.cleanupAfterPublish ?? false,
    cleanupSourceImageAfterPublish: input.cleanupSourceImageAfterPublish ?? false,
    archiveMainImageDir: path.resolve(input.archiveMainImageDir || "/Users/mfrank/Desktop/FFC的文件夹/工作/001电商/2026AI主图"),
    titleCount: input.titleCount ?? 20,
    maxImagesPerRun: input.maxImagesPerRun ?? 0,
    resumeSourceImagePath: input.resumeSourceImagePath ? path.resolve(input.resumeSourceImagePath) : "",
    resumeTaskId: input.resumeTaskId || "",
    resumeProductFolderNames: input.resumeProductFolderNames || [],
    feishuBatchFingerprint: input.feishuBatchFingerprint || "",
    simulateOnly: input.simulateOnly ?? true,
    clearTestOutputsBeforeRun: input.clearTestOutputsBeforeRun ?? false,
    startStep,
    endStep
  };
}

export function resolveAutoListingJob(job: AutoListingJobFile): AutoListingResolvedJob {
  if (!job.input || typeof job.input !== "object" || Array.isArray(job.input)) {
    throw new Error("Auto listing job file missing required field: input");
  }

  const input = withDefaults(job.input);
  const runId = job.runId || path.basename(path.resolve(job.runtimeDir || path.join(input.runtimeRootDir, formatTimestamp())));
  const runtimeDir = path.resolve(job.runtimeDir || path.join(input.runtimeRootDir, runId));
  const resultFile = path.resolve(job.resultFile || path.join(runtimeDir, "result.json"));
  const stateFile = path.join(runtimeDir, "state.json");
  const eventFile = path.join(runtimeDir, "events.ndjson");
  const manualsReadFile = path.join(runtimeDir, "manuals-read.json");
  const preflightFile = path.join(runtimeDir, "preflight.json");

  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.mkdirSync(path.dirname(input.processedImageManifest), { recursive: true });
  fs.mkdirSync(path.dirname(input.pauseSignalFile), { recursive: true });

  return {
    runtimeDir,
    resultFile,
    stateFile,
    eventFile,
    manualsReadFile,
    preflightFile,
    processedImageManifest: input.processedImageManifest,
    pauseSignalFile: input.pauseSignalFile,
    input
  };
}
