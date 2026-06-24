import fs from "node:fs";
import path from "node:path";
import type { Page } from "playwright";
import { launchPersistentBrowser } from "../../browser/launch.js";

export class PublishCreatePageReopenRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublishCreatePageReopenRequiredError";
  }
}

export function normalizeMatchText(value: string): string {
  return value.replace(/\s+/g, "").trim().toLowerCase();
}

export function normalizeSpuMatchText(value: string): string {
  return normalizeMatchText(value).replace(/械[住注]准/g, "械注准");
}

export function isNavigationContextDestroyedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Execution context was destroyed|Cannot find context|Most likely because of a navigation/i.test(message);
}

export function attachSafeDialogHandler(page: Page): void {
  page.on("dialog", (dialog) => {
    dialog.dismiss().catch(() => {});
  });
}

export async function gotoWithTolerance(page: Page, url: string, waitMs = 3500): Promise<void> {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/ERR_ABORTED/i.test(message)) {
      throw error;
    }
  }
  await page.waitForTimeout(waitMs);
}

export async function savePageScreenshot(page: Page, runtimeDir: string, fileName: string): Promise<string> {
  if (page.isClosed()) {
    return "";
  }
  const screenshotDir = path.join(runtimeDir, "screenshots");
  fs.mkdirSync(screenshotDir, { recursive: true });
  const screenshotFile = path.join(screenshotDir, fileName);
  try {
    await page.screenshot({ path: screenshotFile, fullPage: false, timeout: 5000 });
    return screenshotFile;
  } catch {
    return "";
  }
}

export async function closeExtraPages(
  context: Awaited<ReturnType<typeof launchPersistentBrowser>>,
  keepPages: Page[]
): Promise<void> {
  const keep = new Set(keepPages.filter((page) => !page.isClosed()));
  for (const page of context.pages()) {
    if (keep.has(page) || page.isClosed()) {
      continue;
    }
    await page.close().catch(() => {});
  }
}

export async function closeCreatePagesExcept(
  context: Awaited<ReturnType<typeof launchPersistentBrowser>>,
  keepPages: Page[] = []
): Promise<void> {
  const keep = new Set(keepPages.filter((page) => !page.isClosed()));
  for (const page of context.pages()) {
    if (keep.has(page) || page.isClosed()) {
      continue;
    }
    if (page.url().includes("/ffa/g/create")) {
      await page.close().catch(() => {});
    }
  }
}

export function findOpenCreatePage(
  context: Awaited<ReturnType<typeof launchPersistentBrowser>>,
  createPageUrl: string
): Page | null {
  return (
    context.pages().find((page) => !page.isClosed() && page.url() === createPageUrl) ||
    null
  );
}

export async function reuseOrOpenCreatePage(
  context: Awaited<ReturnType<typeof launchPersistentBrowser>>,
  createPageUrl: string,
  currentPage?: Page
): Promise<Page> {
  const existingPage = findOpenCreatePage(context, createPageUrl);
  const page =
    existingPage ||
    (currentPage && !currentPage.isClosed() ? currentPage : await context.newPage());
  attachSafeDialogHandler(page);
  await closeCreatePagesExcept(context, [page]);
  await closeExtraPages(context, [page]);
  await page.bringToFront();
  if (page.url() !== createPageUrl) {
    await gotoWithTolerance(page, createPageUrl, 3500);
  }
  return page;
}
