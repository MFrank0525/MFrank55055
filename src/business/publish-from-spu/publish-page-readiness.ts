import type { Page } from "playwright";
import { launchPersistentBrowser } from "../../browser/launch.js";
import { evaluatePublishCreatePageReadiness } from "./publish-rules.js";
import {
  PublishCreatePageReopenRequiredError,
  attachSafeDialogHandler,
  gotoWithTolerance,
  savePageScreenshot
} from "./browser-session.js";

export async function recoverUsablePublishPage(currentPage: Page): Promise<Page> {
  const context = currentPage.context();
  const candidates = [
    currentPage,
    ...context.pages().filter((item) => item !== currentPage)
  ].filter((item) => !item.isClosed() && item.url().includes("/ffa/g/create"));

  let recoveredPage: Page | null = null;
  for (const candidate of candidates) {
    attachSafeDialogHandler(candidate);
    await candidate.bringToFront().catch(() => {});
    await candidate.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => {});
    await candidate.waitForTimeout(800).catch(() => {});
    const usable = await isUsablePublishCreatePage(candidate).catch(() => false);
    if (usable) {
      recoveredPage = candidate;
      break;
    }
  }

  if (!recoveredPage) {
    throw new Error("Publish create page context was lost and no usable replacement page is available.");
  }

  await recoveredPage.bringToFront().catch(() => {});
  return recoveredPage;
}

async function isUsablePublishCreatePage(page: Page): Promise<boolean> {
  if (page.isClosed() || !page.url().includes("/ffa/g/create")) {
    return false;
  }
  return page.evaluate(() => {
    const bodyText = document.body.innerText || "";
    const requiredSectionCount = ["基础信息", "图文信息", "价格库存", "服务与履约"].filter((text) => bodyText.includes(text)).length;
    const hasPublishAction = bodyText.includes("发布商品") || bodyText.includes("填写检查");
    const loginRequired =
      (bodyText.includes("扫码登录") && bodyText.includes("抖店App")) ||
      bodyText.includes("打开抖店App扫码登录") ||
      bodyText.includes("切换为手机/邮箱登录");
    return requiredSectionCount >= 2 && hasPublishAction && !loginRequired;
  });
}

async function getPublishCreatePageHealth(page: Page): Promise<{
  usable: boolean;
  bodyTextLength: number;
  sectionCount: number;
  loading: boolean;
  loginRequired: boolean;
  bodyText: string;
}> {
  if (page.isClosed() || !page.url().includes("/ffa/g/create")) {
    return { usable: false, bodyTextLength: 0, sectionCount: 0, loading: false, loginRequired: false, bodyText: "" };
  }
  return page.evaluate(() => {
    const bodyText = document.body.innerText || "";
    const normalized = bodyText.replace(/\s+/g, "");
    const sectionCount = ["基础信息", "图文信息", "价格库存", "服务与履约"].filter((text) => normalized.includes(text)).length;
    const hasPublishAction = normalized.includes("发布商品") || normalized.includes("填写检查");
    const recoverablePageError =
      normalized.includes("数据异常请刷新重试") ||
      (normalized.includes("数据异常") && normalized.includes("刷新重试")) ||
      normalized.includes("网络异常") ||
      normalized.includes("系统繁忙") ||
      normalized.includes("请稍后重试");
    const loginRequired =
      (normalized.includes("扫码登录") && normalized.includes("抖店App")) ||
      normalized.includes("打开抖店App扫码登录") ||
      normalized.includes("切换为手机/邮箱登录");
    const loading =
      normalized.includes("加载中") ||
      normalized.includes("努力加载") ||
      recoverablePageError;
    return {
      usable: sectionCount >= 2 && hasPublishAction && !loginRequired && !recoverablePageError,
      bodyTextLength: normalized.length,
      sectionCount,
      loading,
      loginRequired,
      bodyText: normalized.slice(0, 300)
    };
  });
}

export async function waitForPublishCreatePageReady(
  page: Page,
  runtimeDir: string,
  publishPageUrl: string,
  label: string,
  maxAttempts = 3,
  options: { allowPageNavigationRecovery?: boolean } = {}
): Promise<void> {
  const allowPageNavigationRecovery = options.allowPageNavigationRecovery ?? true;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    await Promise.race([
      page.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => {}),
      page.waitForTimeout(1800 + attempt * 600).catch(() => {})
    ]);
    const health = await getPublishCreatePageHealth(page).catch(() => ({
      usable: false,
      bodyTextLength: 0,
      sectionCount: 0,
      loading: false,
      loginRequired: false,
      bodyText: ""
    }));
    const readiness = evaluatePublishCreatePageReadiness(health);
    if (readiness.action === "ready") {
      return;
    }
    if (readiness.action === "fail_login") {
      throw new Error(readiness.issue);
    }
    if (readiness.action === "reopen_from_platform_spu") {
      throw new PublishCreatePageReopenRequiredError(readiness.issue);
    }
    await savePageScreenshot(page, runtimeDir, `${label}-publish-page-not-ready-${attempt + 1}.png`).catch(() => "");
    if (attempt < maxAttempts - 1) {
      if (allowPageNavigationRecovery) {
        if (page.url().includes("/ffa/g/create")) {
          await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
        } else if (publishPageUrl) {
          await gotoWithTolerance(page, publishPageUrl, 2500).catch(() => {});
        }
      }
      await page.waitForTimeout(2200 + attempt * 700).catch(() => {});
      continue;
    }
    throw new Error(
      `Publish create page did not become ready after network/page-content recovery. sections=${health.sectionCount}; textLength=${health.bodyTextLength}; loading=${health.loading}; body=${health.bodyText}`
    );
  }
}

export async function recoverUsablePageFromContext(context: Awaited<ReturnType<typeof launchPersistentBrowser>>, preferredUrlPart?: string): Promise<Page> {
  const recoveredPage =
    (preferredUrlPart
      ? context.pages().find((item) => !item.isClosed() && item.url().includes(preferredUrlPart))
      : null) ||
    context.pages().find((item) => !item.isClosed()) ||
    null;

  if (!recoveredPage) {
    throw new Error("Browser page context was lost and no replacement page is available.");
  }

  attachSafeDialogHandler(recoveredPage);
  await recoveredPage.bringToFront().catch(() => {});
  await recoveredPage.waitForTimeout(1200).catch(() => {});
  return recoveredPage;
}
