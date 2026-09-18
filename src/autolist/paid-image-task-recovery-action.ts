import fs from "node:fs";
import path from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";
import { resolveBrowserExecutable } from "../browser/launch.js";
import { logInfo } from "../utils/logger.js";
import { readOpenAiCompatibleImageConfig } from "./main-image-provider-action.js";
import {
  matchBilledProviderTasks,
  validatePaidImageProviderTaskForReconciliation,
  type ProviderBilledAcceptanceLogMatch,
  type ProviderTaskListEntry
} from "./paid-image-reconciliation.js";
import {
  readPaidImageSlotRecord,
  reconcileAmbiguousPaidImageTask
} from "./paid-image-submission-ledger.js";

const PROVIDER_TASK_CLOCK_SKEW_MS = 5_000;
const PROVIDER_LOGIN_POLL_MS = 5_000;
const PROVIDER_TASK_PROFILE_DIR = path.resolve("data", "auto-listing", "provider-task-recovery-browser");

function providerTaskPageUrl(apiUrl: string): string {
  const url = new URL(apiUrl);
  url.pathname = "/usage-logs/task";
  url.search = "";
  url.hash = "";
  return url.toString();
}

function providerTaskListUrl(apiUrl: string, billed: ProviderBilledAcceptanceLogMatch[]): string {
  const times = billed.map((match) => match.logCreatedAt);
  const url = new URL(apiUrl);
  url.pathname = "/api/task/self";
  url.search = "";
  url.searchParams.set("p", "1");
  url.searchParams.set("page_size", "100");
  // The provider filters by submit_time, while billing is recorded near created_at. A task can
  // legitimately spend minutes upstream before billing, so use a bounded 15-minute lookup window
  // and retain the strict five-second created_at/log match below.
  url.searchParams.set("start_timestamp", String(Math.floor(Math.min(...times) - 15 * 60)));
  url.searchParams.set("end_timestamp", String(Math.ceil(Math.max(...times) + 15 * 60)));
  return url.toString();
}

function extractProviderTasks(payload: unknown): ProviderTaskListEntry[] {
  const root = payload as { data?: unknown[] | { items?: unknown[]; data?: unknown[] } };
  if (Array.isArray(root?.data)) return root.data as ProviderTaskListEntry[];
  if (root?.data && typeof root.data === "object") {
    if (Array.isArray(root.data.items)) return root.data.items as ProviderTaskListEntry[];
    if (Array.isArray(root.data.data)) return root.data.data as ProviderTaskListEntry[];
  }
  throw new Error("provider task-list response did not contain a task array");
}

