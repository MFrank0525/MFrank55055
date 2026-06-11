import fs from "node:fs";
import path from "node:path";
import type { Locator, Page } from "playwright";
import { launchPersistentBrowser } from "../browser/launch.js";
import { getSelectAllShortcut } from "../utils/platform.js";
import { logInfo, logWarn } from "../utils/logger.js";
import { classifyAssets, validateMainImageAspectRatio } from "./publish-from-spu/assets.js";
import {
  FIXED_FREIGHT_TEMPLATE_KEYWORD,
  FIXED_PRICES,
  FIXED_SPEC_VALUES,
  FIXED_STOCK,
  FORBIDDEN_GRAPHIC_SECTION_LABELS,
  GRAPHIC_SECTION_LABELS,
  PLATFORM_SPU_URL,
  SPEC_TEMPLATE_KEYWORD_DEFAULT,
  SPEC_TEMPLATE_KEYWORD_JIUGUANG
} from "./publish-from-spu/constants.js";
import { readPublishRuleSummary } from "./publish-from-spu/publish-rule-text.js";
import type {
  PublishActionResult,
  ProductAssets,
  PublishFlowStage,
  PublishFromSpuJobInput,
  PublishFromSpuJobOptions,
  PublishFromSpuJobResult,
  QueryDiagnosticError,
  QueryMatchCandidate
} from "./publish-from-spu/types.js";
import { summarizeWorkbook } from "./publish-from-spu/workbook.js";
import {
  evaluateBasicPrefillReadiness,
  evaluateShopSwitchMenuState,
  evaluateDetailImageCompletion,
  evaluateDetailUploadOutcome,
  evaluateForbiddenGraphicSections,
  evaluateMedicalDeviceCertificateUploadRule,
  evaluatePriceInventoryEntryRule,
  evaluatePriceInventoryCompletion,
  evaluatePublishCheckResult,
  evaluatePublishCreatePageReadiness,
  evaluatePlatformSpuQueryPageReadiness,
  evaluatePublishSubmission,
  evaluatePublishSubmissionAfterAction,
  evaluateServiceFulfillmentCompletion,
  evaluateSpecTemplateCompletion,
  isDoudianLoginPageText,
  isUploadPlaceholderGraphicContext,
  resolvePriceInventoryRowInputRoles
} from "./publish-from-spu/publish-rules.js";
import type { ServiceFulfillmentState } from "./publish-from-spu/publish-rules.js";
import { makePublishActionResult } from "./publish-from-spu/publish-actions.js";

export type { PublishFromSpuJobInput, PublishFromSpuJobOptions, PublishFromSpuJobResult } from "./publish-from-spu/types.js";

class PublishCreatePageReopenRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublishCreatePageReopenRequiredError";
  }
}

function normalizeMatchText(value: string): string {
  return value.replace(/\s+/g, "").trim().toLowerCase();
}

function normalizeSpuMatchText(value: string): string {
  return normalizeMatchText(value).replace(/械[住注]准/g, "械注准");
}

function isNavigationContextDestroyedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Execution context was destroyed|Cannot find context|Most likely because of a navigation/i.test(message);
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

function writePublishJobResult(result: PublishFromSpuJobResult): PublishFromSpuJobResult {
  const resultFile = result.artifacts.resultFile || path.join(result.runtimeDir, "result.json");
  fs.mkdirSync(path.dirname(resultFile), { recursive: true });
  fs.writeFileSync(resultFile, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  return result;
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

async function closeCreatePagesExcept(
  context: Awaited<ReturnType<typeof launchPersistentBrowser>>,
  keepPages: Page[] = []
): Promise<void> {
  const keep = new Set(keepPages.filter((page) => !page.isClosed()));
  for (const page of context.pages()) {
    if (keep.has(page) || page.isClosed()) {
      continue;
    }
    if (page.url().includes("/ffa/g/create")) {
      await page.close().catch(() => {});
    }
  }
}

function findOpenCreatePage(
  context: Awaited<ReturnType<typeof launchPersistentBrowser>>,
  createPageUrl: string
): Page | null {
  return (
    context.pages().find((page) => !page.isClosed() && page.url() === createPageUrl) ||
    null
  );
}

async function reuseOrOpenCreatePage(
  context: Awaited<ReturnType<typeof launchPersistentBrowser>>,
  createPageUrl: string,
  currentPage?: Page
): Promise<Page> {
  const existingPage = findOpenCreatePage(context, createPageUrl);
  const page =
    existingPage ||
    (currentPage && !currentPage.isClosed() ? currentPage : await context.newPage());
  attachSafeDialogHandler(page);
  await closeCreatePagesExcept(context, [page]);
  await closeExtraPages(context, [page]);
  await page.bringToFront();
  if (page.url() !== createPageUrl) {
    await gotoWithTolerance(page, createPageUrl, 3500);
  }
  return page;
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
    await ensurePlatformSpuQueryPageActive(page, runtimeDir, "platform-spu-entry", 30000);
    if (shopFolder) {
      await ensureShopContext(page, runtimeDir, shopFolder);
      await ensurePlatformSpuQueryPageActive(page, runtimeDir, "platform-spu-entry-after-shop-switch", 45000);
    }

    const screenshotFile = await savePageScreenshot(page, runtimeDir, "platform-spu-entry.png");

    return {
      pageUrl: page.url(),
      pageTitle: await page.title(),
      screenshotFile
    };
  } finally {
    // Keep the shared persistent browser alive. Sequential publish flow may call
    // this helper while another publish page is active in the same profile.
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

async function isDoudianLoginRequired(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    return document.body.innerText || "";
  }).then((text) => isDoudianLoginPageText(text));
}

async function clickTopRightShopMenu(page: Page): Promise<boolean> {
  const menuVisible = async (): Promise<boolean> =>
    page.evaluate(() => {
      const normalize = (value: string): string => value.replace(/\s+/g, "").trim();
      const bodyText = normalize(document.body.innerText || "");
      if (bodyText.includes("切换组织/店铺") || bodyText.includes("退出")) {
        return true;
      }
      return Array.from(document.querySelectorAll("body *"))
        .map((node) => node as HTMLElement)
        .some((el) => {
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          const text = normalize(el.innerText || el.textContent || "");
          return (
            Boolean(text) &&
            (text.includes("切换组织/店铺") || text.includes("退出")) &&
            rect.width > 0 &&
            rect.height > 0 &&
            style.display !== "none" &&
            style.visibility !== "hidden"
          );
        });
    });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const headerShopMenu = page
      .locator(".headerShopName, [class*='headerShopName'], [class*='userName']")
      .filter({ hasText: /店/ })
      .first();
    const locatorClicked = await headerShopMenu.click({ timeout: 3000 }).then(() => true).catch(() => false);
    await page.waitForTimeout(700 + attempt * 250);
    if (locatorClicked && await menuVisible()) {
      return true;
    }

    const clicked = await page.evaluate(() => {
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
          return { el, score };
        })
        .filter(Boolean)
        .sort((a, b) => (b?.score || 0) - (a?.score || 0));
      const target = candidates[0]?.el;
      if (!target) {
        return false;
      }
      target.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, view: window, pointerId: 1, pointerType: "mouse", isPrimary: true }));
      target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
      target.click();
      target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
      target.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, view: window, pointerId: 1, pointerType: "mouse", isPrimary: true }));
      target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
      return true;
    });

    await page.waitForTimeout(700 + attempt * 250);
    if (clicked && await menuVisible()) {
      return true;
    }
  }
  return false;
}

async function waitForTopRightShopMenuAnchor(page: Page, timeoutMs = 12000): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const found = await page
      .evaluate(() => {
        const normalize = (value: string): string => value.replace(/\s+/g, "").trim();
        const bodyText = normalize(document.body?.innerText || "");
        if (bodyText.includes("切换组织/店铺") || bodyText.includes("退出")) {
          return true;
        }
        return Array.from(document.querySelectorAll("body *"))
          .map((node) => node as HTMLElement)
          .some((el) => {
            const rect = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);
            const text = normalize(el.innerText || el.textContent || "");
            return (
              Boolean(text) &&
              rect.width > 0 &&
              rect.height > 0 &&
              style.display !== "none" &&
              style.visibility !== "hidden" &&
              rect.top <= 180 &&
              rect.left >= window.innerWidth * 0.68 &&
              /(旗舰店|专营店|专卖店|店铺)/.test(text)
            );
          });
      })
      .catch(() => false);
    if (found) {
      return true;
    }
    await page.waitForTimeout(600);
  }
  return false;
}

async function clickVisibleActionText(page: Page, text: string): Promise<boolean> {
  const clicked = await page.evaluate((targetText) => {
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
        return el;
      })
      .filter(Boolean);
    const match = matches[0];
    if (!match) {
      return false;
    }
    match.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
    match.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
    match.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    return true;
  }, text);

  if (!clicked) {
    return false;
  }
  await page.waitForTimeout(800);
  return true;
}

async function isShopSwitchEntryVisible(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const normalize = (value: string): string => value.replace(/\s+/g, "").trim();
    const target = normalize("切换组织/店铺");
    return Array.from(document.querySelectorAll("body *"))
      .map((node) => node as HTMLElement)
      .some((el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        const text = normalize(el.innerText || el.textContent || "");
        return (
          Boolean(text) &&
          text.includes(target) &&
          rect.width >= 120 &&
          rect.height >= 20 &&
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          rect.left >= window.innerWidth * 0.68
        );
      });
  }).catch(() => false);
}

async function clickShopSwitchEntry(page: Page): Promise<boolean> {
  const switchEntries = page.getByText("切换组织/店铺", { exact: true });
  const switchEntryCount = await switchEntries.count().catch(() => 0);
  for (let index = switchEntryCount - 1; index >= 0; index -= 1) {
    const entry = switchEntries.nth(index);
    if (!(await entry.isVisible().catch(() => false))) {
      continue;
    }
    const clicked = await entry.click({ timeout: 3000 }).then(() => true).catch(() => false);
    if (clicked) {
      await page.waitForTimeout(900);
      return true;
    }
  }

  const clicked = await page.evaluate(() => {
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
        return { el, score };
      })
      .filter(Boolean)
      .sort((a, b) => (b?.score || 0) - (a?.score || 0));
    const item = items[0]?.el;
    if (!item) {
      return false;
    }
    item.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
    item.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
    item.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    return true;
  });

  if (!clicked) {
    return false;
  }
  await page.waitForTimeout(900);
  return true;
}

