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
import { runBasicInfoAction } from "./actions/basic-info-action.js";
import { runGraphicInfoAction } from "./actions/graphic-info-action.js";
import { runServiceAction } from "./actions/service-action.js";
import { createDefaultShopSpuActionDeps, runShopSpuAction } from "./actions/shop-spu-action.js";
import { runSpecPriceAction } from "./actions/spec-price-action.js";
import { runSubmitAction } from "./actions/submit-action.js";
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

import {
  clearGraphicSectionPreviewsStrict,
  countDetailImagePreviews,
  countMainImagePreviews,
  scrollGraphicSectionIntoView,
  waitForPreviewCount
} from "./graphic-section-preview-action.js";



export async function collectFileInputs(page: Page): Promise<
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

export function pickBestFileInput(
  inputs: Array<{ index: number; accept: string; multiple: boolean; parentText: string; sectionLabel?: string }>,
  scoreInput: (input: { index: number; accept: string; multiple: boolean; parentText: string; sectionLabel?: string }) => number
): { index: number; accept: string; multiple: boolean; parentText: string; sectionLabel?: string } | null {
  const scored = inputs
    .map((input) => ({ input, score: scoreInput(input) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.input.index - b.input.index);
  return scored[0]?.input || null;
}

export function pickBestSectionFileInput(
  inputs: Array<{ index: number; accept: string; multiple: boolean; parentText: string; sectionLabel?: string }>,
  sectionLabel: string,
  scoreInput: (input: { index: number; accept: string; multiple: boolean; parentText: string; sectionLabel?: string }) => number
): { index: number; accept: string; multiple: boolean; parentText: string; sectionLabel?: string } | null {
  const exact = inputs.filter((input) => input.sectionLabel === sectionLabel);
  return pickBestFileInput(exact.length ? exact : inputs, scoreInput);
}

export function pickExactSectionFileInput(
  inputs: Array<{ index: number; accept: string; multiple: boolean; parentText: string; sectionLabel?: string }>,
  sectionLabel: string,
  scoreInput: (input: { index: number; accept: string; multiple: boolean; parentText: string; sectionLabel?: string }) => number
): { index: number; accept: string; multiple: boolean; parentText: string; sectionLabel?: string } | null {
  return pickBestFileInput(inputs.filter((input) => input.sectionLabel === sectionLabel), scoreInput);
}

export function scoreMainGraphicInput(input: { parentText: string; multiple: boolean; sectionLabel?: string }): number {
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

export function scoreWhiteBackgroundGraphicInput(input: { parentText: string; multiple: boolean; sectionLabel?: string }): number {
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

export function scoreDetailGraphicInput(input: { parentText: string; multiple: boolean; sectionLabel?: string }): number {
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

export function scoreMedicalDeviceCertificateInput(input: { parentText: string; multiple: boolean; sectionLabel?: string }): number {
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

export async function findExactVisibleUploadFieldInput(
  page: Page,
  fieldLabel: string
): Promise<{ index: number; accept: string; multiple: boolean; parentText: string; sectionLabel?: string } | null> {
  return page.locator("input[type='file']").evaluateAll((elements, targetLabel) => {
    const normalize = (value: string): string => value.trim().replace(/\s+/g, " ");
    const isVisibleRect = (rect: DOMRect): boolean => rect.width > 0 && rect.height > 0;
    const visibleTextItems = Array.from(document.querySelectorAll("body *"))
      .map((node) => {
        const element = node as HTMLElement;
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        const text = normalize(element.innerText || element.textContent || "");
        if (!text || !isVisibleRect(rect) || style.display === "none" || style.visibility === "hidden") {
          return null;
        }
        return { element, rect, text };
      })
      .filter(Boolean) as Array<{ element: HTMLElement; rect: DOMRect; text: string }>;

    const fieldLabelText = String(targetLabel);
    const target = visibleTextItems
      .filter((item) => {
        const text = item.text.replace(/^\*\s*/, "");
        return text === fieldLabelText || item.text === `* ${fieldLabelText}` || item.text === `*${fieldLabelText}`;
      })
      .sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left)[0];
    if (!target) {
      return null;
    }

    const nextLabelTop =
      visibleTextItems
        .filter((item) => {
          if (item === target || item.text.includes("/") || item.text.includes("+")) {
            return false;
          }
          if (item.rect.top <= target.rect.top + 20) {
            return false;
          }
          if (Math.abs(item.rect.left - target.rect.left) > 190) {
            return false;
          }
          if (item.text.length > 48) {
            return false;
          }
          return true;
        })
        .sort((a, b) => a.rect.top - b.rect.top)[0]?.rect.top || target.rect.bottom + 260;

    const inputRecords = elements
      .map((el, index) => {
        let inputRect: DOMRect | null = null;
        let node: HTMLElement | null = el as HTMLElement;
        for (let depth = 0; node && depth < 12; depth += 1, node = node.parentElement) {
          const rect = node.getBoundingClientRect();
          if (isVisibleRect(rect)) {
            inputRect = rect;
            break;
          }
        }
        if (!inputRect) {
          return null;
        }
        if (!(inputRect.top >= target.rect.top - 12 && inputRect.top < nextLabelTop)) {
          return null;
        }
        const parentText = (() => {
          let textNode: HTMLElement | null = (el as HTMLElement).parentElement;
          let best = "";
          for (let depth = 0; textNode && depth < 8; depth += 1, textNode = textNode.parentElement) {
            const text = normalize(textNode.textContent || "");
            if (text && text.length <= 1200 && text.length > best.length) {
              best = text;
            }
          }
          return best;
        })();
        return {
          index,
          accept: el.getAttribute("accept") || "",
          multiple: el.hasAttribute("multiple"),
          parentText,
          sectionLabel: fieldLabelText,
          top: inputRect.top,
          left: inputRect.left
        };
      })
      .filter(Boolean) as Array<{
        index: number;
        accept: string;
        multiple: boolean;
        parentText: string;
        sectionLabel: string;
        top: number;
        left: number;
      }>;

    return (
      inputRecords
        .sort((a, b) => Math.abs(a.top - target.rect.bottom) - Math.abs(b.top - target.rect.bottom) || a.left - b.left)[0] || null
    );
  }, fieldLabel);
}

export async function uploadFilesToInput(
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

export async function readMedicalDeviceCertificateState(page: Page): Promise<{
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

export async function ensureMedicalDeviceCertificateFromFirstQualification(
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

  const certificateInput = await findExactVisibleUploadFieldInput(page, "\u533b\u7597\u5668\u68b0\u6ce8\u518c\u8bc1");
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

type DetailQualificationUploadResult = {
  attemptedCount: number;
  acknowledgedCount: number;
  finalCount: number;
  failedFileIndex?: number;
};

export async function uploadDetailImagesByInputCapability(
  page: Page,
  files: string[],
  baselineCount: number
): Promise<DetailQualificationUploadResult> {
  if (!files.length) {
    return { attemptedCount: 0, acknowledgedCount: 0, finalCount: baselineCount };
  }

  let acknowledgedCount = 0;
  let previousCount = baselineCount;
  for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
    let acknowledged = false;
    for (let attempt = 0; attempt < 2 && !acknowledged; attempt += 1) {
      await ensurePublishSectionTab(page, "\u56fe\u6587\u4fe1\u606f");
      const detailSectionVisible =
        (await scrollGraphicSectionIntoView(page, "\u5546\u54c1\u8be6\u60c5").catch(() => false)) ||
        (await scrollGraphicSectionIntoView(page, "\u8be6\u60c5\u9875").catch(() => false));
      if (!detailSectionVisible) {
        await scrollPublishSectionContentIntoView(page, "\u56fe\u6587\u4fe1\u606f").catch(() => false);
      }
      await dismissTransientOverlays(page);

      const inputs = await collectFileInputs(page);
      const input =
        pickBestSectionFileInput(inputs, "\u5546\u54c1\u8be6\u60c5", scoreDetailGraphicInput) ||
        pickBestSectionFileInput(inputs, "\u8be6\u60c5\u9875", scoreDetailGraphicInput);
      if (!input) {
        continue;
      }
      await page.locator("input[type='file']").nth(input.index).setInputFiles(files[fileIndex]);
      const observedCount = await waitForPreviewCount(
        page,
        () => countDetailImagePreviews(page),
        previousCount + 1,
        15000
      );
      if (observedCount >= previousCount + 1) {
        previousCount = observedCount;
        acknowledgedCount += 1;
        acknowledged = true;
      }
    }
    if (!acknowledged) {
      return {
        attemptedCount: fileIndex + 1,
        acknowledgedCount,
        finalCount: previousCount,
        failedFileIndex: fileIndex + 1
      };
    }
  }
  return { attemptedCount: files.length, acknowledgedCount, finalCount: previousCount };
}

export async function uploadFilesToSectionSlots(
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

async function resolveCurrentMainImageUploadInput(page: Page, fileIndex: number): Promise<{ index: number } | null> {
  const inputs = await collectFileInputs(page);
  const sectionInputs = inputs
    .filter((input) => input.sectionLabel === "\u4e3b\u56fe")
    .sort((a, b) => a.index - b.index);

  if (sectionInputs.length) {
    return sectionInputs[fileIndex] || null;
  }

  if (fileIndex === 0) {
    return pickBestSectionFileInput(inputs, "\u4e3b\u56fe", scoreMainGraphicInput) || null;
  }

  return null;
}

export async function uploadMainImagesToSection(page: Page, files: string[]): Promise<number> {
  if (!files.length) {
    return 0;
  }

  if (!(await resolveCurrentMainImageUploadInput(page, 0))) {
    return 0;
  }

  const uploadSequenceOnce = async (): Promise<{ uploaded: number; confirmed: number }> => {
    let uploaded = 0;
    let previousCount = await countMainImagePreviews(page).catch(() => 0);

    for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
      const input = await resolveCurrentMainImageUploadInput(page, fileIndex);
      if (!input) {
        return { uploaded, confirmed: previousCount };
      }
      await page.locator("input[type='file']").nth(input.index).setInputFiles(files[fileIndex]);
      uploaded += 1;
      const expectedCount = Math.max(previousCount, fileIndex + 1);
      const observedCount = await waitForPreviewCount(
        page,
        () => countMainImagePreviews(page),
        expectedCount,
        fileIndex === 0 ? 4000 : 3000
      ).catch(() => previousCount);
      if (observedCount < expectedCount) {
        return { uploaded: uploaded - 1, confirmed: previousCount };
      }
      previousCount = observedCount;
      await page.waitForTimeout(fileIndex === 0 ? 450 : 180);
      await dismissTransientOverlays(page);
    }

    return { uploaded, confirmed: previousCount };
  };

  const firstAttempt = await uploadSequenceOnce();
  if (firstAttempt.confirmed >= files.length) {
    return firstAttempt.confirmed;
  }

  logWarn(
    `Main image upload sequence only confirmed ${firstAttempt.confirmed}/${files.length} preview(s); clearing section and restarting once.`
  );
  await clearGraphicSectionPreviewsStrict(page, "\u4e3b\u56fe", Math.max(10, files.length + 3)).catch(() => 0);
  await page.waitForTimeout(700);
  await dismissTransientOverlays(page);

  const secondAttempt = await uploadSequenceOnce();
  if (secondAttempt.confirmed < files.length) {
    throw new Error(
      `Main image upload did not reach ${files.length} preview(s) after restart; confirmed=${secondAttempt.confirmed}, uploaded=${secondAttempt.uploaded}.`
    );
  }

  return secondAttempt.confirmed;
}
