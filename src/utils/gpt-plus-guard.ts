import type { BrowserContext } from "playwright";
import { logWarn } from "./logger.js";

const GPT_PLUS_WEB_HOSTS = new Set(["chat.openai.com", "chatgpt.com"]);

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

export function isGptPlusWebUrl(value: string): boolean {
  const parsed = parseUrl(value);
  if (!parsed) {
    return false;
  }
  const hostname = parsed.hostname.toLowerCase();
  return [...GPT_PLUS_WEB_HOSTS].some((blocked) => hostname === blocked || hostname.endsWith(`.${blocked}`));
}

export function assertNoGptPlusWebUrl(value: string, context: string): void {
  if (isGptPlusWebUrl(value)) {
    throw new Error(
      `GPT Plus quota guard blocked ${context}: ${value}. The auto-listing flow must not use ChatGPT web/Plus message quota. Use Feishu data, the configured API providers, and Doudian.`
    );
  }
}

export function assertNoGptPlusWebPages(context: BrowserContext): void {
  const blockedPage = context.pages().find((page) => isGptPlusWebUrl(page.url()));
  if (blockedPage) {
    throw new Error(`GPT Plus quota guard found an open ChatGPT web page in the automation browser: ${blockedPage.url()}`);
  }
}

export async function installGptPlusQuotaGuard(context: BrowserContext): Promise<void> {
  assertNoGptPlusWebPages(context);
  await context.route("**/*", async (route) => {
    const url = route.request().url();
    if (isGptPlusWebUrl(url)) {
      logWarn(`GPT Plus quota guard blocked browser request: ${url}`);
      await route.abort("blockedbyclient").catch(() => {});
      return;
    }
    await route.continue().catch(() => {});
  });
}
