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

export async function assertBasicPrefillReadyOnPage(
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

export async function verifyCategoryRegistrationGateOnPage(
  page: Page,
  runtimeDir: string,
  expectedSpu?: string,
  screenshotFileName = "publish-page-category-registration-mismatch.png"
): Promise<void> {
  if (!expectedSpu) {
    return;
  }
  await ensurePublishSectionTab(page, "\u57fa\u7840\u4fe1\u606f");
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" })).catch(() => {});
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

export async function assertBasicPublishCompletionOnPage(
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
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" })).catch(() => {});
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

export async function fillBasicPublishPageOnPage(
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
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" })).catch(() => {});
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
      await scrollLabelIntoView(page, "\u578b\u53f7\u89c4\u683c").catch(() => false);
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
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" })).catch(() => {});
    await page.waitForTimeout(800);
  }

  throw new Error("Category attribute guard triggered after unexpected field changes; page was refreshed and basic info fill still did not stabilize.");
}
