import fs from "node:fs";
import path from "node:path";
import { sanitizeFileName } from "../utils/path-names.js";
import { readImageDimensions } from "../utils/image-dimensions.js";
import { readSimpleWordDocument } from "./docx-lite.js";
import {
  resolveMissingFixedImageIndexes,
  resolvePaidImageLedgerFailureDisposition,
  resolveVideosBase64SubmitConcurrency
} from "./image-generation-rules.js";
import { applyLocalWatermark } from "./local-watermark.js";
import { ensureSquareMainImageFile } from "./main-image-square-action.js";
import { evaluateMainImageSquareRule } from "./main-image-shape-rules.js";
import { isFullyDecodableImageFile } from "../utils/image-integrity.js";
import {
  paidImageProductLedgerDir,
  summarizePaidImageProductLedger
} from "./paid-image-submission-ledger.js";
import { resolveMainImageShopAssignments, shopCodeFromFolder } from "./product-category.js";
import type { ImageGenerationProvider, MainImageArtifact, MainImageCountStrategy, MainImageGeneratedFile } from "./types.js";
import { requireOpenAiCompatibleImageProvider } from "./image-generation-provider.js";

export * from "./main-image-provider-action.js";
import {
  ensureTaskDir,
  writePromptSummary,
  listImageFiles,
  listImageFilesRecursive,
  filterShopFoldersByCodes,
  resolveShopFolders,
  shopFolderByCode,
  generateWithOpenAiCompatibleProvider,
  inferBrandedGenericName,
  readOpenAiCompatibleImageConfig,
  createConcurrencyGate,
  buildImageEditPromptFromWord,
  summarizeVideosBase64PaidResumePlan,
  formatSlotList,
  settleConcurrentWork,
  normalizeImageGenerationError
} from "./main-image-provider-action.js";

function moveFile(sourceFile: string, targetFile: string): void {
  fs.mkdirSync(path.dirname(targetFile), { recursive: true });
  try {
    fs.renameSync(sourceFile, targetFile);
  } catch {
    fs.copyFileSync(sourceFile, targetFile);
    fs.rmSync(sourceFile, { force: true });
  }
}

function buildStagedImageFile(
  stageDir: string,
  productName: string,
  watermarkText: string,
  imageIndex: number,
  sourceFile: string
): string {
  const ext = path.extname(sourceFile) || ".png";
  const baseName = sanitizeFileName(productName + watermarkText + String(imageIndex).padStart(2, "0"));
  return path.join(stageDir, baseName + ext);
}

function buildProductFolder(shopFolder: string, productName: string, recordIdentity: string, imageIndex: number): string {
  return path.join(
    shopFolder,
    sanitizeFileName(`${productName}-${recordIdentity}-水印${String(imageIndex).padStart(2, "0")}`)
  );
}

function stageWatermarkedFile(options: {
  stageDir: string;
  productName: string;
  watermarkText: string;
  imageIndex: number;
  watermarkedFile: string;
}): string {
  const stagedFile = buildStagedImageFile(
    options.stageDir,
    options.productName,
    options.watermarkText,
    options.imageIndex,
    options.watermarkedFile
  );
  if (fs.existsSync(stagedFile)) {
    fs.rmSync(stagedFile, { force: true });
  }
  moveFile(options.watermarkedFile, stagedFile);
  return stagedFile;
}

async function recoverExistingRoundOutputs(options: {
  roundDir: string;
  stageDir: string;
  productName: string;
  resolveWatermarkText: (imageIndex: number) => string;
  startImageIndex: number;
}): Promise<
  Array<{
    stagedFile: string;
    rawImageFile?: string;
    imageIndex: number;
  }>
