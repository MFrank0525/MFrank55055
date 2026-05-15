import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { sanitizeFileName } from "../doubao/paths.js";
import { extendPathEnv, getDreaminaWrapperPath, getPythonCommand } from "../utils/platform.js";
import { readSimpleWordDocument } from "./docx-lite.js";
import { applyLocalWatermark } from "./local-watermark.js";
import type { DreaminaImageCountStrategy, JimengArtifact, JimengGeneratedFile } from "./types.js";

const execFileAsync = promisify(execFile);

const SHOP_SPECS = [
  {
    shopCode: "01",
    watermarkText: "延草纲目理疗器械旗舰店"
  },
  {
    shopCode: "02",
    watermarkText: "延草纲目健康护理专营店"
  },
  {
    shopCode: "03",
    watermarkText: "延草纲目个护保健专营店"
  },
  {
    shopCode: "04",
    watermarkText: "延草纲目康复理疗专营店"
  },
  {
    shopCode: "05",
    watermarkText: "延草纲目医疗保健专营店"
  }
] as const;

const DREAMINA_IMAGE2IMAGE_WRAPPER = getDreaminaWrapperPath("image2image.py");
const DREAMINA_QUERY_WRAPPER = getDreaminaWrapperPath("query_result.py");
const DREAMINA_USER_CREDIT_WRAPPER = getDreaminaWrapperPath("user_credit.py");

function ensureTaskDir(runtimeDir: string, taskId: string): string {
  const taskDir = path.join(runtimeDir, "tasks", sanitizeFileName(taskId));
  fs.mkdirSync(taskDir, { recursive: true });
  return taskDir;
}

function writePromptSummary(taskDir: string, promptFiles: string[]): string {
  const promptFile = path.join(taskDir, "jimeng-prompts.txt");
  fs.writeFileSync(promptFile, `${promptFiles.join("\n")}\n`, "utf8");
  return promptFile;
}

function listImageFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs
    .readdirSync(dir)
    .filter((name) => /\.(png|jpg|jpeg|webp)$/i.test(name))
    .map((name) => path.join(dir, name))
    .sort((a, b) => a.localeCompare(b, "zh-CN"));
}

function listImageFilesRecursive(dir: string): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }

  const collected: string[] = [];
  const pending = [dir];
  while (pending.length > 0) {
    const currentDir = pending.pop() as string;
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        pending.push(fullPath);
        continue;
      }
      if (/\.(png|jpg|jpeg|webp)$/i.test(entry.name)) {
        collected.push(fullPath);
      }
    }
  }

  return collected.sort((a, b) => a.localeCompare(b, "zh-CN"));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveShopFolders(shopRootDir: string): Array<{ shopFolder: string; watermarkText: string }> {
  const existingFolders = fs
    .readdirSync(shopRootDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      fullPath: path.join(shopRootDir, entry.name)
    }));

  return SHOP_SPECS.map((spec) => {
    const match = existingFolders.find((folder) => folder.name.startsWith(spec.shopCode));

    if (!match) {
      throw new Error(`Shop folder not found for code ${spec.shopCode}`);
    }

    return {
      shopFolder: match.fullPath,
      watermarkText: spec.watermarkText
    };
  });
}

function inferBrandedGenericName(brandedGenericName: string, sellingPointText: string): string {
  if (brandedGenericName.trim()) {
    return brandedGenericName.trim();
  }
  const segments = sellingPointText
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return segments[1] || segments[0] || "未命名产品";
}

