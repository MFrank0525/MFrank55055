import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  FEISHU_WHITE_BACKGROUND_IMAGE_DIR,
  FIXED_MAIN_AUXILIARY_FILES,
  FIXED_MAIN_IMAGE_DIR,
  REQUIRED_MAIN_IMAGE_RATIO,
  REQUIRED_MAIN_IMAGE_RATIO_TOLERANCE
} from "./constants.js";
import { resolveFeishuAssetRecordForFolder } from "./asset-rules.js";
import type { ImageDimensions, ProductAssets } from "./types.js";

function sortZh(items: string[]): string[] {
  return [...items].sort((a, b) => a.localeCompare(b, "zh-CN"));
}

function extractTrailingOrder(name: string): number {
  const qualificationOrder = name.match(
    /(?:\u8d44\u8d28\u56fe\u7247|\u533b\u7597\u5668\u68b0\u6ce8\u518c\u8bc1|\u533b\u7597\u5668\u68b0\u5907\u6848|\u767d\u88c5\u5c55\u5f00\u56fe|\u5305\u88c5\u5c55\u5f00\u56fe|\u8be6\u60c5\u9875)-(\d{1,3})(?:-[^.]+)?\.[^.]+$/i
  );
  if (qualificationOrder) {
    return Number(qualificationOrder[1]);
  }
  const match = name.match(/(\d+)(?=\.[^.]+$)/);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function sortByFileRule(paths: string[]): string[] {
  return [...paths].sort((a, b) => {
    const nameA = path.basename(a);
    const nameB = path.basename(b);
    const orderDiff = extractTrailingOrder(nameA) - extractTrailingOrder(nameB);
    if (orderDiff !== 0) {
      return orderDiff;
    }
    return nameA.localeCompare(nameB, "zh-CN");
  });
}

function extensionPriority(filePath: string): number {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") {
    return 0;
  }
  if (ext === ".webp") {
    return 1;
  }
  if (ext === ".jpg" || ext === ".jpeg") {
    return 2;
  }
  return 3;
}

function stemKey(filePath: string): string {
  return path.basename(filePath, path.extname(filePath)).toLowerCase();
}

function preferWatermarkedPrimaryCandidates(paths: string[]): string[] {
  const byStem = new Map<string, string[]>();
  for (const filePath of paths) {
    const key = stemKey(filePath);
    byStem.set(key, [...(byStem.get(key) || []), filePath]);
  }

  return Array.from(byStem.values()).map((items) =>
    sortByFileRule(items).sort((a, b) => {
      const extDiff = extensionPriority(a) - extensionPriority(b);
      if (extDiff !== 0) {
        return extDiff;
      }
      return 0;
    })[0]
  );
}

function isExcludedMainImage(name: string): boolean {
  return /\u767d\u5e95\u56fe|\u767d\u5e95|3[:\uff1a]4|\u4e3b\u56fe3[:\uff1a]4/i.test(name);
}

function isImageFile(name: string): boolean {
  return /\.(png|jpg|jpeg|webp)$/i.test(name);
}

function isAuxiliaryImageFile(name: string): boolean {
  return /^\u8f85\u52a9\u56fe.*\.(png|jpg|jpeg|webp)$/i.test(name);
}

function isNamedMainImageFile(name: string): boolean {
  return /^\u4E3B\u56FE01.*\.(png|jpg|jpeg|webp)$/i.test(name);
}

function isDetailImageFile(name: string): boolean {
  return (
    /\u8BE6\u60C5\u9875.*\.(png|jpg|jpeg|webp)$/i.test(name) ||
    /(\u8D44\u8D28|\u533b\u7597\u5668\u68b0\u6ce8\u518c\u8bc1|\u533b\u7597\u5668\u68b0\u5907\u6848|\u767d\u88c5\u5c55\u5f00\u56fe|\u5305\u88c5\u5c55\u5f00\u56fe).*\.(png|jpg|jpeg|webp)$/i.test(name)
  );
}

function isWhiteBackgroundImageFile(name: string): boolean {
  return /\u767d\u5e95\u56fe|\u767d\u5e95/i.test(name) && isImageFile(name);
}

function readFeishuProductsData(): any[] {
  const dataFile = path.resolve(process.cwd(), "data", "feishu", "products.json");
  if (!fs.existsSync(dataFile)) {
    return [];
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(dataFile, "utf8"));
    if (Array.isArray(parsed)) {
      return parsed;
    }
    if (Array.isArray(parsed.records)) {
      return parsed.records;
    }
    if (Array.isArray(parsed.products)) {
      return parsed.products;
    }
    if (Array.isArray(parsed.data)) {
      return parsed.data;
    }
  } catch {
    return [];
  }
  return [];
}

