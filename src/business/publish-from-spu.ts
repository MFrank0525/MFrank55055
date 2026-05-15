import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import type { Locator, Page } from "playwright";
import { launchPersistentBrowser } from "../browser/launch.js";
import { logInfo, logWarn } from "../utils/logger.js";

export interface PublishFromSpuJobInput {
  shopFolder: string;
  productFolder: string;
  mode?:
    | "prepare"
    | "open_platform_spu"
    | "query_platform_spu"
    | "inspect_publish_page"
    | "run_publish_flow"
    | "run_graphic_flow"
    | "run_pre_publish_flow"
    | "run_service_flow";
  metadata?: {
    brand?: string;
    spu?: string;
    title?: string;
    shortTitle?: string;
    modelSpec?: string;
  };
  publishPageUrl?: string;
  headless?: boolean;
  retryOnSystemError?: boolean;
}

export interface PublishFromSpuJobOptions {
  runId?: string;
  runtimeDir?: string;
  resultFile?: string;
}

export interface PublishFromSpuJobResult {
  ok: boolean;
  status: string;
  message: string;
  startedAt: string;
  finishedAt: string;
  runtimeDir: string;
  artifacts: {
    resultFile: string;
    screenshots: string[];
  };
  data?: unknown;
  error?: {
    code: string;
    message: string;
    stack?: string;
  };
}

const FIXED_SPEC_NAME = "\u5E97\u94FA\u5468\u5E74\u5E86\u00B7\u5148\u5230\u5148\u5F97";
const FIXED_SPEC_VALUES = [
  "\u2764\u2764\u2764\u5468\u5E74\u5E86\u6D3B\u52A8\u3010\u4E702\u90011\u3011\u5230\u624B3\u76D2\u2764\u2764",
  "\u3010\u65E5\u5E38\u517B\u62A4\u3011\u4E24\u76D2\u88C51.11_11.1",
  "\u3010\u8D35\u5728\u8FD0\u8D39\u3011\u4E00\u76D2\u88C5\u3010\u592A\u4E0D\u5212\u7B97\u3011",
  "\u2764\u2764\u2764\u5468\u5E74\u5E86\u6D3B\u52A8\u3010\u6B63\u88C5\u4E00\u76D2\u3011\u5148\u5230\u5148\u5F97"
];
const FIXED_PRICES = [89, 86, 69.9, 39.9];
const FIXED_STOCK = 1000;
const FIXED_FREIGHT_TEMPLATE_KEYWORD = "\u5ef6\u8349\u8fd0\u8d39";
const SPEC_TEMPLATE_KEYWORD_DEFAULT = "\u4e702\u90011";
const SPEC_TEMPLATE_KEYWORD_JIUGUANG = "\u4e45\u5149\u5c0f\u6cfd";
const FIXED_MAIN_IMAGE_DIR = path.resolve(process.cwd(), "input", "fixed-main-images");
const FIXED_MAIN_AUXILIARY_FILES = ["\u8f85\u52a9\u56fe02.png", "\u8f85\u52a9\u56fe03.png", "\u8f85\u52a9\u56fe04.png", "\u8f85\u52a9\u56fe05.png"];
const REQUIRED_MAIN_IMAGE_RATIO = 1;
const REQUIRED_MAIN_IMAGE_RATIO_TOLERANCE = 0.02;
const GRAPHIC_SECTION_LABELS = ["\u4e3b\u56fe", "\u4e3b\u56fe3:4", "\u767d\u5e95\u56fe", "\u8be6\u60c5\u9875"];
const FORBIDDEN_GRAPHIC_SECTION_LABELS = ["\u4e3b\u56fe3:4", "\u767d\u5e95\u56fe"];
const PLATFORM_SPU_QUERY_RULE =
  "\u6807\u54c1\u68c0\u7d22\u65f6\uff0c\u54c1\u724c\u5fc5\u987b\u4e25\u683c\u4f7f\u7528\u8868\u683c\u91cc\u83b7\u53d6\u7684\u54c1\u724c\u4fe1\u606f\uff0cSPU\u5fc5\u987b\u4e25\u683c\u4f7f\u7528\u8868\u683c\u91cc\u83b7\u53d6\u7684SPU\u4fe1\u606f\uff0c\u4e0d\u5141\u8bb8\u7a0b\u5e8f\u81ea\u521b\u6216\u63a8\u6d4b\u66ff\u6362\u67e5\u8be2\u503c";
const PLATFORM_SPU_URL =
  "https://fxg.jinritemai.com/ffa/g/spu-record?type=create&btm_ppre=a2427.b76571.c902327.d871297&btm_pre=a2427.b39372.c67909.d0&btm_show_id=1f4fb4cd-7a30-4c1d-8d9c-6250a9e7a466";

interface ProductSheetSummary {
  brand?: string;
  spu?: string;
  title?: string;
  shortTitle?: string;
  modelSpec?: string;
  rows: string[][];
  parseError?: string;
}

interface ProductAssets {
  workbookFile?: string;
  mainImages: string[];
  detailImages: string[];
  otherFiles: string[];
}

interface ImageDimensions {
  width: number;
  height: number;
}

interface QueryMatchCandidate {
  rowText: string;
  normalizedText: string;
  clickX: number;
  clickY: number;
}

interface QueryDiagnosticError extends Error {
  screenshotFile?: string;
  candidateRows?: string[];
  candidateIds?: string[];
}

type PublishFlowStage = {
  step: string;
  status: "completed" | "failed";
};

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

function findWorkbook(productFolder: string): string | undefined {
  return fs
    .readdirSync(productFolder)
    .filter((name) => name.toLowerCase().endsWith(".xlsx"))
    .sort((a, b) => a.localeCompare(b, "zh-CN"))[0];
}

function classifyAssets(productFolder: string): ProductAssets {
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

function validateMainImageAspectRatio(mainImages: string[]): string {
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

async function readWorksheetRows(xlsxPath: string): Promise<string[][]> {
  const zip = fs.readFileSync(xlsxPath);

  const readZipEntryText = (entryName: string): string | undefined => {
    const eocdSignature = 0x06054b50;
    let eocdOffset = -1;
    for (let index = zip.length - 22; index >= Math.max(0, zip.length - 65557); index -= 1) {
      if (zip.readUInt32LE(index) === eocdSignature) {
        eocdOffset = index;
        break;
      }
    }
    if (eocdOffset < 0) {
      throw new Error("Invalid xlsx zip: end of central directory not found.");
    }

    const totalEntries = zip.readUInt16LE(eocdOffset + 10);
    const centralDirectoryOffset = zip.readUInt32LE(eocdOffset + 16);
    let offset = centralDirectoryOffset;

    for (let index = 0; index < totalEntries; index += 1) {
      if (zip.readUInt32LE(offset) !== 0x02014b50) {
        throw new Error("Invalid xlsx zip: central directory entry signature mismatch.");
      }

      const compressionMethod = zip.readUInt16LE(offset + 10);
      const compressedSize = zip.readUInt32LE(offset + 20);
      const fileNameLength = zip.readUInt16LE(offset + 28);
      const extraLength = zip.readUInt16LE(offset + 30);
      const commentLength = zip.readUInt16LE(offset + 32);
      const localHeaderOffset = zip.readUInt32LE(offset + 42);
      const fileName = zip.toString("utf8", offset + 46, offset + 46 + fileNameLength);

      if (fileName === entryName) {
        if (zip.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
          throw new Error(`Invalid xlsx zip: local header missing for ${entryName}.`);
        }

        const localFileNameLength = zip.readUInt16LE(localHeaderOffset + 26);
        const localExtraLength = zip.readUInt16LE(localHeaderOffset + 28);
        const dataStart = localHeaderOffset + 30 + localFileNameLength + localExtraLength;
        const compressed = zip.subarray(dataStart, dataStart + compressedSize);

        if (compressionMethod === 0) {
          return Buffer.from(compressed).toString("utf8");
        }
        if (compressionMethod === 8) {
          return zlib.inflateRawSync(compressed).toString("utf8");
        }
        throw new Error(`Unsupported zip compression method ${compressionMethod} for ${entryName}.`);
      }

      offset += 46 + fileNameLength + extraLength + commentLength;
    }

    return undefined;
  };

  const decodeXml = (value: string): string =>
    value
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, "&");

  const stripTags = (value: string): string => decodeXml(value.replace(/<[^>]+>/g, ""));

  const sharedXmlText = readZipEntryText("xl/sharedStrings.xml");
  const shared: string[] = [];
  if (sharedXmlText) {
    for (const match of sharedXmlText.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
      shared.push(stripTags(match[1]).trim());
    }
  }

  const sheetXmlText = readZipEntryText("xl/worksheets/sheet1.xml");
  if (!sheetXmlText) {
    throw new Error("sheet1.xml not found in workbook");
  }

  const rows: string[][] = [];
  for (const rowMatch of sheetXmlText.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const values: string[] = [];
    for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = cellMatch[1];
      const body = cellMatch[2];
      const type = attrs.match(/\bt="([^"]+)"/)?.[1] || "";
      let value = "";

      if (type === "s") {
        const indexText = body.match(/<v>([\s\S]*?)<\/v>/)?.[1]?.trim() || "";
        const sharedIndex = Number(indexText);
        if (Number.isInteger(sharedIndex) && sharedIndex >= 0 && sharedIndex < shared.length) {
          value = shared[sharedIndex];
        }
      } else if (type === "inlineStr") {
        value = stripTags(body);
      } else {
        value = decodeXml(body.match(/<v>([\s\S]*?)<\/v>/)?.[1]?.trim() || "");
      }

      const normalized = value.trim();
      if (normalized) {
        values.push(normalized);
      }
    }

    if (values.length) {
      rows.push(values);
    }
  }

  return rows;
}

function normalizeMatchText(value: string): string {
  return value.replace(/\s+/g, "").trim().toLowerCase();
}

function attachSafeDialogHandler(page: Page): void {
  page.on("dialog", (dialog) => {
    dialog.dismiss().catch(() => {});
  });
}

async function gotoWithTolerance(page: Page, url: string, waitMs = 3500): Promise<void> {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/ERR_ABORTED/i.test(message)) {
      throw error;
    }
  }
  await page.waitForTimeout(waitMs);
}

async function savePageScreenshot(page: Page, runtimeDir: string, fileName: string): Promise<string> {
  if (page.isClosed()) {
    return "";
  }
  const screenshotDir = path.join(runtimeDir, "screenshots");
  fs.mkdirSync(screenshotDir, { recursive: true });
  const screenshotFile = path.join(screenshotDir, fileName);
  try {
    await page.screenshot({ path: screenshotFile, fullPage: false, timeout: 5000 });
    return screenshotFile;
  } catch {
    return "";
  }
}

async function closeExtraPages(
  context: Awaited<ReturnType<typeof launchPersistentBrowser>>,
  keepPages: Page[]
): Promise<void> {
  const keep = new Set(keepPages.filter((page) => !page.isClosed()));
  for (const page of context.pages()) {
    if (keep.has(page) || page.isClosed()) {
      continue;
    }
    await page.close().catch(() => {});
  }
}

async function summarizeWorkbook(xlsxPath?: string): Promise<ProductSheetSummary> {
  if (!xlsxPath) {
    return { rows: [] };
  }

  try {
    const rows = await readWorksheetRows(xlsxPath);
    return {
      rows,
      title: rows[1]?.[1]?.trim() || "",
      shortTitle: rows[2]?.[1]?.trim() || "",
      brand: rows[3]?.[1]?.trim() || "",
      spu: rows[4]?.[1]?.trim() || "",
      modelSpec: rows[5]?.[1]?.trim() || ""
    };
  } catch (error) {
    return {
      rows: [],
      parseError: error instanceof Error ? error.message : String(error)
    };
  }
}

function assertResolvedMetadata(
  metadata: {
    brand: string;
    spu: string;
    title: string;
    shortTitle: string;
    modelSpec: string;
  },
  mode: string
): void {
  const missingFields: string[] = [];
  if (!metadata.brand.trim()) {
    missingFields.push("brand");
  }
  if (!metadata.spu.trim()) {
    missingFields.push("spu");
  }
  if (!metadata.title.trim()) {
    missingFields.push("title");
  }
  if (!metadata.shortTitle.trim()) {
    missingFields.push("shortTitle");
  }
  if (!metadata.modelSpec.trim()) {
    missingFields.push("modelSpec");
  }
  if (missingFields.length > 0) {
    throw new Error(`Publish workbook metadata was incomplete for mode=${mode}: ${missingFields.join(", ")}`);
  }
}

function assertProductAssetsForShop(
  assets: ProductAssets,
  shopFolder: string,
  productFolder: string
): void {
  const expectedShopName = normalizeShopName(path.basename(shopFolder));
  const expectedShopVariants = new Set<string>([expectedShopName]);
  if (expectedShopName.includes("延草纲目健康护理专营店")) {
    expectedShopVariants.add("延草纲目健康护理旗舰店");
  }
  if (expectedShopName.includes("延草纲目健康护理旗舰店")) {
    expectedShopVariants.add("延草纲目健康护理专营店");
  }
  const primaryMainImage = assets.mainImages[0] || "";
  if (!primaryMainImage) {
    throw new Error(`Primary main image was missing for product folder: ${productFolder}`);
  }

  const mainImageName = normalizeShopName(path.basename(primaryMainImage));
  if (![...expectedShopVariants].some((variant) => mainImageName.includes(variant))) {
    throw new Error(
      `Primary main image watermark shop did not match current shop folder. shop=${[...expectedShopVariants].join(" / ")}, image=${path.basename(primaryMainImage)}`
    );
  }

  for (const detailImage of assets.detailImages) {
    const detailImageName = path.basename(detailImage);
    if (!/资质|医疗器械注册证|医疗器械备案|白装展开图|包装展开图/i.test(detailImageName)) {
      throw new Error(`Detail image did not look like a qualification/detail asset: ${detailImageName}`);
    }
  }
}

async function ensurePlatformSpuPage(runtimeDir: string, shopFolder?: string): Promise<{
  pageUrl: string;
  pageTitle: string;
  screenshotFile: string;
}> {
  const context = await launchPersistentBrowser();
  try {
    const page = context.pages().find((item) => !item.isClosed()) || (await context.newPage());
    attachSafeDialogHandler(page);
    await page.bringToFront();
    await gotoWithTolerance(page, PLATFORM_SPU_URL, 3000);
    if (shopFolder) {
      await ensureShopContext(page, runtimeDir, shopFolder);
      await gotoWithTolerance(page, PLATFORM_SPU_URL, 3000);
    }

    const screenshotFile = await savePageScreenshot(page, runtimeDir, "platform-spu-entry.png");

    return {
      pageUrl: page.url(),
      pageTitle: await page.title(),
      screenshotFile
    };
  } finally {
    await context.browser()?.close().catch(() => {});
  }
}

function normalizeShopName(value: string): string {
  return value.replace(/^\d+/, "").replace(/\s+/g, "").trim();
}

function resolveExpectedShopName(shopFolder: string): string {
  return normalizeShopName(path.basename(shopFolder));
}

async function detectCurrentShopName(page: Page): Promise<string> {
  return page.evaluate(() => {
    const normalize = (value: string): string => value.replace(/^\d+/, "").replace(/\s+/g, "").trim();
    const candidates = Array.from(document.querySelectorAll("body *"))
      .map((node) => node as HTMLElement)
      .map((el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        const text = normalize(el.innerText || el.textContent || "");
        if (
          !text ||
          rect.width <= 0 ||
          rect.height <= 0 ||
          style.display === "none" ||
          style.visibility === "hidden" ||
          rect.top > 180 ||
          rect.left < window.innerWidth * 0.68 ||
          !/(旗舰店|专营店|专卖店|店铺)/.test(text)
        ) {
          return null;
        }
        const marker = [String(el.className || ""), el.getAttribute("role") || "", el.tagName].join(" ").toLowerCase();
        const score =
          (marker.includes("header") ? 30 : 0) +
          (marker.includes("dropdown") ? 25 : 0) +
          (marker.includes("avatar") ? 20 : 0) +
          (marker.includes("user") ? 20 : 0) +
          (rect.top < 100 ? 15 : 0) -
          text.length / 4;
        return { text, score };
      })
      .filter(Boolean)
      .sort((a, b) => (b?.score || 0) - (a?.score || 0));

    return candidates[0]?.text || "";
  });
}

async function readCurrentShopNameFromMenu(page: Page): Promise<string> {
  return page.evaluate(() => {
    const normalize = (value: string): string => value.replace(/^\d+/, "").replace(/\s+/g, "").trim();
    const menus = Array.from(document.querySelectorAll("body *"))
      .map((node) => node as HTMLElement)
      .filter((el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        const text = normalize(el.innerText || el.textContent || "");
        return (
          text.includes("切换组织/店铺") &&
          text.includes("退出") &&
          rect.width > 180 &&
          rect.height > 200 &&
          rect.top < 180 &&
          rect.left > window.innerWidth * 0.72 &&
          style.display !== "none" &&
          style.visibility !== "hidden"
        );
      })
      .sort((a, b) => {
        const aRect = a.getBoundingClientRect();
        const bRect = b.getBoundingClientRect();
        return aRect.left - bRect.left || aRect.top - bRect.top;
      });

    const menu = menus[0];
    if (!menu) {
      return "";
    }

    const candidates = Array.from(menu.querySelectorAll("*"))
      .map((node) => node as HTMLElement)
      .map((el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        const text = normalize(el.innerText || el.textContent || "");
        if (
          !text ||
          !/(旗舰店|专营店|专卖店|店铺)/.test(text) ||
          (!text.includes("延草纲目") && text.length < 8) ||
          text.includes("切换组织/店铺") ||
          text.includes("店铺信息") ||
          text.includes("登录账号") ||
          text.includes("子账号") ||
          text.includes("退出") ||
          rect.width <= 0 ||
          rect.height <= 0 ||
          style.display === "none" ||
          style.visibility === "hidden"
        ) {
          return null;
        }
        const score = (rect.top < menu.getBoundingClientRect().top + 80 ? 60 : 0) - text.length / 4 - rect.top / 100;
        return { text, score };
      })
      .filter(Boolean)
      .sort((a, b) => (b?.score || 0) - (a?.score || 0));

    return candidates[0]?.text || "";
  });
}

async function pageContainsExpectedShop(page: Page, expectedShopName: string): Promise<boolean> {
  const normalizedExpected = normalizeShopName(expectedShopName);
  if (!normalizedExpected) {
    return false;
  }
  return page.evaluate((target) => {
    const normalize = (value: string): string => value.replace(/^\d+/, "").replace(/\s+/g, "").trim();
    const bodyText = normalize(document.body.innerText || "");
    if (bodyText.includes(target)) {
      return true;
    }
    const prefix = target.slice(0, Math.min(8, target.length));
    return Boolean(prefix) && bodyText.includes(prefix);
  }, normalizedExpected);
}

async function clickTopRightShopMenu(page: Page): Promise<boolean> {
  const menuVisible = async (): Promise<boolean> =>
    page.evaluate(() => {
      const text = (document.body.innerText || "").replace(/\s+/g, "");
      return text.includes("切换组织/店铺") || text.includes("退出");
    });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const point = await page.evaluate(() => {
      const normalize = (value: string): string => value.replace(/\s+/g, "").trim();
      const candidates = Array.from(document.querySelectorAll("body *"))
        .map((node) => node as HTMLElement)
        .map((el) => {
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          const text = normalize(el.innerText || el.textContent || "");
          if (
            !text ||
            rect.width <= 0 ||
            rect.height <= 0 ||
            style.display === "none" ||
            style.visibility === "hidden" ||
            rect.top > 180 ||
            rect.left < window.innerWidth * 0.68 ||
            !/(旗舰店|专营店|专卖店|店铺)/.test(text)
          ) {
            return null;
          }
          const marker = [String(el.className || ""), el.getAttribute("role") || "", el.tagName].join(" ").toLowerCase();
          const score =
            (marker.includes("header") ? 30 : 0) +
            (marker.includes("dropdown") ? 25 : 0) +
            (marker.includes("avatar") ? 20 : 0) +
            (marker.includes("user") ? 20 : 0) +
            (rect.top < 100 ? 15 : 0) -
            text.length / 4;
          return {
            x: rect.x + rect.width / 2,
            y: rect.y + rect.height / 2,
            score
          };
        })
        .filter(Boolean)
        .sort((a, b) => (b?.score || 0) - (a?.score || 0));
      return candidates[0] || null;
    });

    if (!point) {
      const fallbackPoint = { x: 1444, y: 34 };
      await page.mouse.click(fallbackPoint.x, fallbackPoint.y, { delay: 90 }).catch(() => {});
      await page.waitForTimeout(700 + attempt * 250);
      if (await menuVisible()) {
        return true;
      }
      continue;
    }
    await page.mouse.click(point.x, point.y, { delay: 90 });
    await page.waitForTimeout(700 + attempt * 250);
    if (await menuVisible()) {
      return true;
    }

    const fallbackPoint = { x: 1444, y: 34 };
    await page.mouse.click(fallbackPoint.x, fallbackPoint.y, { delay: 90 }).catch(() => {});
    await page.waitForTimeout(700 + attempt * 250);
    if (await menuVisible()) {
      return true;
    }
  }
  return false;
}

async function clickVisibleActionText(page: Page, text: string): Promise<boolean> {
  const point = await page.evaluate((targetText) => {
    const normalize = (value: string): string => value.replace(/\s+/g, "").trim();
    const target = normalize(targetText);
    const matches = Array.from(document.querySelectorAll("body *"))
      .map((node) => node as HTMLElement)
      .map((el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        const textValue = normalize(el.innerText || el.textContent || "");
        if (
          !textValue ||
          textValue !== target ||
          rect.width <= 0 ||
          rect.height <= 0 ||
          style.display === "none" ||
          style.visibility === "hidden"
        ) {
          return null;
        }
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      })
      .filter(Boolean);
    return matches[0] || null;
  }, text);

  if (!point) {
    return false;
  }
  await page.mouse.click(point.x, point.y, { delay: 90 });
  await page.waitForTimeout(800);
  return true;
}

async function clickShopSwitchEntry(page: Page): Promise<boolean> {
  const point = await page.evaluate(() => {
    const normalize = (value: string): string => value.replace(/\s+/g, "").trim();
    const target = normalize("切换组织/店铺");
    const items = Array.from(document.querySelectorAll("body *"))
      .map((node) => node as HTMLElement)
      .map((el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        const text = normalize(el.innerText || el.textContent || "");
        if (
          !text ||
          !text.includes(target) ||
          rect.width < 160 ||
          rect.height < 28 ||
          style.display === "none" ||
          style.visibility === "hidden" ||
          rect.left < window.innerWidth * 0.72
        ) {
          return null;
        }
        const score =
          (text === target ? 120 : 0) +
          (rect.width > 220 ? 30 : 0) +
          (rect.top < 520 ? 10 : 0) -
          Math.abs(rect.height - 44);
        return {
          x: rect.x + Math.min(rect.width - 28, rect.width * 0.88),
          y: rect.y + rect.height / 2,
          score
        };
      })
      .filter(Boolean)
      .sort((a, b) => (b?.score || 0) - (a?.score || 0));
    return items[0] || null;
  });

  if (!point) {
    return false;
  }
  await page.mouse.click(point.x, point.y, { delay: 90 });
  await page.waitForTimeout(900);
  return true;
}

async function waitForChooseShopDialog(page: Page): Promise<boolean> {
  const dialogByLocator = page
    .locator("div[role='dialog'], div[aria-modal='true'], .semi-modal, .ant-modal, .ecom-g-modal, [class*='modal']")
    .filter({ hasText: "请选择店铺" })
    .first();
  if (await dialogByLocator.isVisible().catch(() => false)) {
    return true;
  }
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const visible = await page.evaluate(() => {
      const text = (document.body.innerText || "").replace(/\s+/g, "");
      return text.includes("请选择店铺");
    });
    if (visible) {
      return true;
    }
    await page.waitForTimeout(400);
  }
  return false;
}

async function saveShopSwitchDomSnapshot(page: Page, runtimeDir: string, fileName: string): Promise<string> {
  const html = await page.evaluate(() => {
    const normalize = (value: string): string => String(value || "").replace(/\s+/g, " ").trim();
    const menuCandidates = Array.from(document.querySelectorAll("body *"))
      .map((node) => node as HTMLElement)
      .filter((el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        const text = normalize(el.innerText || el.textContent || "");
        return (
          text &&
          (text.includes("切换组织/店铺") || text.includes("退出") || text.includes("请选择店铺")) &&
          rect.width > 100 &&
          rect.height > 24 &&
          style.display !== "none" &&
          style.visibility !== "hidden"
        );
      })
      .slice(0, 10)
      .map((el) => el.outerHTML);
    return menuCandidates.join("\n\n<!-- split -->\n\n");
  });
  const targetFile = path.join(runtimeDir, fileName);
  fs.mkdirSync(path.dirname(targetFile), { recursive: true });
  fs.writeFileSync(targetFile, html || "", "utf8");
  return targetFile;
}

async function getChooseShopDialog(page: Page): Promise<Locator | null> {
  const dialog = page
    .locator("div[role='dialog'], div[aria-modal='true'], .semi-modal, .ant-modal, .ecom-g-modal, [class*='modal']")
    .filter({ hasText: "请选择店铺" })
    .first();
  if (await dialog.isVisible().catch(() => false)) {
    return dialog;
  }
  return null;
}

async function selectShopFromDialogExact(page: Page, expectedShopName: string): Promise<boolean> {
  const dialog = await getChooseShopDialog(page);
  if (!dialog) {
    return false;
  }

  const cards = dialog.locator(".index_roleItem__1-Hwe");
  const normalizeText = (value: string): string => value.replace(/\s+/g, "").trim();

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const visibleCardCount = await cards.count().catch(() => 0);
    for (let index = 0; index < visibleCardCount; index += 1) {
      const card = cards.nth(index);
      if (!(await card.isVisible().catch(() => false))) {
        continue;
      }
      const nameText = await card
        .locator(".index_introName__fRtLx")
        .first()
        .textContent()
        .then((value) => normalizeText(value || ""))
        .catch(() => "");
      if (nameText !== normalizeText(expectedShopName)) {
        continue;
      }

      await card.scrollIntoViewIfNeeded().catch(() => {});
      const arrow = card.locator(".index_rightArrowIcon__24nod").first();
      const arrowClicked = await arrow
        .click({ timeout: 2000 })
        .then(() => true)
        .catch(() => false);
      if (!arrowClicked) {
        const box = await card.boundingBox().catch(() => null);
        if (!box) {
          continue;
        }

        const clickX = box.x + box.width / 2;
        const clickY = box.y + box.height / 2;
        await page.mouse.click(clickX, clickY).catch(() => {});
      }
      await page.waitForTimeout(1800);
      const dialogStillVisible = await waitForChooseShopDialog(page);
      if (!dialogStillVisible) {
        return true;
      }
    }

    const scrolled = await dialog
      .locator(".index_roleList__2YMEN, div, ul")
      .evaluateAll((nodes) => {
        const candidates = nodes
          .map((node) => node as HTMLElement)
          .filter((el) => el.scrollHeight > el.clientHeight + 40 && el.clientHeight > 180)
          .sort((a, b) => b.clientHeight - a.clientHeight);
        const target = candidates[0];
        if (!target) {
          return false;
        }
        target.scrollTop = Math.min(target.scrollTop + Math.max(260, Math.floor(target.clientHeight * 0.75)), target.scrollHeight);
        return true;
      })
      .catch(() => false);
    if (!scrolled) {
      break;
    }
    await page.waitForTimeout(450);
  }

  return false;
}

async function selectShopFromDialog(page: Page, expectedShopName: string): Promise<boolean> {
  const exactMatched = await selectShopFromDialogExact(page, expectedShopName);
  if (exactMatched) {
    return true;
  }
  const normalizedExpected = normalizeShopName(expectedShopName);
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const candidate = await page.evaluate((target) => {
      const normalize = (value: string): string => value.replace(/^\d+/, "").replace(/\s+/g, "").trim();
      const modal = Array.from(document.querySelectorAll("body *"))
        .map((node) => node as HTMLElement)
        .find((el) => {
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          const text = normalize(el.innerText || el.textContent || "");
          return (
            text.includes("请选择店铺") &&
            rect.width > 300 &&
            rect.height > 240 &&
            style.display !== "none" &&
            style.visibility !== "hidden"
          );
        });
      if (!modal) {
        return { found: false, scrollable: false };
      }

      const scrollContainer =
        (Array.from(modal.querySelectorAll("*"))
          .map((node) => node as HTMLElement)
          .find((el) => el.scrollHeight > el.clientHeight + 40 && el.clientHeight > 180) as HTMLElement | undefined) ||
        modal;

      const modalRect = modal.getBoundingClientRect();
      const nodes = Array.from(modal.querySelectorAll("*")).map((node) => node as HTMLElement);
      const cards = nodes
        .map((el) => {
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          const text = normalize(el.innerText || el.textContent || "");
          if (
            !text ||
            rect.width <= 30 ||
            rect.height <= 16 ||
            style.display === "none" ||
            style.visibility === "hidden" ||
            !text.includes(target) ||
            rect.width > modalRect.width * 0.92
          ) {
            return null;
          }

          let card = el;
          for (let depth = 0; depth < 6; depth += 1) {
            const parent = card.parentElement as HTMLElement | null;
            if (!parent) {
              break;
            }
            const parentRect = parent.getBoundingClientRect();
            const parentText = normalize(parent.innerText || parent.textContent || "");
            const parentStyle = window.getComputedStyle(parent);
            if (
              parentText.includes(target) &&
              parentRect.width >= 220 &&
              parentRect.height >= 56 &&
              parentRect.width < modalRect.width * 0.92 &&
              parentStyle.display !== "none" &&
              parentStyle.visibility !== "hidden"
            ) {
              card = parent;
              continue;
            }
            break;
          }

          const cardRect = card.getBoundingClientRect();
          const cardText = normalize(card.innerText || card.textContent || "");
          if (
            !cardText.includes(target) ||
            cardRect.width < 220 ||
            cardRect.height < 56 ||
            cardRect.width > modalRect.width * 0.92
          ) {
            return null;
          }

          const exactText = text === target;
          const exactCard = cardText === target;
          const exactScore =
            (exactText ? 400 : 0) +
            (exactCard ? 260 : 0) +
            (cardText.includes(target) ? 80 : 0) -
            Math.abs(cardRect.height - 88) -
            cardText.length / 5;
          return {
            x: cardRect.x + cardRect.width / 2,
            y: cardRect.y + cardRect.height / 2,
            text: cardText,
            score: exactScore
          };
        })
        .filter(Boolean)
        .sort((a, b) => (b?.score || 0) - (a?.score || 0) || (a?.y || 0) - (b?.y || 0));

      if (cards[0]) {
        return {
          found: true,
          x: cards[0].x,
          y: cards[0].y,
          scrollable: scrollContainer.scrollHeight > scrollContainer.clientHeight + 40
        };
      }

      if (scrollContainer.scrollHeight > scrollContainer.clientHeight + 40) {
        scrollContainer.scrollTop = Math.min(
          scrollContainer.scrollTop + Math.max(260, Math.floor(scrollContainer.clientHeight * 0.75)),
          scrollContainer.scrollHeight
        );
        return { found: false, scrollable: true };
      }

      return { found: false, scrollable: false };
    }, normalizedExpected);

    if (candidate.found && typeof candidate.x === "number" && typeof candidate.y === "number") {
      await page.mouse.click(candidate.x, candidate.y, { delay: 90 });
      await page.waitForTimeout(1800);
      return true;
    }
    if (!candidate.scrollable) {
      return false;
    }
    await page.waitForTimeout(500);
  }
  return false;
}

