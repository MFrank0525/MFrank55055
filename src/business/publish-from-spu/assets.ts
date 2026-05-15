import fs from "node:fs";
import path from "node:path";
import {
  FIXED_MAIN_AUXILIARY_FILES,
  FIXED_MAIN_IMAGE_DIR,
  REQUIRED_MAIN_IMAGE_RATIO,
  REQUIRED_MAIN_IMAGE_RATIO_TOLERANCE
} from "./constants.js";
import type { ImageDimensions, ProductAssets } from "./types.js";

function sortZh(items: string[]): string[] {
  return [...items].sort((a, b) => a.localeCompare(b, "zh-CN"));
}

function extractTrailingOrder(name: string): number {
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

function getFixedAuxiliaryImages(): string[] {
  return FIXED_MAIN_AUXILIARY_FILES.map((name) => path.join(FIXED_MAIN_IMAGE_DIR, name)).filter((file) => fs.existsSync(file));
}

function findPrimaryMainImage(productFolder: string): string[] {
  const names = fs.readdirSync(productFolder).sort((a, b) => a.localeCompare(b, "zh-CN"));
  const explicitMainImages = names
    .filter((name) => isNamedMainImageFile(name))
    .map((name) => path.join(productFolder, name));
  if (explicitMainImages.length) {
    return sortByFileRule(explicitMainImages);
  }

  const generatedMainCandidates = names
    .filter((name) => isImageFile(name))
    .filter((name) => !isExcludedMainImage(name))
    .filter((name) => !isAuxiliaryImageFile(name))
    .filter((name) => !isDetailImageFile(name))
    .map((name) => path.join(productFolder, name));

  return sortByFileRule(generatedMainCandidates).slice(0, 1);
}

export function classifyAssets(productFolder: string): ProductAssets {
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
  if (primaryMainImageSet.size === 0) {
    throw new Error(`No Dreamina watermarked main image was found in product folder: ${productFolder}`);
  }
  if (detailImages.length === 0) {
    throw new Error(`No qualification detail images were found in product folder: ${productFolder}`);
  }

  return {
    workbookFile,
    mainImages,
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

  if (buffer.length >= 30 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
    const chunk = buffer.toString("ascii", 12, 16);
    if (chunk === "VP8X" && buffer.length >= 30) {
      return {
        width: 1 + buffer.readUIntLE(24, 3),
        height: 1 + buffer.readUIntLE(27, 3)
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
