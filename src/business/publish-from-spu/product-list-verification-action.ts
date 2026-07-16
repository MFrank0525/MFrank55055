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

async function clickAllTab(page: Awaited<ReturnType<typeof getWorkspacePage>>): Promise<void> {
  const roleTabs = page.getByRole("tab", { name: "全部", exact: true }).filter({ visible: true });
  const textTabs = page.getByText("全部", { exact: true }).filter({ visible: true });
  const candidates = (await roleTabs.count().catch(() => 0)) > 0 ? roleTabs : textTabs;
  if ((await candidates.count().catch(() => 0)) !== 1) {
    throw new Error("Doudian product list 全部 tab could not be uniquely resolved.");
  }
  await candidates.click({ timeout: 15000 });
}

async function dismissProductListBlockingOverlays(
  page: Awaited<ReturnType<typeof getWorkspacePage>>
): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const dialog = page
      .locator("[role='dialog'], [aria-modal='true'], .ecom-g-modal-wrap, .index_autoOptmModalWrapper__yQ2hV")
      .filter({ hasText: "属性自动优化用户协议" })
      .first();
    if (!(await dialog.isVisible().catch(() => false))) {
      return;
    }
    const closeButton = dialog.getByRole("button", { name: "Close", exact: true });
    if ((await closeButton.count()) !== 1) {
      throw new Error("Product list is blocked by 属性自动优化 dialog, but its safe Close button is not unique.");
    }
    await closeButton.click({ timeout: 8000 });
    await dialog.waitFor({ state: "hidden", timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(350);
  }
  throw new Error("Product list remains blocked by 属性自动优化 dialog after safe close retries.");
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
  const shopName = await ensureShopContext(page, input.runtimeDir, input.shopFolder);
  await page.goto(PRODUCT_LIST_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(1800);
  await dismissProductListBlockingOverlays(page);
  await clickAllTab(page);
  await page.waitForTimeout(800);
  await dismissProductListBlockingOverlays(page);

  const searchInputs = page
    .getByPlaceholder("请输入商品名称/商品ID/商家编码，多条可用逗号隔开")
    .filter({ visible: true });
  if ((await searchInputs.count()) !== 1) {
    throw new Error("Doudian product list title search input could not be uniquely resolved.");
  }
  const searchInput = searchInputs;
  await searchInput.fill(title, { timeout: 15000 });
  await clickProductListSearch(page, searchInput);
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2500);

  const bodyText = await page.locator("body").innerText({ timeout: 10000 });
  const normalizedTitle = normalizeText(title);
  const countText = bodyText.match(/共\s*\d+\s*条/)?.[0] || "";
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
}
