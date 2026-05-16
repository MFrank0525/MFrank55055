import fs from "node:fs";
import path from "node:path";
import { formatTimestamp } from "../doubao/paths.js";
import { getDefaultDreaminaBin } from "../utils/platform.js";
import { AUTO_LISTING_STEPS } from "./types.js";
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
  const startStep = input.startStep || "discovered";
  const endStep = input.endStep || "done";
  const feishuProductDataFile = input.feishuProductDataFile
    ? ensureDirExists(input.feishuProductDataFile, "Feishu product data file")
    : "";
  if (!AUTO_LISTING_STEPS.includes(startStep) && startStep !== "discovered") {
    throw new Error(`Invalid startStep: ${startStep}`);
  }
  if (!AUTO_LISTING_STEPS.includes(endStep)) {
    throw new Error(`Invalid endStep: ${endStep}`);
  }

  return {
    feishuImageDir: ensureDirExists(input.feishuImageDir, "Feishu image dir"),
    jimengImageDir: ensureDirExists(input.jimengImageDir, "Jimeng image dir"),
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
    deepseekConversationUrl: input.deepseekConversationUrl || "",
    dreaminaBin: path.resolve(input.dreaminaBin || getDefaultDreaminaBin()),
    dreaminaPollSeconds: input.dreaminaPollSeconds ?? 120,
    dreaminaModelVersion: input.dreaminaModelVersion || "5.0",
    dreaminaResolutionType: input.dreaminaResolutionType || "2k",
    dreaminaRatio: input.dreaminaRatio || "1:1",
    dreaminaExpectedImageCount: input.dreaminaExpectedImageCount ?? 4,
    dreaminaImageCountStrategy: input.dreaminaImageCountStrategy || "require_exact",
    runtimeRootDir: path.resolve(input.runtimeRootDir || path.join(process.cwd(), "data", "auto-listing", "runs")),
    processedImageManifest: path.resolve(
      input.processedImageManifest || path.join(process.cwd(), "data", "auto-listing", "processed-images.json")
    ),
    imageExtensions: (input.imageExtensions || DEFAULT_IMAGE_EXTENSIONS).map((item) => item.toLowerCase()),
    serialOnly: input.serialOnly ?? true,
    stopOnError: input.stopOnError ?? true,
    cleanupAfterPublish: input.cleanupAfterPublish ?? true,
    cleanupSourceImageAfterPublish: input.cleanupSourceImageAfterPublish ?? true,
    titleCount: input.titleCount ?? 20,
    maxImagesPerRun: input.maxImagesPerRun ?? 0,
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
  const runId = path.basename(path.resolve(job.runtimeDir || path.join(input.runtimeRootDir, formatTimestamp())));
  const runtimeDir = path.resolve(job.runtimeDir || path.join(input.runtimeRootDir, runId));
  const resultFile = path.resolve(job.resultFile || path.join(runtimeDir, "result.json"));
  const stateFile = path.join(runtimeDir, "state.json");
  const eventFile = path.join(runtimeDir, "events.ndjson");
  const manualsReadFile = path.join(runtimeDir, "manuals-read.json");

  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.mkdirSync(path.dirname(input.processedImageManifest), { recursive: true });

  return {
    runtimeDir,
    resultFile,
    stateFile,
    eventFile,
    manualsReadFile,
    processedImageManifest: input.processedImageManifest,
    input
  };
}
