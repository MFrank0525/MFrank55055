import fs from "node:fs";
import path from "node:path";
import type { Locator, Page } from "playwright";
import { normalizeProductCategory } from "../autolist/product-category.js";
import { launchPersistentBrowser } from "../browser/launch.js";
import { getSelectAllShortcut } from "../utils/platform.js";
import { logInfo, logWarn } from "../utils/logger.js";
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
} from "./publish-from-spu/browser-session.js";
import {
  clickRadioByLabel,
  clickVisibleText,
  dismissTransientOverlays,
  isRadioSelectedByLabel
} from "./publish-from-spu/dom-actions.js";
import { writePublishJobResult } from "./publish-from-spu/job-result.js";
import {
  assertProductAssetsForShop,
  assertResolvedMetadata,
  resolvePublishFromSpuMetadata
} from "./publish-from-spu/metadata-resolution.js";
import { inspectPublishPage, inspectPublishPageOnPage } from "./publish-from-spu/publish-page-inspection.js";
import {
  assertDoudianPublishSessionReady,
  clickVisibleDropdownOption,
  ensurePlatformSpuPage,
  queryPlatformSpu
} from "./publish-from-spu/platform-spu-query-action.js";
import {
  recoverUsablePageFromContext,
  recoverUsablePublishPage,
  waitForPublishCreatePageReady
} from "./publish-from-spu/publish-page-readiness.js";
import {
  clickSwitchManualSpecEntryMode,
  isSpecTemplateSmartFillUploadModeVisible
} from "./publish-from-spu/spec-template-mode.js";
import {
  ensurePublishSectionTab,
  ensureServiceSectionReady,
  findLabelAbsoluteTop,
  scrollLabelIntoView,
  scrollPublishSectionContentIntoView
} from "./publish-from-spu/publish-section-navigation.js";
import { runBasicInfoAction } from "./publish-from-spu/actions/basic-info-action.js";
import { runGraphicInfoAction } from "./publish-from-spu/actions/graphic-info-action.js";
import { runServiceAction } from "./publish-from-spu/actions/service-action.js";
import { createDefaultShopSpuActionDeps, runShopSpuAction } from "./publish-from-spu/actions/shop-spu-action.js";
import { runSpecPriceAction } from "./publish-from-spu/actions/spec-price-action.js";
import { runSubmitAction } from "./publish-from-spu/actions/submit-action.js";
import { classifyAssets, validateMainImageAspectRatio } from "./publish-from-spu/assets.js";
import { prepareQualificationImagesForUpload } from "./publish-from-spu/qualification-image-normalizer.js";
import {
  FIXED_FREIGHT_TEMPLATE_KEYWORD,
  FIXED_SPEC_VALUES,
  GRAPHIC_SECTION_LABELS,
  PLATFORM_SPU_URL,
  SPEC_TEMPLATE_KEYWORD_DEFAULT,
  SPEC_TEMPLATE_KEYWORD_JIUGUANG
} from "./publish-from-spu/constants.js";
import { resolveFeishuPriceInventoryRows, type PriceInventoryRowValue } from "./publish-from-spu/price-inventory-rules.js";
import { applyPriceInventoryOnPage, countVisiblePriceInventoryRows } from "./publish-from-spu/price-inventory-action.js";
import { readPublishRuleSummary } from "./publish-from-spu/publish-rule-text.js";
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
} from "./publish-from-spu/types.js";
import { summarizeWorkbook } from "./publish-from-spu/workbook.js";
import {
  applyHealthFoodSpecificationOnPage,
  fillHealthFoodCategoryAttributesOnPage,
  fillHealthFoodSafetyAttributesOnPage,
  uploadHealthFoodOuterPackagingOnPage,
  uploadHealthFoodPackagingLabelOnPage
} from "./publish-from-spu/health-food-actions.js";
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
} from "./publish-from-spu/publish-rules.js";
import type { PublishRuleCheck, ServiceFulfillmentState } from "./publish-from-spu/publish-rules.js";
import { makePublishActionResult } from "./publish-from-spu/publish-actions.js";

export type { PublishFromSpuJobInput, PublishFromSpuJobOptions, PublishFromSpuJobResult } from "./publish-from-spu/types.js";
export {
  applyHealthFoodSpecificationOnPage,
  checkHealthFunctionOptionOnPage,
  fillHealthFoodCategoryAttributesOnPage,
  fillHealthFoodSafetyAttributesOnPage,
  fillHealthFoodTextFieldOnPage,
  findHealthFoodFieldRootByLabel,
  selectHealthFoodExactOptionOnPage,
  uploadHealthFoodFileInFieldOnPage,
  uploadHealthFoodOuterPackagingOnPage,
  uploadHealthFoodPackagingLabelOnPage
} from "./publish-from-spu/health-food-actions.js";
export type {
  HealthFoodCategoryReadbackResult,
  HealthFoodCheckboxReadbackResult,
  HealthFoodFileUploadReadbackResult,
  HealthFoodSafetyReadbackResult,
  HealthFoodSelectReadbackResult,
  HealthFoodSpecificationReadbackResult,
  HealthFoodTextReadbackResult
} from "./publish-from-spu/health-food-actions.js";
export { resolvePublishFromSpuMetadata } from "./publish-from-spu/metadata-resolution.js";
export { assertDoudianPublishSessionReady } from "./publish-from-spu/platform-spu-query-action.js";

