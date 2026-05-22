import fs from "node:fs";
import path from "node:path";
import { closeBrowser, launchPersistentBrowser } from "../browser/launch.js";
import { setClipboardText } from "../utils/clipboard.js";
import { getPasteShortcut } from "../utils/platform.js";
import type { SubmitPromptOptions, SubmitPromptResult } from "./types.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function rand(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min + 1));
}

function resolvePrompt(options: SubmitPromptOptions): { prompt: string; promptFile: string } {
  if (options.promptText?.trim()) {
    return {
      prompt: options.promptText.trim(),
      promptFile: "[inline]"
    };
  }

  if (!options.promptFile) {
    throw new Error("Either promptFile or promptText is required.");
  }
  if (!fs.existsSync(options.promptFile)) {
    throw new Error(`Prompt file not found: ${options.promptFile}`);
  }

  const prompt = fs.readFileSync(options.promptFile, "utf8").trim();
  if (!prompt) {
    throw new Error(`Prompt file is empty: ${options.promptFile}`);
  }

  return {
    prompt,
    promptFile: path.resolve(options.promptFile)
  };
}

export async function submitPrompt(options: SubmitPromptOptions): Promise<SubmitPromptResult> {
  const shouldAttachImage = options.attachImage !== false;
  const resolvedImagePath = options.imagePath ? path.resolve(options.imagePath) : "";
  if (shouldAttachImage && (!resolvedImagePath || !fs.existsSync(resolvedImagePath))) {
    throw new Error(`Image not found: ${options.imagePath}`);
  }

  const { prompt, promptFile } = resolvePrompt(options);
  const context = await launchPersistentBrowser();
  try {
  const existingPages = context.pages().filter((item) => !item.isClosed());
  const targetConversationUrl = options.conversationUrl?.trim() || "";
  const matchedPage = targetConversationUrl
    ? existingPages.find((item) => item.url().startsWith(targetConversationUrl))
    : undefined;
  const fallbackPage =
    existingPages.find((item) => /https:\/\/www\.doubao\.com\/chat\/\d+/.test(item.url())) ||
    existingPages.find((item) => /https:\/\/www\.doubao\.com\/chat\//.test(item.url())) ||
    existingPages[0];
  const page = options.freshConversation ? await context.newPage() : matchedPage || fallbackPage || (await context.newPage());

  await page.bringToFront();
  if (targetConversationUrl) {
    if (!page.url().startsWith(targetConversationUrl)) {
      await page.goto(targetConversationUrl, { waitUntil: "domcontentloaded" });
      await sleep(2500);
    } else {
      await page.waitForLoadState("domcontentloaded");
      await sleep(1200);
    }
  } else if (options.freshConversation || !/https:\/\/www\.doubao\.com\/chat\//.test(page.url())) {
    await page.goto("https://www.doubao.com/chat/", { waitUntil: "domcontentloaded" });
    await sleep(2500);
  } else {
    await page.waitForLoadState("domcontentloaded");
    await sleep(1200);
  }

  const bodyText = await page.locator("body").innerText();
  if (bodyText.includes("登录") && !bodyText.includes("北非无战事")) {
    throw new Error("Doubao appears logged out; manual login required.");
  }

  const input = page.locator('textarea[placeholder="发消息..."]').first();
  await input.waitFor({ state: "visible", timeout: 20000 });

  if (shouldAttachImage) {
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles([resolvedImagePath]);
    await sleep(rand(1800, 2600));
  }

  await input.click({ delay: rand(70, 150) });
  await sleep(rand(180, 320));
  setClipboardText(prompt, "doubao-prompt");
  await page.keyboard.press(getPasteShortcut());
  await sleep(rand(600, 1100));

  const container = page.locator('div[class*="input-content-container"]').first();
  const buttons = container.locator("button");
  const buttonCount = await buttons.count();
  if (buttonCount > 0) {
    const sendButton = buttons.nth(buttonCount - 1);
    await sendButton.hover();
    await sleep(rand(250, 450));
    await sendButton.click({ delay: rand(70, 150) });
  } else {
    await input.press("Enter");
  }

  return {
    activeUrl: page.url(),
    imagePath: resolvedImagePath,
    promptFile,
    promptLength: prompt.length,
    submittedAt: new Date().toISOString()
  };
  } finally {
    await closeBrowser(context);
  }
}