async function ensureShopContext(page: Page, runtimeDir: string, shopFolder: string): Promise<string> {
  const expectedShopName = resolveExpectedShopName(shopFolder);
  if (!expectedShopName) {
    return "";
  }

  const currentBefore = normalizeShopName(await detectCurrentShopName(page));
  if (currentBefore && currentBefore.includes(expectedShopName)) {
    return currentBefore;
  }

  let lastActual = currentBefore || "";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const menuOpened = await clickTopRightShopMenu(page);
    if (!menuOpened) {
      const screenshotFile = await savePageScreenshot(page, runtimeDir, "shop-switch-menu-missing.png").catch(() => "");
      throw new Error(`Shop switch failed: could not open top-right shop menu for ${expectedShopName}${screenshotFile ? `; screenshot=${screenshotFile}` : ""}`);
    }

    let switcherClicked = await clickShopSwitchEntry(page);
    if (!switcherClicked) {
      switcherClicked = await clickVisibleActionText(page, "切换组织/店铺");
    }
    if (!switcherClicked) {
      await saveShopSwitchDomSnapshot(page, runtimeDir, "shop-switch-entry-missing.html").catch(() => "");
      const screenshotFile = await savePageScreenshot(page, runtimeDir, "shop-switch-entry-missing.png").catch(() => "");
      throw new Error(`Shop switch failed: could not find 切换组织/店铺 for ${expectedShopName}${screenshotFile ? `; screenshot=${screenshotFile}` : ""}`);
    }

    let dialogVisible = await waitForChooseShopDialog(page);
    if (!dialogVisible) {
      await clickShopSwitchEntry(page).catch(() => false);
      dialogVisible = await waitForChooseShopDialog(page);
    }
    if (!dialogVisible) {
      await saveShopSwitchDomSnapshot(page, runtimeDir, "shop-switch-dialog-missing.html").catch(() => "");
      const screenshotFile = await savePageScreenshot(page, runtimeDir, "shop-switch-dialog-missing.png").catch(() => "");
      throw new Error(`Shop switch failed: 请选择店铺 dialog did not appear for ${expectedShopName}${screenshotFile ? `; screenshot=${screenshotFile}` : ""}`);
    }

    const selected = await selectShopFromDialog(page, expectedShopName);
    if (!selected) {
      const screenshotFile = await savePageScreenshot(page, runtimeDir, "shop-switch-target-missing.png").catch(() => "");
      throw new Error(`Shop switch failed: target shop not found in selector for ${expectedShopName}${screenshotFile ? `; screenshot=${screenshotFile}` : ""}`);
    }

    await page.waitForLoadState("domcontentloaded").catch(() => {});
    await page.waitForTimeout(2200 + attempt * 700);
    await clickTopRightShopMenu(page).catch(() => false);
    await page.waitForTimeout(500);
    const currentFromMenu = normalizeShopName(await readCurrentShopNameFromMenu(page));
    const currentAfter = currentFromMenu || normalizeShopName(await detectCurrentShopName(page));
    const bodyConfirmed = await pageContainsExpectedShop(page, expectedShopName);
    if ((currentAfter && currentAfter.includes(expectedShopName)) || bodyConfirmed) {
      await page.keyboard.press("Escape").catch(() => {});
      return currentAfter || expectedShopName;
    }
    lastActual = currentAfter || "";
    await page.keyboard.press("Escape").catch(() => {});
    await gotoWithTolerance(page, PLATFORM_SPU_URL, 3000).catch(() => {});
    await page.waitForTimeout(1000);
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(500);
  }

  await saveShopSwitchDomSnapshot(page, runtimeDir, "shop-switch-verify-failed.html").catch(() => "");
  const screenshotFile = await savePageScreenshot(page, runtimeDir, "shop-switch-verify-failed.png").catch(() => "");
  throw new Error(`Shop switch failed: expected=${expectedShopName}; actual=${lastActual || "<empty>"}${screenshotFile ? `; screenshot=${screenshotFile}` : ""}`);
}

async function clearAndTypeAtPoint(
  page: Page,
  point: { x: number; y: number },
  value: string
): Promise<void> {
  await page.mouse.click(point.x, point.y, { delay: 80 });
  await page.keyboard.press("Control+A").catch(() => {});
  await page.keyboard.press("Backspace").catch(() => {});
  await page.keyboard.type(value, { delay: 40 });
}

async function clickVisibleDropdownOption(
  page: Page,
  expected: string
): Promise<string> {
  const normalizedExpected = normalizeMatchText(expected);
  const option = await page.evaluate((target) => {
    const elements = Array.from(document.querySelectorAll("body *"));
    const candidates = elements
      .map((el) => {
        const text = (el.textContent || "").trim();
        if (!text) {
          return null;
        }
        const normalizedText = text.replace(/\s+/g, "").trim().toLowerCase();
        if (!normalizedText.includes(target)) {
          return null;
        }
        const htmlEl = el as HTMLElement;
        const rect = htmlEl.getBoundingClientRect();
        const style = window.getComputedStyle(htmlEl);
        if (
          rect.width <= 0 ||
          rect.height <= 0 ||
          rect.width > window.innerWidth * 0.9 ||
          rect.height > 120 ||
          style.visibility === "hidden" ||
          style.display === "none"
        ) {
          return null;
        }
        const marker = [htmlEl.className, htmlEl.getAttribute("role") || "", htmlEl.tagName].join(" ").toLowerCase();
        const score =
          (marker.includes("option") ? 5 : 0) +
          (marker.includes("select") ? 4 : 0) +
          (marker.includes("dropdown") ? 4 : 0) +
          (marker.includes("menu") ? 3 : 0) +
          (marker.includes("item") ? 2 : 0) +
          (normalizedText === target ? 3 : 0) -
          text.length / 200;
        return {
          text,
          score,
          x: rect.x + rect.width / 2,
          y: rect.y + rect.height / 2
        };
      })
      .filter(Boolean)
      .sort((a, b) => (b?.score || 0) - (a?.score || 0));

    return candidates[0] || null;
  }, normalizedExpected);

  if (!option) {
    return "";
  }

  await page.mouse.click(option.x, option.y, { delay: 90 });
  return option.text || "";
}

async function findPlatformQueryInput(
  page: Page,
  kind: "brand" | "spu"
): Promise<{ x: number; y: number } | null> {
  return page.evaluate((targetKind) => {
    const inputs = Array.from(document.querySelectorAll("input, textarea"))
      .map((el) => el as HTMLInputElement | HTMLTextAreaElement)
      .map((input) => {
        const rect = input.getBoundingClientRect();
        if (rect.width <= 80 || rect.height <= 20) {
          return null;
        }
        const context = [
          input.getAttribute("placeholder") || "",
          input.getAttribute("aria-label") || "",
          input.parentElement?.textContent || "",
          input.parentElement?.parentElement?.textContent || ""
        ]
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
        return {
          x: rect.x + rect.width / 2,
          y: rect.y + rect.height / 2,
          width: rect.width,
          type: input.getAttribute("type") || "",
          role: input.getAttribute("role") || "",
          context
        };
      })
      .filter(Boolean) as Array<{ x: number; y: number; width: number; type: string; role: string; context: string }>;

    const target =
      targetKind === "brand"
        ? inputs
            .filter((input) => input.type === "search" || input.role === "combobox")
            .sort((a, b) => a.y - b.y || a.x - b.x)[1] || null
        : inputs
            .map((input) => {
              const score =
                (/SPU/i.test(input.context) ? 160 : 0) +
                (/\u540d\u79f0|ID|\u6761\u7801/i.test(input.context) ? 20 : 0) +
                (input.type === "text" ? 10 : 0);
              return { ...input, score };
            })
            .filter((input) => input.score > 0)
            .sort((a, b) => b.score - a.score || a.y - b.y || a.x - b.x)[0] || null;
    return target ? { x: target.x, y: target.y } : null;
  }, kind);
}

async function setPlatformQueryInputValue(page: Page, kind: "brand" | "spu", value: string): Promise<void> {
  await page.evaluate(
    ({ targetKind, nextValue }) => {
      const inputs = Array.from(document.querySelectorAll("input, textarea"))
        .map((el) => el as HTMLInputElement | HTMLTextAreaElement)
        .map((input) => {
          const rect = input.getBoundingClientRect();
          if (rect.width <= 80 || rect.height <= 20) {
            return null;
          }
          const context = [
            input.getAttribute("placeholder") || "",
            input.getAttribute("aria-label") || "",
            input.parentElement?.textContent || "",
            input.parentElement?.parentElement?.textContent || ""
          ]
            .join(" ")
            .replace(/\s+/g, " ")
            .trim();
          return { input, context, y: rect.y, x: rect.x };
        })
        .filter(Boolean) as Array<{ input: HTMLInputElement | HTMLTextAreaElement; context: string; y: number; x: number }>;

      const target =
        targetKind === "brand"
          ? inputs
              .filter((item) => {
                const input = item.input as HTMLInputElement;
                return input.getAttribute("type") === "search" || input.getAttribute("role") === "combobox";
              })
              .sort((a, b) => a.y - b.y || a.x - b.x)[1]?.input
          : inputs
              .map((item) => {
                const input = item.input as HTMLInputElement;
                const score =
                  (/SPU/i.test(item.context) ? 160 : 0) +
                  (/\u540d\u79f0|ID|\u6761\u7801/i.test(item.context) ? 20 : 0) +
                  ((input.getAttribute("type") || "") === "text" ? 10 : 0);
                return { ...item, score };
              })
              .filter((item) => item.score > 0)
              .sort((a, b) => b.score - a.score || a.y - b.y || a.x - b.x)[0]?.input;

      if (!target) {
        return;
      }

      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      target.focus();
      setter?.call(target, "");
      target.dispatchEvent(new InputEvent("input", { bubbles: true, data: "", inputType: "deleteContentBackward" }));
      setter?.call(target, nextValue);
      target.dispatchEvent(new InputEvent("input", { bubbles: true, data: nextValue, inputType: "insertText" }));
      target.dispatchEvent(new Event("change", { bubbles: true }));
      target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
      target.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "Enter" }));
      target.blur();
    },
    { targetKind: kind, nextValue: value }
  );
}

async function setPlatformInputValueAtPoint(
  page: Page,
  point: { x: number; y: number },
  value: string
): Promise<string> {
  return page.evaluate(
    ({ target, nextValue }) => {
      const findInput = (): HTMLInputElement | HTMLTextAreaElement | null => {
        const element = document.elementFromPoint(target.x, target.y) as HTMLElement | null;
        if (!element) {
          return null;
        }
        const direct =
          (element.matches("input, textarea") ? (element as HTMLInputElement | HTMLTextAreaElement) : null) ||
          (element.querySelector("input, textarea") as HTMLInputElement | HTMLTextAreaElement | null) ||
          (element.closest("input, textarea") as HTMLInputElement | HTMLTextAreaElement | null) ||
          (element.closest("div")?.querySelector("input, textarea") as HTMLInputElement | HTMLTextAreaElement | null);
        return direct;
      };

      const input = findInput();
      if (!input) {
        return "";
      }
      const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      input.focus();
      setter?.call(input, "");
      input.dispatchEvent(new InputEvent("input", { bubbles: true, data: "", inputType: "deleteContentBackward" }));
      setter?.call(input, nextValue);
      input.dispatchEvent(new InputEvent("input", { bubbles: true, data: nextValue, inputType: "insertText" }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return (input.value || "").trim();
    },
    { target: point, nextValue: value }
  );
}

async function readPlatformInputValueAtPoint(
  page: Page,
  point: { x: number; y: number }
): Promise<string> {
  return page.evaluate((target) => {
    const element = document.elementFromPoint(target.x, target.y) as HTMLElement | null;
    const input =
      (element?.matches("input, textarea") ? (element as HTMLInputElement | HTMLTextAreaElement) : null) ||
      (element?.querySelector("input, textarea") as HTMLInputElement | HTMLTextAreaElement | null) ||
      (element?.closest("input, textarea") as HTMLInputElement | HTMLTextAreaElement | null) ||
      (element?.closest("div")?.querySelector("input, textarea") as HTMLInputElement | HTMLTextAreaElement | null);
    return (input?.value || "").trim();
  }, point);
}

async function readPlatformQueryInputValue(page: Page, kind: "brand" | "spu"): Promise<string> {
  return page.evaluate((targetKind) => {
    const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
    const readSelectDisplay = (input: HTMLInputElement | HTMLTextAreaElement): string => {
      let container: HTMLElement | null = null;
      let node = input.parentElement;
      for (let depth = 0; node && depth < 8; depth += 1) {
        const marker = [String(node.className || ""), node.getAttribute("role") || "", node.tagName].join(" ").toLowerCase();
        if (
          marker.includes("ecom-g-select") ||
          marker.includes("ant-select") ||
          marker.includes("semi-select") ||
          marker.includes("combobox") ||
          marker.includes("dropdown")
        ) {
          container = node;
          break;
        }
        node = node.parentElement;
      }
      container = container || input.parentElement || null;
      if (!container) {
        return "";
      }

      const selectedNode = container.querySelector(
        ".ecom-g-select-selection-item, .ant-select-selection-item, .semi-select-selection-text, [class*='selection-item'], [class*='selectionItem']"
      ) as HTMLElement | null;
      const selectedText = normalize(selectedNode?.innerText || selectedNode?.textContent || "");
      if (selectedText) {
        return selectedText;
      }

      const ariaValueText = normalize(
        container.getAttribute("aria-valuetext") ||
          input.getAttribute("aria-valuetext") ||
          input.getAttribute("aria-label") ||
          ""
      );
      if (ariaValueText) {
        return ariaValueText;
      }

      const directValue = normalize((input as HTMLInputElement).value || "");
      return directValue;
    };

    const inputs = Array.from(document.querySelectorAll("input, textarea"))
      .map((el) => el as HTMLInputElement | HTMLTextAreaElement)
      .map((input) => {
        const rect = input.getBoundingClientRect();
        if (rect.width <= 80 || rect.height <= 20) {
          return null;
        }
        const context = [
          input.getAttribute("placeholder") || "",
          input.getAttribute("aria-label") || "",
          input.parentElement?.textContent || "",
          input.parentElement?.parentElement?.textContent || ""
        ]
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
        return { input, context, y: rect.y, x: rect.x };
      })
      .filter(Boolean) as Array<{ input: HTMLInputElement | HTMLTextAreaElement; context: string; y: number; x: number }>;

    const target =
      targetKind === "brand"
        ? inputs
            .filter((item) => {
              const input = item.input as HTMLInputElement;
              return input.getAttribute("type") === "search" || input.getAttribute("role") === "combobox";
            })
            .sort((a, b) => a.y - b.y || a.x - b.x)[1]?.input
        : inputs
            .map((item) => {
              const input = item.input as HTMLInputElement;
              const score =
                (/SPU/i.test(item.context) ? 160 : 0) +
                (/\u540d\u79f0|ID|\u6761\u7801/i.test(item.context) ? 20 : 0) +
                ((input.getAttribute("type") || "") === "text" ? 10 : 0);
              return { ...item, score };
            })
            .filter((item) => item.score > 0)
            .sort((a, b) => b.score - a.score || a.y - b.y || a.x - b.x)[0]?.input;

    if (!target) {
      return "";
    }
    if (targetKind === "brand") {
      return readSelectDisplay(target);
    }
    return (target.value || "").trim();
  }, kind);
}

async function queryPlatformSpu(runtimeDir: string, brand: string, spu: string, shopFolder?: string): Promise<{
  pageUrl: string;
  pageTitle: string;
  screenshotFile: string;
  createPageUrl: string;
  matchedRowText: string;
}> {
  const context = await launchPersistentBrowser();
  try {
    const normalizedBrand = normalizeMatchText(brand);
    const normalizedSpu = normalizeMatchText(spu);
    const page =
      context.pages().find((item) => !item.isClosed() && item.url().includes("/ffa/g/spu-record")) ||
      context.pages().find((item) => !item.isClosed() && !item.url().includes("/ffa/g/create")) ||
      (await context.newPage());
    await closeExtraPages(context, [page]);
    attachSafeDialogHandler(page);
    await page.bringToFront();
    await gotoWithTolerance(page, PLATFORM_SPU_URL, 3000);
    if (shopFolder) {
      await ensureShopContext(page, runtimeDir, shopFolder);
      await gotoWithTolerance(page, PLATFORM_SPU_URL, 3000);
    }

    const platformTab = page.getByText("\u5E73\u53F0\u6807\u54C1", { exact: true });
    if (await platformTab.count()) {
      await platformTab.click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(800);
    }

    const queryPageReady = await page.evaluate(() => {
      const bodyText = document.body.innerText || "";
      return bodyText.includes("\u67e5\u8be2") && (bodyText.includes("SPU") || bodyText.includes("\u5e73\u53f0\u6807\u54c1"));
    });
    if (!queryPageReady) {
      const error = new Error("Platform SPU query page was not ready after navigation.") as QueryDiagnosticError;
      error.screenshotFile = await savePageScreenshot(page, runtimeDir, "platform-spu-query-page-not-ready.png");
      throw error;
    }

    const brandBox = await findPlatformQueryInput(page, "brand");
    if (!brandBox) {
      const error = new Error("Visible brand input not found.") as QueryDiagnosticError;
      error.screenshotFile = await savePageScreenshot(page, runtimeDir, "platform-spu-brand-input-missing.png");
      throw error;
    }

    const spuBox = await findPlatformQueryInput(page, "spu");
    if (!spuBox) {
      const error = new Error("Visible SPU input not found.") as QueryDiagnosticError;
      error.screenshotFile = await savePageScreenshot(page, runtimeDir, "platform-spu-input-missing.png");
      throw error;
    }

    logInfo(`querying platform spu with brand=${brand}, spu=${spu}`);

    await clearAndTypeAtPoint(page, brandBox, brand);
    await page.waitForTimeout(1200);
    let clickedBrandOptionText = await clickVisibleDropdownOption(page, brand).catch(() => "");
    await page.waitForTimeout(800);
    let brandValueConfirmed = await readPlatformQueryInputValue(page, "brand");
    if (!normalizeMatchText(brandValueConfirmed).includes(normalizedBrand)) {
      await setPlatformQueryInputValue(page, "brand", brand);
      await page.waitForTimeout(600);
      clickedBrandOptionText = clickedBrandOptionText || (await clickVisibleDropdownOption(page, brand).catch(() => ""));
      await page.waitForTimeout(800);
      brandValueConfirmed = await readPlatformQueryInputValue(page, "brand");
    }
    if (brandValueConfirmed && !normalizeMatchText(brandValueConfirmed).includes(normalizedBrand)) {
      const error = new Error(
        `Brand input value mismatch after typing. expected=${brand}; actual=${brandValueConfirmed || "<empty>"}`
      ) as QueryDiagnosticError;
      error.screenshotFile = await savePageScreenshot(page, runtimeDir, "platform-spu-brand-value-mismatch.png");
      throw error;
    }
    const brandOptionConfirmed = normalizeMatchText(clickedBrandOptionText).includes(normalizedBrand);
    if (!brandValueConfirmed && !brandOptionConfirmed) {
      logWarn(`brand combobox display did not expose a readable value after typing; continue with exact row match only. brand=${brand}`);
    }

    await clearAndTypeAtPoint(page, spuBox, spu);
    await page.waitForTimeout(300);
    let spuValueConfirmed = await readPlatformInputValueAtPoint(page, spuBox);
    if (!normalizeMatchText(spuValueConfirmed).includes(normalizeMatchText(spu))) {
      spuValueConfirmed = await setPlatformInputValueAtPoint(page, spuBox, spu);
    }
    if (!normalizeMatchText(spuValueConfirmed).includes(normalizeMatchText(spu))) {
      await setPlatformQueryInputValue(page, "spu", spu);
      await page.waitForTimeout(500);
      spuValueConfirmed = await readPlatformInputValueAtPoint(page, spuBox);
    }
    await page.waitForTimeout(800);
    if (!normalizeMatchText(spuValueConfirmed).includes(normalizeMatchText(spu))) {
      spuValueConfirmed = await readPlatformQueryInputValue(page, "spu");
    }
    if (!normalizeMatchText(spuValueConfirmed).includes(normalizeMatchText(spu))) {
      const error = new Error(
        `SPU input value mismatch after typing. expected=${spu}; actual=${spuValueConfirmed || "<empty>"}`
      ) as QueryDiagnosticError;
      error.screenshotFile = await savePageScreenshot(page, runtimeDir, "platform-spu-input-value-mismatch.png");
      throw error;
    }

    const brandSelfCheckOk =
      normalizeMatchText(brandValueConfirmed).includes(normalizedBrand) ||
      brandOptionConfirmed ||
      !brandValueConfirmed;
    const spuSelfCheckOk = normalizeMatchText(spuValueConfirmed).includes(normalizedSpu);
    if (!brandSelfCheckOk || !spuSelfCheckOk) {
      const error = new Error(
        `Platform query self-check failed before clicking query. expectedBrand=${brand}; actualBrand=${brandValueConfirmed || "<empty>"}; expectedSpu=${spu}; actualSpu=${spuValueConfirmed || "<empty>"}`
      ) as QueryDiagnosticError;
      error.screenshotFile = await savePageScreenshot(page, runtimeDir, "platform-spu-pre-query-self-check-failed.png");
      throw error;
    }

    const queryButton = page.getByRole("button", { name: "\u67E5\u8BE2" });
    let queryClicked = false;
    if (await queryButton.count()) {
      queryClicked = await queryButton.click({ timeout: 5000 }).then(() => true).catch(() => false);
    }
    if (!queryClicked) {
      queryClicked = await clickVisibleText(page, "\u67E5\u8BE2");
    }
    if (!queryClicked) {
      const error = new Error("Visible query button not found or not clickable.") as QueryDiagnosticError;
      error.screenshotFile = await savePageScreenshot(page, runtimeDir, "platform-spu-query-button-missing.png");
      throw error;
    }
    await page.waitForTimeout(2500);

    const candidates = await page.evaluate(({ targetBrand, targetSpu }: { targetBrand: string; targetSpu: string }) => {
      const rows = Array.from(document.querySelectorAll("tr"));
      return rows
        .map((row) => {
          const rowEl = row as HTMLElement;
          const publishButton = Array.from(row.querySelectorAll("button, a, span, div"))
            .find((el) => ((el.textContent || "").trim() === "\u53D1\u5E03\u5546\u54C1")) as HTMLElement | undefined;
          if (!publishButton) {
            return null;
          }
          const rowRect = rowEl.getBoundingClientRect();
          const buttonRect = publishButton.getBoundingClientRect();
          if (rowRect.width <= 0 || rowRect.height <= 0 || buttonRect.width <= 0 || buttonRect.height <= 0) {
            return null;
          }
          if (rowRect.y < 250) {
            return null;
          }
          const cellTexts = Array.from(row.querySelectorAll("td"))
            .map((cell) => (cell.textContent || "").replace(/\s+/g, " ").trim())
            .filter(Boolean);
          const normalizedRowText = (rowEl.innerText || "").replace(/\s+/g, "").toLowerCase();
          const exactSpuCell = cellTexts.some((cell) => cell.replace(/\s+/g, "").toLowerCase() === targetSpu);
          const exactBrandCell = cellTexts.some((cell) => cell.replace(/\s+/g, "").toLowerCase() === targetBrand);
          const rowHasSpu = normalizedRowText.includes(targetSpu);
          const rowHasBrand = normalizedRowText.includes(targetBrand);
          const score =
            (exactSpuCell ? 300 : 0) +
            (rowHasSpu ? 150 : 0) +
            (exactBrandCell ? 80 : 0) +
            (rowHasBrand ? 40 : 0);
          return {
            rowText: (rowEl.innerText || "").slice(0, 800),
            normalizedText: normalizedRowText,
            score,
            clickX: buttonRect.x + buttonRect.width / 2,
            clickY: buttonRect.y + buttonRect.height / 2
          };
        })
        .filter(Boolean);
    }, { targetBrand: normalizedBrand, targetSpu: normalizedSpu }) as Array<QueryMatchCandidate & { score: number }>;

    if (!candidates.length) {
      const error = new Error("No visible publish rows found in result table.") as QueryDiagnosticError;
      error.screenshotFile = await savePageScreenshot(page, runtimeDir, "platform-spu-query-no-rows.png");
      throw error;
    }

    const matched =
      candidates
        .filter((item) => item.score >= 190)
        .sort((a, b) => b.score - a.score || a.rowText.length - b.rowText.length)[0] || null;

    if (!matched) {
      const firstRowText = candidates[0]?.rowText || "";
      const candidateIds = candidates
        .map((item) => item.rowText.match(/ID:(\d+)/)?.[1] || "")
        .filter(Boolean)
        .slice(0, 5);
      const error = new Error(
        `No queried result row matched brand/spu exactly. brand=${brand}; spu=${spu}; firstRow=${firstRowText.slice(0, 200)}; use input.publishPageUrl to bypass query when you already have a known create page URL.`
      ) as QueryDiagnosticError;
      error.screenshotFile = await savePageScreenshot(page, runtimeDir, "platform-spu-query-mismatch.png");
      error.candidateRows = candidates.slice(0, 5).map((item) => item.rowText.slice(0, 300));
      error.candidateIds = candidateIds;
      throw error;
    }

    const existingCreatePages = new Set(context.pages().filter((item) => item.url().includes("/ffa/g/create")));
    const popupPromise = context.waitForEvent("page", { timeout: 5000 }).catch(() => null);
    await page.mouse.click(matched.clickX, matched.clickY, { delay: 90 });

    const popup = await popupPromise;
    await page.waitForTimeout(2000).catch(() => {});
    let activeQueryPage = page;
    if (activeQueryPage.isClosed()) {
      activeQueryPage = await recoverUsablePageFromContext(context, "/ffa/g/spu-record").catch(() => page);
    }
    const newCreatePage =
      context
        .pages()
        .find((item) => item.url().includes("/ffa/g/create") && !existingCreatePages.has(item) && !item.isClosed()) || null;
    const targetPage =
      popup ||
      newCreatePage ||
      context.pages().find((item) => !item.isClosed() && item.url().includes("/ffa/g/create")) ||
      (!activeQueryPage.isClosed() && activeQueryPage.url().includes("/ffa/g/create") ? activeQueryPage : null);
    if (!targetPage) {
      throw new Error("Publish page did not open after query click. No new create page was detected.");
    }
    attachSafeDialogHandler(targetPage);
    await closeExtraPages(context, [targetPage]);
    await targetPage.waitForTimeout(4000).catch(() => {});
    const createPageUrl = targetPage.url();
    if (!createPageUrl.includes("/ffa/g/create")) {
      throw new Error(`Publish page did not open after query click. Current URL: ${createPageUrl}`);
    }

    const screenshotFile = await savePageScreenshot(targetPage, runtimeDir, "platform-spu-query-result.png");
    const resultPage = activeQueryPage.isClosed() ? targetPage : activeQueryPage;

    return {
      pageUrl: resultPage.url(),
      pageTitle: await resultPage.title().catch(() => targetPage.title()),
      screenshotFile,
      createPageUrl,
      matchedRowText: matched.rowText
    };
  } finally {
    await context.browser()?.close().catch(() => {});
  }
}

async function inspectPublishPage(runtimeDir: string, publishPageUrl?: string): Promise<{
  pageUrl: string;
  pageTitle: string;
  screenshotFile: string;
  sections: string[];
  topActions: string[];
  errorHints: string[];
}> {
  const context = await launchPersistentBrowser();
  try {
    const existingCreatePage = context.pages().find((item) => !item.isClosed() && item.url().includes("/ffa/g/create"));
    const page = existingCreatePage || context.pages().find((item) => !item.isClosed()) || (await context.newPage());
    await page.bringToFront();

    if (publishPageUrl) {
      await page.goto(publishPageUrl, { waitUntil: "domcontentloaded" });
    } else if (!page.url().includes("/ffa/g/create")) {
      throw new Error("inspect_publish_page requires input.publishPageUrl or an already-open publish page.");
    }

    await page.waitForTimeout(3500);

    const pageSummary = await page.evaluate(() => {
      const bodyText = document.body.innerText || "";
      const knownSections = [
        "\u57FA\u7840\u4FE1\u606F",
        "\u56FE\u6587\u4FE1\u606F",
        "\u4EF7\u683C\u5E93\u5B58",
        "\u670D\u52A1\u4E0E\u5C65\u7EA6",
        "\u5176\u4ED6\u4FE1\u606F"
      ].filter((text) => bodyText.includes(text));
      const knownActions = [
        "\u53D1\u5E03\u5546\u54C1",
        "\u4FDD\u5B58\u8349\u7A3F",
        "\u586B\u5199\u68C0\u67E5"
      ].filter((text) => bodyText.includes(text));
      const errorHints = bodyText
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .filter((line) => /(\u5F85\u5904\u7406|\u5FC5\u586B|\u8BF7\u8F93\u5165|\u9519\u8BEF|\u95EE\u9898)/.test(line))
        .slice(0, 8);

      return {
        sections: knownSections,
        topActions: knownActions,
        errorHints
      };
    });

    const screenshotFile = await savePageScreenshot(page, runtimeDir, "publish-page-inspect.png");
    return {
      pageUrl: page.url(),
      pageTitle: await page.title(),
      screenshotFile,
      sections: pageSummary.sections,
      topActions: pageSummary.topActions,
      errorHints: pageSummary.errorHints
    };
  } finally {
    await context.browser()?.close().catch(() => {});
  }
}

async function inspectPublishPageOnPage(
  page: Page,
  runtimeDir: string,
  fileName: string
): Promise<{
  pageUrl: string;
  pageTitle: string;
  screenshotFile: string;
  sections: string[];
  topActions: string[];
  errorHints: string[];
}> {
  await page.waitForTimeout(1500);

  const pageSummary = await page.evaluate(() => {
    const bodyText = document.body.innerText || "";
    const knownSections = [
      "\u57FA\u7840\u4FE1\u606F",
      "\u56FE\u6587\u4FE1\u606F",
      "\u4EF7\u683C\u5E93\u5B58",
      "\u670D\u52A1\u4E0E\u5C65\u7EA6",
      "\u5176\u4ED6\u4FE1\u606F"
    ].filter((text) => bodyText.includes(text));
    const knownActions = [
      "\u53D1\u5E03\u5546\u54C1",
      "\u4FDD\u5B58\u8349\u7A3F",
      "\u586B\u5199\u68C0\u67E5"
    ].filter((text) => bodyText.includes(text));
    const errorHints = bodyText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => /(\u5F85\u5904\u7406|\u5FC5\u586B|\u8BF7\u8F93\u5165|\u9519\u8BEF|\u95EE\u9898)/.test(line))
      .slice(0, 8);

    return {
      sections: knownSections,
      topActions: knownActions,
      errorHints
    };
  });

  const screenshotFile = await savePageScreenshot(page, runtimeDir, fileName);
  return {
    pageUrl: page.url(),
    pageTitle: await page.title(),
    screenshotFile,
    sections: pageSummary.sections,
    topActions: pageSummary.topActions,
    errorHints: pageSummary.errorHints
  };
}

async function findTitleInputCenter(page: Page): Promise<{ x: number; y: number } | null> {
  return page.evaluate(() => {
    const fields = Array.from(document.querySelectorAll("input, textarea"));
    const target = fields.find((el) => {
      const input = el as HTMLInputElement | HTMLTextAreaElement;
      const rect = input.getBoundingClientRect();
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        (input.getAttribute("type") || "") === "text" &&
        (input.getAttribute("placeholder") || "").includes("\u8BF7\u8F93\u516515-120\u4E2A\u5B57\u7B26") &&
        rect.y < 500
      );
    }) as HTMLInputElement | HTMLTextAreaElement | undefined;
    if (!target) {
      return null;
    }
    const rect = target.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  });
}