async function isBasicPublishFieldAvailable(page: Page, field: "title" | "shortTitle" | "modelSpec"): Promise<boolean> {
  const aliases = resolveBasicFieldIdAliases(field);
  return page.evaluate((fieldAliases) => {
    const normalize = (text: string): string => text.replace(/\s+/g, " ").trim();
    const visible = (el: HTMLElement): boolean => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    const hasUsableInput = (root: ParentNode): boolean =>
      Array.from(root.querySelectorAll("input, textarea"))
        .map((el) => el as HTMLInputElement | HTMLTextAreaElement)
        .some((input) => visible(input) && !input.disabled && !input.readOnly);
    const roots = fieldAliases
      .map((fieldId) => document.querySelector(`[attr-field-id="${fieldId}"]`) as HTMLElement | null)
      .filter((root): root is HTMLElement => Boolean(root));
    if (roots.some((root) => hasUsableInput(root))) {
      return true;
    }
    const labels = Array.from(document.querySelectorAll("body *"))
      .map((el) => el as HTMLElement)
      .filter((el) => visible(el) && fieldAliases.some((alias) => normalize(el.innerText || el.textContent || "").includes(alias)));
    return labels.some((label) => {
      let node: HTMLElement | null = label;
      for (let depth = 0; node && depth < 6; depth += 1) {
        if (hasUsableInput(node)) {
          return true;
        }
        node = node.parentElement;
      }
      return false;
    });
  }, aliases);
}

async function waitForBasicFieldAvailable(
  page: Page,
  field: "title" | "shortTitle" | "modelSpec",
  timeoutMs: number,
  onProgress?: (message: string) => void
): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await isBasicPublishFieldAvailable(page, field).catch(() => false)) {
      return true;
    }
    onProgress?.(`basic_info_wait_field: ${field}`);
    await page.waitForTimeout(1500);
  }
  return false;
}

async function assertBasicPrefillReadyOnPage(
  page: Page,
  metadata: { shortTitle?: string },
  onProgress?: (message: string) => void
): Promise<void> {
  const shortTitleFieldVisible = metadata.shortTitle
    ? await waitForBasicFieldAvailable(page, "shortTitle", 18000, onProgress)
    : true;
  const readiness = evaluateBasicPrefillReadiness({
    shortTitleRequired: Boolean(metadata.shortTitle),
    shortTitleFieldVisible
  });
  if (readiness.action === "reopen_from_platform_spu") {
    throw new PublishCreatePageReopenRequiredError(readiness.issue);
  }
}