function getFixedAuxiliaryImages(): string[] {
  return FIXED_MAIN_AUXILIARY_FILES.map((name) => path.join(FIXED_MAIN_IMAGE_DIR, name)).filter((file) => fs.existsSync(file));
}

function fileHash(filePath: string): string {
  return crypto.createHash("sha1").update(fs.readFileSync(filePath)).digest("hex");
}

function assertMainImageSet(mainImages: string[], productFolder: string): void {
  const missingFiles = FIXED_MAIN_AUXILIARY_FILES
    .map((name) => path.join(FIXED_MAIN_IMAGE_DIR, name))
    .filter((file) => !fs.existsSync(file))
    .map((file) => path.basename(file));
  if (missingFiles.length) {
    throw new Error(`Fixed auxiliary main image(s) were missing: ${missingFiles.join(", ")}`);
  }
  if (mainImages.length !== 1 + FIXED_MAIN_AUXILIARY_FILES.length) {
    throw new Error(
      `Main image upload set must contain 1 generated image plus ${FIXED_MAIN_AUXILIARY_FILES.length} fixed auxiliary image(s) for ${productFolder}; got ${mainImages.length}.`
    );
  }

  const byHash = new Map<string, string[]>();
  for (const filePath of mainImages) {
    const hash = fileHash(filePath);
    byHash.set(hash, [...(byHash.get(hash) || []), filePath]);
  }
  const duplicates = Array.from(byHash.values()).filter((items) => items.length > 1);
  if (duplicates.length) {
    throw new Error(
      `Main image upload set contains duplicate image content: ${duplicates
        .map((items) => items.map((file) => path.basename(file)).join(" = "))
        .join(" | ")}`
    );
  }
}

function whiteBackgroundImagesFromRecord(record: any): string[] {
  return Array.isArray(record?.whiteBackgroundImages)
    ? record.whiteBackgroundImages
        .map((attachment: any) => String(attachment?.localFile || ""))
        .filter(Boolean)
        .map((filePath: string) => path.resolve(filePath))
        .filter((filePath: string) => fs.existsSync(filePath))
    : [];
}

function findFeishuProductRecordById(recordId: string): any | undefined {
  const normalized = String(recordId || "").trim();
  return normalized ? readFeishuProductsData().find((record) => String(record?.recordId || "").trim() === normalized) : undefined;
}

function getFeishuWhiteBackgroundImages(productFolder: string, feishuRecordId?: string): string[] {
  const folderWhiteImages = fs
    .readdirSync(productFolder)
    .filter((name) => isWhiteBackgroundImageFile(name))
    .map((name) => path.join(productFolder, name));
  if (folderWhiteImages.length) {
    return sortByFileRule(folderWhiteImages).slice(0, 1);
  }

  const recordIdWhiteImages = whiteBackgroundImagesFromRecord(findFeishuProductRecordById(feishuRecordId || ""));
  if (recordIdWhiteImages.length) {
    return sortByFileRule(recordIdWhiteImages).slice(0, 1);
  }

  const matchDecision = resolveFeishuAssetRecordForFolder({
    folderSearchParts: [path.basename(productFolder), ...fs.readdirSync(productFolder)],
    records: readFeishuProductsData()
  });
  if (matchDecision.issue && !matchDecision.record) {
    throw new Error(`${matchDecision.issue}: ${productFolder}`);
  }
  const recordWhiteImages = whiteBackgroundImagesFromRecord(matchDecision.record);
  if (recordWhiteImages.length) {
    return sortByFileRule(recordWhiteImages).slice(0, 1);
  }

  return [];
}

function findPrimaryMainImage(productFolder: string): string[] {
  const names = fs.readdirSync(productFolder).sort((a, b) => a.localeCompare(b, "zh-CN"));
  const explicitMainImages = names
    .filter((name) => isNamedMainImageFile(name))
    .map((name) => path.join(productFolder, name));
  if (explicitMainImages.length) {
    return sortByFileRule(preferWatermarkedPrimaryCandidates(explicitMainImages));
  }

  const generatedMainCandidates = names
    .filter((name) => isImageFile(name))
    .filter((name) => !isExcludedMainImage(name))
    .filter((name) => !isAuxiliaryImageFile(name))
    .filter((name) => !isDetailImageFile(name))
    .map((name) => path.join(productFolder, name));

  return sortByFileRule(preferWatermarkedPrimaryCandidates(generatedMainCandidates)).slice(0, 1);
}

