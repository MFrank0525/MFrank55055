import path from "node:path";
import type { Locator } from "playwright";
import { getWorkspacePage, launchPersistentBrowser } from "../../browser/launch.js";
import { logInfo } from "../../utils/logger.js";
import { savePageScreenshot } from "./browser-session.js";
import { ensureShopContext } from "./shop-switch-action.js";

const PRODUCT_LIST_URL = "https://fxg.jinritemai.com/ffa/g/list";

export interface DoudianProductListVerificationResult {
  found: boolean;
  title: string;
  shopFolder: string;
  shopName: string;
  countText: string;
  matchedRows: string[];
  pageUrl: string;
  screenshotFile: string;
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, "").trim();
}

async function waitForUniqueProductListLocator(
  page: Awaited<ReturnType<typeof getWorkspacePage>>,
  label: string,
  resolve: () => Locator,
  timeoutMs = 20000
): Promise<Locator> {
  const deadline = Date.now() + timeoutMs;
  const observedCounts = new Set<number>();
  while (Date.now() < deadline) {
    const locator = resolve();
    const count = await locator.count().catch(() => 0);
    observedCounts.add(count);
    if (count === 1 && await locator.isVisible().catch(() => false)) {
      return locator;
    }
    await page.waitForTimeout(400);
  }
  throw new Error(
    `Doudian product list ${label} could not be uniquely resolved after ${timeoutMs}ms; visibleCounts=${[...observedCounts].join(",") || "none"}.`
  );
}