async function setBasicPublishFieldValue(
  page: Page,
  field: "title" | "shortTitle" | "modelSpec",
  value: string
): Promise<boolean> {
  const aliases = resolveBasicFieldIdAliases(field);
  const updated = await page.evaluate(
    ({ fieldAliases, nextValue }) => {
      const normalize = (text: string): string => text.replace(/\s+/g, " ").trim();
      const visible = (el: HTMLElement): boolean => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      };
      const roots = fieldAliases
        .map((fieldId) => document.querySelector(`[attr-field-id="${fieldId}"]`) as HTMLElement | null)
        .filter((root): root is HTMLElement => Boolean(root));
      if (!roots.length) {
        const labels = Array.from(document.querySelectorAll("body *"))
          .map((el) => el as HTMLElement)
          .filter((el) => visible(el) && fieldAliases.some((alias) => normalize(el.innerText || el.textContent || "").includes(alias)));
        for (const label of labels) {
          let node: HTMLElement | null = label;
          for (let depth = 0; node && depth < 6; depth += 1) {
            const input = Array.from(node.querySelectorAll("input, textarea"))
              .map((el) => el as HTMLInputElement | HTMLTextAreaElement)
              .find((candidate) => visible(candidate) && !candidate.disabled && !candidate.readOnly);
            if (input) {
              roots.push(node);
              break;
            }
            node = node.parentElement;
          }
        }
      }
      const input = roots
        .flatMap((root) => Array.from(root.querySelectorAll("input, textarea")).map((el) => el as HTMLInputElement | HTMLTextAreaElement))
        .find((candidate) => visible(candidate) && !candidate.disabled && !candidate.readOnly);
      if (!input) {
        return false;
      }
      const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      input.scrollIntoView({ block: "center", inline: "nearest" });
      input.focus();
      setter?.call(input, "");
      input.dispatchEvent(new InputEvent("input", { bubbles: true, data: "", inputType: "deleteContentBackward" }));
      setter?.call(input, nextValue);
      input.dispatchEvent(new InputEvent("input", { bubbles: true, data: nextValue, inputType: "insertText" }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Tab" }));
      input.blur();
      return true;
    },
    { fieldAliases: aliases, nextValue: value }
  );
  await page.waitForTimeout(150);
  return updated;
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
  const fieldAliases = {
    title: resolveBasicFieldIdAliases("title"),
    shortTitle: resolveBasicFieldIdAliases("shortTitle"),
    modelSpec: resolveBasicFieldIdAliases("modelSpec")
  };
  return page.evaluate(({ expected, aliases }) => {
    const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
    const readField = (fieldIds: string[]): { value: string; hasRequiredError: boolean } => {
      const root =
        fieldIds
          .map((fieldId) => document.querySelector(`[attr-field-id="${fieldId}"]`) as HTMLElement | null)
          .find(Boolean) || null;
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

    const title = readField(aliases.title);
    const shortTitle = readField(aliases.shortTitle);
    const modelSpec = readField(aliases.modelSpec);
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
  }, { expected: metadata, aliases: fieldAliases });
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
    const recovery = evaluateBasicInfoGateRecovery({
      expectedFields: [
        metadata.title ? "title" : "",
        metadata.shortTitle ? "shortTitle" : "",
        metadata.modelSpec ? "modelSpec" : ""
      ].filter(Boolean),
      missingFields: completion.missingFields
    });
    if (recovery.action === "reopen_from_platform_spu") {
      throw new PublishCreatePageReopenRequiredError(
        `${recovery.issue}${screenshotFile ? ` screenshot=${screenshotFile}` : ""}`
      );
    }
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
      if (!(await setBasicPublishFieldValue(page, "title", metadata.title))) {
        throw new Error("Title input not found on publish page.");
      }
      filledFields.push("title");
      await page.waitForTimeout(400);
    }

    if (metadata.shortTitle) {
      if (!(await setBasicPublishFieldValue(page, "shortTitle", metadata.shortTitle))) {
        throw new Error("Short title input not found on publish page.");
      }
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
      if (!(await setBasicPublishFieldValue(page, "modelSpec", metadata.modelSpec))) {
        throw new Error("Model spec input not found on publish page.");
      }
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
  fileName: string,
  onProgress?: (message: string) => void,
  guardUnexpectedFieldChanges = true
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
    onProgress?.(`basic_info_fill_attempt: ${attempt + 1}`);
    const beforeSnapshot = await snapshotBasicInfoFields(page);
    const filledFields: string[] = [];

    if (metadata.title) {
      if (!(await setBasicPublishFieldValue(page, "title", metadata.title))) {
        throw new Error("Title input not found on publish page.");
      }
      filledFields.push("title");
      await page.waitForTimeout(400);
    }

    if (metadata.shortTitle) {
      if (!(await setBasicPublishFieldValue(page, "shortTitle", metadata.shortTitle))) {
        throw new Error("Short title input not found on publish page.");
      }
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
      if (await setBasicPublishFieldValue(page, "modelSpec", metadata.modelSpec)) {
        filledFields.push("modelSpec");
        await page.waitForTimeout(400);
      } else {
        throw new Error("Model spec input not found on publish page.");
      }
    }

    const afterSnapshot = await snapshotBasicInfoFields(page);
    let unexpectedChanges: string[] = [];
    if (guardUnexpectedFieldChanges) {
      unexpectedChanges = diffUnexpectedBasicFieldChanges(beforeSnapshot, afterSnapshot);
    }
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

async function findSpecTemplateFieldRootOnPage(page: Page): Promise<Locator> {
  const marker = `auto-spec-template-field-${Date.now()}`;
  const found = await page.evaluate((attributeName) => {
    const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
    const isVisible = (node: Element): boolean => {
      const el = node as HTMLElement;
      const style = window.getComputedStyle(el);
      return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
    };
    const visibleText = (node: Element | null): string => (node && isVisible(node) ? normalize((node as HTMLElement).innerText || node.textContent || "") : "");
    document.querySelectorAll(`[${attributeName}]`).forEach((node) => node.removeAttribute(attributeName));

    const hasTemplateControl = (node: Element): boolean =>
      Boolean(node.querySelector("input[type='search'], input[role='combobox'], input[type='text'], input:not([type]), [role='combobox']"));
    const isTemplateField = (node: Element): boolean => {
      const text = visibleText(node);
      return text.includes("规格模板") && !text.includes("运费模板") && hasTemplateControl(node);
    };
    const isGoodsSpecSection = (node: Element): boolean => {
      const text = visibleText(node);
      return text.includes("商品规格") && text.includes("规格模板") && !text.includes("运费模板");
    };

    const labels = Array.from(document.querySelectorAll("label, [class*='label'], [class*='Label'], span, div")).filter((node) =>
      visibleText(node).includes("规格模板")
    );
    for (const label of labels) {
      let field: Element | null = label;
      while (field && field !== document.body) {
        if (isTemplateField(field)) {
          let section: Element | null = field;
          while (section && section !== document.body) {
            if (isGoodsSpecSection(section)) {
              (field as HTMLElement).setAttribute(attributeName, "true");
              return true;
            }
            section = section.parentElement;
          }
        }
        field = field.parentElement;
      }
    }
    return false;
  }, marker);
  if (!found) {
    throw new Error("Spec template field root was not found in 商品规格/规格模板 DOM structure.");
  }
  return page.locator(`[${marker}="true"]`).first();
}

async function findSpecTemplateInputInFieldRootOnPage(page: Page): Promise<Locator> {
  const fieldRoot = await findSpecTemplateFieldRootOnPage(page);
  const input = fieldRoot.locator("input[type='search'], input[role='combobox'], input[type='text'], input:not([type])").first();
  if ((await input.count()) > 0) {
    return input;
  }
  const combobox = fieldRoot.locator("[role='combobox']").first();
  if ((await combobox.count()) > 0) {
    return combobox;
  }
  throw new Error("Spec template input was not found inside 商品规格/规格模板 field root.");
}

async function clickSpecTemplateOptionByDomStructure(page: Page, keyword: string): Promise<string> {
  const option = page
    .locator("[role='listbox'] [role='option'], [role='option'], [class*='dropdown'] [class*='item'], [class*='Dropdown'] [class*='Item'], [class*='menu'] [class*='item'], [class*='Menu'] [class*='Item']")
    .filter({ hasText: keyword })
    .first();
  if ((await option.count()) <= 0) {
    return "";
  }
  const text = (await option.innerText({ timeout: 3000 }).catch(() => "")) || "";
  await option.click({ timeout: 3000 });
  return text;
}

async function waitForSpecTemplateSelectionConfirmation(page: Page, keyword: string, timeoutMs = 2500): Promise<string> {
  const startedAt = Date.now();
  let lastValue = "";
  while (Date.now() - startedAt < timeoutMs) {
    lastValue = await readSpecTemplateSelectedValue(page, keyword).catch(() => "");
    if (isMatchingSpecTemplateValue(lastValue, keyword)) {
      return lastValue;
    }
    await page.waitForTimeout(150);
  }
  return lastValue;
}

async function chooseSpecTemplateKeywordFromDropdown(page: Page, keyword: string): Promise<string> {
  await dismissTransientOverlays(page);
  const input = await findSpecTemplateInputInFieldRootOnPage(page);
  const candidates = resolveSpecTemplateKeywordCandidates(keyword);
  for (const candidate of candidates) {
    await input.click({ timeout: 3000 });
    await input.fill(candidate).catch(async () => {
      await page.keyboard.press(getSelectAllShortcut());
      await page.keyboard.type(candidate, { delay: 20 });
    });
    await page.waitForTimeout(120);
    const clickedText = await clickSpecTemplateOptionByDomStructure(page, candidate);
    if (!isMatchingSpecTemplateValue(clickedText, keyword)) {
      continue;
    }
    const selectedValue = await waitForSpecTemplateSelectionConfirmation(page, keyword, 2500);
    if (!isMatchingSpecTemplateValue(selectedValue, keyword)) {
      throw new Error(`Spec template readback did not match keyword after selection: keyword=${keyword}; selected=${selectedValue || "<empty>"}`);
    }
    return selectedValue;
  }
  throw new Error(`No visible spec template dropdown option matched controlled aliases: ${candidates.join("/")}; keyword=${keyword}`);
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
    if (await isDropdownControlByLabelAvailable(page, "运费模板").catch(() => false)) {
      return;
    }
  }
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

async function isDropdownControlByLabelAvailable(page: Page, labelText: string): Promise<boolean> {
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
      return false;
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
        return score > 0 ? { score } : null;
      })
      .filter(Boolean)
      .sort((a, b) => (b?.score || 0) - (a?.score || 0));

    return Boolean(candidates[0]);
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
        return { el, text, score };
      })
      .filter(Boolean)
      .sort((a, b) => (b?.score || 0) - (a?.score || 0));

    const target = candidates[0];
    if (!target) {
      return null;
    }
    const clickable = (
      target.el.closest("[role='option'], .ecom-g-select-item-option, .ant-select-item-option, .semi-select-option, li, .ecom-g-select-option") ||
      target.el
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
  const opened =
    (await clickLabeledSelect(page, "运费模板").catch(() => false)) ||
    (await clickDropdownControlByLabelDirect(page, "运费模板").catch(() => false));
  if (!opened) {
    throw new Error("Freight template input not found on publish page.");
  }
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
          el: htmlEl,
          text,
          score
        };
      })
      .filter(Boolean)
      .sort((a, b) => (b?.score || 0) - (a?.score || 0));

    const target = candidates[0];
    if (!target) {
      return null;
    }
    const clickable = (
      target.el.closest("[role='option'], .ecom-g-select-item-option, .ant-select-item-option, .semi-select-option, li, .ecom-g-select-option") ||
      target.el
    ) as HTMLElement;
    clickable.click();
    return { text: target.text };
  });

  if (!picked) {
    throw new Error("No visible non-free-shipping freight template option found.");
  }

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
      throw new Error(`No visible freight template combobox matched keyword: ${keyword}`);
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
  if (isMatchingSpecTemplateValue(selectedValue, keyword)) {
    return selectedValue;
  }
  selectedValue = await chooseSpecTemplateKeywordFromDropdown(page, keyword);
  const readbackValue = await readSpecTemplateSelectedValue(page, keyword).catch(() => "");
  if (isMatchingSpecTemplateValue(readbackValue, keyword)) {
    return readbackValue;
  }
  if (!isMatchingSpecTemplateValue(selectedValue, keyword)) {
    selectedValue = await readDropdownValueByLabel(page, "\u89c4\u683c\u6a21\u677f").catch(() => "");
  }
  if (!isMatchingSpecTemplateValue(selectedValue, keyword)) {
    selectedValue = await readSpecTemplateSelectedValue(page, keyword).catch(() => "");
  }
  if (!isMatchingSpecTemplateValue(selectedValue, keyword)) {
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

async function isSpecTemplateEntryControlVisible(page: Page): Promise<boolean> {
  if (await isSpecTemplateSmartFillUploadModeVisible(page).catch(() => false)) {
    return false;
  }
  await findSpecTemplateInputInFieldRootOnPage(page);
  return true;
}

async function describeSpecTemplateEntrySurfaceOnPage(page: Page): Promise<{
  templateConfigured: boolean;
  manualSurfaceVisible: boolean;
}> {
  return page.evaluate(() => {
    const visibleTexts = Array.from(document.querySelectorAll("body *"))
      .map((element) => element as HTMLElement)
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      })
      .map((element) => (element.innerText || element.textContent || "").replace(/\s+/g, "").trim());
    const visibleText = visibleTexts.join(" ");
    return {
      templateConfigured: visibleText.includes("规格模板"),
      manualSurfaceVisible:
        visibleText.includes("商品规格") && visibleText.includes("添加规格类型") && visibleText.includes("规格预览")
    };
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
    if (await isSpecTemplateEntryControlVisible(page).catch(() => false)) {
      return;
    }
    await clickSwitchManualSpecEntryMode(page).catch(() => false);
    await page.waitForTimeout(1000);
    if (await isManualSpecTemplateEntryModeVisible(page).catch(() => false)) {
      return;
    }
    if (await isSpecTemplateEntryControlVisible(page).catch(() => false)) {
      return;
    }
  }
  const surface = await describeSpecTemplateEntrySurfaceOnPage(page).catch(() => ({
    templateConfigured: false,
    manualSurfaceVisible: false
  }));
  if (surface.manualSurfaceVisible && !surface.templateConfigured) {
    throw new Error(
      "Spec template is not configured for current shop: 商品规格 surface only exposes 添加规格类型（0/3） and 规格预览."
    );
  }
  throw new Error("Spec template entry control was not visible after opening manual goods-spec mode.");
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

async function ensureManualPriceInventoryRowsAfterSpecTemplateOnPage(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await dismissTransientOverlays(page).catch(() => {});
    await scrollLabelIntoView(page, "商品规格").catch(() => false);
    await scrollLabelIntoView(page, "规格模板").catch(() => false);
    if (await isSpecTemplateSmartFillUploadModeVisible(page).catch(() => false)) {
      await clickSwitchManualSpecEntryMode(page).catch(() => false);
    }
    await page.waitForTimeout(700);
    const filledValues = await readCurrentSpecValuesStrict(page).catch(() => []);
    const visiblePriceRows = await countVisiblePriceInventoryRows(page).catch(() => 0);
    if (filledValues.length > 0 || visiblePriceRows > 0) {
      return;
    }
    await scrollLabelIntoView(page, "价格与库存").catch(() => false);
    if (await isManualSpecTemplateEntryModeVisible(page).catch(() => false)) {
      await page.waitForTimeout(500);
      const refreshedValues = await readCurrentSpecValuesStrict(page).catch(() => []);
      const refreshedRows = await countVisiblePriceInventoryRows(page).catch(() => 0);
      if (refreshedValues.length > 0 || refreshedRows > 0) {
        return;
      }
    }
  }
  throw new Error("Spec template selected but manual spec values or price/inventory rows were not visible after switching from smart-fill mode.");
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

async function applySpecTemplateWithVerificationOnPage(
  page: Page,
  title?: string
): Promise<{ selectedTemplate: string; filledValues: string[]; issue: string }> {
  const keyword = resolveSpecTemplateKeyword(title);
  let selectedTemplate = "";

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
    try {
      await ensureManualPriceInventoryRowsAfterSpecTemplateOnPage(page);
      return {
        selectedTemplate: selectedTemplate || keyword,
        filledValues,
        issue: ""
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        selectedTemplate: selectedTemplate || keyword,
        filledValues,
        issue: `${message}; keyword=${keyword}`
      };
    }
  }
  return {
    selectedTemplate,
    filledValues,
    issue: `${initialRule.issue}; keyword=${keyword}`
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

async function applyHealthFoodShippingBeforeSpecOnPage(page: Page): Promise<PublishRuleCheck> {
  const shippingModeSelected = await ensureRadioOptionNearFieldLabel(page, "\u53d1\u8d27\u6a21\u5f0f", "\u73b0\u8d27");
  const shippingTimeSelected = await ensureRadioOptionNearFieldLabel(page, "\u73b0\u8d27\u53d1\u8d27\u65f6\u95f4", "48\u5c0f\u65f6");
  if (!shippingModeSelected || !shippingTimeSelected) {
    return {
      passed: false,
      issue: `Health-food shipping precondition failed. shippingMode=${shippingModeSelected}; shippingTime=${shippingTimeSelected}`
    };
  }
  return { passed: true, issue: "" };
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

type DetailQualificationUploadResult = {
  attemptedCount: number;
  acknowledgedCount: number;
  finalCount: number;
  failedFileIndex?: number;
};

async function uploadDetailImagesByInputCapability(
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

  const auxiliaryInputs = initialInputs
    .filter((input) => input.sectionLabel === "\u4e3b\u56fe")
    .filter((input) => input.index !== mainInput.index)
    .filter((input) => input.parentText.includes("\u4e0a\u4f20\u8f85\u52a9\u56fe"))
    .sort((a, b) => a.index - b.index);

  const uploadSequenceOnce = async (): Promise<{ uploaded: number; confirmed: number }> => {
    const orderedInputs = [mainInput, ...auxiliaryInputs];
    let uploaded = 0;
    let previousCount = await countMainImagePreviews(page).catch(() => 0);

    for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
      const input = orderedInputs[fileIndex];
      if (!input) {
        return { uploaded, confirmed: previousCount };
      }
      await page.locator("input[type='file']").nth(input.index).setInputFiles(files[fileIndex]);
      uploaded += 1;
      const observedCount = await waitForPreviewCount(
        page,
        () => countMainImagePreviews(page),
        previousCount + 1,
        fileIndex === 0 ? 4000 : 3000
      ).catch(() => previousCount);
      if (observedCount < previousCount + 1) {
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

async function clickLastGraphicSectionPreviewDeleteByDom(page: Page, sectionName: string): Promise<boolean> {
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
      previewRoot.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true, cancelable: true, view: window }));
      previewRoot.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, cancelable: true, view: window }));

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
      target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
      target.click();
      return true;
    },
    { targetSection: sectionName, sectionLabels: GRAPHIC_SECTION_LABELS, uploadPlaceholderPattern: "\u4e0a\u4f20(?:\u767d\u5e95\u56fe|\u4e3b\u56fe|\u8f85\u52a9\u56fe)" }
  );
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