async function findShortTitleInputCenter(page: Page): Promise<{ x: number; y: number } | null> {
  return page.evaluate(() => {
    const fields = Array.from(document.querySelectorAll("input, textarea"));
    const target = fields.find((el) => {
      const input = el as HTMLInputElement | HTMLTextAreaElement;
      const rect = input.getBoundingClientRect();
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        (input.getAttribute("type") || "") === "text" &&
        (input.getAttribute("placeholder") || "").includes("\u5EFA\u8BAE\u586B\u5199\u7B80\u660E\u51C6\u786E") &&
        rect.y < 550
      );
    }) as HTMLInputElement | HTMLTextAreaElement | undefined;
    if (!target) {
      return null;
    }
    const rect = target.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  });
}

async function findModelSpecInputCenter(page: Page): Promise<{ x: number; y: number } | null> {
  return page.evaluate(() => {
    const fields = Array.from(document.querySelectorAll("input, textarea"))
      .map((el) => {
        const input = el as HTMLInputElement | HTMLTextAreaElement;
        const rect = input.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) {
          return null;
        }
        const ancestors: string[] = [];
        let node = input.parentElement;
        for (let index = 0; index < 6 && node; index += 1) {
          ancestors.push((node.textContent || "").trim().replace(/\s+/g, " ").slice(0, 160));
          node = node.parentElement;
        }
        return {
          type: input.getAttribute("type") || "",
          placeholder: input.getAttribute("placeholder") || "",
          value: "value" in input ? String(input.value || "") : "",
          className: typeof input.className === "string" ? input.className : "",
          ancestors,
          x: rect.x + rect.width / 2,
          y: rect.y + rect.height / 2,
          width: rect.width
        };
      })
      .filter(Boolean) as Array<{
        type: string;
        placeholder: string;
        value: string;
        className: string;
        ancestors: string[];
        x: number;
        y: number;
        width: number;
      }>;

    const target = fields.find(
      (field) =>
        field.type === "text" &&
        field.placeholder === "\u8BF7\u8F93\u5165" &&
        !field.className.includes("disabled") &&
        field.ancestors.some((item) => item.includes("\u578B\u53F7\u89C4\u683C")) &&
        field.width > 180
    );
    return target ? { x: target.x, y: target.y } : null;
  });
}

async function clearAndTypeAtCenter(page: Page, center: { x: number; y: number }, value: string): Promise<void> {
  await page.mouse.click(center.x, center.y, { delay: 80 });
  await page.keyboard.press("Control+A").catch(() => {});
  await page.keyboard.press("Backspace").catch(() => {});
  await page.keyboard.type(value, { delay: 35 });
  await page.keyboard.press("Tab").catch(() => {});
  await page.waitForTimeout(150);
}

type BasicFieldSnapshot = {
  key: string;
  label: string;
  value: string;
  allowed: boolean;
};

async function readCategoryRegistrationNumber(page: Page): Promise<string> {
  return page.evaluate(() => {
    const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
    const extractRegistrationNumber = (value: string): string => {
      const text = normalize(value);
      if (!text) {
        return "";
      }
      const exactMatch = text.match(/[\u4e00-\u9fa5]{1,4}械(?:注准|注许|备)\d{5,}/);
      if (exactMatch) {
        return exactMatch[0];
      }
      const fuzzyMatch = text.match(/[\u4e00-\u9fa5]{1,6}(?:备案|注册|注准|注许)\d{5,}/);
      return fuzzyMatch ? fuzzyMatch[0] : "";
    };
    const labelKeywords = ["医疗器械备案/注册号", "医疗器械注册号", "备案/注册号", "注册号"];
    const excludeTexts = ["举报", "修改", "展开更多"];
    const elements = Array.from(document.querySelectorAll("body *")).map((el) => el as HTMLElement);
    const visible = elements
      .map((el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        const text = normalize(el.innerText || el.textContent || "");
        if (!text || rect.width <= 0 || rect.height <= 0 || style.display === "none" || style.visibility === "hidden") {
          return null;
        }
        return { el, rect, text };
      })
      .filter(Boolean) as Array<{ el: HTMLElement; rect: DOMRect; text: string }>;

    const labels = visible
      .filter((item) => labelKeywords.some((keyword) => item.text.includes(keyword)))
      .sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left);

    for (const label of labels) {
      const containers = [
        label.el.closest(".ecom-g-form-item") as HTMLElement | null,
        label.el.parentElement,
        label.el.parentElement?.parentElement,
        label.el.closest("div")
      ].filter(Boolean) as HTMLElement[];

      for (const container of containers) {
        const inputValues = Array.from(container.querySelectorAll("input, textarea"))
          .map((node) => (node as HTMLInputElement | HTMLTextAreaElement).value || "")
          .map((value) => normalize(value))
          .filter((value) => value && !labelKeywords.some((keyword) => value.includes(keyword)));
        const matchedInputValue = inputValues
          .map((value) => extractRegistrationNumber(value) || value)
          .find((value) => Boolean(extractRegistrationNumber(value)));
        if (matchedInputValue) {
          return extractRegistrationNumber(matchedInputValue) || matchedInputValue;
        }
        const textCandidates = Array.from(container.querySelectorAll("*"))
          .map((node) => node as HTMLElement)
          .map((node) => {
            const rect = node.getBoundingClientRect();
            const style = window.getComputedStyle(node);
            const text = normalize(node.innerText || node.textContent || "");
            if (
              !text ||
              rect.width <= 0 ||
              rect.height <= 0 ||
              style.display === "none" ||
              style.visibility === "hidden" ||
              text === label.text ||
              labelKeywords.some((keyword) => text.includes(keyword)) ||
              excludeTexts.some((keyword) => text.includes(keyword))
            ) {
              return null;
            }
            const sameRow = Math.abs(rect.top - label.rect.top) <= 56 && rect.left >= label.rect.left - 20;
            const nextRow = rect.top > label.rect.bottom - 8 && rect.top - label.rect.bottom <= 90;
            if (!sameRow && !nextRow) {
              return null;
            }
            const registrationText = extractRegistrationNumber(text);
            return {
              text: registrationText || text,
              score:
                (registrationText ? 600 : 0) +
                (sameRow ? 200 : 0) +
                (nextRow ? 120 : 0) -
                Math.abs(rect.left - label.rect.right)
            };
          })
          .filter(Boolean)
          .sort((a, b) => (b?.score || 0) - (a?.score || 0));

        if (textCandidates[0]?.text && extractRegistrationNumber(textCandidates[0].text)) {
          return extractRegistrationNumber(textCandidates[0].text) || textCandidates[0].text;
        }
      }
    }

    return "";
  });
}

async function assertCategoryRegistrationMatchesWorkbookSpu(
  page: Page,
  runtimeDir: string,
  expectedSpu: string,
  screenshotFileName: string
): Promise<string> {
  const actualRegistration = await readCategoryRegistrationNumber(page);
  const normalizedExpected = normalizeMatchText(expectedSpu);
  const normalizedActual = normalizeMatchText(actualRegistration);
  if (!normalizedExpected) {
    return actualRegistration;
  }
  if (!normalizedActual || normalizedActual !== normalizedExpected) {
    const screenshotFile = await savePageScreenshot(page, runtimeDir, screenshotFileName).catch(() => "");
    throw new Error(
      `Category registration mismatch before modelSpec fill. expectedSpu=${expectedSpu}; actualRegistration=${actualRegistration || "<empty>"}${
        screenshotFile ? `; screenshot=${screenshotFile}` : ""
      }`
    );
  }
  return actualRegistration;
}

async function verifyCategoryRegistrationGateOnPage(
  page: Page,
  runtimeDir: string,
  expectedSpu?: string,
  screenshotFileName = "publish-page-category-registration-mismatch.png"
): Promise<void> {
  if (!expectedSpu) {
    return;
  }
  await ensurePublishSectionTab(page, "\u57fa\u7840\u4fe1\u606f");
  await page.mouse.wheel(0, -4000).catch(() => {});
  await page.waitForTimeout(600);
  await assertCategoryRegistrationMatchesWorkbookSpu(page, runtimeDir, expectedSpu, screenshotFileName);
}

async function snapshotBasicInfoFields(page: Page): Promise<BasicFieldSnapshot[]> {
  return page.evaluate(() => {
    const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
    return Array.from(document.querySelectorAll("input, textarea"))
      .map((el) => el as HTMLInputElement | HTMLTextAreaElement)
      .map((input, index) => {
        const rect = input.getBoundingClientRect();
        const style = window.getComputedStyle(input);
        if (rect.width <= 80 || rect.height <= 0 || style.display === "none" || style.visibility === "hidden") {
          return null;
        }
        const context = normalize(
          [
            input.placeholder || "",
            input.getAttribute("aria-label") || "",
            input.parentElement?.textContent || "",
            input.parentElement?.parentElement?.textContent || "",
            input.closest("div")?.textContent || ""
          ].join(" ")
        ).slice(0, 240);
        const allowed =
          context.includes("\u578b\u53f7\u89c4\u683c") ||
          (input.placeholder || "").includes("15-120") ||
          (input.placeholder || "").includes("\u5efa\u8bae\u586b\u5199\u7b80\u660e\u51c6\u786e");
        return {
          key: `${index}:${Math.round(rect.x)}:${Math.round(rect.y)}:${input.tagName}`,
          label: context,
          value: String("value" in input ? input.value || "" : ""),
          allowed
        };
      })
      .filter(Boolean) as BasicFieldSnapshot[];
  });
}

function diffUnexpectedBasicFieldChanges(before: BasicFieldSnapshot[], after: BasicFieldSnapshot[]): string[] {
  const beforeMap = new Map(before.map((item) => [item.key, item]));
  return after
    .filter((item) => !item.allowed)
    .filter((item) => {
      const previous = beforeMap.get(item.key);
      return previous && previous.value !== item.value;
    })
    .map((item) => item.label || item.key);
}

async function fillBasicPublishPage(
  runtimeDir: string,
  publishPageUrl: string,
  metadata: { title?: string; shortTitle?: string; modelSpec?: string; spu?: string }
): Promise<{
  pageUrl: string;
  pageTitle: string;
  screenshotFile: string;
  filledFields: string[];
}> {
  const context = await launchPersistentBrowser();
  try {
    const page = context.pages().find((item) => !item.isClosed()) || (await context.newPage());
    attachSafeDialogHandler(page);
    await page.bringToFront();
    await gotoWithTolerance(page, publishPageUrl, 3500);
    await ensurePublishSectionTab(page, "\u57fa\u7840\u4fe1\u606f");
    await page.mouse.wheel(0, -4000).catch(() => {});
    await page.waitForTimeout(500);

    const filledFields: string[] = [];

    if (metadata.title) {
      const titleCenter = await findTitleInputCenter(page);
      if (!titleCenter) {
        throw new Error("Title input not found on publish page.");
      }
      await clearAndTypeAtCenter(page, titleCenter, metadata.title);
      filledFields.push("title");
      await page.waitForTimeout(400);
    }

    if (metadata.shortTitle) {
      const shortTitleCenter = await findShortTitleInputCenter(page);
      if (!shortTitleCenter) {
        throw new Error("Short title input not found on publish page.");
      }
      await clearAndTypeAtCenter(page, shortTitleCenter, metadata.shortTitle);
      filledFields.push("shortTitle");
      await page.waitForTimeout(400);
    }

    if (metadata.modelSpec) {
      if (metadata.spu) {
        await assertCategoryRegistrationMatchesWorkbookSpu(
          page,
          runtimeDir,
          metadata.spu,
          "publish-page-category-registration-mismatch.png"
        );
      }
      const modelSpecCenter = await findModelSpecInputCenter(page);
      if (!modelSpecCenter) {
        throw new Error("Model spec input not found on publish page.");
      }
      await clearAndTypeAtCenter(page, modelSpecCenter, metadata.modelSpec);
      filledFields.push("modelSpec");
      await page.waitForTimeout(400);
    }

    const screenshotFile = await savePageScreenshot(page, runtimeDir, "publish-page-basic-filled.png");
    return {
      pageUrl: page.url(),
      pageTitle: await page.title(),
      screenshotFile,
      filledFields
    };
  } finally {
    await context.browser()?.close().catch(() => {});
  }
}

async function fillBasicPublishPageOnPage(
  page: Page,
  runtimeDir: string,
  metadata: { title?: string; shortTitle?: string; modelSpec?: string; spu?: string },
  fileName: string
): Promise<{
  pageUrl: string;
  pageTitle: string;
  screenshotFile: string;
  filledFields: string[];
}> {
  await page.bringToFront();
  await page.waitForTimeout(1200);
  await ensurePublishSectionTab(page, "\u57fa\u7840\u4fe1\u606f");
  await page.mouse.wheel(0, -4000).catch(() => {});
  await page.waitForTimeout(800);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const beforeSnapshot = await snapshotBasicInfoFields(page);
    const filledFields: string[] = [];

    if (metadata.title) {
      const titleCenter = await findTitleInputCenter(page);
      if (!titleCenter) {
        throw new Error("Title input not found on publish page.");
      }
      await clearAndTypeAtCenter(page, titleCenter, metadata.title);
      filledFields.push("title");
      await page.waitForTimeout(400);
    }

    if (metadata.shortTitle) {
      const shortTitleCenter = await findShortTitleInputCenter(page);
      if (!shortTitleCenter) {
        throw new Error("Short title input not found on publish page.");
      }
      await clearAndTypeAtCenter(page, shortTitleCenter, metadata.shortTitle);
      filledFields.push("shortTitle");
      await page.waitForTimeout(400);
    }

    if (metadata.modelSpec) {
      await page.mouse.wheel(0, 600).catch(() => {});
      await page.waitForTimeout(500);
      if (metadata.spu) {
        await assertCategoryRegistrationMatchesWorkbookSpu(
          page,
          runtimeDir,
          metadata.spu,
          "publish-page-category-registration-mismatch.png"
        );
      }
      const modelSpecCenter = await findModelSpecInputCenter(page);
      if (modelSpecCenter) {
        await clearAndTypeAtCenter(page, modelSpecCenter, metadata.modelSpec);
        filledFields.push("modelSpec");
        await page.waitForTimeout(400);
      }
    }

    const afterSnapshot = await snapshotBasicInfoFields(page);
    const unexpectedChanges = diffUnexpectedBasicFieldChanges(beforeSnapshot, afterSnapshot);
    if (!unexpectedChanges.length) {
      const screenshotFile = await savePageScreenshot(page, runtimeDir, fileName);
      return {
        pageUrl: page.url(),
        pageTitle: await page.title(),
        screenshotFile,
        filledFields
      };
    }

    await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
    await page.waitForTimeout(3000);
    await ensurePublishSectionTab(page, "\u57fa\u7840\u4fe1\u606f");
    await page.mouse.wheel(0, -4000).catch(() => {});
    await page.waitForTimeout(800);
  }

  throw new Error("Category attribute guard triggered after unexpected field changes; page was refreshed and basic info fill still did not stabilize.");
}

async function clickVisibleText(page: Page, text: string): Promise<boolean> {
  const target = page.getByText(text, { exact: true }).first();
  if (!(await target.count())) {
    return false;
  }
  await target.click({ timeout: 3000 }).catch(() => {});
  return true;
}

async function clickRadioByLabel(page: Page, labelText: string): Promise<boolean> {
  const radio = page.getByRole("radio", { name: labelText }).first();
  if (await radio.count()) {
    await radio.click({ timeout: 3000 }).catch(() => {});
    return true;
  }

  return page.evaluate((targetLabel) => {
    const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
    const elements = Array.from(document.querySelectorAll("body *")).map((el) => el as HTMLElement);
    const label = elements
      .map((el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        const text = normalize(el.innerText || el.textContent || "");
        if (!text || text !== targetLabel || rect.width <= 0 || rect.height <= 0 || style.display === "none" || style.visibility === "hidden") {
          return null;
        }
        return { el, rect };
      })
      .filter(Boolean)
      .sort((a, b) => (a?.rect.top || 0) - (b?.rect.top || 0))[0];
    if (!label) {
      return false;
    }

    const candidates = elements
      .map((el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        const marker = [String(el.className || ""), el.getAttribute("role") || "", el.tagName].join(" ").toLowerCase();
        if (
          rect.width <= 0 ||
          rect.height <= 0 ||
          style.display === "none" ||
          style.visibility === "hidden" ||
          rect.top < label.rect.top - 24 ||
          rect.top > label.rect.bottom + 24 ||
          rect.left < label.rect.left - 60 ||
          rect.left > label.rect.left + 10
        ) {
          return null;
        }
        const score =
          (marker.includes("radio") ? 200 : 0) +
          (el.getAttribute("aria-checked") ? 60 : 0) -
          Math.abs(rect.left - label.rect.left) -
          Math.abs(rect.top - label.rect.top);
        return score > 0 ? { el, score } : null;
      })
      .filter(Boolean)
      .sort((a, b) => (b?.score || 0) - (a?.score || 0))[0];

    if (!candidates) {
      return false;
    }
    candidates.el.click();
    return true;
  }, labelText);
}

async function dismissTransientOverlays(page: Page): Promise<void> {
  if (page.isClosed()) {
    return;
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (page.isClosed()) {
      return;
    }
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(250);
  }

  const cropDialogVisible = await page.evaluate(() => {
    const text = document.body.innerText || "";
    return text.includes("\u667a\u80fd\u88c1\u526a\u4e3a3:4\u4e3b\u56fe") || text.includes("\u5f53\u524d\u8fd8\u67093\u5f20\u56fe\u7247\u4e0d\u662f3:4\u6bd4\u4f8b");
  });
  if (cropDialogVisible && (await clickVisibleText(page, "\u53d6\u6d88"))) {
    if (page.isClosed()) {
      return;
    }
    await page.waitForTimeout(1000);
  }

  const clicked = await page.evaluate(() => {
    const modalTitle = "\u0041\u0049\u7d20\u6750\u5de5\u5177";
    const titleNode = Array.from(document.querySelectorAll("body *")).find((el) => {
      const text = (el.textContent || "").trim();
      if (text !== modalTitle) {
        return false;
      }
      const rect = (el as HTMLElement).getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }) as HTMLElement | undefined;

    if (!titleNode) {
      return false;
    }

    const panel = (titleNode.closest("[role='dialog']") ||
      titleNode.closest(".semi-modal, .semi-portal, .semi-drawer, .auxo-modal")) as HTMLElement | null;
    const root = panel || (titleNode.parentElement?.parentElement as HTMLElement | null);
    if (!root) {
      return false;
    }

    const rootRect = root.getBoundingClientRect();
    const closeCandidates = Array.from(root.querySelectorAll("button, [role='button'], span, div"))
      .map((el) => el as HTMLElement)
      .map((el) => {
        const rect = el.getBoundingClientRect();
        const text = (el.textContent || "").trim();
        if (rect.width <= 0 || rect.height <= 0) {
          return null;
        }
        if (rect.x < rootRect.x + rootRect.width * 0.7 || rect.y > rootRect.y + rootRect.height * 0.2) {
          return null;
        }
        if (text && text.length > 2) {
          return null;
        }
        return {
          el,
          x: rect.x,
          y: rect.y,
          score: rect.x - rect.y
        };
      })
      .filter(Boolean)
      .sort((a, b) => (b?.score || 0) - (a?.score || 0));

    const target = closeCandidates[0]?.el || null;
    target?.click();
    return Boolean(target);
  });

  if (clicked) {
    if (page.isClosed()) {
      return;
    }
    await page.waitForTimeout(1200);
  }
}

async function readActivePublishSectionTab(page: Page): Promise<string> {
  return page.evaluate(() => {
    const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
    const labels = ["基础信息", "图文信息", "价格库存", "服务与履约", "其他信息"];
    const nodes = Array.from(document.querySelectorAll("body *"))
      .map((el) => el as HTMLElement)
      .map((el) => {
        const text = normalize(el.innerText || el.textContent || "");
        if (!labels.includes(text)) {
          return null;
        }
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        if (rect.width <= 0 || rect.height <= 0 || rect.top > 220 || style.display === "none" || style.visibility === "hidden") {
          return null;
        }
        const marker = [String(el.className || ""), el.getAttribute("role") || ""].join(" ").toLowerCase();
        const color = style.color || "";
        const score =
          (marker.includes("active") ? 220 : 0) +
          (marker.includes("selected") ? 220 : 0) +
          (marker.includes("current") ? 220 : 0) +
          (el.getAttribute("aria-selected") === "true" ? 260 : 0) +
          (/rgb\(22,\s*119,\s*255\)/.test(color) ? 200 : 0) +
          (/rgb\(24,\s*144,\s*255\)/.test(color) ? 200 : 0) +
          (Number.parseInt(style.fontWeight || "400", 10) >= 500 ? 120 : 0);
        return { text, score, left: rect.left };
      })
      .filter(Boolean)
      .sort((a, b) => (b?.score || 0) - (a?.score || 0) || (a?.left || 0) - (b?.left || 0));

    return nodes[0]?.text || "";
  });
}

async function findPublishSectionTabCenter(page: Page, text: string): Promise<{ x: number; y: number } | null> {
  return page.evaluate((targetText) => {
    const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
    const nodes = Array.from(document.querySelectorAll("body *"))
      .map((el) => el as HTMLElement)
      .map((el) => {
        const text = normalize(el.innerText || el.textContent || "");
        if (text !== targetText) {
          return null;
        }
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        if (rect.width <= 0 || rect.height <= 0 || rect.top > 220 || style.display === "none" || style.visibility === "hidden") {
          return null;
        }
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, left: rect.left };
      })
      .filter(Boolean)
      .sort((a, b) => (a?.left || 0) - (b?.left || 0));

    return nodes[0] || null;
  }, text);
}

async function isPublishSectionContentVisible(page: Page, text: string): Promise<boolean> {
  return page.evaluate((targetText) => {
    const markersBySection: Record<string, string[]> = {
      "\u57fa\u7840\u4fe1\u606f": ["\u77ed\u6807\u9898", "\u578b\u53f7\u89c4\u683c"],
      "\u56fe\u6587\u4fe1\u606f": ["\u4e3b\u56fe", "\u5546\u54c1\u8be6\u60c5"],
      "\u4ef7\u683c\u5e93\u5b58": ["\u53d1\u8d27\u6a21\u5f0f", "\u73b0\u8d27\u53d1\u8d27\u65f6\u95f4", "\u5546\u54c1\u89c4\u683c"],
      "\u670d\u52a1\u4e0e\u5c65\u7ea6": ["\u552e\u540e\u670d\u52a1", "\u552e\u540e\u653f\u7b56", "\u552e\u540e\u670d\u52a1\u627f\u8bfa"],
      "\u5176\u4ed6\u4fe1\u606f": ["\u5176\u4ed6\u4fe1\u606f"]
    };
    const markers = markersBySection[targetText] || [targetText];
    const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
    const visibleTexts = Array.from(document.querySelectorAll("body *"))
      .map((el) => el as HTMLElement)
      .filter((el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          rect.top >= 120 &&
          rect.top <= window.innerHeight - 40 &&
          style.display !== "none" &&
          style.visibility !== "hidden"
        );
      })
      .map((el) => normalize(el.innerText || el.textContent || ""))
      .filter(Boolean);

    return markers.some((marker) => visibleTexts.some((text) => text.includes(marker)));
  }, text);
}

async function scrollPublishSectionContentIntoView(page: Page, text: string): Promise<boolean> {
  return page.evaluate((targetText) => {
    const markersBySection: Record<string, string[]> = {
      "\u57fa\u7840\u4fe1\u606f": ["\u77ed\u6807\u9898", "\u578b\u53f7\u89c4\u683c"],
      "\u56fe\u6587\u4fe1\u606f": ["\u4e3b\u56fe", "\u5546\u54c1\u8be6\u60c5"],
      "\u4ef7\u683c\u5e93\u5b58": ["\u53d1\u8d27\u6a21\u5f0f", "\u73b0\u8d27\u53d1\u8d27\u65f6\u95f4", "\u5546\u54c1\u89c4\u683c"],
      "\u670d\u52a1\u4e0e\u5c65\u7ea6": ["\u552e\u540e\u670d\u52a1", "\u552e\u540e\u653f\u7b56", "\u552e\u540e\u670d\u52a1\u627f\u8bfa"],
      "\u5176\u4ed6\u4fe1\u606f": ["\u5176\u4ed6\u4fe1\u606f"]
    };
    const markers = markersBySection[targetText] || [targetText];
    const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
    const target = Array.from(document.querySelectorAll("body *"))
      .map((el) => el as HTMLElement)
      .map((el) => {
        const text = normalize(el.innerText || el.textContent || "");
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        if (
          !text ||
          rect.width <= 0 ||
          rect.height <= 0 ||
          style.display === "none" ||
          style.visibility === "hidden" ||
          !markers.some((marker) => text.includes(marker))
        ) {
          return null;
        }
        return { el, top: rect.top };
      })
      .filter(Boolean)
      .sort((a, b) => Math.abs((a?.top || 0) - 180) - Math.abs((b?.top || 0) - 180))[0];

    if (!target) {
      return false;
    }

    target.el.scrollIntoView({ block: "start", behavior: "instant" });
    return true;
  }, text);
}

async function scrollLabelIntoView(page: Page, labelText: string): Promise<boolean> {
  return page.evaluate((targetLabel) => {
    const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
    const target = Array.from(document.querySelectorAll("body *"))
      .map((el) => el as HTMLElement)
      .map((el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        const text = normalize(el.innerText || el.textContent || "");
        if (
          !text ||
          !text.includes(targetLabel) ||
          rect.width <= 0 ||
          rect.height <= 0 ||
          style.display === "none" ||
          style.visibility === "hidden"
        ) {
          return null;
        }
        return { el, text, score: (text === targetLabel ? 1000 : 0) - text.length };
      })
      .filter(Boolean)
      .sort((a, b) => (b?.score || 0) - (a?.score || 0))[0];

    if (!target) {
      return false;
    }

    target.el.scrollIntoView({ block: "center", behavior: "instant" });
    return true;
  }, labelText);
}

async function findLabelAbsoluteTop(page: Page, labelText: string): Promise<number | null> {
  return page.evaluate((targetLabel) => {
    const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
    const target = Array.from(document.querySelectorAll("body *"))
      .map((el) => el as HTMLElement)
      .map((el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        const text = normalize(el.innerText || el.textContent || "");
        if (
          !text ||
          !text.includes(targetLabel) ||
          rect.width <= 0 ||
          rect.height <= 0 ||
          style.display === "none" ||
          style.visibility === "hidden"
        ) {
          return null;
        }
        return { top: rect.top + window.scrollY, score: (text === targetLabel ? 1000 : 0) - text.length };
      })
      .filter(Boolean)
      .sort((a, b) => (b?.score || 0) - (a?.score || 0))[0];

    return typeof target?.top === "number" ? target.top : null;
  }, labelText);
}

async function scrollUntilPublishSectionVisible(page: Page, text: string): Promise<boolean> {
  if (await isPublishSectionContentVisible(page, text).catch(() => false)) {
    return true;
  }

  for (let attempt = 0; attempt < 30; attempt += 1) {
    await page.mouse.wheel(0, 1200).catch(() => {});
    await page.waitForTimeout(500);
    if (await isPublishSectionContentVisible(page, text).catch(() => false)) {
      return true;
    }
    await scrollPublishSectionContentIntoView(page, text).catch(() => false);
    await page.waitForTimeout(350);
    if (await isPublishSectionContentVisible(page, text).catch(() => false)) {
      return true;
    }
  }

  return false;
}

async function ensurePublishSectionTab(page: Page, text: string): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await dismissTransientOverlays(page);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" })).catch(() => {});
    await page.waitForTimeout(400);
    if (await isPublishSectionContentVisible(page, text).catch(() => false)) {
      return;
    }

    const tab = page.getByRole("tab", { name: text }).first();
    if (await tab.count()) {
      await tab.click({ timeout: 3000 }).catch(() => {});
    }

    if (!(await isPublishSectionContentVisible(page, text).catch(() => false))) {
      const topTabClicked = await page
        .evaluate((targetText) => {
          const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
          const candidates = Array.from(document.querySelectorAll("body *"))
            .map((node) => node as HTMLElement)
            .map((el) => {
              const rect = el.getBoundingClientRect();
              const style = window.getComputedStyle(el);
              const text = normalize(el.innerText || el.textContent || "");
              if (
                text !== targetText ||
                rect.width <= 0 ||
                rect.height <= 0 ||
                rect.top < 60 ||
                rect.top > 240 ||
                rect.left < window.innerWidth * 0.18 ||
                rect.left > window.innerWidth * 0.72 ||
                style.display === "none" ||
                style.visibility === "hidden"
              ) {
                return null;
              }
              return { el, score: (rect.top < 150 ? 40 : 0) - Math.abs(rect.top - 165) - text.length };
            })
            .filter(Boolean)
            .sort((a, b) => (b?.score || 0) - (a?.score || 0))[0];
          if (!candidates) {
            return false;
          }
          candidates.el.click();
          return true;
        }, text)
        .catch(() => false);
      if (topTabClicked) {
        await page.waitForTimeout(700);
      }
    }

    if (!(await isPublishSectionContentVisible(page, text).catch(() => false))) {
      const center = await findPublishSectionTabCenter(page, text);
      if (center) {
        await page.mouse.click(center.x, center.y, { delay: 70 }).catch(() => {});
      }
    }

    if (!(await isPublishSectionContentVisible(page, text).catch(() => false))) {
      await page.evaluate((targetText) => {
        const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
        const target = Array.from(document.querySelectorAll("body *"))
          .map((el) => el as HTMLElement)
          .find((el) => normalize(el.innerText || el.textContent || "") === targetText);
        target?.click();
      }, text).catch(() => {});
    }

    if (!(await isPublishSectionContentVisible(page, text).catch(() => false))) {
      await clickVisibleText(page, text);
    }

    await scrollPublishSectionContentIntoView(page, text).catch(() => false);
    await page.waitForTimeout(900);
    if (await isPublishSectionContentVisible(page, text).catch(() => false)) {
      return;
    }
  }

  const activeTab = await readActivePublishSectionTab(page).catch(() => "");
  throw new Error(`Failed to activate publish section tab: expected=${text}; actual=${activeTab || "<unknown>"}`);
}