function buildDreaminaPromptFromWord(paragraphs: string[], promptWordFile: string): string {
  const cleaned = paragraphs.map((item) => item.trim()).filter(Boolean);
  if (cleaned.length !== 3) {
    throw new Error(`Prompt Word file must contain exactly 3 paragraphs (instruction1, selling points, deepseek prompt): ${promptWordFile}`);
  }

  const instruction = cleaned[0] || "";
  const sellingPoints = cleaned[1] || "";
  const deepseekPrompt = cleaned[cleaned.length - 1] || "";
  if (!instruction || !sellingPoints || !deepseekPrompt) {
    throw new Error(`Prompt Word file had empty required paragraph: ${promptWordFile}`);
  }
  const promptText = [instruction, deepseekPrompt].join("\n");
  if (!promptText.trim()) {
    throw new Error(`Dreamina prompt could not be built from Word file: ${promptWordFile}`);
  }
  return promptText;
}

async function runWrapperJson(args: string[]): Promise<any> {
  try {
    const commandArgs = ["-X", "utf8", ...args];
    const dreaminaBinDir = process.env.DREAMINA_BIN ? path.dirname(process.env.DREAMINA_BIN) : "";
    const { stdout, stderr } = await execFileAsync(getPythonCommand(), commandArgs, {
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 32,
      env: {
        ...extendPathEnv([dreaminaBinDir]),
        PYTHONIOENCODING: "utf-8",
      }
    });

    const text = `${stdout}\n${stderr}`.trim();
    const match = text.match(/(\{[\s\S]*\})\s*$/);
    if (!match) {
      throw new Error(`Dreamina wrapper did not return JSON: ${text.slice(-500)}`);
    }
    const payload = JSON.parse(match[1]);
    if (!payload.ok) {
      throw new Error(payload.error || "Dreamina wrapper returned failure.");
    }
    return payload;
  } catch (error) {
    const message =
      error && typeof error === "object" && "stdout" in error
        ? `${String((error as { stdout?: string }).stdout || "")}\n${String((error as { stderr?: string }).stderr || "")}`.trim()
        : error instanceof Error
          ? error.message
          : String(error);
    throw new Error(message || "Dreamina wrapper execution failed.");
  }
}

function collectNumericCreditCandidates(value: unknown, bucket: number[]): void {
  if (typeof value === "number" && Number.isFinite(value)) {
    bucket.push(value);
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectNumericCreditCandidates(item, bucket);
    }
    return;
  }

  for (const [key, item] of Object.entries(value)) {
    if (/credit|quota|remain|available|usable|left/i.test(key)) {
      collectNumericCreditCandidates(item, bucket);
    }
  }
}

function extractAvailableCredits(payload: any): number | null {
  const explicitSummedFields = [
    payload?.data?.vip_credit,
    payload?.data?.vipCredit,
    payload?.data?.gift_credit,
    payload?.data?.giftCredit,
    payload?.data?.purchase_credit,
    payload?.data?.purchaseCredit,
    payload?.data?.free_credit,
    payload?.data?.freeCredit
  ].filter((candidate) => typeof candidate === "number" && Number.isFinite(candidate)) as number[];

  if (explicitSummedFields.length > 0) {
    return explicitSummedFields.reduce((sum, value) => sum + value, 0);
  }

  const directCandidates = [
    payload?.data?.available_credit,
    payload?.data?.availableCredit,
    payload?.data?.remaining_credit,
    payload?.data?.remainingCredit,
    payload?.data?.usable_credit,
    payload?.data?.usableCredit,
    payload?.data?.total_credit,
    payload?.data?.totalCredit
  ];

  for (const candidate of directCandidates) {
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return candidate;
    }
  }

  const numericCandidates: number[] = [];
  collectNumericCreditCandidates(payload?.data, numericCandidates);
  if (numericCandidates.length === 0) {
    return null;
  }

  return Math.max(...numericCandidates);
}

