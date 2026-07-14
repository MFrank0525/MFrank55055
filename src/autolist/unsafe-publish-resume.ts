import fs from "node:fs";
import path from "node:path";
import { isManifestEntryAcceptedForBatchCompletion } from "./publish-manifest.js";
import { requireOpenAiCompatibleImageProvider } from "./image-generation-provider.js";

type JsonObject = Record<string, unknown>;

interface PublishManifestFile {
  entries?: Array<{
    productFolder?: string;
    sourceImagePath?: string;
    status?: "pending" | "published" | "failed" | "skipped";
    finalVerifyStatus?: string;
  }>;
}

interface ResultTask {
  sourceImagePath?: string;
}

interface AutoListingResultFile {
  feishuBatchFingerprint?: string;
  runtimeDir?: string;
  tasks?: ResultTask[];
}

function readJsonFile<T>(file: string): T | undefined {
  if (!fs.existsSync(file)) return undefined;
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

export function unsafePublishEntriesForResume(runtimeDir: string): NonNullable<PublishManifestFile["entries"]> {
  const manifest = readJsonFile<PublishManifestFile>(path.join(runtimeDir, "publish-manifest.json"));
  return (manifest?.entries || []).filter((entry) => Boolean(entry.productFolder) && Boolean(entry.sourceImagePath) &&
    (entry.finalVerifyStatus === "needs_manual_review" || (entry.status === "failed" && !isManifestEntryAcceptedForBatchCompletion(entry as never))));
}

export function buildFallbackSourceJobFromPreflight(rootDir: string, runtimeDir: string): JsonObject | undefined {
  const source = readJsonFile<{ source?: Record<string, string | number | undefined> }>(path.join(runtimeDir, "preflight.json"))?.source;
  const required = ["feishuProductDataFile", "feishuImageDir", "mainImageWorkDir", "qualificationDir", "shopRootDir"] as const;
  if (!source || required.some((key) => typeof source[key] !== "string" || !source[key])) return undefined;
  return {
    input: {
      feishuProductDataFile: String(source.feishuProductDataFile),
      feishuImageDir: String(source.feishuImageDir),
      mainImageWorkDir: String(source.mainImageWorkDir),
      titleDir: path.resolve(rootDir, "input/auto-listing/titles"),
      qualificationDir: String(source.qualificationDir),
      shopRootDir: String(source.shopRootDir),
      imageGenerationProvider: requireOpenAiCompatibleImageProvider(
        source.imageGenerationProvider || "openai-compatible",
        "Unsafe publish resume preflight"
      ),
      imageGenerationConfigFile: source.imageGenerationConfigFile ? String(source.imageGenerationConfigFile) : undefined,
      mainImageExpectedCount: typeof source.mainImageExpectedCount === "number" ? source.mainImageExpectedCount : undefined,
      mainImageCountStrategy: source.mainImageCountStrategy ? String(source.mainImageCountStrategy) : undefined,
      paidImageSubmissionLedgerDir: source.paidImageSubmissionLedgerDir ? String(source.paidImageSubmissionLedgerDir) : undefined,
      processedImageManifest: path.resolve(rootDir, "data/auto-listing/processed-images.json"),
      pauseSignalFile: source.pauseSignalFile ? String(source.pauseSignalFile) : undefined,
      simulateOnly: false,
      cleanupAfterPublish: true,
      cleanupSourceImageAfterPublish: true,
      maxImagesPerRun: 1,
      clearTestOutputsBeforeRun: false
    }
  };
}

export function findLatestUnsafePublishManifestForResume(options: {
  rootDir: string;
  resultFiles: string[];
  fileMtimeMs: (file: string) => number | undefined;
  countSafelyPublishedManifestEntries: (runtimeDir: string) => number;
  shouldResumeSourceImageForCurrentFeishuBatch: (sourceImagePath: string, reusableArtifactCount: number, runtimeBatchFingerprint?: string) => boolean;
}): { runtimeDir: string; resultFile: string; result: AutoListingResultFile; unsafeEntries: NonNullable<PublishManifestFile["entries"]> } | undefined {
  const candidates = options.resultFiles.flatMap((resultFile) => {
    const result = readJsonFile<AutoListingResultFile>(resultFile);
    const runtimeDir = result?.runtimeDir || path.dirname(resultFile);
    const unsafeEntries = unsafePublishEntriesForResume(runtimeDir);
    const firstSourceImagePath = unsafeEntries[0]?.sourceImagePath ? path.resolve(options.rootDir, unsafeEntries[0].sourceImagePath) : "";
    const sameSource = unsafeEntries.every((entry) => entry.sourceImagePath && path.resolve(options.rootDir, entry.sourceImagePath) === firstSourceImagePath);
    const task = result?.tasks?.find((item) => item.sourceImagePath && path.resolve(options.rootDir, item.sourceImagePath) === firstSourceImagePath);
    const safelyPublishedCount = options.countSafelyPublishedManifestEntries(runtimeDir);
    if (!result || !unsafeEntries.length || !firstSourceImagePath || !sameSource || !fs.existsSync(firstSourceImagePath) || !task?.sourceImagePath ||
      !options.shouldResumeSourceImageForCurrentFeishuBatch(task.sourceImagePath, Math.max(unsafeEntries.length, safelyPublishedCount), result.feishuBatchFingerprint)) {
      return [];
    }
    return [{ runtimeDir, resultFile, result, unsafeEntries, safelyPublishedCount, mtimeMs: options.fileMtimeMs(path.join(runtimeDir, "publish-manifest.json")) || options.fileMtimeMs(resultFile) || 0 }];
  });
  return candidates.sort((a, b) => b.safelyPublishedCount - a.safelyPublishedCount || b.mtimeMs - a.mtimeMs)[0];
}
