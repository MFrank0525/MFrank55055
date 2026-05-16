import fs from "node:fs";
import path from "node:path";
import { generatePosterPromptsWithDeepSeek } from "./deepseek-prompts.js";
import { writeDeepSeekPromptWordFiles } from "./deepseek-word-docs.js";
import { generateSellingPointsWithDoubao } from "./doubao-selling-points.js";
import { generateJimengAssets } from "./jimeng-assets.js";
import { appendProcessedImages, discoverPendingImages } from "./file-batch.js";
import { loadFeishuProductRuntimeRecord } from "./feishu-products.js";
import { enrichDistributedTitleSheets } from "./metadata.js";
import { cleanupAfterPublish } from "./cleanup.js";
import { buildAutoListingPreflightSummary } from "./preflight.js";
import { readOperationManual } from "./operation-manual.js";
import { prepareTestRunOutputs } from "./prepare-test-run.js";
import { publishDistributedProducts } from "./publish.js";
import { attachQualificationFiles } from "./qualifications.js";
import { recoverArtifactsFromWordFiles, recoverDistributedFoldersFromShopRoot } from "./resume.js";
import { distributeProductFoldersToShops } from "./shop-distribution.js";
import { distributeTitleSheets, generateTitleSheets } from "./title-sheets.js";
import { resolveAutoListingJob } from "./config.js";
import { assertRuleTextIntegrity } from "./rule-text.js";
import { createEvent, createRunState, failTask, getPlannedSteps, markRunCompleted, markRunFailed } from "./state-machine.js";
import { logError, logInfo, setLogFile } from "../utils/logger.js";
import type {
  AutoListingEvent,
  AutoListingJobFile,
  AutoListingRunResult,
  AutoListingRunState,
  AutoListingTaskError,
  ImageTaskState
} from "./types.js";

