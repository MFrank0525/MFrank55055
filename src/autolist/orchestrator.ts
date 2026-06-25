import fs from "node:fs";
import path from "node:path";
import { generatePosterPromptsWithDeepSeek } from "./deepseek-prompts.js";
import {
  assertDeepSeekPromptsBelongToCurrentProduct,
  buildDeepSeekPromptValidationContext
} from "./deepseek-prompt-rules.js";
import { writeFeishuPromptWordFiles } from "./deepseek-word-docs.js";
import { generateMainImageAssets } from "./main-image-assets.js";
import { archiveUnwatermarkedMainImages } from "./archive-main-images.js";
import { appendProcessedImages, discoverPendingImages, readProcessedImages } from "./file-batch.js";
import { auditMainImageGeneration, collectFeishuProductAssetFiles } from "./audit-rules.js";
import { buildFeishuBatchFingerprint, canResumeFeishuBatchArtifacts } from "./feishu-batch-rules.js";
import {
  loadFeishuProductRecords,
  loadFeishuProductRuntimeRecord,
  resolvePendingFeishuProductSourceImagesFromRecords
} from "./feishu-products.js";
import { getProductCategoryPlan } from "./product-category.js";
import { enrichDistributedTitleSheets } from "./metadata.js";
import { cleanupAfterPublish, cleanupStaleRunHistory } from "./cleanup.js";
import { buildAutoListingPreflightSummary } from "./preflight.js";
import { readOperationManual } from "./operation-manual.js";
import { prepareTestRunOutputs } from "./prepare-test-run.js";
import { publishDistributedProducts, publishRuntimeKey, selectLatestFailedPublishResult } from "./publish.js";
import { attachQualificationFiles } from "./qualifications.js";
import { recoverArtifactsFromWordFiles, recoverDistributedFoldersFromShopRoot } from "./resume.js";
import { distributeProductFoldersToShops } from "./shop-distribution.js";
import { assertTitleDistributionTargets, distributeTitleSheets, generateTitleSheets } from "./title-sheets.js";
import { resolveAutoListingJob } from "./config.js";
import { assertRuleTextIntegrity } from "./rule-text.js";
import { applyResumeTaskId, createEvent, createRunState, failTask, getPlannedSteps, markRunCompleted, markRunFailed, markRunPaused, recordTaskProgress } from "./state-machine.js";
import { assertDoudianPublishSessionReady } from "../business/publish-from-spu.js";
import { logError, logInfo, setLogFile } from "../utils/logger.js";
import { atomicWriteJson } from "../utils/atomic-file.js";
import { loadPublishManifest, type PublishProductIdentity } from "./publish-manifest.js";
import { isProductFullyProcessed } from "./processed-completion-rules.js";
import { removePaidImageProductLedger } from "./paid-image-submission-ledger.js";
import type {
  AutoListingEvent,
  AutoListingJobFile,
  AutoListingRunResult,
  AutoListingRunState,
  AutoListingTaskError,
  ImageTaskState
} from "./types.js";
import { normalizeAutoListingStep } from "./types.js";

interface ManualReadRecord {
  step: string;
  filePath: string;
  readCount: number;
  firstReadAt: string;
  lastReadAt: string;
}

function shouldPreflightDoudianPublishSession(input: {
  simulateOnly: boolean;
  startStep: string;
  endStep: string;
}): boolean {
  if (input.simulateOnly) {
    return false;
  }
  const allSteps = getPlannedSteps();
  const normalizedStartStep = normalizeAutoListingStep(input.startStep as any);
  const normalizedEndStep = normalizeAutoListingStep(input.endStep as any);
  const startIndex = normalizedStartStep === "source_images_discovered" ? 1 : Math.max(1, allSteps.indexOf(normalizedStartStep));
  const endIndex = Math.max(startIndex, allSteps.indexOf(normalizedEndStep));
  return allSteps.slice(startIndex, endIndex + 1).includes("published");
}

function manualReadSummary(manualReadMap: Map<string, ManualReadRecord>): ManualReadRecord[] {
  return Array.from(manualReadMap.values()).sort((a, b) => {
    const stepCompare = a.step.localeCompare(b.step, "zh-CN");
    if (stepCompare !== 0) {
      return stepCompare;
    }
    return a.filePath.localeCompare(b.filePath, "zh-CN");
  });
}

function discoverFallbackImages(
  imageDir: string,
  extensions: string[],
  maxImagesPerRun: number
): string[] {
  if (!fs.existsSync(imageDir)) {
    return [];
  }

  return fs
    .readdirSync(imageDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(imageDir, entry.name))
    .filter((filePath) => extensions.includes(path.extname(filePath).toLowerCase()))
    .map((filePath) => ({
      filePath,
      mtimeMs: fs.statSync(filePath).mtimeMs
    }))
    .sort((a, b) => a.mtimeMs - b.mtimeMs)
    .slice(0, Math.max(1, maxImagesPerRun))
    .map((item) => item.filePath);
}

function filterResumeSourceImage(images: string[], resumeSourceImagePath: string): string[] {
  if (!resumeSourceImagePath) {
    return images;
  }
  if (!images.length) {
    return [];
  }
  const resolvedResumePath = path.resolve(resumeSourceImagePath);
  const selected = images.filter((imagePath) => path.resolve(imagePath) === resolvedResumePath);
  if (!selected.length) {
    throw new Error(`Resume source image was not found in the current source list: ${resolvedResumePath}`);
  }
  return selected;
}

function writeJson(filePath: string, value: unknown): void {
  atomicWriteJson(filePath, value);
}

