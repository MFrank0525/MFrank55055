import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { getPythonCommand } from "../utils/platform.js";
import { readImageDimensions, type ImageDimensions } from "../utils/image-dimensions.js";
import { applyLocalWatermark } from "./local-watermark.js";
import { evaluateMainImageSquareRule } from "./main-image-shape-rules.js";
import type { MainImageArtifact } from "./types.js";

const execFileAsync = promisify(execFile);
const NORMALIZER_SCRIPT = path.join(process.cwd(), "src", "autolist", "main-image-square-normalizer.py");

export interface MainImageSquareNormalizationResult {
  changed: boolean;
  sourceDimensions: ImageDimensions;
  outputDimensions: ImageDimensions;
  evidenceFile?: string;
}

function atomicReplaceFile(sourceFile: string, targetFile: string): void {
  const temporaryFile = `${targetFile}.square-${process.pid}-${Date.now()}${path.extname(targetFile)}`;
  fs.copyFileSync(sourceFile, temporaryFile);
  fs.renameSync(temporaryFile, targetFile);
}

export async function ensureSquareMainImageFile(options: {
  sourceFile: string;
  evidenceDir: string;
}): Promise<MainImageSquareNormalizationResult> {
  if (!fs.existsSync(options.sourceFile)) {
    throw new Error(`Main image file not found for square normalization: ${options.sourceFile}`);
  }
  const sourceDimensions = readImageDimensions(options.sourceFile);
  const decision = evaluateMainImageSquareRule(sourceDimensions);
  if (decision.action === "reuse") {
    return {
      changed: false,
      sourceDimensions,
      outputDimensions: sourceDimensions
    };
  }

  fs.mkdirSync(options.evidenceDir, { recursive: true });
  const evidenceFile = path.join(options.evidenceDir, path.basename(options.sourceFile));
  if (!fs.existsSync(evidenceFile)) {
    fs.copyFileSync(options.sourceFile, evidenceFile);
  }
  const temporaryOutput = path.join(
    path.dirname(options.sourceFile),
    `${path.basename(options.sourceFile, path.extname(options.sourceFile))}.square-normalized-${process.pid}${path.extname(options.sourceFile)}`
  );
  await execFileAsync(
    getPythonCommand(),
    [
      "-X",
      "utf8",
      NORMALIZER_SCRIPT,
      "--input",
      options.sourceFile,
      "--output",
      temporaryOutput,
      "--side",
      String(decision.targetSide)
    ],
    {
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 8,
      env: {
        ...process.env,
        PYTHONIOENCODING: "utf-8"
      }
    }
  );
  const outputDimensions = readImageDimensions(temporaryOutput);
  if (outputDimensions.width !== decision.targetSide || outputDimensions.height !== decision.targetSide) {
    fs.rmSync(temporaryOutput, { force: true });
    throw new Error(
      `Main image square normalization readback failed: expected=${decision.targetSide}x${decision.targetSide}; actual=${outputDimensions.width}x${outputDimensions.height}.`
    );
  }
  fs.renameSync(temporaryOutput, options.sourceFile);
  return {
    changed: true,
    sourceDimensions,
    outputDimensions,
    evidenceFile
  };
}

function watermarkTextFromShopFolder(shopFolder: string | undefined): string {
  const text = path.basename(shopFolder || "").replace(/^\d+/, "").trim();
  if (!text) {
    throw new Error(`Cannot resolve watermark text from shop folder: ${shopFolder || "<empty>"}`);
  }
  return text;
}

function listFilesRecursive(rootDir: string): string[] {
  if (!fs.existsSync(rootDir)) {
    return [];
  }
  return fs.readdirSync(rootDir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(rootDir, entry.name);
    return entry.isDirectory() ? listFilesRecursive(fullPath) : [fullPath];
  });
}

function findRecoveredProductMainImage(productFolder: string): string {
  const candidates = fs
    .readdirSync(productFolder)
    .filter((name) => /\.(png|jpg|jpeg|webp)$/i.test(name))
    .filter((name) => !/(资质|医疗器械注册证|医疗器械备案|白装展开图|包装展开图|详情页|白底图|白底|主图3[:：]4|3[:：]4)/i.test(name))
    .map((name) => path.join(productFolder, name));
  if (candidates.length !== 1) {
    throw new Error(
      `Recovered product folder must contain exactly one generated main image: ${productFolder}; found=${candidates
        .map((file) => path.basename(file))
        .join(", ") || "<none>"}`
    );
  }
  return candidates[0];
}