async function ensureServiceSectionReady(page: Page): Promise<void> {
  await ensurePublishSectionTab(page, "\u670d\u52a1\u4e0e\u5c65\u7ea6");
  const freightLabelTop = await findLabelAbsoluteTop(page, "\u8fd0\u8d39\u6a21\u677f").catch(() => null);
  if (typeof freightLabelTop === "number") {
    await page.evaluate((top) => window.scrollTo({ top: Math.max(0, top - 180), behavior: "instant" }), freightLabelTop).catch(() => {});
    await page.waitForTimeout(500);
  }
  const freightLabelVisible = await scrollLabelIntoView(page, "\u8fd0\u8d39\u6a21\u677f").catch(() => false);
  await scrollPublishSectionContentIntoView(page, "\u670d\u52a1\u4e0e\u5c65\u7ea6").catch(() => false);
  await page.waitForTimeout(500);
  const ready = freightLabelVisible || (await scrollLabelIntoView(page, "\u8fd0\u8d39\u6a21\u677f").catch(() => false)) || false;
  if (!ready) {
    throw new Error("Service section freight label is not visible after tab activation.");
  }
}

async function findSearchInputIndexByHints(page: Page, hints: string[]): Promise<number> {
  return page.evaluate((expectedHints) => {
    const inputs = Array.from(document.querySelectorAll("input[type='search']"));
    return inputs.findIndex((el) => {
      const input = el as HTMLInputElement;
      const rect = input.getBoundingClientRect();
      if (rect.width <= 120 || rect.height <= 0) {
        return false;
      }
      const contextText = [
        input.parentElement?.parentElement?.textContent || "",
        input.closest("div")?.textContent || ""
      ]
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      return expectedHints.some((hint) => contextText.includes(hint));
    });
  }, hints);
}

async function readSearchInputValueByHints(page: Page, hints: string[]): Promise<string> {
  return page.evaluate((expectedHints) => {
    const inputs = Array.from(document.querySelectorAll("input[type='search']"));
    const target = inputs.find((el) => {
      const input = el as HTMLInputElement;
      const rect = input.getBoundingClientRect();
      if (rect.width <= 120 || rect.height <= 0) {
        return false;
      }
      const contextText = [
        input.parentElement?.parentElement?.textContent || "",
        input.closest("div")?.textContent || ""
      ]
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      return expectedHints.some((hint) => contextText.includes(hint));
    }) as HTMLInputElement | undefined;
    return (target?.value || "").trim();
  }, hints);
}

async function readComboboxContextValueByHints(page: Page, hints: string[]): Promise<string> {
  return page.evaluate((expectedHints) => {
    const inputs = Array.from(document.querySelectorAll("input[type='search'], input[role='combobox']"));
    const target = inputs.find((el) => {
      const input = el as HTMLInputElement;
      const rect = input.getBoundingClientRect();
      if (rect.width <= 120 || rect.height <= 0) {
        return false;
      }
      const contextText = [
        input.parentElement?.parentElement?.textContent || "",
        input.closest("div")?.textContent || ""
      ]
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      return expectedHints.some((hint) => contextText.includes(hint));
    }) as HTMLInputElement | undefined;

    if (!target) {
      return "";
    }

    const directValue = (target.value || "").trim();
    if (directValue) {
      return directValue;
    }

    const container = (target.closest(".ecom-g-select, .semi-select, [class*='select'], [class*='Select']") ||
      target.parentElement?.parentElement ||
      target.closest("div")) as HTMLElement | null;
    const text = (container?.innerText || "").replace(/\s+/g, " ").trim();
    return text;
  }, hints);
}

async function chooseKeywordFromSearchDropdown(page: Page, hints: string[], keyword: string): Promise<string> {
  const inputIndex = await findSearchInputIndexByHints(page, hints);
  if (inputIndex < 0) {
    return "";
  }

  const input = page.locator("input[type='search']").nth(inputIndex);
  await input.click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(500);
  await input.fill(keyword).catch(() => {});
  await page.waitForTimeout(600);

  if (!(await clickVisibleDropdownOption(page, keyword))) {
    const fallbackOption = page.getByText(new RegExp(keyword)).first();
    if (await fallbackOption.count()) {
      await fallbackOption.click({ timeout: 3000 }).catch(() => {});
    }
  }

  await page.waitForTimeout(800);
  const selectedValue = await readComboboxContextValueByHints(page, hints);
  return selectedValue;
}

async function scrollMainFormContainerToBottom(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const scroller = document.querySelector(".style_form__oPtxc.overflow-scoll_overflowScroll__qD5wq") as HTMLElement | null;
    if (!scroller) {
      return false;
    }
    scroller.scrollTop = scroller.scrollHeight;
    return true;
  });
}

async function scrollMainFormContainerToTop(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const scroller = document.querySelector(".style_form__oPtxc.overflow-scoll_overflowScroll__qD5wq") as HTMLElement | null;
    if (!scroller) {
      return false;
    }
    scroller.scrollTop = 0;
    return true;
  });
}

async function revealFreightTemplateControl(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await ensurePublishSectionTab(page, "\u670d\u52a1\u4e0e\u5c65\u7ea6").catch(() => {});
    await scrollMainFormContainerToTop(page).catch(() => false);
    await scrollPublishSectionContentIntoView(page, "\u670d\u52a1\u4e0e\u5c65\u7ea6").catch(() => false);
    await page.waitForTimeout(400);
    await scrollLabelIntoView(page, "\u8fd0\u8d39\u6a21\u677f").catch(() => false);
    await page.waitForTimeout(500);
    const freightControl = await findDropdownControlByLabel(page, "运费模板").catch(() => null);
    if (freightControl) {
      return;
    }
  }
}

async function findFreightTemplateInputCenter(page: Page): Promise<{ x: number; y: number } | null> {
  return page.evaluate(() => {
    const fields = Array.from(document.querySelectorAll("input[type='search'], input[role='combobox'], input"))
      .map((el) => {
        const input = el as HTMLInputElement;
        const rect = input.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) {
          return null;
        }
        const ancestors: string[] = [];
        let node = input.parentElement;
        for (let index = 0; index < 6 && node; index += 1) {
          ancestors.push((node.textContent || "").trim().replace(/\s+/g, " ").slice(0, 160));
          node = node.parentElement;
        }
        return {
          type: input.getAttribute("type") || "",
          role: input.getAttribute("role") || "",
          x: rect.x + rect.width / 2,
          y: rect.y + rect.height / 2,
          width: rect.width,
          text: (
            input.value ||
            input.parentElement?.innerText ||
            input.parentElement?.parentElement?.innerText ||
            input.closest("div")?.innerText ||
            ""
          ).trim(),
          ancestors
        };
      })
      .filter(Boolean) as Array<{
        type: string;
        role: string;
        x: number;
        y: number;
        width: number;
        text: string;
        ancestors: string[];
      }>;

    const target = fields
      .filter((field) => (field.type === "search" || field.role === "combobox") && field.width > 180)
      .map((field) => {
        const context = [field.text, ...field.ancestors].join(" ").replace(/\s+/g, " ").trim();
        const score =
          (context.includes("\u8fd0\u8d39\u6a21\u677f") ? 100 : 0) +
          (context.includes("\u5ef6\u8349\u8fd0\u8d39") ? 80 : 0) +
          (context.includes("\u5305\u90ae") ? 50 : 0) +
          (context.includes("\u8fd0\u8d39") ? 40 : 0) -
          (context.includes("7\u5929\u65e0\u7406\u7531\u9000\u8d27") ? 120 : 0) -
          (context.includes("\u9000\u8d27") ? 60 : 0);
        return { ...field, score };
      })
      .filter((field) => field.score > 0)
      .sort((a, b) => b.score - a.score || a.y - b.y)[0];
    return target ? { x: target.x, y: target.y } : null;
  });
}

async function readFreightTemplateValue(page: Page): Promise<string> {
  return page.evaluate(() => {
    const fields = Array.from(document.querySelectorAll("input[type='search'], input[role='combobox'], input"))
      .map((el) => el as HTMLInputElement)
      .map((input) => {
        const rect = input.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) {
          return null;
        }
        const context = [
          input.value || "",
          input.parentElement?.innerText || "",
          input.parentElement?.parentElement?.innerText || "",
          input.closest("div")?.innerText || ""
        ]
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
        const score =
          (context.includes("\u8fd0\u8d39\u6a21\u677f") ? 100 : 0) +
          (context.includes("\u5ef6\u8349\u8fd0\u8d39") ? 80 : 0) +
          (context.includes("\u5305\u90ae") ? 50 : 0) +
          (context.includes("\u8fd0\u8d39") ? 40 : 0) -
          (context.includes("7\u5929\u65e0\u7406\u7531\u9000\u8d27") ? 120 : 0) -
          (context.includes("\u9000\u8d27") ? 60 : 0);
        return score > 0 ? { context, score } : null;
      })
      .filter(Boolean)
      .sort((a, b) => (b?.score || 0) - (a?.score || 0));
    return fields[0]?.context || "";
  });
}

async function findDropdownControlByLabel(
  page: Page,
  labelText: string
): Promise<{ x: number; y: number; absY: number } | null> {
  return page.evaluate((targetLabel) => {
    const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
    const elements = Array.from(document.querySelectorAll("body *")).map((el) => el as HTMLElement);
    const label = elements
      .map((el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        const text = normalize(el.textContent || "");
        if (!text || rect.width <= 0 || rect.height <= 0 || style.display === "none" || style.visibility === "hidden") {
          return null;
        }
        return { el, text, rect, score: (text === targetLabel ? 1000 : 0) - text.length };
      })
      .filter(Boolean)
      .filter((item) => item!.text.includes(targetLabel))
      .sort((a, b) => (b!.score || 0) - (a!.score || 0))[0];

    if (!label) {
      return null;
    }

    const candidates = elements
      .map((el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        if (rect.width < 120 || rect.height < 24 || style.display === "none" || style.visibility === "hidden") {
          return null;
        }
        if (rect.left <= label.rect.right + 8 || rect.top < label.rect.top - 30 || rect.top > label.rect.bottom + 30) {
          return null;
        }
        const text = normalize(el.textContent || "");
        const marker = [String(el.className || ""), el.getAttribute("role") || "", el.tagName].join(" ").toLowerCase();
        const score =
          (marker.includes("select") ? 120 : 0) +
          (marker.includes("dropdown") ? 100 : 0) +
          (marker.includes("combobox") ? 100 : 0) +
          (el.querySelector("input[type='search'], input[role='combobox']") ? 120 : 0) +
          (text.includes("包邮") ? 60 : 0) +
          (text.includes("运费") ? 60 : 0) -
          Math.abs(rect.top - label.rect.top) -
          (rect.left - label.rect.right) / 10;
        return score > 0
          ? {
              x: rect.x + rect.width / 2,
              y: rect.y + rect.height / 2,
              absY: rect.y + rect.height / 2 + window.scrollY,
              score
            }
          : null;
      })
      .filter(Boolean)
      .sort((a, b) => (b?.score || 0) - (a?.score || 0));

    return candidates[0] || null;
  }, labelText);
}

async function readDropdownValueByLabel(page: Page, labelText: string): Promise<string> {
  return page.evaluate((targetLabel) => {
    const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
    const elements = Array.from(document.querySelectorAll("body *")).map((el) => el as HTMLElement);
    const label = elements
      .map((el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        const text = normalize(el.textContent || "");
        if (!text || rect.width <= 0 || rect.height <= 0 || style.display === "none" || style.visibility === "hidden") {
          return null;
        }
        return { el, text, rect, score: (text === targetLabel ? 1000 : 0) - text.length };
      })
      .filter(Boolean)
      .filter((item) => item!.text.includes(targetLabel))
      .sort((a, b) => (b!.score || 0) - (a!.score || 0))[0];

    if (!label) {
      return "";
    }

    const candidates = elements
      .map((el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        if (rect.width < 120 || rect.height < 24 || style.display === "none" || style.visibility === "hidden") {
          return null;
        }
        if (rect.left <= label.rect.right + 8 || rect.top < label.rect.top - 30 || rect.top > label.rect.bottom + 30) {
          return null;
        }
        const marker = [String(el.className || ""), el.getAttribute("role") || "", el.tagName].join(" ").toLowerCase();
        const input = el.querySelector("input[type='search'], input[role='combobox']") as HTMLInputElement | null;
        const text = normalize([input?.value || "", el.innerText || ""].join(" "));
        const score =
          (marker.includes("select") ? 120 : 0) +
          (marker.includes("dropdown") ? 100 : 0) +
          (marker.includes("combobox") ? 100 : 0) +
          (input ? 120 : 0) +
          (text.includes("包邮") ? 60 : 0) +
          (text.includes("运费") ? 60 : 0) -
          Math.abs(rect.top - label.rect.top) -
          (rect.left - label.rect.right) / 10;
        return score > 0 ? { text, score } : null;
      })
      .filter(Boolean)
      .sort((a, b) => (b?.score || 0) - (a?.score || 0));

    return candidates[0]?.text || "";
  }, labelText);
}

async function findServiceFreightTemplateCombobox(page: Page): Promise<{ x: number; y: number; absY: number } | null> {
  return page.evaluate(() => {
    const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
    const roots = Array.from(
      document.querySelectorAll(
        ".ecom-g-select, .ant-select, [role='combobox'], [class*='select'], [class*='Select'], [class*='dropdown'], [class*='Dropdown']"
      )
    )
      .map((el) => el as HTMLElement)
      .map((root) => {
        const rect = root.getBoundingClientRect();
        const style = window.getComputedStyle(root);
        if (
          rect.width < 150 ||
          rect.height < 28 ||
          style.display === "none" ||
          style.visibility === "hidden"
        ) {
          return null;
        }
        const marker = [String(root.className || ""), root.getAttribute("role") || "", root.tagName].join(" ").toLowerCase();
        if (!marker.includes("select") && !marker.includes("dropdown") && !marker.includes("combobox")) {
          return null;
        }
        const input = root.querySelector("input[type='search'], input[role='combobox']") as HTMLInputElement | null;
        return {
          x: rect.x + rect.width / 2,
          y: rect.y + rect.height / 2,
          absY: rect.y + rect.height / 2 + window.scrollY,
          top: rect.top,
          width: rect.width,
          left: rect.left,
          context: normalize(
            [
              input?.value || "",
              root.innerText || "",
              root.parentElement?.innerText || "",
              root.parentElement?.parentElement?.innerText || ""
            ].join(" ")
          )
        };
      })
      .filter(Boolean) as Array<{ x: number; y: number; absY: number; top: number; width: number; left: number; context: string }>;

    const preferred = roots
      .map((item) => {
        const score =
          (item.context.includes("\u8fd0\u8d39\u6a21\u677f") ? 300 : 0) +
          (item.context.includes("\u5ef6\u8349\u8fd0\u8d39") ? 260 : 0) +
          (item.context.includes("\u5305\u90ae") ? 220 : 0) +
          (item.context.includes("\u8fd0\u8d39") ? 160 : 0) +
          (item.context.includes("\u552e\u540e\u653f\u7b56") ? -240 : 0) +
          (item.context.includes("7\u5929\u65e0\u7406\u7531\u9000\u8d27") ? -260 : 0) +
          (item.context.includes("\u9000\u8d27") ? -160 : 0) +
          (item.context.includes("\u4e0d\u5305\u542b") ? -120 : 0) +
          (item.context.includes("\u63d0\u4f9b\u66f4\u957f") ? -120 : 0) +
          (item.left > 200 ? 60 : 0) +
          (item.top < 280 ? 200 : 0) +
          (item.top < 360 ? 80 : 0) -
          item.top / 16;
        return { ...item, score };
      })
      .sort((a, b) => b.score - a.score || a.top - b.top)[0];

    if (preferred && preferred.score > 0) {
      return { x: preferred.x, y: preferred.y, absY: preferred.absY };
    }

    return null;
  });
}

async function readServiceFreightTemplateValue(page: Page): Promise<string> {
  return page.evaluate(() => {
    const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
    const controls = Array.from(
      document.querySelectorAll(
        ".ecom-g-select, .ant-select, [role='combobox'], [class*='select'], [class*='Select'], [class*='dropdown'], [class*='Dropdown']"
      )
    )
      .map((el) => el as HTMLElement)
      .map((root) => {
        const rect = root.getBoundingClientRect();
        const style = window.getComputedStyle(root);
        if (
          rect.width < 150 ||
          rect.height < 28 ||
          style.display === "none" ||
          style.visibility === "hidden"
        ) {
          return null;
        }
        const marker = [String(root.className || ""), root.getAttribute("role") || "", root.tagName].join(" ").toLowerCase();
        if (!marker.includes("select") && !marker.includes("dropdown") && !marker.includes("combobox")) {
          return null;
        }
        const input = root.querySelector("input[type='search'], input[role='combobox']") as HTMLInputElement | null;
        const selectedText =
          normalize(
            [
              (root.querySelector(".ecom-g-select-selection-item") as HTMLElement | null)?.innerText || "",
              (root.querySelector(".ant-select-selection-item") as HTMLElement | null)?.innerText || "",
              input?.value || "",
              root.innerText || ""
            ].join(" ")
          ) || "";
        const context = normalize(
          [
            selectedText,
            root.parentElement?.innerText || "",
            root.parentElement?.parentElement?.innerText || ""
          ].join(" ")
        );
        return {
          top: rect.top,
          left: rect.left,
          value: selectedText,
          context,
          score:
            (context.includes("\u8fd0\u8d39\u6a21\u677f") ? 300 : 0) +
            (context.includes("\u5ef6\u8349\u8fd0\u8d39") ? 260 : 0) +
            (context.includes("\u5305\u90ae") ? 220 : 0) +
            (context.includes("\u8fd0\u8d39") ? 160 : 0) +
            (context.includes("\u552e\u540e\u653f\u7b56") ? -240 : 0) +
            (context.includes("7\u5929\u65e0\u7406\u7531\u9000\u8d27") ? -260 : 0) +
            (context.includes("\u9000\u8d27") ? -160 : 0) +
            (context.includes("\u4e0d\u5305\u542b") ? -120 : 0) +
            (context.includes("\u63d0\u4f9b\u66f4\u957f") ? -120 : 0) +
            (rect.left > 200 ? 60 : 0) +
            (rect.top < 280 ? 200 : 0) +
            (rect.top < 360 ? 80 : 0) -
            rect.top / 16
        };
      })
      .filter(Boolean)
      .sort((a, b) => (b?.score || 0) - (a?.score || 0) || (a?.top || 0) - (b?.top || 0));

    return controls[0]?.value || "";
  });
}

async function clickFreightTemplateDropdownOption(page: Page, keyword: string): Promise<string> {
  const picked = await page.evaluate((targetKeyword) => {
    const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
    const candidates = Array.from(
      document.querySelectorAll(
        "[role='option'], .ecom-g-select-item-option, .ant-select-item-option, .semi-select-option, .semi-select-option-content, .semi-tree-option, .semi-tree-option-list li, .ecom-g-select-option"
      )
    )
      .map((el) => el as HTMLElement)
      .map((el) => {
        const text = normalize(el.textContent || "");
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        if (
          !text ||
          !text.includes(targetKeyword) ||
          rect.width <= 0 ||
          rect.height <= 0 ||
          style.display === "none" ||
          style.visibility === "hidden"
        ) {
          return null;
        }
        const marker = [String(el.className || ""), el.getAttribute("role") || "", el.tagName].join(" ").toLowerCase();
        const score =
          (text === targetKeyword ? 300 : 0) +
          (text.includes("\u6a21\u677f") ? 120 : 0) +
          (marker.includes("option") ? 100 : 0) +
          (marker.includes("select") ? 80 : 0) +
          (marker.includes("dropdown") ? 80 : 0) +
          (marker.includes("item") ? 50 : 0) +
          (rect.top > 120 ? 40 : 0) -
          text.length;
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, text, score };
      })
      .filter(Boolean)
      .sort((a, b) => (b?.score || 0) - (a?.score || 0));

    const target = candidates[0];
    if (!target) {
      return null;
    }
    const node = document.elementFromPoint(target.x, target.y) as HTMLElement | null;
    const clickable = (
      node?.closest("[role='option'], .ecom-g-select-item-option, .ant-select-item-option, .semi-select-option, li, .ecom-g-select-option") ||
      node
    ) as HTMLElement | null;
    clickable?.click();
    return target.text;
  }, keyword);

  await page.waitForTimeout(800);
  return picked || "";
}

async function clickDropdownControlByLabelDirect(page: Page, labelText: string): Promise<boolean> {
  return page.evaluate((targetLabel) => {
    const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
    const elements = Array.from(document.querySelectorAll("body *")).map((el) => el as HTMLElement);
    const label = elements
      .map((el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        const text = normalize(el.innerText || el.textContent || "");
        if (!text || !text.includes(targetLabel) || rect.width <= 0 || rect.height <= 0 || style.display === "none" || style.visibility === "hidden") {
          return null;
        }
        return { el, rect, text, score: (text === targetLabel ? 1000 : 0) - text.length };
      })
      .filter(Boolean)
      .sort((a, b) => (b?.score || 0) - (a?.score || 0))[0];

    if (!label) {
      return false;
    }

    const control = elements
      .map((el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        if (rect.width < 120 || rect.height < 24 || style.display === "none" || style.visibility === "hidden") {
          return null;
        }
        if (rect.left <= label.rect.right + 8 || rect.top < label.rect.top - 36 || rect.top > label.rect.bottom + 36) {
          return null;
        }
        const marker = [String(el.className || ""), el.getAttribute("role") || "", el.tagName].join(" ").toLowerCase();
        const score =
          (marker.includes("select") ? 120 : 0) +
          (marker.includes("dropdown") ? 100 : 0) +
          (marker.includes("combobox") ? 100 : 0) +
          (el.querySelector("input[type='search'], input[role='combobox']") ? 140 : 0) -
          Math.abs(rect.top - label.rect.top) -
          (rect.left - label.rect.right) / 10;
        return score > 0 ? { el, score } : null;
      })
      .filter(Boolean)
      .sort((a, b) => (b?.score || 0) - (a?.score || 0))[0];

    if (!control) {
      return false;
    }

    const trigger = (control.el.querySelector(
      ".ecom-g-select-selector, .ant-select-selector, [class*='selector'], [class*='selection'], [role='combobox'], input"
    ) || control.el) as HTMLElement;
    trigger.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
    trigger.click();
    return true;
  }, labelText);
}

async function readVisibleFreightTemplateOptionTexts(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
    const options = Array.from(document.querySelectorAll("body *"))
      .map((el) => el as HTMLElement)
      .map((el) => {
        const text = normalize(el.innerText || el.textContent || "");
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        const marker = [String(el.className || ""), el.getAttribute("role") || "", el.tagName].join(" ").toLowerCase();
        if (
          !text ||
          rect.width <= 0 ||
          rect.height <= 0 ||
          style.display === "none" ||
          style.visibility === "hidden" ||
          (!marker.includes("option") && !marker.includes("dropdown") && !marker.includes("select") && !marker.includes("item"))
        ) {
          return null;
        }
        return text;
      })
      .filter(Boolean) as string[];

    return Array.from(new Set(options)).slice(0, 20);
  });
}

async function readLabeledSelectValue(page: Page, labelText: string): Promise<string> {
  return page.evaluate((targetLabel) => {
    const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
    const elements = Array.from(document.querySelectorAll("body *")).map((el) => el as HTMLElement);
    const label = elements
      .map((el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        const text = normalize(el.innerText || el.textContent || "");
        if (!text || !text.includes(targetLabel) || rect.width <= 0 || rect.height <= 0 || style.display === "none" || style.visibility === "hidden") {
          return null;
        }
        return { rect, text, score: (text === targetLabel ? 1000 : 0) - text.length };
      })
      .filter(Boolean)
      .sort((a, b) => (b?.score || 0) - (a?.score || 0))[0];

    if (!label) {
      return "";
    }

    const control = elements
      .map((el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        if (rect.width < 120 || rect.height < 24 || style.display === "none" || style.visibility === "hidden") {
          return null;
        }
        if (rect.left <= label.rect.right + 8 || rect.top < label.rect.top - 24 || rect.top > label.rect.bottom + 24) {
          return null;
        }
        const input = el.querySelector("input[type='search'], input[role='combobox']") as HTMLInputElement | null;
        const selection =
          normalize(
            [
              (el.querySelector(".ecom-g-select-selection-item") as HTMLElement | null)?.innerText || "",
              (el.querySelector(".ant-select-selection-item") as HTMLElement | null)?.innerText || "",
              input?.value || "",
              el.innerText || ""
            ].join(" ")
          ) || "";
        return selection ? { selection, distance: Math.abs(rect.top - label.rect.top) + Math.abs(rect.left - label.rect.right) / 10 } : null;
      })
      .filter(Boolean)
      .sort((a, b) => (a?.distance || 0) - (b?.distance || 0))[0];

    return control?.selection || "";
  }, labelText);
}

async function clickLabeledSelect(page: Page, labelText: string): Promise<boolean> {
  return page.evaluate((targetLabel) => {
    const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
    const elements = Array.from(document.querySelectorAll("body *")).map((el) => el as HTMLElement);
    const label = elements
      .map((el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        const text = normalize(el.innerText || el.textContent || "");
        if (!text || !text.includes(targetLabel) || rect.width <= 0 || rect.height <= 0 || style.display === "none" || style.visibility === "hidden") {
          return null;
        }
        return { rect, text, score: (text === targetLabel ? 1000 : 0) - text.length };
      })
      .filter(Boolean)
      .sort((a, b) => (b?.score || 0) - (a?.score || 0))[0];

    if (!label) {
      return false;
    }

    const control = elements
      .map((el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        if (rect.width < 120 || rect.height < 24 || style.display === "none" || style.visibility === "hidden") {
          return null;
        }
        if (rect.left <= label.rect.right + 8 || rect.top < label.rect.top - 24 || rect.top > label.rect.bottom + 24) {
          return null;
        }
        const marker = [String(el.className || ""), el.getAttribute("role") || "", el.tagName].join(" ").toLowerCase();
        const score =
          (marker.includes("select") ? 120 : 0) +
          (marker.includes("dropdown") ? 100 : 0) +
          (marker.includes("combobox") ? 100 : 0) +
          (el.querySelector("input[type='search'], input[role='combobox']") ? 140 : 0) -
          Math.abs(rect.top - label.rect.top) -
          (rect.left - label.rect.right) / 10;
        return score > 0 ? { el, score } : null;
      })
      .filter(Boolean)
      .sort((a, b) => (b?.score || 0) - (a?.score || 0))[0];

    if (!control) {
      return false;
    }
    const trigger = (control.el.querySelector(
      ".ecom-g-select-selector, .ant-select-selector, [class*='selector'], [class*='selection'], [role='combobox'], input"
    ) || control.el) as HTMLElement;
    trigger.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
    trigger.click();
    return true;
  }, labelText);
}

async function chooseNonFreeShippingTemplate(page: Page): Promise<string> {
  const freightCenter = await findFreightTemplateInputCenter(page);
  if (!freightCenter) {
    throw new Error("Freight template input not found on publish page.");
  }

  await page.mouse.click(freightCenter.x, freightCenter.y, { delay: 80 });
  await page.waitForTimeout(1200);

  const picked = await page.evaluate(() => {
    const elements = Array.from(document.querySelectorAll("body *"));
    const candidates = elements
      .map((el) => {
        const text = (el.textContent || "").trim();
        if (!text || text.includes("\u5305\u90AE") || text.length > 30 || text === "\u8FD0\u8D39\u6A21\u677F") {
          return null;
        }
        const htmlEl = el as HTMLElement;
        const rect = htmlEl.getBoundingClientRect();
        const style = window.getComputedStyle(htmlEl);
        if (
          rect.width <= 0 ||
          rect.height <= 0 ||
          rect.y < 300 ||
          style.visibility === "hidden" ||
          style.display === "none"
        ) {
          return null;
        }
        const marker = [htmlEl.className, htmlEl.getAttribute("role") || "", htmlEl.tagName].join(" ").toLowerCase();
        const score =
          (text.includes("\u8FD0\u8D39") ? 8 : 0) +
          (text.includes("\u6A21\u677F") ? 6 : 0) +
          (marker.includes("option") ? 5 : 0) +
          (marker.includes("select") ? 4 : 0) +
          (marker.includes("dropdown") ? 4 : 0) +
          (marker.includes("item") ? 2 : 0) -
          text.length / 50;
        return {
          text,
          x: rect.x + rect.width / 2,
          y: rect.y + rect.height / 2,
          score
        };
      })
      .filter(Boolean)
      .sort((a, b) => (b?.score || 0) - (a?.score || 0));

    return candidates[0] || null;
  });

  if (!picked) {
    throw new Error("No visible non-free-shipping freight template option found.");
  }

  await page.mouse.click(picked.x, picked.y, { delay: 90 });
  await page.waitForTimeout(800);
  return picked.text;
}