> {
  const recovered: Array<{
    stagedFile: string;
    rawImageFile?: string;
    imageIndex: number;
  }> = [];

  const startImageIndex = options.startImageIndex;
  const rawCandidates = listImageFilesRecursive(options.roundDir).filter(
    (file) => file.includes(path.sep + "raw" + path.sep) && isFullyDecodableImageFile(file)
  );
  const rawByLocalIndex = new Map(
    rawCandidates.flatMap((file) => {
      const match = /^generated-(\d+)/i.exec(path.basename(file));
      return match ? [[Number(match[1]), file] as const] : [];
    })
  );
  const normalizedRawIndexes = new Set<number>();
  for (const [localIndex, rawImageFile] of rawByLocalIndex) {
    const normalization = await ensureSquareMainImageFile({
      sourceFile: rawImageFile,
      evidenceDir: path.join(options.roundDir, "provider-original")
    });
    if (normalization.changed) {
      normalizedRawIndexes.add(localIndex);
    }
  }
  const existingStagedFiles = listImageFiles(options.stageDir);
  let invalidStagedFileFound = false;
  for (const stagedFile of existingStagedFiles) {
    const globalIndexMatch = /(\d+)(?=\.[^.]+$)/.exec(path.basename(stagedFile));
    const imageIndex = Number(globalIndexMatch?.[1]);
    const localIndex = imageIndex - startImageIndex + 1;
    const rawImageFile = rawByLocalIndex.get(localIndex);
    const expectedWatermarkText = Number.isInteger(imageIndex) ? options.resolveWatermarkText(imageIndex) : "";
    const stagedShapeValid = (() => {
      try {
        return (
          isFullyDecodableImageFile(stagedFile) &&
          evaluateMainImageSquareRule(readImageDimensions(stagedFile)).action === "reuse"
        );
      } catch {
        return false;
      }
    })();
    if (
      !rawImageFile ||
      !expectedWatermarkText ||
      !path.basename(stagedFile).includes(expectedWatermarkText) ||
      normalizedRawIndexes.has(localIndex) ||
      !stagedShapeValid
    ) {
      fs.rmSync(stagedFile, { force: true });
      invalidStagedFileFound = true;
      continue;
    }
    recovered.push({
      stagedFile,
      rawImageFile,
      imageIndex
    });
  }
  recovered.sort((left, right) => left.imageIndex - right.imageIndex);
  if (existingStagedFiles.length > 0 && !invalidStagedFileFound) {
    return recovered;
  }
  if (invalidStagedFileFound) {
    for (const item of recovered) {
      fs.rmSync(item.stagedFile, { force: true });
    }
    recovered.length = 0;
  }

  const watermarkDir = path.join(options.roundDir, "watermark");
  const existingRawFiles = [...rawByLocalIndex.entries()].sort((left, right) => left[0] - right[0]);
  if (existingRawFiles.length === 0) {
    return recovered;
  }

  const watermarkCandidates = existingRawFiles.filter(([, rawFile]) => fs.existsSync(rawFile));
  if (watermarkCandidates.length === 0) {
    return recovered;
  }

  for (const [localIndex, rawImageFile] of watermarkCandidates) {
    const imageIndex = startImageIndex + localIndex - 1;
    const watermarkText = options.resolveWatermarkText(imageIndex);
    const [watermarkedFile] = await applyLocalWatermark({
      inputFiles: [rawImageFile],
      outputDir: path.join(watermarkDir, String(imageIndex).padStart(2, "0")),
      watermarkText
    });
    const stagedFile = stageWatermarkedFile({
      stageDir: options.stageDir,
      productName: options.productName,
      watermarkText,
      imageIndex,
      watermarkedFile
    });
    recovered.push({
      stagedFile,
      rawImageFile,
      imageIndex
    });
  }

  return recovered.sort((left, right) => left.imageIndex - right.imageIndex);
}

export const MAIN_IMAGE_REUSE_IDENTITY_FILE = "reuse-identity.json";

interface MainImageReuseIdentity {
  sourceImagePath?: string;
  sourceImageName?: string;
  feishuRecordId?: string;
}

function normalizeIdentityPath(filePath: string | undefined): string {
  return filePath ? path.resolve(filePath) : "";
}

function writeMainImageReuseIdentity(taskDir: string, identity: MainImageReuseIdentity): void {
  fs.mkdirSync(taskDir, { recursive: true });
  fs.writeFileSync(
    path.join(taskDir, MAIN_IMAGE_REUSE_IDENTITY_FILE),
    JSON.stringify(
      {
        ...identity,
        sourceImagePath: normalizeIdentityPath(identity.sourceImagePath)
      },
      null,
      2
    ) + "\n",
    "utf8"
  );
}