function graphicUploadGroupsComplete(uploadedGroups: string[]): boolean {
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

async function resetGraphicModuleOnPage(page: Page, runtimeDir: string, screenshotFileName: string): Promise<string> {
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

async function waitForPublishSubmissionFromContext(
  context: Awaited<ReturnType<Page["context"]>>,
  fallbackPage: Page,
  publishClickAttempted = false,
  timeoutMs = 45000
): Promise<{ page: Page; submitted: boolean; issue: string }> {
  const deadline = Date.now() + timeoutMs;
  let lastState: { page: Page; submitted: boolean; issue: string } | null = null;

  while (Date.now() < deadline) {
    const pages = context.pages().filter((item) => !item.isClosed());
    const candidates = pages.length ? pages : fallbackPage.isClosed() ? [] : [fallbackPage];
    for (const candidate of candidates) {
      attachSafeDialogHandler(candidate);
      await Promise.race([
        candidate.waitForLoadState("domcontentloaded", { timeout: 2500 }).catch(() => {}),
        candidate.waitForTimeout(1200).catch(() => {})
      ]);
      await clickVisibleDialogAction(candidate, ["确认发布", "继续发布", "确定", "确认", "我知道了"]).catch(() => false);
      await dismissTransientOverlays(candidate).catch(() => {});
      const state = await candidate
        .evaluate(() => ({ bodyText: document.body?.innerText || "", url: window.location.href }))
        .then((snapshot) => evaluatePublishSubmissionAfterAction(snapshot, publishClickAttempted))
        .catch((error) => ({
          submitted: false,
          issue: error instanceof Error ? error.message : String(error),
          freshCreatePage: false
        }));
      lastState = { page: candidate, submitted: state.submitted, issue: state.issue };
      if (state.submitted) {
        return { page: candidate, submitted: true, issue: "" };
      }
    }

    const waitPage = candidates[0] || fallbackPage;
    await waitPage.waitForTimeout(1500).catch(() => {});
  }

  const finalState = await readPublishSubmissionStateFromContext(context, fallbackPage, publishClickAttempted).catch(() => lastState);
  return finalState || {
    page: fallbackPage,
    submitted: false,
    issue: "No publish success signal was detected after waiting for post-submit navigation."
  };
}

async function clickPublishProductOnPage(
  page: Page,
  runtimeDir: string,
  fileName: string
): Promise<PublishActionResult & { publishClicked: boolean; publishClickAttempted: boolean; publishIssue: string }> {
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
      if (publishClickAttempted) {
        const contextState = await waitForPublishSubmissionFromContext(activeContext, activePage, publishClickAttempted);
        activePage = contextState.page;
        if (contextState.submitted) {
          publishClicked = true;
          publishIssue = "";
          break;
        }
        publishIssue = contextState.issue || "No publish success signal was detected after clicking 发布商品.";
        break;
      } else {
        activePage = await recoverUsablePublishPage(activePage);
      }
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
        await publishButton.click({ timeout: 5000, noWaitAfter: true });
        publishClickAttempted = true;
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
          const contextState = await waitForPublishSubmissionFromContext(activeContext, activePage, publishClickAttempted);
          activePage = contextState.page;
          return { submitted: contextState.submitted, issue: contextState.issue };
        });
        if (!submissionState.submitted) {
          const contextState = await waitForPublishSubmissionFromContext(activeContext, activePage, publishClickAttempted).catch(() => null);
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
      const contextState = await waitForPublishSubmissionFromContext(activeContext, activePage, publishClickAttempted).catch(() => null);
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
    publishClickAttempted,
    publishIssue
  };
}