async function waitForChooseShopDialog(page: Page): Promise<boolean> {
  const dialogByLocator = page
    .locator("div[role='dialog'], div[aria-modal='true'], .semi-modal, .ant-modal, .ecom-g-modal, [class*='modal']")
    .filter({ hasText: "请选择店铺" })
    .first();
  const dialogVisibleByLocator = await dialogByLocator.isVisible().catch((error) => {
    if (isNavigationContextDestroyedError(error)) {
      return false;
    }
    return false;
  });
  if (dialogVisibleByLocator) {
    return true;
  }
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const visible = await page.evaluate(() => {
      const text = (document.body?.innerText || "").replace(/\s+/g, "");
      return text.includes("请选择店铺");
    }).catch((error) => {
      if (isNavigationContextDestroyedError(error)) {
        return false;
      }
      throw error;
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
      await card
        .evaluate((cardNode) => {
          const list = cardNode.closest(".index_roleList__2YMEN") as HTMLElement | null;
          if (list) {
            list.scrollTop = Math.max(0, (cardNode as HTMLElement).offsetTop - list.offsetTop - 24);
          }
          (cardNode as HTMLElement).scrollIntoView({ block: "center", inline: "nearest" });
        })
        .catch(() => {});
      await page.waitForTimeout(350);
      const domClicked = await card
        .locator(".index_introName__fRtLx")
        .first()
        .evaluate((nameNode) => {
          const cardNode = nameNode.closest(".index_roleItem__1-Hwe") as HTMLElement | null;
          const target =
            (cardNode?.querySelector(".index_rightArrowIcon__24nod") as HTMLElement | null) ||
            (cardNode?.querySelector("svg, [role='button'], button") as HTMLElement | null) ||
            cardNode;
          if (!target) {
            return false;
          }
          target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
          target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
          target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
          return true;
        })
        .catch((error) => {
          if (isNavigationContextDestroyedError(error)) {
            return true;
          }
          return false;
        });
      if (domClicked) {
        await page.waitForTimeout(1800);
        const dialogStillVisible = await waitForChooseShopDialog(page);
        if (!dialogStillVisible) {
          return true;
        }
      }
      const arrow = card.locator(".index_rightArrowIcon__24nod").first();
      const arrowClicked = await arrow
        .click({ timeout: 2000 })
        .then(() => true)
        .catch(() => false);
      if (!arrowClicked) {
        continue;
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

async function selectShopFromDialogByVisibleText(page: Page, expectedShopName: string): Promise<boolean> {
  const clicked = await page.evaluate((targetName) => {
    const normalize = (value: string): string => String(value || "").replace(/^\d+/, "").replace(/\s+/g, "").trim();
    const target = normalize(targetName);
    const isVisible = (el: HTMLElement): boolean => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    const modals = Array.from(document.querySelectorAll("body *"))
      .map((node) => node as HTMLElement)
      .filter((el) => {
        const rect = el.getBoundingClientRect();
        const text = normalize(el.innerText || el.textContent || "");
        return isVisible(el) && text.includes("请选择店铺") && rect.width > 300 && rect.height > 240;
      })
      .sort((a, b) => {
        const ar = a.getBoundingClientRect();
        const br = b.getBoundingClientRect();
        return Math.abs(ar.width - 640) - Math.abs(br.width - 640) || ar.height - br.height;
      });
    const modal = modals[0];
    if (!modal) {
      return null;
    }
    const modalRect = modal.getBoundingClientRect();
    const textNodes = Array.from(modal.querySelectorAll("*"))
      .map((node) => node as HTMLElement)
      .filter((el) => {
        if (!isVisible(el)) {
          return false;
        }
        const text = normalize(el.innerText || el.textContent || "");
        return text === target || (text.includes(target) && text.length <= target.length + 20);
      })
      .sort((a, b) => {
        const aText = normalize(a.innerText || a.textContent || "");
        const bText = normalize(b.innerText || b.textContent || "");
        const exactDelta = (aText === target ? 0 : 1) - (bText === target ? 0 : 1);
        if (exactDelta !== 0) {
          return exactDelta;
        }
        return aText.length - bText.length;
      });
    const nameNode = textNodes[0];
    if (!nameNode) {
      return null;
    }

    const scrollContainer =
      (Array.from(modal.querySelectorAll("*"))
        .map((node) => node as HTMLElement)
        .filter((el) => el.scrollHeight > el.clientHeight + 40 && el.clientHeight > 160)
        .sort((a, b) => b.clientHeight - a.clientHeight)[0] as HTMLElement | undefined) || modal;
    let card: HTMLElement = nameNode;
    for (let depth = 0; depth < 8; depth += 1) {
      const parent = card.parentElement as HTMLElement | null;
      if (!parent || parent === modal || parent === scrollContainer) {
        break;
      }
      const rect = parent.getBoundingClientRect();
      const text = normalize(parent.innerText || parent.textContent || "");
      if (text.includes(target) && rect.width >= 220 && rect.height >= 50 && rect.width <= modalRect.width + 8) {
        card = parent;
      }
    }

    // If the target card is near the bottom fade/edge, move it to the middle before clicking.
    const containerRect = scrollContainer.getBoundingClientRect();
    const cardOffsetTop = card.offsetTop;
    scrollContainer.scrollTop = Math.max(0, cardOffsetTop - scrollContainer.clientHeight / 2 + card.clientHeight / 2);
    card.scrollIntoView({ block: "center", inline: "nearest" });

    const cardRect = card.getBoundingClientRect();
    const clickTarget =
      (Array.from(card.querySelectorAll("svg, [role='button'], button"))
        .map((node) => node as HTMLElement)
        .filter((el) => isVisible(el))
        .sort((a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right)[0] as HTMLElement | undefined) ||
      card;
    const targetRect = clickTarget.getBoundingClientRect();
    if (targetRect.width <= 0 || targetRect.height <= 0 || cardRect.bottom < containerRect.top || cardRect.top > containerRect.bottom) {
      return false;
    }
    clickTarget.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
    clickTarget.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
    clickTarget.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    return true;
  }, expectedShopName).catch((error) => {
    if (isNavigationContextDestroyedError(error)) {
      return true;
    }
    return null;
  });
  if (!clicked) {
    return false;
  }
  await page.waitForTimeout(1800);
  return !(await waitForChooseShopDialog(page));
}

async function selectShopFromDialog(page: Page, expectedShopName: string): Promise<boolean> {
  const visibleTextMatched = await selectShopFromDialogByVisibleText(page, expectedShopName);
  if (visibleTextMatched) {
    return true;
  }
  const exactMatched = await selectShopFromDialogExact(page, expectedShopName);
  if (exactMatched) {
    return true;
  }
  await page
    .evaluate(() => {
      const normalize = (value: string): string => value.replace(/\s+/g, "").trim();
      const modal = Array.from(document.querySelectorAll("body *"))
        .map((node) => node as HTMLElement)
        .find((el) => {
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          const text = normalize(el.innerText || el.textContent || "");
          return (
            text.includes("\u8bf7\u9009\u62e9\u5e97\u94fa") &&
            rect.width > 300 &&
            rect.height > 240 &&
            style.display !== "none" &&
            style.visibility !== "hidden"
          );
        });
      if (!modal) {
        return false;
      }
      const scrollContainer =
        (Array.from(modal.querySelectorAll("*"))
          .map((node) => node as HTMLElement)
          .find((el) => el.scrollHeight > el.clientHeight + 40 && el.clientHeight > 180) as HTMLElement | undefined) ||
        modal;
      scrollContainer.scrollTop = 0;
      return true;
    })
    .catch(() => false);
  await page.waitForTimeout(500);
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
            card,
            text: cardText,
            score: exactScore
          };
        })
        .filter(Boolean)
        .sort((a, b) => (b?.score || 0) - (a?.score || 0));

      if (cards[0]) {
        const card = cards[0].card as HTMLElement;
        const targetNode =
          (Array.from(card.querySelectorAll("svg, [role='button'], button"))
            .map((node) => node as HTMLElement)
            .filter((el) => {
              const rect = el.getBoundingClientRect();
              const style = window.getComputedStyle(el);
              return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
            })
            .sort((a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right)[0] as HTMLElement | undefined) ||
          card;
        targetNode.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
        targetNode.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
        targetNode.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
        return {
          found: true,
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

    if (candidate.found) {
      await page.waitForTimeout(1800);
      const dialogStillVisible = await waitForChooseShopDialog(page);
      if (!dialogStillVisible) {
        return true;
      }
      await page.keyboard.press("Enter").catch(() => {});
      await page.waitForTimeout(1200);
      if (!(await waitForChooseShopDialog(page))) {
        return true;
      }
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
  if (await isDoudianLoginRequired(page)) {
    const screenshotFile = await savePageScreenshot(page, runtimeDir, "doudian-login-required.png").catch(() => "");
    throw new Error(
      `Doudian login required: open the automation browser and scan the QR code with the Doudian app before publishing ${expectedShopName}${screenshotFile ? `; screenshot=${screenshotFile}` : ""}`
    );
  }
  if (currentBefore && currentBefore.includes(expectedShopName)) {
    return currentBefore;
  }
  let lastActual = currentBefore || "";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const anchorReady = await waitForTopRightShopMenuAnchor(page, 10000 + attempt * 3000);
    if (!anchorReady) {
      await gotoWithTolerance(page, PLATFORM_SPU_URL, 5000 + attempt * 1500).catch(() => {});
      await waitForTopRightShopMenuAnchor(page, 8000 + attempt * 2000).catch(() => false);
    }
    const menuOpened = await clickTopRightShopMenu(page);
    if (!menuOpened) {
      if (await isDoudianLoginRequired(page)) {
        const screenshotFile = await savePageScreenshot(page, runtimeDir, "doudian-login-required.png").catch(() => "");
        throw new Error(
          `Doudian login required: open the automation browser and scan the QR code with the Doudian app before publishing ${expectedShopName}${screenshotFile ? `; screenshot=${screenshotFile}` : ""}`
        );
      }
      if (attempt < 2) {
        await gotoWithTolerance(page, PLATFORM_SPU_URL, 5500 + attempt * 1500).catch(() => {});
        await page.keyboard.press("Escape").catch(() => {});
        await page.waitForTimeout(1000);
        continue;
      }
      const screenshotFile = await savePageScreenshot(page, runtimeDir, "shop-switch-menu-missing.png").catch(() => "");
      throw new Error(`Shop switch failed: could not open top-right shop menu for ${expectedShopName}${screenshotFile ? `; screenshot=${screenshotFile}` : ""}`);
    }

    const currentFromMenuBeforeSwitch = normalizeShopName(await readCurrentShopNameFromMenu(page));
    const initialSwitchDecision = evaluateShopSwitchMenuState({
      expectedShopName,
      currentShopName: currentFromMenuBeforeSwitch || lastActual || currentBefore,
      menuOpened,
      switchEntryVisible: await isShopSwitchEntryVisible(page)
    });
    if (initialSwitchDecision.action === "already_in_target_shop") {
      await page.keyboard.press("Escape").catch(() => {});
      return currentFromMenuBeforeSwitch || expectedShopName;
    }
    if (initialSwitchDecision.action === "retry_menu" && attempt < 2) {
      await page.keyboard.press("Escape").catch(() => {});
      await gotoWithTolerance(page, PLATFORM_SPU_URL, 5500 + attempt * 1500).catch(() => {});
      await page.waitForTimeout(1000);
      continue;
    }

    let switcherClicked = false;
    if (initialSwitchDecision.action === "click_switch_entry") {
      switcherClicked = await clickShopSwitchEntry(page);
      if (!switcherClicked) {
        switcherClicked = await clickVisibleActionText(page, "切换组织/店铺");
      }
    }
    if (!switcherClicked) {
      const currentFromMenu = normalizeShopName(await readCurrentShopNameFromMenu(page));
      const finalSwitchDecision = evaluateShopSwitchMenuState({
        expectedShopName,
        currentShopName: currentFromMenu || lastActual || currentBefore,
        menuOpened: true,
        switchEntryVisible: false
      });
      if (finalSwitchDecision.action === "already_in_target_shop") {
        await page.keyboard.press("Escape").catch(() => {});
        return currentFromMenu || expectedShopName;
      }
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
    let currentAfter = "";
    for (let verifyAttempt = 0; verifyAttempt < 5; verifyAttempt += 1) {
      await page.waitForTimeout(1800 + attempt * 500);
      await clickTopRightShopMenu(page).catch(() => false);
      await page.waitForTimeout(600);
      const currentFromMenu = normalizeShopName(await readCurrentShopNameFromMenu(page));
      currentAfter = currentFromMenu || normalizeShopName(await detectCurrentShopName(page));
      if (currentAfter && currentAfter.includes(expectedShopName)) {
        await page.keyboard.press("Escape").catch(() => {});
        return currentAfter || expectedShopName;
      }
      await page.keyboard.press("Escape").catch(() => {});
    }
    lastActual = currentAfter || "";
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
  await focusDomElementAtPoint(page, point);
  await page.keyboard.press(getSelectAllShortcut()).catch(() => {});
  await page.keyboard.press("Backspace").catch(() => {});
  await page.keyboard.type(value, { delay: 40 });
}

async function dispatchDomClickAtPoint(page: Page, point: { x: number; y: number }): Promise<boolean> {
  return page.evaluate(({ x, y }) => {
    const target = document.elementFromPoint(x, y) as HTMLElement | null;
    if (!target) {
      return false;
    }
    const clickable =
      (target.closest("button, [role='button'], a, [role='option'], [role='menuitem'], [role='tab'], input, textarea, [contenteditable='true']") as HTMLElement | null) ||
      target;
    clickable.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
    clickable.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
    clickable.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    return true;
  }, point).catch(() => false);
}

async function focusDomElementAtPoint(page: Page, point: { x: number; y: number }): Promise<boolean> {
  return page.evaluate(({ x, y }) => {
    const target = document.elementFromPoint(x, y) as HTMLElement | null;
    const focusable =
      (target?.closest("input, textarea, [contenteditable='true'], [role='textbox'], [role='combobox']") as HTMLElement | null) ||
      target;
    if (!focusable) {
      return false;
    }
    focusable.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
    focusable.focus();
    focusable.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
    focusable.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    return true;
  }, point).catch(() => false);
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

  await dispatchDomClickAtPoint(page, option);
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

async function readPlatformSpuQueryPageSnapshot(page: Page): Promise<{
  url: string;
  bodyText: string;
  visibleInputCount: number;
  brandInputFound: boolean;
  spuInputFound: boolean;
  accountMenuOpen: boolean;
  loading: boolean;
}> {
  return page.evaluate(() => {
    const bodyText = document.body.innerText || "";
    const visibleInputs = Array.from(document.querySelectorAll("input, textarea"))
      .map((el) => el as HTMLInputElement | HTMLTextAreaElement)
      .filter((input) => {
        const rect = input.getBoundingClientRect();
        const style = window.getComputedStyle(input);
        return rect.width > 80 && rect.height > 20 && style.display !== "none" && style.visibility !== "hidden";
      })
      .map((input) => {
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
          type: input.getAttribute("type") || "",
          role: input.getAttribute("role") || "",
          context
        };
      });
    const brandInputFound = visibleInputs.some((input, index) => {
      if (/品牌|brand/i.test(input.context)) {
        return true;
      }
      return index <= 2 && (input.type === "search" || input.role === "combobox");
    });
    const spuInputFound = visibleInputs.some((input) => /SPU/i.test(input.context));
    const accountMenuOpen =
      bodyText.includes("切换组织/店铺") &&
      bodyText.includes("退出") &&
      bodyText.includes("店铺信息") &&
      bodyText.includes("登录账号");
    const loading = bodyText.includes("加载中") || bodyText.includes("Loading");
    return {
      url: window.location.href,
      bodyText,
      visibleInputCount: visibleInputs.length,
      brandInputFound,
      spuInputFound,
      accountMenuOpen,
      loading
    };
  });
}

async function waitForPlatformSpuQueryPageReady(page: Page, timeoutMs = 45000): Promise<{ ready: boolean; issue: string }> {
  const startedAt = Date.now();
  let lastIssue = "";
  while (Date.now() - startedAt < timeoutMs) {
    const decision = await readPlatformSpuQueryPageSnapshot(page)
      .then((snapshot) => evaluatePlatformSpuQueryPageReadiness(snapshot))
      .catch((error) => ({
        ready: false,
        issue: error instanceof Error ? error.message : String(error)
      }));
    lastIssue = decision.issue;
    if (decision.ready) {
      return decision;
    }
    await page.waitForTimeout(1000);
  }
  return { ready: false, issue: lastIssue || "Platform SPU query page did not become ready before timeout." };
}

async function ensurePlatformSpuQueryPageActive(
  page: Page,
  runtimeDir: string,
  label: string,
  timeoutMs = 45000
): Promise<void> {
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(300);
  await gotoWithTolerance(page, PLATFORM_SPU_URL, 3500).catch(() => {});
  await page.keyboard.press("Escape").catch(() => {});
  const decision = await waitForPlatformSpuQueryPageReady(page, timeoutMs);
  if (!decision.ready) {
    if (decision.issue === "Doudian login is required before publishing can continue.") {
      const error = new Error(
        `Doudian login required: open the automation browser and complete Doudian login before publishing can continue.`
      ) as QueryDiagnosticError;
      error.screenshotFile = await savePageScreenshot(page, runtimeDir, `${label}-doudian-login-required.png`);
      throw error;
    }
    const error = new Error(`Platform SPU query page was not ready after navigation: ${decision.issue}`) as QueryDiagnosticError;
    error.screenshotFile = await savePageScreenshot(page, runtimeDir, `${label}-platform-spu-query-page-not-ready.png`);
    throw error;
  }
}

export async function assertDoudianPublishSessionReady(options: {
  runtimeDir: string;
  timeoutMs?: number;
  label?: string;
}): Promise<void> {
  const context = await launchPersistentBrowser();
  const page =
    context.pages().find((item) => !item.isClosed() && item.url().includes("/ffa/g/spu-record")) ||
    context.pages().find((item) => !item.isClosed() && !item.url().includes("/ffa/g/create")) ||
    (await context.newPage());
  attachSafeDialogHandler(page);
  await closeCreatePagesExcept(context, [page]);
  await page.bringToFront();
  await ensurePlatformSpuQueryPageActive(
    page,
    options.runtimeDir,
    options.label || "doudian-publish-session-preflight",
    options.timeoutMs || 30000
  );
}

async function queryPlatformSpu(runtimeDir: string, brand: string, spu: string, shopFolder?: string, retryNo = 0): Promise<{
  pageUrl: string;
  pageTitle: string;
  screenshotFile: string;
  createPageUrl: string;
  matchedRowText: string;
}> {
  const context = await launchPersistentBrowser();
  try {
    const normalizedBrand = normalizeMatchText(brand);
    const normalizedSpu = normalizeSpuMatchText(spu);
    const page =
      context.pages().find((item) => !item.isClosed() && item.url().includes("/ffa/g/spu-record")) ||
      context.pages().find((item) => !item.isClosed() && !item.url().includes("/ffa/g/create")) ||
      (await context.newPage());
    attachSafeDialogHandler(page);
    await closeCreatePagesExcept(context, [page]);
    await closeExtraPages(context, [page]);
    await page.bringToFront();
    await ensurePlatformSpuQueryPageActive(page, runtimeDir, "platform-spu-query", 30000);
    if (shopFolder) {
      await ensureShopContext(page, runtimeDir, shopFolder);
      await ensurePlatformSpuQueryPageActive(page, runtimeDir, "platform-spu-query-after-shop-switch", 45000);
    }

    const platformTab = page.getByText("\u5E73\u53F0\u6807\u54C1", { exact: true });
    if (await platformTab.count()) {
      await platformTab.click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(800);
    }

    const queryPageReady = await waitForPlatformSpuQueryPageReady(page);
    if (!queryPageReady.ready) {
      if (retryNo < 2) {
        await savePageScreenshot(page, runtimeDir, `platform-spu-query-page-not-ready-retry-${retryNo + 1}.png`).catch(() => "");
        await page.keyboard.press("Escape").catch(() => {});
        await gotoWithTolerance(page, PLATFORM_SPU_URL, 5500 + retryNo * 1500).catch(() => {});
        await page.waitForTimeout(2000 + retryNo * 1000);
        return queryPlatformSpu(runtimeDir, brand, spu, shopFolder, retryNo + 1);
      }
      const error = new Error(`Platform SPU query page was not ready after navigation: ${queryPageReady.issue}`) as QueryDiagnosticError;
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
    if (!normalizeSpuMatchText(spuValueConfirmed).includes(normalizedSpu)) {
      spuValueConfirmed = await setPlatformInputValueAtPoint(page, spuBox, spu);
    }
    if (!normalizeSpuMatchText(spuValueConfirmed).includes(normalizedSpu)) {
      await setPlatformQueryInputValue(page, "spu", spu);
      await page.waitForTimeout(500);
      spuValueConfirmed = await readPlatformInputValueAtPoint(page, spuBox);
    }
    await page.waitForTimeout(800);
    if (!normalizeSpuMatchText(spuValueConfirmed).includes(normalizedSpu)) {
      spuValueConfirmed = await readPlatformQueryInputValue(page, "spu");
    }
    if (!normalizeSpuMatchText(spuValueConfirmed).includes(normalizedSpu)) {
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
    const spuSelfCheckOk = normalizeSpuMatchText(spuValueConfirmed).includes(normalizedSpu);
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
          const normalizeSpu = (value: string): string =>
            value.replace(/\s+/g, "").toLowerCase().replace(/械[住注]准/g, "械注准");
          const normalizedRowText = normalizeSpu(rowEl.innerText || "");
          const exactSpuCell = cellTexts.some((cell) => normalizeSpu(cell) === targetSpu);
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
      const queryLooksUnfiltered = !candidates.some((item) => item.normalizedText.includes(normalizedSpu));
      if (queryLooksUnfiltered && retryNo < 2) {
        logWarn(
          `platform spu query returned rows unrelated to requested spu; retrying query ${retryNo + 1}/2. brand=${brand}; spu=${spu}`
        );
        await savePageScreenshot(page, runtimeDir, `platform-spu-query-unfiltered-retry-${retryNo + 1}.png`).catch(() => "");
        await page.keyboard.press("Escape").catch(() => {});
        await page.waitForTimeout(1200);
        return queryPlatformSpu(runtimeDir, brand, spu, shopFolder, retryNo + 1);
      }
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
    await dispatchDomClickAtPoint(page, { x: matched.clickX, y: matched.clickY });

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
    await targetPage.waitForTimeout(4000).catch(() => {});
    await closeExtraPages(context, [targetPage]);
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

async function findBasicInputCenterByFieldId(page: Page, fieldId: string): Promise<{ x: number; y: number } | null> {
  return page.evaluate((targetFieldId) => {
    const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
    const root = document.querySelector(`[attr-field-id="${targetFieldId}"]`) as HTMLElement | null;
    const collectFields = (scope: ParentNode | Document = document): Array<{ x: number; y: number; top: number; score: number }> =>
      Array.from(scope.querySelectorAll("input, textarea"))
      .map((el) => {
        const input = el as HTMLInputElement | HTMLTextAreaElement;
        const rect = input.getBoundingClientRect();
        const style = window.getComputedStyle(input);
        if (
          rect.width <= 80 ||
          rect.height <= 0 ||
          style.display === "none" ||
          style.visibility === "hidden" ||
          input.disabled ||
          input.readOnly
        ) {
          return null;
        }
        const context = normalize(
          [
            input.placeholder || "",
            input.getAttribute("aria-label") || "",
            input.parentElement?.textContent || "",
            input.parentElement?.parentElement?.textContent || ""
          ].join(" ")
        );
        return {
          x: rect.x + rect.width / 2,
          y: rect.y + rect.height / 2,
          top: rect.top,
          score:
            (context.includes(targetFieldId) ? 200 : 0) +
            ((input as HTMLInputElement).type === "hidden" ? -500 : 0) +
            Math.min(120, rect.width / 8) -
            Math.abs(rect.top - (root?.getBoundingClientRect().top || rect.top))
        };
      })
      .filter(Boolean) as Array<{ x: number; y: number; top: number; score: number }>;

    let fields = root
      ? collectFields(root).sort((a, b) => (b?.score || 0) - (a?.score || 0) || (a?.top || 0) - (b?.top || 0))
      : [];

    if (!fields.length && !root) {
      const fallbackLabel = Array.from(document.querySelectorAll("body *"))
        .map((el) => {
          const node = el as HTMLElement;
          const rect = node.getBoundingClientRect();
          const style = window.getComputedStyle(node);
          const text = normalize(node.innerText || node.textContent || "");
          if (
            !text ||
            rect.width <= 0 ||
            rect.height <= 0 ||
            style.display === "none" ||
            style.visibility === "hidden" ||
            !text.includes(targetFieldId)
          ) {
            return null;
          }
          return { rect, text, score: (text === targetFieldId ? 1000 : 0) - text.length };
        })
        .filter(Boolean)
        .sort((a, b) => (b?.score || 0) - (a?.score || 0) || (a?.rect.top || 0) - (b?.rect.top || 0))[0];

      if (fallbackLabel) {
        const labelRect = fallbackLabel.rect;
        fields = collectFields(document)
          .map((field) => ({
            ...field,
            score:
              field.score +
              (field.y >= labelRect.top - 24 && field.y <= labelRect.bottom + 96 ? 220 : 0) +
              (field.x >= labelRect.left - 20 ? 80 : 0) -
              Math.abs(field.y - (labelRect.top + labelRect.height / 2))
          }))
          .filter((field) => field.score > 0)
          .sort((a, b) => b.score - a.score || a.top - b.top);
      }
    }

    const target = fields[0];
    return target ? { x: target.x, y: target.y } : null;
  }, fieldId);
}

async function findTitleInputCenter(page: Page): Promise<{ x: number; y: number } | null> {
  return findBasicInputCenterByFieldId(page, "\u5546\u54c1\u6807\u9898");
}

async function findShortTitleInputCenter(page: Page): Promise<{ x: number; y: number } | null> {
  return findBasicInputCenterByFieldId(page, "\u5bfc\u8d2d\u77ed\u6807\u9898");
}

async function assertBasicPrefillReadyOnPage(
  page: Page,
  metadata: { shortTitle?: string }
): Promise<void> {
  const shortTitleFieldVisible = metadata.shortTitle
    ? Boolean(await findShortTitleInputCenter(page))
    : true;
  const readiness = evaluateBasicPrefillReadiness({
    shortTitleRequired: Boolean(metadata.shortTitle),
    shortTitleFieldVisible
  });
  if (readiness.action === "reopen_from_platform_spu") {
    throw new PublishCreatePageReopenRequiredError(readiness.issue);
  }
}

async function findModelSpecInputCenter(page: Page): Promise<{ x: number; y: number } | null> {
  return page.evaluate(() => {
    const collectFields = (): Array<{
      input: HTMLInputElement | HTMLTextAreaElement;
      type: string;
      placeholder: string;
      value: string;
      className: string;
      ancestors: string[];
      x: number;
      y: number;
      width: number;
    }> =>
      Array.from(document.querySelectorAll("input, textarea"))
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
          input,
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
        input: HTMLInputElement | HTMLTextAreaElement;
        type: string;
        placeholder: string;
        value: string;
        className: string;
        ancestors: string[];
        x: number;
        y: number;
        width: number;
      }>;

    let target = collectFields().find(
      (field) =>
        field.type === "text" &&
        field.placeholder === "\u8BF7\u8F93\u5165" &&
        !field.className.includes("disabled") &&
        field.ancestors.some((item) => item.includes("\u578B\u53F7\u89C4\u683C")) &&
        field.width > 180
    );
    if (!target) {
      return null;
    }
    const fieldRoot = target.input.closest('[attr-field-id="\u578B\u53F7\u89C4\u683C"]') || target.input;
    fieldRoot.scrollIntoView({ block: "center", inline: "nearest" });
    target = collectFields().find(
      (field) =>
        field.type === "text" &&
        field.placeholder === "\u8BF7\u8F93\u5165" &&
        !field.className.includes("disabled") &&
        field.ancestors.some((item) => item.includes("\u578B\u53F7\u89C4\u683C")) &&
        field.width > 180
    );
    if (!target || target.y < 120 || target.y > window.innerHeight - 80) {
      return null;
    }
    return { x: target.x, y: target.y };
  });
}

async function clearAndTypeAtCenter(page: Page, center: { x: number; y: number }, value: string): Promise<void> {
  await focusDomElementAtPoint(page, center);
  await page.keyboard.press(getSelectAllShortcut()).catch(() => {});
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
  const normalizedExpected = normalizeSpuMatchText(expectedSpu);
  const normalizedActual = normalizeSpuMatchText(actualRegistration);
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

async function readBasicPublishCompletionOnPage(
  page: Page,
  metadata: { title?: string; shortTitle?: string; modelSpec?: string }
): Promise<{ missingFields: string[]; fieldValues: Record<string, string> }> {
  return page.evaluate((expected) => {
    const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
    const readField = (fieldId: string): { value: string; hasRequiredError: boolean } => {
      const root = document.querySelector(`[attr-field-id="${fieldId}"]`) as HTMLElement | null;
      if (!root) {
        return { value: "", hasRequiredError: true };
      }
      const input = root.querySelector("input, textarea") as HTMLInputElement | HTMLTextAreaElement | null;
      const value = normalize(input?.value || "");
      const text = normalize(root.innerText || root.textContent || "");
      return {
        value,
        hasRequiredError: text.includes("\u8be5\u9879\u4e3a\u5fc5\u586b\uff0c\u8bf7\u8f93\u5165")
      };
    };

    const title = readField("\u5546\u54c1\u6807\u9898");
    const shortTitle = readField("\u5bfc\u8d2d\u77ed\u6807\u9898");
    const modelSpec = readField("\u578b\u53f7\u89c4\u683c");
    const missingFields = [
      expected.title && (!title.value || title.hasRequiredError) ? "title" : "",
      expected.shortTitle && (!shortTitle.value || shortTitle.hasRequiredError) ? "shortTitle" : "",
      expected.modelSpec && (!modelSpec.value || !modelSpec.value.includes(expected.modelSpec) || modelSpec.hasRequiredError)
        ? "modelSpec"
        : ""
    ].filter(Boolean);

    return {
      missingFields,
      fieldValues: {
        title: title.value,
        shortTitle: shortTitle.value,
        modelSpec: modelSpec.value
      }
    };
  }, metadata);
}

async function assertBasicPublishCompletionOnPage(
  page: Page,
  runtimeDir: string,
  metadata: { title?: string; shortTitle?: string; modelSpec?: string },
  gateName: string
): Promise<void> {
  const completion = await readBasicPublishCompletionOnPage(page, metadata);
  if (completion.missingFields.length) {
    const screenshotFile = await savePageScreenshot(page, runtimeDir, `publish-page-basic-gate-${gateName}.png`).catch(() => "");
    throw new Error(
      `Basic info gate failed before ${gateName}: missing=${completion.missingFields.join(", ")}; values=${JSON.stringify(
        completion.fieldValues
      )}${screenshotFile ? `; screenshot=${screenshotFile}` : ""}`
    );
  }
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
      await clickVisibleText(page, "\u5c55\u5f00\u66f4\u591a").catch(() => false);
      await page.waitForTimeout(500);
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
      await clickVisibleText(page, "\u5c55\u5f00\u66f4\u591a").catch(() => false);
      await page.waitForTimeout(500);
      const modelSpecCenter = await findModelSpecInputCenter(page);
      if (modelSpecCenter) {
        await clearAndTypeAtCenter(page, modelSpecCenter, metadata.modelSpec);
        filledFields.push("modelSpec");
        await page.waitForTimeout(400);
      } else {
        throw new Error("Model spec input not found on publish page.");
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
  return target.click({ timeout: 3000 }).then(() => true).catch(() => false);
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

async function isRadioSelectedByLabel(page: Page, labelText: string): Promise<boolean> {
  return page.evaluate((targetLabel) => {
    const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
    const elements = Array.from(document.querySelectorAll("body *")).map((el) => el as HTMLElement);
    const labels = elements
      .map((el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        const text = normalize(el.innerText || el.textContent || "");
        if (text !== targetLabel || rect.width <= 0 || rect.height <= 0 || style.display === "none" || style.visibility === "hidden") {
          return null;
        }
        return { el, rect };
      })
      .filter(Boolean) as Array<{ el: HTMLElement; rect: DOMRect }>;

    for (const label of labels) {
      const candidates = elements
        .map((el) => {
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          if (
            rect.width <= 0 ||
            rect.height <= 0 ||
            style.display === "none" ||
            style.visibility === "hidden" ||
            rect.top < label.rect.top - 24 ||
            rect.top > label.rect.bottom + 24 ||
            rect.left < label.rect.left - 80 ||
            rect.left > label.rect.left + 20
          ) {
            return null;
          }
          const input = el as HTMLInputElement;
          const marker = [String(el.className || ""), el.getAttribute("role") || "", el.tagName].join(" ").toLowerCase();
          const checked = input.checked === true || el.getAttribute("aria-checked") === "true" || marker.includes("checked");
          const score = (marker.includes("radio") ? 200 : 0) - Math.abs(rect.left - label.rect.left) - Math.abs(rect.top - label.rect.top);
          return score > 0 ? { checked, score } : null;
        })
        .filter(Boolean)
        .sort((a, b) => (b?.score || 0) - (a?.score || 0));
      if (candidates[0]?.checked) {
        return true;
      }
    }
    return false;
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
    const modalTitles = ["\u0041\u0049\u7d20\u6750\u5de5\u5177", "\u0041\u0049\u52a9\u624b"];
    const titleNode = Array.from(document.querySelectorAll("body *")).find((el) => {
      const text = (el.textContent || "").trim();
      if (!modalTitles.includes(text)) {
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
        const marker = [text, el.getAttribute("aria-label") || "", el.getAttribute("title") || "", String(el.className || "")]
          .join(" ")
          .toLowerCase();
        if (rect.width <= 0 || rect.height <= 0) {
          return null;
        }
        if (rect.x < rootRect.x + rootRect.width * 0.7 || rect.y > rootRect.y + rootRect.height * 0.2) {
          return null;
        }
        const isCloseControl =
          text === "\u00d7" || text === "×" || /close|icon-close|semi-icon-close|ai-content_tomini/.test(marker);
        if (!isCloseControl) {
          return null;
        }
        return {
          el,
          x: rect.x,
          y: rect.y,
          score: (text === "\u00d7" || text === "×" ? 500 : 0) + rect.x - rect.y
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

  const closedAiAssistant = await page.evaluate(() => {
    const bodyText = document.body.innerText || "";
    if (!bodyText.includes("\u0041\u0049\u52a9\u624b")) {
      return false;
    }

    const candidates = Array.from(document.querySelectorAll("button, [role='button'], span, div, svg"))
      .map((el) => el as HTMLElement)
      .map((el) => {
        const rect = el.getBoundingClientRect();
        const text = (el.textContent || "").trim();
        const marker = [text, el.getAttribute("aria-label") || "", el.getAttribute("title") || "", String(el.className || "")]
          .join(" ")
          .toLowerCase();
        if (
          rect.width <= 0 ||
          rect.height <= 0 ||
          rect.left < window.innerWidth * 0.55 ||
          rect.top > 220 ||
          rect.width > 90 ||
          rect.height > 90
        ) {
          return null;
        }
        const isCloseControl = text === "\u00d7" || text === "×" || /close|icon-close|semi-icon-close/.test(marker);
        if (!isCloseControl) {
          return null;
        }
        return {
          el,
          score: rect.right + (text === "\u00d7" || text === "×" ? 500 : 0) - Math.abs(rect.top - 110)
        };
      })
      .filter(Boolean)
      .sort((a, b) => (b?.score || 0) - (a?.score || 0));

    const target = candidates[0]?.el || (document.elementFromPoint(window.innerWidth - 28, 112) as Element | null);
    if (!target) {
      return false;
    }
    if (target instanceof HTMLElement) {
      target.click();
    } else {
      target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    }
    return true;
  });

  if (closedAiAssistant) {
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
      "\u57fa\u7840\u4fe1\u606f": [
        "\u5546\u54c1\u6807\u9898",
        "\u5bfc\u8d2d\u77ed\u6807\u9898",
        "\u5546\u54c1\u7c7b\u76ee",
        "\u7c7b\u76ee\u5c5e\u6027",
        "\u54c1\u724c",
        "\u533b\u7597\u5668\u68b0\u5907\u6848/\u6ce8\u518c\u53f7",
        "\u77ed\u6807\u9898",
        "\u578b\u53f7\u89c4\u683c"
      ],
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
          rect.left >= 420 &&
          rect.top >= 240 &&
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

async function isPublishSectionContentPresent(page: Page, text: string): Promise<boolean> {
  return page.evaluate((targetText) => {
    const markersBySection: Record<string, string[]> = {
      "\u57fa\u7840\u4fe1\u606f": [
        "\u5546\u54c1\u6807\u9898",
        "\u5bfc\u8d2d\u77ed\u6807\u9898",
        "\u5546\u54c1\u7c7b\u76ee",
        "\u7c7b\u76ee\u5c5e\u6027",
        "\u54c1\u724c",
        "\u533b\u7597\u5668\u68b0\u5907\u6848/\u6ce8\u518c\u53f7",
        "\u77ed\u6807\u9898",
        "\u578b\u53f7\u89c4\u683c"
      ],
      "\u56fe\u6587\u4fe1\u606f": ["\u4e3b\u56fe", "\u767d\u5e95\u56fe", "\u5546\u54c1\u8be6\u60c5"],
      "\u4ef7\u683c\u5e93\u5b58": ["\u53d1\u8d27\u6a21\u5f0f", "\u73b0\u8d27\u53d1\u8d27\u65f6\u95f4", "\u5546\u54c1\u89c4\u683c"],
      "\u670d\u52a1\u4e0e\u5c65\u7ea6": ["\u8fd0\u8d39\u6a21\u677f", "\u552e\u540e\u670d\u52a1", "\u552e\u540e\u653f\u7b56"],
      "\u5176\u4ed6\u4fe1\u606f": ["\u533b\u7597\u5668\u68b0\u6ce8\u518c\u8bc1", "\u5176\u4ed6\u4fe1\u606f"]
    };
    const markers = markersBySection[targetText] || [targetText];
    const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
    return Array.from(document.querySelectorAll("body *"))
      .map((el) => {
        const node = el as HTMLElement;
        const rect = node.getBoundingClientRect();
        const style = window.getComputedStyle(node);
        const text = normalize(node.innerText || node.textContent || "");
        if (
          !text ||
          rect.width <= 0 ||
          rect.height <= 0 ||
          rect.left < 420 ||
          rect.top < 240 ||
          style.display === "none" ||
          style.visibility === "hidden"
        ) {
          return false;
        }
        return markers.some((marker) => text.includes(marker));
      })
      .some(Boolean);
  }, text);
}

async function scrollPublishSectionContentIntoView(page: Page, text: string): Promise<boolean> {
  return page.evaluate((targetText) => {
    const markersBySection: Record<string, string[]> = {
      "\u57fa\u7840\u4fe1\u606f": [
        "\u5546\u54c1\u6807\u9898",
        "\u5bfc\u8d2d\u77ed\u6807\u9898",
        "\u5546\u54c1\u7c7b\u76ee",
        "\u7c7b\u76ee\u5c5e\u6027",
        "\u54c1\u724c",
        "\u533b\u7597\u5668\u68b0\u5907\u6848/\u6ce8\u518c\u53f7",
        "\u77ed\u6807\u9898",
        "\u578b\u53f7\u89c4\u683c"
      ],
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
          rect.left < 420 ||
          rect.top < 240 ||
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
        await dispatchDomClickAtPoint(page, center).catch(() => false);
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
  if (activeTab === text) {
    return;
  }
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
  await dismissTransientOverlays(page);
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

async function readSpecTemplateSelectedValue(page: Page, keyword: string): Promise<string> {
  return page.evaluate((expectedKeyword) => {
    const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
    const visibleItems = Array.from(document.querySelectorAll("body *"))
      .map((el) => {
        const node = el as HTMLElement;
        const rect = node.getBoundingClientRect();
        const style = window.getComputedStyle(node);
        const text = normalize(node.innerText || node.textContent || "");
        if (!text || rect.width <= 0 || rect.height <= 0 || style.display === "none" || style.visibility === "hidden") {
          return null;
        }
        return {
          node,
          rect,
          text,
          marker: [String(node.className || ""), node.getAttribute("role") || "", node.tagName].join(" ").toLowerCase()
        };
      })
      .filter(Boolean) as Array<{ node: HTMLElement; rect: DOMRect; text: string; marker: string }>;

    const exactKeywordCandidates = visibleItems
      .filter((item) => item.text.includes(expectedKeyword) && item.text.length <= 80)
      .map((item) => {
        const context = normalize(
          [
            item.text,
            item.node.parentElement?.innerText || "",
            item.node.parentElement?.parentElement?.innerText || ""
          ].join(" ")
        );
        const score =
          (context.includes("规格模板") ? 160 : 0) +
          (context.includes("商品规格") ? 80 : 0) +
          (item.marker.includes("select") ? 80 : 0) +
          (item.marker.includes("dropdown") ? 60 : 0) +
          (item.marker.includes("combobox") ? 60 : 0) -
          item.text.length / 4;
        return { text: item.text, score };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score);

    if (exactKeywordCandidates[0]) {
      return exactKeywordCandidates[0].text;
    }

    const label = visibleItems
      .filter((item) => item.text.includes("规格模板"))
      .sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left)[0];
    if (!label) {
      return "";
    }

    const rowCandidates = visibleItems
      .filter((item) => {
        if (item.rect.left < label.rect.left - 20 || item.rect.left > label.rect.right + 900) {
          return false;
        }
        if (Math.abs(item.rect.top - label.rect.top) > 60) {
          return false;
        }
        return item.text.length <= 120;
      })
      .map((item) => {
        const score =
          (item.text.includes(expectedKeyword) ? 260 : 0) +
          (item.text.includes("规格模板") ? 80 : 0) +
          (item.marker.includes("select") ? 80 : 0) +
          (item.marker.includes("dropdown") ? 60 : 0) +
          (item.marker.includes("combobox") ? 60 : 0) -
          Math.abs(item.rect.top - label.rect.top) -
          item.text.length / 4;
        return { text: item.text, score };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score);

    return rowCandidates[0]?.text || "";
  }, keyword);
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
        return text.length > 80 ? `${text.slice(0, 80)}...` : text;
      })
      .filter(Boolean) as string[];

    return Array.from(new Set(options)).slice(0, 6);
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

  await dispatchDomClickAtPoint(page, freightCenter);
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

  await dispatchDomClickAtPoint(page, picked);
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
      await dispatchDomClickAtPoint(page, { x: freightCenter.x, y: clickY });
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

function resolveSpecTemplateKeyword(title?: string): string {
  return (title || "").includes(SPEC_TEMPLATE_KEYWORD_JIUGUANG)
    ? SPEC_TEMPLATE_KEYWORD_JIUGUANG
    : SPEC_TEMPLATE_KEYWORD_DEFAULT;
}

async function chooseDynamicSpecTemplateOnPage(page: Page, title?: string): Promise<string> {
  const keyword = resolveSpecTemplateKeyword(title);
  await dismissTransientOverlays(page);
  await scrollLabelIntoView(page, "规格模板").catch(() => false);
  let selectedValue = await readSpecTemplateSelectedValue(page, keyword).catch(() => "");
  if (selectedValue.includes(keyword)) {
    return selectedValue;
  }
  selectedValue = await chooseKeywordFromSearchDropdown(
    page,
    ["\u4e00\u952e\u590d\u7528\u89c4\u683c\u4fe1\u606f", "\u89c4\u683c\u6a21\u677f"],
    keyword
  );
  const readbackValue = await readSpecTemplateSelectedValue(page, keyword).catch(() => "");
  if (readbackValue.includes(keyword)) {
    return readbackValue;
  }
  if (!selectedValue.includes(keyword)) {
    selectedValue = await readDropdownValueByLabel(page, "\u89c4\u683c\u6a21\u677f").catch(() => "");
  }
  if (!selectedValue.includes(keyword)) {
    selectedValue = await readSpecTemplateSelectedValue(page, keyword).catch(() => "");
  }
  if (!selectedValue.includes(keyword)) {
    throw new Error(`No visible spec template matched keyword: ${keyword}`);
  }
  return selectedValue;
}

async function isManualSpecTemplateEntryModeVisible(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
    const visibleText = Array.from(document.querySelectorAll("body *"))
      .map((el) => el as HTMLElement)
      .filter((el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      })
      .map((el) => normalize(el.innerText || el.textContent || ""))
      .join(" ");

    return (
      visibleText.includes("商品规格") &&
      visibleText.includes("规格模板") &&
      (visibleText.includes("添加规格类型") ||
        visibleText.includes("规格预览") ||
        (visibleText.includes("价格与库存") && visibleText.includes("现货库存"))) &&
      !visibleText.includes("点击 或 拖动 文件到虚线框内上传")
    );
  });
}

async function clickSwitchManualSpecEntryMode(page: Page): Promise<boolean> {
  const clickedByText = await page
    .getByText("切换手动填写", { exact: false })
    .first()
    .click({ timeout: 2500 })
    .then(() => true)
    .catch(() => false);
  if (clickedByText) {
    return true;
  }

  return page.evaluate(() => {
    const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
    const target = Array.from(document.querySelectorAll("button, [role='button'], a, body *"))
      .map((el) => el as HTMLElement)
      .filter((el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        const text = normalize(el.innerText || el.textContent || "");
        return (
          text.includes("切换手动填写") &&
          rect.width > 0 &&
          rect.height > 0 &&
          style.display !== "none" &&
          style.visibility !== "hidden"
        );
      })
      .sort((a, b) => {
        const aRect = a.getBoundingClientRect();
        const bRect = b.getBoundingClientRect();
        return bRect.left - aRect.left || aRect.top - bRect.top;
      })[0];
    if (!target) {
      return false;
    }
    ((target.closest("button, [role='button'], a") as HTMLElement | null) || target).click();
    return true;
  });
}

async function ensureManualSpecTemplateEntryModeOnPage(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await dismissTransientOverlays(page).catch(() => {});
    await scrollLabelIntoView(page, "商品规格").catch(() => false);
    await scrollLabelIntoView(page, "规格模板").catch(() => false);
    await page.waitForTimeout(400);
    if (await isManualSpecTemplateEntryModeVisible(page).catch(() => false)) {
      return;
    }
    await clickSwitchManualSpecEntryMode(page).catch(() => false);
    await page.waitForTimeout(1000);
    if (await isManualSpecTemplateEntryModeVisible(page).catch(() => false)) {
      return;
    }
  }
  throw new Error("Manual spec template entry mode was not visible after clicking 切换手动填写.");
}

async function waitForSpecTemplateReadback(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const filledValues = await readCurrentSpecValuesStrict(page).catch(() => []);
    const visiblePriceRows = await countVisiblePriceInventoryRows(page).catch(() => 0);
    if (filledValues.length > 0 || visiblePriceRows > 0) {
      return;
    }
    await page.waitForTimeout(700);
  }
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

async function countVisibleBlankSpecValueInputs(page: Page): Promise<number> {
  return page.evaluate(() => {
    const labels = Array.from(document.querySelectorAll("body *"))
      .map((el) => el as HTMLElement)
      .map((el) => {
        const text = (el.textContent || "").trim();
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        if (!text || rect.width <= 0 || rect.height <= 0 || style.display === "none" || style.visibility === "hidden") {
          return null;
        }
        return { text, top: rect.top, bottom: rect.bottom };
      })
      .filter(Boolean) as Array<{ text: string; top: number; bottom: number }>;

    const specLabel = labels.find((item) => item.text === "\u5546\u54c1\u89c4\u683c");
    const priceLabel = labels.find((item) => item.text === "\u4ef7\u683c\u4e0e\u5e93\u5b58" && (!specLabel || item.top > specLabel.top));
    const topBound = specLabel ? specLabel.bottom - 30 : 160;
    const bottomBound = priceLabel ? priceLabel.top - 6 : window.innerHeight + 1200;

    return Array.from(document.querySelectorAll("input"))
      .map((el) => el as HTMLInputElement)
      .filter((input) => {
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
        return (
          rect.width > 120 &&
          rect.height > 0 &&
          rect.top >= topBound &&
          rect.top <= bottomBound &&
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          !input.disabled &&
          !input.readOnly &&
          !input.value.trim() &&
          (placeholder.includes("\u8bf7\u8f93\u5165\u89c4\u683c\u503c") || context.includes("\u8bf7\u8f93\u5165\u89c4\u683c\u503c"))
        );
      }).length;
  });
}

async function removeOneBlankSpecValueInput(page: Page): Promise<boolean> {
  const clicked = await page.evaluate(() => {
    const findClosestRowContainer = (input: HTMLInputElement): HTMLElement => {
      let current: HTMLElement | null = input;
      for (let depth = 0; current && depth < 8; depth += 1) {
        const textInputCount = Array.from(current.querySelectorAll("input"))
          .map((el) => el as HTMLInputElement)
          .filter((candidate) => {
            const rect = candidate.getBoundingClientRect();
            const type = (candidate.getAttribute("type") || "text").toLowerCase();
            return rect.width > 80 && rect.height > 0 && !["hidden", "checkbox", "radio", "file"].includes(type);
          }).length;
        const actionCount = current.querySelectorAll("button, [role='button'], svg").length;
        if (textInputCount === 1 && actionCount > 0) {
          return current;
        }
        current = current.parentElement;
      }
      return input.parentElement || input;
    };

    const labels = Array.from(document.querySelectorAll("body *"))
      .map((el) => el as HTMLElement)
      .map((el) => {
        const text = (el.textContent || "").trim();
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        if (!text || rect.width <= 0 || rect.height <= 0 || style.display === "none" || style.visibility === "hidden") {
          return null;
        }
        return { text, top: rect.top, bottom: rect.bottom };
      })
      .filter(Boolean) as Array<{ text: string; top: number; bottom: number }>;

    const specLabel = labels.find((item) => item.text === "\u5546\u54c1\u89c4\u683c");
    const priceLabel = labels.find((item) => item.text === "\u4ef7\u683c\u4e0e\u5e93\u5b58" && (!specLabel || item.top > specLabel.top));
    const topBound = specLabel ? specLabel.bottom - 30 : 160;
    const bottomBound = priceLabel ? priceLabel.top - 6 : window.innerHeight + 1200;
    const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();

    const blankInput = Array.from(document.querySelectorAll("input"))
      .map((el) => el as HTMLInputElement)
      .find((input) => {
        const rect = input.getBoundingClientRect();
        const style = window.getComputedStyle(input);
        const placeholder = normalize(input.getAttribute("placeholder") || "");
        const context = normalize(
          [
            placeholder,
            input.parentElement?.textContent || "",
            input.parentElement?.parentElement?.textContent || "",
            input.closest("div")?.textContent || ""
          ].join(" ")
        );
        return (
          rect.width > 120 &&
          rect.height > 0 &&
          rect.top >= topBound &&
          rect.top <= bottomBound &&
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          !input.disabled &&
          !input.readOnly &&
          !input.value.trim() &&
          (placeholder.includes("\u8bf7\u8f93\u5165\u89c4\u683c\u503c") || context.includes("\u8bf7\u8f93\u5165\u89c4\u683c\u503c"))
        );
      });
    if (!blankInput) {
      return null;
    }

    const inputRect = blankInput.getBoundingClientRect();
    const rowContainer = findClosestRowContainer(blankInput);
    const rowRect = rowContainer.getBoundingClientRect();
    const rowCandidates = Array.from(rowContainer.querySelectorAll("button, [role='button'], svg"));
    const candidates = (rowCandidates.length ? rowCandidates : Array.from(document.querySelectorAll("button, [role='button'], svg")))
      .map((el) => el as HTMLElement)
      .map((el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        const text = normalize(el.innerText || el.textContent || el.getAttribute("aria-label") || "");
        const marker = normalize(
          [
            text,
            el.getAttribute("class") || "",
            el.getAttribute("aria-label") || "",
            el.closest("button, [role='button']")?.getAttribute("class") || "",
            el.closest("button, [role='button']")?.getAttribute("aria-label") || ""
          ].join(" ")
        ).toLowerCase();
        if (
          rect.width <= 0 ||
          rect.height <= 0 ||
          style.display === "none" ||
          style.visibility === "hidden" ||
          rect.top < rowRect.top - 12 ||
          rect.bottom > rowRect.bottom + 12 ||
          rect.left < inputRect.right - 20 ||
          rect.left > inputRect.right + 180 ||
          Math.abs(rect.top + rect.height / 2 - (inputRect.top + inputRect.height / 2)) > 28 ||
          marker.includes("add") ||
          marker.includes("plus") ||
          marker.includes("\u6dfb\u52a0") ||
          marker.includes("\u4e0b\u79fb") ||
          marker.includes("\u4e0a\u79fb") ||
          text.includes("\u89c4\u683c\u9884\u89c8") ||
          text.includes("\u5b58\u50a8\u6a21\u677f")
        ) {
          return null;
        }
        return {
          element: el,
          distance:
            Math.min(Math.abs(rect.right - inputRect.left), Math.abs(rect.left - inputRect.right)) +
            Math.abs(rect.top + rect.height / 2 - (inputRect.top + inputRect.height / 2)) +
            (el.tagName.toLowerCase() === "button" || el.getAttribute("role") === "button" ? -20 : 0)
        };
      })
      .filter(Boolean)
      .sort((a, b) => (a?.distance || 0) - (b?.distance || 0)) as Array<{ element: HTMLElement; distance: number }>;

    const target = candidates[0]?.element;
    if (!target) {
      return false;
    }
    const clickable = (target.closest("button, [role='button']") as HTMLElement | null) || target.parentElement || target;
    clickable.click();
    return true;
  });

  if (!clicked) {
    return false;
  }
  await page.waitForTimeout(500);
  return true;
}

async function removeBlankSpecValueInputsFromTemplate(page: Page): Promise<number> {
  let removed = 0;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const blankCount = await countVisibleBlankSpecValueInputs(page).catch(() => 0);
    if (!blankCount) {
      return removed;
    }
    const removedOne = await removeOneBlankSpecValueInput(page).catch(() => false);
    if (!removedOne) {
      return removed;
    }
    removed += 1;
  }
  return removed;
}

async function applySpecTemplateWithVerificationOnPage(
  page: Page,
  title?: string
): Promise<{ selectedTemplate: string; filledValues: string[]; issue: string }> {
  const keyword = resolveSpecTemplateKeyword(title);
  let selectedTemplate = "";

  for (let attempt = 0; attempt < 2; attempt += 1) {
    await ensureManualSpecTemplateEntryModeOnPage(page);
    try {
      selectedTemplate = await chooseDynamicSpecTemplateOnPage(page, title);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        selectedTemplate,
        filledValues: [],
        issue: `${message}; keyword=${keyword}`
      };
    }
    await waitForSpecTemplateReadback(page);

    const filledValues = await readCurrentSpecValuesStrict(page).catch(() => []);
    const visiblePriceRows = await countVisiblePriceInventoryRows(page).catch(() => 0);
    const blankSpecValueInputs = await countVisibleBlankSpecValueInputs(page).catch(() => 0);
    const initialRule = evaluateSpecTemplateCompletion({
      selectedTemplate,
      expectedTemplateKeyword: keyword,
      filledSpecValues: filledValues.length,
      expectedSpecValues: FIXED_SPEC_VALUES.length,
      priceRows: visiblePriceRows,
      blankSpecValueInputs
    });
    if (initialRule.passed) {
      return {
        selectedTemplate: selectedTemplate || keyword,
        filledValues,
        issue: ""
      };
    }
    if (initialRule.issue.includes("blank required spec value")) {
      await removeBlankSpecValueInputsFromTemplate(page).catch(() => 0);
    }
  }

  const finalValues = await readCurrentSpecValuesStrict(page).catch(() => []);
  const finalVisiblePriceRows = await countVisiblePriceInventoryRows(page).catch(() => 0);
  const finalBlankSpecValueInputs = await countVisibleBlankSpecValueInputs(page).catch(() => 0);
  const finalRule = evaluateSpecTemplateCompletion({
    selectedTemplate,
    expectedTemplateKeyword: keyword,
    filledSpecValues: finalValues.length,
    expectedSpecValues: FIXED_SPEC_VALUES.length,
    priceRows: finalVisiblePriceRows,
    blankSpecValueInputs: finalBlankSpecValueInputs
  });
  return {
    selectedTemplate,
    filledValues: finalValues,
    issue: finalRule.passed ? "" : `${finalRule.issue}; keyword=${keyword}`
  };
}

async function readSpecModuleErrorOnPage(page: Page): Promise<string> {
  return page.evaluate(() => {
    const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
    const knownErrors = ["规格值不能重复", "该项为必填，请输入", "请选择规格类型", "暂无选项"];
    const visibleItems = Array.from(document.querySelectorAll("body *"))
      .map((el) => el as HTMLElement)
      .map((el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        const text = normalize(el.innerText || el.textContent || "");
        if (!text || rect.width <= 0 || rect.height <= 0 || style.display === "none" || style.visibility === "hidden") {
          return null;
        }
        return { rect, text };
      })
      .filter(Boolean) as Array<{ rect: DOMRect; text: string }>;
    const specLabel = visibleItems
      .filter((item) => item.text === "\u5546\u54c1\u89c4\u683c")
      .sort((a, b) => a.rect.top - b.rect.top)[0];
    const priceLabel = visibleItems
      .filter((item) => item.text === "\u4ef7\u683c\u4e0e\u5e93\u5b58" && (!specLabel || item.rect.top > specLabel.rect.top))
      .sort((a, b) => a.rect.top - b.rect.top)[0];
    const topBound = specLabel ? specLabel.rect.top - 20 : 160;
    const bottomBound = priceLabel ? priceLabel.rect.top - 8 : topBound + 520;
    const moduleText = visibleItems
      .filter((item) => item.rect.left >= 420 && item.rect.top >= topBound && item.rect.top <= bottomBound)
      .map((item) => item.text)
      .join(" ");
    return knownErrors.find((item) => moduleText.includes(item)) || "";
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

function configuredFieldsFromServiceFulfillmentState(state: ServiceFulfillmentState): string[] {
  return [
    state.shippingModeSelected ? "shippingMode" : "",
    state.shippingTimeSelected ? "shippingTime" : "",
    state.productStatusSelected ? "productStatus" : "",
    state.freightTemplateName ? "freightTemplate" : ""
  ].filter(Boolean);
}

async function clickRadioOptionNearFieldLabel(page: Page, fieldLabel: string, optionText: string): Promise<boolean> {
  return page.evaluate(
    ({ fieldLabel: targetFieldLabel, optionText: targetOptionText }) => {
      const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
      const elements = Array.from(document.querySelectorAll("body *")).map((el) => el as HTMLElement);
      const field = elements
        .map((el) => {
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          const text = normalize(el.innerText || el.textContent || "");
          if (!text || !text.includes(targetFieldLabel) || rect.width <= 0 || rect.height <= 0 || style.display === "none" || style.visibility === "hidden") {
            return null;
          }
          return {
            rect,
            absTop: rect.top + window.scrollY,
            absBottom: rect.bottom + window.scrollY,
            absRight: rect.right + window.scrollX,
            score:
              (text === targetFieldLabel || text === `*${targetFieldLabel}` ? 1000 : 0) +
              (text.startsWith("*") ? 200 : 0) +
              (rect.left > 250 ? 500 : -500) -
              text.length
          };
        })
        .filter(Boolean)
        .sort((a, b) => (b?.score || 0) - (a?.score || 0))[0];
      if (!field) {
        return false;
      }

      const candidate = elements
        .map((el) => {
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          const text = normalize(el.innerText || el.textContent || "");
          if (text !== targetOptionText || rect.width <= 0 || rect.height <= 0 || style.display === "none" || style.visibility === "hidden") {
            return null;
          }
          const absTop = rect.top + window.scrollY;
          const absLeft = rect.left + window.scrollX;
          if (absTop < field.absTop - 30 || absTop > field.absBottom + 90 || absLeft < field.absRight - 20) {
            return null;
          }
          const label = (el.closest("label") || el) as HTMLElement;
          const labelText = normalize(label.innerText || label.textContent || "");
          const marker = [String(label.className || ""), label.getAttribute("role") || "", label.tagName].join(" ").toLowerCase();
          return {
            el: label,
            score:
              (labelText === targetOptionText ? 300 : 0) +
              (marker.includes("radio") ? 200 : 0) -
              Math.abs(absTop - field.absTop) -
              Math.abs(absLeft - field.absRight) / 10
          };
        })
        .filter(Boolean)
        .sort((a, b) => (b?.score || 0) - (a?.score || 0))[0];
      if (!candidate) {
        return false;
      }
      candidate.el.scrollIntoView({ block: "center", inline: "center" });
      candidate.el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
      candidate.el.click();
      return true;
    },
    { fieldLabel, optionText }
  );
}

async function isRadioOptionSelectedNearFieldLabel(page: Page, fieldLabel: string, optionText: string): Promise<boolean> {
  return page.evaluate(
    ({ fieldLabel: targetFieldLabel, optionText: targetOptionText }) => {
      const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
      const elements = Array.from(document.querySelectorAll("body *")).map((el) => el as HTMLElement);
      const field = elements
        .map((el) => {
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          const text = normalize(el.innerText || el.textContent || "");
          if (!text || !text.includes(targetFieldLabel) || rect.width <= 0 || rect.height <= 0 || style.display === "none" || style.visibility === "hidden") {
            return null;
          }
          return {
            rect,
            absTop: rect.top + window.scrollY,
            absBottom: rect.bottom + window.scrollY,
            absRight: rect.right + window.scrollX,
            score:
              (text === targetFieldLabel || text === `*${targetFieldLabel}` ? 1000 : 0) +
              (text.startsWith("*") ? 200 : 0) +
              (rect.left > 250 ? 500 : -500) -
              text.length
          };
        })
        .filter(Boolean)
        .sort((a, b) => (b?.score || 0) - (a?.score || 0))[0];
      if (!field) {
        return false;
      }

      const candidate = elements
        .map((el) => {
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          const text = normalize(el.innerText || el.textContent || "");
          if (text !== targetOptionText || rect.width <= 0 || rect.height <= 0 || style.display === "none" || style.visibility === "hidden") {
            return null;
          }
          const absTop = rect.top + window.scrollY;
          const absLeft = rect.left + window.scrollX;
          if (absTop < field.absTop - 30 || absTop > field.absBottom + 90 || absLeft < field.absRight - 20) {
            return null;
          }
          const label = (el.closest("label") || el) as HTMLElement;
          const input = label.querySelector("input") as HTMLInputElement | null;
          const marker = [
            String(label.className || ""),
            label.getAttribute("role") || "",
            label.getAttribute("aria-checked") || "",
            String(el.className || "")
          ]
            .join(" ")
            .toLowerCase();
          const selected =
            input?.checked === true ||
            label.getAttribute("aria-checked") === "true" ||
            /\bchecked\b|selected|active/.test(marker);
          return {
            selected,
            score:
              (marker.includes("radio") ? 200 : 0) -
              Math.abs(absTop - field.absTop) -
              Math.abs(absLeft - field.absRight) / 10
          };
        })
        .filter(Boolean)
        .sort((a, b) => (b?.score || 0) - (a?.score || 0))[0];
      return candidate?.selected === true;
    },
    { fieldLabel, optionText }
  );
}

async function ensureRadioOptionNearFieldLabel(page: Page, fieldLabel: string, optionText: string): Promise<boolean> {
  if (await isRadioOptionSelectedNearFieldLabel(page, fieldLabel, optionText).catch(() => false)) {
    return true;
  }
  if (await clickRadioOptionNearFieldLabel(page, fieldLabel, optionText).catch(() => false)) {
    await page.waitForTimeout(500);
  }
  return isRadioOptionSelectedNearFieldLabel(page, fieldLabel, optionText).catch(() => false);
}

async function readServiceFulfillmentState(page: Page, freightTemplateName: string): Promise<ServiceFulfillmentState> {
  const shippingModeSelected =
    (await isRadioOptionSelectedNearFieldLabel(page, "\u53d1\u8d27\u6a21\u5f0f", "\u73b0\u8d27").catch(() => false)) ||
    (await isRadioSelectedByLabel(page, "\u73b0\u8d27").catch(() => false));
  const shippingTimeSelected =
    (await isRadioOptionSelectedNearFieldLabel(page, "\u73b0\u8d27\u53d1\u8d27\u65f6\u95f4", "48\u5c0f\u65f6").catch(() => false)) ||
    (await isRadioSelectedByLabel(page, "48\u5c0f\u65f6").catch(() => false));
  const productStatusSelected =
    (await isRadioOptionSelectedNearFieldLabel(page, "\u5546\u54c1\u72b6\u6001", "\u4e0a\u67b6").catch(() => false)) ||
    (await isRadioSelectedByLabel(page, "\u4e0a\u67b6").catch(() => false));
  const selectedFreight = isConcreteFreightTemplateName(freightTemplateName)
    ? freightTemplateName
    : await readLabeledSelectValue(page, "\u8fd0\u8d39\u6a21\u677f").catch(() => "");
  return {
    shippingModeSelected,
    shippingTimeSelected,
    productStatusSelected,
    freightTemplateName: isConcreteFreightTemplateName(selectedFreight) ? selectedFreight : ""
  };
}

async function applyServiceFulfillmentSettingsOnPage(page: Page): Promise<{
  configuredFields: string[];
  freightTemplateName: string;
  serviceState: ServiceFulfillmentState;
}> {
  await ensureRadioOptionNearFieldLabel(page, "\u53d1\u8d27\u6a21\u5f0f", "\u73b0\u8d27");
  await ensureRadioOptionNearFieldLabel(page, "\u73b0\u8d27\u53d1\u8d27\u65f6\u95f4", "48\u5c0f\u65f6");
  await ensureServiceSectionReady(page);

  const freightTemplateName = await chooseKeywordFreightTemplate(page, FIXED_FREIGHT_TEMPLATE_KEYWORD);
  await ensureRadioOptionNearFieldLabel(page, "\u5546\u54c1\u72b6\u6001", "\u4e0a\u67b6");
  await clickRadioByLabel(page, "\u4e0a\u67b6").catch(() => false);
  await page.waitForTimeout(500);

  const serviceState = await readServiceFulfillmentState(page, freightTemplateName);
  return {
    configuredFields: configuredFieldsFromServiceFulfillmentState(serviceState),
    freightTemplateName: serviceState.freightTemplateName,
    serviceState
  };
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
  serviceState: ServiceFulfillmentState;
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
      const settingsResult = await applyServiceFulfillmentSettingsOnPage(page);

      const screenshotFile = await savePageScreenshot(page, runtimeDir, "publish-page-fixed-settings.png");
      return {
        pageUrl: page.url(),
        pageTitle: await page.title(),
        screenshotFile,
        configuredFields: settingsResult.configuredFields,
        freightTemplateName: settingsResult.freightTemplateName,
        serviceState: settingsResult.serviceState
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
  serviceState: ServiceFulfillmentState;
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

  const settingsResult = await applyServiceFulfillmentSettingsOnPage(page);

  const screenshotFile = await savePageScreenshot(page, runtimeDir, fileName);
  return {
    pageUrl: page.url(),
    pageTitle: await page.title(),
    screenshotFile,
    configuredFields: settingsResult.configuredFields,
    freightTemplateName: settingsResult.freightTemplateName,
    serviceState: settingsResult.serviceState
  };
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
    sectionLabel: string;
  }>
> {
  return page.locator("input[type='file']").evaluateAll((elements) =>
    elements.map((el, index) => {
      const inputRect = (() => {
        let node: HTMLElement | null = el as HTMLElement;
        for (let depth = 0; node && depth < 8; depth += 1, node = node.parentElement) {
          const rect = node.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            return rect;
          }
        }
        return (el as HTMLElement).getBoundingClientRect();
      })();
      const sectionLabel = (() => {
        const normalize = (value: string): string => value.trim().replace(/\s+/g, " ");
        const markers = ["主图3:4", "主图", "白底图", "商品详情", "详情页", "医疗器械注册证", "医疗器械生产许可证", "赠品资质", "质检报告"];
        const labels = Array.from(document.querySelectorAll("body *"))
          .map((node) => node as HTMLElement)
          .map((node) => {
            const rect = node.getBoundingClientRect();
            const text = normalize(node.textContent || "");
            if (!text || rect.width <= 0 || rect.height <= 0 || text.length > 120) {
              return null;
            }
            const marker = markers.find((item) => {
              if (item === "主图") {
                return (text === item || text.startsWith(item)) && !text.includes("主图3:4");
              }
              return text === item || text.startsWith(item) || text.includes(item);
            });
            if (!marker) {
              return null;
            }
            return {
              marker,
              top: rect.top,
              bottom: rect.bottom,
              distance: Math.abs(inputRect.top - rect.bottom)
            };
          })
          .filter(Boolean)
          .filter((item) => item!.top <= inputRect.top + 40)
          .sort((a, b) => a!.distance - b!.distance);
        return labels[0]?.marker || "";
      })();
      return {
        index,
        accept: el.getAttribute("accept") || "",
        multiple: el.hasAttribute("multiple"),
        sectionLabel,
        parentText: (() => {
        const normalize = (value: string): string => value.trim().replace(/\s+/g, " ");
        const sectionMarkers = [
          "\u4e3b\u56fe",
          "\u4e3b\u56fe3:4",
          "\u767d\u5e95\u56fe",
          "\u9891\u9053\u3001\u6d3b\u52a8",
          "\u5546\u54c1\u8be6\u60c5",
          "\u5546\u8be6\u56fe\u7247",
          "\u8be6\u60c5\u9875",
          "\u5bbd\u5ea6620",
          "\u4e0a\u4f20\u56fe\u7247",
          "\u4e0a\u4f20\u4e3b\u56fe",
          "\u533b\u7597\u5668\u68b0\u6ce8\u518c\u8bc1",
          "\u533b\u7597\u5668\u68b0\u751f\u4ea7\u8bb8\u53ef\u8bc1",
          "\u8d60\u54c1\u8d44\u8d28",
          "\u8d28\u68c0\u62a5\u544a"
        ];
        let node: HTMLElement | null = el.parentElement;
        let best = "";
        for (let depth = 0; node && depth < 10; depth += 1, node = node.parentElement) {
          const text = normalize(node.textContent || "");
          if (!text || text.length > 1800) {
            continue;
          }
          const hasMarker = sectionMarkers.some((marker) => text.includes(marker));
          if (hasMarker || text.length > best.length) {
            best = text;
          }
        }
        return best.slice(0, 1800);
      })()
      };
    })
  );
}

function pickBestFileInput(
  inputs: Array<{ index: number; accept: string; multiple: boolean; parentText: string; sectionLabel?: string }>,
  scoreInput: (input: { index: number; accept: string; multiple: boolean; parentText: string; sectionLabel?: string }) => number
): { index: number; accept: string; multiple: boolean; parentText: string; sectionLabel?: string } | null {
  const scored = inputs
    .map((input) => ({ input, score: scoreInput(input) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.input.index - b.input.index);
  return scored[0]?.input || null;
}

function pickBestSectionFileInput(
  inputs: Array<{ index: number; accept: string; multiple: boolean; parentText: string; sectionLabel?: string }>,
  sectionLabel: string,
  scoreInput: (input: { index: number; accept: string; multiple: boolean; parentText: string; sectionLabel?: string }) => number
): { index: number; accept: string; multiple: boolean; parentText: string; sectionLabel?: string } | null {
  const exact = inputs.filter((input) => input.sectionLabel === sectionLabel);
  return pickBestFileInput(exact.length ? exact : inputs, scoreInput);
}

function scoreMainGraphicInput(input: { parentText: string; multiple: boolean; sectionLabel?: string }): number {
  const text = input.parentText;
  let score = 0;
  if (input.sectionLabel === "\u4e3b\u56fe") score += 1000;
  if (input.sectionLabel === "\u767d\u5e95\u56fe" || input.sectionLabel === "\u4e3b\u56fe3:4") score -= 1000;
  if (text.includes("\u4e0a\u4f20\u4e3b\u56fe")) score += 110;
  if (text.includes("\u4e3b\u56fe")) score += 80;
  if (text.includes("600*600") || text.includes("600\u00d7600")) score += 40;
  if (input.multiple) score += 10;
  if (text.includes("\u767d\u5e95\u56fe")) score -= 220;
  if (text.includes("\u9891\u9053\u3001\u6d3b\u52a8")) score -= 160;
  if (text.includes("\u5546\u54c1\u8be6\u60c5") || text.includes("\u5546\u8be6\u56fe\u7247")) score -= 160;
  if (text.includes("\u5bbd\u5ea6620") || /\(\d+\/50\)/.test(text)) score -= 140;
  if (text.includes("\u4e3b\u56fe3:4")) score -= 120;
  return score;
}

function scoreWhiteBackgroundGraphicInput(input: { parentText: string; multiple: boolean; sectionLabel?: string }): number {
  const text = input.parentText;
  let score = 0;
  if (input.sectionLabel === "\u767d\u5e95\u56fe") score += 1000;
  if (input.sectionLabel === "\u4e3b\u56fe" || input.sectionLabel === "\u4e3b\u56fe3:4") score -= 1000;
  if (text.includes("\u767d\u5e95\u56fe")) score += 180;
  if (text.includes("\u9891\u9053\u3001\u6d3b\u52a8")) score += 120;
  if (text.includes("600*600") || text.includes("600\u00d7600")) score += 40;
  if (text.includes("\u4e3b\u56fe3:4")) score -= 180;
  if (text.includes("\u5546\u54c1\u8be6\u60c5") || text.includes("\u5546\u8be6\u56fe\u7247")) score -= 180;
  if (text.includes("\u4e0a\u4f20\u4e3b\u56fe") && !text.includes("\u767d\u5e95\u56fe")) score -= 120;
  return score;
}

function scoreDetailGraphicInput(input: { parentText: string; multiple: boolean; sectionLabel?: string }): number {
  const text = input.parentText;
  let score = 0;
  if (input.sectionLabel === "\u5546\u54c1\u8be6\u60c5" || input.sectionLabel === "\u8be6\u60c5\u9875") score += 1000;
  if (input.sectionLabel === "\u4e3b\u56fe" || input.sectionLabel === "\u767d\u5e95\u56fe" || input.sectionLabel === "\u4e3b\u56fe3:4") score -= 1000;
  if (text.includes("\u5546\u54c1\u8be6\u60c5")) score += 140;
  if (text.includes("\u5546\u8be6\u56fe\u7247")) score += 140;
  if (text.includes("\u5bbd\u5ea6620")) score += 100;
  if (/\(\d+\/50\)/.test(text)) score += 100;
  if (text.includes("\u4e0a\u4f20\u56fe\u7247")) score += 40;
  if (input.multiple) score += 20;
  if (text.includes("\u767d\u5e95\u56fe") || text.includes("\u9891\u9053\u3001\u6d3b\u52a8")) score -= 160;
  if (text.includes("\u4e3b\u56fe3:4")) score -= 120;
  return score;
}

function scoreMedicalDeviceCertificateInput(input: { parentText: string; multiple: boolean; sectionLabel?: string }): number {
  const text = input.parentText;
  let score = 0;
  if (input.sectionLabel === "\u533b\u7597\u5668\u68b0\u6ce8\u518c\u8bc1") score += 1000;
  if (
    input.sectionLabel === "\u533b\u7597\u5668\u68b0\u751f\u4ea7\u8bb8\u53ef\u8bc1" ||
    input.sectionLabel === "\u8d60\u54c1\u8d44\u8d28" ||
    input.sectionLabel === "\u8d28\u68c0\u62a5\u544a"
  ) {
    score -= 1000;
  }
  if (text.includes("\u533b\u7597\u5668\u68b0\u6ce8\u518c\u8bc1")) score += 220;
  if (text.includes("\u9009\u62e9\u5df2\u6709\u8d44\u8d28")) score += 120;
  if (/0\/20|\d+\/20/.test(text)) score += 80;
  if (text.includes("\u533b\u7597\u5668\u68b0\u751f\u4ea7\u8bb8\u53ef\u8bc1")) score -= 300;
  if (text.includes("\u8d60\u54c1\u8d44\u8d28") || text.includes("\u8d28\u68c0\u62a5\u544a")) score -= 260;
  if (text.includes("\u5546\u54c1\u8be6\u60c5") || text.includes("\u5546\u8be6\u56fe\u7247")) score -= 220;
  return score;
}

async function uploadFilesToInput(
  page: Page,
  input: { index: number; multiple: boolean },
  files: string[]
): Promise<number> {
  const selectedFiles = input.multiple ? files : files.slice(0, 1);
  if (!selectedFiles.length) {
    return 0;
  }
  await page.locator("input[type='file']").nth(input.index).setInputFiles(selectedFiles);
  return selectedFiles.length;
}

async function readMedicalDeviceCertificateState(page: Page): Promise<{
  fieldVisible: boolean;
  categoryText: string;
  selectedCertificateCount: number;
  sectionText: string;
}> {
  return page.evaluate(() => {
    const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
    const visibleItems = Array.from(document.querySelectorAll("body *"))
      .map((el) => {
        const node = el as HTMLElement;
        const rect = node.getBoundingClientRect();
        const style = window.getComputedStyle(node);
        const text = normalize(node.innerText || node.textContent || "");
        if (!text || rect.width <= 0 || rect.height <= 0 || style.display === "none" || style.visibility === "hidden") {
          return null;
        }
        return { node, text, rect };
      })
      .filter(Boolean) as Array<{ node: HTMLElement; text: string; rect: DOMRect }>;

    const mainItems = visibleItems.filter((item) => item.rect.left > 250);
    const categoryText =
      mainItems.find((item) => item.text.includes("商品类目") && item.text.includes("医疗器械"))?.text ||
      mainItems.find((item) => item.text.includes("医疗器械及保健用品"))?.text ||
      "";
    const label = mainItems
      .filter((item) => item.text === "*医疗器械注册证" || item.text === "医疗器械注册证" || item.text.includes("*医疗器械注册证"))
      .sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left)[0];
    if (!label) {
      return {
        fieldVisible: false,
        categoryText,
        selectedCertificateCount: 0,
        sectionText: ""
      };
    }

    const nextTop =
      mainItems
        .filter(
          (item) =>
            ["医疗器械生产许可证", "赠品资质", "质检报告", "支持达人带货"].some((marker) => item.text.includes(marker)) &&
            item.rect.top > label.rect.top + 20
        )
        .sort((a, b) => a.rect.top - b.rect.top)[0]?.rect.top || label.rect.bottom + 220;
    const sectionText = normalize(
      mainItems
        .filter((item) => item.rect.top >= label.rect.top - 8 && item.rect.top < nextTop)
        .map((item) => item.text)
        .join(" ")
    );
    const countMatch = sectionText.match(/(\d+)\s*\/\s*20/);
    const selectedCertificateCount = countMatch ? Number(countMatch[1]) : 0;
    return {
      fieldVisible: true,
      categoryText,
      selectedCertificateCount,
      sectionText
    };
  });
}

async function ensureMedicalDeviceCertificateFromFirstQualification(
  page: Page,
  runtimeDir: string,
  assets: ProductAssets
): Promise<{ completed: boolean; configuredField: string; issue: string; screenshotFile: string }> {
  await ensurePublishSectionTab(page, "\u5176\u4ed6\u4fe1\u606f");
  await page.waitForTimeout(900);
  await dismissTransientOverlays(page);

  const beforeState = await readMedicalDeviceCertificateState(page);
  const decision = evaluateMedicalDeviceCertificateUploadRule({
    categoryText: beforeState.categoryText || (beforeState.fieldVisible ? "\u533b\u7597\u5668\u68b0" : beforeState.sectionText),
    selectedCertificateCount: beforeState.selectedCertificateCount,
    qualificationImageCount: assets.detailImages.length
  });

  if (decision.action === "not_required") {
    return { completed: true, configuredField: "", issue: "", screenshotFile: "" };
  }
  if (!beforeState.fieldVisible) {
    const screenshotFile = await savePageScreenshot(page, runtimeDir, "publish-page-medical-device-certificate-missing.png").catch(() => "");
    return {
      completed: false,
      configuredField: "",
      issue: "Medical device category requires 医疗器械注册证, but the upload field was not visible.",
      screenshotFile
    };
  }
  if (decision.action === "leave_existing_certificate") {
    const screenshotFile = await savePageScreenshot(page, runtimeDir, "publish-page-medical-device-certificate-existing.png");
    return {
      completed: true,
      configuredField: "medicalDeviceCertificate",
      issue: "",
      screenshotFile
    };
  }
  if (decision.action === "blocked_missing_qualification_image") {
    const screenshotFile = await savePageScreenshot(page, runtimeDir, "publish-page-medical-device-certificate-no-qualification.png").catch(() => "");
    return {
      completed: false,
      configuredField: "",
      issue: decision.issue,
      screenshotFile
    };
  }

  const inputs = await collectFileInputs(page);
  const certificateInput =
    pickBestSectionFileInput(inputs, "\u533b\u7597\u5668\u68b0\u6ce8\u518c\u8bc1", scoreMedicalDeviceCertificateInput) ||
    pickBestFileInput(inputs, scoreMedicalDeviceCertificateInput);
  if (!certificateInput) {
    const screenshotFile = await savePageScreenshot(page, runtimeDir, "publish-page-medical-device-certificate-input-missing.png").catch(() => "");
    return {
      completed: false,
      configuredField: "",
      issue: "Medical device certificate upload input was not found.",
      screenshotFile
    };
  }

  await uploadFilesToInput(page, certificateInput, assets.detailImages.slice(0, 1));
  await page.waitForTimeout(2600);
  await dismissTransientOverlays(page);
  const finalState = await readMedicalDeviceCertificateState(page);
  const screenshotFile = await savePageScreenshot(page, runtimeDir, "publish-page-medical-device-certificate-uploaded.png");
  if (finalState.selectedCertificateCount > 0) {
    return {
      completed: true,
      configuredField: "medicalDeviceCertificate",
      issue: "",
      screenshotFile
    };
  }

  return {
    completed: false,
    configuredField: "",
    issue: `Medical device certificate upload did not reach a filled state. before=${beforeState.selectedCertificateCount}; after=${finalState.selectedCertificateCount}`,
    screenshotFile
  };
}

async function uploadDetailImagesByInputCapability(
  page: Page,
  initialInput: { index: number; multiple: boolean },
  files: string[]
): Promise<number> {
  if (!files.length) {
    return 0;
  }
  if (initialInput.multiple) {
    await page.locator("input[type='file']").nth(initialInput.index).setInputFiles(files);
    return files.length;
  }

  let uploaded = 0;
  for (const file of files) {
    const inputs = await collectFileInputs(page);
    const input = pickBestFileInput(inputs, scoreDetailGraphicInput);
    if (!input) {
      break;
    }
    await page.locator("input[type='file']").nth(input.index).setInputFiles(file);
    uploaded += 1;
    await page.waitForTimeout(1100);
  }
  return uploaded;
}

async function uploadFilesToSectionSlots(
  page: Page,
  sectionLabel: string,
  files: string[],
  scoreInput: (input: { index: number; accept: string; multiple: boolean; parentText: string; sectionLabel?: string }) => number,
  startFileIndex = 0
): Promise<number> {
  if (startFileIndex >= files.length) {
    return 0;
  }

  let uploaded = 0;
  const inputs = await collectFileInputs(page);
  const sectionInputs = inputs
    .filter((input) => input.sectionLabel === sectionLabel)
    .sort((a, b) => a.index - b.index);
  const fallbackInputs = sectionInputs.length
    ? sectionInputs
    : inputs
        .map((input) => ({ input, score: scoreInput(input) }))
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score || a.input.index - b.input.index)
        .map((item) => item.input);

  if (fallbackInputs.length === 1 && fallbackInputs[0].multiple) {
    const selectedFiles = files.slice(startFileIndex);
    if (!selectedFiles.length) {
      return 0;
    }
    await page.locator("input[type='file']").nth(fallbackInputs[0].index).setInputFiles(selectedFiles);
    await page.waitForTimeout(1200);
    await dismissTransientOverlays(page);
    return selectedFiles.length;
  }

  for (let slotOffset = startFileIndex; slotOffset < files.length; slotOffset += 1) {
    const input = fallbackInputs[slotOffset - startFileIndex];
    const file = files[slotOffset];
    if (!input || !file) {
      break;
    }
    await page.locator("input[type='file']").nth(input.index).setInputFiles(file);
    uploaded += 1;
    await page.waitForTimeout(1200);
    await dismissTransientOverlays(page);
  }

  return uploaded;
}

async function uploadMainImagesToSection(page: Page, files: string[]): Promise<number> {
  if (!files.length) {
    return 0;
  }

  let uploaded = 0;
  const initialInputs = await collectFileInputs(page);
  const mainInput =
    initialInputs
      .filter((input) => input.sectionLabel === "\u4e3b\u56fe")
      .filter((input) => input.parentText.includes("\u4e0a\u4f20\u4e3b\u56fe") || input.parentText.includes("\u5546\u54c1\u6b63\u9762\u56fe"))
      .sort((a, b) => scoreMainGraphicInput(b) - scoreMainGraphicInput(a) || a.index - b.index)[0] ||
    pickBestSectionFileInput(initialInputs, "\u4e3b\u56fe", scoreMainGraphicInput);

  if (!mainInput) {
    return 0;
  }

  const auxiliaryFiles = files.slice(1);
  const auxiliaryInputs = (await collectFileInputs(page))
    .filter((input) => input.sectionLabel === "\u4e3b\u56fe")
    .filter((input) => input.index !== mainInput.index)
    .filter((input) => input.parentText.includes("\u4e0a\u4f20\u8f85\u52a9\u56fe"))
    .sort((a, b) => a.index - b.index);

  if (mainInput.multiple && auxiliaryFiles.length > auxiliaryInputs.length) {
    await page.locator("input[type='file']").nth(mainInput.index).setInputFiles(files);
    uploaded = files.length;
    await waitForPreviewCount(page, () => countMainImagePreviews(page), uploaded).catch(() => 0);
    await dismissTransientOverlays(page);
    return uploaded;
  }

  await page.locator("input[type='file']").nth(mainInput.index).setInputFiles(files[0]);
  uploaded += 1;
  await waitForPreviewCount(page, () => countMainImagePreviews(page), uploaded).catch(() => 0);
  await dismissTransientOverlays(page);

  if (!auxiliaryFiles.length) {
    return uploaded;
  }

  for (let index = 0; index < auxiliaryFiles.length; index += 1) {
    const input = auxiliaryInputs[index];
    if (!input) {
      break;
    }
    await page.locator("input[type='file']").nth(input.index).setInputFiles(auxiliaryFiles[index]);
    uploaded += 1;
    await waitForPreviewCount(page, () => countMainImagePreviews(page), uploaded).catch(() => 0);
    await dismissTransientOverlays(page);
  }
  return uploaded;
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
        if (
          rect.width < 40 ||
          rect.height < 40 ||
          style.display === "none" ||
          style.visibility === "hidden" ||
          style.position === "fixed" ||
          style.position === "sticky"
        ) {
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
        if (
          rect.width < 40 ||
          rect.height < 40 ||
          style.display === "none" ||
          style.visibility === "hidden" ||
          style.position === "fixed" ||
          style.position === "sticky"
        ) {
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
        if (
          rect.width < 40 ||
          rect.height < 40 ||
          style.display === "none" ||
          style.visibility === "hidden" ||
          style.position === "fixed" ||
          style.position === "sticky"
        ) {
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
  const forbiddenSections = ["主图3:4"];

  for (const sectionName of forbiddenSections) {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const previews = await getGraphicSectionPreviewRects(page, sectionName);
      if (!previews.length) {
        break;
      }

      const target = previews[previews.length - 1];
      await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2);
      await page.waitForTimeout(250);
      await dispatchDomClickAtPoint(page, { x: target.x + target.width - 10, y: target.y + 10 }).catch(() => false);
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
        if (
          rect.width < 40 ||
          rect.height < 40 ||
          style.display === "none" ||
          style.visibility === "hidden" ||
          style.position === "fixed" ||
          style.position === "sticky"
        ) {
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
    const candidates = Array.from(document.querySelectorAll("div, span, button, a, [role='button'], i, svg, use, path"))
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
          el.getAttribute("href") || "",
          el.getAttribute("xlink:href") || "",
          String(el.className || "")
        ].join(" ");
        const normalizedMarker = marker.replace(/\s+/g, "").toLowerCase();
        const centerX = rect.x + rect.width / 2;
        const centerY = rect.y + rect.height / 2;
        const horizontallyAligned = centerX >= target.x - 30 && centerX <= target.x + target.width + 140;
        const belowPreview = centerY >= target.y + target.height - 30 && centerY <= target.y + target.height + 110;
        const upperFallback = centerY >= target.y - 120 && centerY <= target.y + 50;

        if (!horizontallyAligned || (!belowPreview && !upperFallback)) {
          return null;
        }

        const hasDeleteText = normalizedMarker.includes("删除");
        const hasDeleteSemantics = /(delete|remove|trash|shanchu|icon-delete|icon-trash|semi-icon-close|close)/.test(normalizedMarker);
        const looksLikeActionControl = /(actionafter|preview-button|material-button|icon|shanchu|删除)/.test(normalizedMarker);
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
  const forbiddenSections = ["主图3:4"];

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
      await dispatchDomClickAtPoint(page, deleteControl).catch(() => false);
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
    ({ targetSection, sectionLabels, uploadPlaceholderPattern }) => {
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

      const contentLabels = labels.filter((item) => item.left > 250);
      const pickSectionLabel = (items: Array<{ text: string; top: number; bottom: number; left: number }>, section: string) =>
        items
          .map((item) => {
            const normalized = item.text.replace(/^\*/, "").trim();
            const exact = normalized === section;
            const starts = normalized.startsWith(section);
            const shortIncludes = normalized.includes(section) && normalized.length <= section.length + 80;
            if (!exact && !starts && !shortIncludes) {
              return null;
            }
            return {
              item,
              score: (exact ? 1000 : starts ? 700 : 300) - normalized.length - item.left / 1000
            };
          })
          .filter(Boolean)
          .sort((a, b) => (b!.score || 0) - (a!.score || 0))[0]?.item || null;
      const current = pickSectionLabel(contentLabels, targetSection);
      if (!current) {
        return 0;
      }

      const nextTop =
        contentLabels
          .filter((item) => sectionLabels.some((section) => item.text.replace(/^\*/, "").trim() === section) && item.top > current.top)
          .sort((a, b) => a.top - b.top)[0]
          ?.top || current.bottom + 500;
      const effectiveNextTop = nextTop;

      const isUploadPlaceholderContext = (el: HTMLElement): boolean => {
        const context = [el.textContent || "", el.parentElement?.textContent || "", el.closest("div")?.textContent || ""]
          .join(" ")
          .replace(/\s+/g, "");
        return !context.includes("\u5220\u9664") && new RegExp(uploadPlaceholderPattern).test(context);
      };

      const imageLike = Array.from(document.querySelectorAll("img, [style*='background-image']"))
        .map((el) => el as HTMLElement)
        .map((el) => {
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          if (
            rect.width < 40 ||
            rect.height < 40 ||
            style.display === "none" ||
            style.visibility === "hidden" ||
            style.position === "fixed" ||
            style.position === "sticky"
          ) {
            return null;
          }
          if (isUploadPlaceholderContext(el)) {
            return null;
          }
          return {
            key: `${Math.round(rect.left)}-${Math.round(rect.top)}-${Math.round(rect.width)}-${Math.round(rect.height)}`,
            top: rect.top,
            left: rect.left
          };
        })
        .filter(Boolean)
          .filter((item) => item!.top >= current.top - 20 && item!.top < effectiveNextTop - 10 && item!.left > current.left);

      return Array.from(new Set(imageLike.map((item) => item!.key))).length;
    },
    { targetSection: sectionName, sectionLabels: GRAPHIC_SECTION_LABELS, uploadPlaceholderPattern: "\u4e0a\u4f20(?:\u767d\u5e95\u56fe|\u4e3b\u56fe|\u8f85\u52a9\u56fe)" }
  );
}

async function countMainImagePreviews(page: Page): Promise<number> {
  return countGraphicSectionPreviewsStrict(page, "\u4e3b\u56fe").catch(() => 0);
}

async function countWhiteBackgroundPreviews(page: Page): Promise<number> {
  return countGraphicSectionPreviewsStrict(page, "\u767d\u5e95\u56fe").catch(() => 0);
}

async function countMain34Previews(page: Page): Promise<number> {
  return countGraphicSectionPreviewsStrict(page, "\u4e3b\u56fe3:4").catch(() => 0);
}

async function readDetailIndicatorCount(page: Page): Promise<number | null> {
  return page
    .evaluate(() => {
      const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
      const pattern = /(?:\u5546\s*\u54c1\s*\u8be6\s*\u60c5\s*\u56fe\s*\u7247|\u5546\s*\u8be6\s*\u56fe\s*\u7247)\s*[\(（]\s*(\d+)\s*\/\s*50\s*[\)）]/;
      const visibleTexts = Array.from(document.querySelectorAll("body *"))
        .map((el) => {
          const node = el as HTMLElement;
          const rect = node.getBoundingClientRect();
          const style = window.getComputedStyle(node);
          if (rect.width <= 0 || rect.height <= 0 || style.display === "none" || style.visibility === "hidden") {
            return "";
          }
          return normalize(node.textContent || "");
        })
        .filter(Boolean);

      for (const text of visibleTexts) {
        const match = text.match(pattern);
        if (match) {
          return Number(match[1]);
        }
      }

      const bodyMatch = normalize(document.body.innerText || document.body.textContent || "").match(pattern);
      return bodyMatch ? Number(bodyMatch[1]) : null;
    })
    .catch(() => null);
}

async function countDetailImagePreviews(page: Page): Promise<number> {
  const indicatorCount = await readDetailIndicatorCount(page);
  if (typeof indicatorCount === "number") {
    return indicatorCount;
  }

  const counts = await Promise.all([
    countGraphicSectionPreviewsStrict(page, "\u8be6\u60c5\u9875").catch(() => 0),
    countGraphicSectionPreviewsStrict(page, "\u5546\u54c1\u8be6\u60c5").catch(() => 0)
  ]);
  return Math.max(...counts);
}

async function waitForPreviewCount(
  page: Page,
  readCount: () => Promise<number>,
  expectedCount: number,
  timeoutMs = 30000
): Promise<number> {
  const startedAt = Date.now();
  let lastCount = await readCount().catch(() => 0);
  while (Date.now() - startedAt < timeoutMs) {
    if (lastCount >= expectedCount) {
      return lastCount;
    }
    await page.waitForTimeout(1200);
    await dismissTransientOverlays(page);
    lastCount = await readCount().catch(() => lastCount);
  }
  return lastCount;
}

async function getGraphicSectionPreviewRectsStrict(
  page: Page,
  sectionName: string
): Promise<Array<{ x: number; y: number; width: number; height: number }>> {
  return page.evaluate(
    ({ targetSection, sectionLabels, uploadPlaceholderPattern }) => {
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

      const contentLabels = labels.filter((item) => item.left > 250);
      const pickSectionLabel = (items: Array<{ text: string; top: number; bottom: number; left: number }>, section: string) =>
        items
          .map((item) => {
            const normalized = item.text.replace(/^\*/, "").trim();
            const exact = normalized === section;
            const starts = normalized.startsWith(section);
            const shortIncludes = normalized.includes(section) && normalized.length <= section.length + 80;
            if (!exact && !starts && !shortIncludes) {
              return null;
            }
            return {
              item,
              score: (exact ? 1000 : starts ? 700 : 300) - normalized.length - item.left / 1000
            };
          })
          .filter(Boolean)
          .sort((a, b) => (b!.score || 0) - (a!.score || 0))[0]?.item || null;
      const current = pickSectionLabel(contentLabels, targetSection);
      if (!current) {
        return [];
      }

      const nextTop =
        contentLabels
          .filter((item) => sectionLabels.some((section) => item.text.replace(/^\*/, "").trim() === section) && item.top > current.top)
          .sort((a, b) => a.top - b.top)[0]
          ?.top || current.bottom + 500;
      const effectiveNextTop = nextTop;

      const isUploadPlaceholderContext = (el: HTMLElement): boolean => {
        const context = [el.textContent || "", el.parentElement?.textContent || "", el.closest("div")?.textContent || ""]
          .join(" ")
          .replace(/\s+/g, "");
        return !context.includes("\u5220\u9664") && new RegExp(uploadPlaceholderPattern).test(context);
      };

      return Array.from(document.querySelectorAll("img, [style*='background-image']"))
        .map((el) => el as HTMLElement)
        .map((el) => {
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          if (
            rect.width < 40 ||
            rect.height < 40 ||
            style.display === "none" ||
            style.visibility === "hidden" ||
            style.position === "fixed" ||
            style.position === "sticky"
          ) {
            return null;
          }
          if (isUploadPlaceholderContext(el)) {
            return null;
          }
          if (rect.top < current.top - 20 || rect.top > effectiveNextTop - 10 || rect.left <= current.left) {
            return null;
          }
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        })
        .filter(Boolean) as Array<{ x: number; y: number; width: number; height: number }>;
    },
    { targetSection: sectionName, sectionLabels: GRAPHIC_SECTION_LABELS, uploadPlaceholderPattern: "\u4e0a\u4f20(?:\u767d\u5e95\u56fe|\u4e3b\u56fe|\u8f85\u52a9\u56fe)" }
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
    if (sectionName === "\u767d\u5e95\u56fe") {
      const beforeCount = await countWhiteBackgroundPreviews(page).catch(() => 0);
      const removedCount = await clearWhiteBackgroundPreviewsStrict(page).catch(() => 0);
      if (removedCount > 0 || (beforeCount > 0 && (await countWhiteBackgroundPreviews(page).catch(() => beforeCount)) === 0)) {
        removedSections.push(sectionName);
      }
      continue;
    }
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
      if (!deleteControl) {
        break;
      }
      await dispatchDomClickAtPoint(page, deleteControl).catch(() => false);

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

async function clearGraphicSectionPreviewsStrict(page: Page, sectionName: string, maxAttempts = 10): Promise<number> {
  let removedCount = 0;
  await scrollGraphicSectionIntoView(page, sectionName).catch(() => false);

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const beforeCount = await countGraphicSectionPreviewsStrict(page, sectionName).catch(() => 0);
    if (!beforeCount) {
      break;
    }

    const previews = await getGraphicSectionPreviewRectsStrict(page, sectionName).catch(() => []);
    if (!previews.length) {
      break;
    }

    const target = previews[previews.length - 1];
    await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2).catch(() => {});
    await page.waitForTimeout(250);
    const deleteControl = await findDeleteControlNearPreviewSafe(page, target).catch(() => null);
    if (!deleteControl) {
      break;
    }
    await dispatchDomClickAtPoint(page, deleteControl).catch(() => false);

    await page.waitForTimeout(500);
    await clickConfirmIfVisibleStrict(page);
    await dismissTransientOverlays(page);

    const afterCount = await countGraphicSectionPreviewsStrict(page, sectionName).catch(() => beforeCount);
    if (afterCount < beforeCount) {
      removedCount += beforeCount - afterCount;
      continue;
    }
    break;
  }

  return removedCount;
}

async function clearWhiteBackgroundPreviewsStrict(page: Page, maxAttempts = 10): Promise<number> {
  let removedCount = 0;
  await scrollGraphicSectionIntoView(page, "\u767d\u5e95\u56fe").catch(() => false);

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const beforeCount = await countWhiteBackgroundPreviews(page).catch(() => 0);
    if (!beforeCount) {
      break;
    }

    const target = await page.evaluate(() => {
      const normalize = (value: string): string => String(value || "").replace(/\s+/g, " ").trim();
      const labels = Array.from(document.querySelectorAll("body *"))
        .map((el) => {
          const rect = (el as HTMLElement).getBoundingClientRect();
          return { text: normalize((el as HTMLElement).textContent || ""), rect };
        })
        .filter((item) => item.text && item.rect.width > 0 && item.rect.height > 0 && item.rect.left > 250);
      const label = labels
        .filter((item) => item.text === "\u767d\u5e95\u56fe" || item.text.startsWith("\u767d\u5e95\u56fe"))
        .sort((a, b) => a.text.length - b.text.length)[0];
      if (!label) {
        return null;
      }
      const nextTop =
        labels
          .filter((item) => ["\u5546\u54c1\u8be6\u60c5", "\u8be6\u60c5\u9875"].includes(item.text) && item.rect.top > label.rect.top)
          .sort((a, b) => a.rect.top - b.rect.top)[0]?.rect.top || label.rect.bottom + 500;

      const image = Array.from(document.querySelectorAll("img, [style*='background-image']"))
        .map((el) => {
          const rect = (el as HTMLElement).getBoundingClientRect();
          const style = window.getComputedStyle(el as HTMLElement);
          if (
            rect.width < 40 ||
            rect.height < 40 ||
            style.display === "none" ||
            style.visibility === "hidden" ||
            style.position === "fixed" ||
            style.position === "sticky" ||
            rect.top < label.rect.top - 20 ||
            rect.top >= nextTop - 10 ||
            rect.left <= label.rect.left
          ) {
            return null;
          }
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        })
        .filter(Boolean)[0] as { x: number; y: number; width: number; height: number } | undefined;

      return image || null;
    });
    if (!target) {
      break;
    }

    await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2).catch(() => {});
    await page.waitForTimeout(800);
    const deleteControl = await page
      .evaluate((preview) => {
        const controls = Array.from(document.querySelectorAll("div, span, button, a, [role='button'], i, svg"))
          .map((el) => {
            const rect = (el as HTMLElement).getBoundingClientRect();
            const text = ((el as HTMLElement).textContent || "").trim();
            const marker = [
              text,
              el.getAttribute("aria-label") || "",
              el.getAttribute("title") || "",
              String((el as HTMLElement).className || "")
            ]
              .join(" ")
              .replace(/\s+/g, "")
              .toLowerCase();
            const centerX = rect.x + rect.width / 2;
            const centerY = rect.y + rect.height / 2;
            const inPopoverRange =
              centerX >= preview.x - 30 &&
              centerX <= preview.x + preview.width + 170 &&
              centerY >= preview.y - 160 &&
              centerY <= preview.y + preview.height + 130;
            if (!inPopoverRange || !(marker.includes("\u5220\u9664") || marker.includes("delete") || marker.includes("trash"))) {
              return null;
            }
            return {
              x: centerX,
              y: centerY,
              score: (text === "\u5220\u9664" ? 1000 : 0) + centerX - Math.abs(centerY - (preview.y - 35))
            };
          })
          .filter(Boolean)
          .sort((a, b) => (b!.score || 0) - (a!.score || 0));
        return controls[0] || null;
      }, target)
      .catch(() => null);

    if (deleteControl) {
      await dispatchDomClickAtPoint(page, deleteControl).catch(() => false);
    } else {
      await dispatchDomClickAtPoint(page, { x: target.x + target.width + 82, y: target.y - 38 }).catch(() => false);
    }
    await page.waitForTimeout(1000);
    await clickConfirmIfVisibleStrict(page);
    await dismissTransientOverlays(page);
    await page.waitForTimeout(800);

    const afterCount = await countWhiteBackgroundPreviews(page).catch(() => beforeCount);
    if (afterCount < beforeCount) {
      removedCount += beforeCount - afterCount;
      continue;
    }
    break;
  }

  return removedCount;
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

async function verifyForbiddenGraphicSectionsEmptyOnPage(
  page: Page,
  runtimeDir: string,
  screenshotFileName: string
): Promise<{ remainingSections: string[]; screenshotFile: string }> {
  const remainingSections = await listRemainingForbiddenGraphicSections(page);
  const screenshotFile = await savePageScreenshot(page, runtimeDir, screenshotFileName);
  return { remainingSections, screenshotFile };
}

async function repairForbiddenGraphicSectionsBeforePublish(
  page: Page,
  runtimeDir: string,
  screenshotFileName: string
): Promise<{ removedSections: string[]; remainingSections: string[]; screenshotFile: string }> {
  const repairResult = await enforceForbiddenGraphicSectionsEmpty(page, runtimeDir, screenshotFileName);
  const remainingSections = await listRemainingForbiddenGraphicSections(page);
  return {
    removedSections: repairResult.removedSections,
    remainingSections,
    screenshotFile: repairResult.screenshotFile
  };
}

async function clickFillFromMainForDetailSection(page: Page): Promise<boolean> {
  await ensurePublishSectionTab(page, "\u56fe\u6587\u4fe1\u606f");
  const detailSectionVisible =
    (await scrollGraphicSectionIntoView(page, "\u5546\u54c1\u8be6\u60c5").catch(() => false)) ||
    (await scrollGraphicSectionIntoView(page, "\u8be6\u60c5\u9875").catch(() => false));
  if (!detailSectionVisible) {
    await scrollPublishSectionContentIntoView(page, "\u56fe\u6587\u4fe1\u606f").catch(() => false);
  }
  await page.mouse.wheel(0, 500).catch(() => {});
  await page.waitForTimeout(800);
  await dismissTransientOverlays(page);

  const beforeCount = (await readDetailIndicatorCount(page).catch(() => null)) || 0;
  const button = page.getByRole("button", { name: "\u4ece\u4e3b\u56fe\u586b\u5165" }).first();
  const textButton = page.getByText("\u4ece\u4e3b\u56fe\u586b\u5165", { exact: true }).first();
  let clicked = false;
  if (await button.count()) {
    await button.scrollIntoViewIfNeeded().catch(() => {});
    clicked = await button.click({ timeout: 3000 }).then(() => true).catch(() => false);
  } else if (await textButton.count()) {
    await textButton.scrollIntoViewIfNeeded().catch(() => {});
    clicked = await textButton.click({ timeout: 3000 }).then(() => true).catch(() => false);
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
      const afterCount = (await readDetailIndicatorCount(page).catch(() => null)) || 0;
      if ((beforeCount === 0 && afterCount > 0) || (beforeCount > 0 && afterCount >= beforeCount)) {
        return true;
      }
    }
  }
  return false;
}

async function uploadQualificationImagesToDetailSection(
  page: Page,
  assets: ProductAssets,
  filledFromMain: boolean,
  expectedDetailCount: number
): Promise<boolean> {
  if (!assets.detailImages.length) {
    return false;
  }
  const currentCount = await countDetailImagePreviews(page).catch(() => 0);

  if (currentCount === 0 && !filledFromMain) {
    const filled = await clickFillFromMainForDetailSection(page).catch(() => false);
    if (!filled) {
      return false;
    }
  }

  await ensurePublishSectionTab(page, "\u56fe\u6587\u4fe1\u606f");
  const detailSectionVisible =
    (await scrollGraphicSectionIntoView(page, "\u5546\u54c1\u8be6\u60c5").catch(() => false)) ||
    (await scrollGraphicSectionIntoView(page, "\u8be6\u60c5\u9875").catch(() => false));
  if (!detailSectionVisible) {
    await scrollPublishSectionContentIntoView(page, "\u56fe\u6587\u4fe1\u606f").catch(() => false);
  }
  await page.mouse.wheel(0, 500).catch(() => {});
  await page.waitForTimeout(800);
  await dismissTransientOverlays(page);

  const inputs = await collectFileInputs(page);
  const detailInput = pickBestSectionFileInput(inputs, "\u5546\u54c1\u8be6\u60c5", scoreDetailGraphicInput) ||
    pickBestSectionFileInput(inputs, "\u8be6\u60c5\u9875", scoreDetailGraphicInput) ||
    pickBestFileInput(inputs, scoreDetailGraphicInput);
  if (!detailInput) {
    return (await countDetailImagePreviews(page).catch(() => 0)) >= expectedDetailCount;
  }

  await uploadDetailImagesByInputCapability(page, detailInput, assets.detailImages);
  await page.waitForTimeout(2200);
  await dismissTransientOverlays(page);
  return (await countDetailImagePreviews(page).catch(() => 0)) >= expectedDetailCount;
}

async function clearDetailImagePreviewsStrict(page: Page, maxAttempts = 12): Promise<number> {
  let removedCount = 0;
  await ensurePublishSectionTab(page, "\u56fe\u6587\u4fe1\u606f");
  const detailSectionVisible =
    (await scrollGraphicSectionIntoView(page, "\u5546\u54c1\u8be6\u60c5").catch(() => false)) ||
    (await scrollGraphicSectionIntoView(page, "\u8be6\u60c5\u9875").catch(() => false));
  if (!detailSectionVisible) {
    await scrollPublishSectionContentIntoView(page, "\u56fe\u6587\u4fe1\u606f").catch(() => false);
  }
  await page.mouse.wheel(0, 500).catch(() => {});
  await page.waitForTimeout(800);
  await dismissTransientOverlays(page);

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const beforeCount = await countDetailImagePreviews(page).catch(() => 0);
    if (!beforeCount) {
      break;
    }

    let previews = await getGraphicSectionPreviewRectsStrict(page, "\u8be6\u60c5\u9875").catch(() => []);
    if (!previews.length) {
      previews = await getGraphicSectionPreviewRectsStrict(page, "\u5546\u54c1\u8be6\u60c5").catch(() => []);
    }
    if (!previews.length) {
      break;
    }

    const target = previews[previews.length - 1];
    await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2).catch(() => {});
    await page.waitForTimeout(450);
    const deleteControl = await findDeleteControlNearPreviewSafe(page, target).catch(() => null);
    if (deleteControl) {
      await dispatchDomClickAtPoint(page, deleteControl).catch(() => false);
    } else {
      await dispatchDomClickAtPoint(page, { x: target.x + target.width + 82, y: target.y - 38 }).catch(() => false);
    }
    await page.waitForTimeout(900);
    await clickConfirmIfVisibleStrict(page);
    await dismissTransientOverlays(page);
    await page.waitForTimeout(700);

    const afterCount = await countDetailImagePreviews(page).catch(() => beforeCount);
    if (afterCount < beforeCount) {
      removedCount += beforeCount - afterCount;
      continue;
    }
    break;
  }

  return removedCount;
}

async function ensureDetailImagesFromMainThenQualifications(
  page: Page,
  runtimeDir: string,
  assets: ProductAssets
): Promise<{ completed: boolean; filledFromMain: boolean; group: string; issue: string }> {
  if (!assets.detailImages.length) {
    return {
      completed: false,
      filledFromMain: false,
      group: "",
      issue: "No Feishu qualification images are available for 商品详情 upload."
    };
  }

  const existingDetailCount = await countDetailImagePreviews(page).catch(() => 0);
  if (existingDetailCount > 0) {
    await clearDetailImagePreviewsStrict(page, Math.max(12, existingDetailCount + 3)).catch(() => 0);
    await page.waitForTimeout(800);
  }

  let filledFromMain = false;
  filledFromMain = await clickFillFromMainForDetailSection(page).catch(() => false);
  const countAfterFillFromMain = await countDetailImagePreviews(page).catch(() => 0);
  if (!filledFromMain || countAfterFillFromMain < 1) {
    await savePageScreenshot(page, runtimeDir, "publish-page-detail-fill-from-main-failed.png").catch(() => "");
    return {
      completed: false,
      filledFromMain,
      group: "",
      issue: "Detail images were not available after clicking fill-from-main."
    };
  }

  const expectedDetailCount = countAfterFillFromMain + assets.detailImages.length;
  const detailCompleted = await uploadQualificationImagesToDetailSection(page, assets, filledFromMain, expectedDetailCount).catch(() => false);
  const finalCount = await waitForPreviewCount(page, () => countDetailImagePreviews(page), expectedDetailCount, 60000);
  const detailRule = evaluateDetailImageCompletion({
    filledFromMain,
    qualificationImageCount: assets.detailImages.length,
    finalDetailCount: finalCount,
    expectedDetailCount
  });
  const detailOutcome = evaluateDetailUploadOutcome({
    uploadActionCompleted: detailCompleted,
    detailRule
  });
  if (detailOutcome.passed) {
    return {
      completed: true,
      filledFromMain,
      group: filledFromMain ? "detailImages:fillFromMainThenUpload" : "detailImages:existingWithQualifications",
      issue: ""
    };
  }

  await savePageScreenshot(page, runtimeDir, "publish-page-detail-qualification-upload-failed.png").catch(() => "");
  return {
    completed: false,
    filledFromMain,
    group: "",
    issue: detailOutcome.issue || `Detail images did not reach expected count after fill-from-main plus Feishu qualifications. expected=${expectedDetailCount}; actual=${finalCount}; qualificationImages=${assets.detailImages.length}`
  };
}

async function uploadWhiteBackgroundImage(page: Page, assets: ProductAssets): Promise<boolean> {
  if (!assets.whiteBackgroundImages.length) {
    return false;
  }

  await ensurePublishSectionTab(page, "\u56fe\u6587\u4fe1\u606f");
  await scrollGraphicSectionIntoView(page, "\u767d\u5e95\u56fe").catch(() => false);
  await page.waitForTimeout(800);
  await dismissTransientOverlays(page);

  const firstInputs = await collectFileInputs(page);
  const firstWhiteInput = pickBestSectionFileInput(firstInputs, "\u767d\u5e95\u56fe", scoreWhiteBackgroundGraphicInput);
  if (firstWhiteInput) {
    await uploadFilesToInput(page, firstWhiteInput, assets.whiteBackgroundImages.slice(0, 1));
    await page.waitForTimeout(2200);
    if ((await countWhiteBackgroundPreviews(page)) > 0) {
      return true;
    }
  }

  async function clickWhiteBackgroundDeleteFallback(): Promise<boolean> {
    return page.evaluate(() => {
      const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
      const labels = Array.from(document.querySelectorAll("body *"))
        .map((el) => el as HTMLElement)
        .map((el) => {
          const rect = el.getBoundingClientRect();
          const text = normalize(el.textContent || "");
          if (!text || rect.width <= 0 || rect.height <= 0) return null;
          return { el, text, rect };
        })
        .filter(Boolean) as Array<{ el: HTMLElement; text: string; rect: DOMRect }>;
      const current = labels.find((item) => item.text === "白底图" || item.text.startsWith("白底图"));
      if (!current) return false;
      const nextTop =
        labels
          .filter((item) => ["商品详情", "详情页"].some((label) => item.text === label || item.text.startsWith(label)) && item.rect.top > current.rect.top)
          .sort((a, b) => a.rect.top - b.rect.top)[0]?.rect.top || current.rect.bottom + 520;
      const deleteControls = Array.from(document.querySelectorAll("button, [role='button'], span, div, a"))
        .map((el) => el as HTMLElement)
        .map((el) => {
          const rect = el.getBoundingClientRect();
          const text = normalize(el.textContent || "");
          const marker = [text, el.getAttribute("aria-label") || "", el.getAttribute("title") || "", String(el.className || "")]
            .join(" ")
            .toLowerCase();
          if (rect.width <= 0 || rect.height <= 0 || rect.top < current.rect.bottom - 30 || rect.top > nextTop - 5) return null;
          const looksDelete = text === "删除" || /(delete|remove|trash|icon-delete|icon-trash|semi-icon-close|close)/.test(marker);
          if (!looksDelete) return null;
          return { el, score: (text === "删除" ? 1000 : 0) - Math.abs(rect.top - current.rect.bottom) };
        })
        .filter(Boolean)
        .sort((a, b) => (b?.score || 0) - (a?.score || 0));
      const target = deleteControls[0]?.el || null;
      target?.click();
      return Boolean(target);
    });
  }

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const beforeCount = await countWhiteBackgroundPreviews(page);
    if (!beforeCount) {
      break;
    }
    const previews = await getGraphicSectionPreviewRectsStrict(page, "\u767d\u5e95\u56fe");
    if (!previews.length) {
      break;
    }
    const target = previews[previews.length - 1];
    await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2);
    await page.waitForTimeout(250);
    const deleteControl = await findDeleteControlNearPreviewSafe(page, target);
    if (deleteControl) {
      await dispatchDomClickAtPoint(page, deleteControl).catch(() => false);
    } else {
      const clickedFallback = await clickWhiteBackgroundDeleteFallback().catch(() => false);
      if (!clickedFallback) {
        await dispatchDomClickAtPoint(page, { x: target.x + target.width - 10, y: target.y + 10 }).catch(() => false);
      }
    }
    await page.waitForTimeout(500);
    await clickConfirmIfVisibleStrict(page);
    await dismissTransientOverlays(page);
    const afterCount = await countWhiteBackgroundPreviews(page);
    if (afterCount >= beforeCount) {
      break;
    }
  }
  if ((await countWhiteBackgroundPreviews(page)) > 0) {
    return false;
  }

  const inputs = await collectFileInputs(page);
  const whiteInput = pickBestSectionFileInput(inputs, "\u767d\u5e95\u56fe", scoreWhiteBackgroundGraphicInput);
  if (!whiteInput) {
    return false;
  }

  await uploadFilesToInput(page, whiteInput, assets.whiteBackgroundImages.slice(0, 1));
  await page.waitForTimeout(1800);
  return (await countWhiteBackgroundPreviews(page)) > 0;
}

function graphicUploadGroupsComplete(uploadedGroups: string[]): boolean {
  const detailDone = uploadedGroups.some(
    (item) =>
      item === "detailImages" ||
      item === "detailImages:fillFromMainThenUpload" ||
      item === "detailImages:existingWithQualifications"
  );
  return uploadedGroups.includes("mainImages") && uploadedGroups.includes("optionalGraphicSectionsCleared") && detailDone;
}

async function resetGraphicModuleOnPage(page: Page, runtimeDir: string, screenshotFileName: string): Promise<string> {
  await ensurePublishSectionTab(page, "\u56fe\u6587\u4fe1\u606f");
  await dismissTransientOverlays(page);

  const mainCount = await countMainImagePreviews(page).catch(() => 0);
  if (mainCount > 0) {
    await clearGraphicSectionPreviewsStrict(page, "\u4e3b\u56fe", Math.max(10, mainCount + 3)).catch(() => 0);
    await page.waitForTimeout(800);
  }

  await enforceForbiddenGraphicSectionsEmpty(page, runtimeDir, screenshotFileName.replace(/\.png$/, "-forbidden.png")).catch(() => ({
    removedSections: [],
    remainingSections: [],
    screenshotFile: ""
  }));

  const detailCount = await countDetailImagePreviews(page).catch(() => 0);
  if (detailCount > 0) {
    await clearDetailImagePreviewsStrict(page, Math.max(12, detailCount + 3)).catch(() => 0);
    await page.waitForTimeout(800);
  }

  await dismissTransientOverlays(page);
  return savePageScreenshot(page, runtimeDir, screenshotFileName);
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

    const mainInput = pickBestSectionFileInput(inputs, "\u4e3b\u56fe", scoreMainGraphicInput);
    if (!uploadIssue && mainInput && assets.mainImages.length) {
      const existingMainCount = await countMainImagePreviews(page).catch(() => 0);
      if (existingMainCount > 0) {
        await clearGraphicSectionPreviewsStrict(page, "\u4e3b\u56fe", Math.max(10, existingMainCount + 3)).catch(() => 0);
        await page.waitForTimeout(800);
      }
      await uploadMainImagesToSection(page, assets.mainImages);
      const uploadedMainCount = await waitForPreviewCount(page, () => countMainImagePreviews(page), assets.mainImages.length);
      if (uploadedMainCount >= assets.mainImages.length) {
        uploadedGroups.push("mainImages");
      } else {
        uploadIssue = `Main image slots did not contain ${assets.mainImages.length} images after upload; actual=${uploadedMainCount}.`;
      }
    }
    if (!uploadIssue && uploadedGroups.includes("mainImages")) {
      const forbiddenResult = await enforceForbiddenGraphicSectionsEmpty(
        page,
        runtimeDir,
        "publish-page-forbidden-graphic-sections-cleared.png"
      );
      if (forbiddenResult.remainingSections.length) {
        uploadIssue = `Forbidden optional graphic sections still contain images: ${forbiddenResult.remainingSections.join(", ")}`;
      } else {
        uploadedGroups.push("optionalGraphicSectionsCleared");
      }
    } else if (!uploadIssue && !mainInput) {
    const existingMainPreviewCount = await countMainImagePreviews(page);
    if (existingMainPreviewCount >= assets.mainImages.length) {
      uploadedGroups.push("mainImages");
      const forbiddenResult = await enforceForbiddenGraphicSectionsEmpty(
        page,
        runtimeDir,
        "publish-page-forbidden-graphic-sections-cleared-existing-main.png"
      );
      if (forbiddenResult.remainingSections.length) {
        uploadIssue = `Forbidden optional graphic sections still contain images: ${forbiddenResult.remainingSections.join(", ")}`;
      } else {
        uploadedGroups.push("optionalGraphicSectionsCleared");
      }
      } else {
        logWarn("Main image upload input was not found; checking existing main/white-background previews before failing.");
      }
    } else if (!uploadIssue && !assets.mainImages.length) {
      uploadIssue = "Main image upload input was not found.";
    }

    await page.mouse.wheel(0, 900).catch(() => {});
    await page.waitForTimeout(800);

    let filledFromMain = false;
    if (!uploadIssue) {
      const detailResult = await ensureDetailImagesFromMainThenQualifications(page, runtimeDir, assets);
      filledFromMain = detailResult.filledFromMain;
      if (detailResult.completed) {
        uploadedGroups.push(detailResult.group);
      } else {
        uploadIssue = detailResult.issue || "Detail images did not include fill-from-main result plus Feishu qualification images.";
      }
    }

  if (!uploadIssue) {
    const forbiddenResult = await enforceForbiddenGraphicSectionsEmpty(
      page,
      runtimeDir,
      "publish-page-forbidden-graphic-sections-final-check.png"
    );
    if (forbiddenResult.remainingSections.length) {
      uploadIssue = `Forbidden optional graphic sections still contain images after detail upload: ${forbiddenResult.remainingSections.join(", ")}`;
    } else if (!uploadedGroups.includes("optionalGraphicSectionsCleared")) {
      uploadedGroups.push("optionalGraphicSectionsCleared");
    }
  }

  const finalMainPreviewCount = await countMainImagePreviews(page).catch(() => 0);
  if (!uploadedGroups.includes("mainImages") && finalMainPreviewCount >= assets.mainImages.length) {
    uploadedGroups.push("mainImages");
  }
  if (!uploadIssue && !uploadedGroups.includes("mainImages")) {
    uploadIssue = "Main image upload input was not found and no existing main/white-background preview was detected.";
  }
  if (!uploadIssue && !uploadedGroups.includes("optionalGraphicSectionsCleared")) {
    uploadIssue = "Optional graphic sections were not confirmed as cleared.";
  }
  const finalDetailPreviewCount = await countDetailImagePreviews(page).catch(() => 0);
  if (
    !uploadedGroups.some(
      (item) =>
        item === "detailImages" ||
        item === "detailImages:fillFromMainThenUpload" ||
        item === "detailImages:existingWithQualifications"
    ) &&
    finalDetailPreviewCount >= assets.detailImages.length + 1
  ) {
    uploadedGroups.push(filledFromMain ? "detailImages:fillFromMainThenUpload" : "detailImages");
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

  const mainInput = pickBestSectionFileInput(inputs, "\u4e3b\u56fe", scoreMainGraphicInput);
  if (!uploadIssue && mainInput && assets.mainImages.length) {
    const existingMainCount = await countMainImagePreviews(page).catch(() => 0);
    if (existingMainCount > 0) {
      await clearGraphicSectionPreviewsStrict(page, "\u4e3b\u56fe", Math.max(10, existingMainCount + 3)).catch(() => 0);
      await page.waitForTimeout(800);
    }
    await uploadMainImagesToSection(page, assets.mainImages);
    const uploadedMainCount = await waitForPreviewCount(page, () => countMainImagePreviews(page), assets.mainImages.length);
    if (uploadedMainCount >= assets.mainImages.length) {
      uploadedGroups.push("mainImages");
    } else {
      uploadIssue = `Main image slots did not contain ${assets.mainImages.length} images after upload; actual=${uploadedMainCount}.`;
    }
  }
  if (!uploadIssue && uploadedGroups.includes("mainImages")) {
    const forbiddenResult = await enforceForbiddenGraphicSectionsEmpty(
      page,
      runtimeDir,
      "publish-page-forbidden-graphic-sections-cleared.png"
    );
    if (forbiddenResult.remainingSections.length) {
      uploadIssue = `Forbidden optional graphic sections still contain images: ${forbiddenResult.remainingSections.join(", ")}`;
    } else {
      uploadedGroups.push("optionalGraphicSectionsCleared");
    }
  } else if (!uploadIssue && !mainInput) {
    const existingMainPreviewCount = await countMainImagePreviews(page);
    if (existingMainPreviewCount >= assets.mainImages.length) {
      uploadedGroups.push("mainImages");
      const forbiddenResult = await enforceForbiddenGraphicSectionsEmpty(
        page,
        runtimeDir,
        "publish-page-forbidden-graphic-sections-cleared-existing-main.png"
      );
      if (forbiddenResult.remainingSections.length) {
        uploadIssue = `Forbidden optional graphic sections still contain images: ${forbiddenResult.remainingSections.join(", ")}`;
      } else {
        uploadedGroups.push("optionalGraphicSectionsCleared");
      }
    } else {
      logWarn("Main image upload input was not found; checking existing main/white-background previews before failing.");
    }
  } else if (!uploadIssue && !assets.mainImages.length) {
    uploadIssue = "Main image upload input was not found.";
  }

  await page.mouse.wheel(0, 900).catch(() => {});
  await page.waitForTimeout(800);

  let filledFromMain = false;
  if (!uploadIssue) {
    const detailResult = await ensureDetailImagesFromMainThenQualifications(page, runtimeDir, assets);
    filledFromMain = detailResult.filledFromMain;
    if (detailResult.completed) {
      uploadedGroups.push(detailResult.group);
    } else {
      uploadIssue = detailResult.issue || "Detail images did not include fill-from-main result plus Feishu qualification images.";
    }
  }

  await dismissTransientOverlays(page);

  if (!uploadIssue) {
    const forbiddenResult = await enforceForbiddenGraphicSectionsEmpty(
      page,
      runtimeDir,
      "publish-page-forbidden-graphic-sections-final-check.png"
    );
    if (forbiddenResult.remainingSections.length) {
      uploadIssue = `Forbidden optional graphic sections still contain images after detail upload: ${forbiddenResult.remainingSections.join(", ")}`;
    } else if (!uploadedGroups.includes("optionalGraphicSectionsCleared")) {
      uploadedGroups.push("optionalGraphicSectionsCleared");
    }
  }

  const finalMainPreviewCount = await countMainImagePreviews(page).catch(() => 0);
  if (!uploadedGroups.includes("mainImages") && finalMainPreviewCount >= assets.mainImages.length) {
    uploadedGroups.push("mainImages");
  }
  if (!uploadIssue && !uploadedGroups.includes("mainImages")) {
    uploadIssue = "Main image upload input was not found and no existing main/white-background preview was detected.";
  }
  if (!uploadIssue && !uploadedGroups.includes("optionalGraphicSectionsCleared")) {
    uploadIssue = "Optional graphic sections were not confirmed as cleared.";
  }
  const finalDetailPreviewCount = await countDetailImagePreviews(page).catch(() => 0);
  if (
    !uploadedGroups.some(
      (item) =>
        item === "detailImages" ||
        item === "detailImages:fillFromMainThenUpload" ||
        item === "detailImages:existingWithQualifications"
    ) &&
    finalDetailPreviewCount >= assets.detailImages.length + 1
  ) {
    uploadedGroups.push(filledFromMain ? "detailImages:fillFromMainThenUpload" : "detailImages");
  }

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
  const candidates = [
    currentPage,
    ...context.pages().filter((item) => item !== currentPage)
  ].filter((item) => !item.isClosed() && item.url().includes("/ffa/g/create"));

  let recoveredPage: Page | null = null;
  for (const candidate of candidates) {
    attachSafeDialogHandler(candidate);
    await candidate.bringToFront().catch(() => {});
    await candidate.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => {});
    await candidate.waitForTimeout(800).catch(() => {});
    const usable = await isUsablePublishCreatePage(candidate).catch(() => false);
    if (usable) {
      recoveredPage = candidate;
      break;
    }
  }

  if (!recoveredPage) {
    throw new Error("Publish create page context was lost and no usable replacement page is available.");
  }

  await recoveredPage.bringToFront().catch(() => {});
  return recoveredPage;
}

async function isUsablePublishCreatePage(page: Page): Promise<boolean> {
  if (page.isClosed() || !page.url().includes("/ffa/g/create")) {
    return false;
  }
  return page.evaluate(() => {
    const bodyText = document.body.innerText || "";
    const requiredSectionCount = ["基础信息", "图文信息", "价格库存", "服务与履约"].filter((text) => bodyText.includes(text)).length;
    const hasPublishAction = bodyText.includes("发布商品") || bodyText.includes("填写检查");
    const loginRequired =
      (bodyText.includes("扫码登录") && bodyText.includes("抖店App")) ||
      bodyText.includes("打开抖店App扫码登录") ||
      bodyText.includes("切换为手机/邮箱登录");
    return requiredSectionCount >= 2 && hasPublishAction && !loginRequired;
  });
}

async function getPublishCreatePageHealth(page: Page): Promise<{
  usable: boolean;
  bodyTextLength: number;
  sectionCount: number;
  loading: boolean;
  loginRequired: boolean;
  bodyText: string;
}> {
  if (page.isClosed() || !page.url().includes("/ffa/g/create")) {
    return { usable: false, bodyTextLength: 0, sectionCount: 0, loading: false, loginRequired: false, bodyText: "" };
  }
  return page.evaluate(() => {
    const bodyText = document.body.innerText || "";
    const normalized = bodyText.replace(/\s+/g, "");
    const sectionCount = ["基础信息", "图文信息", "价格库存", "服务与履约"].filter((text) => normalized.includes(text)).length;
    const hasPublishAction = normalized.includes("发布商品") || normalized.includes("填写检查");
    const recoverablePageError =
      normalized.includes("数据异常请刷新重试") ||
      (normalized.includes("数据异常") && normalized.includes("刷新重试")) ||
      normalized.includes("网络异常") ||
      normalized.includes("系统繁忙") ||
      normalized.includes("请稍后重试");
    const loginRequired =
      (normalized.includes("扫码登录") && normalized.includes("抖店App")) ||
      normalized.includes("打开抖店App扫码登录") ||
      normalized.includes("切换为手机/邮箱登录");
    const loading =
      normalized.includes("加载中") ||
      normalized.includes("努力加载") ||
      recoverablePageError;
    return {
      usable: sectionCount >= 2 && hasPublishAction && !loginRequired && !recoverablePageError,
      bodyTextLength: normalized.length,
      sectionCount,
      loading,
      loginRequired,
      bodyText: normalized.slice(0, 300)
    };
  });
}

async function waitForPublishCreatePageReady(
  page: Page,
  runtimeDir: string,
  publishPageUrl: string,
  label: string,
  maxAttempts = 3,
  options: { allowPageNavigationRecovery?: boolean } = {}
): Promise<void> {
  const allowPageNavigationRecovery = options.allowPageNavigationRecovery ?? true;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    await Promise.race([
      page.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => {}),
      page.waitForTimeout(1800 + attempt * 600).catch(() => {})
    ]);
    const health = await getPublishCreatePageHealth(page).catch(() => ({
      usable: false,
      bodyTextLength: 0,
      sectionCount: 0,
      loading: false,
      loginRequired: false,
      bodyText: ""
    }));
    const readiness = evaluatePublishCreatePageReadiness(health);
    if (readiness.action === "ready") {
      return;
    }
    if (readiness.action === "fail_login") {
      throw new Error(readiness.issue);
    }
    if (readiness.action === "reopen_from_platform_spu") {
      throw new PublishCreatePageReopenRequiredError(readiness.issue);
    }
    await savePageScreenshot(page, runtimeDir, `${label}-publish-page-not-ready-${attempt + 1}.png`).catch(() => "");
    if (attempt < maxAttempts - 1) {
      if (allowPageNavigationRecovery) {
        if (page.url().includes("/ffa/g/create")) {
          await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
        } else if (publishPageUrl) {
          await gotoWithTolerance(page, publishPageUrl, 2500).catch(() => {});
        }
      }
      await page.waitForTimeout(2200 + attempt * 700).catch(() => {});
      continue;
    }
    throw new Error(
      `Publish create page did not become ready after network/page-content recovery. sections=${health.sectionCount}; textLength=${health.bodyTextLength}; loading=${health.loading}; body=${health.bodyText}`
    );
  }
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
    const sectionLabels = ["\u4e3b\u56fe", "\u4e3b\u56fe3:4", "\u767d\u5e95\u56fe", "\u5546\u54c1\u8be6\u60c5", "\u8be6\u60c5\u9875"];
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

      const current = labels.find((item) => item.text === targetSection || item.text.startsWith(targetSection));
      if (!current) {
        return 0;
      }

      const nextTop =
        labels.filter((item) => sectionLabels.some((label) => item.text === label || item.text.startsWith(label)) && item.top > current.top).sort((a, b) => a.top - b.top)[0]
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

async function clickVisibleDialogAction(page: Page, labels: string[]): Promise<boolean> {
  return page.evaluate((expectedLabels) => {
    const normalize = (value: string): string => value.replace(/\s+/g, "").trim();
    const dialogs = Array.from(document.querySelectorAll("[role='dialog'], [aria-modal='true'], .semi-modal, .ant-modal, .auxo-modal"))
      .map((el) => el as HTMLElement)
      .filter((el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      });
    const roots = dialogs.length ? dialogs : [document.body];
    const targets = roots
      .flatMap((root) =>
        Array.from(root.querySelectorAll("button, [role='button'], a, span, div")).map((el) => el as HTMLElement)
      )
      .map((el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        const text = normalize(el.innerText || el.textContent || "");
        if (rect.width <= 0 || rect.height <= 0 || style.display === "none" || style.visibility === "hidden") {
          return null;
        }
        const labelIndex = expectedLabels.findIndex((label) => text === normalize(label) || text.includes(normalize(label)));
        if (labelIndex < 0) {
          return null;
        }
        const marker = [String(el.className || ""), el.getAttribute("type") || "", el.getAttribute("aria-label") || ""]
          .join(" ")
          .toLowerCase();
        return {
          el,
          score:
            (marker.includes("primary") ? 300 : 0) +
            (el.tagName.toLowerCase() === "button" ? 200 : 0) +
            (100 - labelIndex * 10) +
            rect.right / 100
        };
      })
      .filter(Boolean)
      .sort((a, b) => (b!.score || 0) - (a!.score || 0));
    const target = targets[0]?.el || null;
    target?.click();
    return Boolean(target);
  }, labels);
}

async function readPublishSubmissionState(page: Page): Promise<{ submitted: boolean; issue: string }> {
  const snapshot = await page.evaluate(() => ({
    bodyText: document.body?.innerText || "",
    url: window.location.href
  }));
  const state = evaluatePublishSubmission(snapshot);
  return { submitted: state.submitted, issue: state.issue };
}

async function waitForPublishSubmission(page: Page): Promise<{ submitted: boolean; issue: string }> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await page.waitForTimeout(1500).catch(() => {});
    await clickVisibleDialogAction(page, ["确认发布", "继续发布", "确定", "确认", "我知道了"]).catch(() => false);
    await dismissTransientOverlays(page);
    const state = await readPublishSubmissionState(page).catch((error) => ({
      submitted: false,
      issue: error instanceof Error ? error.message : String(error)
    }));
    if (state.submitted) {
      return state;
    }
  }
  return readPublishSubmissionState(page).catch((error) => ({
    submitted: false,
    issue: error instanceof Error ? error.message : String(error)
  }));
}

async function readPublishSubmissionStateFromContext(
  context: Awaited<ReturnType<Page["context"]>>,
  fallbackPage: Page,
  publishClickAttempted = false
): Promise<{ page: Page; submitted: boolean; issue: string }> {
  const pages = context.pages().filter((item) => !item.isClosed());
  for (const candidate of pages.length ? pages : [fallbackPage]) {
    const state = await readPublishSubmissionState(candidate).catch(() => ({ submitted: false, issue: "" }));
    if (state.submitted) {
      return { page: candidate, submitted: true, issue: "" };
    }
  }

  const freshCreatePages: string[] = [];
  for (const candidate of pages) {
    const state = await candidate
      .evaluate(() => ({ bodyText: document.body?.innerText || "", url: window.location.href }))
      .then((snapshot) => evaluatePublishSubmissionAfterAction(snapshot, publishClickAttempted))
      .catch(() => null);
    if (state?.submitted) {
      return { page: candidate, submitted: true, issue: "" };
    }
    if (state?.freshCreatePage) {
      if (publishClickAttempted) {
        return { page: candidate, submitted: true, issue: "" };
      }
      freshCreatePages.push(candidate.url());
    }
  }

  const issuePage = pages[0] || fallbackPage;
  const issue = await readPublishSubmissionState(issuePage)
    .then((state) => state.issue)
    .catch((error) => (error instanceof Error ? error.message : String(error)));
  return {
    page: issuePage,
    submitted: false,
    issue: freshCreatePages.length
      ? `Publish submission was not confirmed; browser returned to a fresh create page: ${freshCreatePages[0]}`
      : issue
  };
}

async function clickPublishProductOnPage(
  page: Page,
  runtimeDir: string,
  fileName: string
): Promise<PublishActionResult & { publishClicked: boolean; publishIssue: string }> {
  let activePage = page;
  await activePage.bringToFront();
  await activePage.waitForTimeout(1200);
  await dismissTransientOverlays(activePage);

  let publishClicked = false;
  let publishIssue = "";
  let publishClickAttempted = false;
  let activeContext = activePage.context();
  for (let attempt = 0; attempt < 2 && !publishClicked; attempt += 1) {
    try {
      activePage = await recoverUsablePublishPage(activePage);
      activeContext = activePage.context();
      await dismissTransientOverlays(activePage);
      const publishButton = activePage.getByRole("button", { name: "\u53d1\u5e03\u5546\u54c1" }).first();
      if (!(await publishButton.count())) {
        publishIssue = "Publish product button was not found after all module checks passed.";
        break;
      }
      const disabled = await publishButton.isDisabled({ timeout: 1000 }).catch(() => false);
      if (disabled) {
        publishIssue = "Publish product button was visible but disabled after all module checks passed.";
        break;
      } else {
        await publishButton.scrollIntoViewIfNeeded().catch(() => {});
        publishClickAttempted = true;
        await publishButton.click({ timeout: 5000 });
        await activePage.waitForTimeout(1200).catch(() => {});
        if (activePage.isClosed()) {
          activePage = await recoverUsablePageFromContext(activeContext, "/ffa/g").catch(() => activePage);
        }
      }
      if (!publishIssue) {
        if (activePage.isClosed()) {
          activePage = await recoverUsablePageFromContext(activeContext, "/ffa/g").catch(() => activePage);
        }
        let submissionState = await waitForPublishSubmission(activePage).catch(async () => {
          const contextState = await readPublishSubmissionStateFromContext(activeContext, activePage, publishClickAttempted);
          activePage = contextState.page;
          return { submitted: contextState.submitted, issue: contextState.issue };
        });
        if (!submissionState.submitted) {
          const contextState = await readPublishSubmissionStateFromContext(activeContext, activePage, publishClickAttempted).catch(() => null);
          if (contextState?.submitted) {
            activePage = contextState.page;
            submissionState = { submitted: true, issue: "" };
          } else if (contextState?.issue) {
            activePage = contextState.page;
            submissionState = { submitted: false, issue: contextState.issue };
          }
        }
        publishClicked = submissionState.submitted;
        publishIssue =
          submissionState.issue ||
          (submissionState.submitted || !publishClickAttempted ? "" : "Publish product button was clicked, but no submission success signal was detected.");
      }
    } catch (error) {
      publishIssue = `Publish product button click failed: ${error instanceof Error ? error.message : String(error)}`;
      if (publishClickAttempted) {
        await activePage.waitForTimeout(2500).catch(() => {});
      }
      const contextState = await readPublishSubmissionStateFromContext(activeContext, activePage, publishClickAttempted).catch(() => null);
      if (contextState?.submitted) {
        activePage = contextState.page;
        publishClicked = true;
        publishIssue = "";
        break;
      }
      if (attempt === 0) {
        await activePage.waitForTimeout(1200).catch(() => {});
        continue;
      }
    }
  }

  const screenshotFile = await savePageScreenshot(activePage, runtimeDir, fileName);
  return {
    ...makePublishActionResult({
      action: "click_publish_product",
      ok: publishClicked && !publishIssue,
      issue: publishIssue,
      pageUrl: activePage.url(),
      pageTitle: await activePage.title(),
      screenshotFile
    }),
    pageUrl: activePage.url(),
    pageTitle: await activePage.title(),
    screenshotFile,
    publishClicked,
    publishIssue
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

type PriceInventoryRowTarget = {
  trIndex: number;
  priceInputIndex: number;
  stockInputIndex: number;
  top: number;
  priceValue: string;
  stockValue: string;
};

async function readVisiblePriceInventoryRowTargets(page: Page): Promise<PriceInventoryRowTarget[]> {
  const rawRows = await page.evaluate(() => {
    const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
    return Array.from(document.querySelectorAll("tr"))
      .map((row, trIndex) => {
        const rowEl = row as HTMLTableRowElement;
        const rowRect = rowEl.getBoundingClientRect();
        const rowStyle = window.getComputedStyle(rowEl);
        const rowText = normalize(rowEl.innerText || rowEl.textContent || "");
        if (
          !rowText ||
          rowRect.width <= 0 ||
          rowRect.height <= 0 ||
          rowStyle.display === "none" ||
          rowStyle.visibility === "hidden" ||
          rowText.includes("现货库存") ||
          rowText.includes("价格与库存")
        ) {
          return null;
        }
        const inputs = Array.from(rowEl.querySelectorAll("input"))
          .map((input, inputIndex) => {
            const inputEl = input as HTMLInputElement;
            const inputRect = inputEl.getBoundingClientRect();
            const inputStyle = window.getComputedStyle(inputEl);
            const type = (inputEl.getAttribute("type") || "text").toLowerCase();
            const placeholder = normalize(inputEl.getAttribute("placeholder") || "");
            const context = normalize(
              [
                inputEl.value || "",
                placeholder,
                inputEl.getAttribute("aria-label") || "",
                inputEl.parentElement?.innerText || "",
                inputEl.parentElement?.parentElement?.innerText || "",
                inputEl.closest("td, th, tr, .semi-table-row, .ecom-g-table-row")?.textContent || ""
              ].join(" ")
            );
            if (
              inputRect.width < 80 ||
              inputRect.height <= 0 ||
              inputStyle.display === "none" ||
              inputStyle.visibility === "hidden" ||
              inputEl.disabled ||
              inputEl.readOnly ||
              ["hidden", "file", "checkbox", "radio"].includes(type)
            ) {
              return null;
            }
            return {
              inputIndex,
              value: inputEl.value || "",
              placeholder,
              context,
              centerX: inputRect.x + inputRect.width / 2
            };
          })
          .filter(Boolean) as Array<{
            inputIndex: number;
            value: string;
            placeholder: string;
            context: string;
            centerX: number;
          }>;
        return { trIndex, top: rowRect.top, inputs };
      })
      .filter(Boolean) as Array<{
        trIndex: number;
        top: number;
        inputs: Array<{
          inputIndex: number;
          value: string;
          placeholder: string;
          context: string;
          centerX: number;
        }>;
      }>;
  });

  return rawRows
    .map((row) => {
      const roles = resolvePriceInventoryRowInputRoles(row.inputs);
      if (!roles) {
        return null;
      }
      const price = row.inputs.find((input) => input.inputIndex === roles.priceIndex);
      const stock = row.inputs.find((input) => input.inputIndex === roles.stockIndex);
      if (!price || !stock) {
        return null;
      }
      return {
        trIndex: row.trIndex,
        priceInputIndex: roles.priceIndex,
        stockInputIndex: roles.stockIndex,
        top: row.top,
        priceValue: price.value,
        stockValue: stock.value
      };
    })
    .filter((row): row is PriceInventoryRowTarget => Boolean(row))
    .sort((a, b) => a.top - b.top);
}

async function readVisiblePriceInventoryRows(
  page: Page
): Promise<Array<{ priceValue: string; stockValue: string }>> {
  return (await readVisiblePriceInventoryRowTargets(page)).map((row) => ({
    priceValue: row.priceValue,
    stockValue: row.stockValue
  }));
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

async function fillVisiblePriceInventoryRowByTableDom(
  page: Page,
  rowIndex: number,
  expectedPriceText: string,
  expectedStockText: string
): Promise<void> {
  const rows = await readVisiblePriceInventoryRowTargets(page);
  const target = rows[rowIndex];
  if (!target) {
    throw new Error(`Visible price/inventory row ${rowIndex + 1} was not found.`);
  }

  const row = page.locator("tr").nth(target.trIndex);
  await row.evaluate((node) => {
    node.scrollIntoView({ block: "center", inline: "nearest" });
  }).catch(() => {});
  await page.waitForTimeout(200);
  const priceInput = row.locator("input").nth(target.priceInputIndex);
  const stockInput = row.locator("input").nth(target.stockInputIndex);

  await priceInput.scrollIntoViewIfNeeded().catch(() => {});
  await priceInput.click({ timeout: 3000 }).catch(() => {});
  await priceInput.fill(expectedPriceText, { timeout: 3000 }).catch(() => {});
  let currentPriceValue = await priceInput.inputValue().catch(() => "");
  if (normalizeNumericInputValue(currentPriceValue) !== normalizeNumericInputValue(expectedPriceText)) {
    currentPriceValue = await setLocatorInputValue(priceInput, expectedPriceText).catch(() => currentPriceValue);
  }

  await stockInput.scrollIntoViewIfNeeded().catch(() => {});
  await stockInput.click({ timeout: 3000 }).catch(() => {});
  await stockInput.fill(expectedStockText, { timeout: 3000 }).catch(() => {});
  let currentStockValue = await stockInput.inputValue().catch(() => "");
  if (normalizeNumericInputValue(currentStockValue) !== normalizeNumericInputValue(expectedStockText)) {
    currentStockValue = await setLocatorInputValue(stockInput, expectedStockText).catch(() => currentStockValue);
  }
  await stockInput.press("Tab").catch(() => {});
}

async function fillAndVerifyPriceInventoryRow(
  page: Page,
  rowIndex: number,
  expectedPrice: number,
  expectedStock: number
): Promise<string> {
  const expectedPriceText = String(expectedPrice);
  const expectedStockText = String(expectedStock);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await fillVisiblePriceInventoryRowByTableDom(page, rowIndex, expectedPriceText, expectedStockText).catch(async () => {
      const { priceInputs, stockInputs } = await getVisiblePriceInventoryInputLocators(page);
      const priceInput = priceInputs.nth(rowIndex);
      const stockInput = stockInputs.nth(rowIndex);
      await priceInput.scrollIntoViewIfNeeded().catch(() => {});
      await priceInput.click({ timeout: 3000 }).catch(() => {});
      await priceInput.fill(expectedPriceText, { timeout: 3000 }).catch(() => {});
      let currentPriceValue = await priceInput.inputValue().catch(() => "");
      if (normalizeNumericInputValue(currentPriceValue) !== normalizeNumericInputValue(expectedPriceText)) {
        currentPriceValue = await setLocatorInputValue(priceInput, expectedPriceText).catch(() => currentPriceValue);
      }
      await stockInput.scrollIntoViewIfNeeded().catch(() => {});
      await stockInput.click({ timeout: 3000 }).catch(() => {});
      await stockInput.fill(expectedStockText, { timeout: 3000 }).catch(() => {});
      let currentStockValue = await stockInput.inputValue().catch(() => "");
      if (normalizeNumericInputValue(currentStockValue) !== normalizeNumericInputValue(expectedStockText)) {
        currentStockValue = await setLocatorInputValue(stockInput, expectedStockText).catch(() => currentStockValue);
      }
      await stockInput.press("Tab").catch(() => {});
    });
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
  stopBeforePublish = false,
  graphicResetAttempt = 0,
  createPageResetAttempt = 0
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
  let shopVerifiedBeforeCreatePage = false;

  if (!createPageUrl) {
    const queryResult = await queryPlatformSpu(runtimeDir, metadata.brand, metadata.spu, shopFolder);
    screenshotFiles.push(queryResult.screenshotFile);
    createPageUrl = queryResult.createPageUrl;
    matchedRowText = queryResult.matchedRowText;
    shopVerifiedBeforeCreatePage = Boolean(shopFolder);
    stages.push({ step: "query_platform_spu", status: "completed" });
  }

  const context = await launchPersistentBrowser();
  try {
    let page = await reuseOrOpenCreatePage(context, createPageUrl);
    try {
      await waitForPublishCreatePageReady(page, runtimeDir, createPageUrl, "publish-initial");
    } catch (error) {
      if (error instanceof PublishCreatePageReopenRequiredError && createPageResetAttempt < 2) {
        logWarn(`Publish create page was unusable after SPU query; reopening from platform SPU. issue=${error.message}`);
        await closeCreatePagesExcept(context, []).catch(() => {});
        await context.browser()?.close().catch(() => {});
        const retryResult = await runPublishFlow(
          runtimeDir,
          metadata,
          assets,
          shopFolder,
          undefined,
          stopBeforePublish,
          graphicResetAttempt,
          createPageResetAttempt + 1
        );
        return {
          ...retryResult,
          screenshotFiles: [...screenshotFiles, ...retryResult.screenshotFiles],
          stages: [
            ...stages,
            { step: "reopen_publish_page_after_spu_prefill_failure", status: "completed" },
            ...retryResult.stages
          ]
        };
      }
      throw error;
    }
    if (!shopVerifiedBeforeCreatePage) {
      await ensureShopContext(page, runtimeDir, shopFolder);
    }
    let basicInfoCompleted = false;
    for (let basicAttempt = 0; basicAttempt < 2; basicAttempt += 1) {
      if (basicAttempt > 0) {
        page = await reuseOrOpenCreatePage(context, createPageUrl, page);
      }
      await waitForPublishCreatePageReady(page, runtimeDir, createPageUrl, `publish-basic-${basicAttempt + 1}`, 3, {
        allowPageNavigationRecovery: basicAttempt > 0
      });

      try {
        await assertBasicPrefillReadyOnPage(page, metadata);
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
        await assertBasicPublishCompletionOnPage(page, runtimeDir, metadata, "after_basic_fill");
        stages.push({ step: "fill_basic_publish_page", status: "completed" });
        basicInfoCompleted = true;
        break;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (error instanceof PublishCreatePageReopenRequiredError && basicAttempt === 0) {
          const retryQueryResult = await queryPlatformSpu(runtimeDir, metadata.brand, metadata.spu, shopFolder);
          screenshotFiles.push(retryQueryResult.screenshotFile);
          createPageUrl = retryQueryResult.createPageUrl;
          matchedRowText = retryQueryResult.matchedRowText;
          page = await reuseOrOpenCreatePage(context, createPageUrl, page);
          continue;
        }
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
      await waitForPublishCreatePageReady(page, runtimeDir, createPageUrl, `publish-before-images-${specAttempt + 1}`);
      await assertBasicPublishCompletionOnPage(page, runtimeDir, metadata, "before_graphic_module");
      let imageResult = await uploadProductImagesOnPage(page, runtimeDir, assets, "publish-page-images-uploaded.png");
      screenshotFiles.push(imageResult.screenshotFile);
      uploadedGroups = imageResult.uploadedGroups;
      uploadIssue = imageResult.uploadIssue;
      if (uploadIssue || !graphicUploadGroupsComplete(uploadedGroups)) {
        if (graphicResetAttempt < 1) {
          logWarn(
            `Graphic module did not reach a clean completed state; resetting the current graphic module before retry. issue=${uploadIssue || "Main/white-background/detail image groups were not uploaded successfully."}`
          );
          await waitForPublishCreatePageReady(
            page,
            runtimeDir,
            createPageUrl,
            "publish-before-graphic-reset"
          );
          screenshotFiles.push(
            await resetGraphicModuleOnPage(page, runtimeDir, "publish-page-graphic-module-reset-before-retry.png")
          );
          stages.push({ step: "reset_graphic_module_after_upload_failure", status: "completed" });
          imageResult = await uploadProductImagesOnPage(page, runtimeDir, assets, "publish-page-images-uploaded-after-reset.png");
          screenshotFiles.push(imageResult.screenshotFile);
          uploadedGroups = imageResult.uploadedGroups;
          uploadIssue = imageResult.uploadIssue;
        }
      }
      if (uploadIssue || !graphicUploadGroupsComplete(uploadedGroups)) {
        stages.push({ step: "upload_product_images", status: "failed" });
        throw new Error(
          `Sequential publish flow stopped: 图文信息模块未完成。${uploadIssue || "Main/white-background/detail image groups were not uploaded successfully."}`
        );
      }
      if (specAttempt === 0) {
        stages.push({ step: "upload_product_images", status: "completed" });
      }

      const graphicForbiddenResult = await enforceForbiddenGraphicSectionsEmpty(
        page,
        runtimeDir,
        "publish-page-forbidden-graphic-sections-after-images.png"
      );
      screenshotFiles.push(graphicForbiddenResult.screenshotFile);
      const graphicForbiddenRule = evaluateForbiddenGraphicSections(graphicForbiddenResult.remainingSections);
      if (!graphicForbiddenRule.passed) {
        stages.push({ step: "graphic_forbidden_sections", status: "failed" });
        throw new Error(`Sequential publish flow stopped: 图文信息模块未完成。${graphicForbiddenRule.issue}`);
      }
      if (specAttempt === 0) {
        stages.push({ step: "graphic_forbidden_sections", status: "completed" });
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

      const priceEntryRule = evaluatePriceInventoryEntryRule({ specIssue });
      if (priceEntryRule.action === "block_until_spec_template_complete" && specAttempt === 0) {
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
      if (priceEntryRule.action === "block_until_spec_template_complete") {
        break;
      }

      await assertBasicPublishCompletionOnPage(page, runtimeDir, metadata, "before_price_inventory_module");
      const priceInventoryResult = await applyPriceInventoryOnPage(page, runtimeDir, "publish-page-price-inventory-filled.png");
      screenshotFiles.push(priceInventoryResult.screenshotFile);
      filledPriceRows = priceInventoryResult.filledRows;
      priceIssue = priceInventoryResult.priceIssue;
      const priceRule = evaluatePriceInventoryCompletion({
        filledPriceRows,
        expectedRows: FIXED_PRICES.length,
        priceIssue,
        specIssue
      });
      if (priceRule.passed) {
        priceInventoryCompleted = true;
        break;
      }
      if (specAttempt === 0 && specIssue) {
        continue;
      }
      break;
    }
    if (!priceInventoryCompleted) {
      const priceRule = evaluatePriceInventoryCompletion({
        filledPriceRows,
        expectedRows: FIXED_PRICES.length,
        priceIssue,
        specIssue
      });
      stages.push({ step: "apply_price_inventory", status: "failed" });
      throw new Error(`Sequential publish flow stopped: 价格库存模块未完成。${priceRule.issue}`);
    }
    stages.push({ step: "apply_price_inventory", status: "completed" });

    try {
      await assertBasicPublishCompletionOnPage(page, runtimeDir, metadata, "before_service_module");
    } catch {
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
          "publish-page-basic-refilled-before-service.png"
        );
        screenshotFiles.push(refillResult.screenshotFile);
        filledFields.length = 0;
        filledFields.push(...refillResult.filledFields);
      }
      await assertBasicPublishCompletionOnPage(page, runtimeDir, metadata, "before_service_module");
    }

    const settingsResult = await applyFixedPublishSettingsOnPage(
      page,
      runtimeDir,
      "publish-page-fixed-settings.png",
      metadata.spu
    );
    screenshotFiles.push(settingsResult.screenshotFile);
    configuredFields.push(...settingsResult.configuredFields);
    freightTemplateName = settingsResult.freightTemplateName;
    const serviceRule = evaluateServiceFulfillmentCompletion(settingsResult.serviceState);
    if (!serviceRule.passed) {
      stages.push({ step: "apply_fixed_publish_settings", status: "failed" });
      throw new Error(`Sequential publish flow stopped: 服务与履约模块未完成。${serviceRule.issue}`);
    }
    stages.push({ step: "apply_fixed_publish_settings", status: "completed" });

    const medicalCertificateResult = await ensureMedicalDeviceCertificateFromFirstQualification(
      page,
      runtimeDir,
      assets
    );
    if (medicalCertificateResult.screenshotFile) {
      screenshotFiles.push(medicalCertificateResult.screenshotFile);
    }
    if (!medicalCertificateResult.completed) {
      stages.push({ step: "apply_medical_device_certificate", status: "failed" });
      throw new Error(`Sequential publish flow stopped: 其他信息模块未完成。${medicalCertificateResult.issue}`);
    }
    if (medicalCertificateResult.configuredField) {
      configuredFields.push(medicalCertificateResult.configuredField);
    }
    stages.push({ step: "apply_medical_device_certificate", status: "completed" });

    const preCheckForbiddenResult = await verifyForbiddenGraphicSectionsEmptyOnPage(
      page,
      runtimeDir,
      "publish-page-forbidden-graphic-sections-before-check.png"
    );
    screenshotFiles.push(preCheckForbiddenResult.screenshotFile);
    const preForbiddenRule = evaluateForbiddenGraphicSections(preCheckForbiddenResult.remainingSections);
    if (!preForbiddenRule.passed) {
      stages.push({ step: "pre_publish_forbidden_graphic_check", status: "failed" });
      const repairResult = await repairForbiddenGraphicSectionsBeforePublish(
        page,
        runtimeDir,
        "publish-page-forbidden-graphic-sections-repaired-before-check.png"
      );
      screenshotFiles.push(repairResult.screenshotFile);
      const repairedRule = evaluateForbiddenGraphicSections(repairResult.remainingSections);
      if (!repairedRule.passed) {
        stages.push({ step: "pre_publish_forbidden_graphic_repair", status: "failed" });
        throw new Error(`Sequential publish flow stopped: 发布前白底图/3:4主图仍未清空。${repairedRule.issue}`);
      }
      stages.push({ step: "pre_publish_forbidden_graphic_repair", status: "completed" });
    } else {
      stages.push({ step: "pre_publish_forbidden_graphic_check", status: "completed" });
    }

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
      if (field === "\u533b\u7597\u5668\u68b0\u6ce8\u518c\u8bc1" && completedFieldSet.has("medicalDeviceCertificate")) {
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
    const publishCheckRule = evaluatePublishCheckResult({
      checkPassed,
      blockingFields,
      uploadIssue,
      specIssue,
      priceIssue
    });
    if (!publishCheckRule.passed) {
      stages.push({ step: "run_publish_check", status: "failed" });
      throw new Error(`Sequential publish flow stopped: 模块校验未通过。${checkMessage} ${publishCheckRule.issue}`);
    }
    stages.push({ step: "run_publish_check", status: "completed" });

    if (!stopBeforePublish) {
      const finalForbiddenResult = await verifyForbiddenGraphicSectionsEmptyOnPage(
        page,
        runtimeDir,
        "publish-page-forbidden-graphic-sections-before-submit.png"
      );
      screenshotFiles.push(finalForbiddenResult.screenshotFile);
      const finalForbiddenRule = evaluateForbiddenGraphicSections(finalForbiddenResult.remainingSections);
      if (!finalForbiddenRule.passed) {
        stages.push({ step: "final_forbidden_graphic_check", status: "failed" });
        const repairResult = await repairForbiddenGraphicSectionsBeforePublish(
          page,
          runtimeDir,
          "publish-page-forbidden-graphic-sections-repaired-before-submit.png"
        );
        screenshotFiles.push(repairResult.screenshotFile);
        const repairedRule = evaluateForbiddenGraphicSections(repairResult.remainingSections);
        if (!repairedRule.passed) {
          stages.push({ step: "final_forbidden_graphic_repair", status: "failed" });
          throw new Error(`Sequential publish flow stopped: 提交前白底图/3:4主图仍未清空。${repairedRule.issue}`);
        }
        stages.push({ step: "final_forbidden_graphic_repair", status: "completed" });
      } else {
        stages.push({ step: "final_forbidden_graphic_check", status: "completed" });
      }

      const publishResult = await clickPublishProductOnPage(page, runtimeDir, "publish-page-published.png");
      if (publishResult.screenshotFile) {
        screenshotFiles.push(publishResult.screenshotFile);
      }
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
  publishPageUrl?: string,
  graphicResetAttempt = 0
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
    let page = await reuseOrOpenCreatePage(context, createPageUrl);
    await waitForPublishCreatePageReady(page, runtimeDir, createPageUrl, "graphic-initial");
    await ensureShopContext(page, runtimeDir, shopFolder);
    let basicInfoCompleted = false;
    for (let basicAttempt = 0; basicAttempt < 2; basicAttempt += 1) {
      if (basicAttempt > 0) {
        page = await reuseOrOpenCreatePage(context, createPageUrl, page);
      }
      await waitForPublishCreatePageReady(page, runtimeDir, createPageUrl, `graphic-basic-${basicAttempt + 1}`, 3, {
        allowPageNavigationRecovery: basicAttempt > 0
      });

      try {
        await assertBasicPrefillReadyOnPage(page, metadata);
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
        await assertBasicPublishCompletionOnPage(page, runtimeDir, metadata, "after_basic_fill");
        stages.push({ step: "fill_basic_publish_page", status: "completed" });
        basicInfoCompleted = true;
        break;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (error instanceof PublishCreatePageReopenRequiredError && basicAttempt === 0) {
          const retryQueryResult = await queryPlatformSpu(runtimeDir, metadata.brand, metadata.spu, shopFolder);
          screenshotFiles.push(retryQueryResult.screenshotFile);
          createPageUrl = retryQueryResult.createPageUrl;
          matchedRowText = retryQueryResult.matchedRowText;
          page = await reuseOrOpenCreatePage(context, createPageUrl, page);
          continue;
        }
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

    await waitForPublishCreatePageReady(page, runtimeDir, createPageUrl, "graphic-before-images");
    await assertBasicPublishCompletionOnPage(page, runtimeDir, metadata, "before_graphic_module");
    let imageResult = await uploadProductImagesOnPage(page, runtimeDir, assets, "publish-page-images-uploaded.png");
    screenshotFiles.push(imageResult.screenshotFile);
    uploadedGroups = imageResult.uploadedGroups;
    uploadIssue = imageResult.uploadIssue;
    if (uploadIssue || !graphicUploadGroupsComplete(uploadedGroups)) {
      if (graphicResetAttempt < 1) {
        logWarn(
          `Graphic module did not reach a clean completed state; resetting the current graphic module before retry. issue=${uploadIssue || "Main/white-background/detail image groups were not uploaded successfully."}`
        );
        await waitForPublishCreatePageReady(
          page,
          runtimeDir,
          createPageUrl,
          "graphic-before-graphic-reset"
        );
        screenshotFiles.push(
          await resetGraphicModuleOnPage(page, runtimeDir, "publish-page-graphic-module-reset-before-retry.png")
        );
        stages.push({ step: "reset_graphic_module_after_upload_failure", status: "completed" });
        imageResult = await uploadProductImagesOnPage(page, runtimeDir, assets, "publish-page-images-uploaded-after-reset.png");
        screenshotFiles.push(imageResult.screenshotFile);
        uploadedGroups = imageResult.uploadedGroups;
        uploadIssue = imageResult.uploadIssue;
      }
    }
    if (uploadIssue || !graphicUploadGroupsComplete(uploadedGroups)) {
      stages.push({ step: "upload_product_images", status: "failed" });
      throw new Error(`Graphic flow stopped: 图文信息模块未完成。${uploadIssue || "Main/white-background/detail image groups were not uploaded successfully."}`);
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
            whiteBackgroundImages: [],
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

    return writePublishJobResult({
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
                  ? ((browserData as { publishClicked?: boolean } | undefined)?.publishClicked ? "published" : "publish_page_ready")
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
                ? ((browserData as { publishClicked?: boolean } | undefined)?.publishClicked
                    ? "Publish flow completed and publish button was clicked."
                    : "Publish flow prepared, queried, and inspected in one task.")
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
          ...readPublishRuleSummary(),
          modelSpec: resolvedMetadata.modelSpec,
          shippingMode: "\u73B0\u8D27\u53D1\u8D27\u6A21\u5F0F",
          shippingTime: "48\u5C0F\u65F6",
          productStatus: "\u4E0A\u67B6",
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
    });
  } catch (error) {
    const diagnosticError = error as QueryDiagnosticError;
    if (diagnosticError.screenshotFile) {
      screenshots.push(diagnosticError.screenshotFile);
    }
    return writePublishJobResult({
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
    });
  }
}
