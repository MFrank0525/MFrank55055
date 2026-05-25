import fs from "node:fs";
import path from "node:path";
import type { Page } from "playwright";
import { closeBrowser, launchPersistentBrowser } from "../browser/launch.js";
import { isRetryableDoubaoCaptureError, looksLikeDoubaoTitleResponse, resolveDoubaoCaptureRetryPolicy } from "./capture-rules.js";
import type { CaptureConversationOptions, CaptureConversationResult } from "./types.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function captureLatestAnswerText(options: {
  page: Page;
  conversationUrl?: string;
  mode?: "titles" | "selling_points" | "latest";
  titleCount?: number;
}): Promise<{ text: string; screenshotSelector?: string; bodyTextTail?: string }> {
  const page = options.page;
  await page.bringToFront();
  await page.waitForLoadState("domcontentloaded");

  const extracted = await page.evaluate(
    ({ mode, titleCount }) => {
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

    const titleNumberPattern = (number: string): RegExp =>
      new RegExp("(^|\\n)0?" + number + "\\s*[、,，.．:：)）\\]\\】\\s]+");
    const looksLikeInlineTitleSequence = (text: string): boolean => {
      const numbered = [...text.matchAll(/(?<!\\d)0?(\\d{1,3})\\s*[、,，.．:：)）\\]\\】\\s]+/g)].map((match) => Number(match[1]));
      for (let start = 0; start < numbered.length; start += 1) {
        if (numbered[start] !== 1) {
          continue;
        }
        let expected = 2;
        for (let index = start + 1; index < numbered.length && expected <= titleCount; index += 1) {
          if (numbered[index] !== expected) {
            break;
          }
          expected += 1;
        }
        if (expected > titleCount) {
          return true;
        }
      }
      return false;
    };
    const looksLikeTitles = (text: string): boolean =>
      (titleNumberPattern("1").test(text) && titleNumberPattern(String(titleCount)).test(text)) || looksLikeInlineTitleSequence(text);
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
    const bodyTextTail = normalize(document.body.innerText || "").slice(-8000);
    if (candidates.length > 0) {
      return {
        text: candidates[0].text,
        selector: candidates[0].selector,
        bodyTextTail
      };
    }

    if (mode === "titles") {
      return {
        text: "",
        selector: "",
        bodyTextTail,
        error: "Doubao title response was not found in the latest visible answer."
      };
    }
    if (mode === "selling_points") {
      return {
        text: "",
        selector: "",
        bodyTextTail,
        error: "Doubao selling-point response was not found in the latest visible answer."
      };
    }
    return {
      text: bodyTextTail,
      selector: "",
      bodyTextTail
    };
    },
    { mode: options.mode || "latest", titleCount: options.titleCount || 20 }
  );

  if (extracted.error && options.mode === "titles" && looksLikeDoubaoTitleResponse(extracted.bodyTextTail || "", options.titleCount || 20)) {
    return {
      text: extracted.bodyTextTail || "",
      screenshotSelector: undefined,
      bodyTextTail: extracted.bodyTextTail
    };
  }

  if (extracted.error) {
    const error = new Error(extracted.error);
    (error as Error & { bodyTextTail?: string }).bodyTextTail = extracted.bodyTextTail;
    throw error;
  }

  return {
    text: extracted.text,
    screenshotSelector: extracted.selector || undefined,
    bodyTextTail: extracted.bodyTextTail
  };
}

export async function captureConversation(options: CaptureConversationOptions): Promise<CaptureConversationResult> {
  if (!fs.existsSync(options.outputDir)) {
    throw new Error(`Output dir not found: ${options.outputDir}`);
  }

  const context = await launchPersistentBrowser();
  try {
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
    const rawFile = options.rawFileOut ? path.resolve(options.rawFileOut) : "";
    const pngFile = options.screenshotOut ? path.resolve(options.screenshotOut) : "";
    const retryPolicy = resolveDoubaoCaptureRetryPolicy(options.mode);
    let extracted: { text: string; screenshotSelector?: string; bodyTextTail?: string } | undefined;
    let lastError: Error | undefined;

    await sleep(options.waitMs ?? 15000);
    for (let attempt = 1; attempt <= retryPolicy.maxAttempts; attempt += 1) {
      try {
        extracted = await captureLatestAnswerText({
          page,
          conversationUrl: targetConversationUrl,
          mode: options.mode,
          titleCount: options.titleCount
        });
        break;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        const message = lastError.message;
        if (rawFile) {
          fs.mkdirSync(path.dirname(rawFile), { recursive: true });
          fs.writeFileSync(
            rawFile.replace(/\.txt$/i, `-attempt-${String(attempt).padStart(2, "0")}.txt`),
            ((lastError as Error & { bodyTextTail?: string }).bodyTextTail || "") + "\n",
            "utf8"
          );
        }
        if (!isRetryableDoubaoCaptureError(message) || attempt >= retryPolicy.maxAttempts) {
          throw lastError;
        }
        await sleep(retryPolicy.delayMs[attempt - 1] || retryPolicy.delayMs.at(-1) || 30000);
      }
    }

    if (!extracted) {
      throw lastError || new Error("Doubao response capture failed.");
    }

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
  } finally {
    await closeBrowser(context);
  }
}