async function runPublishFlow(
  runtimeDir: string,
  metadata: ResolvedPublishFromSpuMetadata,
  assets: ProductAssets,
  shopFolder: string,
  publishPageUrl?: string,
  stopBeforePublish = false,
  graphicResetAttempt = 0,
  createPageResetAttempt = 0,
  progress?: { onProgress?: (message: string) => void }
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
  publishClickAttempted: boolean;
  publishIssue: string;
  freightTemplateName?: string;
  sections: string[];
  topActions: string[];
  errorHints: string[];
  stages: PublishFlowStage[];
}> {
  const emitPublishFlowProgress = (step: string, message: string): void => {
    const text = `${step}: ${message}`;
    logInfo(text);
    progress?.onProgress?.(text);
  };
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
  let freightTemplateName = "";

  let createPageUrl = publishPageUrl || "";
  let matchedRowText = "";
  const productCategory = normalizeProductCategory(metadata.productCategory);
  const basicMetadata =
    productCategory === "保健食品"
      ? {
          title: metadata.title,
          shortTitle: metadata.shortTitle,
          modelSpec: undefined,
          spu: metadata.spu
        }
      : {
          title: metadata.title,
          shortTitle: metadata.shortTitle,
          modelSpec: metadata.modelSpec,
          spu: metadata.spu
        };
  const basicInfoGuardUnexpectedFieldChanges = productCategory !== "保健食品";
  const priceInventoryRows = resolveFeishuPriceInventoryRows(metadata.productPriceText || "");

  const context = await launchPersistentBrowser();
  try {
    const shopSpuDeps = createDefaultShopSpuActionDeps();
    const categoryContext = {
      productCategory,
      basicMetadata,
      basicInfoGuardUnexpectedFieldChanges
    };
    const shopSpuResult = await runShopSpuAction(
      shopSpuDeps,
      {
        context,
        runtimeDir,
        metadata,
        shopFolder,
        publishPageUrl
      }
    );
    screenshotFiles.push(...shopSpuResult.screenshotFiles);
    stages.push(...shopSpuResult.stages);
    let page = shopSpuResult.page;
    createPageUrl = shopSpuResult.createPageUrl;
    matchedRowText = shopSpuResult.matchedRowText;

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
          createPageResetAttempt + 1,
          progress
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

    const basicResult = await runBasicInfoAction(
      {
        queryPlatformSpu,
        reuseOrOpenCreatePage: (targetContext, targetCreatePageUrl, currentPage) =>
          reuseOrOpenCreatePage(targetContext as Awaited<ReturnType<typeof launchPersistentBrowser>>, targetCreatePageUrl, currentPage),
        waitForPublishCreatePageReady,
        assertBasicPrefillReadyOnPage,
        verifyCategoryRegistrationGateOnPage,
        fillBasicPublishPageOnPage,
        assertBasicPublishCompletionOnPage,
        isPublishCreatePageReopenRequiredError: (error) => error instanceof PublishCreatePageReopenRequiredError,
        logInfo,
        fillHealthFoodSafetyAttributesOnPage,
        uploadHealthFoodOuterPackagingOnPage,
        fillHealthFoodCategoryAttributesOnPage
      },
      {
        page,
        runtimeDir,
        createPageUrl,
        metadata,
        productCategory,
        basicMetadata,
        shopFolder,
        assets,
        guardUnexpectedFieldChanges: basicInfoGuardUnexpectedFieldChanges,
        emitProgress: emitPublishFlowProgress
      }
    );
    page = basicResult.page;
    createPageUrl = basicResult.createPageUrl;
    if (basicResult.matchedRowText) {
      matchedRowText = basicResult.matchedRowText;
    }
    screenshotFiles.push(...basicResult.screenshotFiles);
    stages.push(...basicResult.stages);
    filledFields.length = 0;
    filledFields.push(...basicResult.filledFields);
    configuredFields.push(...basicResult.configuredFields);

    let priceInventoryCompleted = false;
    for (let specAttempt = 0; specAttempt < 2; specAttempt += 1) {
      if (specAttempt === 0) {
        logInfo(`publish module started: ${"graphic_info"} (${path.basename(shopFolder)})`);
      }
      const graphicResult = await runGraphicInfoAction(
        {
          waitForPublishCreatePageReady,
          assertBasicPublishCompletionOnPage,
          uploadProductImagesOnPage,
          graphicUploadGroupsComplete,
          resetGraphicModuleOnPage
        },
        {
          page,
          runtimeDir,
          createPageUrl,
          basicMetadata,
          assets,
          graphicResetAttempt,
          specAttempt,
          logWarn
        }
      );
      screenshotFiles.push(...graphicResult.screenshotFiles);
      stages.push(...graphicResult.stages);
      uploadedGroups = graphicResult.uploadedGroups;
      uploadIssue = graphicResult.uploadIssue;

      if (productCategory === "保健食品") {
        if (specAttempt === 0) {
          logInfo(`publish module started: ${"shipping_and_spec"} (${path.basename(shopFolder)})`);
        }
      }

      const specPriceResult = await runSpecPriceAction(
        {
          queryPlatformSpu,
          reuseOrOpenCreatePage: (targetContext, targetCreatePageUrl, currentPage) =>
            reuseOrOpenCreatePage(targetContext as Awaited<ReturnType<typeof launchPersistentBrowser>>, targetCreatePageUrl, currentPage),
          waitForPublishCreatePageReady,
          verifyCategoryRegistrationGateOnPage,
          fillBasicPublishPageOnPage,
          assertBasicPublishCompletionOnPage,
          gotoWithTolerance,
          applyHealthFoodShippingBeforeSpecOnPage,
          applyFixedSpecsOnPage,
          applyHealthFoodSpecificationOnPage,
          readSpecModuleErrorOnPage,
          evaluatePriceInventoryEntryRule,
          applyPriceInventoryOnPage,
          evaluatePriceInventoryCompletion
        },
        {
          page,
          runtimeDir,
          createPageUrl,
          metadata,
          categoryContext,
          shopFolder,
          priceInventoryRows,
          specAttempt
        }
      );
      page = specPriceResult.page;
      createPageUrl = specPriceResult.createPageUrl;
      if (specPriceResult.matchedRowText) {
        matchedRowText = specPriceResult.matchedRowText;
      }
      screenshotFiles.push(...specPriceResult.screenshotFiles);
      stages.push(...specPriceResult.stages);
      configuredFields.push(...specPriceResult.configuredFields);
      specTypeOptions = specPriceResult.specTypeOptions;
      specIssue = specPriceResult.specIssue;
      filledPriceRows = specPriceResult.filledPriceRows;
      priceIssue = specPriceResult.priceIssue;
      if (specPriceResult.shouldRetryFromSpecTemplate) {
        continue;
      }
      if (specPriceResult.completed) {
        priceInventoryCompleted = true;
        break;
      }
      break;
    }
    if (!priceInventoryCompleted) {
      const priceRule = evaluatePriceInventoryCompletion({
        filledPriceRows,
        expectedRows: priceInventoryRows.length,
        priceIssue,
        specIssue
      });
      stages.push({ step: "apply_price_inventory", status: "failed" });
      throw new Error(`Sequential publish flow stopped: 价格库存模块未完成。${priceRule.issue}`);
    }
    stages.push({ step: "apply_price_inventory", status: "completed" });

    logInfo(`publish module started: ${"service_fulfillment"} (${path.basename(shopFolder)})`);
    const serviceResult = await runServiceAction(
      {
        assertBasicPublishCompletionOnPage,
        fillBasicPublishPageOnPage,
        applyFixedPublishSettingsOnPage,
        evaluateServiceFulfillmentCompletion,
        uploadHealthFoodPackagingLabelOnPage,
        ensureMedicalDeviceCertificateFromFirstQualification
      },
      {
        page,
        runtimeDir,
        metadata,
        categoryContext,
        assets,
        filledFields
      }
    );
    screenshotFiles.push(...serviceResult.screenshotFiles);
    stages.push(...serviceResult.stages);
    configuredFields.push(...serviceResult.configuredFields);
    freightTemplateName = serviceResult.freightTemplateName;

    if (!stopBeforePublish) {
      logInfo(`publish module started: final_submit (${path.basename(shopFolder)})`);
    }
    const submitResult = await runSubmitAction(
      {
        runPublishCheckOnPage,
        evaluatePublishCheckResult,
        clickPublishProductOnPage,
        inspectPublishPageOnPage,
        savePageScreenshot
      },
      {
        page,
        runtimeDir,
        stopBeforePublish,
        categoryContext,
        filledFields,
        configuredFields,
        filledPriceRows,
        freightTemplateName,
        uploadIssue,
        specIssue,
        priceIssue
      }
    );
    screenshotFiles.push(...submitResult.screenshotFiles);
    stages.push(...submitResult.stages);

    return {
      pageUrl: submitResult.pageUrl,
      pageTitle: submitResult.pageTitle,
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
      checkPassed: submitResult.checkPassed,
      checkMessage: submitResult.checkMessage,
      checkHints: submitResult.checkHints,
      blockingFields: submitResult.blockingFields,
      publishClicked: submitResult.publishClicked,
      publishClickAttempted: submitResult.publishClickAttempted,
      publishIssue: submitResult.publishIssue,
      freightTemplateName,
      sections: submitResult.sections,
      topActions: submitResult.topActions,
      errorHints: submitResult.errorHints,
      stages
    };
  } finally {
    await context.browser()?.close().catch(() => {});
  }
}