function isProviderLoginUrl(url: string): boolean {
  return /\/(?:sign-in|login)(?:[/?#]|$)/i.test(url);
}

async function captureTaskListHeaders(page: Page, taskPageUrl: string): Promise<Record<string, string>> {
  const requestPromise = page.waitForRequest(
    (request) => {
      try {
        return new URL(request.url()).pathname === "/api/task/self";
      } catch {
        return false;
      }
    },
    { timeout: 20_000 }
  );
  await page.goto(taskPageUrl, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {});
  const request = await requestPromise;
  const headers = await request.allHeaders();
  return Object.fromEntries(
    Object.entries(headers).filter(([name]) => !name.startsWith(":") && !/^(?:host|content-length)$/i.test(name))
  );
}

async function loadAuthenticatedProviderTasks(input: {
  context: BrowserContext;
  page: Page;
  taskPageUrl: string;
  taskListUrl: string;
  onProgress?: (message: string) => void;
}): Promise<ProviderTaskListEntry[]> {
  let loginNoticeAt = 0;
  for (;;) {
    if (isProviderLoginUrl(input.page.url())) {
      if (Date.now() - loginNoticeAt >= 60_000 || loginNoticeAt === 0) {
        const message = "Provider task recovery requires login; keeping the headed login page open and waiting without replaying paid submissions.";
        logInfo(message);
        input.onProgress?.(message);
        loginNoticeAt = Date.now();
      }
      await input.page.bringToFront().catch(() => {});
      await input.page.waitForTimeout(PROVIDER_LOGIN_POLL_MS);
      continue;
    }
    try {
      const headers = await captureTaskListHeaders(input.page, input.taskPageUrl);
      const response = await input.context.request.get(input.taskListUrl, { headers, timeout: 30_000 });
      if (response.status() === 401) {
        await input.page.goto(`${new URL(input.taskPageUrl).origin}/sign-in?redirect=%2Fusage-logs%2Ftask`, {
          waitUntil: "domcontentloaded",
          timeout: 30_000
        }).catch(() => {});
        continue;
      }
      if (!response.ok()) throw new Error(`provider task-list lookup failed with HTTP ${response.status()}`);
      return extractProviderTasks(await response.json());
    } catch (error) {
      if (isProviderLoginUrl(input.page.url())) continue;
      throw error;
    }
  }
}

async function verifyProviderTask(input: {
  apiUrl: string;
  apiKey: string;
  taskId: string;
  slotUpdatedAt: string;
}): Promise<{ payload: unknown; status: string }> {
  const response = await fetch(`${input.apiUrl.replace(/\/+$/, "")}/${encodeURIComponent(input.taskId)}`, {
    headers: { Authorization: `Bearer ${input.apiKey}` },
    signal: AbortSignal.timeout(180_000)
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`provider task verification failed with HTTP ${response.status}`);
  const payload = JSON.parse(text) as unknown;
  const verified = validatePaidImageProviderTaskForReconciliation({
    requestedTaskId: input.taskId,
    slotCreatedAt: input.slotUpdatedAt,
    payload
  });
  return { payload, status: verified.status };
}

export async function recoverBilledProviderTasks(input: {
  configFile: string;
  productDir: string;
  expectedSlotCount: number;
  billed: ProviderBilledAcceptanceLogMatch[];
  onProgress?: (message: string) => void;
}): Promise<number[]> {
  const config = readOpenAiCompatibleImageConfig(input.configFile);
  if (!config.apiKey) throw new Error("image provider API key is required for task recovery");
  fs.mkdirSync(PROVIDER_TASK_PROFILE_DIR, { recursive: true });
  const context = await chromium.launchPersistentContext(PROVIDER_TASK_PROFILE_DIR, {
    executablePath: resolveBrowserExecutable(),
    headless: false,
    viewport: null,
    args: ["--disable-blink-features=AutomationControlled", "--no-first-run"]
  });
  try {
    const page = context.pages()[0] || await context.newPage();
    const taskPageUrl = providerTaskPageUrl(config.apiUrl);
    if (page.url() === "about:blank") {
      await page.goto(taskPageUrl, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {});
    }
    const tasks = await loadAuthenticatedProviderTasks({
      context,
      page,
      taskPageUrl,
      taskListUrl: providerTaskListUrl(config.apiUrl, input.billed),
      onProgress: input.onProgress
    });
    const knownProviderTaskIds: string[] = [];
    for (let slot = 1; slot <= input.expectedSlotCount; slot += 1) {
      const record = readPaidImageSlotRecord({ productDir: input.productDir, slot });
      if (record?.providerTaskId) knownProviderTaskIds.push(record.providerTaskId);
    }
    const matches = matchBilledProviderTasks({
      model: config.model,
      maximumClockSkewMs: PROVIDER_TASK_CLOCK_SKEW_MS,
      billedSlots: input.billed.map((match) => {
        const record = readPaidImageSlotRecord({ productDir: input.productDir, slot: match.slot });
        if (!record || record.state !== "ambiguous") {
          throw new Error(`billed slot ${match.slot} is no longer ambiguous`);
        }
        return { slot: match.slot, promptDigest: record.promptDigest, logCreatedAt: match.logCreatedAt };
      }),
      knownProviderTaskIds,
      tasks
    });
    for (const match of matches) {
      const record = readPaidImageSlotRecord({ productDir: input.productDir, slot: match.slot });
      if (!record || record.state !== "ambiguous") throw new Error(`slot ${match.slot} changed during task recovery`);
      const verified = await verifyProviderTask({
        apiUrl: config.apiUrl,
        apiKey: config.apiKey,
        taskId: match.taskId,
        slotUpdatedAt: record.updatedAt
      });
      reconcileAmbiguousPaidImageTask({
        productDir: input.productDir,
        slot: match.slot,
        providerTaskId: match.taskId,
        reason: `automatic authenticated provider task recovery; billed_log_created_at=${match.taskCreatedAt}; clock_skew_ms=${Math.round(match.clockSkewMs)}`,
        providerResponse: verified.payload
      });
      input.onProgress?.(`Recovered billed provider task for fixed slot ${match.slot}; status=${verified.status}.`);
    }
    return matches.map((match) => match.slot).sort((left, right) => left - right);
  } finally {
    await context.close().catch(() => {});
  }
}