interface ManualReadRecord {
  step: string;
  filePath: string;
  readCount: number;
  firstReadAt: string;
  lastReadAt: string;
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

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function appendEvent(filePath: string, event: AutoListingEvent): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(event)}\n`, "utf8");
}

function persistState(stateFile: string, state: AutoListingRunState): void {
  writeJson(stateFile, state);
}

async function executeTaskChain(
  task: ImageTaskState,
  runtimeDir: string,
  jimengImageDir: string,
  titleDir: string,
  titleCount: number,
  qualificationDir: string,
  productInfoXlsx: string,
  productInfoKeyMapFile: string,
  feishuProductDataFile: string,
  shopRootDir: string,
  deepseekConversationUrl: string,
  dreaminaBin: string,
  dreaminaPollSeconds: number,
  dreaminaModelVersion: string,
  dreaminaResolutionType: string,
  dreaminaRatio: string,
  dreaminaExpectedImageCount: number,
  dreaminaImageCountStrategy: "accept_all" | "require_exact" | "limit_to_count",
  cleanupAfterPublishEnabled: boolean,
  cleanupSourceImageAfterPublish: boolean,
  startStep: string,
  endStep: string,
  eventFile: string,
  simulateOnly: boolean,
  manualReadMap: Map<string, ManualReadRecord>
): Promise<ImageTaskState> {
  let current = task;
  const allSteps = getPlannedSteps();
  const startIndex = startStep === "discovered" ? 1 : Math.max(1, allSteps.indexOf(startStep as (typeof allSteps)[number]));
  const endIndex = Math.max(startIndex, allSteps.indexOf(endStep as (typeof allSteps)[number]));

  if (
    startIndex >= allSteps.indexOf("jimeng_generated") &&
    (!current.sellingPointArtifact?.sellingPointText || !current.deepseekArtifact?.wordFiles?.length)
  ) {
    const recovered = recoverArtifactsFromWordFiles({
      runtimeDir,
      taskId: current.taskId,
      jimengImageDir
    });
    current = {
      ...current,
      sellingPointArtifact: current.sellingPointArtifact || recovered.sellingPointArtifact,
      deepseekArtifact: current.deepseekArtifact || recovered.deepseekArtifact,
      lastUpdatedAt: new Date().toISOString(),
      notes: [...current.notes, "Recovered selling points and DeepSeek prompts from saved Word files."]
    };
    appendEvent(
      eventFile,
      createEvent("info", "resume", "Recovered selling points and DeepSeek prompts from saved Word files.", current.taskId)
    );
  }

  if (startIndex >= allSteps.indexOf("published") && !current.shopDistributionArtifact?.distributedFolders?.length) {
    const recovered = recoverDistributedFoldersFromShopRoot({
      shopRootDir
    });
    current = {
      ...current,
      generatedProductFolders: current.generatedProductFolders.length
        ? current.generatedProductFolders
        : recovered.generatedProductFolders,
      shopDistributionArtifact: current.shopDistributionArtifact || recovered.shopDistributionArtifact,
      lastUpdatedAt: new Date().toISOString(),
      notes: [...current.notes, "Recovered distributed product folders from shop root directory."]
    };
    appendEvent(
      eventFile,
      createEvent("info", "resume", "Recovered distributed product folders from shop root directory.", current.taskId)
    );
  }

  for (const step of allSteps.slice(startIndex, endIndex + 1)) {
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

    if (step === "doubao_generated") {
      if (feishuProductDataFile) {
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
            `Feishu product data loaded: record=${feishuRuntimeRecord.record.recordId}; spu=${feishuRuntimeRecord.record.spu}.`
          ]
        };
        appendEvent(
          eventFile,
          createEvent(
            "info",
            step,
            `Feishu selling points loaded: ${feishuRuntimeRecord.sellingPointArtifact.sellingPointText}`,
            current.taskId
          )
        );
        continue;
      }

      appendEvent(eventFile, createEvent("info", step, "Starting Doubao selling point generation.", current.taskId));
      const sellingPointArtifact = await generateSellingPointsWithDoubao({
        runtimeDir,
        taskId: current.taskId,
        imagePath: current.sourceImagePath,
        imageName: current.sourceImageName,
        simulateOnly
      });
      current = {
        ...current,
        status: step,
        sellingPointArtifact,
        lastUpdatedAt: new Date().toISOString(),
        notes: [...current.notes, `Doubao selling points generated with ${sellingPointArtifact.segmentCount} segments.`]
      };
      appendEvent(
        eventFile,
        createEvent("info", step, `Doubao selling points captured: ${sellingPointArtifact.sellingPointText}`, current.taskId)
      );
      continue;
    }

    if (step === "deepseek_generated") {
      if (!current.sellingPointArtifact?.sellingPointText) {
        throw new Error("DeepSeek step requires Doubao selling points.");
      }
      appendEvent(eventFile, createEvent("info", step, "Starting DeepSeek poster prompt generation.", current.taskId));
      const deepseekArtifact = await generatePosterPromptsWithDeepSeek({
        runtimeDir,
        taskId: current.taskId,
        sellingPointText: current.sellingPointArtifact.sellingPointText,
        conversationUrl: deepseekConversationUrl,
        simulateOnly
      });
      deepseekArtifact.wordFiles = writeDeepSeekPromptWordFiles({
        jimengImageDir,
        sellingPointText: current.sellingPointArtifact.sellingPointText,
        brand: current.sellingPointArtifact.brand,
        userCognitionName: current.sellingPointArtifact.userCognitionName,
        brandedGenericName: current.sellingPointArtifact.brandedGenericName,
        prompts: deepseekArtifact.prompts
      });
      current = {
        ...current,
        status: step,
        deepseekArtifact,
        lastUpdatedAt: new Date().toISOString(),
        notes: [
          ...current.notes,
          `DeepSeek generated ${deepseekArtifact.prompts.length} poster prompt paragraphs.`,
          `DeepSeek prompt Word files generated: ${deepseekArtifact.wordFiles?.length || 0}.`
        ]
      };
      appendEvent(
        eventFile,
        createEvent(
          "info",
          step,
          `DeepSeek prompts ready: ${deepseekArtifact.prompts.join(" | ")}; wordFiles=${deepseekArtifact.wordFiles?.length || 0}`,
          current.taskId
        )
      );
      continue;
    }

    if (step === "jimeng_generated") {
      if (!current.sellingPointArtifact?.sellingPointText || !current.deepseekArtifact?.prompts?.length) {
        throw new Error("Jimeng step requires Doubao selling points and DeepSeek prompts.");
      }
      appendEvent(eventFile, createEvent("info", step, "Starting Jimeng asset generation.", current.taskId));
      const jimengArtifact = await generateJimengAssets({
        runtimeDir,
        taskId: current.taskId,
        shopRootDir,
        sourceImagePath: current.sourceImagePath,
        sellingPointText: current.sellingPointArtifact.sellingPointText,
        brandedGenericName: current.sellingPointArtifact.brandedGenericName,
        wordFiles: current.deepseekArtifact.wordFiles || [],
        dreaminaBin,
        dreaminaPollSeconds,
        dreaminaModelVersion,
        dreaminaResolutionType,
        dreaminaRatio,
        dreaminaExpectedImageCount,
        dreaminaImageCountStrategy,
        simulateOnly
      });
      current = {
        ...current,
        status: step,
        jimengArtifact,
        lastUpdatedAt: new Date().toISOString(),
        notes: [...current.notes, `Jimeng generated ${jimengArtifact.generatedFiles.length} image placeholder(s).`]
      };
      appendEvent(
        eventFile,
        createEvent("info", step, `Jimeng assets ready: ${jimengArtifact.generatedFiles.length} file(s).`, current.taskId)
      );
      continue;
    }

    if (step === "product_folders_built") {
      if (!current.jimengArtifact?.generatedFiles?.length) {
        throw new Error("Product folder step requires Jimeng generated files.");
      }
      current = {
        ...current,
        status: step,
        generatedProductFolders: current.jimengArtifact.generatedFiles.map((item) => item.productFolder),
        lastUpdatedAt: new Date().toISOString(),
        notes: [...current.notes, `Built ${current.jimengArtifact.generatedFiles.length} product folder(s).`]
      };
      appendEvent(
        eventFile,
        createEvent("info", step, `Product folders ready: ${current.generatedProductFolders.join(" | ")}`, current.taskId)
      );
      continue;
    }

    if (step === "titles_generated") {
      if (!current.sellingPointArtifact?.sellingPointText) {
        throw new Error("Title generation requires Doubao selling points.");
      }
      const titleSheetArtifact = await generateTitleSheets({
        titleDir,
        sourceImagePath: current.sourceImagePath,
        sellingPointText: current.sellingPointArtifact.sellingPointText,
        titleCount,
        simulateOnly,
        runtimeDir
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
      continue;
    }

    if (step === "titles_distributed") {
      if (!current.titleSheetArtifact?.generatedFiles?.length || !current.generatedProductFolders.length) {
        throw new Error("Title distribution requires generated title sheets and product folders.");
      }
      const distributedArtifact = distributeTitleSheets(current.generatedProductFolders, current.titleSheetArtifact.generatedFiles);
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
      continue;
    }

    if (step === "metadata_enriched") {
      if (!current.titleSheetArtifact?.generatedFiles?.length || !current.sellingPointArtifact?.sellingPointText) {
        throw new Error("Metadata enrichment requires distributed title sheets and Doubao selling points.");
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
      continue;
    }

    if (step === "qualifications_attached") {
      if (!current.generatedProductFolders.length || !current.sellingPointArtifact?.sellingPointText) {
        throw new Error("Qualification attachment requires product folders and Doubao selling points.");
      }
      const qualificationArtifact = attachQualificationFiles({
        qualificationDir,
        productFolders: current.generatedProductFolders,
        sellingPointText: current.sellingPointArtifact.sellingPointText,
        productName: current.feishuProductRecord?.userCognitionName || current.sellingPointArtifact.brandedGenericName,
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
      continue;
    }

    if (step === "published") {
      if (!current.shopDistributionArtifact?.distributedFolders?.length) {
        throw new Error("Publish step requires distributed shop folders.");
      }
      const publishArtifact = await publishDistributedProducts({
        runtimeDir,
        distributedFolders: current.shopDistributionArtifact.distributedFolders,
        simulateOnly
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
      continue;
    }

    if (step === "cleaned") {
      const taskRuntimeDir = path.join(runtimeDir, "tasks", current.taskId);
      const publishRuntimeDirs =
        current.shopDistributionArtifact?.distributedFolders?.map((folder) =>
          path.join(runtimeDir, "publish", path.basename(folder))
        ) || [];
      const cleanupArtifact = cleanupAfterPublish({
        distributedFolders: current.shopDistributionArtifact?.distributedFolders || [],
        titleWorkbookFiles: current.titleSheetArtifact?.generatedFiles.map((item) => item.workbookFile) || [],
        wordFiles: current.deepseekArtifact?.wordFiles || [],
        sourceImagePath: current.sourceImagePath,
        taskRuntimeDir,
        publishRuntimeDirs,
        titleDir,
        jimengImageDir,
        cleanupAfterPublish: cleanupAfterPublishEnabled,
        cleanupSourceImageAfterPublish,
        simulateOnly
      });
      current = {
        ...current,
        status: step,
        cleanupArtifact,
        lastUpdatedAt: new Date().toISOString(),
        notes: [...current.notes, `Cleanup recorded for ${cleanupArtifact.removedPaths.length} path(s).`]
      };
      appendEvent(
        eventFile,
        createEvent("info", step, `Cleanup complete: ${cleanupArtifact.removedPaths.length}`, current.taskId)
      );
      continue;
    }

    const message =
      step === "done"
        ? "Task chain scaffold completed. Downstream modules are still placeholders."
        : `Placeholder step recorded for ${step}.`;
    appendEvent(eventFile, createEvent("info", step, message, current.taskId));
    current = {
      ...current,
      status: step,
      lastUpdatedAt: new Date().toISOString(),
      finishedAt: step === "done" ? new Date().toISOString() : current.finishedAt,
      notes: [...current.notes, message]
    };
  }
  return current;
}

export async function runAutoListingJob(jobFile: AutoListingJobFile): Promise<AutoListingRunResult> {
  assertRuleTextIntegrity();
  const resolved = resolveAutoListingJob(jobFile);
  const runId = path.basename(resolved.runtimeDir);
  const startedAt = new Date().toISOString();
  const logFile = path.join(resolved.runtimeDir, "logs", "run.log");
  const discoveredImages = discoverPendingImages(
    resolved.input.feishuImageDir,
    resolved.input.imageExtensions,
    resolved.processedImageManifest,
    resolved.input.maxImagesPerRun
  );
  const shouldAllowRecoveredTask = resolved.input.startStep !== "discovered";
  const effectiveImages =
    discoveredImages.length > 0
      ? discoveredImages
      : shouldAllowRecoveredTask
        ? discoverFallbackImages(
            resolved.input.feishuImageDir,
            resolved.input.imageExtensions,
            resolved.input.maxImagesPerRun
          )
        : [];

  const result: AutoListingRunResult = {
    ok: false,
    runId,
    startedAt,
    finishedAt: startedAt,
    runtimeDir: resolved.runtimeDir,
    artifacts: {
      resultFile: resolved.resultFile,
      stateFile: resolved.stateFile,
      eventFile: resolved.eventFile,
      manualsReadFile: resolved.manualsReadFile,
      processedImageManifest: resolved.processedImageManifest,
      preflightFile: resolved.preflightFile
    },
    discoveredImages: effectiveImages,
    tasks: [],
    manualsRead: []
  };

  const state = createRunState(runId, effectiveImages);
  result.tasks = state.tasks;
  const manualReadMap = new Map<string, ManualReadRecord>();

  setLogFile(logFile);

  try {
    writeJson(resolved.preflightFile, buildAutoListingPreflightSummary(resolved));

    const preRunRemoved = prepareTestRunOutputs({
      runtimeDir: resolved.runtimeDir,
      jimengImageDir: resolved.input.jimengImageDir,
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

    if (discoveredImages.length === 0 && effectiveImages.length > 0) {
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

    let workingState = state;
    const processedThisRun: string[] = [];

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
        const completedTask = await executeTaskChain(
          task,
          resolved.runtimeDir,
          resolved.input.jimengImageDir,
          resolved.input.titleDir,
          resolved.input.titleCount,
          resolved.input.qualificationDir,
          resolved.input.productInfoXlsx,
          resolved.input.productInfoKeyMapFile,
          resolved.input.feishuProductDataFile,
          resolved.input.shopRootDir,
          resolved.input.deepseekConversationUrl,
          resolved.input.dreaminaBin,
          resolved.input.dreaminaPollSeconds,
          resolved.input.dreaminaModelVersion,
          resolved.input.dreaminaResolutionType,
          resolved.input.dreaminaRatio,
          resolved.input.dreaminaExpectedImageCount,
          resolved.input.dreaminaImageCountStrategy,
          resolved.input.cleanupAfterPublish,
          resolved.input.cleanupSourceImageAfterPublish,
          resolved.input.startStep,
          resolved.input.endStep,
          resolved.eventFile,
          resolved.input.simulateOnly,
          manualReadMap
        );
        workingState = {
          ...workingState,
          tasks: workingState.tasks.map((item) => (item.taskId === task.taskId ? completedTask : item)),
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
        processedThisRun.push(task.sourceImagePath);
        logInfo(`task completed: ${task.sourceImageName}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const failedTask = failTask(task, "task_execution", message);
        const taskError: AutoListingTaskError = {
          step: "task_execution",
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
        if (resolved.input.stopOnError) {
          throw error;
        }
      }
    }

    const completed = markRunCompleted(workingState);
    persistState(resolved.stateFile, completed);
    if (!resolved.input.simulateOnly) {
      appendProcessedImages(resolved.processedImageManifest, processedThisRun);
    }

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
    result.finishedAt = new Date().toISOString();
    result.error = {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
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
