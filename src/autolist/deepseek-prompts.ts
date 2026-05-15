import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import type { Locator, Page } from "playwright";
import { sanitizeFileName } from "../doubao/paths.js";
import { launchPersistentBrowser } from "../browser/launch.js";
import type { DeepSeekArtifact } from "./types.js";
import {
  buildDeepSeekInstruction2,
  getDeepSeekConversationTitle,
  getDeepSeekInstruction1,
  getDeepSeekRetryInstruction,
  DEEPSEEK_URL
} from "./rule-text.js";

const CONVERSATION_CACHE_FILE = path.resolve(process.cwd(), "data", "auto-listing", "conversation-targets.json");

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function setClipboardText(text: string): void {
  const tempFile = path.join(os.tmpdir(), `deepseek-prompt-${Date.now()}.txt`);
  fs.writeFileSync(tempFile, text, "utf8");
  try {
    execFileSync(
      "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
      ["-NoProfile", "-Command", `[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Get-Content -Raw -Encoding UTF8 '${tempFile}' | Set-Clipboard`],
      { stdio: "ignore" }
    );
  } finally {
    fs.unlinkSync(tempFile);
  }
}

function ensureTaskDir(runtimeDir: string, taskId: string): string {
  const taskDir = path.join(runtimeDir, "tasks", sanitizeFileName(taskId));
  fs.mkdirSync(taskDir, { recursive: true });
  return taskDir;
}

function loadConversationCache(): Record<string, string> {
  if (!fs.existsSync(CONVERSATION_CACHE_FILE)) {
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(CONVERSATION_CACHE_FILE, "utf8")) as Record<string, string>;
  } catch {
    return {};
  }
}

function saveConversationCache(cache: Record<string, string>): void {
  fs.mkdirSync(path.dirname(CONVERSATION_CACHE_FILE), { recursive: true });
  fs.writeFileSync(CONVERSATION_CACHE_FILE, JSON.stringify(cache, null, 2), "utf8");
}

function buildPromptText(sellingPointText: string): string {
  return [getDeepSeekInstruction1(), sellingPointText, buildDeepSeekInstruction2()].join("\n");
}

function buildRetryPrompt(sellingPointText: string): string {
  return [getDeepSeekInstruction1(), sellingPointText, getDeepSeekRetryInstruction()].join("\n");
}

function writePromptFile(taskDir: string, sellingPointText: string): { promptFile: string; promptText: string } {
  const promptText = buildPromptText(sellingPointText);
  const promptFile = path.join(taskDir, "deepseek-poster-prompt.txt");
  fs.writeFileSync(promptFile, `${promptText}\n`, "utf8");
  return { promptFile, promptText };
}

function normalizeLine(line: string): string {
  return line.replace(/\r/g, "").trim().replace(/[，、]/g, ",").replace(/\s+/g, "").replace(/,+/g, ",").replace(/^,|,$/g, "");
}

function shouldKeepPromptLine(line: string, sellingPointText: string): boolean {
  if (!line) {
    return false;
  }
  if (line === normalizeLine(sellingPointText)) {
    return false;
  }
  if (
    line.includes(normalizeLine(getDeepSeekInstruction1())) ||
    line.includes(normalizeLine(buildDeepSeekInstruction2())) ||
    line.includes(normalizeLine(getDeepSeekRetryInstruction()))
  ) {
    return false;
  }
  if (/深度思考|联网搜索|停止生成|重新生成|本回答由AI生成|内容仅供参考|复制|分享|编辑|上传附件|切换模型|新对话|历史对话|发送给DeepSeek/.test(line)) {
    return false;
  }
  return line.split(",").filter(Boolean).length >= 4;
}

function extractPromptParagraphs(rawText: string, sellingPointText: string): string[] {
  return rawText
    .replace(/\r/g, "\n")
    .split(/\n+/)
    .map((line) => normalizeLine(line))
    .filter((line) => shouldKeepPromptLine(line, sellingPointText));
}

function normalizeFullText(text: string): string {
  return text.replace(/\r/g, "\n").split(/\n+/).map((line) => normalizeLine(line)).filter(Boolean).join("\n");
}

