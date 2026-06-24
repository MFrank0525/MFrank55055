import type { Locator, Page } from "playwright";
import type { PriceInventoryRowValue } from "./price-inventory-rules.js";
import { savePageScreenshot } from "./browser-session.js";
import { dismissTransientOverlays } from "./dom-actions.js";
import {
  ensurePublishSectionTab,
  findLabelAbsoluteTop,
  scrollLabelIntoView,
  scrollPublishSectionContentIntoView
} from "./publish-section-navigation.js";
import {
  clickSwitchManualSpecEntryMode,
  isSpecTemplateSmartFillUploadModeVisible
} from "./spec-template-mode.js";

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

  for (let attempt = 0; attempt < 4; attempt += 1) {
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

    if (await countVisiblePriceInventoryRows(page).catch(() => 0)) {
      return;
    }
    if (await isSpecTemplateSmartFillUploadModeVisible(page).catch(() => false)) {
      await clickSwitchManualSpecEntryMode(page).catch(() => false);
      await page.waitForTimeout(1200);
      await scrollPublishSectionContentIntoView(page, "价格库存").catch(() => false);
      await page.waitForTimeout(500);
      if (await countVisiblePriceInventoryRows(page).catch(() => 0)) {
        return;
      }
    }
  }
}

type PriceInventoryDomRow = {
  trIndex: number;
  priceInputIndex: number;
  stockInputIndex: number;
  rowOrder: number;
  priceValue: string;
  stockValue: string;
};

async function findPriceInventoryTableDomRows(page: Page): Promise<PriceInventoryDomRow[]> {
  return page.evaluate(() => {
    const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
    const allRows = Array.from(document.querySelectorAll("tr")).map((row) => row as HTMLTableRowElement);
    const visible = (el: HTMLElement): boolean => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    const usableInput = (input: HTMLInputElement): boolean => {
      const type = (input.getAttribute("type") || "text").toLowerCase();
      const context = normalize(
        [
          input.getAttribute("placeholder") || "",
          input.getAttribute("aria-label") || "",
          input.closest("td, th, tr")?.textContent || ""
        ].join(" ")
      );
      return (
        visible(input) &&
        !input.disabled &&
        !input.readOnly &&
        !["hidden", "file", "checkbox", "radio"].includes(type) &&
        !/erp编码|商家编码|规格值|请输入规格值/i.test(context)
      );
    };

    const tables = Array.from(document.querySelectorAll("table"));
    for (const table of tables) {
      const tableRows = Array.from(table.querySelectorAll("tr")).map((row) => row as HTMLTableRowElement);
      const header = tableRows
        .map((row, rowOrder) => {
          const cells = Array.from(row.querySelectorAll("th, td")).map((cell) => cell as HTMLTableCellElement);
          const priceCell = cells.find((cell) => /价格|售价/.test(normalize(cell.innerText || cell.textContent || "")));
          const stockCell = cells.find((cell) => /现货库存|库存/.test(normalize(cell.innerText || cell.textContent || "")));
          return priceCell && stockCell
            ? {
                rowOrder,
                priceCellIndex: priceCell.cellIndex,
                stockCellIndex: stockCell.cellIndex
              }
            : null;
        })
        .filter(Boolean)[0] as { rowOrder: number; priceCellIndex: number; stockCellIndex: number } | undefined;
      if (!header) {
        continue;
      }

      const rows = tableRows
        .slice(header.rowOrder + 1)
        .map((row, index) => {
          if (!visible(row)) {
            return null;
          }
          const cells = Array.from(row.querySelectorAll("th, td")).map((cell) => cell as HTMLTableCellElement);
          const priceCell = cells.find((cell) => cell.cellIndex === header.priceCellIndex);
          const stockCell = cells.find((cell) => cell.cellIndex === header.stockCellIndex);
          if (!priceCell || !stockCell) {
            return null;
          }
          const priceInput = Array.from(priceCell.querySelectorAll("input")).find((input) => usableInput(input as HTMLInputElement)) as HTMLInputElement | undefined;
          const stockInput = Array.from(stockCell.querySelectorAll("input")).find((input) => usableInput(input as HTMLInputElement)) as HTMLInputElement | undefined;
          if (!priceInput || !stockInput) {
            return null;
          }
          return {
            trIndex: allRows.indexOf(row),
            priceInputIndex: Array.from(row.querySelectorAll("input")).indexOf(priceInput),
            stockInputIndex: Array.from(row.querySelectorAll("input")).indexOf(stockInput),
            rowOrder: index,
            priceValue: priceInput.value || "",
            stockValue: stockInput.value || ""
          };
        })
        .filter((row): row is PriceInventoryDomRow => Boolean(row));
      if (rows.length) {
        return rows;
      }
    }
    const detachedRows = allRows
      .map((row, index) => {
        if (!visible(row)) {
          return null;
        }
        const rowInputs = Array.from(row.querySelectorAll("input")).map((input) => input as HTMLInputElement);
        const rowText = normalize(row.innerText || row.textContent || "");
        const stockInput = rowInputs.find((input) => {
          const placeholder = input.getAttribute("placeholder") || "";
          return usableInput(input) && placeholder.includes("请输入库存");
        });
        const codeInput = rowInputs.find((input) => {
          const placeholder = input.getAttribute("placeholder") || "";
          return placeholder.includes("请输入erp编码") || placeholder.includes("商家编码");
        });
        const priceInput = rowInputs.find((input) => {
          const placeholder = input.getAttribute("placeholder") || "";
          return (
            usableInput(input) &&
            input !== stockInput &&
            input !== codeInput &&
            (placeholder.includes("请输入") || placeholder.includes("价格") || rowText.includes("￥"))
          );
        });
        if (!priceInput || !stockInput || !codeInput) {
          return null;
        }
        return {
          trIndex: allRows.indexOf(row),
          priceInputIndex: rowInputs.indexOf(priceInput),
          stockInputIndex: rowInputs.indexOf(stockInput),
          rowOrder: index,
          priceValue: priceInput.value || "",
          stockValue: stockInput.value || ""
        };
      })
      .filter((row): row is PriceInventoryDomRow => Boolean(row));
    return detachedRows;
  });
}