export function classifyAssets(productFolder: string, options: { feishuRecordId?: string } = {}): ProductAssets {
  const names = fs.readdirSync(productFolder).sort((a, b) => a.localeCompare(b, "zh-CN"));
  const detailImages: string[] = [];
  const otherFiles: string[] = [];
  let workbookFile: string | undefined;
  const primaryMainImageSet = new Set(findPrimaryMainImage(productFolder).map((item) => path.resolve(item)));

  for (const name of names) {
    const fullPath = path.join(productFolder, name);
    const lower = name.toLowerCase();
    if (lower.endsWith(".xlsx")) {
      workbookFile = fullPath;
      continue;
    }
    if (!fs.statSync(fullPath).isFile()) {
      continue;
    }
    if (isExcludedMainImage(name)) {
      otherFiles.push(fullPath);
      continue;
    }
    if (primaryMainImageSet.has(path.resolve(fullPath))) {
      continue;
    }
    if (isAuxiliaryImageFile(name)) {
      otherFiles.push(fullPath);
      continue;
    }
    if (/^\u4E3B\u56FE.*\.(png|jpg|jpeg|webp)$/i.test(name)) {
      if (!isNamedMainImageFile(name)) {
        otherFiles.push(fullPath);
      }
      continue;
    }
    if (isDetailImageFile(name)) {
      detailImages.push(fullPath);
      continue;
    }
    otherFiles.push(fullPath);
  }

  const mainImages = [...primaryMainImageSet, ...getFixedAuxiliaryImages()];
  const whiteBackgroundImages = getFeishuWhiteBackgroundImages(productFolder, options.feishuRecordId);
  if (primaryMainImageSet.size === 0) {
    throw new Error(`No generated watermarked main image was found in product folder: ${productFolder}`);
  }
  if (whiteBackgroundImages.length === 0) {
    throw new Error(`No Feishu white-background image was found for product folder: ${productFolder}`);
  }
  if (detailImages.length === 0) {
    throw new Error(`No qualification detail images were found in product folder: ${productFolder}`);
  }
  assertMainImageSet(mainImages, productFolder);

  return {
    workbookFile,
    mainImages,
    whiteBackgroundImages,
    detailImages: sortByFileRule(detailImages),
    otherFiles: sortZh(otherFiles)
  };
}

function readImageDimensions(filePath: string): ImageDimensions {
  const buffer = fs.readFileSync(filePath);

  if (
    buffer.length >= 24 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return {
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20)
    };
  }

  if (buffer.length >= 10 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = buffer[offset + 1];
      const size = buffer.readUInt16BE(offset + 2);
      if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb)) {
        return {
          height: buffer.readUInt16BE(offset + 5),
          width: buffer.readUInt16BE(offset + 7)
        };
      }
      if (size < 2) {
        break;
      }
      offset += 2 + size;
    }
  }

  if (buffer.length >= 20 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
    const chunk = buffer.toString("ascii", 12, 16);
    if (chunk === "VP8X" && buffer.length >= 30) {
      return {
        width: 1 + buffer.readUIntLE(24, 3),
        height: 1 + buffer.readUIntLE(27, 3)
      };
    }
    if (chunk === "VP8 " && buffer.length >= 30) {
      return {
        width: buffer.readUInt16LE(26) & 0x3fff,
        height: buffer.readUInt16LE(28) & 0x3fff
      };
    }
    if (chunk === "VP8L" && buffer.length >= 25) {
      const bits = buffer.readUInt32LE(21);
      return {
        width: (bits & 0x3fff) + 1,
        height: ((bits >> 14) & 0x3fff) + 1
      };
    }
  }

  throw new Error(`Unsupported main image format for dimension check: ${path.basename(filePath)}`);
}

export function validateMainImageAspectRatio(mainImages: string[]): string {
  const invalidImages = mainImages
    .map((filePath) => {
      const { width, height } = readImageDimensions(filePath);
      const ratio = width / height;
      const diff = Math.abs(ratio - REQUIRED_MAIN_IMAGE_RATIO);
      return diff > REQUIRED_MAIN_IMAGE_RATIO_TOLERANCE
        ? `${path.basename(filePath)}(${width}x${height}, ratio=${ratio.toFixed(4)})`
        : "";
    })
    .filter(Boolean);

  if (!invalidImages.length) {
    return "";
  }

  return `Main images must already satisfy 1:1 ratio before upload. Invalid files: ${invalidImages.join(
    ", "
  )}`;
}