export function seedCurrentProductMainImageReuse(options: {
  runtimeDir: string;
  taskId: string;
  sourceImagePath: string;
  sourceImageName?: string;
  feishuRecordId?: string;
}): { copiedRawImageCount: number; sourceTaskDir?: string } {
  const targetTaskDir = ensureTaskDir(options.runtimeDir, options.taskId);
  const targetIdentity: MainImageReuseIdentity = {
    sourceImagePath: normalizeIdentityPath(options.sourceImagePath),
    sourceImageName: options.sourceImageName || path.basename(options.sourceImagePath),
    feishuRecordId: options.feishuRecordId
  };
  writeMainImageReuseIdentity(targetTaskDir, targetIdentity);
  return { copiedRawImageCount: 0 };
}

function finalizeProductFolders(
  stagedFiles: Array<{
    stagedFile: string;
    rawImageFile?: string;
    shopFolder: string;
    promptIndex: number;
    promptWordFile?: string;
    submitId?: string;
    imageIndex: number;
  }>,
  productName: string,
  recordIdentity: string
): MainImageGeneratedFile[] {
  const generatedFiles: MainImageGeneratedFile[] = [];

  for (const item of stagedFiles) {
    const productFolder = buildProductFolder(item.shopFolder, productName, recordIdentity, item.imageIndex);
    fs.mkdirSync(productFolder, { recursive: true });
    const shopRootFile = path.join(item.shopFolder, path.basename(item.stagedFile));
    if (fs.existsSync(shopRootFile)) {
      fs.rmSync(shopRootFile, { force: true });
    }
    moveFile(item.stagedFile, shopRootFile);
    const finalImageFile = path.join(productFolder, path.basename(shopRootFile));
    if (fs.existsSync(finalImageFile)) {
      fs.rmSync(finalImageFile, { force: true });
    }
    moveFile(shopRootFile, finalImageFile);
    generatedFiles.push({
      imageFile: finalImageFile,
      rawImageFile: item.rawImageFile,
      shopFolder: item.shopFolder,
      productFolder,
      storeName: path.basename(item.shopFolder),
      promptIndex: item.promptIndex,
      promptWordFile: item.promptWordFile,
      submitId: item.submitId
    });
  }

  return generatedFiles;
}

function buildSimulatedFiles(options: {
  taskDir: string;
  shopFolders: Array<{ shopFolder: string; watermarkText: string }>;
  brandedGenericName: string;
  sourceImagePath: string;
  promptFiles: string[];
  expectedImageCount: number;
  imagesPerShop: number;
  shopCodes: string[];
  recordIdentity: string;
}): MainImageGeneratedFile[] {
  const generatedFiles: MainImageGeneratedFile[] = [];
  const shopMap = shopFolderByCode(options.shopFolders);
  const assignments = resolveMainImageShopAssignments({
    shopCodes: options.shopCodes,
    imagesPerShop: options.imagesPerShop,
    totalImageCount: options.promptFiles.length * options.expectedImageCount
  });
  let imageIndex = 1;

  for (let promptIndex = 0; promptIndex < options.promptFiles.length; promptIndex += 1) {
    for (let itemIndex = 0; itemIndex < options.expectedImageCount; itemIndex += 1) {
      const assignment = assignments[imageIndex - 1];
      const shop = shopMap.get(assignment.shopCode);
      if (!shop) {
        throw new Error(`Simulated main image assignment missing shop folder for code: ${assignment.shopCode}`);
      }
      const productFolder = path.join(
        options.taskDir,
        "simulated-shops",
        sanitizeFileName(path.basename(shop.shopFolder)),
        sanitizeFileName(`${options.brandedGenericName}-${options.recordIdentity}-水印${String(imageIndex).padStart(2, "0")}`)
      );
      fs.mkdirSync(productFolder, { recursive: true });
      const imageFile = path.join(
        productFolder,
        path.basename(buildStagedImageFile(productFolder, options.brandedGenericName, shop.watermarkText, imageIndex, options.sourceImagePath))
      );
      fs.copyFileSync(options.sourceImagePath, imageFile);
      generatedFiles.push({
        imageFile,
        rawImageFile: options.sourceImagePath,
        shopFolder: shop.shopFolder,
        productFolder,
        storeName: path.basename(shop.shopFolder),
        promptIndex: promptIndex + 1,
        promptWordFile: options.promptFiles[promptIndex]
      });
      imageIndex += 1;
    }
  }

  fs.writeFileSync(
    path.join(options.taskDir, "main-image-generation-simulated.txt"),
    generatedFiles.map((item) => item.imageFile).join("\n") + "\n",
    "utf8"
  );
  return generatedFiles;
}

