import fs from "node:fs";
import path from "node:path";
import { chromium, type BrowserContext, type Locator, type Page } from "playwright";
import { resolveBrowserExecutable } from "../browser/launch.js";

export const DEFAULT_DEEPSEEK_CONVERSATION_URL =
  "https://chat.deepseek.com/a/chat/s/4c5434b3-f81e-4b22-a53d-32cfcf5fb24d";
const DEEPSEEK_PROFILE_DIR = path.resolve(process.cwd(), "data", "auto-listing", "deepseek-browser-profile");

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function findVisibleInput(page: Page): Promise<Locator | undefined> {
  const candidates = [page.locator("textarea").last(), page.locator('[contenteditable="true"]').last()];
  for (const candidate of candidates) {
    if ((await candidate.count().catch(() => 0)) > 0 && (await candidate.isVisible().catch(() => false))) return candidate;
  }
  return undefined;
}

async function waitForLoginAndInput(page: Page): Promise<Locator> {
  const deadline = Date.now() + 10 * 60_000;
  while (Date.now() < deadline) {
    const input = await findVisibleInput(page);
    if (input) return input;
    await sleep(2_000);
  }
  throw new Error("deepseek_login_required: 请在已打开的 DeepSeek 专用浏览器中完成登录，系统没有检测到可用输入框。");
}

async function fillPrompt(input: Locator, promptText: string): Promise<void> {
  const tagName = await input.evaluate((node) => node.tagName.toLowerCase()).catch(() => "");
  if (tagName === "textarea") {
    await input.fill(promptText);
    return;
  }
  await input.evaluate((node, text) => {
    const element = node as HTMLElement;
    element.focus();
    element.textContent = text;
    element.dispatchEvent(new InputEvent("input", { bubbles: true, data: text, inputType: "insertText" }));
  }, promptText);
}

async function submitPrompt(page: Page, input: Locator): Promise<void> {
  const candidates = [page.locator('button[type="submit"]').last(), page.getByRole("button", { name: /发送|send/i }).last()];
  for (const button of candidates) {
    if ((await button.count().catch(() => 0)) > 0 && (await button.isVisible().catch(() => false))) {
      await button.click();
      return;
    }
  }
  await input.press("Enter");
}

async function launchDeepSeekContext(): Promise<BrowserContext> {
  fs.mkdirSync(DEEPSEEK_PROFILE_DIR, { recursive: true });
  return chromium.launchPersistentContext(DEEPSEEK_PROFILE_DIR, {
    headless: false,
    executablePath: resolveBrowserExecutable(),
    viewport: null,
    args: ["--start-maximized"]
  });
}

export async function submitDeepSeekPrompt(options: {
  conversationUrl?: string;
  promptText: string;
  rawFile: string;
  screenshotFile: string;
  extractPrompts: (text: string) => string[];
  timeoutMs?: number;
}): Promise<{ prompts: string[]; rawText: string; submittedAt: string; capturedAt: string }> {
  const context = await launchDeepSeekContext();
  try {
    const page = context.pages()[0] || (await context.newPage());
    await page.goto(options.conversationUrl || DEFAULT_DEEPSEEK_CONVERSATION_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60_000
    });
    await page.bringToFront();
    const input = await waitForLoginAndInput(page);
    await fillPrompt(input, options.promptText);
    const submittedAt = new Date().toISOString();
    await submitPrompt(page, input);

    const deadline = Date.now() + (options.timeoutMs || 180_000);
    let stableSignature = "";
    let stableCount = 0;
    let latestRawText = "";
    while (Date.now() < deadline) {
      await sleep(2_000);
      latestRawText = await page.locator("body").innerText().catch(() => "");
      const promptOffset = latestRawText.lastIndexOf(options.promptText);
      const replyOnly = promptOffset >= 0 ? latestRawText.slice(promptOffset + options.promptText.length) : latestRawText.slice(-16_000);
      const prompts = options.extractPrompts(replyOnly);
      const signature = JSON.stringify(prompts);
      if (prompts.length === 5 && signature === stableSignature) stableCount += 1;
      else {
        stableSignature = signature;
        stableCount = prompts.length === 5 ? 1 : 0;
      }
      if (stableCount >= 2) {
        fs.writeFileSync(options.rawFile, `${replyOnly.trim()}\n`, "utf8");
        await page.screenshot({ path: options.screenshotFile, fullPage: false });
        return { prompts, rawText: replyOnly, submittedAt, capturedAt: new Date().toISOString() };
      }
    }
    fs.writeFileSync(options.rawFile, `${latestRawText.slice(-16_000).trim()}\n`, "utf8");
    await page.screenshot({ path: options.screenshotFile, fullPage: false }).catch(() => {});
    throw new Error("DeepSeek 返回等待超时，未稳定提取到5段完整提示词。");
  } finally {
    await context.close().catch(() => {});
  }
}