async function assertDreaminaCredits(options: {
  dreaminaBin: string;
  taskDir: string;
  expectedImageCount: number;
  promptCount: number;
}): Promise<void> {
  const payload = await runWrapperJson([
    DREAMINA_USER_CREDIT_WRAPPER,
    "--dreamina-bin",
    options.dreaminaBin
  ]);
  fs.writeFileSync(path.join(options.taskDir, "dreamina-user-credit.json"), `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  const availableCredits = extractAvailableCredits(payload);
  if (availableCredits === null) {
    return;
  }

  if (availableCredits <= 0) {
    throw new Error("Dreamina credits are unavailable. Please recharge or wait for credits before generation.");
  }

  const conservativeBatchFloor = Math.max(1, Math.min(options.promptCount, options.expectedImageCount || 1));
  if (availableCredits < conservativeBatchFloor) {
    throw new Error(
      `Dreamina credits appear insufficient for this batch. Available credits=${availableCredits}, required minimum=${conservativeBatchFloor}.`
    );
  }
}

async function queryResultWithRetry(options: {
  dreaminaBin: string;
  submitId: string;
  downloadDir: string;
  timeoutMs: number;
  intervalMs: number;
}): Promise<any> {
  const deadline = Date.now() + options.timeoutMs;
  let lastError = "Dreamina result query did not run.";

  while (Date.now() < deadline) {
    try {
      const payload = await runWrapperJson([
        DREAMINA_QUERY_WRAPPER,
        "--dreamina-bin",
        options.dreaminaBin,
        "--submit-id",
        options.submitId,
        "--download-dir",
        options.downloadDir
      ]);

      const genStatus = String(payload?.data?.gen_status || "").trim().toLowerCase();
      if (genStatus === "fail") {
        const failReason = String(payload?.data?.fail_reason || "").trim();
        throw new Error(failReason || `Dreamina task failed for submit_id=${options.submitId}`);
      }

      const downloadedFiles = listImageFiles(options.downloadDir);
      if (downloadedFiles.length > 0) {
        return payload;
      }
      lastError = `Dreamina query_result returned no files for submit_id=${options.submitId}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (/task failed|generation failed|gen_status=fail|final generation failed/i.test(lastError)) {
        throw new Error(lastError);
      }
    }

    await sleep(options.intervalMs);
  }

  throw new Error(`Dreamina query_result timed out for ${options.submitId}: ${lastError}`);
}

async function generateWithDreamina(options: {
  dreaminaBin: string;
  sourceImagePath: string;
  promptText: string;
  downloadDir: string;
  pollSeconds: number;
  modelVersion: string;
  resolutionType: string;
  ratio: string;
}): Promise<{ submitId: string; downloadedFiles: string[] }> {
  fs.mkdirSync(options.downloadDir, { recursive: true });
  for (const existing of listImageFiles(options.downloadDir)) {
    fs.rmSync(existing, { force: true });
  }

  const submitPayload = await runWrapperJson([
    DREAMINA_IMAGE2IMAGE_WRAPPER,
    "--dreamina-bin",
    options.dreaminaBin,
    "--images",
    options.sourceImagePath,
    "--prompt",
    options.promptText,
    "--ratio",
    options.ratio,
    "--resolution-type",
    options.resolutionType,
    "--model-version",
    options.modelVersion,
    "--poll",
    String(Math.max(0, options.pollSeconds))
  ]);
  fs.writeFileSync(path.join(options.downloadDir, "submit-result.json"), `${JSON.stringify(submitPayload, null, 2)}\n`, "utf8");

  const submitId = String(submitPayload.data?.submit_id || "").trim();
  if (!submitId) {
    throw new Error("Dreamina submit_id was missing.");
  }

  const queryPayload = await queryResultWithRetry({
    dreaminaBin: options.dreaminaBin,
    submitId,
    downloadDir: options.downloadDir,
    timeoutMs: Math.max(180000, options.pollSeconds * 3000),
    intervalMs: 8000
  });
  fs.writeFileSync(path.join(options.downloadDir, "query-result.json"), `${JSON.stringify(queryPayload, null, 2)}\n`, "utf8");

  const downloadedFiles = listImageFiles(options.downloadDir);
  if (downloadedFiles.length === 0) {
    throw new Error(`Dreamina query_result downloaded no image files for submit_id=${submitId}`);
  }

  return {
    submitId,
    downloadedFiles
  };
}

