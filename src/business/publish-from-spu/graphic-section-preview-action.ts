import fs from "node:fs";
import path from "node:path";
import type { Locator, Page } from "playwright";
import { normalizeProductCategory } from "../../autolist/product-category.js";
import { launchPersistentBrowser } from "../../browser/launch.js";
import { getSelectAllShortcut } from "../../utils/platform.js";
import { logInfo, logWarn } from "../../utils/logger.js";
import {
  PublishCreatePageReopenRequiredError,
  attachSafeDialogHandler,
  closeCreatePagesExcept,
  closeExtraPages,
  gotoWithTolerance,
  isNavigationContextDestroyedError,
  normalizeMatchText,
  normalizeSpuMatchText,
  reuseOrOpenCreatePage,
  savePageScreenshot
} from "./browser-session.js";
import {
  clickRadioByLabel,
  clickVisibleText,
  dismissTransientOverlays,
  isRadioSelectedByLabel
} from "./dom-actions.js";
import { writePublishJobResult } from "./job-result.js";
import {
  assertProductAssetsForShop,
  assertResolvedMetadata,
  resolvePublishFromSpuMetadata
} from "./metadata-resolution.js";
import { inspectPublishPage, inspectPublishPageOnPage } from "./publish-page-inspection.js";
import {
  assertDoudianPublishSessionReady,
  clickVisibleDropdownOption,
  ensurePlatformSpuPage,
  queryPlatformSpu
} from "./platform-spu-query-action.js";
import {
  recoverUsablePageFromContext,
  recoverUsablePublishPage,
  waitForPublishCreatePageReady
} from "./publish-page-readiness.js";
import {
  clickSwitchManualSpecEntryMode,
  isSpecTemplateSmartFillUploadModeVisible
} from "./spec-template-mode.js";
import {
  ensurePublishSectionTab,
  ensureServiceSectionReady,
  findLabelAbsoluteTop,
  scrollLabelIntoView,
  scrollPublishSectionContentIntoView
} from "./publish-section-navigation.js";
import { classifyAssets, validateMainImageAspectRatio } from "./assets.js";
import { prepareQualificationImagesForUpload } from "./qualification-image-normalizer.js";
import {
  FIXED_FREIGHT_TEMPLATE_KEYWORD,
  FIXED_SPEC_VALUES,
  GRAPHIC_SECTION_LABELS,
  PLATFORM_SPU_URL,
  SPEC_TEMPLATE_KEYWORD_DEFAULT,
  SPEC_TEMPLATE_KEYWORD_JIUGUANG
} from "./constants.js";
import { resolveFeishuPriceInventoryRows, type PriceInventoryRowValue } from "./price-inventory-rules.js";
import { applyPriceInventoryOnPage, countVisiblePriceInventoryRows } from "./price-inventory-action.js";
import { readPublishRuleSummary } from "./publish-rule-text.js";
import type {
  PublishActionResult,
  ProductAssets,
  ProductSheetSummary,
  PublishFlowStage,
  PublishFromSpuMetadata,
  PublishFromSpuJobInput,
  PublishFromSpuJobOptions,
  PublishFromSpuJobResult,
  ResolvedPublishFromSpuMetadata,
  QueryDiagnosticError,
  QueryMatchCandidate
} from "./types.js";
import { summarizeWorkbook } from "./workbook.js";
import {
  applyHealthFoodSpecificationOnPage,
  fillHealthFoodCategoryAttributesOnPage,
  fillHealthFoodSafetyAttributesOnPage,
  uploadHealthFoodOuterPackagingOnPage,
  uploadHealthFoodPackagingLabelOnPage
} from "./health-food-actions.js";
import {
  OPTIONAL_GRAPHIC_SECTIONS_ARE_OUTSIDE_PUBLISH_FLOW,
  evaluateBasicInfoGateRecovery,
  evaluateBasicPrefillReadiness,
  evaluateShopSwitchMenuState,
  evaluateDetailImageCompletion,
  evaluateDetailUploadOutcome,
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
  isMatchingSpecTemplateValue,
  isUploadPlaceholderGraphicContext,
  resolveBasicFieldIdAliases,
  resolvePriceInventoryRowInputRoles,
  resolveSpecTemplateKeywordCandidates
} from "./publish-rules.js";
import type { PublishRuleCheck, ServiceFulfillmentState } from "./publish-rules.js";
import { makePublishActionResult } from "./publish-actions.js";



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

      const clicked = await clickLastGraphicSectionPreviewDeleteByDom(page, sectionName).catch(() => false);
      if (!clicked) {
        break;
      }
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