export async function generateMainImageAssets(options: {
  runtimeDir: string;
  taskId: string;
  shopRootDir: string;
  sourceImagePath: string;
  sellingPointText: string;
  brandedGenericName: string;
  wordFiles: string[];
  imageGenerationProvider: ImageGenerationProvider;
  imageGenerationConfigFile: string;
  mainImageExpectedCount: number;
  mainImageCountStrategy: MainImageCountStrategy;
  promptCount?: number;
  shopCodes?: string[];
  imagesPerShop?: number;
  feishuRecordId?: string;
  feishuBatchFingerprint?: string;
  paidImageSubmissionLedgerDir?: string;
  archiveMainImageDir?: string;
  simulateOnly: boolean;
  onProgress?: (message: string) => void;
}): Promise<MainImageArtifact> {
  const taskDir = ensureTaskDir(options.runtimeDir, options.taskId);
  const promptFile = writePromptSummary(taskDir, options.wordFiles);
  const shopFolders = filterShopFoldersByCodes(resolveShopFolders(options.shopRootDir), options.shopCodes);
  const promptCount = options.promptCount || 5;
  const shopCodes = options.shopCodes || shopFolders.map((item) => shopCodeFromFolder(item.shopFolder));
  const imagesPerShop = options.imagesPerShop || options.mainImageExpectedCount;
  const totalExpectedImageCount = promptCount * options.mainImageExpectedCount;
  const shopMap = shopFolderByCode(shopFolders);
  const assignments = resolveMainImageShopAssignments({
    shopCodes,
    imagesPerShop,
    totalImageCount: totalExpectedImageCount
  });
  if (options.wordFiles.length < promptCount) {
    throw new Error("Main image generation requires " + promptCount + " Word prompt file(s), got " + options.wordFiles.length + ".");
  }
  if (shopFolders.length < shopCodes.length) {
    throw new Error("Main image generation requires " + shopCodes.length + " shop folder(s), got " + shopFolders.length + ".");
  }
  const productName = inferBrandedGenericName(options.brandedGenericName, options.sellingPointText);
  const reuseSeed = seedCurrentProductMainImageReuse({
    runtimeDir: options.runtimeDir,
    taskId: options.taskId,
    sourceImagePath: options.sourceImagePath,
    sourceImageName: path.basename(options.sourceImagePath),
    feishuRecordId: options.feishuRecordId
  });
  if (reuseSeed.copiedRawImageCount > 0) {
    options.onProgress?.(
      `Reused ${reuseSeed.copiedRawImageCount} current-product raw main image(s) from ${reuseSeed.sourceTaskDir || "previous task"}.`
    );
  }
  if (options.simulateOnly) {
    return {
      promptFile,
      generatedFiles: buildSimulatedFiles({
        taskDir,
        shopFolders,
        brandedGenericName: productName,
        sourceImagePath: options.sourceImagePath,
        promptFiles: options.wordFiles.slice(0, promptCount),
        expectedImageCount: options.mainImageExpectedCount,
        imagesPerShop,
        shopCodes,
        recordIdentity: options.feishuRecordId || options.taskId
      }),
      simulated: true
    };
  }

  requireOpenAiCompatibleImageProvider(options.imageGenerationProvider, "Main image generation");
  const imageGenerationConfig = readOpenAiCompatibleImageConfig(options.imageGenerationConfigFile);
  const videosBase64SubmitGate = createConcurrencyGate(
    resolveVideosBase64SubmitConcurrency(imageGenerationConfig.submitConcurrency)
  );
  if (!options.feishuBatchFingerprint || !options.feishuRecordId || !options.paidImageSubmissionLedgerDir) {
    throw new Error(
      "videos-base64 paid submission requires project-owned feishuBatchFingerprint, feishuRecordId, and paidImageSubmissionLedgerDir."
    );
  }
  const videosBase64ProductLedgerDir = paidImageProductLedgerDir(
    options.paidImageSubmissionLedgerDir,
    options.feishuBatchFingerprint,
    options.feishuRecordId
  );

  const stagedFiles: Array<{
    stagedFile: string;
    rawImageFile?: string;
    shopFolder: string;
    promptIndex: number;
    promptWordFile?: string;
    submitId?: string;
    imageIndex: number;
  }> = [];
  const processPromptRound = async (promptIndex: number) => {
    const roundStagedFiles: typeof stagedFiles = [];
    const roundStartImageIndex = promptIndex * options.mainImageExpectedCount + 1;
    const promptWordFile = options.wordFiles[promptIndex];
    const wordParagraphs = readSimpleWordDocument(promptWordFile);
    const promptText = buildImageEditPromptFromWord({
      paragraphs: wordParagraphs,
      promptWordFile
    });

    const roundDir = path.join(taskDir, "main-image-" + String(promptIndex + 1).padStart(2, "0"));
    const stageDir = path.join(taskDir, "staged", String(promptIndex + 1).padStart(2, "0"));
    const watermarkOutputDir = path.join(roundDir, "watermark");
    fs.mkdirSync(roundDir, { recursive: true });
    fs.writeFileSync(path.join(roundDir, "image2-prompt.txt"), promptText + "\n", "utf8");

    const recoveredFiles = await recoverExistingRoundOutputs({
      roundDir,
      stageDir,
      productName,
      resolveWatermarkText: (candidateImageIndex) => {
        const assignment = assignments[candidateImageIndex - 1];
        const shop = assignment ? shopMap.get(assignment.shopCode) : undefined;
        if (!shop) {
          throw new Error(`Recovered main image assignment missing shop folder for image ${candidateImageIndex}.`);
        }
        return shop.watermarkText;
      },
      startImageIndex: roundStartImageIndex
    });

    for (const recovered of recoveredFiles) {
      const assignment = assignments[recovered.imageIndex - 1];
      const shop = assignment ? shopMap.get(assignment.shopCode) : undefined;
      if (!shop) {
        throw new Error(`Recovered main image assignment missing shop folder for image ${recovered.imageIndex}.`);
      }
      roundStagedFiles.push({
        stagedFile: recovered.stagedFile,
        rawImageFile: recovered.rawImageFile,
        shopFolder: shop.shopFolder,
        promptIndex: promptIndex + 1,
        promptWordFile,
        imageIndex: recovered.imageIndex
      });
    }

    const recoveredLocalIndexes = recoveredFiles.map((recovered) => recovered.imageIndex - roundStartImageIndex + 1);
    const missingLocalIndexes = resolveMissingFixedImageIndexes(recoveredLocalIndexes, options.mainImageExpectedCount);
    const remainingImageCount =
      options.mainImageCountStrategy === "accept_all" && recoveredFiles.length > 0
        ? 0
        : missingLocalIndexes.length;

    if (
      options.mainImageCountStrategy !== "accept_all" &&
      recoveredFiles.length >= options.mainImageExpectedCount
    ) {
      return roundStagedFiles;
    }
    if (remainingImageCount === 0) {
      return roundStagedFiles;
    }

    const requestedPaidSlots = missingLocalIndexes.map((localIndex) => promptIndex * options.mainImageExpectedCount + localIndex);
    const paidResumePlan = summarizeVideosBase64PaidResumePlan(videosBase64ProductLedgerDir, requestedPaidSlots);
    options.onProgress?.(
      paidResumePlan
        ? `Prompt ${promptIndex + 1}/${promptCount}: missing fixed slots=${formatSlotList(
            requestedPaidSlots
          )}; paid submit slots=${formatSlotList(paidResumePlan.submitSlots)}; reuse slots=${formatSlotList(
            paidResumePlan.reuseSlots
          )}; poll slots=${formatSlotList(paidResumePlan.pollSlots)}.`
        : `Prompt ${promptIndex + 1}/${promptCount}: generating ${remainingImageCount} image(s).`
    );
    const generationResults = await generateWithOpenAiCompatibleProvider({
      configFile: options.imageGenerationConfigFile,
      promptText,
      sourceImagePath: options.sourceImagePath,
      downloadDir: path.join(roundDir, "openai-compatible", "raw"),
      expectedImageCount: remainingImageCount,
      requestedImageIndexes: missingLocalIndexes,
      videosBase64SubmitGate,
      paidImageLedger: {
        rootDir: options.paidImageSubmissionLedgerDir as string,
        batchFingerprint: options.feishuBatchFingerprint as string,
        recordId: options.feishuRecordId as string,
        expectedSlotCount: totalExpectedImageCount,
        slotOffset: promptIndex * options.mainImageExpectedCount,
        owner: {
          runId: path.basename(options.runtimeDir),
          taskId: options.taskId,
          pid: process.pid
        }
      },
      onProgress: (message) => options.onProgress?.(`Prompt ${promptIndex + 1}/${promptCount}: ${message}`)
    });

    for (const result of generationResults) {
      const normalization = await ensureSquareMainImageFile({
        sourceFile: result.file,
        evidenceDir: path.join(roundDir, "provider-original")
      });
      if (normalization.changed) {
        options.onProgress?.(
          `Prompt ${promptIndex + 1}/${promptCount}: normalized provider output ${path.basename(result.file)} from ${normalization.sourceDimensions.width}x${normalization.sourceDimensions.height} to ${normalization.outputDimensions.width}x${normalization.outputDimensions.height}.`
        );
      }
    }

    const watermarkedFiles: string[] = [];
    for (let itemIndex = 0; itemIndex < generationResults.length; itemIndex += 1) {
      const assignedImageIndex = roundStartImageIndex + missingLocalIndexes[itemIndex] - 1;
      const assignment = assignments[assignedImageIndex - 1];
      const shop = assignment ? shopMap.get(assignment.shopCode) : undefined;
      if (!shop) {
        throw new Error(`Generated main image assignment missing shop folder for image ${assignedImageIndex}.`);
      }
      const [watermarkedFile] = await applyLocalWatermark({
        inputFiles: [generationResults[itemIndex].file],
        outputDir: path.join(watermarkOutputDir, assignment.shopCode),
        watermarkText: shop.watermarkText
      });
      watermarkedFiles.push(watermarkedFile);
    }

    if (watermarkedFiles.length === 0) {
      throw new Error("No watermarked files were saved for prompt " + (promptIndex + 1) + ".");
    }

    for (let itemIndex = 0; itemIndex < watermarkedFiles.length; itemIndex += 1) {
      const rawFile = generationResults[itemIndex]?.file;
      const watermarkedFile = watermarkedFiles[itemIndex];
      const imageIndex = roundStartImageIndex + missingLocalIndexes[itemIndex] - 1;
      const assignment = assignments[imageIndex - 1];
      const shop = assignment ? shopMap.get(assignment.shopCode) : undefined;
      if (!shop) {
        throw new Error(`Staged main image assignment missing shop folder for image ${imageIndex}.`);
      }

      const stagedFile = stageWatermarkedFile({
        stageDir,
        productName,
        watermarkText: shop.watermarkText,
        imageIndex,
        watermarkedFile
      });

      roundStagedFiles.push({
        stagedFile,
        rawImageFile: rawFile,
        shopFolder: shop.shopFolder,
        promptIndex: promptIndex + 1,
        promptWordFile,
        submitId: generationResults[itemIndex]?.submitId,
        imageIndex
      });
    }
    options.onProgress?.(`Prompt ${promptIndex + 1}/${promptCount}: staged ${watermarkedFiles.length} image(s).`);
    return roundStagedFiles;
  };

  const promptIndexes = Array.from({ length: promptCount }, (_, index) => index);
  try {
    const concurrentRounds = await settleConcurrentWork(
      promptIndexes.map((promptIndex) => processPromptRound(promptIndex)),
      "videos-base64 prompt rounds"
    );
    stagedFiles.push(...concurrentRounds.flat());
  } catch (error) {
    const productDir = paidImageProductLedgerDir(
      options.paidImageSubmissionLedgerDir,
      options.feishuBatchFingerprint,
      options.feishuRecordId
    );
    if (fs.existsSync(productDir)) {
      const summary = summarizePaidImageProductLedger(productDir);
      if (resolvePaidImageLedgerFailureDisposition(summary) === "safety_block") {
        const original = error instanceof Error ? error.message : String(error);
        throw normalizeImageGenerationError(
          `paid submission safety block: paid image ledger has ambiguous=${summary.ambiguous}, reserved=${summary.reserved}; original: ${original}`
        );
      }
    }
    throw error;
  }
  stagedFiles.sort((left, right) => left.imageIndex - right.imageIndex);

  return {
    promptFile,
    generatedFiles: finalizeProductFolders(stagedFiles, productName, options.feishuRecordId || options.taskId),
    simulated: false
  };
}