function redactSensitiveText(value: string): string {
  return value
    .replace(/(authorization|bearer|api[-_]?key|secret|token|cookie)(["'\s:=]+)([^"'\s,}]+)/gi, "$1$2[redacted]")
    .replace(/(app_secret|appSecret|tenant_access_token|tenantAccessToken)(["'\s:=]+)([^"'\s,}]+)/gi, "$1$2[redacted]");
}

function appendEvent(filePath: string, event: AutoListingEvent): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify({ ...event, message: redactSensitiveText(event.message) })}\n`, "utf8");
}

function collectProtectedCleanupAssetFiles(feishuProductDataFile: string): string[] {
  if (!feishuProductDataFile || !fs.existsSync(feishuProductDataFile)) {
    return [];
  }
  try {
    return collectFeishuProductAssetFiles(loadFeishuProductRecords(feishuProductDataFile));
  } catch {
    return [];
  }
}

function buildPublishProductIdentity(task: ImageTaskState, batchFingerprint: string | undefined): PublishProductIdentity {
  return {
    batchFingerprint,
    taskId: task.taskId,
    sourceImagePath: task.sourceImagePath,
    recordId: task.feishuProductRecord?.recordId,
    userCognitionName: task.feishuProductRecord?.userCognitionName || task.sellingPointArtifact?.userCognitionName,
    genericName: task.feishuProductRecord?.genericName || task.sellingPointArtifact?.brandedGenericName,
    productCategory: task.feishuProductRecord?.productCategory
  };
}

function persistState(stateFile: string, state: AutoListingRunState): void {
  writeJson(stateFile, state);
}

class AutoListingPausedError extends Error {
  constructor(
    readonly signalFile: string,
    readonly taskId?: string,
    readonly step?: string
  ) {
    super(`Auto-listing pause requested by signal file: ${signalFile}`);
    this.name = "AutoListingPausedError";
  }
}

class AutoListingStepError extends Error {
  constructor(
    readonly step: string,
    message: string,
    readonly cause?: unknown
  ) {
    super(message);
    this.name = "AutoListingStepError";
  }
}

function isPauseRequested(signalFile: string): boolean {
  return Boolean(signalFile && fs.existsSync(signalFile));
}

function assertNotPaused(signalFile: string, taskId?: string, step?: string): void {
  if (isPauseRequested(signalFile)) {
    throw new AutoListingPausedError(signalFile, taskId, step);
  }
}

function assertMainImageCompletionGate(input: {
  task: ImageTaskState;
  expectedPromptCount: number;
  expectedImagesPerPrompt: number;
  simulateOnly: boolean;
}): void {
  const generatedFiles = input.task.mainImageArtifact?.generatedFiles || [];
  const candidatePaths = generatedFiles.flatMap((item) => [item.imageFile, item.rawImageFile, item.productFolder].filter(Boolean) as string[]);
  const existingFiles = input.simulateOnly ? candidatePaths : candidatePaths.filter((filePath) => fs.existsSync(filePath));
  const audit = auditMainImageGeneration({
    tasks: [input.task],
    existingFiles,
    expectedPromptCount: input.expectedPromptCount,
    expectedImagesPerPrompt: input.expectedImagesPerPrompt,
    simulateOnly: input.simulateOnly
  });
  if (!audit.ok) {
    const reason = audit.errors.map((issue) => issue.message).join("; ");
    throw new Error(`Main image completion gate failed: ${reason || "generated main images are incomplete"}`);
  }
}

async function executeTaskChain(
  task: ImageTaskState,
  runtimeDir: string,
  mainImageWorkDir: string,
  titleDir: string,
  titleCount: number,
  qualificationDir: string,
  productInfoXlsx: string,
  productInfoKeyMapFile: string,
  feishuProductDataFile: string,
  shopRootDir: string,
  imageGenerationProvider: "openai-compatible",
  imageGenerationConfigFile: string,
  mainImageExpectedCount: number,
  mainImageCountStrategy: "accept_all" | "require_exact" | "limit_to_count",
  cleanupAfterPublishEnabled: boolean,
  cleanupSourceImageAfterPublish: boolean,
  archiveMainImageDir: string,
  startStep: string,
  endStep: string,
  eventFile: string,
  pauseSignalFile: string,
  paidImageSubmissionLedgerDir: string,
  simulateOnly: boolean,
  feishuBatchFingerprint: string | undefined,
  resumeProductFolderNames: string[],
  protectedCleanupAssetFiles: string[],
  manualReadMap: Map<string, ManualReadRecord>,
  onProgress?: (task: ImageTaskState) => void
): Promise<ImageTaskState> {
  let current = task;
  const markProgress = (): void => {
    onProgress?.(current);
  };
  const allSteps = getPlannedSteps();
  const normalizedStartStep = normalizeAutoListingStep(startStep as any);
  const normalizedEndStep = normalizeAutoListingStep(endStep as any);
  const startIndex =
    normalizedStartStep === "source_images_discovered" ? 1 : Math.max(1, allSteps.indexOf(normalizedStartStep));
  const endIndex = Math.max(startIndex, allSteps.indexOf(normalizedEndStep));
  const publishStepIndex = allSteps.indexOf("published");

  if (
    startIndex >= publishStepIndex &&
    feishuProductDataFile &&
    current.sourceImagePath &&
    (!current.sellingPointArtifact?.sellingPointText || !current.feishuProductRecord)
  ) {
    const feishuRuntimeRecord = loadFeishuProductRuntimeRecord({
      productDataFile: feishuProductDataFile,
      sourceImagePath: current.sourceImagePath,
      runtimeDir,
      taskId: current.taskId
    });
    current = {
      ...current,
      sellingPointArtifact: current.sellingPointArtifact || feishuRuntimeRecord.sellingPointArtifact,
      feishuProductRecord: feishuRuntimeRecord.record,
      lastUpdatedAt: new Date().toISOString(),
      notes: [...current.notes, "Recovered Feishu product identity for publish-stage resume."]
    };
    appendEvent(
      eventFile,
      createEvent("info", "resume", "Recovered Feishu product identity for publish-stage resume.", current.taskId)
    );
  }

  if (startIndex >= allSteps.indexOf("titles_generated") && !current.generatedProductFolders.length) {
    const recovered = recoverDistributedFoldersFromShopRoot({
      shopRootDir,
      requireWorkbook: startIndex >= publishStepIndex,
      expectedCount: titleCount,
      productNameCandidates: [
        current.feishuProductRecord?.userCognitionName || "",
        current.sellingPointArtifact?.userCognitionName || "",
        current.sellingPointArtifact?.brandedGenericName || ""
      ],
      expectedProductFolderNames: resumeProductFolderNames
    });
    current = {
      ...current,
      generatedProductFolders: current.generatedProductFolders.length
        ? current.generatedProductFolders
        : recovered.generatedProductFolders,
      shopDistributionArtifact:
        startIndex >= publishStepIndex
          ? current.shopDistributionArtifact || recovered.shopDistributionArtifact
          : current.shopDistributionArtifact,
      lastUpdatedAt: new Date().toISOString(),
      notes: [...current.notes, "Recovered distributed product folders from shop root directory."]
    };
    appendEvent(
      eventFile,
      createEvent("info", "resume", "Recovered distributed product folders from shop root directory.", current.taskId)
    );
  }

  if (
    startIndex >= allSteps.indexOf("main_images_generated") &&
    (!current.sellingPointArtifact?.sellingPointText || !current.deepseekArtifact?.wordFiles?.length) &&
    !(startIndex >= publishStepIndex && current.shopDistributionArtifact?.distributedFolders?.length)
  ) {
    const recovered = recoverArtifactsFromWordFiles({
      runtimeDir,
      taskId: current.taskId,
      feishuProductDataFile,
      sourceImagePath: current.sourceImagePath
    });
    current = {
      ...current,
      sellingPointArtifact: current.sellingPointArtifact || recovered.sellingPointArtifact,
      deepseekArtifact: current.deepseekArtifact || recovered.deepseekArtifact,
      feishuProductRecord: current.feishuProductRecord || recovered.feishuProductRecord,
      lastUpdatedAt: new Date().toISOString(),
      notes: [...current.notes, "Recovered selling points and poster prompts from saved Word files."]
    };
    appendEvent(
      eventFile,
      createEvent("info", "resume", "Recovered selling points and poster prompts from saved Word files.", current.taskId)
    );
  }

  for (const step of allSteps.slice(startIndex, endIndex + 1)) {
    try {
      assertNotPaused(pauseSignalFile, current.taskId, step);
      const operationManual = readOperationManual(step);
      if (operationManual) {
        const now = new Date().toISOString();
        const key = `${step}:${operationManual.filePath}`;
        const existing = manualReadMap.get(key);
        manualReadMap.set(key, {
          step,
          filePath: operationManual.filePath,
          readCount: (existing?.readCount || 0) + 1,
          firstReadAt: existing?.firstReadAt || now,
          lastReadAt: now
        });
        appendEvent(
          eventFile,
          createEvent("info", step, `Loaded operation manual: ${operationManual.filePath}`, current.taskId)
        );
        current = {
          ...current,
          lastUpdatedAt: new Date().toISOString(),
          notes: [...current.notes, `Loaded operation manual before ${step}: ${operationManual.filePath}`]
        };
      }

    if (step === "selling_points_loaded") {
      if (!feishuProductDataFile) {
        throw new Error("Selling points must come from Feishu product data. Configure feishuProductDataFile before running auto-listing.");
      }
      appendEvent(eventFile, createEvent("info", step, "Loading selling points from Feishu product data.", current.taskId));
      const feishuRuntimeRecord = loadFeishuProductRuntimeRecord({
        productDataFile: feishuProductDataFile,
        sourceImagePath: current.sourceImagePath,
        runtimeDir,
        taskId: current.taskId
      });
      current = {
        ...current,
        status: step,
        sellingPointArtifact: feishuRuntimeRecord.sellingPointArtifact,
        feishuProductRecord: feishuRuntimeRecord.record,
        lastUpdatedAt: new Date().toISOString(),
        notes: [
          ...current.notes,
          `Feishu product data loaded: record=${feishuRuntimeRecord.record.recordId}; spu=${feishuRuntimeRecord.record.spu}; category=${getProductCategoryPlan(feishuRuntimeRecord.record.productCategory).category}.`
        ]
      };
      appendEvent(
        eventFile,
        createEvent(
          "info",
          step,
          `Feishu selling points loaded for record=${feishuRuntimeRecord.record.recordId}.`,
          current.taskId
        )
      );
      markProgress();
      continue;
    }

    if (step === "poster_prompts_generated") {
      if (!current.sellingPointArtifact?.sellingPointText) {
        throw new Error("Poster prompt generation requires selling points.");
      }
      appendEvent(eventFile, createEvent("info", step, "Starting poster prompt generation.", current.taskId));
      assertNotPaused(pauseSignalFile, current.taskId, step);
      const promptCount = getProductCategoryPlan(current.feishuProductRecord?.productCategory).promptCount;
      const deepseekArtifact = await generatePosterPromptsWithDeepSeek({
        runtimeDir,
        taskId: current.taskId,
        sellingPointText: current.sellingPointArtifact.sellingPointText,
        feishuPromptText: current.feishuProductRecord?.deepseekPromptText,
        userCognitionName: current.sellingPointArtifact.userCognitionName,
        brandedGenericName: current.sellingPointArtifact.brandedGenericName,
        genericName: current.feishuProductRecord?.genericName,
        promptCount,
        simulateOnly
      });
      deepseekArtifact.wordFiles = writeFeishuPromptWordFiles({
        mainImageWorkDir: path.join(runtimeDir, "tasks", current.taskId, "poster-word-files"),
        sellingPointText: current.sellingPointArtifact.sellingPointText,
        mainImageInstructionText: current.feishuProductRecord?.mainImageInstructionText || "",
        prompts: deepseekArtifact.prompts,
        positivePromptText: current.feishuProductRecord?.positivePromptText || "",
        negativePromptText: current.feishuProductRecord?.negativePromptText || "",
        promptCount
      });
      current = {
        ...current,
        status: step,
        deepseekArtifact,
        lastUpdatedAt: new Date().toISOString(),
        notes: [
          ...current.notes,
          `Poster prompt provider generated ${deepseekArtifact.prompts.length} prompt paragraph(s).`,
          `Poster prompt Word files generated: ${deepseekArtifact.wordFiles?.length || 0}.`
        ]
      };
      appendEvent(
        eventFile,
        createEvent(
          "info",
          step,
          `Poster prompts ready: promptCount=${deepseekArtifact.prompts.length}; wordFiles=${deepseekArtifact.wordFiles?.length || 0}`,
          current.taskId
        )
      );
      markProgress();
      continue;
    }

    if (step === "main_images_generated") {
      if (!current.sellingPointArtifact?.sellingPointText || !current.deepseekArtifact?.prompts?.length) {
        throw new Error("Main image generation requires selling points and poster prompts.");
      }
      const productPlan = getProductCategoryPlan(current.feishuProductRecord?.productCategory);
      const promptValidationContext = buildDeepSeekPromptValidationContext({
        sellingPointText: current.sellingPointArtifact.sellingPointText,
        userCognitionName: current.sellingPointArtifact.userCognitionName,
        brandedGenericName: current.sellingPointArtifact.brandedGenericName,
        genericName: current.feishuProductRecord?.genericName
      });
      try {
        assertDeepSeekPromptsBelongToCurrentProduct(
          current.deepseekArtifact.prompts.slice(0, productPlan.promptCount),
          promptValidationContext,
          productPlan.promptCount
        );
      } catch (error) {
        appendEvent(
          eventFile,
          createEvent(
            "info",
            "poster_prompts_generated",
            `Saved DeepSeek prompts do not match current product; regenerating before image generation. ${
              error instanceof Error ? error.message : String(error)
            }`,
            current.taskId
          )
        );
        const regeneratedDeepseekArtifact = await generatePosterPromptsWithDeepSeek({
          runtimeDir,
          taskId: current.taskId,
          sellingPointText: current.sellingPointArtifact.sellingPointText,
          feishuPromptText: current.feishuProductRecord?.deepseekPromptText,
          userCognitionName: current.sellingPointArtifact.userCognitionName,
          brandedGenericName: current.sellingPointArtifact.brandedGenericName,
          genericName: current.feishuProductRecord?.genericName,
          promptCount: productPlan.promptCount,
          simulateOnly
        });
        regeneratedDeepseekArtifact.wordFiles = writeFeishuPromptWordFiles({
          mainImageWorkDir: path.join(runtimeDir, "tasks", current.taskId, "poster-word-files"),
          sellingPointText: current.sellingPointArtifact.sellingPointText,
          mainImageInstructionText: current.feishuProductRecord?.mainImageInstructionText || "",
          prompts: regeneratedDeepseekArtifact.prompts,
          positivePromptText: current.feishuProductRecord?.positivePromptText || "",
          negativePromptText: current.feishuProductRecord?.negativePromptText || "",
          promptCount: productPlan.promptCount
        });
        current = {
          ...current,
          status: "poster_prompts_generated",
          deepseekArtifact: regeneratedDeepseekArtifact,
          lastUpdatedAt: new Date().toISOString(),
          notes: [...current.notes, "Regenerated DeepSeek prompts after current-product validation rejected saved prompts."]
        };
        markProgress();
      }
      appendEvent(eventFile, createEvent("info", step, "Starting main image generation.", current.taskId));
      assertNotPaused(pauseSignalFile, current.taskId, step);
      const mainImageArtifact = await generateMainImageAssets({
        runtimeDir,
        taskId: current.taskId,
        shopRootDir,
        sourceImagePath: current.sourceImagePath,
        sourceImageReferenceUrl: current.feishuProductRecord?.whiteBackgroundImages?.[0]?.providerReferenceUrl,
        sellingPointText: current.sellingPointArtifact!.sellingPointText,
        brandedGenericName: current.sellingPointArtifact!.brandedGenericName,
        wordFiles: current.deepseekArtifact!.wordFiles || [],
        imageGenerationProvider,
        imageGenerationConfigFile,
        mainImageExpectedCount,
        mainImageCountStrategy,
        promptCount: productPlan.promptCount,
        shopCodes: productPlan.shopCodes,
        imagesPerShop: productPlan.imagesPerShop,
        feishuRecordId: current.feishuProductRecord?.recordId,
        feishuBatchFingerprint,
        paidImageSubmissionLedgerDir,
        simulateOnly,
        onProgress: (message) => {
          appendEvent(eventFile, createEvent("info", step, message, current.taskId));
          current = recordTaskProgress(current, step, message);
          markProgress();
        }
      });
      current = {
        ...current,
        status: step,
        mainImageArtifact,
        lastUpdatedAt: new Date().toISOString(),
        notes: [...current.notes, `Main image generation produced ${mainImageArtifact.generatedFiles.length} file(s).`]
      };
      assertMainImageCompletionGate({
        task: current,
        expectedPromptCount: productPlan.promptCount,
        expectedImagesPerPrompt: mainImageExpectedCount,
        simulateOnly
      });
      appendEvent(
        eventFile,
        createEvent("info", step, `Main images ready: ${mainImageArtifact.generatedFiles.length} file(s).`, current.taskId)
      );
      markProgress();
      continue;
    }

    if (step === "product_folders_built") {
      if (!current.mainImageArtifact?.generatedFiles?.length) {
        throw new Error("Product folder step requires generated main image files.");
      }
      const productPlan = getProductCategoryPlan(current.feishuProductRecord?.productCategory);
      assertMainImageCompletionGate({
        task: current,
        expectedPromptCount: productPlan.promptCount,
        expectedImagesPerPrompt: mainImageExpectedCount,
        simulateOnly
      });
      current = {
        ...current,
        status: step,
        generatedProductFolders: current.mainImageArtifact.generatedFiles.map((item) => item.productFolder),
        lastUpdatedAt: new Date().toISOString(),
        notes: [...current.notes, `Built ${current.mainImageArtifact.generatedFiles.length} product folder(s).`]
      };
      appendEvent(
        eventFile,
        createEvent("info", step, `Product folders ready: ${current.generatedProductFolders.join(" | ")}`, current.taskId)
      );
      markProgress();
      continue;
    }

    if (step === "titles_generated") {
      if (!current.sellingPointArtifact?.sellingPointText) {
        throw new Error("Title generation requires Feishu product context.");
      }
      assertNotPaused(pauseSignalFile, current.taskId, step);
      const effectiveTitleCount = getProductCategoryPlan(current.feishuProductRecord?.productCategory).titleCount || titleCount;
      if (!simulateOnly) {
        assertTitleDistributionTargets(current.generatedProductFolders, effectiveTitleCount);
      }
      const titleSheetArtifact = await generateTitleSheets({
        titleDir,
        sourceImagePath: current.sourceImagePath,
        sellingPointText: current.sellingPointArtifact.sellingPointText,
        titleKeywordText: current.feishuProductRecord?.titleKeywordText,
        fixedSuffixText: current.feishuProductRecord?.titleSuffixText,
        productPriceText: current.feishuProductRecord?.productPriceText,
        brand: current.feishuProductRecord?.brand,
        userCognitionName: current.feishuProductRecord?.userCognitionName,
        genericName: current.feishuProductRecord?.genericName,
        productCategory: current.feishuProductRecord?.productCategory,
        titleCount: effectiveTitleCount,
        simulateOnly,
        runtimeDir: path.join(runtimeDir, "tasks", current.taskId)
      });
      current = {
        ...current,
        status: step,
        titleSheetArtifact,
        lastUpdatedAt: new Date().toISOString(),
        notes: [...current.notes, `Generated ${titleSheetArtifact.generatedFiles.length} title workbook(s).`]
      };
      appendEvent(
        eventFile,
        createEvent("info", step, `Title workbooks generated: ${titleSheetArtifact.generatedFiles.length}`, current.taskId)
      );
      markProgress();
      continue;
    }

    if (step === "titles_distributed") {
      if (!current.titleSheetArtifact?.generatedFiles?.length || !current.generatedProductFolders.length) {
        throw new Error("Title distribution requires generated title sheets and product folders.");
      }
      const distributedArtifact = distributeTitleSheets(
        current.generatedProductFolders,
        current.titleSheetArtifact.generatedFiles,
        simulateOnly
      );
      current = {
        ...current,
        status: step,
        titleSheetArtifact: distributedArtifact,
        lastUpdatedAt: new Date().toISOString(),
        notes: [
          ...current.notes,
          `Distributed ${distributedArtifact.generatedFiles.filter((item) => item.distributedTo).length} title workbook(s).`
        ]
      };
      appendEvent(
        eventFile,
        createEvent(
          "info",
          step,
          `Title workbooks distributed: ${distributedArtifact.generatedFiles.filter((item) => item.distributedTo).length}`,
          current.taskId
        )
      );
      markProgress();
      continue;
    }

    if (step === "metadata_enriched") {
      if (!current.titleSheetArtifact?.generatedFiles?.length || !current.sellingPointArtifact?.sellingPointText) {
        throw new Error("Metadata enrichment requires distributed title sheets and Feishu product context.");
      }
      const distributedWorkbookFiles = current.titleSheetArtifact.generatedFiles
        .filter((item) => item.distributedTo)
        .map((item) => path.join(item.distributedTo || "", path.basename(item.workbookFile)));
      const metadataArtifact = enrichDistributedTitleSheets({
        productInfoXlsx,
        productInfoKeyMapFile,
        sellingPointText: current.sellingPointArtifact.sellingPointText,
        productName: current.feishuProductRecord?.userCognitionName || current.sellingPointArtifact.brandedGenericName,
        metadataOverride: current.feishuProductRecord
          ? {
              shortTitle: current.feishuProductRecord.shortTitle,
              brand: current.feishuProductRecord.brand,
              spu: current.feishuProductRecord.spu
            }
          : undefined,
        distributedWorkbookFiles,
        simulateOnly
      });
      current = {
        ...current,
        status: step,
        metadataArtifact,
        lastUpdatedAt: new Date().toISOString(),
        notes: [...current.notes, `Metadata enriched for ${metadataArtifact.updatedWorkbookFiles.length} workbook(s).`]
      };
      appendEvent(
        eventFile,
        createEvent("info", step, `Metadata ready: brand=${metadataArtifact.brand}, spu=${metadataArtifact.spu}`, current.taskId)
      );
      markProgress();
      continue;
    }

    if (step === "qualifications_attached") {
      if (!current.generatedProductFolders.length || !current.sellingPointArtifact?.sellingPointText) {
        throw new Error("Qualification attachment requires product folders and Feishu product context.");
      }
      const qualificationArtifact = attachQualificationFiles({
        qualificationDir,
        productFolders: current.generatedProductFolders,
        sellingPointText: current.sellingPointArtifact.sellingPointText,
        productName: current.feishuProductRecord?.userCognitionName || current.sellingPointArtifact.brandedGenericName,
        sourceFiles: (current.feishuProductRecord?.qualificationImages || [])
          .map((item) => item.localFile || "")
          .filter(Boolean),
        simulateOnly
      });
      current = {
        ...current,
        status: step,
        qualificationArtifact,
        lastUpdatedAt: new Date().toISOString(),
        notes: [...current.notes, `Qualification files attached: ${qualificationArtifact.copiedFiles.length}.`]
      };
      appendEvent(
        eventFile,
        createEvent("info", step, `Qualification files copied: ${qualificationArtifact.copiedFiles.length}`, current.taskId)
      );
      markProgress();
      continue;
    }

    if (step === "shop_distributed") {
      if (!current.generatedProductFolders.length) {
        throw new Error("Shop distribution requires product folders.");
      }
      const shopDistributionArtifact = distributeProductFoldersToShops({
        shopRootDir,
        productFolders: current.generatedProductFolders,
        simulateOnly
      });
      current = {
        ...current,
        status: step,
        shopDistributionArtifact,
        lastUpdatedAt: new Date().toISOString(),
        notes: [...current.notes, `Shop distribution completed: ${shopDistributionArtifact.distributedFolders.length} folder(s).`]
      };
      appendEvent(
        eventFile,
        createEvent("info", step, `Shop folders ready: ${shopDistributionArtifact.distributedFolders.length}`, current.taskId)
      );
      markProgress();
      continue;
    }

    if (step === "published") {
      if (!current.shopDistributionArtifact?.distributedFolders?.length) {
        throw new Error("Publish step requires distributed shop folders.");
      }
      assertNotPaused(pauseSignalFile, current.taskId, step);
      const publishArtifact = await publishDistributedProducts({
        runtimeDir,
        distributedFolders: current.shopDistributionArtifact.distributedFolders,
        productIdentity: buildPublishProductIdentity(current, feishuBatchFingerprint),
        feishuProductRecord: current.feishuProductRecord,
        simulateOnly,
        assertNotPaused: () => assertNotPaused(pauseSignalFile, current.taskId, step),
        onProgress: (message) => {
          appendEvent(eventFile, createEvent("info", step, message, current.taskId));
          current = recordTaskProgress(current, step, message);
          markProgress();
        }
      });
      current = {
        ...current,
        status: step,
        publishArtifact,
        lastUpdatedAt: new Date().toISOString(),
        notes: [...current.notes, `Publish completed for ${publishArtifact.results.length} product folder(s).`]
      };
      appendEvent(
        eventFile,
        createEvent("info", step, `Publish results ready: ${publishArtifact.results.length}`, current.taskId)
      );
      markProgress();
      const failedPublishResult = selectLatestFailedPublishResult(publishArtifact.results);
      if (failedPublishResult) {
        throw new Error(`Publish failed for ${failedPublishResult.productFolder}: ${failedPublishResult.message}`);
      }
      continue;
    }

    if (step === "cleaned") {
      assertNotPaused(pauseSignalFile, current.taskId, step);
      const categoryPlan = getProductCategoryPlan(current.feishuProductRecord?.productCategory);
      const taskRuntimeDir = path.join(runtimeDir, "tasks", current.taskId);
      const publishRuntimeDirs =
        current.shopDistributionArtifact?.distributedFolders?.map((folder) =>
          path.join(runtimeDir, "publish", publishRuntimeKey(folder))
        ) || [];
      const archivedFiles = archiveUnwatermarkedMainImages({
        mainImageArtifact: current.mainImageArtifact,
        productName: current.feishuProductRecord?.userCognitionName || current.sellingPointArtifact?.userCognitionName || current.sourceImageName,
        archiveRootDir: archiveMainImageDir,
        rawImageSearchDir: taskRuntimeDir,
        expectedImageCount: categoryPlan.titleCount,
        simulateOnly
      });
      if (!simulateOnly && archivedFiles.length !== categoryPlan.titleCount) {
        throw new Error(
          `Archive guard failed for ${current.sourceImageName}: expected ${categoryPlan.titleCount} unwatermarked main image(s) for ${categoryPlan.category}, got ${archivedFiles.length}. Cleanup was not started.`
        );
      }
      const sourceAssetFiles = [
        ...(current.feishuProductRecord?.whiteBackgroundImages || []).map((item) => item.localFile || ""),
        ...(current.feishuProductRecord?.qualificationImages || []).map((item) => item.localFile || "")
      ].filter(Boolean);
      const currentAssetSet = new Set(sourceAssetFiles.map((file) => path.resolve(file)));
      const cleanupArtifact = cleanupAfterPublish({
        distributedFolders: current.shopDistributionArtifact?.distributedFolders || [],
        titleWorkbookFiles: current.titleSheetArtifact?.generatedFiles.map((item) => item.workbookFile) || [],
        wordFiles: current.deepseekArtifact?.wordFiles || [],
        sourceImagePath: current.sourceImagePath,
        sourceAssetFiles,
        taskRuntimeDir,
        publishRuntimeDirs,
        feishuImageDir: path.dirname(current.sourceImagePath),
        qualificationDir,
        shopRootDir,
        autoListingInputDir: path.dirname(path.dirname(current.sourceImagePath)),
        titleDir,
        mainImageWorkDir: mainImageWorkDir,
        protectedAssetFiles: protectedCleanupAssetFiles.filter((file) => !currentAssetSet.has(path.resolve(file))),
        cleanupAfterPublish: cleanupAfterPublishEnabled,
        cleanupSourceImageAfterPublish,
        simulateOnly
      });
      cleanupArtifact.archivedFiles = archivedFiles;
      current = {
        ...current,
        status: step,
        cleanupArtifact,
        lastUpdatedAt: new Date().toISOString(),
        notes: [...current.notes, `Archived ${archivedFiles.length} unwatermarked main image(s).`, `Cleanup recorded for ${cleanupArtifact.removedPaths.length} path(s).`]
      };
      appendEvent(
        eventFile,
        createEvent("info", step, `Cleanup complete: ${cleanupArtifact.removedPaths.length}`, current.taskId)
      );
      markProgress();
      continue;
    }

    const message = step === "done" ? "Task chain completed." : `Step recorded for ${step}.`;
    appendEvent(eventFile, createEvent("info", step, message, current.taskId));
    current = {
      ...current,
      status: step,
      lastUpdatedAt: new Date().toISOString(),
      finishedAt: step === "done" ? new Date().toISOString() : current.finishedAt,
      notes: [...current.notes, message]
    };
    markProgress();
    } catch (error) {
      if (error instanceof AutoListingPausedError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new AutoListingStepError(step, message, error);
    }
  }
  return current;
}

export async function runAutoListingJob(jobFile: AutoListingJobFile): Promise<AutoListingRunResult> {
  assertRuleTextIntegrity();
  const resolved = resolveAutoListingJob(jobFile);
  const runId = path.basename(resolved.runtimeDir);
  const startedAt = new Date().toISOString();
  const logFile = path.join(resolved.runtimeDir, "logs", "run.log");
  const feishuBatchFingerprint =
    resolved.input.feishuProductDataFile && fs.existsSync(resolved.input.feishuProductDataFile)
      ? buildFeishuBatchFingerprint(loadFeishuProductRecords(resolved.input.feishuProductDataFile))
      : undefined;
  const feishuProductRecords =
    resolved.input.feishuProductDataFile && fs.existsSync(resolved.input.feishuProductDataFile)
      ? loadFeishuProductRecords(resolved.input.feishuProductDataFile)
      : [];
  if (
    resolved.input.resumeSourceImagePath &&
    !canResumeFeishuBatchArtifacts({
      currentBatchFingerprint: feishuBatchFingerprint,
      resumeBatchFingerprint: resolved.input.feishuBatchFingerprint
    })
  ) {
    throw new Error("Resume job Feishu batch fingerprint is missing or does not match the current Feishu batch.");
  }
  const discoveredImages =
    resolved.input.resumeSourceImagePath
      ? [resolved.input.resumeSourceImagePath]
      : resolved.input.feishuProductDataFile
        ? resolvePendingFeishuProductSourceImagesFromRecords({
            records: feishuProductRecords,
            processedImages: readProcessedImages(resolved.processedImageManifest, feishuBatchFingerprint),
            maxImagesPerRun: resolved.input.maxImagesPerRun
          })
        : discoverPendingImages(
            resolved.input.feishuImageDir,
            resolved.input.imageExtensions,
            resolved.processedImageManifest,
            resolved.input.maxImagesPerRun,
            feishuBatchFingerprint
          );
  const resumeFilteredDiscoveredImages = filterResumeSourceImage(discoveredImages, resolved.input.resumeSourceImagePath);
  const shouldAllowRecoveredTask = resolved.input.startStep !== "source_images_discovered";
  const effectiveImages =
    resumeFilteredDiscoveredImages.length > 0
      ? resumeFilteredDiscoveredImages
      : shouldAllowRecoveredTask
        ? filterResumeSourceImage(
            discoverFallbackImages(
              resolved.input.feishuImageDir,
              resolved.input.imageExtensions,
              resolved.input.maxImagesPerRun
            ),
            resolved.input.resumeSourceImagePath
          )
        : [];

  const result: AutoListingRunResult = {
    ok: false,
    runId,
    feishuBatchFingerprint,
    startedAt,
    finishedAt: startedAt,
    runtimeDir: resolved.runtimeDir,
    artifacts: {
      resultFile: resolved.resultFile,
      stateFile: resolved.stateFile,
      eventFile: resolved.eventFile,
      manualsReadFile: resolved.manualsReadFile,
      processedImageManifest: resolved.processedImageManifest,
      preflightFile: resolved.preflightFile,
      pauseSignalFile: resolved.pauseSignalFile
    },
    discoveredImages: effectiveImages,
    tasks: [],
    manualsRead: []
  };

  const state: AutoListingRunState = {
    ...applyResumeTaskId(createRunState(runId, effectiveImages), resolved.input.resumeTaskId),
    feishuBatchFingerprint
  };
  result.tasks = state.tasks;
  const manualReadMap = new Map<string, ManualReadRecord>();

  setLogFile(logFile);

  try {
    const preflight = buildAutoListingPreflightSummary(resolved);
    writeJson(resolved.preflightFile, preflight);
    if (preflight.errors.length > 0) {
      throw new Error(`Auto-listing preflight failed: ${preflight.errors.join(" ")}`);
    }

    const shouldCleanupStaleRunHistory =
      !resolved.input.simulateOnly &&
      resolved.input.cleanupAfterPublish &&
      !resolved.input.resumeSourceImagePath &&
      resolved.input.startStep === "source_images_discovered";
    const staleRunHistoryCleanup = cleanupStaleRunHistory({
      runtimeRootDir: path.dirname(resolved.runtimeDir),
      activeRuntimeDir: resolved.runtimeDir,
      cleanupAfterPublish: shouldCleanupStaleRunHistory,
      simulateOnly: resolved.input.simulateOnly
    });
    if (staleRunHistoryCleanup.removedPaths.length > 0) {
      appendEvent(
        resolved.eventFile,
        createEvent("info", "pre_run_cleanup", `Cleared ${staleRunHistoryCleanup.removedPaths.length} stale run history dir(s).`)
      );
      logInfo(`pre-run cleanup removed ${staleRunHistoryCleanup.removedPaths.length} stale run history dir(s)`);
    }

    const preRunRemoved = prepareTestRunOutputs({
      runtimeDir: resolved.runtimeDir,
      mainImageWorkDir: resolved.input.mainImageWorkDir,
      titleDir: resolved.input.titleDir,
      shopRootDir: resolved.input.shopRootDir,
      enabled: resolved.input.clearTestOutputsBeforeRun,
      simulateOnly: resolved.input.simulateOnly
    });

    if (preRunRemoved.length > 0) {
      appendEvent(
        resolved.eventFile,
        createEvent("info", "pre_run_cleanup", `Cleared ${preRunRemoved.length} stale test output path(s).`)
      );
      logInfo(`pre-run cleanup removed ${preRunRemoved.length} path(s)`);
    }

    writeJson(
      resolved.manualsReadFile,
      {
        runId,
        updatedAt: new Date().toISOString(),
        manuals: manualReadSummary(manualReadMap)
      }
    );

    persistState(resolved.stateFile, state);
    appendEvent(
      resolved.eventFile,
      createEvent(
        "info",
        "run_started",
        `Discovered ${effectiveImages.length} image(s) for this run. simulateOnly=${String(resolved.input.simulateOnly)}`
      )
    );
    logInfo(`auto-listing run started: ${runId}`);

    if (effectiveImages.length === 0) {
      const completed = markRunCompleted(state);
      persistState(resolved.stateFile, completed);
      result.ok = true;
      result.finishedAt = new Date().toISOString();
      writeJson(resolved.resultFile, result);
      logInfo("no pending images found");
      return result;
    }

    if (resumeFilteredDiscoveredImages.length === 0 && effectiveImages.length > 0) {
      appendEvent(
        resolved.eventFile,
        createEvent(
          "info",
          "resume",
          `No pending images found; reusing ${effectiveImages.length} existing image(s) for startStep=${resolved.input.startStep}.`
        )
      );
      logInfo(`reusing existing image(s) for resumed run: ${effectiveImages.join(" | ")}`);
    }

    if (
      shouldPreflightDoudianPublishSession({
        simulateOnly: resolved.input.simulateOnly,
        startStep: resolved.input.startStep,
        endStep: resolved.input.endStep
      })
    ) {
      appendEvent(
        resolved.eventFile,
        createEvent("info", "preflight", "Checking Doudian login preflight before paid image generation.")
      );
      logInfo("checking Doudian login preflight before paid image generation");
      await assertDoudianPublishSessionReady({
        runtimeDir: path.join(resolved.runtimeDir, "preflight"),
        label: "doudian-publish-session-preflight",
        timeoutMs: 30000
      });
      appendEvent(
        resolved.eventFile,
        createEvent("info", "preflight", "Doudian login preflight is ready.")
      );
    }

    let workingState = state;
    const protectedCleanupAssetFiles = collectProtectedCleanupAssetFiles(resolved.input.feishuProductDataFile);
    for (const task of workingState.tasks) {
      workingState = {
        ...workingState,
        currentTaskId: task.taskId,
        lastUpdatedAt: new Date().toISOString()
      };
      persistState(resolved.stateFile, workingState);
      appendEvent(
        resolved.eventFile,
        createEvent("info", "task_started", `Starting task for ${task.sourceImageName}`, task.taskId)
      );

      try {
        assertNotPaused(resolved.pauseSignalFile, task.taskId, "task_started");
        const completedTask = await executeTaskChain(
          task,
          resolved.runtimeDir,
          resolved.input.mainImageWorkDir,
          resolved.input.titleDir,
          resolved.input.titleCount,
          resolved.input.qualificationDir,
          resolved.input.productInfoXlsx,
          resolved.input.productInfoKeyMapFile,
          resolved.input.feishuProductDataFile,
          resolved.input.shopRootDir,
          resolved.input.imageGenerationProvider,
          resolved.input.imageGenerationConfigFile,
          resolved.input.mainImageExpectedCount,
          resolved.input.mainImageCountStrategy,
          resolved.input.cleanupAfterPublish,
          resolved.input.cleanupSourceImageAfterPublish,
          resolved.input.archiveMainImageDir,
          resolved.input.startStep,
          resolved.input.endStep,
          resolved.eventFile,
          resolved.pauseSignalFile,
          resolved.input.paidImageSubmissionLedgerDir,
          resolved.input.simulateOnly,
          feishuBatchFingerprint,
          resolved.input.resumeProductFolderNames,
          protectedCleanupAssetFiles,
          manualReadMap,
          (updatedTask) => {
            workingState = {
              ...workingState,
              tasks: workingState.tasks.map((item) => (item.taskId === updatedTask.taskId ? updatedTask : item)),
              lastUpdatedAt: new Date().toISOString()
            };
            persistState(resolved.stateFile, workingState);
            writeJson(
              resolved.manualsReadFile,
              {
                runId,
                updatedAt: new Date().toISOString(),
                manuals: manualReadSummary(manualReadMap)
              }
            );
          }
        );
        workingState = {
          ...workingState,
          tasks: workingState.tasks.map((item) => (item.taskId === task.taskId ? completedTask : item)),
          lastUpdatedAt: new Date().toISOString()
        };
        persistState(resolved.stateFile, workingState);
        const publishManifest = loadPublishManifest(resolved.runtimeDir);
        if (
          !resolved.input.simulateOnly &&
          isProductFullyProcessed({
            task: completedTask,
            publishManifestEntries: publishManifest.entries,
            productIdentity: buildPublishProductIdentity(completedTask, feishuBatchFingerprint)
          })
        ) {
          appendProcessedImages(resolved.processedImageManifest, [task.sourceImagePath], feishuBatchFingerprint);
          if (feishuBatchFingerprint && completedTask.feishuProductRecord?.recordId) {
            removePaidImageProductLedger(
              resolved.input.paidImageSubmissionLedgerDir,
              feishuBatchFingerprint,
              completedTask.feishuProductRecord.recordId
            );
          }
        }
        writeJson(
          resolved.manualsReadFile,
          {
            runId,
            updatedAt: new Date().toISOString(),
            manuals: manualReadSummary(manualReadMap)
          }
        );
        logInfo(`task completed: ${task.sourceImageName}`);
      } catch (error) {
        if (error instanceof AutoListingPausedError) {
          const pausedState = markRunPaused(workingState);
          persistState(resolved.stateFile, pausedState);
          appendEvent(
            resolved.eventFile,
            createEvent(
              "info",
              error.step || "pause",
              `Pause requested. State persisted; remove ${error.signalFile} before resuming.`,
              error.taskId
            )
          );
          result.ok = false;
          result.finishedAt = new Date().toISOString();
          result.tasks = pausedState.tasks;
          result.manualsRead = manualReadSummary(manualReadMap);
          result.error = {
            message: error.message
          };
          writeJson(
            resolved.manualsReadFile,
            {
              runId,
              updatedAt: new Date().toISOString(),
              manuals: result.manualsRead
            }
          );
          writeJson(resolved.resultFile, result);
          logInfo(`auto-listing paused: ${runId}`);
          return result;
        }
        const failedStep = error instanceof AutoListingStepError ? error.step : "task_execution";
        const message = error instanceof Error ? error.message : String(error);
        const latestTaskState = workingState.tasks.find((item) => item.taskId === task.taskId) || task;
        const failedTask = failTask(latestTaskState, failedStep, message);
        const taskError: AutoListingTaskError = {
          step: failedStep,
          message,
          capturedAt: failedTask.error?.capturedAt || new Date().toISOString()
        };
        workingState = markRunFailed(
          {
            ...workingState,
            tasks: workingState.tasks.map((item) => (item.taskId === task.taskId ? failedTask : item))
          },
          taskError
        );
        persistState(resolved.stateFile, workingState);
        writeJson(
          resolved.manualsReadFile,
          {
            runId,
            updatedAt: new Date().toISOString(),
            manuals: manualReadSummary(manualReadMap)
          }
        );
        appendEvent(resolved.eventFile, createEvent("error", "task_failed", message, task.taskId));
        logError(`task failed: ${task.sourceImageName} - ${message}`);
        result.tasks = workingState.tasks;
        result.manualsRead = manualReadSummary(manualReadMap);
        if (resolved.input.stopOnError) {
          throw error;
        }
      }
    }

    const failedTasks = workingState.tasks.filter((task) => task.status === "failed");
    if (failedTasks.length > 0) {
      const failedState = markRunFailed(workingState, {
        step: "run_completed_with_failed_tasks",
        message: `${failedTasks.length} task(s) failed before run completion.`,
        capturedAt: new Date().toISOString()
      });
      persistState(resolved.stateFile, failedState);
      result.ok = false;
      result.finishedAt = new Date().toISOString();
      result.tasks = failedState.tasks;
      result.manualsRead = manualReadSummary(manualReadMap);
      result.error = {
        message: `${failedTasks.length} task(s) failed.`
      };
      writeJson(
        resolved.manualsReadFile,
        {
          runId,
          updatedAt: new Date().toISOString(),
          manuals: result.manualsRead
        }
      );
      writeJson(resolved.resultFile, result);
      return result;
    }

    const completed = markRunCompleted(workingState);
    persistState(resolved.stateFile, completed);

    result.ok = true;
    result.finishedAt = new Date().toISOString();
    result.tasks = completed.tasks;
    result.manualsRead = manualReadSummary(manualReadMap);
    writeJson(
      resolved.manualsReadFile,
      {
        runId,
        updatedAt: new Date().toISOString(),
        manuals: result.manualsRead
      }
    );
    writeJson(resolved.resultFile, result);
    logInfo(`auto-listing run finished: ${runId}`);
    return result;
  } catch (error) {
    if (error instanceof AutoListingPausedError) {
      const paused = markRunPaused(state);
      persistState(resolved.stateFile, paused);
      appendEvent(
        resolved.eventFile,
        createEvent("info", error.step || "pause", `Pause requested. Remove ${error.signalFile} before resuming.`, error.taskId)
      );
      result.finishedAt = new Date().toISOString();
      result.tasks = paused.tasks;
      result.error = {
        message: error.message
      };
      writeJson(resolved.resultFile, result);
      return result;
    }
    result.finishedAt = new Date().toISOString();
    result.error = {
      message: error instanceof Error ? error.message : String(error)
    };
    result.manualsRead = manualReadSummary(manualReadMap);
    writeJson(
      resolved.manualsReadFile,
      {
        runId,
        updatedAt: new Date().toISOString(),
        manuals: result.manualsRead
      }
    );
    writeJson(resolved.resultFile, result);
    return result;
  } finally {
    setLogFile(undefined);
  }
}