async function clickAllTab(page: Awaited<ReturnType<typeof getWorkspacePage>>): Promise<void> {
  const productStatusTabGroup = await waitForUniqueProductListLocator(
    page,
    "product status tab group",
    () => page
      .locator(".ecom-g-tabs-nav-list")
      .filter({ visible: true })
      .filter({ has: page.getByRole("tab", { name: "售卖中", exact: true }) })
  );
  const allTab = await waitForUniqueProductListLocator(
    page,
    "product status 全部 tab",
    () => productStatusTabGroup
      .getByRole("tab", { name: "全部", exact: true })
      .filter({ visible: true })
  );
  if ((await allTab.getAttribute("aria-selected")) === "true") {
    return;
  }
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await dismissProductListBlockingOverlays(page);
    try {
      await allTab.click({ timeout: 8000 });
      for (let readback = 0; readback < 15; readback += 1) {
        if ((await allTab.getAttribute("aria-selected").catch(() => null)) === "true") {
          return;
        }
        await page.waitForTimeout(200);
      }
      lastError = new Error("Doudian product status 全部 tab click did not produce selected-state readback.");
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Doudian product status 全部 tab click failed.");
}

async function dismissProductListBlockingOverlays(
  page: Awaited<ReturnType<typeof getWorkspacePage>>
): Promise<void> {
  const deadline = Date.now() + 10000;
  let sawBlockingMask = false;
  while (Date.now() < deadline) {
    const dialogs = page
      .locator("[role='dialog'], [aria-modal='true'], .ecom-g-modal-wrap, .index_autoOptmModalWrapper__yQ2hV")
      .filter({ visible: true })
      .filter({ hasText: /属性自动优化/ });
    const dialogCount = await dialogs.count().catch(() => 0);
    if (dialogCount > 0) {
      const closeButton = dialogs
        .getByRole("button", { name: "Close", exact: true })
        .filter({ visible: true });
      if ((await closeButton.count()) !== 1) {
        throw new Error("Product list is blocked by 属性自动优化 dialog, but its safe Close button is not unique.");
      }
      await closeButton.click({ timeout: 8000 });
      await page.waitForTimeout(350);
      continue;
    }
    const blockingMasks = page.locator(".auxo-modal-mask, .ecom-g-modal-mask").filter({ visible: true });
    const maskCount = await blockingMasks.count().catch(() => 0);
    if (maskCount === 0) {
      return;
    }
    sawBlockingMask = true;
    await page.waitForTimeout(400);
  }
  const visibleDialogText = await page
    .locator("[role='dialog'], [aria-modal='true'], .ecom-g-modal-wrap, .auxo-modal-wrap")
    .filter({ visible: true })
    .evaluateAll((dialogs) => dialogs
      .map((dialog) => ((dialog as HTMLElement).innerText || "").replace(/\s+/g, " ").trim().slice(0, 160))
      .filter(Boolean)
      .slice(0, 3))
    .catch(() => [] as string[]);
  throw new Error(
    `Product list remains blocked by an unrecognized modal overlay; maskObserved=${sawBlockingMask}; dialogs=${visibleDialogText.join(" | ") || "none"}.`
  );
}

async function clickProductListSearch(
  page: Awaited<ReturnType<typeof getWorkspacePage>>,
  searchInput: Locator
): Promise<void> {
  const searchForm = searchInput.locator("xpath=ancestor::form[1]");
  if ((await searchForm.count()) !== 1) {
    throw new Error("Product list title search form could not be uniquely resolved from its input.");
  }
  const queryButton = searchForm.getByRole("button", { name: "查询", exact: true });
  if ((await queryButton.count()) !== 1) {
    throw new Error("Product list title query button is not unique inside its search form.");
  }
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await dismissProductListBlockingOverlays(page);
    try {
      await queryButton.click({ timeout: 8000 });
      return;
    } catch (error) {
      lastError = error;
      await page.waitForTimeout(500);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Product list query click failed after retries.");
}

async function waitForProductListQuerySettlement(
  page: Awaited<ReturnType<typeof getWorkspacePage>>,
  title: string,
  timeoutMs = 30000
): Promise<{ countText: string }> {
  const deadline = Date.now() + timeoutMs;
  let lastEvidence = "query-not-observed";
  while (Date.now() < deadline) {
    const pageUrl = page.url();
    let queryTitle = "";
    try {
      queryTitle = new URL(pageUrl).searchParams.get("product_id") || "";
    } catch {
      queryTitle = "";
    }
    const bodyText = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
    const countText = bodyText.match(/共\s*\d+\s*条/)?.[0] || "";
    const count = Number(countText.match(/\d+/)?.[0] || NaN);
    const visibleEmptyStates = await page
      .getByText("暂无数据", { exact: true })
      .filter({ visible: true })
      .count()
      .catch(() => 0);
    const visibleResultRows = await page
      .locator("tbody tr, .auxo-table-row, .ecom-table-row")
      .filter({ visible: true })
      .count()
      .catch(() => 0);
    const visibleLoadingIndicators = await page
      .locator(".auxo-spin-spinning, .ecom-g-spin-spinning, [aria-busy='true']")
      .filter({ visible: true })
      .count()
      .catch(() => 0);
    const queryMatches = normalizeText(queryTitle) === normalizeText(title);
    lastEvidence = [
      `queryMatches=${queryMatches}`,
      `countText=${countText || "missing"}`,
      `rows=${visibleResultRows}`,
      `emptyStates=${visibleEmptyStates}`,
      `loading=${visibleLoadingIndicators}`
    ].join(",");
    if (queryMatches && Number.isFinite(count) && visibleLoadingIndicators === 0) {
      if ((count === 0 && visibleEmptyStates > 0) || (count > 0 && visibleResultRows > 0)) {
        return { countText };
      }
    }
    await page.waitForTimeout(400);
  }
  throw new Error(`Doudian product list exact-title query did not settle after ${timeoutMs}ms; ${lastEvidence}.`);
}

export async function verifyPublishedProductInDoudianList(input: {
  runtimeDir: string;
  shopFolder: string;
  title: string;
}): Promise<DoudianProductListVerificationResult> {
  const title = input.title.trim();
  if (!title) {
    throw new Error("Doudian list verification requires a non-empty product title.");
  }

  const context = await launchPersistentBrowser();
  const page = await getWorkspacePage(context, "shop");
  try {
    const shopName = await ensureShopContext(page, input.runtimeDir, input.shopFolder);
    await page.goto(PRODUCT_LIST_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(1800);
    await dismissProductListBlockingOverlays(page);
    await clickAllTab(page);
    await page.waitForTimeout(800);
    await dismissProductListBlockingOverlays(page);

    const searchInput = await waitForUniqueProductListLocator(
      page,
      "title search input",
      () => page
        .getByPlaceholder("请输入商品名称/商品ID/商家编码，多条可用逗号隔开")
        .filter({ visible: true })
    );
    await searchInput.fill(title, { timeout: 15000 });
    await clickProductListSearch(page, searchInput);
    await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
    const { countText } = await waitForProductListQuerySettlement(page, title);

    const normalizedTitle = normalizeText(title);
    const matchedRows = await page.locator("tbody tr, .auxo-table-row, .ecom-table-row").filter({ visible: true })
      .evaluateAll((rows, expectedTitle) =>
        rows
          .map((row) => (row as HTMLElement).innerText || "")
          .filter((text) => text.replace(/\s+/g, "").includes(String(expectedTitle)))
          .slice(0, 5),
        normalizedTitle
      )
      .catch(() => [] as string[]);
    const found = matchedRows.length > 0;
    const screenshotFile = await savePageScreenshot(
      page,
      input.runtimeDir,
      `doudian-list-full-title-${path.basename(input.shopFolder)}-${found ? "found" : "not-found"}.png`
    ).catch(() => "");

    logInfo(
      `Doudian list full-title verification ${found ? "found" : "not found"}: ${path.basename(input.shopFolder)} - ${title}`
    );

    return {
      found,
      title,
      shopFolder: input.shopFolder,
      shopName,
      countText,
      matchedRows,
      pageUrl: page.url(),
      screenshotFile
    };
  } catch (error) {
    const failureScreenshot = await savePageScreenshot(
      page,
      input.runtimeDir,
      `doudian-list-verification-failed-${path.basename(input.shopFolder)}.png`
    ).catch(() => "");
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${message} failureScreenshot=${failureScreenshot || "missing"}`);
  }
}
