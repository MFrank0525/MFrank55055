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
  evaluateShippingBeforePriceInventoryCompletion,
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

import { fillBasicPublishPageOnPage, verifyCategoryRegistrationGateOnPage } from "./basic-info-page-action.js";
import {
  applySpecTemplateWithVerificationOnPage,
  chooseKeywordFreightTemplate,
  readLabeledSelectValue
} from "./spec-service-page-action.js";

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

const SHIPPING_MODE_FIELD_LABEL_CANDIDATES = ["\u53d1\u8d27\u6a21\u5f0f"];
const SHIPPING_MODE_OPTION_TEXT_CANDIDATES = ["\u73b0\u8d27"];
const SHIPPING_TIME_FIELD_LABEL_CANDIDATES = [
  "\u73b0\u8d27\u53d1\u8d27\u65f6\u95f4",
  "\u53d1\u8d27\u65f6\u95f4",
  "\u627f\u8bfa\u53d1\u8d27\u65f6\u95f4"
];
const SHIPPING_TIME_OPTION_TEXT_CANDIDATES = ["48\u5c0f\u65f6", "48\u5c0f\u65f6\u5185\u53d1\u8d27"];

function isOptionTextMatch(text: string, targetOptionText: string): boolean {
  return text === targetOptionText || text.includes(targetOptionText);
}

async function clickRadioOptionNearFieldLabel(page: Page, fieldLabel: string, optionText: string): Promise<boolean> {
  return clickRadioOptionNearFieldLabelCandidate(page, [fieldLabel], [optionText]);
}