async function chooseKeywordFreightTemplate(page: Page, keyword: string): Promise<string> {
  await dismissTransientOverlays(page);
  await revealFreightTemplateControl(page);

  let selectedValue = await readLabeledSelectValue(page, "\u8fd0\u8d39\u6a21\u677f").catch(() => "");
  if (selectedValue.includes(keyword)) {
    return selectedValue;
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    await dismissTransientOverlays(page);
    const clickedDirect =
      (await clickLabeledSelect(page, "\u8fd0\u8d39\u6a21\u677f").catch(() => false)) ||
      (await clickDropdownControlByLabelDirect(page, "\u8fd0\u8d39\u6a21\u677f").catch(() => false));
    if (!clickedDirect) {
      const freightCenter =
        (await findDropdownControlByLabel(page, "\u8fd0\u8d39\u6a21\u677f").catch(() => null)) ||
        (await findServiceFreightTemplateCombobox(page).catch(() => null)) ||
        (await findFreightTemplateInputCenter(page));
      if (!freightCenter) {
        throw new Error(`No visible freight template combobox matched keyword: ${keyword}`);
      }
      let clickY = freightCenter.y;
      if ("absY" in freightCenter && typeof freightCenter.absY === "number") {
        await page
          .evaluate((top) => window.scrollTo({ top: Math.max(0, top - 220), behavior: "instant" }), freightCenter.absY)
          .catch(() => {});
        await page.waitForTimeout(450);
        const scrollY = await page.evaluate(() => window.scrollY).catch(() => 0);
        clickY = freightCenter.absY - scrollY;
      }
      await page.mouse.click(freightCenter.x, clickY, { delay: 80 });
    }
    await page.waitForTimeout(600);

    await clickFreightTemplateDropdownOption(page, keyword).catch(() => "");
    await page.waitForTimeout(800);
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(400);
    selectedValue = await readLabeledSelectValue(page, "\u8fd0\u8d39\u6a21\u677f").catch(() => "");
    if (!selectedValue.includes(keyword)) {
      selectedValue = await readServiceFreightTemplateValue(page).catch(() => "");
    }
    if (selectedValue.includes(keyword)) {
      return selectedValue;
    }
  }

  const visibleOptions = await readVisibleFreightTemplateOptionTexts(page).catch(() => []);
  throw new Error(
    `No visible freight template option matched keyword: ${keyword}; visibleOptions=${
      visibleOptions.length ? visibleOptions.join(" | ") : "<none>"
    }`
  );
}

function getSpecTemplateKeyword(title?: string): string {
  return /涔呭厜灏忔辰/.test(title || "") ? "涔呭厜灏忔辰" : "涔颁簩閫佷竴";
}

async function chooseSpecTemplateOnPage(page: Page, title?: string): Promise<string> {
  const keyword = getSpecTemplateKeyword(title);
  const opened = await page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll("input[type='search']"))
      .map((el) => el as HTMLInputElement)
      .map((input) => {
        const rect = input.getBoundingClientRect();
        const parentText = (input.parentElement?.parentElement?.textContent || "").trim();
        if (rect.width <= 0 || rect.height <= 0) {
          return null;
        }
        return {
          x: rect.x + rect.width / 2,
          y: rect.y + rect.height / 2,
          parentText
        };
      })
      .filter(Boolean)
      .find((item) => item!.y > 2480 && item!.y < 2560 && item!.x > 900 && item!.parentText.includes("一键复用规格信息"));

    if (!inputs) {
      return false;
    }
    const target = document.elementFromPoint(inputs.x, inputs.y) as HTMLElement | null;
    target?.click();
    return true;
  });

  if (!opened) {
    throw new Error("Spec template dropdown could not be opened.");
  }
  await page.waitForTimeout(1000);

  const picked = await page.evaluate((targetKeyword) => {
    const candidates = Array.from(document.querySelectorAll("body *"))
      .map((el) => {
        const text = (el.textContent || "").trim();
        if (!text || !text.includes(targetKeyword)) {
          return null;
        }
        const htmlEl = el as HTMLElement;
        const rect = htmlEl.getBoundingClientRect();
        const style = window.getComputedStyle(htmlEl);
        if (rect.width <= 0 || rect.height <= 0 || style.visibility === "hidden" || style.display === "none") {
          return null;
        }
        return {
          text,
          x: rect.x + rect.width / 2,
          y: rect.y + rect.height / 2,
          score: text === targetKeyword ? 10 : text.includes(targetKeyword) ? 8 : 0
        };
      })
      .filter(Boolean)
      .sort((a, b) => (b?.score || 0) - (a?.score || 0));
    return candidates[0] || null;
  }, keyword);

  if (!picked) {
    throw new Error(`No visible spec template matched keyword: ${keyword}`);
  }

  await page.mouse.click(picked.x, picked.y, { delay: 90 });
  await page.waitForTimeout(1200);
  return picked.text;
}

function resolveSpecTemplateKeyword(title?: string): string {
  return (title || "").includes(SPEC_TEMPLATE_KEYWORD_JIUGUANG)
    ? SPEC_TEMPLATE_KEYWORD_JIUGUANG
    : SPEC_TEMPLATE_KEYWORD_DEFAULT;
}

async function chooseDynamicSpecTemplateOnPage(page: Page, title?: string): Promise<string> {
  const keyword = resolveSpecTemplateKeyword(title);
  await dismissTransientOverlays(page);
  await scrollLabelIntoView(page, "规格模板").catch(() => false);
  let selectedValue = await chooseKeywordFromSearchDropdown(
    page,
    ["\u4e00\u952e\u590d\u7528\u89c4\u683c\u4fe1\u606f", "\u89c4\u683c\u6a21\u677f"],
    keyword
  );
  if (!selectedValue.includes(keyword)) {
    selectedValue = await readDropdownValueByLabel(page, "\u89c4\u683c\u6a21\u677f").catch(() => "");
  }
  if (!selectedValue.includes(keyword)) {
    throw new Error(`No visible spec template matched keyword: ${keyword}`);
  }
  return selectedValue;
}

async function fillMissingSpecValuesOnPage(page: Page): Promise<number> {
  const existingTexts = await page.evaluate(() => (document.body.innerText || "").replace(/\s+/g, ""));
  const missingValues = FIXED_SPEC_VALUES.filter((value) => !existingTexts.includes(value.replace(/\s+/g, "")));
  if (!missingValues.length) {
    return 0;
  }

  const inputs = await page.evaluate(() => {
    return Array.from(document.querySelectorAll("input"))
      .map((el) => el as HTMLInputElement)
      .map((input) => {
        const rect = input.getBoundingClientRect();
        if (
          rect.width <= 120 ||
          rect.height <= 0 ||
          input.disabled ||
          input.readOnly ||
          input.type !== "text" ||
          (input.placeholder || "") !== "请输入规格值"
        ) {
          return null;
        }
        return {
          x: rect.x + rect.width / 2,
          y: rect.y + rect.height / 2
        };
      })
      .filter(Boolean) as Array<{ x: number; y: number }>;
  });

  const fillCount = Math.min(inputs.length, missingValues.length);
  for (let index = 0; index < fillCount; index += 1) {
    await clearAndTypeAtCenter(page, inputs[index], missingValues[index]);
    await page.keyboard.press("Enter").catch(() => {});
    await page.waitForTimeout(300);
  }
  return fillCount;
}

async function readCurrentSpecValuesStrict(page: Page): Promise<string[]> {
  return page.evaluate((expectedValues) => {
    const normalize = (value: string): string => value.replace(/\s+/g, "").trim();
    const pageText = normalize(document.body.innerText || "");
    const inputValues = Array.from(document.querySelectorAll("input"))
      .map((el) => el as HTMLInputElement)
      .map((input) => {
        const rect = input.getBoundingClientRect();
        const style = window.getComputedStyle(input);
        if (rect.width <= 120 || rect.height <= 0 || style.display === "none" || style.visibility === "hidden") {
          return "";
        }
        const marker = [input.placeholder || "", input.parentElement?.textContent || "", input.parentElement?.parentElement?.textContent || ""]
          .join(" ")
          .replace(/\s+/g, " ");
        if (!marker.includes("\u89c4\u683c\u503c")) {
          return "";
        }
        return (input.value || "").trim();
      })
      .filter(Boolean);

    const normalizedInputs = inputValues.map((value) => normalize(value));
    return expectedValues.filter((value) => {
      const normalizedValue = normalize(value);
      return normalizedInputs.includes(normalizedValue) || pageText.includes(normalizedValue);
    });
  }, FIXED_SPEC_VALUES);
}

async function fillMissingSpecValuesStrict(page: Page): Promise<number> {
  const existingValues = await readCurrentSpecValuesStrict(page);
  const normalizedExisting = new Set(existingValues.map((value) => value.replace(/\s+/g, "")));
  const missingValues = FIXED_SPEC_VALUES.filter((value) => !normalizedExisting.has(value.replace(/\s+/g, "")));
  if (!missingValues.length) {
    return 0;
  }

  const inputs = await page.evaluate(() => {
    const labels = Array.from(document.querySelectorAll("body *"))
      .map((el) => el as HTMLElement)
      .map((el) => {
        const text = (el.textContent || "").trim();
        const rect = el.getBoundingClientRect();
        if (!text || rect.width <= 0 || rect.height <= 0) {
          return null;
        }
        return { text, top: rect.top, bottom: rect.bottom };
      })
      .filter(Boolean) as Array<{ text: string; top: number; bottom: number }>;

    const specLabel = labels.find((item) => item.text === "\u5546\u54c1\u89c4\u683c");
    const priceLabel = labels.find((item) => item.text === "\u4ef7\u683c\u4e0e\u5e93\u5b58" && (!specLabel || item.top > specLabel.top));
    const topBound = specLabel ? specLabel.bottom - 20 : 200;
    const bottomBound = priceLabel ? priceLabel.top - 10 : window.innerHeight + 1200;

    return Array.from(document.querySelectorAll("input"))
      .map((el) => el as HTMLInputElement)
      .filter((input) => {
        const rect = input.getBoundingClientRect();
        if (
          rect.width <= 120 ||
          rect.height <= 0 ||
          rect.top < topBound ||
          rect.top > bottomBound ||
          input.disabled ||
          input.readOnly ||
          !["text", "search"].includes(input.type || "text")
        ) {
          return false;
        }
        const context = [
          input.value || "",
          input.placeholder || "",
          input.parentElement?.textContent || "",
          input.parentElement?.parentElement?.textContent || "",
          input.closest("div")?.textContent || ""
        ]
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
        return !(context.includes("\u4e00\u952e\u590d\u7528\u89c4\u683c\u4fe1\u606f") || context.includes("\u89c4\u683c\u6a21\u677f"));
      })
      .map((input) => {
        const rect = input.getBoundingClientRect();
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      })
      .sort((a, b) => a.y - b.y || a.x - b.x) as Array<{ x: number; y: number }>;
  });

  const fillCount = Math.min(inputs.length, missingValues.length);
  for (let index = 0; index < fillCount; index += 1) {
    await clearAndTypeAtCenter(page, inputs[index], missingValues[index]);
    await page.keyboard.press("Enter").catch(() => {});
    await page.waitForTimeout(300);
  }
  return fillCount;
}

async function applySpecTemplateWithVerificationOnPage(
  page: Page,
  title?: string
): Promise<{ selectedTemplate: string; filledValues: string[]; issue: string }> {
  const keyword = resolveSpecTemplateKeyword(title);
  let selectedTemplate = "";

  for (let attempt = 0; attempt < 2; attempt += 1) {
    selectedTemplate = await chooseDynamicSpecTemplateOnPage(page, title).catch(() => selectedTemplate);
    await page.waitForTimeout(600);

    const filledValues = await readCurrentSpecValuesStrict(page).catch(() => []);
    const visiblePriceRows = await countVisiblePriceInventoryRows(page).catch(() => 0);
    if (filledValues.length >= FIXED_SPEC_VALUES.length || visiblePriceRows >= FIXED_SPEC_VALUES.length) {
      return {
        selectedTemplate: selectedTemplate || keyword,
        filledValues,
        issue: ""
      };
    }
  }

  const finalValues = await readCurrentSpecValuesStrict(page).catch(() => []);
  const finalVisiblePriceRows = await countVisiblePriceInventoryRows(page).catch(() => 0);
  return {
    selectedTemplate,
    filledValues: finalValues,
    issue:
      finalValues.length >= FIXED_SPEC_VALUES.length || finalVisiblePriceRows >= FIXED_SPEC_VALUES.length
        ? ""
        : `Spec values were incomplete after template apply. expected=${FIXED_SPEC_VALUES.length}; actual=${finalValues.length}; priceRows=${finalVisiblePriceRows}; keyword=${keyword}`
  };
}

async function readSpecModuleErrorOnPage(page: Page): Promise<string> {
  return page.evaluate(() => {
    const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
    const bodyText = normalize(document.body.innerText || "");
    const knownErrors = ["规格值不能重复", "该项为必填，请输入", "请选择规格类型", "暂无选项"];
    const matched = knownErrors.find((item) => bodyText.includes(item));
    return matched || "";
  });
}

function isConcreteFreightTemplateName(value: string): boolean {
  const text = value.trim();
  if (!text) {
    return false;
  }
  if (text.includes(FIXED_FREIGHT_TEMPLATE_KEYWORD)) {
    return true;
  }
  if (text.includes("\u5305\u90AE")) {
    return false;
  }
  if (text === "\u8FD0\u8D39\u6A21\u677F") {
    return false;
  }
  return true;
}

async function applyFixedPublishSettings(
  runtimeDir: string,
  publishPageUrl: string,
  expectedSpu?: string
): Promise<{
  pageUrl: string;
  pageTitle: string;
  screenshotFile: string;
  configuredFields: string[];
  freightTemplateName: string;
}> {
  const context = await launchPersistentBrowser();
  try {
    const page = context.pages().find((item) => !item.isClosed()) || (await context.newPage());
    attachSafeDialogHandler(page);
    await page.bringToFront();
    await gotoWithTolerance(page, publishPageUrl, 3500);
    await verifyCategoryRegistrationGateOnPage(
      page,
      runtimeDir,
      expectedSpu,
      "publish-page-category-registration-mismatch-before-service.png"
    );
    await ensureServiceSectionReady(page);

    try {
      const configuredFields: string[] = [];

      if (await clickVisibleText(page, "\u73B0\u8D27\u53D1\u8D27\u6A21\u5F0F")) {
        configuredFields.push("shippingMode");
        await page.waitForTimeout(500);
      }
      if (await clickVisibleText(page, "48\u5C0F\u65F6")) {
        configuredFields.push("shippingTime");
        await page.waitForTimeout(500);
      }

      const freightTemplateName = await chooseKeywordFreightTemplate(page, FIXED_FREIGHT_TEMPLATE_KEYWORD);
      if (isConcreteFreightTemplateName(freightTemplateName)) {
        configuredFields.push("freightTemplate");
      }

      if (await clickRadioByLabel(page, "\u4E0A\u67B6")) {
        configuredFields.push("productStatus");
        await page.waitForTimeout(500);
      }

      const screenshotFile = await savePageScreenshot(page, runtimeDir, "publish-page-fixed-settings.png");
      return {
        pageUrl: page.url(),
        pageTitle: await page.title(),
        screenshotFile,
        configuredFields,
        freightTemplateName: isConcreteFreightTemplateName(freightTemplateName) ? freightTemplateName : ""
      };
    } catch (error) {
      const screenshotFile = await savePageScreenshot(page, runtimeDir, "publish-page-fixed-settings-failed.png").catch(() => "");
      const baseMessage = error instanceof Error ? error.message : String(error);
      throw new Error(
        screenshotFile ? `${baseMessage}; screenshot=${screenshotFile}` : baseMessage
      );
    }
  } finally {
    await context.browser()?.close().catch(() => {});
  }
}

async function applyFixedPublishSettingsOnPage(
  page: Page,
  runtimeDir: string,
  fileName: string,
  expectedSpu?: string
): Promise<{
  pageUrl: string;
  pageTitle: string;
  screenshotFile: string;
  configuredFields: string[];
  freightTemplateName: string;
}> {
  await page.bringToFront();
  await page.waitForTimeout(1200);
  if (!page.url().includes("/ffa/g/create")) {
    const screenshotFile = await savePageScreenshot(page, runtimeDir, fileName).catch(() => "");
    throw new Error(
      `Publish page context was lost before service settings. currentUrl=${page.url()}${
        screenshotFile ? `; screenshot=${screenshotFile}` : ""
      }`
    );
  }
  await verifyCategoryRegistrationGateOnPage(
    page,
    runtimeDir,
    expectedSpu,
    "publish-page-category-registration-mismatch-before-service.png"
  );
  await ensureServiceSectionReady(page);

  const configuredFields: string[] = [];

  if (await clickVisibleText(page, "\u73B0\u8D27\u53D1\u8D27\u6A21\u5F0F")) {
    configuredFields.push("shippingMode");
    await page.waitForTimeout(500);
  }
  if (await clickVisibleText(page, "48\u5C0F\u65F6")) {
    configuredFields.push("shippingTime");
    await page.waitForTimeout(500);
  }

  const freightTemplateName = await chooseKeywordFreightTemplate(page, FIXED_FREIGHT_TEMPLATE_KEYWORD);
  if (isConcreteFreightTemplateName(freightTemplateName)) {
    configuredFields.push("freightTemplate");
  }

  if (await clickRadioByLabel(page, "\u4E0A\u67B6")) {
    configuredFields.push("productStatus");
    await page.waitForTimeout(500);
  }

  const screenshotFile = await savePageScreenshot(page, runtimeDir, fileName);
  return {
    pageUrl: page.url(),
    pageTitle: await page.title(),
    screenshotFile,
    configuredFields,
    freightTemplateName: isConcreteFreightTemplateName(freightTemplateName) ? freightTemplateName : ""
  };
}

async function ensureSpecEditorVisible(page: Page): Promise<boolean> {
  const existingEditor = page.locator(".style_skuNameBox__mC883").first();
  if (await existingEditor.count()) {
    return true;
  }

  const addButton = page.getByText(/\u6DFB\u52A0\u89C4\u683C\u7C7B\u578B/).first();
  if (!(await addButton.count())) {
    return false;
  }

  await addButton.click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(1000);
  return (await existingEditor.count()) > 0;
}

async function readSpecTypeOptions(page: Page): Promise<{ options: string[]; empty: boolean }> {
  const select = page.locator(".style_skuNameBox__mC883 .ecom-g-select").first();
  if (!(await select.count())) {
    return { options: [], empty: false };
  }

  await select.click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(1200);

  return page.evaluate(() => {
    const listbox = document.querySelector("[id^='rc_select_'][id$='_list']");
    if (!listbox) {
      return { options: [], empty: false };
    }

    const text = (listbox.textContent || "").trim();
    const optionTexts = Array.from(listbox.querySelectorAll(".ecom-g-select-item-option, [role='option']"))
      .map((el) => (el.textContent || "").trim())
      .filter(Boolean);

    return {
      options: Array.from(new Set(optionTexts)),
      empty: text.includes("\u6682\u65E0\u6570\u636E")
    };
  });
}

async function openSpecTypeDropdown(page: Page): Promise<boolean> {
  const opened = await page.evaluate(() => {
    const labels = Array.from(document.querySelectorAll("body *"));
    const title = labels.find((el) => ((el.textContent || "").trim() === "鍟嗗搧瑙勬牸")) as HTMLElement | undefined;
    if (!title) {
      return false;
    }
    const rect = title.getBoundingClientRect();
    const clickX = rect.x + 170;
    const clickY = rect.y + 12;
    const target = document.elementFromPoint(clickX, clickY) as HTMLElement | null;
    target?.click();
    return true;
  });
  if (opened) {
    await page.waitForTimeout(800);
  }
  return opened;
}

async function clickCreateSpecType(page: Page): Promise<boolean> {
  if (await clickVisibleText(page, "鍒涘缓绫诲瀷")) {
    await page.waitForTimeout(800);
    return true;
  }
  return false;
}

async function fillSpecEditorText(page: Page, value: string): Promise<boolean> {
  const filled = await page.evaluate((nextValue) => {
    const inputs = Array.from(document.querySelectorAll("input"))
      .map((el) => el as HTMLInputElement)
      .filter((input) => {
        const rect = input.getBoundingClientRect();
        return (
          rect.width > 100 &&
          rect.height > 20 &&
          rect.y > 2480 &&
          rect.y < 2760 &&
          !input.disabled &&
          !input.readOnly &&
          (input.type === "text" || input.type === "search")
        );
      })
      .sort((a, b) => {
        const ra = a.getBoundingClientRect();
        const rb = b.getBoundingClientRect();
        return ra.y - rb.y || ra.x - rb.x;
      });

    const target = inputs[0];
    if (!target) {
      return false;
    }

    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    target.focus();
    setter?.call(target, "");
    target.dispatchEvent(new InputEvent("input", { bubbles: true, data: "", inputType: "deleteContentBackward" }));
    setter?.call(target, nextValue);
    target.dispatchEvent(new InputEvent("input", { bubbles: true, data: nextValue, inputType: "insertText" }));
    target.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }, value);

  if (filled) {
    await page.waitForTimeout(500);
  }
  return filled;
}

async function saveSpecEditorValue(page: Page): Promise<void> {
  await page.keyboard.press("Enter").catch(() => {});
  await page.waitForTimeout(600);
}

async function createFixedSpecTypeAndValues(page: Page): Promise<{ ok: boolean; issue: string }> {
  if (!(await openSpecTypeDropdown(page))) {
    return { ok: false, issue: "Spec type dropdown could not be opened." };
  }
  if (!(await clickCreateSpecType(page))) {
    return { ok: false, issue: "Create spec type action was not found in the dropdown." };
  }
  if (!(await fillSpecEditorText(page, FIXED_SPEC_NAME))) {
    return { ok: false, issue: "Spec name input was not found after clicking create type." };
  }
  await saveSpecEditorValue(page);

  for (const specValue of FIXED_SPEC_VALUES) {
    if (!(await fillSpecEditorText(page, specValue))) {
      return { ok: false, issue: `Spec value input was not found for value: ${specValue}` };
    }
    await saveSpecEditorValue(page);
  }

  return { ok: true, issue: "" };
}

async function applyFixedSpecs(
  runtimeDir: string,
  publishPageUrl: string,
  title?: string
): Promise<{
  pageUrl: string;
  pageTitle: string;
  screenshotFile: string;
  configuredFields: string[];
  specTypeOptions: string[];
  specIssue: string;
}> {
  const context = await launchPersistentBrowser();
  try {
    const page = context.pages().find((item) => !item.isClosed()) || (await context.newPage());
    attachSafeDialogHandler(page);
    await page.bringToFront();
    await gotoWithTolerance(page, publishPageUrl, 3500);
    await page.mouse.wheel(0, 2300).catch(() => {});
    await page.waitForTimeout(1000);

    const configuredFields: string[] = [];
    let specIssue = "";
    let specTypeOptions: string[] = [];

    const specApplyResult = await applySpecTemplateWithVerificationOnPage(page, title);
    if (!specApplyResult.selectedTemplate && specApplyResult.issue) {
      specIssue = specApplyResult.issue;
    } else if (specApplyResult.issue) {
      specIssue = specApplyResult.issue;
      specTypeOptions = specApplyResult.selectedTemplate ? [specApplyResult.selectedTemplate] : [];
      configuredFields.push("specTemplate");
    } else {
      specTypeOptions = specApplyResult.selectedTemplate ? [specApplyResult.selectedTemplate] : [];
      configuredFields.push("specTemplate");
    }

    const screenshotFile = await savePageScreenshot(page, runtimeDir, "publish-page-spec-editor.png");
    return {
      pageUrl: page.url(),
      pageTitle: await page.title(),
      screenshotFile,
      configuredFields,
      specTypeOptions,
      specIssue
    };
  } finally {
    await context.browser()?.close().catch(() => {});
  }
}

async function applyFixedSpecsOnPage(
  page: Page,
  runtimeDir: string,
  fileName: string,
  title?: string
): Promise<{
  pageUrl: string;
  pageTitle: string;
  screenshotFile: string;
  configuredFields: string[];
  specTypeOptions: string[];
  specIssue: string;
}> {
  await page.bringToFront();
  await page.waitForTimeout(1200);
  await ensurePublishSectionTab(page, "\u4ef7\u683c\u5e93\u5b58");
  await page.mouse.wheel(0, 2300).catch(() => {});
  await page.waitForTimeout(1000);

  const configuredFields: string[] = [];
  let specIssue = "";
  let specTypeOptions: string[] = [];

  const specApplyResult = await applySpecTemplateWithVerificationOnPage(page, title);
  if (!specApplyResult.selectedTemplate && specApplyResult.issue) {
    specIssue = specApplyResult.issue;
  } else if (specApplyResult.issue) {
    specIssue = specApplyResult.issue;
    specTypeOptions = specApplyResult.selectedTemplate ? [specApplyResult.selectedTemplate] : [];
    configuredFields.push("specTemplate");
  } else {
    specTypeOptions = specApplyResult.selectedTemplate ? [specApplyResult.selectedTemplate] : [];
    configuredFields.push("specTemplate");
  }

  const screenshotFile = await savePageScreenshot(page, runtimeDir, fileName);
  return {
    pageUrl: page.url(),
    pageTitle: await page.title(),
    screenshotFile,
    configuredFields,
    specTypeOptions,
    specIssue
  };
}

async function collectFileInputs(page: Page): Promise<
  Array<{
    index: number;
    accept: string;
    multiple: boolean;
    parentText: string;
  }>
> {
  return page.locator("input[type='file']").evaluateAll((elements) =>
    elements.map((el, index) => ({
      index,
      accept: el.getAttribute("accept") || "",
      multiple: el.hasAttribute("multiple"),
      parentText: ((el.parentElement?.textContent || el.closest("div")?.textContent || "") as string)
        .trim()
        .replace(/\s+/g, " ")
        .slice(0, 200)
    }))
  );
}

async function countGraphicSectionPreviews(page: Page, sectionName: string): Promise<number> {
  return page.evaluate((targetSection) => {
    const labels = Array.from(document.querySelectorAll("body *"))
      .map((el) => el as HTMLElement)
      .map((el) => {
        const text = (el.textContent || "").trim();
        const rect = el.getBoundingClientRect();
        if (!text || rect.width <= 0 || rect.height <= 0) {
          return null;
        }
        return { text, top: rect.top, bottom: rect.bottom, left: rect.left };
      })
      .filter(Boolean) as Array<{ text: string; top: number; bottom: number; left: number }>;

    const current = labels.find((item) => item.text === targetSection);
    if (!current) {
      return 0;
    }

    const nextTop =
      labels
        .filter((item) => ["主图", "主图3:4", "白底图", "详情页"].includes(item.text) && item.top > current.top)
        .sort((a, b) => a.top - b.top)[0]?.top || current.bottom + 500;

    const imageLike = Array.from(document.querySelectorAll("img, [style*='background-image']"))
      .map((el) => el as HTMLElement)
      .map((el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        if (rect.width < 40 || rect.height < 40 || style.display === "none" || style.visibility === "hidden") {
          return null;
        }
        return {
          key: `${Math.round(rect.left)}-${Math.round(rect.top)}-${Math.round(rect.width)}-${Math.round(rect.height)}`,
          top: rect.top,
          left: rect.left
        };
      })
      .filter(Boolean)
      .filter((item) => item!.top >= current.bottom - 20 && item!.top < nextTop - 10 && item!.left > current.left);

    return Array.from(new Set(imageLike.map((item) => item!.key))).length;
  }, sectionName);
}

async function countGraphicSectionPreviewsSafe(page: Page, sectionName: string): Promise<number> {
  return page.evaluate((targetSection) => {
    const labels = Array.from(document.querySelectorAll("body *"))
      .map((el) => el as HTMLElement)
      .map((el) => {
        const text = (el.textContent || "").trim();
        const rect = el.getBoundingClientRect();
        if (!text || rect.width <= 0 || rect.height <= 0) {
          return null;
        }
        return { text, top: rect.top, bottom: rect.bottom, left: rect.left };
      })
      .filter(Boolean) as Array<{ text: string; top: number; bottom: number; left: number }>;

    const current = labels.find((item) => item.text === targetSection);
    if (!current) {
      return 0;
    }

    const nextTop =
      labels
        .filter((item) => ["主图", "主图3:4", "白底图", "详情页"].includes(item.text) && item.top > current.top)
        .sort((a, b) => a.top - b.top)[0]?.top || current.bottom + 500;

    const imageLike = Array.from(document.querySelectorAll("img, [style*='background-image']"))
      .map((el) => el as HTMLElement)
      .map((el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        if (rect.width < 40 || rect.height < 40 || style.display === "none" || style.visibility === "hidden") {
          return null;
        }
        return {
          key: `${Math.round(rect.left)}-${Math.round(rect.top)}-${Math.round(rect.width)}-${Math.round(rect.height)}`,
          top: rect.top,
          left: rect.left
        };
      })
      .filter(Boolean)
      .filter((item) => item!.top >= current.bottom - 20 && item!.top < nextTop - 10 && item!.left > current.left);

    return Array.from(new Set(imageLike.map((item) => item!.key))).length;
  }, sectionName);
}

async function getGraphicSectionPreviewRects(
  page: Page,
  sectionName: string
): Promise<Array<{ x: number; y: number; width: number; height: number }>> {
  return page.evaluate((targetSection) => {
    const labels = Array.from(document.querySelectorAll("body *"))
      .map((el) => el as HTMLElement)
      .map((el) => {
        const text = (el.textContent || "").trim();
        const rect = el.getBoundingClientRect();
        if (!text || rect.width <= 0 || rect.height <= 0) {
          return null;
        }
        return { text, top: rect.top, bottom: rect.bottom, left: rect.left };
      })
      .filter(Boolean) as Array<{ text: string; top: number; bottom: number; left: number }>;

    const current = labels.find((item) => item.text === targetSection);
    if (!current) {
      return [];
    }

    const nextTop =
      labels
        .filter((item) => ["主图", "主图3:4", "白底图", "详情页"].includes(item.text) && item.top > current.top)
        .sort((a, b) => a.top - b.top)[0]?.top || current.bottom + 500;

    return Array.from(document.querySelectorAll("img, [style*='background-image']"))
      .map((el) => el as HTMLElement)
      .map((el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        if (rect.width < 40 || rect.height < 40 || style.display === "none" || style.visibility === "hidden") {
          return null;
        }
        if (rect.top < current.bottom - 20 || rect.top > nextTop - 10 || rect.left <= current.left) {
          return null;
        }
        return {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height
        };
      })
      .filter(Boolean) as Array<{ x: number; y: number; width: number; height: number }>;
  }, sectionName);
}

async function clickConfirmIfVisible(page: Page): Promise<void> {
  const confirmButton = page.getByRole("button", { name: "纭畾" }).first();
  if (await confirmButton.count()) {
    await confirmButton.click({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(600);
  }
}

async function purgeForbiddenGraphicSections(page: Page): Promise<string[]> {
  const removedSections: string[] = [];
  const forbiddenSections = ["主图3:4", "白底图"];

  for (const sectionName of forbiddenSections) {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const previews = await getGraphicSectionPreviewRects(page, sectionName);
      if (!previews.length) {
        break;
      }

      const target = previews[previews.length - 1];
      await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2);
      await page.waitForTimeout(250);
      await page.mouse.click(target.x + target.width - 10, target.y + 10, { delay: 60 }).catch(() => {});
      await page.waitForTimeout(500);
      await clickConfirmIfVisible(page);
      await dismissTransientOverlays(page);

      if (!removedSections.includes(sectionName)) {
        removedSections.push(sectionName);
      }
      await page.waitForTimeout(500);
    }
  }

  return removedSections;
}

