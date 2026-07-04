import path from "node:path";
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
  const allTab = page.getByText("全部", { exact: true }).first();
  if (await allTab.count().catch(() => 0)) {
    await allTab.click({ timeout: 15000 }).catch(() => {});
  }
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
  await clickAllTab(page);
  await page.waitForTimeout(800);

  const searchInput = page.getByPlaceholder("请输入商品名称/商品ID/商家编码，多条可用逗号隔开").first();
  await searchInput.fill(title, { timeout: 15000 });
  await page.getByRole("button", { name: /^查询$/ }).click({ timeout: 15000 });
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2500);

  const bodyText = await page.locator("body").innerText({ timeout: 10000 });
  const normalizedTitle = normalizeText(title);
  const countText = bodyText.match(/共\s*\d+\s*条/)?.[0] || "";
  const matchedRows = await page.locator("tbody tr, .auxo-table-row, .ecom-table-row")
    .evaluateAll((rows, expectedTitle) =>
      rows
        .map((row) => (row as HTMLElement).innerText || "")
        .filter((text) => text.replace(/\s+/g, "").includes(String(expectedTitle)))
        .slice(0, 5),
      normalizedTitle
    )
    .catch(() => [] as string[]);
  const found = normalizeText(bodyText).includes(normalizedTitle) || matchedRows.length > 0;
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
