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

export async function runPublishCheckOnPage(
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
    const normalizedBodyText = visibleText(bodyText);
    const freightSelected =
      normalizedBodyText.includes(freightKeyword) ||
      freightCombos.some((input) => {
        const contextText = visibleText(
          [input.value || "", input.parentElement?.parentElement?.textContent || "", input.closest("div")?.textContent || ""].join(" ")
        );
        return contextText.includes(freightKeyword);
      });

    const priceInventoryRowsReady = spinButtons.length >= 2 && emptyPriceCount === 0 && emptyStockCount === 0;
    const modelSpecFilled =
      priceInventoryRowsReady ||
      Array.from(document.querySelectorAll("input"))
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
    const publishDialogMarkers = ["发布", "提交审核", "创建商品"];
    const roots = dialogs.filter((dialog) => publishDialogMarkers.some((marker) => normalize(dialog.innerText || "").includes(marker)));
    if (!roots.length) {
      return false;
    }
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

export async function clickPublishProductOnPage(
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
