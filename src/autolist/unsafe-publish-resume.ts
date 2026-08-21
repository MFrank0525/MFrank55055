import fs from "node:fs";
import path from "node:path";
import { isManifestEntryAcceptedForBatchCompletion } from "./publish-manifest.js";
import { requireOpenAiCompatibleImageProvider } from "./image-generation-provider.js";
import { selectRemainingResumeProductFolderNames } from "./resume-rules.js";

type JsonObject = Record<string, unknown>;

interface PublishManifestFile {
  entries?: Array<{
    targetKey?: string;
    targetIdentity?: {
      batchFingerprint?: string;
      recordId?: string;
      taskId?: string;
      shopCode?: string;
      watermarkNo?: number;
    };
    productFolder?: string;
    sourceImagePath?: string;
    taskId?: string;
    recordId?: string;
    batchFingerprint?: string;
    status?: "pending" | "published" | "failed" | "skipped";
    finalVerifyStatus?: string;
    errorClass?: string;
  }>;
}

interface ResultTask {
  sourceImagePath?: string;
  taskId?: string;
  generatedProductFolders?: string[];
  shopDistributionArtifact?: { distributedFolders?: string[] };
  feishuProductRecord?: { recordId?: string };
}

export function findLatestIncompletePublishManifestForResume(options: {
  rootDir: string;
  resultFiles: string[];
  fileMtimeMs: (file: string) => number | undefined;
  countSafelyPublishedManifestEntries: (runtimeDir: string) => number;
  shouldResumeSourceImageForCurrentFeishuBatch: (sourceImagePath: string, reusableArtifactCount: number, runtimeBatchFingerprint?: string) => boolean;
}): { runtimeDir: string; resultFile: string; result: AutoListingResultFile; task: ResultTask; remainingProductFolderNames: string[] } | undefined {
  const candidates = options.resultFiles.flatMap((resultFile) => {
    const result = readJsonFile<AutoListingResultFile>(resultFile);
    const runtimeDir = result?.runtimeDir || path.dirname(resultFile);
    const manifest = readJsonFile<PublishManifestFile>(path.join(runtimeDir, "publish-manifest.json"));
    return (result?.tasks || []).flatMap((task) => {
      const allProductFolderNames = [
        ...(task.shopDistributionArtifact?.distributedFolders || []),
        ...(task.generatedProductFolders || [])
      ].map((folder) => path.basename(folder)).filter(Boolean);
      const remainingProductFolderNames = selectRemainingResumeProductFolderNames({
        allProductFolderNames,
        manifestEntries: manifest?.entries || []
      });
      if (!task.sourceImagePath || !allProductFolderNames.length || !manifest?.entries?.length || !remainingProductFolderNames.length ||
        !fs.existsSync(task.sourceImagePath) ||
        !options.shouldResumeSourceImageForCurrentFeishuBatch(task.sourceImagePath, allProductFolderNames.length, result?.feishuBatchFingerprint)) {
        return [];
      }
      return [{
        runtimeDir,
        resultFile,
        result: result!,
        task,
        remainingProductFolderNames,
        safelyPublishedCount: options.countSafelyPublishedManifestEntries(runtimeDir),
        mtimeMs: options.fileMtimeMs(path.join(runtimeDir, "publish-manifest.json")) || options.fileMtimeMs(resultFile) || 0
      }];
    });
  });
  return candidates.sort((a, b) => b.safelyPublishedCount - a.safelyPublishedCount || b.mtimeMs - a.mtimeMs)[0];
}

interface AutoListingResultFile {
  runId?: string;
  feishuBatchFingerprint?: string;
  businessRuleFingerprint?: string;
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
        source.imageGenerationProvider,
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
}): { runtimeDir: string; resultFile: string; result: AutoListingResultFile; unsafeEntries: NonNullable<PublishManifestFile["entries"]>; task: ResultTask } | undefined {
  const candidates = options.resultFiles.flatMap((resultFile) => {
    const result = readJsonFile<AutoListingResultFile>(resultFile);
    const runtimeDir = result?.runtimeDir || path.dirname(resultFile);
    const manifest = readJsonFile<PublishManifestFile>(path.join(runtimeDir, "publish-manifest.json"));
    const unsafeEntries = unsafePublishEntriesForResume(runtimeDir);
    const safelyPublishedCount = options.countSafelyPublishedManifestEntries(runtimeDir);
    if (!result || !unsafeEntries.length) {
      return [];
    }
    const grouped = new Map<string, NonNullable<PublishManifestFile["entries"]>>();
    for (const entry of unsafeEntries) {
      const sourceImagePath = entry.sourceImagePath ? path.resolve(options.rootDir, entry.sourceImagePath) : "";
      const taskId = entry.targetIdentity?.taskId || entry.taskId || "";
      const recordId = entry.targetIdentity?.recordId || entry.recordId || "";
      if (!sourceImagePath || !taskId || !recordId) continue;
      const key = `${sourceImagePath}\u0000${taskId}\u0000${recordId}`;
      grouped.set(key, [...(grouped.get(key) || []), entry]);
    }
    return [...grouped.entries()].flatMap(([key, productUnsafeEntries]) => {
      const [sourceImagePath, taskId, recordId] = key.split("\u0000");
      if (!sourceImagePath || !fs.existsSync(sourceImagePath)) return [];
      const manifestProductFolders = (manifest?.entries || [])
        .filter((entry) =>
          path.resolve(options.rootDir, entry.sourceImagePath || "") === sourceImagePath
          && (entry.targetIdentity?.taskId || entry.taskId) === taskId
          && (entry.targetIdentity?.recordId || entry.recordId) === recordId
        )
        .map((entry) => entry.productFolder || "")
        .filter(Boolean);
      const resultTask = result.tasks?.find((item) =>
        item.sourceImagePath
        && path.resolve(options.rootDir, item.sourceImagePath) === sourceImagePath
        && (!item.taskId || item.taskId === taskId)
      );
      const task: ResultTask = resultTask || {
        sourceImagePath,
        taskId,
        generatedProductFolders: manifestProductFolders,
        feishuProductRecord: { recordId }
      };
      if (!task.generatedProductFolders?.length && !task.shopDistributionArtifact?.distributedFolders?.length) {
        task.generatedProductFolders = manifestProductFolders;
      }
      if (!options.shouldResumeSourceImageForCurrentFeishuBatch(
        sourceImagePath,
        Math.max(manifestProductFolders.length, productUnsafeEntries.length, safelyPublishedCount),
        result.feishuBatchFingerprint
      )) return [];
      const firstWatermark = Math.min(...productUnsafeEntries.map((entry) => Number(entry.targetIdentity?.watermarkNo || 999)));
      return [{
        runtimeDir,
        resultFile,
        result,
        unsafeEntries: productUnsafeEntries,
        task,
        firstWatermark,
        taskId,
        safelyPublishedCount,
        mtimeMs: options.fileMtimeMs(path.join(runtimeDir, "publish-manifest.json")) || options.fileMtimeMs(resultFile) || 0
      }];
    });
  });
  return candidates.sort((a, b) =>
    b.safelyPublishedCount - a.safelyPublishedCount
    || b.mtimeMs - a.mtimeMs
    || a.taskId.localeCompare(b.taskId)
    || a.firstWatermark - b.firstWatermark
  )[0];
}