async function generateDreaminaBatch(options: {
  dreaminaBin: string;
  sourceImagePath: string;
  promptText: string;
  batchWorkDir: string;
  pollSeconds: number;
  modelVersion: string;
  resolutionType: string;
  ratio: string;
  expectedImageCount: number;
  imageCountStrategy: DreaminaImageCountStrategy;
}): Promise<Array<{ file: string; submitId: string }>> {
  if (options.imageCountStrategy === "accept_all" || options.expectedImageCount <= 0) {
    const singleResult = await generateWithDreamina({
      dreaminaBin: options.dreaminaBin,
      sourceImagePath: options.sourceImagePath,
      promptText: options.promptText,
      downloadDir: path.join(options.batchWorkDir, "attempt-01", "raw"),
      pollSeconds: options.pollSeconds,
      modelVersion: options.modelVersion,
      resolutionType: options.resolutionType,
      ratio: options.ratio
    });

    return singleResult.downloadedFiles.map((file) => ({
      file,
      submitId: singleResult.submitId
    }));
  }

  const maxAttempts = Math.max(options.expectedImageCount, 1);
  const collected: Array<{ file: string; submitId: string }> = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (collected.length >= options.expectedImageCount) {
      break;
    }

    const result = await generateWithDreamina({
      dreaminaBin: options.dreaminaBin,
      sourceImagePath: options.sourceImagePath,
      promptText: options.promptText,
      downloadDir: path.join(options.batchWorkDir, `attempt-${String(attempt).padStart(2, "0")}`, "raw"),
      pollSeconds: options.pollSeconds,
      modelVersion: options.modelVersion,
      resolutionType: options.resolutionType,
      ratio: options.ratio
    });

    for (const file of result.downloadedFiles) {
      collected.push({
        file,
        submitId: result.submitId
      });
    }
  }

  if (options.imageCountStrategy === "require_exact") {
    if (collected.length !== options.expectedImageCount) {
      throw new Error(`Dreamina generated ${collected.length} image(s), expected exactly ${options.expectedImageCount}.`);
    }
    return collected;
  }

  if (options.imageCountStrategy === "limit_to_count") {
    if (collected.length < options.expectedImageCount) {
      throw new Error(`Dreamina generated ${collected.length} image(s), expected at least ${options.expectedImageCount}.`);
    }
    return collected.slice(0, options.expectedImageCount);
  }

  return collected;
}

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
  const baseName = sanitizeFileName(`${productName}${watermarkText}${String(imageIndex).padStart(2, "0")}`);
  return path.join(stageDir, `${baseName}${ext}`);
}