async function getGraphicSectionPreviewRectsSafe(
  page: Page,
  sectionName: string
): Promise<Array<{ x: number; y: number; width: number; height: number }>> {
  return page.evaluate((targetSection) => {
    const labels = Array.from(document.querySelectorAll("body *"))
      .map((el) => el as HTMLElement)
      .map((el) => {
        const text = (el.textContent || "").trim();
        const rect = el.getBoundingClientRect();
        if (!text || rect.width <= 0 || rect.height <= 0) {
          return null;
        }
        return { text, top: rect.top, bottom: rect.bottom, left: rect.left };
      })
      .filter(Boolean) as Array<{ text: string; top: number; bottom: number; left: number }>;

    const current = labels.find((item) => item.text === targetSection);
    if (!current) {
      return [];
    }

    const nextTop =
      labels
        .filter((item) => ["主图", "主图3:4", "白底图", "详情页"].includes(item.text) && item.top > current.top)
        .sort((a, b) => a.top - b.top)[0]?.top || current.bottom + 500;

    return Array.from(document.querySelectorAll("img, [style*='background-image']"))
      .map((el) => el as HTMLElement)
      .map((el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        if (rect.width < 40 || rect.height < 40 || style.display === "none" || style.visibility === "hidden") {
          return null;
        }
        if (rect.top < current.bottom - 20 || rect.top > nextTop - 10 || rect.left <= current.left) {
          return null;
        }
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      })
      .filter(Boolean) as Array<{ x: number; y: number; width: number; height: number }>;
  }, sectionName);
}

async function clickConfirmIfVisibleSafe(page: Page): Promise<void> {
  const confirmButton = page.getByRole("button", { name: "纭畾" }).first();
  if (await confirmButton.count()) {
    await confirmButton.click({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(600);
  }
}

async function findDeleteControlNearPreviewSafe(
  page: Page,
  preview: { x: number; y: number; width: number; height: number }
): Promise<{ x: number; y: number } | null> {
  return page.evaluate((target) => {
    const candidates = Array.from(document.querySelectorAll("div, span, button, a, [role='button'], i, svg"))
      .map((el) => el as HTMLElement)
      .map((el) => {
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) {
          return null;
        }

        const marker = [
          el.textContent || "",
          el.getAttribute("aria-label") || "",
          el.getAttribute("title") || "",
          String(el.className || "")
        ].join(" ");
        const normalizedMarker = marker.replace(/\s+/g, "").toLowerCase();
        const centerX = rect.x + rect.width / 2;
        const centerY = rect.y + rect.height / 2;
        const horizontallyAligned = centerX >= target.x - 30 && centerX <= target.x + target.width + 30;
        const belowPreview = centerY >= target.y + target.height - 10 && centerY <= target.y + target.height + 110;
        const upperFallback = centerY >= target.y - 120 && centerY <= target.y + 50;

        if (!horizontallyAligned || (!belowPreview && !upperFallback)) {
          return null;
        }

        const hasDeleteText = normalizedMarker.includes("删除");
        const hasDeleteSemantics = /(delete|remove|trash|icon-delete|icon-trash|semi-icon-close|close)/.test(normalizedMarker);
        const looksLikeActionControl = /(actionafter|preview-button|material-button|icon|删除)/.test(normalizedMarker);
        if ((!hasDeleteText && !hasDeleteSemantics) || !looksLikeActionControl) {
          return null;
        }

        let score = 0;
        if (hasDeleteText) {
          score += 300;
        }
        if (normalizedMarker === "删除") {
          score += 200;
        }
        if (belowPreview) {
          score += 120;
        }
        score += Math.max(0, 80 - Math.abs(centerX - (target.x + target.width / 2)));
        score -= Math.abs(centerY - (target.y + target.height + 35));

        return { x: centerX, y: centerY, score };
      })
      .filter(Boolean)
      .sort((a, b) => (b?.score || 0) - (a?.score || 0));

    return candidates[0] || null;
  }, preview);
}

async function purgeForbiddenGraphicSectionsSafe(page: Page): Promise<string[]> {
  const removedSections: string[] = [];
  const forbiddenSections = ["主图3:4", "白底图"];

  for (const sectionName of forbiddenSections) {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const previews = await getGraphicSectionPreviewRectsSafe(page, sectionName);
      if (!previews.length) {
        break;
      }

      const target = previews[previews.length - 1];
      await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2);
      await page.waitForTimeout(250);
      const deleteControl = await findDeleteControlNearPreviewSafe(page, target);
      if (!deleteControl) {
        break;
      }
      await page.mouse.click(deleteControl.x, deleteControl.y, { delay: 60 }).catch(() => {});
      await page.waitForTimeout(500);
      await clickConfirmIfVisibleSafe(page);
      await dismissTransientOverlays(page);
      if (!removedSections.includes(sectionName)) {
        removedSections.push(sectionName);
      }
    }
  }

  return removedSections;
}

async function countGraphicSectionPreviewsStrict(page: Page, sectionName: string): Promise<number> {
  return page.evaluate(
    ({ targetSection, sectionLabels }) => {
      const labels = Array.from(document.querySelectorAll("body *"))
        .map((el) => el as HTMLElement)
        .map((el) => {
          const text = (el.textContent || "").trim();
          const rect = el.getBoundingClientRect();
          if (!text || rect.width <= 0 || rect.height <= 0) {
            return null;
          }
          return { text, top: rect.top, bottom: rect.bottom, left: rect.left };
        })
        .filter(Boolean) as Array<{ text: string; top: number; bottom: number; left: number }>;

      const current = labels.find((item) => item.text === targetSection);
      if (!current) {
        return 0;
      }

      const nextTop =
        labels.filter((item) => sectionLabels.includes(item.text) && item.top > current.top).sort((a, b) => a.top - b.top)[0]
          ?.top || current.bottom + 500;

      const imageLike = Array.from(document.querySelectorAll("img, [style*='background-image']"))
        .map((el) => el as HTMLElement)
        .map((el) => {
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          if (rect.width < 40 || rect.height < 40 || style.display === "none" || style.visibility === "hidden") {
            return null;
          }
          return {
            key: `${Math.round(rect.left)}-${Math.round(rect.top)}-${Math.round(rect.width)}-${Math.round(rect.height)}`,
            top: rect.top,
            left: rect.left
          };
        })
        .filter(Boolean)
        .filter((item) => item!.top >= current.bottom - 20 && item!.top < nextTop - 10 && item!.left > current.left);

      return Array.from(new Set(imageLike.map((item) => item!.key))).length;
    },
    { targetSection: sectionName, sectionLabels: GRAPHIC_SECTION_LABELS }
  );
}

async function getGraphicSectionPreviewRectsStrict(
  page: Page,
  sectionName: string
): Promise<Array<{ x: number; y: number; width: number; height: number }>> {
  return page.evaluate(
    ({ targetSection, sectionLabels }) => {
      const labels = Array.from(document.querySelectorAll("body *"))
        .map((el) => el as HTMLElement)
        .map((el) => {
          const text = (el.textContent || "").trim();
          const rect = el.getBoundingClientRect();
          if (!text || rect.width <= 0 || rect.height <= 0) {
            return null;
          }
          return { text, top: rect.top, bottom: rect.bottom, left: rect.left };
        })
        .filter(Boolean) as Array<{ text: string; top: number; bottom: number; left: number }>;

      const current = labels.find((item) => item.text === targetSection);
      if (!current) {
        return [];
      }

      const nextTop =
        labels.filter((item) => sectionLabels.includes(item.text) && item.top > current.top).sort((a, b) => a.top - b.top)[0]
          ?.top || current.bottom + 500;

      return Array.from(document.querySelectorAll("img, [style*='background-image']"))
        .map((el) => el as HTMLElement)
        .map((el) => {
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          if (rect.width < 40 || rect.height < 40 || style.display === "none" || style.visibility === "hidden") {
            return null;
          }
          if (rect.top < current.bottom - 20 || rect.top > nextTop - 10 || rect.left <= current.left) {
            return null;
          }
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        })
        .filter(Boolean) as Array<{ x: number; y: number; width: number; height: number }>;
    },
    { targetSection: sectionName, sectionLabels: GRAPHIC_SECTION_LABELS }
  );
}

async function clickConfirmIfVisibleStrict(page: Page): Promise<void> {
  const confirmButton = page.getByRole("button", { name: "\u786e\u5b9a" }).first();
  if (await confirmButton.count()) {
    await confirmButton.click({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(600);
  }
}

async function scrollGraphicSectionIntoView(page: Page, sectionName: string): Promise<boolean> {
  const scrolled = await page.evaluate((targetSection) => {
    const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
    const labels = Array.from(document.querySelectorAll("body *"))
      .map((el) => el as HTMLElement)
      .filter((el) => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
    const target = labels.find((el) => normalize(el.textContent || "") === targetSection);
    if (!target) {
      return false;
    }
    target.scrollIntoView({ block: "center", inline: "nearest" });
    return true;
  }, sectionName);
  if (scrolled) {
    await page.waitForTimeout(800);
  }
  return scrolled;
}

async function purgeForbiddenGraphicSectionsStrict(page: Page): Promise<string[]> {
  const removedSections: string[] = [];

  for (const sectionName of FORBIDDEN_GRAPHIC_SECTION_LABELS) {
    await scrollGraphicSectionIntoView(page, sectionName).catch(() => false);
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const beforeCount = await countGraphicSectionPreviewsStrict(page, sectionName);
      if (!beforeCount) {
        break;
      }

      const previews = await getGraphicSectionPreviewRectsStrict(page, sectionName);
      if (!previews.length) {
        break;
      }

      const target = previews[previews.length - 1];
      await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2);
      await page.waitForTimeout(250);
      const deleteControl = await findDeleteControlNearPreviewSafe(page, target);
      if (deleteControl) {
        await page.mouse.click(deleteControl.x, deleteControl.y, { delay: 60 }).catch(() => {});
      } else {
        await page.mouse.click(target.x + target.width - 10, target.y + 10, { delay: 60 }).catch(() => {});
      }

      await page.waitForTimeout(500);
      await clickConfirmIfVisibleStrict(page);
      await dismissTransientOverlays(page);

      const afterCount = await countGraphicSectionPreviewsStrict(page, sectionName);
      if (afterCount < beforeCount && !removedSections.includes(sectionName)) {
        removedSections.push(sectionName);
      }
      if (afterCount >= beforeCount) {
        break;
      }
    }
  }

  return removedSections;
}

async function listRemainingForbiddenGraphicSections(page: Page): Promise<string[]> {
  const remaining: string[] = [];
  for (const sectionName of FORBIDDEN_GRAPHIC_SECTION_LABELS) {
    const count = await countGraphicSectionPreviewsStrict(page, sectionName);
    if (count > 0) {
      remaining.push(sectionName);
    }
  }
  return remaining;
}

async function enforceForbiddenGraphicSectionsEmpty(
  page: Page,
  runtimeDir: string,
  screenshotFileName: string
): Promise<{ removedSections: string[]; remainingSections: string[]; screenshotFile: string }> {
  const removedSections = new Set<string>();

  await ensurePublishSectionTab(page, "\u56fe\u6587\u4fe1\u606f");
  await page.mouse.wheel(0, -4000).catch(() => {});
  await page.waitForTimeout(1000);
  await dismissTransientOverlays(page);

  for (let round = 0; round < 3; round += 1) {
    const removed = await purgeForbiddenGraphicSectionsStrict(page);
    removed.forEach((sectionName) => removedSections.add(sectionName));
    await dismissTransientOverlays(page);
    await page.waitForTimeout(1200);

    const remaining = await listRemainingForbiddenGraphicSections(page);
    if (!remaining.length) {
      const screenshotFile = await savePageScreenshot(page, runtimeDir, screenshotFileName);
      return {
        removedSections: Array.from(removedSections),
        remainingSections: [],
        screenshotFile
      };
    }
  }

  const screenshotFile = await savePageScreenshot(page, runtimeDir, screenshotFileName);
  return {
    removedSections: Array.from(removedSections),
    remainingSections: await listRemainingForbiddenGraphicSections(page),
    screenshotFile
  };
}

async function clickFillFromMainForDetailSection(page: Page): Promise<boolean> {
  await ensurePublishSectionTab(page, "\u56fe\u6587\u4fe1\u606f");
  await scrollGraphicSectionIntoView(page, "\u8be6\u60c5\u9875").catch(() => false);
  await page.mouse.wheel(0, 500).catch(() => {});
  await page.waitForTimeout(800);
  await dismissTransientOverlays(page);
  const readDetailIndicatorCount = async (): Promise<number> =>
    page.evaluate(() => {
      const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
      const texts = Array.from(document.querySelectorAll("body *"))
        .map((el) => normalize((el as HTMLElement).textContent || ""))
        .filter(Boolean);
      for (const text of texts) {
        const match = text.match(/\u5546\u8be6\u56fe\u7247\s*\((\d+)\/50\)/);
        if (match) {
          return Number(match[1]);
        }
      }
      return 0;
    });

  const beforeCount = await readDetailIndicatorCount().catch(() => 0);
  if (beforeCount >= 5) {
    return true;
  }
  const button = page.getByRole("button", { name: "\u4ece\u4e3b\u56fe\u586b\u5165" }).first();
  const textButton = page.getByText("\u4ece\u4e3b\u56fe\u586b\u5165", { exact: true }).first();
  let clicked = false;
  if (await button.count()) {
    await button.scrollIntoViewIfNeeded().catch(() => {});
    await button.click({ timeout: 3000 }).catch(() => {});
    clicked = true;
  } else if (await textButton.count()) {
    await textButton.scrollIntoViewIfNeeded().catch(() => {});
    await textButton.click({ timeout: 3000 }).catch(() => {});
    clicked = true;
  } else {
    clicked = await page.evaluate(() => {
      const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
      const nodes = Array.from(document.querySelectorAll("button, [role='button'], span, div"))
        .map((el) => el as HTMLElement)
        .map((el) => {
          const text = normalize(el.textContent || "");
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          if (
            text !== "\u4ece\u4e3b\u56fe\u586b\u5165" ||
            rect.width <= 0 ||
            rect.height <= 0 ||
            style.display === "none" ||
            style.visibility === "hidden"
          ) {
            return null;
          }
          return {
            x: rect.x + rect.width / 2,
            y: rect.y + rect.height / 2
          };
        })
        .filter(Boolean)
        .sort((a, b) => a!.y - b!.y);

      const target = nodes[0];
      if (!target) {
        return false;
      }
      const clickable = document.elementFromPoint(target.x, target.y) as HTMLElement | null;
      clickable?.click();
      return Boolean(clickable);
    });
  }

  if (clicked) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await page.waitForTimeout(1200);
      await dismissTransientOverlays(page);
      const afterCount = await readDetailIndicatorCount().catch(() => 0);
      if ((beforeCount === 0 && afterCount > 0) || (beforeCount > 0 && afterCount >= beforeCount)) {
        return true;
      }
    }
  }
  return false;
}

async function clickSmartCropForMain34Section(page: Page): Promise<boolean> {
  await ensurePublishSectionTab(page, "\u56fe\u6587\u4fe1\u606f");
  await scrollGraphicSectionIntoView(page, "\u4e3b\u56fe3:4").catch(() => false);
  await page.waitForTimeout(800);
  await dismissTransientOverlays(page);

  const clicked = await page.evaluate(() => {
    const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
    const nodes = Array.from(document.querySelectorAll("button, a, span, div"))
      .map((el) => el as HTMLElement)
      .map((el) => {
        const text = normalize(el.textContent || "");
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        if (
          text !== "\u4ece1:1\u4e3b\u56fe\u667a\u80fd\u88c1\u526a" ||
          rect.width <= 0 ||
          rect.height <= 0 ||
          style.display === "none" ||
          style.visibility === "hidden"
        ) {
          return null;
        }
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      })
      .filter(Boolean)
      .sort((a, b) => a!.y - b!.y);

    const target = nodes[0];
    if (!target) {
      return false;
    }
    const clickable = document.elementFromPoint(target.x, target.y) as HTMLElement | null;
    clickable?.click();
    return Boolean(clickable);
  });

  if (clicked) {
    await page.waitForTimeout(2500);
    await dismissTransientOverlays(page);
  }
  return clicked;
}

async function uploadProductImages(
  runtimeDir: string,
  publishPageUrl: string,
  assets: ProductAssets
): Promise<{
  pageUrl: string;
  pageTitle: string;
  screenshotFile: string;
  uploadedGroups: string[];
  uploadIssue: string;
}> {
  const context = await launchPersistentBrowser();
  try {
    const page = context.pages().find((item) => !item.isClosed()) || (await context.newPage());
    attachSafeDialogHandler(page);
    await page.bringToFront();
    await gotoWithTolerance(page, publishPageUrl, 3500);
    await page.mouse.wheel(0, 500).catch(() => {});
    await page.waitForTimeout(800);
    await dismissTransientOverlays(page);

    const uploadedGroups: string[] = [];
    let uploadIssue = "";
    if (!uploadIssue) {
      uploadIssue = validateMainImageAspectRatio(assets.mainImages);
    }
    const inputs = await collectFileInputs(page);

    const mainInput = inputs.find((item) => item.parentText.includes("\u4E0A\u4F20\u4E3B\u56FE"));
    if (!uploadIssue && mainInput && assets.mainImages.length) {
      await page.locator("input[type='file']").nth(mainInput.index).setInputFiles(assets.mainImages);
      uploadedGroups.push("mainImages");
      await page.waitForTimeout(2600);
      const cropped = await clickSmartCropForMain34Section(page).catch(() => false);
      if (!cropped) {
        uploadIssue = 'Main 3:4 smart crop action "从1:1主图智能裁剪" was not clickable after main image upload.';
      }
    } else if (!uploadIssue && !mainInput) {
      const existingMainPreviewCount = await countGraphicSectionPreviewsStrict(page, "\u4e3b\u56fe");
      if (existingMainPreviewCount >= Math.min(assets.mainImages.length, 5)) {
        uploadedGroups.push("mainImages");
        const cropped = await clickSmartCropForMain34Section(page).catch(() => false);
        if (!cropped) {
          uploadIssue = 'Main 3:4 smart crop action "从1:1主图智能裁剪" was not clickable after main image upload.';
        }
      } else {
        uploadIssue = "Main image upload input was not found.";
      }
    } else if (!uploadIssue && !assets.mainImages.length) {
      uploadIssue = "Main image upload input was not found.";
    }

    await page.mouse.wheel(0, 900).catch(() => {});
    await page.waitForTimeout(800);

    const filledFromMain = await clickFillFromMainForDetailSection(page).catch(() => false);
    if (!uploadIssue && !filledFromMain) {
      await savePageScreenshot(page, runtimeDir, "publish-page-detail-fill-from-main-failed.png").catch(() => "");
    }
    const detailInputs = await collectFileInputs(page);
    const detailInput =
      detailInputs.find(
        (item) =>
          item.parentText === "\u4E0A\u4F20\u56FE\u7247" ||
          item.parentText.includes("\u4E0A\u4F20\u56FE\u7247") ||
          item.parentText.includes("1/20") ||
          item.parentText.includes("0/20")
      ) || null;

    if (!uploadIssue && detailInput && assets.detailImages.length) {
      await page.locator("input[type='file']").nth(detailInput.index).setInputFiles(assets.detailImages);
      uploadedGroups.push(filledFromMain ? "detailImages:fillFromMainThenUpload" : "detailImages");
      await page.waitForTimeout(2500);
    } else if (!uploadIssue && !detailInput) {
      const existingDetailPreviewCount = await countGraphicSectionPreviewsStrict(page, "\u5546\u54C1\u8BE6\u60C5");
      if (existingDetailPreviewCount >= Math.min(assets.detailImages.length, 1)) {
        uploadedGroups.push(filledFromMain ? "detailImages:fillFromMainThenUpload" : "detailImages");
      } else {
        uploadIssue = "Detail image upload input was not found.";
      }
    }

    const screenshotFile = await savePageScreenshot(page, runtimeDir, "publish-page-images-uploaded.png");
    return {
      pageUrl: page.url(),
      pageTitle: await page.title(),
      screenshotFile,
      uploadedGroups,
      uploadIssue
    };
  } finally {
    await context.browser()?.close().catch(() => {});
  }
}

async function uploadProductImagesOnPage(
  page: Page,
  runtimeDir: string,
  assets: ProductAssets,
  fileName: string
): Promise<{
  pageUrl: string;
  pageTitle: string;
  screenshotFile: string;
  uploadedGroups: string[];
  uploadIssue: string;
}> {
  await page.bringToFront();
  await page.waitForTimeout(1200);
  await ensurePublishSectionTab(page, "\u56fe\u6587\u4fe1\u606f");
  await page.mouse.wheel(0, 500).catch(() => {});
  await page.waitForTimeout(800);
  await dismissTransientOverlays(page);

  const uploadedGroups: string[] = [];
  let uploadIssue = "";
  if (!uploadIssue) {
    uploadIssue = validateMainImageAspectRatio(assets.mainImages);
  }
  const inputs = await collectFileInputs(page);

  const mainInput = inputs.find((item) => item.parentText.includes("\u4E0A\u4F20\u4E3B\u56FE"));
  if (!uploadIssue && mainInput && assets.mainImages.length) {
    await page.locator("input[type='file']").nth(mainInput.index).setInputFiles(assets.mainImages);
    uploadedGroups.push("mainImages");
    await page.waitForTimeout(3000);
    const cropped = await clickSmartCropForMain34Section(page).catch(() => false);
    if (!cropped) {
      uploadIssue = 'Main 3:4 smart crop action "从1:1主图智能裁剪" was not clickable after main image upload.';
    }
  } else if (!uploadIssue && !mainInput) {
    const existingMainPreviewCount = await countGraphicSectionPreviewsStrict(page, "\u4e3b\u56fe");
    if (existingMainPreviewCount >= Math.min(assets.mainImages.length, 5)) {
      uploadedGroups.push("mainImages");
      const cropped = await clickSmartCropForMain34Section(page).catch(() => false);
      if (!cropped) {
        uploadIssue = 'Main 3:4 smart crop action "从1:1主图智能裁剪" was not clickable after main image upload.';
      }
    } else {
      uploadIssue = "Main image upload input was not found.";
    }
  } else if (!uploadIssue && !assets.mainImages.length) {
    uploadIssue = "Main image upload input was not found.";
  }

  await page.mouse.wheel(0, 900).catch(() => {});
  await page.waitForTimeout(800);

  const filledFromMain = await clickFillFromMainForDetailSection(page).catch(() => false);
  if (!uploadIssue && !filledFromMain) {
    await savePageScreenshot(page, runtimeDir, "publish-page-detail-fill-from-main-failed.png").catch(() => "");
  }
  const detailInputs = await collectFileInputs(page);
  const detailInput =
    detailInputs.find(
      (item) =>
        item.parentText === "\u4E0A\u4F20\u56FE\u7247" ||
        item.parentText.includes("\u4E0A\u4F20\u56FE\u7247") ||
        item.parentText.includes("1/20") ||
        item.parentText.includes("0/20")
    ) || null;

  if (!uploadIssue && detailInput && assets.detailImages.length) {
    await page.locator("input[type='file']").nth(detailInput.index).setInputFiles(assets.detailImages);
    uploadedGroups.push(filledFromMain ? "detailImages:fillFromMainThenUpload" : "detailImages");
    await page.waitForTimeout(3500);
  } else if (!uploadIssue && !detailInput) {
    const existingDetailPreviewCount = await countGraphicSectionPreviewsStrict(page, "\u5546\u54C1\u8BE6\u60C5");
    if (existingDetailPreviewCount >= Math.min(assets.detailImages.length, 1)) {
      uploadedGroups.push(filledFromMain ? "detailImages:fillFromMainThenUpload" : "detailImages");
    } else {
      uploadIssue = "Detail image upload input was not found.";
    }
  }

  await dismissTransientOverlays(page);

  const screenshotFile = await savePageScreenshot(page, runtimeDir, fileName);
  return {
    pageUrl: page.url(),
    pageTitle: await page.title(),
    screenshotFile,
    uploadedGroups,
    uploadIssue
  };
}

async function runPublishCheck(
  runtimeDir: string,
  publishPageUrl: string
): Promise<{
  pageUrl: string;
  pageTitle: string;
  screenshotFile: string;
  checkPassed: boolean;
  checkMessage: string;
  checkHints: string[];
}> {
  const context = await launchPersistentBrowser();
  try {
    const page = context.pages().find((item) => !item.isClosed()) || (await context.newPage());
    attachSafeDialogHandler(page);
    await page.bringToFront();
    await page.goto(publishPageUrl, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3500);

    await clickVisibleText(page, "\u586B\u5199\u68C0\u67E5");
    await page.waitForTimeout(2000);

    const summary = await page.evaluate(() => {
      const bodyText = document.body.innerText || "";
      const lines = bodyText
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      const checkHints = lines
        .filter((line) => /(\u5FC5\u586B|\u9519\u8BEF|\u8BF7\u8F93\u5165|\u95EE\u9898|\u5F85\u5904\u7406|\u68C0\u67E5)/.test(line))
        .slice(0, 12);
      const passed =
        bodyText.includes("\u53EF\u63D0\u4EA4\u53D1\u5E03\u5546\u54C1") ||
        bodyText.includes("\u5FC5\u586B\u9879\u5DF2\u5B8C\u6210");
      return {
        checkPassed: passed,
        checkMessage: passed
          ? "Publish check indicates the page is ready to submit."
          : "Publish check still reports blocking issues on the page.",
        checkHints
      };
    });

    const screenshotFile = await savePageScreenshot(page, runtimeDir, "publish-page-fill-check.png");
    return {
      pageUrl: page.url(),
      pageTitle: await page.title(),
      screenshotFile,
      checkPassed: summary.checkPassed,
      checkMessage: summary.checkMessage,
      checkHints: summary.checkHints
    };
  } finally {
    await context.browser()?.close().catch(() => {});
  }
}

async function recoverUsablePublishPage(currentPage: Page): Promise<Page> {
  const context = currentPage.context();
  const recoveredPage =
    context.pages().find((item) => !item.isClosed() && item.url().includes("/ffa/g/create")) ||
    context.pages().find((item) => !item.isClosed() && item.url().includes("/ffa/g")) ||
    (!currentPage.isClosed() ? currentPage : null) ||
    context.pages().find((item) => !item.isClosed()) ||
    null;

  if (!recoveredPage) {
    throw new Error("Publish page context was lost and no replacement page is available.");
  }

  attachSafeDialogHandler(recoveredPage);
  await recoveredPage.bringToFront().catch(() => {});
  await recoveredPage.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => {});
  await recoveredPage.waitForTimeout(1200).catch(() => {});
  return recoveredPage;
}

async function recoverUsablePageFromContext(context: Awaited<ReturnType<typeof launchPersistentBrowser>>, preferredUrlPart?: string): Promise<Page> {
  const recoveredPage =
    (preferredUrlPart
      ? context.pages().find((item) => !item.isClosed() && item.url().includes(preferredUrlPart))
      : null) ||
    context.pages().find((item) => !item.isClosed()) ||
    null;

  if (!recoveredPage) {
    throw new Error("Browser page context was lost and no replacement page is available.");
  }

  attachSafeDialogHandler(recoveredPage);
  await recoveredPage.bringToFront().catch(() => {});
  await recoveredPage.waitForTimeout(1200).catch(() => {});
  return recoveredPage;
}

async function runPublishCheckOnPage(
  page: Page,
  runtimeDir: string,
  fileName: string
): Promise<{
  pageUrl: string;
  pageTitle: string;
  screenshotFile: string;
  checkPassed: boolean;
  checkMessage: string;
  checkHints: string[];
  blockingFields: string[];
}> {
  let activePage = page;
  await activePage.bringToFront();
  await activePage.waitForTimeout(1200);
  await dismissTransientOverlays(activePage);
  await clickVisibleText(activePage, "\u586B\u5199\u68C0\u67E5");
  await Promise.race([
    activePage.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => {}),
    activePage.waitForTimeout(2500).catch(() => {})
  ]);
  activePage = await recoverUsablePublishPage(activePage);

  let summary:
    | {
        checkPassed: boolean;
        checkMessage: string;
        checkHints: string[];
        blockingFields: string[];
      }
    | undefined;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      summary = await activePage.evaluate((freightKeyword) => {
    const bodyText = document.body.innerText || "";
    const lines = bodyText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    const visibleText = (value: string): string => value.replace(/\s+/g, " ").trim();
    const sectionLabels = ["\u4e3b\u56fe", "\u4e3b\u56fe3:4", "\u767d\u5e95\u56fe", "\u8be6\u60c5\u9875"];
    const countSectionImages = (targetSection: string): number => {
      const labels = Array.from(document.querySelectorAll("body *"))
        .map((el) => el as HTMLElement)
        .map((el) => {
          const text = visibleText(el.textContent || "");
          const rect = el.getBoundingClientRect();
          if (!text || rect.width <= 0 || rect.height <= 0) {
            return null;
          }
          return { text, top: rect.top, bottom: rect.bottom, left: rect.left };
        })
        .filter(Boolean) as Array<{ text: string; top: number; bottom: number; left: number }>;

      const current = labels.find((item) => item.text === targetSection);
      if (!current) {
        return 0;
      }

      const nextTop =
        labels.filter((item) => sectionLabels.includes(item.text) && item.top > current.top).sort((a, b) => a.top - b.top)[0]
          ?.top || current.bottom + 500;

      const imageLike = Array.from(document.querySelectorAll("img, [style*='background-image']"))
        .map((el) => el as HTMLElement)
        .map((el) => {
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          if (rect.width < 40 || rect.height < 40 || style.display === "none" || style.visibility === "hidden") {
            return null;
          }
          return `${Math.round(rect.left)}-${Math.round(rect.top)}-${Math.round(rect.width)}-${Math.round(rect.height)}`;
        })
        .filter(Boolean);

      return Array.from(
        new Set(
          Array.from(document.querySelectorAll("img, [style*='background-image']"))
            .map((el) => el as HTMLElement)
            .map((el) => {
              const rect = el.getBoundingClientRect();
              const style = window.getComputedStyle(el);
              if (rect.width < 40 || rect.height < 40 || style.display === "none" || style.visibility === "hidden") {
                return null;
              }
              if (rect.top < current.bottom - 20 || rect.top > nextTop - 10 || rect.left <= current.left) {
                return null;
              }
              return `${Math.round(rect.left)}-${Math.round(rect.top)}-${Math.round(rect.width)}-${Math.round(rect.height)}`;
            })
            .filter(Boolean)
        )
      ).length;
    };

    const spinButtons = Array.from(document.querySelectorAll("input[role='spinbutton']"))
      .map((el) => el as HTMLInputElement)
      .filter((input) => {
        const rect = input.getBoundingClientRect();
        return rect.width > 80 && rect.height > 0 && !input.disabled && !input.readOnly;
      });
    const emptyPriceCount = spinButtons.filter((input) => (input.placeholder || "") === "\u8bf7\u8f93\u5165" && !(input.value || "").trim()).length;
    const emptyStockCount = spinButtons.filter((input) => (input.placeholder || "") === "\u8bf7\u8f93\u5165\u5e93\u5b58" && !(input.value || "").trim()).length;

    const freightCombos = Array.from(document.querySelectorAll("input[type='search'], input[role='combobox']"))
      .map((el) => el as HTMLInputElement)
      .filter((input) => {
        const rect = input.getBoundingClientRect();
        if (rect.width <= 120 || rect.height <= 0) {
          return false;
        }
        const contextText = visibleText(
          [input.parentElement?.parentElement?.textContent || "", input.closest("div")?.textContent || ""].join(" ")
        );
        return contextText.includes("\u8fd0\u8d39\u6a21\u677f");
      });
    const freightSelected = freightCombos.some((input) => {
      const contextText = visibleText(
        [input.value || "", input.parentElement?.parentElement?.textContent || "", input.closest("div")?.textContent || ""].join(" ")
      );
      return contextText.includes(freightKeyword);
    });

    const modelSpecFilled = Array.from(document.querySelectorAll("input"))
      .map((el) => el as HTMLInputElement)
      .some((input) => {
        const rect = input.getBoundingClientRect();
        if (rect.width <= 120 || rect.height <= 0 || input.disabled || input.readOnly) {
          return false;
        }
        const contextText = visibleText(
          [input.parentElement?.parentElement?.textContent || "", input.closest("div")?.textContent || ""].join(" ")
        );
        if (!contextText.includes("\u578b\u53f7\u89c4\u683c")) {
          return false;
        }
        return Boolean((input.value || "").trim());
      });

    const blockingFields = [
      countSectionImages("\u4e3b\u56fe3:4") > 0 ? "\u4e3b\u56fe3:4" : "",
      countSectionImages("\u767d\u5e95\u56fe") > 0 ? "\u767d\u5e95\u56fe" : "",
      emptyPriceCount > 0 ? "\u4ef7\u683c" : "",
      emptyStockCount > 0 ? "\u73b0\u8d27\u5e93\u5b58" : "",
      modelSpecFilled ? "" : "\u578b\u53f7\u89c4\u683c",
      freightSelected ? "" : "\u8fd0\u8d39\u6a21\u677f"
    ].filter(Boolean);

    const checkHints = lines
      .filter((line) => /(\u5FC5\u586B|\u9519\u8BEF|\u8BF7\u8F93\u5165|\u95EE\u9898|\u5F85\u5904\u7406|\u68C0\u67E5)/.test(line))
      .slice(0, 12);
    const passed =
      (bodyText.includes("\u53EF\u63D0\u4EA4\u53D1\u5E03\u5546\u54C1") ||
        bodyText.includes("\u5FC5\u586B\u9879\u5DF2\u5B8C\u6210")) &&
      !blockingFields.length;
    return {
      checkPassed: passed,
      checkMessage: passed
        ? "Publish check indicates the page is ready to submit."
        : "Publish check still reports blocking issues on the page.",
      checkHints,
      blockingFields
    };
      }, FIXED_FREIGHT_TEMPLATE_KEYWORD);
      break;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const isNavigationRace =
        /Execution context was destroyed|Cannot find context|Target closed|Most likely the page has been closed/i.test(message);
      if (!isNavigationRace || attempt === 2) {
        throw error;
      }
      await Promise.race([
        activePage.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => {}),
        activePage.waitForTimeout(1800).catch(() => {})
      ]);
      activePage = await recoverUsablePublishPage(activePage);
    }
  }

  if (!summary) {
    throw new Error("Publish check summary could not be collected.");
  }

  const screenshotFile = await savePageScreenshot(activePage, runtimeDir, fileName);
  return {
    pageUrl: activePage.url(),
    pageTitle: await activePage.title(),
    screenshotFile,
    checkPassed: summary.checkPassed,
    checkMessage: summary.checkMessage,
    checkHints: summary.checkHints,
    blockingFields: summary.blockingFields
  };
}

