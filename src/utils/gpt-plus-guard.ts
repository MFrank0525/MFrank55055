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

async function quarantineGptPlusWebPages(context: BrowserContext): Promise<void> {
  const blockedPages = context.pages().filter((page) => !page.isClosed() && isGptPlusWebUrl(page.url()));
  for (const page of blockedPages) {
    const url = page.url();
    logWarn(`GPT Plus quota guard closing disallowed automation-browser page: ${url}`);
    await page.close({ runBeforeUnload: false }).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`GPT Plus quota guard could not quarantine ${url}: ${message}`);
    });
  }
  assertNoGptPlusWebPages(context);
}

export async function installGptPlusQuotaGuard(context: BrowserContext): Promise<void> {
  await context.route("**/*", async (route) => {
    const url = route.request().url();
    if (isGptPlusWebUrl(url)) {
      logWarn(`GPT Plus quota guard blocked browser request: ${url}`);
      await route.abort("blockedbyclient").catch(() => {});
      try {
        const page = route.request().frame().page();
        if (!page.isClosed()) {
          await page.close({ runBeforeUnload: false }).catch(() => {});
        }
      } catch {
        // Service-worker and detached-frame requests do not always expose a page.
      }
      return;
    }
    await route.continue().catch(() => {});
  });
  await quarantineGptPlusWebPages(context);
}