function buildProductFolder(shopFolder: string, productName: string, imageIndex: number): string {
  return path.join(shopFolder, sanitizeFileName(`${productName}水印${String(imageIndex).padStart(2, "0")}`));
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
  watermarkText: string;
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

  let imageIndex = options.startImageIndex;
  const existingStagedFiles = listImageFiles(options.stageDir);
  for (const stagedFile of existingStagedFiles) {
    recovered.push({
      stagedFile,
      imageIndex
    });
    imageIndex += 1;
  }

  const watermarkDir = path.join(options.roundDir, "watermark");
  const existingRawFiles = listImageFilesRecursive(options.roundDir).filter((file) => file.includes(`${path.sep}raw${path.sep}`));
  if (existingRawFiles.length === 0) {
    return recovered;
  }

  const watermarkCandidates = existingRawFiles.filter((rawFile) => fs.existsSync(rawFile));
  if (watermarkCandidates.length === 0) {
    return recovered;
  }

  const recoveredWatermarkedFiles = await applyLocalWatermark({
    inputFiles: watermarkCandidates,
    outputDir: watermarkDir,
    watermarkText: options.watermarkText
  });

  for (let itemIndex = 0; itemIndex < recoveredWatermarkedFiles.length; itemIndex += 1) {
    const watermarkedFile = recoveredWatermarkedFiles[itemIndex];
    const rawImageFile = watermarkCandidates[itemIndex];
    const stagedFile = stageWatermarkedFile({
      stageDir: options.stageDir,
      productName: options.productName,
      watermarkText: options.watermarkText,
      imageIndex,
      watermarkedFile
    });
    if (rawImageFile && fs.existsSync(rawImageFile)) {
      fs.rmSync(rawImageFile, { force: true });
    }
    recovered.push({
      stagedFile,
      rawImageFile,
      imageIndex
    });
    imageIndex += 1;
  }

  return recovered;
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
  productName: string
): JimengGeneratedFile[] {
  const generatedFiles: JimengGeneratedFile[] = [];

  for (const item of stagedFiles) {
    const productFolder = buildProductFolder(item.shopFolder, productName, item.imageIndex);
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
}): JimengGeneratedFile[] {
  const stagedFiles: Array<{
    stagedFile: string;
    shopFolder: string;
    promptIndex: number;
    promptWordFile: string;
    imageIndex: number;
  }> = [];
  let imageIndex = 1;

  for (let promptIndex = 0; promptIndex < options.promptFiles.length; promptIndex += 1) {
    const shopFolder = options.shopFolders[promptIndex].shopFolder;
    const stageDir = path.join(options.taskDir, "staged", String(promptIndex + 1).padStart(2, "0"));
    const stagedFile = buildStagedImageFile(
      stageDir,
      options.brandedGenericName,
      options.shopFolders[promptIndex].watermarkText,
      imageIndex,
      options.sourceImagePath
    );
    fs.mkdirSync(path.dirname(stagedFile), { recursive: true });
    fs.copyFileSync(options.sourceImagePath, stagedFile);
    stagedFiles.push({
      stagedFile,
      shopFolder,
      promptIndex: promptIndex + 1,
      promptWordFile: options.promptFiles[promptIndex],
      imageIndex
    });
    imageIndex += 1;
  }

  const generatedFiles = finalizeProductFolders(stagedFiles, options.brandedGenericName);
  fs.writeFileSync(
    path.join(options.taskDir, "dreamina-simulated.txt"),
    generatedFiles.map((item) => item.imageFile).join("\n"),
    "utf8"
  );
  return generatedFiles;
}