async function clickPublishProductOnPage(
  page: Page,
  runtimeDir: string,
  fileName: string
): Promise<{
  pageUrl: string;
  pageTitle: string;
  screenshotFile: string;
  publishClicked: boolean;
  publishIssue: string;
}> {
  let activePage = page;
  await activePage.bringToFront();
  await activePage.waitForTimeout(1200);
  await dismissTransientOverlays(activePage);

  const publishButton = activePage.getByRole("button", { name: "\u53d1\u5e03\u5546\u54c1" }).first();
  let publishClicked = false;
  if (await publishButton.count()) {
    await publishButton.click({ timeout: 3000 }).catch(() => {});
    await activePage.waitForTimeout(1500).catch(() => {});
    activePage = await recoverUsablePublishPage(activePage);
    publishClicked = true;
  }

  const screenshotFile = await savePageScreenshot(activePage, runtimeDir, fileName);
  return {
    pageUrl: activePage.url(),
    pageTitle: await activePage.title(),
    screenshotFile,
    publishClicked,
    publishIssue: publishClicked ? "" : "Publish product button was not clickable after all module checks passed."
  };
}

function normalizeNumericInputValue(value: string): string {
  const text = value.trim();
  if (!text) {
    return "";
  }
  const numeric = Number(text.replace(/,/g, ""));
  return Number.isFinite(numeric) ? String(numeric) : text;
}

async function ensurePriceInventorySectionReady(page: Page): Promise<void> {
  await ensurePublishSectionTab(page, "价格库存");
  const anchors = ["价格与库存", "现货库存", "商品规格", "价格"];

  for (const anchor of anchors) {
    const top = await findLabelAbsoluteTop(page, anchor).catch(() => null);
    if (typeof top === "number") {
      await page
        .evaluate((targetTop) => window.scrollTo({ top: Math.max(0, targetTop - 220), behavior: "instant" }), top)
        .catch(() => {});
      await page.waitForTimeout(400);
      await scrollLabelIntoView(page, anchor).catch(() => false);
      await page.waitForTimeout(300);
      break;
    }
  }

  await scrollPublishSectionContentIntoView(page, "价格库存").catch(() => false);
  await page.waitForTimeout(500);
}

async function markVisiblePriceInventoryInputs(page: Page): Promise<void> {
  await page.evaluate(() => {
    const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
    const allElements = Array.from(document.querySelectorAll("body *")).map((el) => el as HTMLElement);
    const labels = allElements
      .map((el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        const text = normalize(el.innerText || el.textContent || "");
        if (!text || rect.width <= 0 || rect.height <= 0 || style.display === "none" || style.visibility === "hidden") {
          return null;
        }
        return { text, rect };
      })
      .filter(Boolean) as Array<{ text: string; rect: DOMRect }>;

    const findBestLabel = (keywords: string[]): { text: string; rect: DOMRect } | null =>
      labels
        .filter((item) => keywords.some((keyword) => item.text.includes(keyword)))
        .sort((a, b) => {
          const aScore = keywords.some((keyword) => a.text === keyword) ? 1000 : 0;
          const bScore = keywords.some((keyword) => b.text === keyword) ? 1000 : 0;
          return bScore - aScore || a.rect.top - b.rect.top;
        })[0] || null;

    const priceSectionLabel = findBestLabel(["价格与库存"]);
    const priceHeader = findBestLabel(["价格", "售价"]);
    const stockHeader = findBestLabel(["现货库存", "库存"]);
    const tableAnchor = findBestLabel(["价格与库存", "现货库存", "价格"]);
    const bottomAnchor = findBestLabel(["设置商品优惠券", "部分信息会预填", "服务与履约"]);
    const tableTop = Math.max(
      140,
      typeof priceSectionLabel?.rect.bottom === "number"
        ? priceSectionLabel.rect.bottom + 12
        : (priceHeader?.rect.top ?? stockHeader?.rect.top ?? tableAnchor?.rect.top ?? 260) - 30
    );
    const tableBottom =
      typeof bottomAnchor?.rect.top === "number" && bottomAnchor.rect.top > tableTop + 120
        ? bottomAnchor.rect.top + 40
        : tableTop + 1200;
    const priceCenterX = priceHeader ? priceHeader.rect.x + priceHeader.rect.width / 2 : 680;
    const stockCenterX = stockHeader ? stockHeader.rect.x + stockHeader.rect.width / 2 : 900;

    Array.from(document.querySelectorAll("input")).forEach((node) => {
      node.removeAttribute("data-codex-price-row");
      node.removeAttribute("data-codex-stock-row");
    });

    const rows = Array.from(document.querySelectorAll("tr"))
      .map((el) => el as HTMLTableRowElement)
      .map((row) => {
        const rect = row.getBoundingClientRect();
        const style = window.getComputedStyle(row);
        const text = normalize(row.innerText || row.textContent || "");
        if (
          !text ||
          rect.width <= 0 ||
          rect.height <= 0 ||
          rect.top < tableTop ||
          rect.bottom > tableBottom ||
          style.display === "none" ||
          style.visibility === "hidden" ||
          text.includes("现货库存") ||
          text.includes("价格与库存")
        ) {
          return null;
        }

        const inputs = Array.from(row.querySelectorAll("input"))
          .map((node) => node as HTMLInputElement)
          .map((input) => {
            const inputRect = input.getBoundingClientRect();
            const inputStyle = window.getComputedStyle(input);
            const type = (input.getAttribute("type") || "text").toLowerCase();
            const placeholder = normalize(input.getAttribute("placeholder") || "");
            const context = normalize(
              [
                input.value || "",
                placeholder,
                input.getAttribute("aria-label") || "",
                input.parentElement?.innerText || "",
                input.parentElement?.parentElement?.innerText || "",
                input.closest("td, th, tr, .semi-table-row, .ecom-g-table-row")?.textContent || ""
              ].join(" ")
            );
            if (
              inputRect.width < 90 ||
              inputRect.height <= 0 ||
              inputStyle.display === "none" ||
              inputStyle.visibility === "hidden" ||
              input.disabled ||
              input.readOnly ||
              ["hidden", "file", "checkbox", "radio"].includes(type) ||
              placeholder.includes("请输入规格值") ||
              context.includes("请输入规格值") ||
              context.includes("规格值")
            ) {
              return null;
            }
            return {
              input,
              centerX: inputRect.x + inputRect.width / 2,
              distanceToPrice: Math.abs(inputRect.x + inputRect.width / 2 - priceCenterX),
              distanceToStock: Math.abs(inputRect.x + inputRect.width / 2 - stockCenterX),
              placeholder,
              context,
              priceScore:
                (/价格|售价/.test(context) ? 260 : 0) +
                (/[￥¥]/.test(context) ? 220 : 0) +
                (/库存/.test(context) ? -240 : 0),
              stockScore:
                (/库存/.test(context) ? 280 : 0) +
                (/请输入库存/.test(context) ? 220 : 0) +
                (/[￥¥]/.test(context) ? -260 : 0) +
                (/价格|售价/.test(context) ? -180 : 0)
            };
          })
          .filter(Boolean) as Array<{
            input: HTMLInputElement;
            centerX: number;
            distanceToPrice: number;
            distanceToStock: number;
            placeholder: string;
            context: string;
            priceScore: number;
            stockScore: number;
          }>;

        if (!inputs.length) {
          return null;
        }

        const priceInput = inputs
          .filter((item) => !/erp编码|商家编码/i.test(item.placeholder) && !/erp编码|商家编码/i.test(item.context))
          .sort((a, b) => (b.priceScore - a.priceScore) || (a.distanceToPrice - b.distanceToPrice))[0];
        const stockInput = inputs
          .filter((item) => item.input !== priceInput?.input)
          .filter((item) => !/erp编码|商家编码/i.test(item.placeholder) && !/erp编码|商家编码/i.test(item.context))
          .sort((a, b) => (b.stockScore - a.stockScore) || (a.distanceToStock - b.distanceToStock))[0];

        if (!priceInput || !stockInput) {
          return null;
        }
        if (
          priceInput.distanceToPrice > 220 ||
          stockInput.distanceToStock > 220 ||
          priceInput.priceScore < 0 ||
          stockInput.stockScore < 0
        ) {
          return null;
        }

        return {
          priceInput: priceInput.input,
          stockInput: stockInput.input,
          top: rect.top
        };
      })
      .filter(Boolean)
      .sort((a, b) => (a?.top || 0) - (b?.top || 0));

    rows.forEach((row, index) => {
      row?.priceInput.setAttribute("data-codex-price-row", String(index));
      row?.stockInput.setAttribute("data-codex-stock-row", String(index));
    });
  });
}

async function detectPriceInventoryValuesInsideSpecInputs(page: Page): Promise<string[]> {
  return page.evaluate((expectedValues) => {
    const normalize = (value: string): string => value.replace(/\s+/g, "").trim();
    const dangerousValues = expectedValues.map((value) => normalize(String(value)));
    return Array.from(document.querySelectorAll("input"))
      .map((el) => el as HTMLInputElement)
      .map((input) => {
        const rect = input.getBoundingClientRect();
        const style = window.getComputedStyle(input);
        const placeholder = (input.getAttribute("placeholder") || "").trim();
        const context = [
          placeholder,
          input.parentElement?.textContent || "",
          input.parentElement?.parentElement?.textContent || "",
          input.closest("div")?.textContent || ""
        ]
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
        if (
          rect.width <= 120 ||
          rect.height <= 0 ||
          style.display === "none" ||
          style.visibility === "hidden" ||
          !(placeholder.includes("请输入规格值") || context.includes("请输入规格值") || context.includes("规格值"))
        ) {
          return "";
        }
        const value = normalize(input.value || "");
        if (!value) {
          return "";
        }
        return dangerousValues.includes(value) ? input.value || "" : "";
      })
      .filter(Boolean);
  }, [...FIXED_PRICES, FIXED_STOCK]);
}

async function getVisiblePriceInventoryInputLocators(page: Page): Promise<{
  priceInputs: Locator;
  stockInputs: Locator;
}> {
  await markVisiblePriceInventoryInputs(page);
  return {
    priceInputs: page.locator('input[data-codex-price-row]'),
    stockInputs: page.locator('input[data-codex-stock-row]')
  };
}

async function readVisiblePriceInventoryRows(
  page: Page
): Promise<Array<{ priceValue: string; stockValue: string }>> {
  const { priceInputs, stockInputs } = await getVisiblePriceInventoryInputLocators(page);
  const priceCount = await priceInputs.count();
  const stockCount = await stockInputs.count();
  const rowCount = Math.min(priceCount, stockCount);
  const rows: Array<{ priceValue: string; stockValue: string }> = [];

  for (let index = 0; index < rowCount; index += 1) {
    rows.push({
      priceValue: await priceInputs.nth(index).inputValue().catch(() => ""),
      stockValue: await stockInputs.nth(index).inputValue().catch(() => "")
    });
  }

  return rows;
}

