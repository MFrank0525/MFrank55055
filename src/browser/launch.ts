import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { assertNoGptPlusWebUrl, installGptPlusQuotaGuard } from "../utils/gpt-plus-guard.js";
import { logInfo, logWarn } from "../utils/logger.js";
import { getFallbackUserDataDir, getUserDataDir } from "./session.js";

const REMOTE_DEBUGGING_PORTS = [9333, 9444];
let activeRemoteDebuggingPort = REMOTE_DEBUGGING_PORTS[0];
const DOUYIN_SHOP_URL = "https://fxg.jinritemai.com/ffa/g/spu-record";

const WORKSPACE_PAGE_SPECS = [
  { key: "doubao", url: "https://www.doubao.com/chat/" },
  { key: "deepseek", url: "https://chat.deepseek.com/" },
  { key: "shop", url: DOUYIN_SHOP_URL }
] as const;

export type WorkspacePageKey = (typeof WORKSPACE_PAGE_SPECS)[number]["key"];

function getBrowserCandidates(): string[] {
  const localAppData = process.env.LOCALAPPDATA || "";
  const programFiles = process.env.ProgramFiles || "";
  const programFilesX86 = process.env["ProgramFiles(x86)"] || "";

  const platformCandidates =
    process.platform === "darwin"
      ? [
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
          path.join(process.env.HOME || "", "Applications", "Google Chrome.app", "Contents", "MacOS", "Google Chrome"),
          path.join(process.env.HOME || "", "Applications", "Microsoft Edge.app", "Contents", "MacOS", "Microsoft Edge")
        ]
      : process.platform === "linux"
        ? ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"]
        : [
            path.join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
            path.join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
            path.join(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe"),
            path.join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
            path.join(localAppData, "ms-playwright", "chromium-1208", "chrome-win64", "chrome.exe")
          ];

  return [
    ...platformCandidates,
    chromium.executablePath()
  ];
}

function getBrowserExecutable(): string {
  const found = getBrowserCandidates().find((candidate) => candidate && fs.existsSync(candidate));
  if (!found) {
    throw new Error("No Chrome/Edge executable found for remote debugging browser.");
  }
  return found;
}

async function isDebugEndpointReady(port = activeRemoteDebuggingPort): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`);
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForDebugEndpoint(port = activeRemoteDebuggingPort, timeoutMs = 25000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isDebugEndpointReady(port)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Remote debugging browser did not become ready in time.");
}

async function canConnectOverCdp(port = activeRemoteDebuggingPort): Promise<boolean> {
  try {
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    await browser.close();
    return true;
  } catch {
    return false;
  }
}

async function ensureRemoteBrowser(userDataDir: string): Promise<void> {
  for (const port of REMOTE_DEBUGGING_PORTS) {
    const endpointReady = await isDebugEndpointReady(port);
    const cdpUsable = await canConnectOverCdp(port);
    if (cdpUsable) {
      activeRemoteDebuggingPort = port;
      return;
    }
    if (endpointReady) {
      logWarn(`remote debugging endpoint on port ${port} is reachable but not Playwright-compatible; trying another port`);
    }
  }

  const executable = getBrowserExecutable();
  let lastError: Error | null = null;
  for (const port of REMOTE_DEBUGGING_PORTS) {
    if (await isDebugEndpointReady(port)) {
      logWarn(`remote debugging port ${port} is already occupied by an incompatible browser; skipping launch on this port`);
      continue;
    }
    logInfo(`starting reusable browser: ${executable}`);
    const child = spawn(
      executable,
      [
        `--remote-debugging-port=${port}`,
        "--remote-debugging-address=127.0.0.1",
        `--user-data-dir=${userDataDir}`,
        "--no-first-run",
        "--disable-blink-features=AutomationControlled",
        "about:blank"
      ],
      {
        detached: true,
        stdio: "ignore",
        windowsHide: false
      }
    );
    child.unref();
    try {
      await waitForDebugEndpoint(port);
      activeRemoteDebuggingPort = port;
      return;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }
  throw lastError || new Error("Remote debugging browser did not become ready in time.");
}

async function connectBrowser(): Promise<Browser> {
  return chromium.connectOverCDP(`http://127.0.0.1:${activeRemoteDebuggingPort}`);
}