export async function clickLastGraphicSectionPreviewDeleteByDom(page: Page, sectionName: string): Promise<boolean> {
  return page.evaluate(
    ({ targetSection, sectionLabels, uploadPlaceholderPattern }) => {
      const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
      const isVisible = (el: HTMLElement): boolean => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      };
      const labels = Array.from(document.querySelectorAll("body *"))
        .map((el) => {
          const node = el as HTMLElement;
          const rect = node.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) {
            return null;
          }
          return { el: node, text: normalize(node.textContent || "").replace(/^\*/, "").trim(), rect };
        })
        .filter(Boolean) as Array<{ el: HTMLElement; text: string; rect: DOMRect }>;

      const contentLabels = labels.filter((item) => item.rect.left > 250);
      const current = contentLabels
        .map((item) => {
          const exact = item.text === targetSection;
          const starts = item.text.startsWith(targetSection);
          const shortIncludes = item.text.includes(targetSection) && item.text.length <= targetSection.length + 80;
          if (!exact && !starts && !shortIncludes) {
            return null;
          }
          return { ...item, score: (exact ? 1000 : starts ? 700 : 300) - item.text.length - item.rect.left / 1000 };
        })
        .filter(Boolean)
        .sort((a, b) => (b!.score || 0) - (a!.score || 0))[0];
      if (!current) {
        return false;
      }

      const nextTop =
        contentLabels
          .filter((item) => sectionLabels.includes(item.text) && item.rect.top > current.rect.top)
          .sort((a, b) => a.rect.top - b.rect.top)[0]?.rect.top || current.rect.bottom + 500;

      const isUploadPlaceholderContext = (el: HTMLElement): boolean => {
        const context = [el.textContent || "", el.parentElement?.textContent || "", el.closest("div")?.textContent || ""]
          .join(" ")
          .replace(/\s+/g, "");
        return !context.includes("删除") && new RegExp(uploadPlaceholderPattern).test(context);
      };

      const previews = Array.from(document.querySelectorAll("img, [style*='background-image']"))
        .map((el) => {
          const node = el as HTMLElement;
          const rect = node.getBoundingClientRect();
          const style = window.getComputedStyle(node);
          if (
            rect.width < 40 ||
            rect.height < 40 ||
            style.display === "none" ||
            style.visibility === "hidden" ||
            style.position === "fixed" ||
            style.position === "sticky" ||
            rect.top < current.rect.top - 20 ||
            rect.top > nextTop - 10 ||
            rect.left <= current.rect.left ||
            isUploadPlaceholderContext(node)
          ) {
            return null;
          }
          return { el: node, rect };
        })
        .filter(Boolean)
        .sort((a, b) => a!.rect.top - b!.rect.top || a!.rect.left - b!.rect.left) as Array<{ el: HTMLElement; rect: DOMRect }>;
      const preview = previews[previews.length - 1];
      if (!preview) {
        return false;
      }

      let previewRoot: HTMLElement = preview.el;
      for (let depth = 0; previewRoot.parentElement && depth < 5; depth += 1) {
        const parent = previewRoot.parentElement as HTMLElement;
        const parentRect = parent.getBoundingClientRect();
        if (parentRect.width >= preview.rect.width && parentRect.height >= preview.rect.height) {
          previewRoot = parent;
        }
      }

      const markerText = (el: HTMLElement): string =>
        [
          el.textContent || "",
          el.getAttribute("aria-label") || "",
          el.getAttribute("title") || "",
          el.getAttribute("href") || "",
          el.getAttribute("xlink:href") || "",
          String(el.className || "")
        ]
          .join(" ")
          .replace(/\s+/g, "")
          .toLowerCase();
      const isDeleteControl = (el: HTMLElement): boolean => {
        const marker = markerText(el);
        return marker.includes("删除") || /(delete|remove|trash|shanchu|icon-delete|icon-trash|semi-icon-close|close)/.test(marker);
      };
      const candidates = Array.from(document.querySelectorAll("button, [role='button'], a, div, span, i, svg, use, path"))
        .map((el) => {
          const node = el as HTMLElement;
          if (!isVisible(node) || !isDeleteControl(node)) {
            return null;
          }
          const rect = node.getBoundingClientRect();
          const inSection =
            rect.top >= current.rect.top - 140 &&
            rect.top <= nextTop + 130 &&
            rect.left >= current.rect.left - 60;
          const inPreviewRoot = previewRoot.contains(node);
          const nearPreview =
            rect.left >= preview.rect.left - 50 &&
            rect.left <= preview.rect.right + 180 &&
            rect.top >= preview.rect.top - 180 &&
            rect.top <= preview.rect.bottom + 150;
          if (!inPreviewRoot && (!inSection || !nearPreview)) {
            return null;
          }
          const text = normalize(node.textContent || "");
          return {
            el: (node.closest("button, [role='button'], a") as HTMLElement | null) || node,
            score:
              (text === "删除" ? 1000 : 0) +
              (inPreviewRoot ? 350 : 0) +
              (nearPreview ? 200 : 0) -
              Math.abs(rect.top - preview.rect.top) / 3 -
              Math.abs(rect.left - preview.rect.right) / 5
          };
        })
        .filter(Boolean)
        .sort((a, b) => (b!.score || 0) - (a!.score || 0)) as Array<{ el: HTMLElement; score: number }>;
      const target = candidates[0]?.el || null;
      if (!target) {
        return false;
      }
      target.click();
      return true;
    },
    { targetSection: sectionName, sectionLabels: GRAPHIC_SECTION_LABELS, uploadPlaceholderPattern: "\u4e0a\u4f20(?:\u767d\u5e95\u56fe|\u4e3b\u56fe|\u8f85\u52a9\u56fe)" }
  );
}