async function detectPriceInventoryValuesInsideSpecInputs(
  page: Page,
  priceInventoryRows: PriceInventoryRowValue[]
): Promise<string[]> {
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
  }, [...priceInventoryRows.map((row) => row.price), ...priceInventoryRows.map((row) => row.stock)]);
}

type PriceInventoryRowTarget = {
  trIndex: number;
  priceInputIndex: number;
  stockInputIndex: number;
  rowOrder: number;
  priceValue: string;
  stockValue: string;
};

async function readVisiblePriceInventoryRowTargets(page: Page): Promise<PriceInventoryRowTarget[]> {
  return (await findPriceInventoryTableDomRows(page))
    .map((row) => ({
      trIndex: row.trIndex,
      priceInputIndex: row.priceInputIndex,
      stockInputIndex: row.stockInputIndex,
      rowOrder: row.rowOrder,
      priceValue: row.priceValue,
      stockValue: row.stockValue
    }))
    .sort((a, b) => a.rowOrder - b.rowOrder);
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
    await fillVisiblePriceInventoryRowByTableDom(page, rowIndex, expectedPriceText, expectedStockText);
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

export async function countVisiblePriceInventoryRows(page: Page): Promise<number> {
  const rows = await readVisiblePriceInventoryRows(page).catch(() => []);
  return rows.length;
}

export async function applyPriceInventoryOnPage(
  page: Page,
  runtimeDir: string,
  fileName: string,
  priceInventoryRows: PriceInventoryRowValue[]
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

  const pollutedSpecInputsBeforeFill = await detectPriceInventoryValuesInsideSpecInputs(page, priceInventoryRows).catch(() => []);
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

  const filledRows = Math.min(rows.length, priceInventoryRows.length);
  for (let index = 0; index < filledRows; index += 1) {
    const expected = priceInventoryRows[index];
    const rowIssue = await fillAndVerifyPriceInventoryRow(page, index, expected.price, expected.stock);
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
  const pollutedSpecInputsAfterFill = await detectPriceInventoryValuesInsideSpecInputs(page, priceInventoryRows).catch(() => []);
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
  const missingRows = priceInventoryRows.map((expected, index) => {
    const currentRow = finalRows[index];
    if (!currentRow) {
      return `row ${index + 1} missing`;
    }
    const priceOk = normalizeNumericInputValue(currentRow.priceValue) === normalizeNumericInputValue(String(expected.price));
    const stockOk = normalizeNumericInputValue(currentRow.stockValue) === normalizeNumericInputValue(String(expected.stock));
    return priceOk && stockOk
      ? ""
      : `row ${index + 1} expected price=${expected.price}, stock=${expected.stock}; actual price=${currentRow.priceValue || "<empty>"}, stock=${currentRow.stockValue || "<empty>"}`;
  }).filter(Boolean);

  if (missingRows.length) {
    const screenshotFile = await savePageScreenshot(page, runtimeDir, fileName);
    return {
      pageUrl: page.url(),
      pageTitle: await page.title(),
      screenshotFile,
      filledRows: finalRows.filter((row, index) => {
        const expected = priceInventoryRows[index];
        const priceOk = normalizeNumericInputValue(row.priceValue) === normalizeNumericInputValue(String(expected?.price ?? ""));
        const stockOk = normalizeNumericInputValue(row.stockValue) === normalizeNumericInputValue(String(expected?.stock ?? ""));
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