function pageMatchesWorkspace(page: Page, key: WorkspacePageKey): boolean {
  const url = page.url();
  if (key === "doubao") {
    return url.startsWith("https://www.doubao.com/chat/");
  }
  if (key === "deepseek") {
    return url.includes("chat.deepseek.com");
  }
  if (key === "shop") {
    return url.includes("fxg.jinritemai.com");
  }
  return false;
}

async function ensureWorkspacePages(context: BrowserContext): Promise<void> {
  for (const spec of WORKSPACE_PAGE_SPECS) {
    assertNoGptPlusWebUrl(spec.url, `workspace page ${spec.key}`);
    const existing = context.pages().find((item) => !item.isClosed() && pageMatchesWorkspace(item, spec.key));
    if (existing) {
      continue;
    }
    const page = await context.newPage();
    await page.goto(spec.url, { waitUntil: "domcontentloaded" }).catch(() => {});
    await page.waitForTimeout(800).catch(() => {});
  }
}

export async function getWorkspacePage(context: BrowserContext, key: WorkspacePageKey): Promise<Page> {
  const existing = context.pages().find((item) => !item.isClosed() && pageMatchesWorkspace(item, key));
  if (existing) {
    return existing;
  }

  const spec = WORKSPACE_PAGE_SPECS.find((item) => item.key === key);
  if (!spec) {
    throw new Error(`Workspace page spec not found: ${key}`);
  }

  assertNoGptPlusWebUrl(spec.url, `workspace page ${key}`);
  const page = await context.newPage();
  await page.goto(spec.url, { waitUntil: "domcontentloaded" }).catch(() => {});
  await page.waitForTimeout(800).catch(() => {});
  return page;
}

export async function launchPersistentBrowser(): Promise<BrowserContext> {
  try {
    await ensureRemoteBrowser(getUserDataDir());
  } catch (error) {
    logWarn(`primary browser profile failed, retrying fallback profile: ${(error as Error).message}`);
    await ensureRemoteBrowser(getFallbackUserDataDir());
  }

  const browser = await connectBrowser();
  const existingContext = browser.contexts()[0];
  if (existingContext) {
    await installGptPlusQuotaGuard(existingContext);
    await ensureWorkspacePages(existingContext);
    return existingContext;
  }
  const context = await browser.newContext();
  await installGptPlusQuotaGuard(context);
  await ensureWorkspacePages(context);
  return context;
}

export async function openSearchPage(context: BrowserContext, keyword: string): Promise<Page> {
  const page = context.pages().find((item) => !item.isClosed()) || (await context.newPage());
  const url = `https://www.douyin.com/search/${encodeURIComponent(keyword)}?type=general`;
  assertNoGptPlusWebUrl(url, "Douyin search page");
  logInfo(`opening ${url}`);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);
  return page;
}

export async function openSuggestionPage(context: BrowserContext): Promise<Page> {
  const page = context.pages().find((item) => !item.isClosed()) || (await context.newPage());
  const url = "https://www.douyin.com/jingxuan";
  assertNoGptPlusWebUrl(url, "Douyin suggestion page");
  logInfo(`opening ${url}`);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);
  return page;
}

export async function waitForManualInterventionIfNeeded(page: Page): Promise<void> {
  const text = await page.textContent("body");
  if (/(\u9A8C\u8BC1\u7801|\u5B89\u5168\u9A8C\u8BC1|\u62D6\u52A8\u9A8C\u8BC1|\u6ED1\u5757\u9A8C\u8BC1)/.test(text || "")) {
    logWarn("login or verification detected; complete it in the browser, then press Enter in terminal to continue.");
    process.stdin.resume();
    await new Promise<void>((resolve) => {
      process.stdin.once("data", () => resolve());
    });
  }
}

export async function closeBrowser(_context: BrowserContext): Promise<void> {
  try {
    await _context.browser()?.close();
  } catch {
    // Keep the reusable Chrome instance alive even if CDP disconnect close throws.
  }
}