function sliceReplyAfterPrompt(rawText: string, promptText: string): string {
  const normalizedRaw = normalizeFullText(rawText);
  const normalizedPrompt = normalizeFullText(promptText);
  if (!normalizedPrompt) {
    return rawText;
  }
  const promptIndex = normalizedRaw.lastIndexOf(normalizedPrompt);
  if (promptIndex < 0) {
    return rawText;
  }
  return normalizedRaw.slice(promptIndex + normalizedPrompt.length);
}

function subtractKnownParagraphs(after: string[], before: string[]): string[] {
  const counts = new Map<string, number>();
  for (const item of before) {
    counts.set(item, (counts.get(item) || 0) + 1);
  }
  const delta: string[] = [];
  for (const item of after) {
    const remaining = counts.get(item) || 0;
    if (remaining > 0) {
      counts.set(item, remaining - 1);
      continue;
    }
    delta.push(item);
  }
  return delta;
}

function validatePromptParagraphs(prompts: string[]): string[] {
  if (prompts.length !== 5) {
    throw new Error(`DeepSeek must return 5 keyword paragraphs, got ${prompts.length}.`);
  }
  const normalized = prompts.map((item) => normalizeLine(item)).filter(Boolean);
  if (new Set(normalized).size !== 5) {
    throw new Error("DeepSeek must return 5 distinct keyword paragraphs.");
  }
  for (const prompt of normalized) {
    if (prompt.split(",").filter(Boolean).length < 4) {
      throw new Error(`DeepSeek paragraph was not keyword-like enough: ${prompt}`);
    }
  }
  return normalized;
}

function buildSimulatedArtifact(taskDir: string, sellingPointText: string): DeepSeekArtifact {
  const { promptFile } = writePromptFile(taskDir, sellingPointText);
  const rawFile = path.join(taskDir, "deepseek-raw.txt");
  const extractedFile = path.join(taskDir, "deepseek-extracted.txt");
  const screenshotFile = path.join(taskDir, "deepseek.png");
  const prompts = [
    "医疗实验室,蓝白色调,产品居中,显微结构元素,专业器械质感,关节护理图示",
    "健康护理场景,生物制造背景,产品特写,人群关怀,使用步骤图标,科技感光效",
    "医学科技空间,冷色渐变,产品悬浮,部位示意图,成分粒子,专业海报排版",
    "康复护理场景,临床洁净背景,使用方法演示,人群呼应,器械认证元素,电商主图构图",
    "生物制造车间,医疗蓝光,产品主体强化,适用人群暗示,步骤提示,品牌水印预留"
  ];
  fs.writeFileSync(rawFile, `${prompts.join("\n")}\n`, "utf8");
  fs.writeFileSync(extractedFile, `${prompts.join("\n")}\n`, "utf8");
  return { promptFile, rawFile, extractedFile, screenshotFile, prompts, simulated: true };
}

async function getDeepSeekPage(): Promise<Page> {
  const context = await launchPersistentBrowser();
  const existingPages = context.pages().filter((item) => !item.isClosed());
  const page =
    existingPages.find((item) => item.url().startsWith(DEEPSEEK_URL)) ||
    existingPages.find((item) => item.url().includes("chat.deepseek.com")) ||
    existingPages[0] ||
    (await context.newPage());
  await page.bringToFront();
  if (!page.url().includes("chat.deepseek.com")) {
    await page.goto(DEEPSEEK_URL, { waitUntil: "domcontentloaded" });
    await sleep(2500);
  } else {
    await page.waitForLoadState("domcontentloaded");
    await sleep(1000);
  }
  return page;
}

async function openHistorySidebar(page: Page): Promise<void> {
  const toggles = [
    page.locator('button:has-text("历史对话")').first(),
    page.locator('button:has-text("历史")').first(),
    page.locator('button:has-text("对话")').first(),
    page.locator('[role="button"][aria-label*="历史"]').first(),
    page.locator('[role="button"][aria-label*="会话"]').first()
  ];
  for (const toggle of toggles) {
    if ((await toggle.count().catch(() => 0)) === 0) {
      continue;
    }
    if (!(await toggle.isVisible().catch(() => false))) {
      continue;
    }
    await toggle.click({ delay: 80 }).catch(() => {});
    await sleep(1000);
    return;
  }
}

