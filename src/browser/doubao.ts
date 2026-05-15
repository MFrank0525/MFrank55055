import type { Locator, Page } from "playwright";

export const DOUBAO_URL = "https://www.doubao.com/chat/";

export const doubaoSelectors = {
  nav: "nav",
  main: "main",
  newChat: "text=新对话",
  chatInput: 'textarea[placeholder="发消息..."]',
  fileInput: 'input[type="file"]',
  historyChatLinks: 'nav a[href^="/chat/"]',
  createImageLink: 'nav a[href="/chat/create-image"]',
  driveLink: 'nav a[href*="/chat/drive/"]',
  imageModeButton: 'button:has-text("图像生成")',
  pptModeButton: 'button:has-text("PPT 生成")',
  powerModeButton: 'button:has-text("超能模式Beta")',
  moreButton: 'button:has-text("更多")',
  inputContainer: 'div[class*="input-content-container"]',
  downloadButtons: 'button:has-text("下载"), a[download]',
  welcomeText: "text=有什么我能帮你的吗？",
  sendButtonFallback:
    'div[class*="input-content-container"] button:last-of-type, div[class*="input-content-container"] div[role="button"]:last-of-type'
} as const;

export interface DoubaoComposerState {
  url: string;
  hasInput: boolean;
  hasFileInput: boolean;
  fileAccept: string;
  fileMultiple: boolean;
  visibleToolButtons: string[];
  historyChats: string[];
}

function uniqueText(items: string[]): string[] {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
}

export async function openDoubaoChat(page: Page): Promise<void> {
  await page.goto(DOUBAO_URL, { waitUntil: "domcontentloaded" });
}

export async function waitForDoubaoWorkspace(page: Page): Promise<void> {
  await page.waitForSelector(doubaoSelectors.nav, { state: "visible" });
  await page.waitForSelector(doubaoSelectors.main, { state: "visible" });
  await page.waitForSelector(doubaoSelectors.chatInput, { state: "visible" });
}

export async function collectDoubaoComposerState(page: Page): Promise<DoubaoComposerState> {
  const fileMeta = await page.locator(doubaoSelectors.fileInput).evaluateAll((nodes) => {
    const input = nodes[0] as HTMLInputElement | undefined;
    return {
      hasFileInput: Boolean(input),
      fileAccept: input?.accept || "",
      fileMultiple: Boolean(input?.multiple)
    };
  });

  const visibleToolButtons = uniqueText(
    await page
      .locator(`${doubaoSelectors.inputContainer} button`)
      .evaluateAll((nodes) =>
        nodes
          .map((node) => (node.textContent || "").replace(/\s+/g, " ").trim())
          .filter(Boolean)
      )
  );

  const historyChats = uniqueText(
    await page
      .locator(doubaoSelectors.historyChatLinks)
      .evaluateAll((nodes) =>
        nodes
          .map((node) => (node.textContent || "").replace(/\s+/g, " ").trim())
          .filter(Boolean)
      )
  );

  return {
    url: page.url(),
    hasInput: (await page.locator(doubaoSelectors.chatInput).count()) > 0,
    hasFileInput: fileMeta.hasFileInput,
    fileAccept: fileMeta.fileAccept,
    fileMultiple: fileMeta.fileMultiple,
    visibleToolButtons,
    historyChats
  };
}

export async function clickNewChat(page: Page): Promise<void> {
  const target = page.locator(doubaoSelectors.newChat).first();
  await target.waitFor({ state: "visible" });
  await target.hover();
  await page.waitForTimeout(250 + Math.floor(Math.random() * 350));
  await target.click({ delay: 60 + Math.floor(Math.random() * 120) });
  await page.waitForTimeout(500 + Math.floor(Math.random() * 500));
}

export async function activateImageMode(page: Page): Promise<void> {
  const button = page.locator(doubaoSelectors.imageModeButton).first();
  await button.waitFor({ state: "visible" });
  await button.hover();
  await page.waitForTimeout(250 + Math.floor(Math.random() * 350));
  await button.click({ delay: 60 + Math.floor(Math.random() * 120) });
  await page.waitForTimeout(500 + Math.floor(Math.random() * 500));
}

export async function typePromptLikeUser(page: Page, prompt: string): Promise<void> {
  const input = page.locator(doubaoSelectors.chatInput).first();
  await input.waitFor({ state: "visible" });
  await input.click({ delay: 80 + Math.floor(Math.random() * 100) });
  await page.waitForTimeout(150 + Math.floor(Math.random() * 250));
  await input.pressSequentially(prompt, { delay: 40 + Math.floor(Math.random() * 40) });
}

export async function uploadFilesByInput(page: Page, filePaths: string[]): Promise<void> {
  const input = page.locator(doubaoSelectors.fileInput).first();
  await input.setInputFiles(filePaths);
  await page.waitForTimeout(800 + Math.floor(Math.random() * 700));
}

export async function resolveSendButton(page: Page): Promise<Locator> {
  const container = page.locator(doubaoSelectors.inputContainer).first();
  const buttons = container.locator("button");
  const count = await buttons.count();
  if (count > 0) {
    return buttons.nth(count - 1);
  }
  return page.locator(doubaoSelectors.sendButtonFallback).first();
}

export async function waitForResponseStart(page: Page, timeoutMs = 30000): Promise<void> {
  await page.waitForFunction(
    () => {
      const bodyText = document.body.innerText || "";
      return !bodyText.includes("有什么我能帮你的吗？");
    },
    undefined,
    { timeout: timeoutMs }
  );
}
