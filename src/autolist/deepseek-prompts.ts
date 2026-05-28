import fs from "node:fs";
import path from "node:path";
import type { Locator, Page } from "playwright";
import { sanitizeFileName } from "../doubao/paths.js";
import { closeBrowser, launchPersistentBrowser } from "../browser/launch.js";
import { setClipboardText } from "../utils/clipboard.js";
import { getPasteShortcut, getSelectAllShortcut } from "../utils/platform.js";
import type { DeepSeekArtifact } from "./types.js";
import {
  buildDeepSeekInstruction2,
  getDeepSeekConversationTitle,
  getDeepSeekInstruction1,
  getDeepSeekRetryInstruction,
  DEEPSEEK_URL
} from "./rule-text.js";
import {
  assertDeepSeekPromptsBelongToCurrentProduct,
  buildDeepSeekPromptValidationContext,
  resolveDeepSeekPromptRetryPolicy,
  selectDeepSeekLatestReplyPromptBlock,
  shouldRetryDeepSeekPromptSubmission,
  type DeepSeekPromptValidationContext
} from "./deepseek-prompt-rules.js";

const CONVERSATION_CACHE_FILE = path.resolve(process.cwd(), "data", "auto-listing", "conversation-targets.json");

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function buildPromptText(sellingPointText: string, promptCount: number): string {
  return [
    getDeepSeekInstruction1(),
    sellingPointText,
    buildDeepSeekInstruction2(),
    `本次只输出${promptCount}款不同的电商海报关键词段落。`
  ].join("\n");
}

function buildRetryPrompt(sellingPointText: string, promptCount: number, productFocusText = ""): string {
  return [
    getDeepSeekInstruction1(),
    sellingPointText,
    productFocusText ? `本次必须只围绕当前商品生成提示词：${productFocusText}` : "",
    getDeepSeekRetryInstruction(),
    `本次只补充输出${promptCount}款不同的电商海报关键词段落。`
  ].filter(Boolean).join("\n");
}

