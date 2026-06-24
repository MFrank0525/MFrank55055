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

import { fillBasicPublishPageOnPage, verifyCategoryRegistrationGateOnPage } from "./basic-info-page-action.js";


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

const specTemplateOptionMarker = "data-auto-spec-template-option";

async function markVisibleSpecTemplateOption(page: Page, keywords: string[]): Promise<string> {
  return page.evaluate(
    ({ markerName, targetKeywords }) => {
      const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
      const visible = (element: HTMLElement): boolean => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      };
      document.querySelectorAll(`[${markerName}]`).forEach((node) => node.removeAttribute(markerName));
      const optionSelector = [
        "[role='listbox'] [role='option']",
        "[role='option']",
        "[class*='dropdown'] [class*='item']",
        "[class*='Dropdown'] [class*='Item']",
        "[class*='menu'] [class*='item']",
        "[class*='Menu'] [class*='Item']"
      ].join(", ");
      const candidates = Array.from(document.querySelectorAll(optionSelector))
        .map((node) => {
          const el = node as HTMLElement;
          const clickable = (
            el.closest(
              "[role='option'], [class*='dropdown'] [class*='item'], [class*='Dropdown'] [class*='Item'], [class*='menu'] [class*='item'], [class*='Menu'] [class*='Item']"
            ) || el
          ) as HTMLElement;
          if (!visible(el) || !visible(clickable)) {
            return null;
          }
          const text = normalize(el.innerText || el.textContent || "");
          if (!targetKeywords.some((keyword) => text.includes(keyword))) {
            return null;
          }
          return {
            el: clickable,
            text
          };
        })
        .filter(Boolean);
      const target = candidates.find((item) => targetKeywords.some((keyword) => item?.text === keyword)) || candidates[0];
      if (!target) {
        return "";
      }
      target.el.setAttribute(markerName, "true");
      return target.text;
    },
    { markerName: specTemplateOptionMarker, targetKeywords: keywords }
  );
}

async function clickSpecTemplateOptionByDomStructure(page: Page, keywords: string[]): Promise<string> {
  const text = await markVisibleSpecTemplateOption(page, keywords);
  if (text) {
    await page.locator(`[${specTemplateOptionMarker}="true"]`).first().click({ timeout: 1000 });
    return text;
  }
  return "";
}

async function waitForSpecTemplateApplyEvidence(page: Page, keyword: string): Promise<string> {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const selectedValue = await readSpecTemplateSelectedValue(page, keyword).catch(() => "");
    if (isMatchingSpecTemplateValue(selectedValue, keyword)) {
      return selectedValue;
    }
    const visiblePriceRows = await countVisiblePriceInventoryRows(page).catch(() => 0);
    if (visiblePriceRows >= FIXED_SPEC_VALUES.length) {
      return keyword;
    }
    const filledValues = await readCurrentSpecValuesStrict(page).catch(() => []);
    if (filledValues.length >= FIXED_SPEC_VALUES.length) {
      return keyword;
    }
    await page.waitForTimeout(150);
  }
  return "";
}

async function chooseSpecTemplateKeywordFromDropdown(page: Page, keyword: string): Promise<string> {
  await dismissTransientOverlays(page);
  const candidates = resolveSpecTemplateKeywordCandidates(keyword);
  const visibleClickedText = await clickSpecTemplateOptionByDomStructure(page, candidates);
  if (isMatchingSpecTemplateValue(visibleClickedText, keyword)) {
    return (await waitForSpecTemplateApplyEvidence(page, keyword)) || visibleClickedText;
  }
  const input = await findSpecTemplateInputInFieldRootOnPage(page);
  for (const candidate of candidates) {
    await input.click({ timeout: 3000 });
    await input.fill(candidate).catch(async () => {
      await page.keyboard.press(getSelectAllShortcut());
      await page.keyboard.type(candidate, { delay: 20 });
    });
    await page.waitForTimeout(120);
    const clickedText = await clickSpecTemplateOptionByDomStructure(page, candidates);
    if (!isMatchingSpecTemplateValue(clickedText, keyword)) {
      continue;
    }
    const selectedValue = await waitForSpecTemplateApplyEvidence(page, keyword);
    if (isMatchingSpecTemplateValue(selectedValue, keyword)) {
      return selectedValue;
    }
    return clickedText;
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
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (attempt === 0 || attempt % 4 === 0) {
      await ensurePublishSectionTab(page, "\u670d\u52a1\u4e0e\u5c65\u7ea6").catch(() => {});
      await scrollMainFormContainerToTop(page).catch(() => false);
      await scrollPublishSectionContentIntoView(page, "\u670d\u52a1\u4e0e\u5c65\u7ea6").catch(() => false);
    }
    await scrollLabelIntoView(page, "\u8fd0\u8d39\u6a21\u677f").catch(() => false);
    if (await isDropdownControlByLabelAvailable(page, "运费模板").catch(() => false)) {
      return;
    }
    await page.waitForTimeout(100);
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

const freightTemplateOptionMarker = "data-auto-freight-template-option";

async function markVisibleFreightTemplateOption(page: Page, keyword: string): Promise<string> {
  return page.evaluate(
    ({ markerName, targetKeyword }) => {
      const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
      const visible = (element: HTMLElement): boolean => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      };
      document.querySelectorAll(`[${markerName}]`).forEach((node) => node.removeAttribute(markerName));
      const candidates = Array.from(
        document.querySelectorAll(
          "[role='option'], .ecom-g-select-item-option, .ant-select-item-option, .semi-select-option, .semi-select-option-content, .semi-tree-option, .semi-tree-option-list li, .ecom-g-select-option"
        )
      )
        .map((node) => {
          const el = node as HTMLElement;
          const clickable = (
            el.closest("[role='option'], .ecom-g-select-item-option, .ant-select-item-option, .semi-select-option, li, .ecom-g-select-option") ||
            el
          ) as HTMLElement;
          if (!visible(el) || !visible(clickable)) {
            return null;
          }
          const text = normalize(el.textContent || "");
          if (!text.includes(targetKeyword)) {
            return null;
          }
          return { el: clickable, text };
        })
        .filter(Boolean);
      const target = candidates.find((item) => item?.text === targetKeyword) || candidates[0];
      if (!target) {
        return "";
      }
      target.el.setAttribute(markerName, "true");
      return target.text;
    },
    { markerName: freightTemplateOptionMarker, targetKeyword: keyword }
  );
}

async function clickFreightTemplateDropdownOption(page: Page, keyword: string): Promise<string> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const text = await markVisibleFreightTemplateOption(page, keyword);
    if (text) {
      await page.locator(`[${freightTemplateOptionMarker}="true"]`).first().click({ timeout: 1000 });
      return text;
    }
    await page.waitForTimeout(100);
  }
  return "";
}