async function clickRadioOptionNearFieldLabelCandidate(
  page: Page,
  fieldLabels: string[],
  optionTexts: string[]
): Promise<boolean> {
  const radioOptionMarker = `data-auto-listing-radio-option-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const marked = await page.evaluate(
    ({ fieldLabels: targetFieldLabels, optionTexts: targetOptionTexts, markerName }) => {
      const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
      const isOptionTextMatch = (text: string, targetOptionText: string): boolean =>
        text === targetOptionText || text.includes(targetOptionText);
      const isVisible = (el: HTMLElement): boolean => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      };
      const visibleText = (el: HTMLElement): string => (isVisible(el) ? normalize(el.innerText || el.textContent || "") : "");
      const matchesOption = (el: HTMLElement): boolean => {
        const text = visibleText(el);
        return Boolean(text) && targetOptionTexts.some((optionText) => isOptionTextMatch(text, optionText));
      };
      const radioContainers = (root: HTMLElement): HTMLElement[] =>
        Array.from(root.querySelectorAll("label, [role='radio'], input[type='radio']"))
          .map((el) => (el as HTMLElement).closest("label, [role='radio']") || el)
          .map((el) => el as HTMLElement)
          .filter((el, index, list) => isVisible(el) && list.indexOf(el) === index);
      const hasMatchingOption = (node: HTMLElement): boolean => radioContainers(node).some((el) => matchesOption(el));
      function findFieldRoot(label: HTMLElement): HTMLElement | null {
        let node = label.parentElement;
        while (node && node !== document.body) {
          const text = visibleText(node);
          if (targetFieldLabels.some((fieldLabel) => text.includes(fieldLabel)) && hasMatchingOption(node)) {
            return node;
          }
          node = node.parentElement;
        }
        return null;
      }
      const elements = Array.from(document.querySelectorAll("body *")).map((el) => el as HTMLElement);
      for (const el of elements) {
        el.removeAttribute(markerName);
      }

      for (const label of elements) {
        const labelText = visibleText(label).replace(/\*/g, "").trim();
        if (!targetFieldLabels.some((fieldLabel) => labelText === fieldLabel || labelText.includes(fieldLabel))) {
          continue;
        }
        const fieldRoot = findFieldRoot(label);
        if (!fieldRoot) {
          continue;
        }
        const option = radioContainers(fieldRoot).find((el) => matchesOption(el));
        if (!option) {
          continue;
        }
        option.scrollIntoView({ block: "center", inline: "center" });
        option.setAttribute(markerName, "true");
        return true;
      }
      return false;
    },
    { fieldLabels, optionTexts, markerName: radioOptionMarker }
  );
  if (!marked) {
    return false;
  }

  try {
    await page.locator(`[${radioOptionMarker}="true"]`).first().click({ timeout: 3000 });
    return true;
  } finally {
    await page.evaluate((markerName) => {
      for (const el of Array.from(document.querySelectorAll(`[${markerName}="true"]`))) {
        (el as HTMLElement).removeAttribute(markerName);
      }
    }, radioOptionMarker).catch(() => {});
  }
}

async function isRadioOptionSelectedNearFieldLabel(page: Page, fieldLabel: string, optionText: string): Promise<boolean> {
  return isRadioOptionSelectedNearFieldLabelCandidate(page, [fieldLabel], [optionText]);
}

async function isRadioOptionSelectedNearFieldLabelCandidate(
  page: Page,
  fieldLabels: string[],
  optionTexts: string[]
): Promise<boolean> {
  return page.evaluate(
    ({ fieldLabels: targetFieldLabels, optionTexts: targetOptionTexts }) => {
      const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
      const isOptionTextMatch = (text: string, targetOptionText: string): boolean =>
        text === targetOptionText || text.includes(targetOptionText);
      const isVisible = (el: HTMLElement): boolean => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      };
      const visibleText = (el: HTMLElement): string => (isVisible(el) ? normalize(el.innerText || el.textContent || "") : "");
      const matchesOption = (el: HTMLElement): boolean => {
        const text = visibleText(el);
        return Boolean(text) && targetOptionTexts.some((optionText) => isOptionTextMatch(text, optionText));
      };
      const radioContainers = (root: HTMLElement): HTMLElement[] =>
        Array.from(root.querySelectorAll("label, [role='radio'], input[type='radio']"))
          .map((el) => (el as HTMLElement).closest("label, [role='radio']") || el)
          .map((el) => el as HTMLElement)
          .filter((el, index, list) => isVisible(el) && list.indexOf(el) === index);
      const hasMatchingOption = (node: HTMLElement): boolean => radioContainers(node).some((el) => matchesOption(el));
      function findFieldRoot(label: HTMLElement): HTMLElement | null {
        let node = label.parentElement;
        while (node && node !== document.body) {
          const text = visibleText(node);
          if (targetFieldLabels.some((fieldLabel) => text.includes(fieldLabel)) && hasMatchingOption(node)) {
            return node;
          }
          node = node.parentElement;
        }
        return null;
      }
      const isSelected = (el: HTMLElement): boolean => {
        const input = (el.matches("input[type='radio']") ? el : el.querySelector("input[type='radio']")) as HTMLInputElement | null;
        const marker = [
          String(el.className || ""),
          el.getAttribute("role") || "",
          el.getAttribute("aria-checked") || "",
          String(el.querySelector("[class*='checked'], [class*='Checked']")?.className || "")
        ].join(" ").toLowerCase();
        return input?.checked === true || el.getAttribute("aria-checked") === "true" || /\bchecked\b|selected|active/.test(marker);
      };
      const elements = Array.from(document.querySelectorAll("body *")).map((el) => el as HTMLElement);
      for (const label of elements) {
        const labelText = visibleText(label).replace(/\*/g, "").trim();
        if (!targetFieldLabels.some((fieldLabel) => labelText === fieldLabel || labelText.includes(fieldLabel))) {
          continue;
        }
        const fieldRoot = findFieldRoot(label);
        if (!fieldRoot) {
          continue;
        }
        return radioContainers(fieldRoot).some((el) => matchesOption(el) && isSelected(el));
      }
      return false;
    },
    { fieldLabels, optionTexts }
  );
}

async function ensureRadioOptionNearFieldLabel(page: Page, fieldLabel: string, optionText: string): Promise<boolean> {
  return ensureRadioOptionNearFieldLabelCandidates(page, [fieldLabel], [optionText]);
}

async function ensureRadioOptionNearFieldLabelCandidates(
  page: Page,
  fieldLabels: string[],
  optionTexts: string[]
): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (await isRadioOptionSelectedNearFieldLabelCandidate(page, fieldLabels, optionTexts).catch(() => false)) {
      return true;
    }
    if (await clickRadioOptionNearFieldLabelCandidate(page, fieldLabels, optionTexts).catch(() => false)) {
      await page.waitForTimeout(500);
    }
    if (await isRadioOptionSelectedNearFieldLabelCandidate(page, fieldLabels, optionTexts).catch(() => false)) {
      return true;
    }
    await dismissTransientOverlays(page).catch(() => {});
    await scrollPublishSectionContentIntoView(page, "\u4ef7\u683c\u5e93\u5b58").catch(() => false);
    await page.waitForTimeout(300);
  }
  return false;
}

async function readServiceFulfillmentState(page: Page, freightTemplateName: string): Promise<ServiceFulfillmentState> {
  const shippingModeSelected =
    (await isRadioOptionSelectedNearFieldLabelCandidate(page, SHIPPING_MODE_FIELD_LABEL_CANDIDATES, SHIPPING_MODE_OPTION_TEXT_CANDIDATES).catch(() => false)) ||
    (await isRadioSelectedByLabel(page, "\u73b0\u8d27").catch(() => false));
  const shippingTimeSelected =
    (await isRadioOptionSelectedNearFieldLabelCandidate(page, SHIPPING_TIME_FIELD_LABEL_CANDIDATES, SHIPPING_TIME_OPTION_TEXT_CANDIDATES).catch(() => false)) ||
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
  await ensureRadioOptionNearFieldLabelCandidates(page, SHIPPING_MODE_FIELD_LABEL_CANDIDATES, SHIPPING_MODE_OPTION_TEXT_CANDIDATES);
  await ensureRadioOptionNearFieldLabelCandidates(page, SHIPPING_TIME_FIELD_LABEL_CANDIDATES, SHIPPING_TIME_OPTION_TEXT_CANDIDATES);
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

async function applyShippingSelectionOnPage(page: Page): Promise<PublishRuleCheck> {
  const shippingModeSelected = await ensureRadioOptionNearFieldLabelCandidates(page, SHIPPING_MODE_FIELD_LABEL_CANDIDATES, SHIPPING_MODE_OPTION_TEXT_CANDIDATES);
  await scrollLabelIntoView(page, "\u73b0\u8d27\u53d1\u8d27\u65f6\u95f4").catch(() => false);
  const shippingTimeSelected = await ensureRadioOptionNearFieldLabelCandidates(page, SHIPPING_TIME_FIELD_LABEL_CANDIDATES, SHIPPING_TIME_OPTION_TEXT_CANDIDATES);
  return evaluateShippingBeforePriceInventoryCompletion({ shippingModeSelected, shippingTimeSelected });
}

export async function applyHealthFoodShippingBeforeSpecOnPage(page: Page): Promise<PublishRuleCheck> {
  const rule = await applyShippingSelectionOnPage(page);
  if (!rule.passed) {
    return {
      passed: false,
      issue: `Health-food shipping precondition failed. ${rule.issue}`
    };
  }
  return rule;
}

export async function applyShippingBeforePriceInventoryOnPage(page: Page, runtimeDir?: string): Promise<PublishRuleCheck & { screenshotFile?: string }> {
  await ensurePublishSectionTab(page, "\u4ef7\u683c\u5e93\u5b58");
  await scrollLabelIntoView(page, "\u53d1\u8d27\u6a21\u5f0f").catch(() => false);
  const rule = await applyShippingSelectionOnPage(page);
  if (!rule.passed) {
    return {
      passed: false,
      issue: `Price-inventory shipping precondition failed. ${rule.issue}`
    };
  }
  await scrollLabelIntoView(page, "\u73b0\u8d27\u53d1\u8d27\u65f6\u95f4").catch(() => false);
  const screenshotFile = runtimeDir ? await savePageScreenshot(page, runtimeDir, "publish-page-shipping-48-selected.png").catch(() => "") : "";
  return { ...rule, screenshotFile: screenshotFile || undefined };
}

export async function applyFixedPublishSettings(
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

export async function applyFixedPublishSettingsOnPage(
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

export async function applyFixedSpecsOnPage(
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
  await scrollLabelIntoView(page, "\u5546\u54c1\u89c4\u683c").catch(() => false);
  await page.waitForTimeout(600);

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