async function runGraphicFlow(
  runtimeDir: string,
  metadata: { brand: string; spu: string; title?: string; shortTitle?: string; modelSpec?: string; productPriceText?: string; productCategory?: string },
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
  let createPageUrl = "";
  let matchedRowText = "";
  const productCategory = normalizeProductCategory(metadata.productCategory);
  const actionMetadata: ResolvedPublishFromSpuMetadata = {
    brand: metadata.brand,
    spu: metadata.spu,
    title: metadata.title || "",
    shortTitle: metadata.shortTitle || "",
    modelSpec: metadata.modelSpec || "",
    productPriceText: metadata.productPriceText || "",
    productCategory
  };
  const basicMetadata = {
    title: actionMetadata.title,
    shortTitle: actionMetadata.shortTitle,
    modelSpec: actionMetadata.modelSpec,
    spu: actionMetadata.spu
  };

  const context = await launchPersistentBrowser();
  try {
    const shopSpuDeps = createDefaultShopSpuActionDeps();
    const shopSpuResult = await runShopSpuAction(
      shopSpuDeps,
      {
        context,
        runtimeDir,
        metadata: actionMetadata,
        shopFolder,
        publishPageUrl
      }
    );
    screenshotFiles.push(...shopSpuResult.screenshotFiles);
    stages.push(...shopSpuResult.stages);
    let page = shopSpuResult.page;
    createPageUrl = shopSpuResult.createPageUrl;
    matchedRowText = shopSpuResult.matchedRowText;

    const basicResult = await runBasicInfoAction(
      {
        queryPlatformSpu,
        reuseOrOpenCreatePage: (targetContext, targetCreatePageUrl, currentPage) =>
          reuseOrOpenCreatePage(targetContext as Awaited<ReturnType<typeof launchPersistentBrowser>>, targetCreatePageUrl, currentPage),
        waitForPublishCreatePageReady,
        assertBasicPrefillReadyOnPage,
        verifyCategoryRegistrationGateOnPage,
        fillBasicPublishPageOnPage,
        assertBasicPublishCompletionOnPage,
        isPublishCreatePageReopenRequiredError: (error) => error instanceof PublishCreatePageReopenRequiredError,
        logInfo,
        fillHealthFoodSafetyAttributesOnPage,
        uploadHealthFoodOuterPackagingOnPage,
        fillHealthFoodCategoryAttributesOnPage
      },
      {
        page,
        runtimeDir,
        createPageUrl,
        metadata: actionMetadata,
        productCategory,
        basicMetadata,
        shopFolder,
        assets,
        guardUnexpectedFieldChanges: true,
        emitProgress: () => {},
        failurePrefix: "Graphic flow stopped"
      }
    );
    page = basicResult.page;
    createPageUrl = basicResult.createPageUrl;
    if (basicResult.matchedRowText) {
      matchedRowText = basicResult.matchedRowText;
    }
    screenshotFiles.push(...basicResult.screenshotFiles);
    stages.push(...basicResult.stages);
    filledFields.push(...basicResult.filledFields);

    const graphicResult = await runGraphicInfoAction(
      {
        waitForPublishCreatePageReady,
        assertBasicPublishCompletionOnPage,
        uploadProductImagesOnPage,
        graphicUploadGroupsComplete,
        resetGraphicModuleOnPage
      },
      {
        page,
        runtimeDir,
        createPageUrl,
        basicMetadata,
        assets,
        graphicResetAttempt,
        specAttempt: 0,
        logWarn,
        failurePrefix: "Graphic flow stopped"
      }
    );
    screenshotFiles.push(...graphicResult.screenshotFiles);
    stages.push(...graphicResult.stages);
    uploadedGroups = graphicResult.uploadedGroups;
    uploadIssue = graphicResult.uploadIssue;
    if (!stages.some((stage) => stage.step === "upload_product_images" && stage.status === "completed")) {
      stages.push({ step: "upload_product_images", status: "completed" });
    }

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

      const classifiedAssets = requiresLocalProductFiles
        ? classifyAssets(productFolder, { feishuRecordId: input.metadata?.feishuRecordId })
        : {
            workbookFile: undefined,
            mainImages: [],
            whiteBackgroundImages: [],
            detailImages: [],
            otherFiles: []
          };
      const preparedQualificationImages = requiresLocalProductFiles
        ? await prepareQualificationImagesForUpload({
            files: classifiedAssets.detailImages,
            outputDir: path.join(runtimeDir, "qualification-images-normalized")
          })
        : { files: [], entries: [] };
      const assets: ProductAssets = {
        ...classifiedAssets,
        detailImages: preparedQualificationImages.files
      };
      if (requiresLocalProductFiles) {
        assertProductAssetsForShop(assets, shopFolder, productFolder);
      }
      const workbook = requiresLocalProductFiles
        ? await summarizeWorkbook(assets.workbookFile)
        : { rows: [], parseError: "" };
    const metadataOverride = input.metadata || {};
      const resolvedMetadata = resolvePublishFromSpuMetadata({
        metadataOverride,
        workbook
      });
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
          modelSpec: resolvedMetadata.modelSpec,
          productPriceText: resolvedMetadata.productPriceText
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
        resolvedMetadata,
        assets,
        shopFolder,
        input.publishPageUrl,
        true,
        0,
        0,
        { onProgress: options.onProgress }
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
        publishClickAttempted: flowResult.publishClickAttempted,
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
        publishClickAttempted: boolean;
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
        resolvedMetadata,
        assets,
        shopFolder,
        input.publishPageUrl,
        false,
        0,
        0,
        { onProgress: options.onProgress }
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
        publishClickAttempted: flowResult.publishClickAttempted,
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
        publishClickAttempted: boolean;
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
                  ? ((browserData as { publishClicked?: boolean; publishClickAttempted?: boolean } | undefined)?.publishClicked ||
                    (browserData as { publishClicked?: boolean; publishClickAttempted?: boolean } | undefined)?.publishClickAttempted
                      ? "published"
                      : "publish_page_ready")
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
                    : (browserData as { publishClickAttempted?: boolean } | undefined)?.publishClickAttempted
                      ? "Publish button click was issued; platform success signal was not observed."
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
              metadataOverride.modelSpec ||
              metadataOverride.productPriceText
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
          priceRows: resolveFeishuPriceInventoryRows(resolvedMetadata.productPriceText).map((row) => row.price),
          stockRows: resolveFeishuPriceInventoryRows(resolvedMetadata.productPriceText).map((row) => row.stock)
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
