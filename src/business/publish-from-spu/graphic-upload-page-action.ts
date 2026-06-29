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


import {
  collectFileInputs,
  pickBestSectionFileInput,
  scoreMainGraphicInput,
  scoreWhiteBackgroundGraphicInput,
  uploadDetailImagesByInputCapability,
  uploadFilesToInput,
  uploadFilesToSectionSlots,
  uploadMainImagesToSection
} from "./graphic-file-input-action.js";
import {
  clearDetailImagePreviewsStrict,
  clearGraphicSectionPreviewsStrict,
  clickConfirmIfVisibleStrict,
  clickFillFromMainForDetailSection,
  clickLastGraphicSectionPreviewDeleteByDom,
  countDetailImagePreviews,
  countMainImagePreviews,
  countWhiteBackgroundPreviews,
  getGraphicSectionPreviewRectsStrict,
  purgeForbiddenGraphicSectionsSafe,
  readDetailIndicatorCount,
  scrollGraphicSectionIntoView,
  waitForPreviewCount
} from "./graphic-section-preview-action.js";

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
  const uploadResult = await uploadDetailImagesByInputCapability(
    page,
    assets.detailImages,
    countAfterFillFromMain
  ).catch(() => ({ attemptedCount: 0, acknowledgedCount: 0, finalCount: countAfterFillFromMain, failedFileIndex: 1 }));
  const finalCount = await waitForPreviewCount(page, () => countDetailImagePreviews(page), expectedDetailCount, 15000);
  const detailRule = evaluateDetailImageCompletion({
    filledFromMain,
    baselineDetailCount: countAfterFillFromMain,
    qualificationImageCount: assets.detailImages.length,
    acknowledgedQualificationCount: uploadResult.acknowledgedCount,
    finalDetailCount: finalCount,
    expectedDetailCount
  });
  const detailOutcome = evaluateDetailUploadOutcome({
    uploadActionCompleted: uploadResult.acknowledgedCount === assets.detailImages.length,
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
    issue: `${detailOutcome.issue || `Detail images did not reach expected count after fill-from-main plus Feishu qualifications. expected=${expectedDetailCount}; actual=${finalCount}`} acknowledged=${uploadResult.acknowledgedCount}; qualificationImages=${assets.detailImages.length}; failedFileIndex=${uploadResult.failedFileIndex ?? "none"}`
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
    const clicked =
      (await clickLastGraphicSectionPreviewDeleteByDom(page, "\u767d\u5e95\u56fe").catch(() => false)) ||
      (await clickWhiteBackgroundDeleteFallback().catch(() => false));
    if (!clicked) {
      break;
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

export function graphicUploadGroupsComplete(uploadedGroups: string[]): boolean {
  const detailDone = uploadedGroups.some(
    (item) =>
      item === "detailImages" ||
      item === "detailImages:fillFromMainThenUpload" ||
      item === "detailImages:existingWithQualifications"
  );
  return (
    OPTIONAL_GRAPHIC_SECTIONS_ARE_OUTSIDE_PUBLISH_FLOW &&
    uploadedGroups.includes("mainImages") &&
    uploadedGroups.includes("optionalGraphicSectionsIgnored") &&
    detailDone
  );
}

function markOptionalGraphicSectionsIgnored(uploadedGroups: string[]): void {
  if (
    OPTIONAL_GRAPHIC_SECTIONS_ARE_OUTSIDE_PUBLISH_FLOW &&
    !uploadedGroups.includes("optionalGraphicSectionsIgnored")
  ) {
    uploadedGroups.push("optionalGraphicSectionsIgnored");
  }
}

export async function resetGraphicModuleOnPage(page: Page, runtimeDir: string, screenshotFileName: string): Promise<string> {
  await ensurePublishSectionTab(page, "\u56fe\u6587\u4fe1\u606f");
  await dismissTransientOverlays(page);

  const mainCount = await countMainImagePreviews(page).catch(() => 0);
  if (mainCount > 0) {
    await clearGraphicSectionPreviewsStrict(page, "\u4e3b\u56fe", Math.max(10, mainCount + 3)).catch(() => 0);
    await page.waitForTimeout(800);
  }

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
    await ensurePublishSectionTab(page, "\u56fe\u6587\u4fe1\u606f");
    await scrollGraphicSectionIntoView(page, "\u4e3b\u56fe").catch(() => false);
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
      const uploadedMainCount = await uploadMainImagesToSection(page, assets.mainImages);
      if (uploadedMainCount >= assets.mainImages.length) {
        uploadedGroups.push("mainImages");
      } else {
        uploadIssue = `Main image slots did not contain ${assets.mainImages.length} images after upload; actual=${uploadedMainCount}.`;
      }
    }
    if (!uploadIssue && uploadedGroups.includes("mainImages")) {
      markOptionalGraphicSectionsIgnored(uploadedGroups);
    } else if (!uploadIssue && !mainInput) {
    const existingMainPreviewCount = await countMainImagePreviews(page);
    if (existingMainPreviewCount >= assets.mainImages.length) {
      uploadedGroups.push("mainImages");
      markOptionalGraphicSectionsIgnored(uploadedGroups);
      } else {
        logWarn("Main image upload input was not found; checking existing main/white-background previews before failing.");
      }
    } else if (!uploadIssue && !assets.mainImages.length) {
      uploadIssue = "Main image upload input was not found.";
    }

    await scrollGraphicSectionIntoView(page, "\u5546\u54c1\u8be6\u60c5").catch(() => false);
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
    markOptionalGraphicSectionsIgnored(uploadedGroups);
  }

  const finalMainPreviewCount = await countMainImagePreviews(page).catch(() => 0);
  if (!uploadedGroups.includes("mainImages") && finalMainPreviewCount >= assets.mainImages.length) {
    uploadedGroups.push("mainImages");
  }
  if (!uploadIssue && !uploadedGroups.includes("mainImages")) {
    uploadIssue = "Main image upload input was not found and no existing main/white-background preview was detected.";
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

export async function uploadProductImagesOnPage(
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
  await scrollGraphicSectionIntoView(page, "\u4e3b\u56fe").catch(() => false);
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
    const uploadedMainCount = await uploadMainImagesToSection(page, assets.mainImages);
    if (uploadedMainCount >= assets.mainImages.length) {
      uploadedGroups.push("mainImages");
    } else {
      uploadIssue = `Main image slots did not contain ${assets.mainImages.length} images after upload; actual=${uploadedMainCount}.`;
    }
  }
  if (!uploadIssue && uploadedGroups.includes("mainImages")) {
    markOptionalGraphicSectionsIgnored(uploadedGroups);
  } else if (!uploadIssue && !mainInput) {
    const existingMainPreviewCount = await countMainImagePreviews(page);
    if (existingMainPreviewCount >= assets.mainImages.length) {
      uploadedGroups.push("mainImages");
      markOptionalGraphicSectionsIgnored(uploadedGroups);
    } else {
      logWarn("Main image upload input was not found; checking existing main/white-background previews before failing.");
    }
  } else if (!uploadIssue && !assets.mainImages.length) {
    uploadIssue = "Main image upload input was not found.";
  }

  await scrollGraphicSectionIntoView(page, "\u5546\u54c1\u8be6\u60c5").catch(() => false);
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
    markOptionalGraphicSectionsIgnored(uploadedGroups);
  }

  const finalMainPreviewCount = await countMainImagePreviews(page).catch(() => 0);
  if (!uploadedGroups.includes("mainImages") && finalMainPreviewCount >= assets.mainImages.length) {
    uploadedGroups.push("mainImages");
  }
  if (!uploadIssue && !uploadedGroups.includes("mainImages")) {
    uploadIssue = "Main image upload input was not found and no existing main/white-background preview was detected.";
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