export async function purgeForbiddenGraphicSectionsSafe(page: Page): Promise<string[]> {
  const removedSections: string[] = [];
  const forbiddenSections = ["主图3:4"];

  for (const sectionName of forbiddenSections) {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const previews = await getGraphicSectionPreviewRectsSafe(page, sectionName);
      if (!previews.length) {
        break;
      }

      const clicked = await clickLastGraphicSectionPreviewDeleteByDom(page, sectionName).catch(() => false);
      if (!clicked) {
        break;
      }
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

export async function countMainImagePreviews(page: Page): Promise<number> {
  return countGraphicSectionPreviewsStrict(page, "\u4e3b\u56fe").catch(() => 0);
}

export async function countWhiteBackgroundPreviews(page: Page): Promise<number> {
  return countGraphicSectionPreviewsStrict(page, "\u767d\u5e95\u56fe").catch(() => 0);
}

export async function countMain34Previews(page: Page): Promise<number> {
  return countGraphicSectionPreviewsStrict(page, "\u4e3b\u56fe3:4").catch(() => 0);
}

export async function readDetailIndicatorCount(page: Page): Promise<number | null> {
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

export async function countDetailImagePreviews(page: Page): Promise<number> {
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

export async function waitForPreviewCount(
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

export async function getGraphicSectionPreviewRectsStrict(
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

export async function clickConfirmIfVisibleStrict(page: Page): Promise<void> {
  const confirmButton = page.getByRole("button", { name: "\u786e\u5b9a" }).first();
  if (await confirmButton.count()) {
    await confirmButton.click({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(600);
  }
}

export async function scrollGraphicSectionIntoView(page: Page, sectionName: string): Promise<boolean> {
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

export async function clearGraphicSectionPreviewsStrict(page: Page, sectionName: string, maxAttempts = 10): Promise<number> {
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

    const clicked = await clickLastGraphicSectionPreviewDeleteByDom(page, sectionName).catch(() => false);
    if (!clicked) {
      break;
    }

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

export async function clickFillFromMainForDetailSection(page: Page): Promise<boolean> {
  await ensurePublishSectionTab(page, "\u56fe\u6587\u4fe1\u606f");
  const detailSectionVisible =
    (await scrollGraphicSectionIntoView(page, "\u5546\u54c1\u8be6\u60c5").catch(() => false)) ||
    (await scrollGraphicSectionIntoView(page, "\u8be6\u60c5\u9875").catch(() => false));
  if (!detailSectionVisible) {
    await scrollPublishSectionContentIntoView(page, "\u56fe\u6587\u4fe1\u606f").catch(() => false);
  }
  await scrollGraphicSectionIntoView(page, "\u5546\u54c1\u8be6\u60c5").catch(() => false);
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
          return { el };
        })
        .filter(Boolean)
        .sort((a, b) => a!.el.getBoundingClientRect().top - b!.el.getBoundingClientRect().top);

      const target = nodes[0];
      if (!target) {
        return false;
      }
      const clickable = (target.el.closest("button, [role='button'], a") as HTMLElement | null) || target.el;
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

export async function clearDetailImagePreviewsStrict(page: Page, maxAttempts = 12): Promise<number> {
  let removedCount = 0;
  await ensurePublishSectionTab(page, "\u56fe\u6587\u4fe1\u606f");
  const detailSectionVisible =
    (await scrollGraphicSectionIntoView(page, "\u5546\u54c1\u8be6\u60c5").catch(() => false)) ||
    (await scrollGraphicSectionIntoView(page, "\u8be6\u60c5\u9875").catch(() => false));
  if (!detailSectionVisible) {
    await scrollPublishSectionContentIntoView(page, "\u56fe\u6587\u4fe1\u606f").catch(() => false);
  }
  await scrollGraphicSectionIntoView(page, "\u5546\u54c1\u8be6\u60c5").catch(() => false);
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

    const clicked =
      (await clickLastGraphicSectionPreviewDeleteByDom(page, "\u8be6\u60c5\u9875").catch(() => false)) ||
      (await clickLastGraphicSectionPreviewDeleteByDom(page, "\u5546\u54c1\u8be6\u60c5").catch(() => false));
    if (!clicked) {
      break;
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