async function waitForFreightTemplateReadback(page: Page, keyword: string): Promise<string> {
  for (let readbackAttempt = 0; readbackAttempt < 10; readbackAttempt += 1) {
    let selectedValue = await readLabeledSelectValue(page, "\u8fd0\u8d39\u6a21\u677f").catch(() => "");
    if (!selectedValue.includes(keyword)) {
      selectedValue = await readServiceFreightTemplateValue(page).catch(() => "");
    }
    if (selectedValue.includes(keyword)) {
      return selectedValue;
    }
    await page.waitForTimeout(100);
  }
  return "";
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

export async function readLabeledSelectValue(page: Page, labelText: string): Promise<string> {
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

export async function chooseKeywordFreightTemplate(page: Page, keyword: string): Promise<string> {
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
    await clickFreightTemplateDropdownOption(page, keyword).catch(() => "");
    selectedValue = await waitForFreightTemplateReadback(page, keyword);
    if (selectedValue.includes(keyword)) {
      return selectedValue;
    }
    await page.keyboard.press("Escape").catch(() => {});
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
  await dismissTransientOverlays(page).catch(() => {});
  await scrollLabelIntoView(page, "商品规格").catch(() => false);
  await scrollLabelIntoView(page, "规格模板").catch(() => false);
  if (await isSpecTemplateSmartFillUploadModeVisible(page).catch(() => false)) {
    await clickSwitchManualSpecEntryMode(page);
    if (await waitForManualSpecTemplateEntryReadiness(page)) {
      return;
    }
  }
  if (await isManualSpecTemplateEntryModeVisible(page).catch(() => false)) {
    return;
  }
  if (await isSpecTemplateEntryControlVisible(page).catch(() => false)) {
    return;
  }
  await clickSwitchManualSpecEntryMode(page);
  if (await waitForManualSpecTemplateEntryReadiness(page)) {
    return;
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

async function waitForManualSpecTemplateEntryReadiness(page: Page): Promise<boolean> {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    if (await isManualSpecTemplateEntryModeVisible(page).catch(() => false)) {
      return true;
    }
    if (await isSpecTemplateEntryControlVisible(page).catch(() => false)) {
      return true;
    }
    await page.waitForTimeout(250);
  }
  return false;
}

async function ensureManualPriceInventoryRowsAfterSpecTemplateOnPage(page: Page): Promise<void> {
  await dismissTransientOverlays(page).catch(() => {});
  await scrollLabelIntoView(page, "商品规格").catch(() => false);
  await scrollLabelIntoView(page, "规格模板").catch(() => false);
  if (await isSpecTemplateSmartFillUploadModeVisible(page).catch(() => false)) {
    await clickSwitchManualSpecEntryMode(page).catch(() => false);
  }
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const filledValues = await readCurrentSpecValuesStrict(page).catch(() => []);
    const visiblePriceRows = await countVisiblePriceInventoryRows(page).catch(() => 0);
    if (filledValues.length > 0 || visiblePriceRows > 0) {
      return;
    }
    await page.waitForTimeout(250);
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

export async function applySpecTemplateWithVerificationOnPage(
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

export async function readSpecModuleErrorOnPage(page: Page): Promise<string> {
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
