import fs from "node:fs";
import path from "node:path";
import { launchPersistentBrowser } from "../browser/launch.js";
import type { CaptureConversationOptions, CaptureConversationResult } from "./types.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function captureLatestAnswerText(options: {
  conversationUrl?: string;
  mode?: "titles" | "selling_points" | "latest";
}): Promise<{ text: string; screenshotSelector?: string }> {
  const context = await launchPersistentBrowser();
  const pages = context.pages().filter((item) => !item.isClosed());
  const targetConversationUrl = options.conversationUrl?.trim() || "";
  const page =
    (targetConversationUrl ? pages.find((item) => item.url().startsWith(targetConversationUrl)) : undefined) ||
    pages.find((item) => /https:\/\/www\.doubao\.com\/chat\/\d+/.test(item.url())) ||
    pages.find((item) => /https:\/\/www\.doubao\.com\/chat\//.test(item.url()));

  if (!page) {
    throw new Error("Doubao conversation page not found");
  }

  await page.bringToFront();
  await page.waitForLoadState("domcontentloaded");

  const extracted = await page.evaluate((mode) => {
    const normalize = (value: string): string => value.replace(/\r/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    const main = document.querySelector("main") || document.body;
    const selectors = [
      '[data-testid*="message"]',
      '[data-testid*="answer"]',
      '[class*="answer"]',
      '[class*="assistant"]',
      '[class*="message"]',
      '[class*="markdown"]',
      "article",
      "section",
      "div"
    ];

    const seen = new Set<Element>();
    const candidates: Array<{ text: string; selector: string; top: number; bottom: number; score: number }> = [];

    const looksLikeTitles = (text: string): boolean => /(^|\n)0?1\s+/.test(text) && /(^|\n)20\s+/.test(text);
    const looksLikeSellingPoints = (text: string): boolean =>
      /官方正品/.test(text) &&
      /正品保证/.test(text) &&
      /匠心甄选/.test(text) &&
      /不展示批准文号信息/.test(text) &&
      /医疗器械认证|蓝帽保健食品认证|OTC药品认证/.test(text);

    selectors.forEach((selector) => {
      main.querySelectorAll(selector).forEach((node) => {
        if (seen.has(node)) {
          return;
        }
        seen.add(node);

        const text = normalize((node as HTMLElement).innerText || "");
        if (!text || text.length < 20) {
          return;
        }

        if (mode === "titles" && !looksLikeTitles(text)) {
          return;
        }
        if (mode === "selling_points" && !looksLikeSellingPoints(text)) {
          return;
        }

        const rect = (node as HTMLElement).getBoundingClientRect();
        const score = rect.bottom * 1000 + text.length;
        candidates.push({
          text,
          selector,
          top: rect.top,
          bottom: rect.bottom,
          score
        });
      });
    });

    candidates.sort((a, b) => b.score - a.score);
    if (candidates.length > 0) {
      return {
        text: candidates[0].text,
        selector: candidates[0].selector
      };
    }

    if (mode === "titles") {
      throw new Error("Doubao title response was not found in the latest visible answer.");
    }
    if (mode === "selling_points") {
      throw new Error("Doubao selling-point response was not found in the latest visible answer.");
    }
    return {
      text: normalize(document.body.innerText || "").slice(-8000),
      selector: ""
    };
  }, options.mode || "latest");

  return {
    text: extracted.text,
    screenshotSelector: extracted.selector || undefined
  };
}

export async function captureConversation(options: CaptureConversationOptions): Promise<CaptureConversationResult> {
  if (!fs.existsSync(options.outputDir)) {
    throw new Error(`Output dir not found: ${options.outputDir}`);
  }

  const context = await launchPersistentBrowser();
  const pages = context.pages().filter((item) => !item.isClosed());
  const targetConversationUrl = options.conversationUrl?.trim() || "";
  const page =
    (targetConversationUrl ? pages.find((item) => item.url().startsWith(targetConversationUrl)) : undefined) ||
    pages.find((item) => /https:\/\/www\.doubao\.com\/chat\/\d+/.test(item.url())) ||
    pages.find((item) => /https:\/\/www\.doubao\.com\/chat\//.test(item.url()));

  if (!page) {
    throw new Error("Doubao conversation page not found");
  }

  await page.bringToFront();
  await page.waitForLoadState("domcontentloaded");
  await sleep(options.waitMs ?? 15000);

  const extracted = await captureLatestAnswerText({
    conversationUrl: targetConversationUrl,
    mode: options.mode
  });
  const rawFile = options.rawFileOut ? path.resolve(options.rawFileOut) : "";
  const pngFile = options.screenshotOut ? path.resolve(options.screenshotOut) : "";

  if (rawFile) {
    fs.mkdirSync(path.dirname(rawFile), { recursive: true });
    fs.writeFileSync(rawFile, extracted.text, "utf8");
  }
  if (pngFile) {
    fs.mkdirSync(path.dirname(pngFile), { recursive: true });
    try {
      if (extracted.screenshotSelector) {
        const target = page.locator(extracted.screenshotSelector).last();
        if ((await target.count()) > 0 && (await target.isVisible().catch(() => false))) {
          await target.screenshot({ path: pngFile });
        } else {
          await page.screenshot({ path: pngFile, fullPage: true });
        }
      } else {
        await page.screenshot({ path: pngFile, fullPage: false });
      }
    } catch {
      try {
        await page.screenshot({ path: pngFile, fullPage: false });
      } catch {
        // Screenshot is only an audit artifact. Do not fail the workflow if capture cannot render.
      }
    }
  }

  return {
    activeUrl: page.url(),
    rawFile,
    pngFile,
    capturedAt: new Date().toISOString()
  };
}