async function setLocatorInputValue(locator: Locator, value: string): Promise<string> {
  return locator.evaluate((node, nextValue) => {
    const input = node as HTMLInputElement | HTMLTextAreaElement;
    const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    input.focus();
    setter?.call(input, "");
    input.dispatchEvent(new InputEvent("input", { bubbles: true, data: "", inputType: "deleteContentBackward" }));
    setter?.call(input, nextValue);
    input.dispatchEvent(new InputEvent("input", { bubbles: true, data: nextValue, inputType: "insertText" }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return (input.value || "").trim();
  }, value);
}

async function fillAndVerifyPriceInventoryRow(
  page: Page,
  rowIndex: number,
  expectedPrice: number,
  expectedStock: number
): Promise<string> {
  const { priceInputs, stockInputs } = await getVisiblePriceInventoryInputLocators(page);
  const expectedPriceText = String(expectedPrice);
  const expectedStockText = String(expectedStock);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const priceInput = priceInputs.nth(rowIndex);
    const stockInput = stockInputs.nth(rowIndex);

    await priceInput.scrollIntoViewIfNeeded().catch(() => {});
    await priceInput.click({ timeout: 3000 }).catch(() => {});
    await priceInput.fill(expectedPriceText, { timeout: 3000 }).catch(() => {});
    let currentPriceValue = await priceInput.inputValue().catch(() => "");
    if (normalizeNumericInputValue(currentPriceValue) !== normalizeNumericInputValue(expectedPriceText)) {
      currentPriceValue = await setLocatorInputValue(priceInput, expectedPriceText).catch(() => currentPriceValue);
    }
    await page.waitForTimeout(200);

    await stockInput.scrollIntoViewIfNeeded().catch(() => {});
    await stockInput.click({ timeout: 3000 }).catch(() => {});
    await stockInput.fill(expectedStockText, { timeout: 3000 }).catch(() => {});
    let currentStockValue = await stockInput.inputValue().catch(() => "");
    if (normalizeNumericInputValue(currentStockValue) !== normalizeNumericInputValue(expectedStockText)) {
      currentStockValue = await setLocatorInputValue(stockInput, expectedStockText).catch(() => currentStockValue);
    }
    await stockInput.press("Tab").catch(() => {});
    await page.waitForTimeout(300);

    const rows = await readVisiblePriceInventoryRows(page);
    const currentRow = rows[rowIndex];
    if (
      currentRow &&
      normalizeNumericInputValue(currentRow.priceValue) === normalizeNumericInputValue(expectedPriceText) &&
      normalizeNumericInputValue(currentRow.stockValue) === normalizeNumericInputValue(expectedStockText)
    ) {
      return "";
    }

    await dismissTransientOverlays(page);
  }

  const rows = await readVisiblePriceInventoryRows(page);
  const currentRow = rows[rowIndex];
  return `Price/inventory row ${rowIndex + 1} value mismatch after fill. expectedPrice=${expectedPriceText}; actualPrice=${
    currentRow?.priceValue || "<empty>"
  }; expectedStock=${expectedStockText}; actualStock=${currentRow?.stockValue || "<empty>"}`;
}

async function countVisiblePriceInventoryRows(page: Page): Promise<number> {
  const rows = await readVisiblePriceInventoryRows(page).catch(() => []);
  return rows.length;
}

async function applyPriceInventory(
  runtimeDir: string,
  publishPageUrl: string
): Promise<{
  pageUrl: string;
  pageTitle: string;
  screenshotFile: string;
  filledRows: number;
}> {
  const context = await launchPersistentBrowser();
  try {
    const page = context.pages().find((item) => !item.isClosed()) || (await context.newPage());
    await page.bringToFront();
    await page.goto(publishPageUrl, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3500);
    await page.mouse.wheel(0, 2300).catch(() => {});
    await page.waitForTimeout(1000);

    const rows = await readVisiblePriceInventoryRows(page);
    if (!rows.length) {
      throw new Error("No visible price/inventory rows found on publish page.");
    }

    const filledRows = Math.min(rows.length, FIXED_PRICES.length);
    for (let index = 0; index < filledRows; index += 1) {
      const rowIssue = await fillAndVerifyPriceInventoryRow(page, index, FIXED_PRICES[index], FIXED_STOCK);
      if (rowIssue) {
        throw new Error(rowIssue);
      }
    }

    const screenshotFile = await savePageScreenshot(page, runtimeDir, "publish-page-price-inventory-filled.png");
    return {
      pageUrl: page.url(),
      pageTitle: await page.title(),
      screenshotFile,
      filledRows
    };
  } finally {
    await context.browser()?.close().catch(() => {});
  }
}

async function applyPriceInventoryOnPage(
  page: Page,
  runtimeDir: string,
  fileName: string
): Promise<{
  pageUrl: string;
  pageTitle: string;
  screenshotFile: string;
  filledRows: number;
  priceIssue: string;
}> {
  await page.bringToFront();
  await page.waitForTimeout(1200);
  await ensurePriceInventorySectionReady(page);
  await dismissTransientOverlays(page);

  const pollutedSpecInputsBeforeFill = await detectPriceInventoryValuesInsideSpecInputs(page).catch(() => []);
  if (pollutedSpecInputsBeforeFill.length) {
    const screenshotFile = await savePageScreenshot(page, runtimeDir, fileName);
    return {
      pageUrl: page.url(),
      pageTitle: await page.title(),
      screenshotFile,
      filledRows: 0,
      priceIssue: `Price/inventory values were found inside spec value inputs before fill: ${pollutedSpecInputsBeforeFill.join(", ")}`
    };
  }

  const rows = await readVisiblePriceInventoryRows(page);
  if (!rows.length) {
    const screenshotFile = await savePageScreenshot(page, runtimeDir, fileName);
    return {
      pageUrl: page.url(),
      pageTitle: await page.title(),
      screenshotFile,
      filledRows: 0,
      priceIssue: "No visible price/inventory rows found on publish page."
    };
  }

  const filledRows = Math.min(rows.length, FIXED_PRICES.length);
  for (let index = 0; index < filledRows; index += 1) {
    const rowIssue = await fillAndVerifyPriceInventoryRow(page, index, FIXED_PRICES[index], FIXED_STOCK);
    if (rowIssue) {
      const screenshotFile = await savePageScreenshot(page, runtimeDir, fileName);
      return {
        pageUrl: page.url(),
        pageTitle: await page.title(),
        screenshotFile,
        filledRows: index,
        priceIssue: rowIssue
      };
    }
  }

  const finalRows = await readVisiblePriceInventoryRows(page);
  const pollutedSpecInputsAfterFill = await detectPriceInventoryValuesInsideSpecInputs(page).catch(() => []);
  if (pollutedSpecInputsAfterFill.length) {
    const screenshotFile = await savePageScreenshot(page, runtimeDir, fileName);
    return {
      pageUrl: page.url(),
      pageTitle: await page.title(),
      screenshotFile,
      filledRows: 0,
      priceIssue: `Price/inventory values were incorrectly written into spec value inputs: ${pollutedSpecInputsAfterFill.join(", ")}`
    };
  }
  const missingRows = FIXED_PRICES.map((price, index) => {
    const currentRow = finalRows[index];
    if (!currentRow) {
      return `row ${index + 1} missing`;
    }
    const priceOk = normalizeNumericInputValue(currentRow.priceValue) === normalizeNumericInputValue(String(price));
    const stockOk = normalizeNumericInputValue(currentRow.stockValue) === normalizeNumericInputValue(String(FIXED_STOCK));
    return priceOk && stockOk
      ? ""
      : `row ${index + 1} expected price=${price}, stock=${FIXED_STOCK}; actual price=${currentRow.priceValue || "<empty>"}, stock=${currentRow.stockValue || "<empty>"}`;
  }).filter(Boolean);

  if (missingRows.length) {
    const screenshotFile = await savePageScreenshot(page, runtimeDir, fileName);
    return {
      pageUrl: page.url(),
      pageTitle: await page.title(),
      screenshotFile,
      filledRows: finalRows.filter((row, index) => {
        const priceOk = normalizeNumericInputValue(row.priceValue) === normalizeNumericInputValue(String(FIXED_PRICES[index] ?? ""));
        const stockOk = normalizeNumericInputValue(row.stockValue) === normalizeNumericInputValue(String(FIXED_STOCK));
        return priceOk && stockOk;
      }).length,
      priceIssue: `Price/inventory verification failed: ${missingRows.join(" | ")}`
    };
  }

  const screenshotFile = await savePageScreenshot(page, runtimeDir, fileName);
  return {
    pageUrl: page.url(),
    pageTitle: await page.title(),
    screenshotFile,
    filledRows,
    priceIssue: ""
  };
}

async function runPublishFlow(
  runtimeDir: string,
  metadata: { brand: string; spu: string; title?: string; shortTitle?: string; modelSpec?: string },
  assets: ProductAssets,
  shopFolder: string,
  publishPageUrl?: string,
  stopBeforePublish = false
): Promise<{
  pageUrl: string;
  pageTitle: string;
  screenshotFiles: string[];
  createPageUrl: string;
  matchedRowText?: string;
  filledFields: string[];
  configuredFields: string[];
  uploadedGroups: string[];
  uploadIssue: string;
  specTypeOptions: string[];
  specIssue: string;
  filledPriceRows: number;
  priceIssue: string;
  checkPassed: boolean;
  checkMessage: string;
  checkHints: string[];
  blockingFields: string[];
  publishClicked: boolean;
  publishIssue: string;
  freightTemplateName?: string;
  sections: string[];
  topActions: string[];
  errorHints: string[];
  stages: PublishFlowStage[];
}> {
  const screenshotFiles: string[] = [];
  const stages: PublishFlowStage[] = [];
  const filledFields: string[] = [];
  const configuredFields: string[] = [];
  let uploadedGroups: string[] = [];
  let uploadIssue = "";
  let specTypeOptions: string[] = [];
  let specIssue = "";
  let filledPriceRows = 0;
  let priceIssue = "";
  let checkPassed = false;
  let checkMessage = "";
  let checkHints: string[] = [];
  let blockingFields: string[] = [];
  let publishClicked = false;
  let publishIssue = "";
  let freightTemplateName = "";

  let createPageUrl = publishPageUrl || "";
  let matchedRowText = "";

  if (!createPageUrl) {
    const queryResult = await queryPlatformSpu(runtimeDir, metadata.brand, metadata.spu, shopFolder);
    screenshotFiles.push(queryResult.screenshotFile);
    createPageUrl = queryResult.createPageUrl;
    matchedRowText = queryResult.matchedRowText;
    stages.push({ step: "query_platform_spu", status: "completed" });
  }

  const context = await launchPersistentBrowser();
  try {
    const existingCreatePage = context.pages().find((item) => !item.isClosed() && item.url().includes("/ffa/g/create"));
    const page = existingCreatePage || context.pages().find((item) => !item.isClosed()) || (await context.newPage());
    attachSafeDialogHandler(page);
    await page.bringToFront();
    await ensureShopContext(page, runtimeDir, shopFolder);
    let basicInfoCompleted = false;
    for (let basicAttempt = 0; basicAttempt < 2; basicAttempt += 1) {
      await gotoWithTolerance(page, createPageUrl, 3500);

      try {
        await verifyCategoryRegistrationGateOnPage(
          page,
          runtimeDir,
          metadata.spu,
          "publish-page-category-registration-mismatch.png"
        );
        if (metadata.title || metadata.shortTitle || metadata.modelSpec) {
          const fillResult = await fillBasicPublishPageOnPage(
            page,
            runtimeDir,
            {
              title: metadata.title,
              shortTitle: metadata.shortTitle,
              modelSpec: metadata.modelSpec,
              spu: metadata.spu
            },
            "publish-page-basic-filled.png"
          );
          screenshotFiles.push(fillResult.screenshotFile);
          filledFields.length = 0;
          filledFields.push(...fillResult.filledFields);
          const missingBasicFields = [
            metadata.title ? "title" : "",
            metadata.shortTitle ? "shortTitle" : "",
            metadata.modelSpec ? "modelSpec" : ""
          ]
            .filter(Boolean)
            .filter((field) => !filledFields.includes(field));
          if (missingBasicFields.length) {
            throw new Error(`基础信息模块缺失字段: ${missingBasicFields.join(", ")}`);
          }
        }
        stages.push({ step: "fill_basic_publish_page", status: "completed" });
        basicInfoCompleted = true;
        break;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const categoryMismatch = message.includes("Category registration mismatch before modelSpec fill.");
        if (categoryMismatch && basicAttempt === 0) {
          const retryQueryResult = await queryPlatformSpu(runtimeDir, metadata.brand, metadata.spu, shopFolder);
          screenshotFiles.push(retryQueryResult.screenshotFile);
          createPageUrl = retryQueryResult.createPageUrl;
          matchedRowText = retryQueryResult.matchedRowText;
          continue;
        }
        stages.push({ step: "fill_basic_publish_page", status: "failed" });
        throw new Error(`Sequential publish flow stopped: 基础信息模块未完成。${message}`);
      }
    }
    if (!basicInfoCompleted) {
      stages.push({ step: "fill_basic_publish_page", status: "failed" });
      throw new Error("Sequential publish flow stopped: 基础信息模块未完成。");
    }

    let priceInventoryCompleted = false;
    for (let specAttempt = 0; specAttempt < 2; specAttempt += 1) {
      const imageResult = await uploadProductImagesOnPage(page, runtimeDir, assets, "publish-page-images-uploaded.png");
      screenshotFiles.push(imageResult.screenshotFile);
      uploadedGroups = imageResult.uploadedGroups;
      uploadIssue = imageResult.uploadIssue;
      if (
        uploadIssue ||
        !uploadedGroups.includes("mainImages") ||
        !uploadedGroups.some((item) => item === "detailImages" || item === "detailImages:fillFromMainThenUpload")
      ) {
        stages.push({ step: "upload_product_images", status: "failed" });
        throw new Error(
          `Sequential publish flow stopped: 鍥炬枃淇℃伅妯″潡鏈畬鎴愩€?{uploadIssue || "Main/detail image groups were not both uploaded successfully."}`
        );
      }
      if (specAttempt === 0) {
        stages.push({ step: "upload_product_images", status: "completed" });
      }

      const specResult = await applyFixedSpecsOnPage(page, runtimeDir, "publish-page-spec-editor.png", metadata.title);
      screenshotFiles.push(specResult.screenshotFile);
      configuredFields.push(...specResult.configuredFields);
      specTypeOptions = specResult.specTypeOptions;
      specIssue = specResult.specIssue;
      const specModuleError = await readSpecModuleErrorOnPage(page).catch(() => "");
      if (!specIssue && specModuleError) {
        specIssue = `Spec module error detected: ${specModuleError}`;
      }

      if (specIssue && specAttempt === 0) {
        await gotoWithTolerance(page, createPageUrl, 3500);
        await verifyCategoryRegistrationGateOnPage(
          page,
          runtimeDir,
          metadata.spu,
          "publish-page-category-registration-mismatch.png"
        );
        if (metadata.title || metadata.shortTitle || metadata.modelSpec) {
          const refillResult = await fillBasicPublishPageOnPage(
            page,
            runtimeDir,
            {
              title: metadata.title,
              shortTitle: metadata.shortTitle,
              modelSpec: metadata.modelSpec,
              spu: metadata.spu
            },
            "publish-page-basic-filled.png"
          );
          screenshotFiles.push(refillResult.screenshotFile);
          filledFields.length = 0;
          filledFields.push(...refillResult.filledFields);
        }
        continue;
      }

      const priceInventoryResult = await applyPriceInventoryOnPage(page, runtimeDir, "publish-page-price-inventory-filled.png");
      screenshotFiles.push(priceInventoryResult.screenshotFile);
      filledPriceRows = priceInventoryResult.filledRows;
      priceIssue = priceInventoryResult.priceIssue;
      if (!specIssue && !priceIssue && filledPriceRows >= FIXED_PRICES.length) {
        priceInventoryCompleted = true;
        break;
      }
      if (specAttempt === 0 && specIssue) {
        continue;
      }
      break;
    }
    if (!priceInventoryCompleted) {
      stages.push({ step: "apply_price_inventory", status: "failed" });
      throw new Error(
        `Sequential publish flow stopped: 价格库存模块未完成。${specIssue || priceIssue || `Expected ${FIXED_PRICES.length} price rows but filled ${filledPriceRows}.`}`
      );
    }
    stages.push({ step: "apply_price_inventory", status: "completed" });

    const settingsResult = await applyFixedPublishSettingsOnPage(
      page,
      runtimeDir,
      "publish-page-fixed-settings.png",
      metadata.spu
    );
    screenshotFiles.push(settingsResult.screenshotFile);
    configuredFields.push(...settingsResult.configuredFields);
    freightTemplateName = settingsResult.freightTemplateName;
    const serviceRequiredFields = ["shippingMode", "shippingTime", "productStatus", "freightTemplate"];
    const missingServiceFields = serviceRequiredFields.filter((field) => !configuredFields.includes(field));
    if (!freightTemplateName || missingServiceFields.length) {
      stages.push({ step: "apply_fixed_publish_settings", status: "failed" });
      throw new Error(
        `Sequential publish flow stopped: 服务与履约模块未完成。${[
          !freightTemplateName ? "Freight template was not selected." : "",
          missingServiceFields.length ? `Missing configured fields: ${missingServiceFields.join(", ")}` : ""
        ]
          .filter(Boolean)
          .join(" ")}`
      );
    }
    stages.push({ step: "apply_fixed_publish_settings", status: "completed" });

    const checkResult = await runPublishCheckOnPage(page, runtimeDir, "publish-page-fill-check.png");
    screenshotFiles.push(checkResult.screenshotFile);
    checkPassed = checkResult.checkPassed;
    checkMessage = checkResult.checkMessage;
    checkHints = checkResult.checkHints;
    blockingFields = checkResult.blockingFields;
    const completedFieldSet = new Set<string>([
      ...filledFields,
      ...configuredFields,
      ...(filledPriceRows > 0 ? ["\u4ef7\u683c", "\u73b0\u8d27\u5e93\u5b58"] : []),
      ...(freightTemplateName ? ["\u8fd0\u8d39\u6a21\u677f"] : [])
    ]);
    blockingFields = blockingFields.filter((field) => {
      if (field === "\u578b\u53f7\u89c4\u683c" && completedFieldSet.has("modelSpec")) {
        return false;
      }
      if ((field === "\u4ef7\u683c" || field === "\u73b0\u8d27\u5e93\u5b58") && filledPriceRows > 0) {
        return false;
      }
      if (field === "\u8fd0\u8d39\u6a21\u677f" && freightTemplateName) {
        return false;
      }
      return true;
    });
    if (!blockingFields.length && !uploadIssue && !specIssue && !priceIssue) {
      checkPassed = true;
      checkMessage = "Publish check indicates the page is ready to submit.";
    }
    if (checkPassed && !blockingFields.length && specIssue) {
      specIssue = "";
    }
    if (!checkPassed || blockingFields.length) {
      stages.push({ step: "run_publish_check", status: "failed" });
      throw new Error(
        `Sequential publish flow stopped: 妯″潡鏍￠獙鏈€氳繃銆?{checkMessage}${blockingFields.length ? ` blockingFields=${blockingFields.join(", ")}` : ""}`
      );
    }
    stages.push({ step: "run_publish_check", status: "completed" });

    if (!stopBeforePublish) {
      const publishResult = await clickPublishProductOnPage(page, runtimeDir, "publish-page-published.png");
      screenshotFiles.push(publishResult.screenshotFile);
      publishClicked = publishResult.publishClicked;
      publishIssue = publishResult.publishIssue;
      if (!publishClicked || publishIssue) {
        stages.push({ step: "click_publish_product", status: "failed" });
        throw new Error(`Sequential publish flow stopped: 最终发布动作未完成。${publishIssue}`);
      }
      stages.push({ step: "click_publish_product", status: "completed" });
    } else {
      const stopScreenshot = await savePageScreenshot(page, runtimeDir, "publish-page-ready-before-submit.png");
      screenshotFiles.push(stopScreenshot);
      stages.push({ step: "ready_before_publish", status: "completed" });
    }

    const inspectResult = await inspectPublishPageOnPage(page, runtimeDir, "publish-page-inspect.png");
    screenshotFiles.push(inspectResult.screenshotFile);
    stages.push({ step: "inspect_publish_page", status: "completed" });

    return {
      pageUrl: inspectResult.pageUrl,
      pageTitle: inspectResult.pageTitle,
      screenshotFiles,
      createPageUrl,
      matchedRowText,
      filledFields,
      configuredFields,
      uploadedGroups,
      uploadIssue,
      specTypeOptions,
      specIssue,
      filledPriceRows,
      priceIssue,
      checkPassed,
      checkMessage,
      checkHints,
      blockingFields,
      publishClicked,
      publishIssue,
      freightTemplateName,
      sections: inspectResult.sections,
      topActions: inspectResult.topActions,
      errorHints: inspectResult.errorHints,
      stages
    };
  } finally {
    await context.browser()?.close().catch(() => {});
  }
}

async function runGraphicFlow(
  runtimeDir: string,
  metadata: { brand: string; spu: string; title?: string; shortTitle?: string; modelSpec?: string },
  assets: ProductAssets,
  shopFolder: string,
  publishPageUrl?: string
): Promise<{
  pageUrl: string;
  pageTitle: string;
  screenshotFiles: string[];
  createPageUrl: string;
  matchedRowText?: string;
  filledFields: string[];
  uploadedGroups: string[];
  uploadIssue: string;
  sections: string[];
  topActions: string[];
  errorHints: string[];
  stages: PublishFlowStage[];
}> {
  const screenshotFiles: string[] = [];
  const stages: PublishFlowStage[] = [];
  const filledFields: string[] = [];
  let uploadedGroups: string[] = [];
  let uploadIssue = "";

  let createPageUrl = publishPageUrl || "";
  let matchedRowText = "";

  if (!createPageUrl) {
    const queryResult = await queryPlatformSpu(runtimeDir, metadata.brand, metadata.spu, shopFolder);
    screenshotFiles.push(queryResult.screenshotFile);
    createPageUrl = queryResult.createPageUrl;
    matchedRowText = queryResult.matchedRowText;
    stages.push({ step: "query_platform_spu", status: "completed" });
  }

  const context = await launchPersistentBrowser();
  try {
    const existingCreatePage = context.pages().find((item) => !item.isClosed() && item.url().includes("/ffa/g/create"));
    const page = existingCreatePage || context.pages().find((item) => !item.isClosed()) || (await context.newPage());
    attachSafeDialogHandler(page);
    await page.bringToFront();
    await ensureShopContext(page, runtimeDir, shopFolder);
    let basicInfoCompleted = false;
    for (let basicAttempt = 0; basicAttempt < 2; basicAttempt += 1) {
      await gotoWithTolerance(page, createPageUrl, 3500);

      try {
        await verifyCategoryRegistrationGateOnPage(
          page,
          runtimeDir,
          metadata.spu,
          "publish-page-category-registration-mismatch.png"
        );
        if (metadata.title || metadata.shortTitle || metadata.modelSpec) {
          const fillResult = await fillBasicPublishPageOnPage(
            page,
            runtimeDir,
            {
              title: metadata.title,
              shortTitle: metadata.shortTitle,
              modelSpec: metadata.modelSpec,
              spu: metadata.spu
            },
            "publish-page-basic-filled.png"
          );
          screenshotFiles.push(fillResult.screenshotFile);
          filledFields.length = 0;
          filledFields.push(...fillResult.filledFields);
          const missingBasicFields = [
            metadata.title ? "title" : "",
            metadata.shortTitle ? "shortTitle" : "",
            metadata.modelSpec ? "modelSpec" : ""
          ]
            .filter(Boolean)
            .filter((field) => !filledFields.includes(field));
          if (missingBasicFields.length) {
            throw new Error(`基础信息模块缺失字段: ${missingBasicFields.join(", ")}`);
          }
        }
        stages.push({ step: "fill_basic_publish_page", status: "completed" });
        basicInfoCompleted = true;
        break;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const categoryMismatch = message.includes("Category registration mismatch before modelSpec fill.");
        if (categoryMismatch && basicAttempt === 0) {
          const retryQueryResult = await queryPlatformSpu(runtimeDir, metadata.brand, metadata.spu, shopFolder);
          screenshotFiles.push(retryQueryResult.screenshotFile);
          createPageUrl = retryQueryResult.createPageUrl;
          matchedRowText = retryQueryResult.matchedRowText;
          continue;
        }
        stages.push({ step: "fill_basic_publish_page", status: "failed" });
        throw new Error(`Graphic flow stopped: 基础信息模块未完成。${message}`);
      }
    }
    if (!basicInfoCompleted) {
      stages.push({ step: "fill_basic_publish_page", status: "failed" });
      throw new Error("Graphic flow stopped: 基础信息模块未完成。");
    }

    const imageResult = await uploadProductImagesOnPage(page, runtimeDir, assets, "publish-page-images-uploaded.png");
    screenshotFiles.push(imageResult.screenshotFile);
    uploadedGroups = imageResult.uploadedGroups;
    uploadIssue = imageResult.uploadIssue;
    if (
      uploadIssue ||
      !uploadedGroups.includes("mainImages") ||
      !uploadedGroups.some((item) => item === "detailImages" || item === "detailImages:fillFromMainThenUpload")
    ) {
      stages.push({ step: "upload_product_images", status: "failed" });
      throw new Error(`Graphic flow stopped: 图文信息模块未完成。${uploadIssue || "Main/detail image groups were not both uploaded successfully."}`);
    }
    stages.push({ step: "upload_product_images", status: "completed" });

    const inspectResult = await inspectPublishPageOnPage(page, runtimeDir, "publish-page-graphic-flow-inspect.png");
    screenshotFiles.push(inspectResult.screenshotFile);
    stages.push({ step: "inspect_publish_page", status: "completed" });

    return {
      pageUrl: inspectResult.pageUrl,
      pageTitle: inspectResult.pageTitle,
      screenshotFiles,
      createPageUrl,
      matchedRowText,
      filledFields,
      uploadedGroups,
      uploadIssue,
      sections: inspectResult.sections,
      topActions: inspectResult.topActions,
      errorHints: inspectResult.errorHints,
      stages
    };
  } finally {
    await context.browser()?.close().catch(() => {});
  }
}

export async function runPublishFromSpuJob(
  input: PublishFromSpuJobInput,
  options: PublishFromSpuJobOptions = {}
): Promise<PublishFromSpuJobResult> {
  const startedAt = new Date().toISOString();
  const runId = options.runId || `publish-from-spu-${Date.now()}`;
  const runtimeDir = path.resolve(options.runtimeDir || path.join(process.cwd(), "data", "publish-from-spu", runId));
  const resultFile = path.resolve(options.resultFile || path.join(runtimeDir, "result.json"));
  const screenshots: string[] = [];

  try {
    const mode = input.mode || "prepare";
    const shopFolder = path.resolve(input.shopFolder);
    const productFolder = path.resolve(input.productFolder);
    const requiresLocalProductFiles = mode !== "run_service_flow";

    if (requiresLocalProductFiles && !fs.existsSync(shopFolder)) {
      throw new Error(`Shop folder not found: ${shopFolder}`);
    }
    if (requiresLocalProductFiles && !fs.existsSync(productFolder)) {
      throw new Error(`Product folder not found: ${productFolder}`);
    }

      const assets = requiresLocalProductFiles
        ? classifyAssets(productFolder)
        : {
            workbookFile: undefined,
            mainImages: [],
            detailImages: [],
            otherFiles: []
          };
      if (requiresLocalProductFiles) {
        assertProductAssetsForShop(assets, shopFolder, productFolder);
      }
      const workbook = requiresLocalProductFiles
        ? await summarizeWorkbook(assets.workbookFile)
        : { rows: [], parseError: "" };
    const metadataOverride = input.metadata || {};
      const resolvedMetadata = {
        brand: metadataOverride.brand || workbook.brand || "",
        spu: metadataOverride.spu || workbook.spu || "",
        title: metadataOverride.title || workbook.title || "",
        shortTitle: metadataOverride.shortTitle || workbook.shortTitle || "",
        modelSpec: metadataOverride.modelSpec || workbook.modelSpec || "\u76D2\u88C5"
      };
      if (mode !== "open_platform_spu") {
        assertResolvedMetadata(resolvedMetadata, mode);
      }

      let browserData:
      | {
          pageUrl: string;
          pageTitle: string;
        }
      | undefined;

    if (mode === "open_platform_spu") {
      const browserReady = await ensurePlatformSpuPage(runtimeDir, shopFolder);
      screenshots.push(browserReady.screenshotFile);
      browserData = {
        pageUrl: browserReady.pageUrl,
        pageTitle: browserReady.pageTitle
      };
    } else if (mode === "query_platform_spu") {
      if (!resolvedMetadata.brand || !resolvedMetadata.spu) {
        throw new Error("query_platform_spu requires metadata.brand and metadata.spu.");
      }
      const queryResult = await queryPlatformSpu(runtimeDir, resolvedMetadata.brand, resolvedMetadata.spu, shopFolder);
      screenshots.push(queryResult.screenshotFile);
      browserData = {
        pageUrl: queryResult.pageUrl,
        pageTitle: queryResult.pageTitle,
        createPageUrl: queryResult.createPageUrl,
        matchedRowText: queryResult.matchedRowText
      } as typeof browserData & { createPageUrl: string; matchedRowText: string };
    } else if (mode === "inspect_publish_page") {
      const inspectResult = await inspectPublishPage(runtimeDir, input.publishPageUrl);
      screenshots.push(inspectResult.screenshotFile);
      browserData = {
        pageUrl: inspectResult.pageUrl,
        pageTitle: inspectResult.pageTitle,
        sections: inspectResult.sections,
        topActions: inspectResult.topActions,
        errorHints: inspectResult.errorHints
      } as typeof browserData & { sections: string[]; topActions: string[]; errorHints: string[] };
    } else if (mode === "run_graphic_flow") {
      if (!input.publishPageUrl && (!resolvedMetadata.brand || !resolvedMetadata.spu)) {
        throw new Error("run_graphic_flow requires input.publishPageUrl or metadata.brand and metadata.spu.");
      }
      const flowResult = await runGraphicFlow(
        runtimeDir,
        {
          brand: resolvedMetadata.brand,
          spu: resolvedMetadata.spu,
          title: resolvedMetadata.title,
          shortTitle: resolvedMetadata.shortTitle,
          modelSpec: resolvedMetadata.modelSpec
        },
        assets,
        shopFolder,
        input.publishPageUrl
      );
      screenshots.push(...flowResult.screenshotFiles);
      browserData = {
        pageUrl: flowResult.pageUrl,
        pageTitle: flowResult.pageTitle,
        createPageUrl: flowResult.createPageUrl,
        matchedRowText: flowResult.matchedRowText,
        filledFields: flowResult.filledFields,
        uploadedGroups: flowResult.uploadedGroups,
        uploadIssue: flowResult.uploadIssue,
        sections: flowResult.sections,
        topActions: flowResult.topActions,
        errorHints: flowResult.errorHints,
        stages: flowResult.stages
      } as typeof browserData & {
        createPageUrl: string;
        matchedRowText: string;
        filledFields: string[];
        uploadedGroups: string[];
        uploadIssue: string;
        sections: string[];
        topActions: string[];
        errorHints: string[];
        stages: PublishFlowStage[];
      };
    } else if (mode === "run_pre_publish_flow") {
      if (!input.publishPageUrl && (!resolvedMetadata.brand || !resolvedMetadata.spu)) {
        throw new Error("run_pre_publish_flow requires input.publishPageUrl or metadata.brand and metadata.spu.");
      }
      const flowResult = await runPublishFlow(
        runtimeDir,
        {
          brand: resolvedMetadata.brand,
          spu: resolvedMetadata.spu,
          title: resolvedMetadata.title,
          shortTitle: resolvedMetadata.shortTitle,
          modelSpec: resolvedMetadata.modelSpec
        },
        assets,
        shopFolder,
        input.publishPageUrl,
        true
      );
      screenshots.push(...flowResult.screenshotFiles);
      browserData = {
        pageUrl: flowResult.pageUrl,
        pageTitle: flowResult.pageTitle,
        createPageUrl: flowResult.createPageUrl,
        matchedRowText: flowResult.matchedRowText,
        filledFields: flowResult.filledFields,
        configuredFields: flowResult.configuredFields,
        uploadedGroups: flowResult.uploadedGroups,
        uploadIssue: flowResult.uploadIssue,
        specTypeOptions: flowResult.specTypeOptions,
        specIssue: flowResult.specIssue,
        filledPriceRows: flowResult.filledPriceRows,
        priceIssue: flowResult.priceIssue,
        checkPassed: flowResult.checkPassed,
        checkMessage: flowResult.checkMessage,
        checkHints: flowResult.checkHints,
        blockingFields: flowResult.blockingFields,
        publishClicked: flowResult.publishClicked,
        publishIssue: flowResult.publishIssue,
        freightTemplateName: flowResult.freightTemplateName,
        sections: flowResult.sections,
        topActions: flowResult.topActions,
        errorHints: flowResult.errorHints,
        stages: flowResult.stages
      } as typeof browserData & {
        createPageUrl: string;
        matchedRowText: string;
        filledFields: string[];
        configuredFields: string[];
        uploadedGroups: string[];
        uploadIssue: string;
        specTypeOptions: string[];
        specIssue: string;
        filledPriceRows: number;
        priceIssue: string;
        checkPassed: boolean;
        checkMessage: string;
        checkHints: string[];
        blockingFields: string[];
        publishClicked: boolean;
        publishIssue: string;
        freightTemplateName: string;
        sections: string[];
        topActions: string[];
        errorHints: string[];
        stages: PublishFlowStage[];
      };
    } else if (mode === "run_service_flow") {
      if (!input.publishPageUrl) {
        throw new Error("run_service_flow requires input.publishPageUrl.");
      }
      let servicePublishPageUrl = input.publishPageUrl;
      let settingsResult;
      try {
        settingsResult = await applyFixedPublishSettings(runtimeDir, servicePublishPageUrl, resolvedMetadata.spu);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const categoryMismatch = message.includes("Category registration mismatch before modelSpec fill.");
        if (!categoryMismatch || !resolvedMetadata.brand || !resolvedMetadata.spu) {
          throw error;
        }
        const queryResult = await queryPlatformSpu(runtimeDir, resolvedMetadata.brand, resolvedMetadata.spu, shopFolder);
        screenshots.push(queryResult.screenshotFile);
        servicePublishPageUrl = queryResult.createPageUrl;
        settingsResult = await applyFixedPublishSettings(runtimeDir, servicePublishPageUrl, resolvedMetadata.spu);
        browserData = {
          pageUrl: queryResult.pageUrl,
          pageTitle: queryResult.pageTitle,
          createPageUrl: queryResult.createPageUrl,
          matchedRowText: queryResult.matchedRowText
        } as typeof browserData & { createPageUrl: string; matchedRowText: string };
      }
      screenshots.push(settingsResult.screenshotFile);
      browserData = {
        ...(browserData || {}),
        pageUrl: settingsResult.pageUrl,
        pageTitle: settingsResult.pageTitle,
        configuredFields: settingsResult.configuredFields,
        freightTemplateName: settingsResult.freightTemplateName
      } as typeof browserData & {
        configuredFields: string[];
        freightTemplateName: string;
      };
    } else if (mode === "run_publish_flow") {
      if (!input.publishPageUrl && (!resolvedMetadata.brand || !resolvedMetadata.spu)) {
        throw new Error("run_publish_flow requires input.publishPageUrl or metadata.brand and metadata.spu.");
      }
      const flowResult = await runPublishFlow(
        runtimeDir,
        {
          brand: resolvedMetadata.brand,
          spu: resolvedMetadata.spu,
          title: resolvedMetadata.title,
          shortTitle: resolvedMetadata.shortTitle,
          modelSpec: resolvedMetadata.modelSpec
        },
        assets,
        shopFolder,
        input.publishPageUrl
      );
      screenshots.push(...flowResult.screenshotFiles);
      browserData = {
        pageUrl: flowResult.pageUrl,
        pageTitle: flowResult.pageTitle,
        createPageUrl: flowResult.createPageUrl,
        matchedRowText: flowResult.matchedRowText,
        filledFields: flowResult.filledFields,
        configuredFields: flowResult.configuredFields,
        uploadedGroups: flowResult.uploadedGroups,
        uploadIssue: flowResult.uploadIssue,
        specTypeOptions: flowResult.specTypeOptions,
        specIssue: flowResult.specIssue,
        filledPriceRows: flowResult.filledPriceRows,
        priceIssue: flowResult.priceIssue,
        checkPassed: flowResult.checkPassed,
        checkMessage: flowResult.checkMessage,
        checkHints: flowResult.checkHints,
        blockingFields: flowResult.blockingFields,
        publishClicked: flowResult.publishClicked,
        publishIssue: flowResult.publishIssue,
        freightTemplateName: flowResult.freightTemplateName,
        sections: flowResult.sections,
        topActions: flowResult.topActions,
        errorHints: flowResult.errorHints,
        stages: flowResult.stages
      } as typeof browserData & {
        createPageUrl: string;
        matchedRowText: string;
        filledFields: string[];
        configuredFields: string[];
        uploadedGroups: string[];
        uploadIssue: string;
        specTypeOptions: string[];
        specIssue: string;
        filledPriceRows: number;
        priceIssue: string;
        checkPassed: boolean;
        checkMessage: string;
        checkHints: string[];
        blockingFields: string[];
        publishClicked: boolean;
        publishIssue: string;
        freightTemplateName: string;
        sections: string[];
        topActions: string[];
        errorHints: string[];
        stages: PublishFlowStage[];
      };
    }

    return {
      ok: true,
      status:
        mode === "open_platform_spu"
          ? "browser_ready"
          : mode === "query_platform_spu"
            ? "publish_page_opened"
              : mode === "inspect_publish_page"
                ? "publish_page_ready"
                : mode === "run_graphic_flow"
                  ? "graphic_module_ready"
                  : mode === "run_pre_publish_flow"
                    ? "ready_before_publish"
                    : mode === "run_service_flow"
                      ? "service_module_ready"
                : mode === "run_publish_flow"
                  ? "publish_page_ready"
            : "prepared",
      message:
        mode === "open_platform_spu"
          ? "Product folder normalized and platform SPU entry page opened in reusable Chrome."
          : mode === "query_platform_spu"
            ? "Platform SPU queried and publish page opened."
            : mode === "inspect_publish_page"
              ? "Publish page inspected and summarized."
              : mode === "run_graphic_flow"
                ? "Basic info and graphic info completed, then stopped."
                : mode === "run_pre_publish_flow"
                  ? "All modules completed and verified; stopped before publish."
                  : mode === "run_service_flow"
                    ? "Service settings applied and verified on the publish page."
              : mode === "run_publish_flow"
                ? "Publish flow prepared, queried, and inspected in one task."
            : "Product folder normalized. Browser publish handler can consume this plan directly.",
      startedAt,
      finishedAt: new Date().toISOString(),
      runtimeDir,
      artifacts: {
        resultFile,
        screenshots
      },
      data: {
        mode,
        shopFolder,
        productFolder,
        metadata: resolvedMetadata,
        metadataSources: {
          overrideProvided: Boolean(
            metadataOverride.brand ||
              metadataOverride.spu ||
              metadataOverride.title ||
              metadataOverride.shortTitle ||
              metadataOverride.modelSpec
          ),
          workbookParsed: !workbook.parseError
        },
        workbook: {
          parsed: !workbook.parseError,
          parseError: workbook.parseError || "",
          rowCount: workbook.rows.length
        },
        assets: {
          workbookFile: assets.workbookFile || "",
          mainImages: assets.mainImages,
          detailImages: assets.detailImages,
          otherFiles: assets.otherFiles
        },
        fixedConfig: {
          platformSpuQueryRule: PLATFORM_SPU_QUERY_RULE,
          modelSpec: resolvedMetadata.modelSpec,
          publishFlowRule:
            "\u4e25\u683c\u6309\u7167\u6a21\u5757\u987a\u5e8f\u6267\u884c\uff1a\u5148\u5b8c\u5584\u57fa\u7840\u4fe1\u606f\uff0c\u518d\u5b8c\u5584\u56fe\u6587\u4fe1\u606f\uff0c\u518d\u5b8c\u5584\u4ef7\u683c\u5e93\u5b58\uff0c\u518d\u5b8c\u5584\u670d\u52a1\u4e0e\u5c65\u7ea6\uff0c\u6700\u540e\u624d\u5141\u8bb8\u70b9\u51fb\u201c\u53d1\u5e03\u5546\u54c1\u201d\uff1b\u4efb\u4f55\u4e00\u4e2a\u6a21\u5757\u5931\u8d25\u6216\u62a5\u9519\u90fd\u5fc5\u987b\u5148\u505c\u6b62\u3001\u68c0\u67e5\u3001\u4fee\u590d\uff0c\u4fee\u590d\u6210\u529f\u540e\u624d\u80fd\u7ee7\u7eed\u4e0b\u4e00\u6b65",
          categoryAttributeRule:
            "\u7c7b\u76ee\u5c5e\u6027\u6a21\u5757\u91cc\u53ea\u5141\u8bb8\u586b\u5199\u201c\u578b\u53f7\u89c4\u683c=\u76d2\u88c5\u201d\uff0c\u5176\u4f59\u4efb\u4f55\u5b57\u6bb5\u90fd\u4e0d\u80fd\u6539\u52a8\uff1b\u4e00\u65e6\u89e6\u78b0\u5230\u5176\u4ed6\u7c7b\u76ee\u5c5e\u6027\uff0c\u5fc5\u987b\u7acb\u5373\u5237\u65b0\u9875\u9762\u5e76\u4ece\u6807\u9898\u586b\u5199\u5f00\u59cb\u91cd\u505a",
          mainImageRule:
            "\u56fe\u6587\u4fe1\u606f\u53ea\u5728\u201c\u4e3b\u56fe\u201d\u6a21\u5757\u4e0a\u4f20\uff1b\u9996\u4f4d\u4e3b\u56fe\u5fc5\u987b\u4f7f\u7528 Dreamina CLI \u751f\u6210\u4e14\u5df2\u6253\u5e97\u94fa\u6c34\u5370\u7684 1:1 \u56fe\u7247\uff0c\u518d\u6309\u56fa\u5b9a\u987a\u5e8f\u642d\u914d input/fixed-main-images/\u4e0b\u7684\u8f85\u52a9\u56fe02-05\uff1b\u4e3b\u56fe\u4e0a\u4f20\u540e\uff0c\u5728\u201c\u4e3b\u56fe3:4\u201d\u6a21\u5757\u70b9\u51fb\u201c\u4ece1:1\u4e3b\u56fe\u667a\u80fd\u88c1\u526a\u201d\u76f4\u63a5\u751f\u6210\uff1b\u201c\u767d\u5e95\u56fe\u201d\u6a21\u5757\u4e0d\u4e3b\u52a8\u4e0a\u4f20\uff0c\u82e5\u5e73\u53f0\u81ea\u52a8\u586b\u5145\u5219\u4e0d\u5e72\u9884\uff1b\u8be6\u60c5\u9875\u5fc5\u987b\u5148\u70b9\u51fb\u201c\u4ece\u4e3b\u56fe\u586b\u5165\u201d\uff0c\u518d\u4e0a\u4f20\u4ea7\u54c1\u6587\u4ef6\u5939\u91cc\u7684\u8d44\u8d28\u56fe\u7247\u4f5c\u4e3a\u8be6\u60c5\u9875\u56fe\u7247",
          shippingMode: "\u73B0\u8D27\u53D1\u8D27\u6A21\u5F0F",
          shippingTime: "48\u5C0F\u65F6",
          freightTemplateRule: "\u9009\u62e9\u540d\u79f0\u5305\u542b\u201c\u5ef6\u8349\u8fd0\u8d39\u201d\u7684\u8fd0\u8d39\u6a21\u677f",
          productStatus: "\u4E0A\u67B6",
          specTemplateRule: "\u6807\u9898\u542b\u201c\u4e45\u5149\u5c0f\u6cfd\u201d\u5219\u9009\u62e9\u540d\u79f0\u5305\u542b\u201c\u4e45\u5149\u5c0f\u6cfd\u201d\u7684\u89c4\u683c\u6a21\u677f\uff0c\u5426\u5219\u9009\u62e9\u540d\u79f0\u5305\u542b\u201c\u4e70\u4e8c\u9001\u4e00\u201d\u7684\u89c4\u683c\u6a21\u677f",
          specModuleRule:
            "\u5546\u54c1\u89c4\u683c\u5b50\u6a21\u5757\u91cc\u7684\u89c4\u683c\u540d\u548c\u89c4\u683c\u503c\u4e0d\u5141\u8bb8\u7f16\u8f91\uff0c\u5b8c\u5168\u4f9d\u8d56\u89c4\u683c\u6a21\u677f\u7684\u8bbe\u7f6e\uff1b\u5982\u679c\u5546\u54c1\u89c4\u683c\u6a21\u5757\u62a5\u9519\u6216\u51fa\u73b0\u7ea2\u5b57\u63d0\u9192\uff0c\u5fc5\u987b\u5237\u65b0\u5f53\u524d\u53d1\u5e03\u9875\uff0c\u4ece\u57fa\u7840\u4fe1\u606f\u5f00\u59cb\u6309\u987a\u5e8f\u91cd\u65b0\u6267\u884c",
          specName: FIXED_SPEC_NAME,
          specValues: FIXED_SPEC_VALUES,
          priceRows: FIXED_PRICES,
          stockRows: [FIXED_STOCK, FIXED_STOCK, FIXED_STOCK, FIXED_STOCK]
        },
        executionRules: {
          unitOfWork: "single_product_folder",
          serialOnly: true,
          moduleOrder: ["basic_info", "graphic_info", "price_inventory", "service_commitment", "publish_product"],
          stopImmediatelyOnModuleFailure: true,
          doNotProceedToNextModuleUntilCurrentModuleIsVerified: true,
          doNotOpenMultipleProductFolders: true,
          doNotChangeFixedConfigWithoutInstruction: true,
          doNotInventPlatformSpuBrandOrSpuQueryValue: true,
          doNotTouchOtherCategoryAttributes: true
        },
        browser: {
          headless: input.headless ?? false,
          retryOnSystemError: input.retryOnSystemError ?? true,
          platformSpuUrl: PLATFORM_SPU_URL,
          ...browserData
        }
      }
    };
  } catch (error) {
    const diagnosticError = error as QueryDiagnosticError;
    if (diagnosticError.screenshotFile) {
      screenshots.push(diagnosticError.screenshotFile);
    }
    return {
      ok: false,
      status: "failed",
      message: error instanceof Error ? error.message : String(error),
      startedAt,
      finishedAt: new Date().toISOString(),
      runtimeDir,
      artifacts: {
        resultFile,
        screenshots
      },
      data: diagnosticError.candidateRows
        ? {
            queryDiagnostics: {
              candidateRows: diagnosticError.candidateRows,
              candidateIds: diagnosticError.candidateIds || []
            }
          }
        : undefined,
      error: {
        code: "TASK_FAILED",
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      }
    };
  }
}