export function recoverMainImageArtifactForPublish(options: {
  taskRuntimeDir: string;
  distributedFolders: string[];
  imagesPerPrompt: number;
}): MainImageArtifact {
  const rawByImageIndex = new Map<number, string>();
  for (const rawFile of listFilesRecursive(options.taskRuntimeDir)) {
    const normalized = rawFile.split(path.sep).join("/");
    const match = /\/main-image-(\d+)\/.*\/raw\/generated-(\d+)\.(?:png|jpg|jpeg|webp)$/i.exec(normalized);
    if (!match) {
      continue;
    }
    const promptIndex = Number(match[1]);
    const localIndex = Number(match[2]);
    const imageIndex = (promptIndex - 1) * options.imagesPerPrompt + localIndex;
    rawByImageIndex.set(imageIndex, rawFile);
  }

  const generatedFiles = options.distributedFolders
    .map((productFolder) => {
      const match = /水印(\d+)$/.exec(path.basename(productFolder));
      const imageIndex = Number(match?.[1]);
      if (!Number.isInteger(imageIndex) || imageIndex <= 0) {
        throw new Error(`Recovered product folder is missing a valid watermark index: ${productFolder}`);
      }
      const shopFolder = path.dirname(productFolder);
      return {
        imageFile: findRecoveredProductMainImage(productFolder),
        rawImageFile: rawByImageIndex.get(imageIndex),
        shopFolder,
        productFolder,
        storeName: path.basename(shopFolder),
        promptIndex: Math.floor((imageIndex - 1) / options.imagesPerPrompt) + 1
      };
    })
    .sort((left, right) => left.promptIndex - right.promptIndex || left.imageFile.localeCompare(right.imageFile, "zh-CN"));

  return {
    promptFile: path.join(options.taskRuntimeDir, "main-image-prompts.txt"),
    generatedFiles,
    simulated: false
  };
}

export async function repairMainImageArtifactShapes(options: {
  artifact: MainImageArtifact;
  evidenceDir: string;
  onProgress?: (message: string) => void;
}): Promise<{ artifact: MainImageArtifact; normalizedFileCount: number }> {
  let normalizedFileCount = 0;
  for (const [index, item] of options.artifact.generatedFiles.entries()) {
    const rawResult =
      item.rawImageFile && fs.existsSync(item.rawImageFile)
        ? await ensureSquareMainImageFile({
            sourceFile: item.rawImageFile,
            evidenceDir: path.join(options.evidenceDir, "raw")
          })
        : undefined;
    const finalDimensions = readImageDimensions(item.imageFile);
    const finalDecision = evaluateMainImageSquareRule(finalDimensions);
    if (rawResult?.changed || finalDecision.action === "pad_to_square") {
      const finalEvidenceDir = path.join(options.evidenceDir, "watermarked");
      fs.mkdirSync(finalEvidenceDir, { recursive: true });
      const finalEvidenceFile = path.join(finalEvidenceDir, path.basename(item.imageFile));
      if (!fs.existsSync(finalEvidenceFile)) {
        fs.copyFileSync(item.imageFile, finalEvidenceFile);
      }

      if (item.rawImageFile && fs.existsSync(item.rawImageFile)) {
        const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "main-image-rewatermark-"));
        try {
          const [watermarkedFile] = await applyLocalWatermark({
            inputFiles: [item.rawImageFile],
            outputDir: workDir,
            watermarkText: watermarkTextFromShopFolder(item.shopFolder)
          });
          atomicReplaceFile(watermarkedFile, item.imageFile);
        } finally {
          fs.rmSync(workDir, { recursive: true, force: true });
        }
      } else {
        await ensureSquareMainImageFile({
          sourceFile: item.imageFile,
          evidenceDir: finalEvidenceDir
        });
      }
      const repairedDimensions = readImageDimensions(item.imageFile);
      if (repairedDimensions.width !== repairedDimensions.height) {
        throw new Error(
          `Repaired watermarked main image is still not square: ${path.basename(item.imageFile)} (${repairedDimensions.width}x${repairedDimensions.height}).`
        );
      }
      normalizedFileCount += 1;
      options.onProgress?.(
        `Normalized main image ${index + 1}/${options.artifact.generatedFiles.length} to ${repairedDimensions.width}x${repairedDimensions.height}: ${path.basename(item.imageFile)}`
      );
    }
  }
  return {
    artifact: options.artifact,
    normalizedFileCount
  };
}