async function resolveConversationHref(page: Page): Promise<string | null> {
  const conversationTitle = getDeepSeekConversationTitle();
  await openHistorySidebar(page);
  const anchors = page.locator("a[href]");
  const count = await anchors.count().catch(() => 0);
  for (let index = 0; index < count; index += 1) {
    const anchor = anchors.nth(index);
    const text = ((await anchor.innerText().catch(() => "")) || "").trim();
    const href = (await anchor.getAttribute("href").catch(() => null)) || "";
    if (!text.includes(conversationTitle) || !href) {
      continue;
    }
    if (href.startsWith("http")) {
      return href;
    }
    if (href.startsWith("/")) {
      return `https://chat.deepseek.com${href}`;
    }
  }
  return null;
}

async function ensureDeepSeekConversationWithUrl(page: Page, preferredUrl: string): Promise<void> {
  const conversationTitle = getDeepSeekConversationTitle();
  const cache = loadConversationCache();
  const currentTitle = await page.title().catch(() => "");
  const currentUrl = page.url();
  if (currentTitle.includes(conversationTitle) && /\/a\/chat\/s\//.test(currentUrl)) {
    if (cache.deepseek !== currentUrl) {
      cache.deepseek = currentUrl;
      saveConversationCache(cache);
    }
    return;
  }

  const cachedHref = preferredUrl || cache.deepseek;
  if (cachedHref) {
    await page.goto(cachedHref, { waitUntil: "domcontentloaded" }).catch(() => {});
    await sleep(1800);
    const titleAfterGoto = await page.title().catch(() => "");
    if (page.url().startsWith(cachedHref) && titleAfterGoto.includes(conversationTitle)) {
      if (preferredUrl && cache.deepseek !== preferredUrl) {
        cache.deepseek = preferredUrl;
        saveConversationCache(cache);
      }
      return;
    }
  }

  await page.goto(DEEPSEEK_URL, { waitUntil: "domcontentloaded" }).catch(() => {});
  await sleep(1800);
  const href = await resolveConversationHref(page);
  if (!href) {
    throw new Error(`DeepSeek specified conversation not found: ${conversationTitle}`);
  }
  cache.deepseek = href;
  saveConversationCache(cache);
  await page.goto(href, { waitUntil: "domcontentloaded" }).catch(() => {});
  await sleep(1800);

  const finalTitle = await page.title().catch(() => "");
  if (!page.url().startsWith(href) || !finalTitle.includes(conversationTitle)) {
    throw new Error(`DeepSeek did not enter the specified conversation: ${conversationTitle}`);
  }
}

async function findPromptInput(page: Page): Promise<Locator> {
  const candidates = [page.locator("textarea").first(), page.locator('div[contenteditable="true"]').first()];
  for (const locator of candidates) {
    if ((await locator.count().catch(() => 0)) === 0) {
      continue;
    }
    await locator.waitFor({ state: "visible", timeout: 20000 });
    return locator;
  }
  throw new Error("DeepSeek input not found.");
}