export async function generateJimengAssets(options: {
  runtimeDir: string;
  taskId: string;
  shopRootDir: string;
  sourceImagePath: string;
  sellingPointText: string;
  brandedGenericName: string;
  wordFiles: string[];
  dreaminaBin: string;
  dreaminaPollSeconds: number;
  dreaminaModelVersion: string;
  dreaminaResolutionType: string;
  dreaminaRatio: string;
  dreaminaExpectedImageCount: number;
  dreaminaImageCountStrategy: DreaminaImageCountStrategy;
  simulateOnly: boolean;
}): Promise<JimengArtifact> {
  const taskDir = ensureTaskDir(options.runtimeDir, options.taskId);
  const promptFile = writePromptSummary(taskDir, options.wordFiles);
  const shopFolders = resolveShopFolders(options.shopRootDir);
  const productName = inferBrandedGenericName(options.brandedGenericName, options.sellingPointText);

  if (options.simulateOnly) {
    return {
      promptFile,
      generatedFiles: buildSimulatedFiles({
        taskDir,
        shopFolders,
        brandedGenericName: productName,
        sourceImagePath: options.sourceImagePath,
        promptFiles: options.wordFiles.slice(0, Math.min(5, shopFolders.length))
      }),
      simulated: true
    };
  }

  if (!fs.existsSync(options.dreaminaBin)) {
    throw new Error(`Dreamina executable not found: ${options.dreaminaBin}`);
  }

  await assertDreaminaCredits({
    dreaminaBin: options.dreaminaBin,
    taskDir,
    expectedImageCount: options.dreaminaExpectedImageCount,
    promptCount: Math.min(5, options.wordFiles.length, shopFolders.length)
  });

  const stagedFiles: Array<{
    stagedFile: string;
    rawImageFile?: string;
    shopFolder: string;
    promptIndex: number;
    promptWordFile?: string;
    submitId?: string;
    imageIndex: number;
  }> = [];
  let imageIndex = 1;

  for (let promptIndex = 0; promptIndex < Math.min(5, options.wordFiles.length, shopFolders.length); promptIndex += 1) {
    const promptWordFile = options.wordFiles[promptIndex];
    const promptText = buildDreaminaPromptFromWord(readSimpleWordDocument(promptWordFile), promptWordFile);

    const { shopFolder, watermarkText } = shopFolders[promptIndex];
    const roundDir = path.join(taskDir, `dreamina-${String(promptIndex + 1).padStart(2, "0")}`);
    const stageDir = path.join(taskDir, "staged", String(promptIndex + 1).padStart(2, "0"));
    const watermarkOutputDir = path.join(roundDir, "watermark");
    fs.mkdirSync(roundDir, { recursive: true });
    fs.writeFileSync(path.join(roundDir, "dreamina-prompt.txt"), `${promptText}\n`, "utf8");

    const recoveredFiles = await recoverExistingRoundOutputs({
      roundDir,
      stageDir,
      productName,
      watermarkText,
      startImageIndex: imageIndex
    });

    for (const recovered of recoveredFiles) {
      stagedFiles.push({
        stagedFile: recovered.stagedFile,
        rawImageFile: recovered.rawImageFile,
        shopFolder,
        promptIndex: promptIndex + 1,
        promptWordFile,
        imageIndex: recovered.imageIndex
      });
      imageIndex = recovered.imageIndex + 1;
    }

    const remainingImageCount =
      options.dreaminaImageCountStrategy === "accept_all"
        ? 0
        : Math.max(0, options.dreaminaExpectedImageCount - recoveredFiles.length);

    if (
      options.dreaminaImageCountStrategy !== "accept_all" &&
      recoveredFiles.length >= options.dreaminaExpectedImageCount
    ) {
      continue;
    }

    const dreaminaResults = await generateDreaminaBatch({
      dreaminaBin: options.dreaminaBin,
      sourceImagePath: options.sourceImagePath,
      promptText,
      batchWorkDir: roundDir,
      pollSeconds: options.dreaminaPollSeconds,
      modelVersion: options.dreaminaModelVersion,
      resolutionType: options.dreaminaResolutionType,
      ratio: options.dreaminaRatio,
      expectedImageCount: remainingImageCount,
      imageCountStrategy: options.dreaminaImageCountStrategy
    });

    const watermarkedFiles = await applyLocalWatermark({
      inputFiles: dreaminaResults.map((item) => item.file),
      outputDir: watermarkOutputDir,
      watermarkText
    });

    if (watermarkedFiles.length === 0) {
      throw new Error(`No watermarked files were saved for prompt ${promptIndex + 1}.`);
    }

    for (let itemIndex = 0; itemIndex < watermarkedFiles.length; itemIndex += 1) {
      const rawFile = dreaminaResults[itemIndex]?.file;
      const watermarkedFile = watermarkedFiles[itemIndex];
      if (rawFile && fs.existsSync(rawFile)) {
        fs.rmSync(rawFile, { force: true });
      }

      const stagedFile = stageWatermarkedFile({
        stageDir,
        productName,
        watermarkText,
        imageIndex,
        watermarkedFile
      });

      stagedFiles.push({
        stagedFile,
        rawImageFile: rawFile,
        shopFolder,
        promptIndex: promptIndex + 1,
        promptWordFile,
        submitId: dreaminaResults[itemIndex]?.submitId,
        imageIndex
      });
      imageIndex += 1;
    }
  }

  return {
    promptFile,
    generatedFiles: finalizeProductFolders(stagedFiles, productName),
    simulated: false
  };
}
