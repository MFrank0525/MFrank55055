import type { Page } from "playwright";
import { launchPersistentBrowser } from "../../browser/launch.js";
import { savePageScreenshot } from "./browser-session.js";

type PublishPageInspection = {
  pageUrl: string;
  pageTitle: string;
  screenshotFile: string;
  sections: string[];
  topActions: string[];
  errorHints: string[];
};

function readPublishPageSummary(page: Page): Promise<{
  sections: string[];
  topActions: string[];
  errorHints: string[];
}> {
  return page.evaluate(() => {
    const bodyText = document.body.innerText || "";
    const knownSections = [
      "\u57FA\u7840\u4FE1\u606F",
      "\u56FE\u6587\u4FE1\u606F",
      "\u4EF7\u683C\u5E93\u5B58",
      "\u670D\u52A1\u4E0E\u5C65\u7EA6",
      "\u5176\u4ED6\u4FE1\u606F"
    ].filter((text) => bodyText.includes(text));
    const knownActions = [
      "\u53D1\u5E03\u5546\u54C1",
      "\u4FDD\u5B58\u8349\u7A3F",
      "\u586B\u5199\u68C0\u67E5"
    ].filter((text) => bodyText.includes(text));
    const errorHints = bodyText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => /(\u5F85\u5904\u7406|\u5FC5\u586B|\u8BF7\u8F93\u5165|\u9519\u8BEF|\u95EE\u9898)/.test(line))
      .slice(0, 8);

    return {
      sections: knownSections,
      topActions: knownActions,
      errorHints
    };
  });
}

export async function inspectPublishPage(runtimeDir: string, publishPageUrl?: string): Promise<PublishPageInspection> {
  const context = await launchPersistentBrowser();
  try {
    const existingCreatePage = context.pages().find((item) => !item.isClosed() && item.url().includes("/ffa/g/create"));
    const page = existingCreatePage || context.pages().find((item) => !item.isClosed()) || (await context.newPage());
    await page.bringToFront();

    if (publishPageUrl) {
      await page.goto(publishPageUrl, { waitUntil: "domcontentloaded" });
    } else if (!page.url().includes("/ffa/g/create")) {
      throw new Error("inspect_publish_page requires input.publishPageUrl or an already-open publish page.");
    }

    await page.waitForTimeout(3500);
    const pageSummary = await readPublishPageSummary(page);
    const screenshotFile = await savePageScreenshot(page, runtimeDir, "publish-page-inspect.png");
    return {
      pageUrl: page.url(),
      pageTitle: await page.title(),
      screenshotFile,
      sections: pageSummary.sections,
      topActions: pageSummary.topActions,
      errorHints: pageSummary.errorHints
    };
  } finally {
    await context.browser()?.close().catch(() => {});
  }
}

export async function inspectPublishPageOnPage(
  page: Page,
  runtimeDir: string,
  fileName: string
): Promise<PublishPageInspection> {
  await page.waitForTimeout(1500);
  const pageSummary = await readPublishPageSummary(page);
  const screenshotFile = await savePageScreenshot(page, runtimeDir, fileName);
  return {
    pageUrl: page.url(),
    pageTitle: await page.title(),
    screenshotFile,
    sections: pageSummary.sections,
    topActions: pageSummary.topActions,
    errorHints: pageSummary.errorHints
  };
}