function writePromptFile(taskDir: string, sellingPointText: string, promptCount: number): { promptFile: string; promptText: string } {
  const promptText = buildPromptText(sellingPointText, promptCount);
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

function collectLatestPromptBlock(candidates: string[], promptCount: number): string[] {
  if (candidates.length < promptCount) {
    return [];
  }
  return candidates.slice(-promptCount);
}

function validatePromptParagraphs(
  prompts: string[],
  promptCount: number,
  validationContext?: DeepSeekPromptValidationContext
): string[] {
  if (prompts.length !== promptCount) {
    throw new Error(`DeepSeek must return ${promptCount} keyword paragraphs, got ${prompts.length}.`);
  }
  const normalized = prompts.map((item) => normalizeLine(item)).filter(Boolean);
  if (new Set(normalized).size !== promptCount) {
    throw new Error(`DeepSeek must return ${promptCount} distinct keyword paragraphs.`);
  }
  for (const prompt of normalized) {
    if (prompt.split(",").filter(Boolean).length < 4) {
      throw new Error(`DeepSeek paragraph was not keyword-like enough: ${prompt}`);
    }
  }
  if (validationContext) {
    assertDeepSeekPromptsBelongToCurrentProduct(normalized, validationContext, promptCount);
  }
  return normalized;
}

function buildSimulatedArtifact(
  taskDir: string,
  sellingPointText: string,
  promptCount: number,
  validationContext: DeepSeekPromptValidationContext
): DeepSeekArtifact {
  const { promptFile } = writePromptFile(taskDir, sellingPointText, promptCount);
  const rawFile = path.join(taskDir, "deepseek-raw.txt");
  const extractedFile = path.join(taskDir, "deepseek-extracted.txt");
  const screenshotFile = path.join(taskDir, "deepseek.png");
  const anchor = validationContext.strongAnchors[0] || validationContext.anchors[0] || "当前商品";
  const prompts = [
    `${anchor}护理场景,蓝白色调,产品居中,核心卖点标签,专业器械质感,电商主图构图`,
    `${anchor}产品特写,洁净台面背景,使用步骤图标,水润高光层次,正品防伪标签,科技感光效`,
    `${anchor}医学科技空间,冷色渐变,产品悬浮展示,成分粒子轨迹,专业海报排版,品牌水印预留`,
    `${anchor}日常护理场景,临床洁净背景,产品包装前景,材质纹理细节,安全承诺图标,主图视觉中心`,
    `${anchor}主题海报,医疗蓝白光效,产品主体强化,卖点符号化呈现,步骤提示卡片,高转化电商排版`
  ];
  const selectedPrompts = prompts.slice(0, promptCount);
  fs.writeFileSync(rawFile, `${selectedPrompts.join("\n")}\n`, "utf8");
  fs.writeFileSync(extractedFile, `${selectedPrompts.join("\n")}\n`, "utf8");
  return { promptFile, rawFile, extractedFile, screenshotFile, prompts: selectedPrompts, simulated: true };
}

function buildExistingArtifactFromRaw(
  taskDir: string,
  sellingPointText: string,
  promptCount: number,
  validationContext: DeepSeekPromptValidationContext
): DeepSeekArtifact | undefined {
  const rawCandidates = [
    { rawFile: path.join(taskDir, "deepseek-retry-2-raw.txt"), screenshotFile: path.join(taskDir, "deepseek-retry-2.png") },
    { rawFile: path.join(taskDir, "deepseek-retry-1-raw.txt"), screenshotFile: path.join(taskDir, "deepseek-retry-1.png") },
    { rawFile: path.join(taskDir, "deepseek-retry-raw.txt"), screenshotFile: path.join(taskDir, "deepseek-retry.png") },
    { rawFile: path.join(taskDir, "deepseek-raw.txt"), screenshotFile: path.join(taskDir, "deepseek.png") }
  ];

  for (const candidate of rawCandidates) {
    if (!fs.existsSync(candidate.rawFile)) {
      continue;
    }
    const rawText = fs.readFileSync(candidate.rawFile, "utf8");
    let prompts: string[];
    try {
      prompts = validatePromptParagraphs(
        selectDeepSeekLatestReplyPromptBlock(extractPromptParagraphs(rawText, sellingPointText), promptCount),
        promptCount,
        validationContext
      );
    } catch {
      continue;
    }
    const { promptFile } = writePromptFile(taskDir, sellingPointText, promptCount);
    const extractedFile = path.join(taskDir, "deepseek-extracted.txt");
    fs.writeFileSync(extractedFile, `${prompts.join("\n")}\n`, "utf8");
    return {
      promptFile,
      rawFile: candidate.rawFile,
      extractedFile,
      screenshotFile: candidate.screenshotFile,
      prompts,
      simulated: false
    };
  }

  return undefined;
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

async function closeDeepSeekConnection(page: Page): Promise<void> {
  const context = page.context();
  await closeBrowser(context);
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
    const inputCount = await page.locator("textarea, div[contenteditable='true']").count().catch(() => 0);
    if (preferredUrl && /\/a\/chat\/s\//.test(page.url()) && inputCount > 0) {
      if (cache.deepseek !== preferredUrl) {
        cache.deepseek = preferredUrl;
        saveConversationCache(cache);
      }
      return;
    }
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
  await page.keyboard.press(getSelectAllShortcut()).catch(() => {});
  await page.keyboard.press("Backspace").catch(() => {});
  const tagName = await input.evaluate((node) => node.tagName.toLowerCase()).catch(() => "");
  if (tagName === "textarea") {
    await input.fill(promptText).catch(async () => {
      setClipboardText(promptText);
      await page.keyboard.press(getPasteShortcut());
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
        await page.keyboard.press(getPasteShortcut());
      });
  }
  await sleep(500);
}

async function submitOnExistingConversation(
  page: Page,
  promptText: string,
  screenshotFile: string,
  rawFile: string
): Promise<{ submittedAt: string; capturedAt: string; rawText: string }> {
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
  const replyText = sliceReplyAfterPrompt(bodyText, promptText).slice(-12000);
  fs.writeFileSync(rawFile, replyText, "utf8");
  await page.screenshot({ path: screenshotFile, fullPage: false });
  return { submittedAt, capturedAt: new Date().toISOString(), rawText: bodyText };
}

function extractNewPromptParagraphs(
  beforeRaw: string,
  afterRaw: string,
  sellingPointText: string,
  promptText: string,
  promptCount: number
): string[] {
  const beforeParagraphs = extractPromptParagraphs(beforeRaw, sellingPointText);
  const afterReplyOnly = sliceReplyAfterPrompt(afterRaw, promptText);
  const afterParagraphs = extractPromptParagraphs(afterReplyOnly, sellingPointText);
  if (afterParagraphs.length > 0) {
    return selectDeepSeekLatestReplyPromptBlock(afterParagraphs, promptCount);
  }
  const delta = subtractKnownParagraphs(afterParagraphs, beforeParagraphs);
  if (delta.length > 0) {
    return delta;
  }
  return collectLatestPromptBlock(afterParagraphs, promptCount);
}

export async function generatePosterPromptsWithDeepSeek(options: {
  runtimeDir: string;
  taskId: string;
  sellingPointText: string;
  userCognitionName?: string;
  brandedGenericName?: string;
  genericName?: string;
  conversationUrl?: string;
  promptCount: number;
  simulateOnly: boolean;
}): Promise<DeepSeekArtifact> {
  const taskDir = ensureTaskDir(options.runtimeDir, options.taskId);
  const validationContext = buildDeepSeekPromptValidationContext({
    sellingPointText: options.sellingPointText,
    userCognitionName: options.userCognitionName,
    brandedGenericName: options.brandedGenericName,
    genericName: options.genericName
  });
  if (options.simulateOnly) {
    return buildSimulatedArtifact(taskDir, options.sellingPointText, options.promptCount, validationContext);
  }
  const existingArtifact = buildExistingArtifactFromRaw(
    taskDir,
    options.sellingPointText,
    options.promptCount,
    validationContext
  );
  if (existingArtifact) {
    return existingArtifact;
  }

  const page = await getDeepSeekPage();
  try {
    await ensureDeepSeekConversationWithUrl(page, options.conversationUrl || "");

    const { promptFile, promptText } = writePromptFile(taskDir, options.sellingPointText, options.promptCount);
    const rawFile = path.join(taskDir, "deepseek-raw.txt");
    const extractedFile = path.join(taskDir, "deepseek-extracted.txt");
    const screenshotFile = path.join(taskDir, "deepseek.png");
    const beforeRawFile = path.join(taskDir, "deepseek-before-raw.txt");
    const beforeRaw = await page.locator("body").innerText().catch(() => "");
    fs.writeFileSync(beforeRawFile, `${extractPromptParagraphs(beforeRaw, options.sellingPointText).join("\n")}\n`, "utf8");

    let timing: { submittedAt: string; capturedAt: string; rawText: string } | undefined;
    let prompts: string[] | undefined;
    let selectedRawFile = rawFile;
    let selectedScreenshotFile = screenshotFile;
    const productFocusText = [
      validationContext.userCognitionName,
      validationContext.brandedGenericName,
      validationContext.genericName
    ].filter(Boolean).join(" / ");
    const retryPolicy = resolveDeepSeekPromptRetryPolicy();
    const errors: string[] = [];

    for (let attempt = 1; attempt <= retryPolicy.maxAttempts; attempt += 1) {
      const attemptPromptText =
        attempt === 1 ? promptText : buildRetryPrompt(options.sellingPointText, options.promptCount, productFocusText);
      const attemptPromptFile =
        attempt === 1 ? promptFile : path.join(taskDir, `deepseek-poster-retry-${attempt - 1}-prompt.txt`);
      const attemptRawFile = attempt === 1 ? rawFile : path.join(taskDir, `deepseek-retry-${attempt - 1}-raw.txt`);
      const attemptScreenshotFile =
        attempt === 1 ? screenshotFile : path.join(taskDir, `deepseek-retry-${attempt - 1}.png`);
      const attemptBeforeRawFile =
        attempt === 1 ? beforeRawFile : path.join(taskDir, `deepseek-retry-${attempt - 1}-before-raw.txt`);
      const attemptBeforeRaw = attempt === 1 ? beforeRaw : await page.locator("body").innerText().catch(() => "");
      fs.writeFileSync(attemptPromptFile, `${attemptPromptText}\n`, "utf8");
      fs.writeFileSync(
        attemptBeforeRawFile,
        `${extractPromptParagraphs(attemptBeforeRaw, options.sellingPointText).join("\n")}\n`,
        "utf8"
      );
      timing = await submitOnExistingConversation(page, attemptPromptText, attemptScreenshotFile, attemptRawFile);
      const extracted = extractNewPromptParagraphs(
        attemptBeforeRaw,
        timing.rawText,
        options.sellingPointText,
        attemptPromptText,
        options.promptCount
      );
      if (shouldRetryDeepSeekPromptSubmission({ extractedPromptCount: extracted.length })) {
        errors.push(`attempt ${attempt}: DeepSeek returned no extractable latest prompt paragraphs.`);
        continue;
      }
      try {
        prompts = validatePromptParagraphs(
          extracted.slice(0, options.promptCount),
          options.promptCount,
          validationContext
        );
        selectedRawFile = attemptRawFile;
        selectedScreenshotFile = attemptScreenshotFile;
        break;
      } catch (error) {
        throw new Error(
          `DeepSeek returned latest content but it is not usable for the current product. ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }

    if (!prompts || !timing) {
      throw new Error(
        `DeepSeek did not return latest poster prompt content after ${retryPolicy.maxAttempts} attempt(s). ${errors.join(" | ")}`
      );
    }
    fs.writeFileSync(extractedFile, `${prompts.join("\n")}\n`, "utf8");
    return {
      promptFile,
      rawFile: selectedRawFile,
      extractedFile,
      screenshotFile: selectedScreenshotFile,
      prompts,
      submittedAt: timing.submittedAt,
      capturedAt: timing.capturedAt,
      simulated: false
    };
  } finally {
    await closeDeepSeekConnection(page);
  }
}