async function writeWholePrompt(input: Locator, promptText: string, page: Page): Promise<void> {
  await input.click();
  await page.keyboard.press("Control+A").catch(() => {});
  await page.keyboard.press("Backspace").catch(() => {});
  const tagName = await input.evaluate((node) => node.tagName.toLowerCase()).catch(() => "");
  if (tagName === "textarea") {
    await input.fill(promptText).catch(async () => {
      setClipboardText(promptText);
      await page.keyboard.press("Control+V");
    });
  } else {
    await input
      .evaluate((node, value) => {
        const el = node as HTMLElement;
        el.focus();
        el.textContent = value;
        el.dispatchEvent(new InputEvent("input", { bubbles: true, data: value, inputType: "insertText" }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }, promptText)
      .catch(async () => {
        setClipboardText(promptText);
        await page.keyboard.press("Control+V");
      });
  }
  await sleep(500);
}

async function submitOnExistingConversation(
  page: Page,
  promptText: string,
  screenshotFile: string,
  rawFile: string
): Promise<{ submittedAt: string; capturedAt: string }> {
  const input = await findPromptInput(page);
  await writeWholePrompt(input, promptText, page);
  const submittedAt = new Date().toISOString();

  let sendButton: Locator = page.locator('button[type="submit"]').first();
  if ((await sendButton.count().catch(() => 0)) === 0) {
    sendButton = page.locator('button:has-text("发送")').first();
  }
  if ((await sendButton.count().catch(() => 0)) === 0) {
    sendButton = page.locator('button:has-text("Send")').first();
  }

  if ((await sendButton.count().catch(() => 0)) > 0 && (await sendButton.isVisible().catch(() => false))) {
    await sendButton.click({ delay: 80 }).catch(async () => {
      await page.keyboard.press("Enter");
    });
  } else {
    await page.keyboard.press("Enter");
  }

  await sleep(18000);
  const bodyText = await page.locator("body").innerText().catch(() => "");
  fs.writeFileSync(rawFile, bodyText, "utf8");
  await page.screenshot({ path: screenshotFile, fullPage: true });
  return { submittedAt, capturedAt: new Date().toISOString() };
}

function readTextFile(filePath: string): string {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
}

function extractNewPromptParagraphs(beforeRaw: string, afterRaw: string, sellingPointText: string, promptText: string): string[] {
  const beforeParagraphs = extractPromptParagraphs(beforeRaw, sellingPointText);
  const afterReplyOnly = sliceReplyAfterPrompt(afterRaw, promptText);
  const afterParagraphs = extractPromptParagraphs(afterReplyOnly, sellingPointText);
  return subtractKnownParagraphs(afterParagraphs, beforeParagraphs);
}

export async function generatePosterPromptsWithDeepSeek(options: {
  runtimeDir: string;
  taskId: string;
  sellingPointText: string;
  conversationUrl?: string;
  simulateOnly: boolean;
}): Promise<DeepSeekArtifact> {
  const taskDir = ensureTaskDir(options.runtimeDir, options.taskId);
  if (options.simulateOnly) {
    return buildSimulatedArtifact(taskDir, options.sellingPointText);
  }

  const page = await getDeepSeekPage();
  await ensureDeepSeekConversationWithUrl(page, options.conversationUrl || "");

  const { promptFile, promptText } = writePromptFile(taskDir, options.sellingPointText);
  const rawFile = path.join(taskDir, "deepseek-raw.txt");
  const extractedFile = path.join(taskDir, "deepseek-extracted.txt");
  const screenshotFile = path.join(taskDir, "deepseek.png");
  const beforeRawFile = path.join(taskDir, "deepseek-before-raw.txt");
  const beforeRaw = await page.locator("body").innerText().catch(() => "");
  fs.writeFileSync(beforeRawFile, beforeRaw, "utf8");

  let timing = await submitOnExistingConversation(page, promptText, screenshotFile, rawFile);
  let extracted = extractNewPromptParagraphs(beforeRaw, readTextFile(rawFile), options.sellingPointText, promptText);

  if (extracted.length < 5) {
    const retryPromptText = buildRetryPrompt(options.sellingPointText);
    const retryPromptFile = path.join(taskDir, "deepseek-poster-retry-prompt.txt");
    const retryRawFile = path.join(taskDir, "deepseek-retry-raw.txt");
    const retryScreenshotFile = path.join(taskDir, "deepseek-retry.png");
    const retryBeforeRawFile = path.join(taskDir, "deepseek-retry-before-raw.txt");
    const retryBeforeRaw = await page.locator("body").innerText().catch(() => "");
    fs.writeFileSync(retryPromptFile, `${retryPromptText}\n`, "utf8");
    fs.writeFileSync(retryBeforeRawFile, retryBeforeRaw, "utf8");
    timing = await submitOnExistingConversation(page, retryPromptText, retryScreenshotFile, retryRawFile);
    extracted = extractNewPromptParagraphs(retryBeforeRaw, readTextFile(retryRawFile), options.sellingPointText, retryPromptText);
  }

  const prompts = validatePromptParagraphs(extracted);
  fs.writeFileSync(extractedFile, `${prompts.join("\n")}\n`, "utf8");
  return {
    promptFile,
    rawFile,
    extractedFile,
    screenshotFile,
    prompts,
    submittedAt: timing.submittedAt,
    capturedAt: timing.capturedAt,
    simulated: false
  };
}
