import { type Page } from "playwright";
import { launchPersistentBrowser } from "../browser/launch.js";
import { readOpenAiCompatibleImageConfig } from "./main-image-provider-action.js";
import {
  matchBilledProviderTasks,
  matchProviderTaskListAcceptanceGap,
  matchProviderTaskListTerminalFailureGap,
  matchProviderTaskListNoAcceptanceGap,
  validatePaidImageFailedProviderTaskForReconciliation,
  validatePaidImageProviderTaskForReconciliation,
  type ProviderBilledAcceptanceLogMatch,
  type ProviderTaskListEntry
} from "./paid-image-reconciliation.js";
import {
  readPaidImageSlotRecord,
  recordPaidImageFailedBeforeAcceptance,
  recordPaidImageFailedAfterAcceptance,
  reconcileAmbiguousPaidImageNoAcceptance,
  reconcileAmbiguousPaidImageTask
} from "./paid-image-submission-ledger.js";

const PROVIDER_TASK_CLOCK_SKEW_MS = 5_000;
const PROVIDER_TASK_GAP_LOOKBACK_SECONDS = 60;
const PROVIDER_TASK_GAP_POST_RESPONSE_SECONDS = 5 * 60;

export function isProviderTaskLoginRequiredError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /provider_task_login_required:/i.test(message);
}

function providerTaskBrowserPage(context: Awaited<ReturnType<typeof launchPersistentBrowser>>, apiUrl: string): Promise<Page> | Page {
  const origin = new URL(apiUrl).origin;
  return context.pages().find((page) => !page.isClosed() && page.url().startsWith(origin)) || context.newPage();
}

function processIsProvablyDead(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH";
  }
}

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

function extractProviderTaskPage(payload: unknown): {
  tasks: ProviderTaskListEntry[]; page: number; pageSize: number; total: number;
} {
  const root = payload as { data?: unknown[] | { items?: unknown[]; data?: unknown[] } };
  if (Array.isArray(root?.data)) {
    return { tasks: root.data as ProviderTaskListEntry[], page: 1, pageSize: root.data.length + 1, total: root.data.length };
  }
  if (root?.data && typeof root.data === "object") {
    const pageRoot = root.data as { items?: unknown[]; data?: unknown[]; page?: unknown; page_size?: unknown; total?: unknown };
    const tasks = Array.isArray(pageRoot.items)
      ? pageRoot.items as ProviderTaskListEntry[]
      : Array.isArray(pageRoot.data)
        ? pageRoot.data as ProviderTaskListEntry[]
        : undefined;
    if (tasks) {
      return {
        tasks,
        page: Number(pageRoot.page),
        pageSize: Number(pageRoot.page_size),
        total: Number(pageRoot.total)
      };
    }
  }
  throw new Error("provider task-list response did not contain a task array");
}

async function loadAuthenticatedProviderTasks(input: {
  page: Page;
  taskPageUrl: string;
  taskListUrl: string;
  onProgress?: (message: string) => void;
}): Promise<{ tasks: ProviderTaskListEntry[]; page: number; pageSize: number; total: number }> {
  await input.page.goto(input.taskPageUrl, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {});
  const refreshUrl = `${new URL(input.taskPageUrl).origin}/api/user/auth/refresh`;
  const result = await input.page.evaluate(async ({ refreshUrl, taskListUrl }) => {
    const refreshResponse = await fetch(refreshUrl, { method: "POST", credentials: "include" });
    const refreshText = await refreshResponse.text();
    let refreshPayload: { data?: { access_token?: unknown }; message?: unknown; code?: unknown } = {};
    try {
      refreshPayload = JSON.parse(refreshText) as typeof refreshPayload;
    } catch {
      return { refreshStatus: refreshResponse.status, refreshParseFailed: true, taskStatus: 0, taskText: "" };
    }
    const accessToken = typeof refreshPayload.data?.access_token === "string"
      ? refreshPayload.data.access_token.trim()
      : "";
    if (!refreshResponse.ok || !accessToken) {
      return {
        refreshStatus: refreshResponse.status,
        refreshCode: String(refreshPayload.code || ""),
        refreshMessage: String(refreshPayload.message || ""),
        taskStatus: 0,
        taskText: ""
      };
    }
    const taskResponse = await fetch(taskListUrl, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    return {
      refreshStatus: refreshResponse.status,
      taskStatus: taskResponse.status,
      taskText: await taskResponse.text()
    };
  }, { refreshUrl, taskListUrl: input.taskListUrl });
  if (result.refreshStatus === 401 || result.refreshStatus === 403 || result.taskStatus === 401) {
    await input.page.goto(`${new URL(input.taskPageUrl).origin}/sign-in?redirect=%2Fusage-logs%2Ftask`, {
      waitUntil: "domcontentloaded", timeout: 30_000
    }).catch(() => {});
    await input.page.bringToFront().catch(() => {});
    throw new Error("provider_task_login_required: provider refresh session is unavailable or expired");
  }
  if (result.refreshStatus !== 200) {
    throw new Error(`provider task auth refresh failed with HTTP ${result.refreshStatus}`);
  }
  if (result.taskStatus !== 200) {
    throw new Error(`provider task-list lookup failed with HTTP ${result.taskStatus}`);
  }
  let payload: unknown;
  try {
    payload = JSON.parse(result.taskText);
  } catch {
    throw new Error("provider task-list lookup returned a non-JSON response");
  }
  input.onProgress?.("Provider task-list authentication refreshed through the canonical project browser session.");
  return extractProviderTaskPage(payload);
}

async function verifyProviderTask(input: {
  apiUrl: string;
  apiKey: string;
  taskId: string;
  slotUpdatedAt: string;
  expectedTerminalFailure?: boolean;
}): Promise<{ payload: unknown; status: string }> {
  const response = await fetch(`${input.apiUrl.replace(/\/+$/, "")}/${encodeURIComponent(input.taskId)}`, {
    headers: { Authorization: `Bearer ${input.apiKey}` },
    signal: AbortSignal.timeout(180_000)
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`provider task verification failed with HTTP ${response.status}`);
  const payload = JSON.parse(text) as unknown;
  const verified = (input.expectedTerminalFailure
    ? validatePaidImageFailedProviderTaskForReconciliation
    : validatePaidImageProviderTaskForReconciliation)({
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
  const context = await launchPersistentBrowser();
  const page = await providerTaskBrowserPage(context, config.apiUrl);
  let keepPageOpenForLogin = false;
  try {
    const taskPageUrl = providerTaskPageUrl(config.apiUrl);
    const taskPage = await loadAuthenticatedProviderTasks({
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
      tasks: taskPage.tasks
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
  } catch (error) {
    keepPageOpenForLogin = isProviderTaskLoginRequiredError(error);
    throw error;
  } finally {
    if (!keepPageOpenForLogin) await page.close().catch(() => {});
  }
}

export async function recoverProviderTaskListAcceptanceGap(input: {
  configFile: string;
  productDir: string;
  expectedSlotCount: number;
  onProgress?: (message: string) => void;
}): Promise<{ kind: "task_recovered" | "no_acceptance"; slots: number[] }> {
  const ambiguousRecords = Array.from({ length: input.expectedSlotCount }, (_, index) => index + 1).flatMap((slot) => {
    const record = readPaidImageSlotRecord({ productDir: input.productDir, slot });
    return record?.state === "ambiguous" ? [{ slot, record }] : [];
  });
  if (ambiguousRecords.length !== 1) {
    throw new Error(`authenticated provider task-list gap requires exactly one ambiguous slot; found ${ambiguousRecords.length}`);
  }
  const { slot, record } = ambiguousRecords[0];
  const lastReservedAt = [...record.audit].reverse().find((entry) => entry.state === "reserved")?.at || "";
  const reservedAtSeconds = Date.parse(lastReservedAt) / 1000;
  const responseAtSeconds = Date.parse(record.updatedAt) / 1000;
  if (!Number.isFinite(reservedAtSeconds) || !Number.isFinite(responseAtSeconds)) {
    throw new Error(`ambiguous slot ${slot} lacks a valid paid submission window`);
  }
  const windowStart = Math.floor(reservedAtSeconds - PROVIDER_TASK_GAP_LOOKBACK_SECONDS);
  const windowEnd = Math.ceil(responseAtSeconds + PROVIDER_TASK_GAP_POST_RESPONSE_SECONDS);
  const knownProviderTaskIds = Array.from({ length: input.expectedSlotCount }, (_, index) => index + 1).flatMap((knownSlot) => {
    const knownRecord = readPaidImageSlotRecord({ productDir: input.productDir, slot: knownSlot });
    if (!knownRecord?.providerTaskId) return [];
    const submittedInWindow = knownRecord.audit.some((entry) => {
      const at = Date.parse(entry.at || "") / 1000;
      return entry.state === "submitted" && at >= windowStart && at <= windowEnd;
    });
    return submittedInWindow ? [knownRecord.providerTaskId] : [];
  });
  const config = readOpenAiCompatibleImageConfig(input.configFile);
  if (!config.apiKey) throw new Error("image provider API key is required for task-list gap recovery");
  const context = await launchPersistentBrowser();
  const page = await providerTaskBrowserPage(context, config.apiUrl);
  let keepPageOpenForLogin = false;
  try {
    const taskPageUrl = providerTaskPageUrl(config.apiUrl);
    const taskListUrl = new URL(config.apiUrl);
    taskListUrl.pathname = "/api/task/self";
    taskListUrl.search = "";
    taskListUrl.searchParams.set("p", "1");
    taskListUrl.searchParams.set("page_size", "100");
    taskListUrl.searchParams.set("start_timestamp", String(windowStart));
    taskListUrl.searchParams.set("end_timestamp", String(windowEnd));
    const taskPage = await loadAuthenticatedProviderTasks({
      page, taskPageUrl, taskListUrl: taskListUrl.toString(), onProgress: input.onProgress
    });
    const gapEvidence = {
      model: config.model,
      ambiguousSlot: slot,
      queryPage: taskPage.page,
      queryPageSize: taskPage.pageSize,
      queryTotal: taskPage.total,
      windowStart,
      windowEnd,
      knownProviderTaskIds,
      tasks: taskPage.tasks
    };
    let match;
    let terminalFailure = false;
    try {
      match = matchProviderTaskListAcceptanceGap(gapEvidence);
    } catch {
      try {
        match = matchProviderTaskListTerminalFailureGap(gapEvidence);
        terminalFailure = true;
      } catch {
        matchProviderTaskListNoAcceptanceGap(gapEvidence);
        reconcileAmbiguousPaidImageNoAcceptance({
          productDir: input.productDir,
          slot,
          reason: `automatic authenticated provider task-list no-acceptance proof; known_tasks=${knownProviderTaskIds.length}; window=${windowStart}..${windowEnd}`
        });
        input.onProgress?.(`Provider task-list proved no paid task was created for fixed slot ${slot}; authorizing same-slot retry.`);
        return { kind: "no_acceptance", slots: [slot] };
      }
    }
    const verified = await verifyProviderTask({
      apiUrl: config.apiUrl,
      apiKey: config.apiKey,
      taskId: match.taskId,
      slotUpdatedAt: record.updatedAt,
      expectedTerminalFailure: terminalFailure
    });
    reconcileAmbiguousPaidImageTask({
      productDir: input.productDir,
      slot,
      providerTaskId: match.taskId,
      reason: `automatic authenticated provider task-list gap recovery; known_tasks=${knownProviderTaskIds.length}; task_created_at=${match.taskCreatedAt}`,
      providerResponse: verified.payload
    });
    if (terminalFailure) {
      recordPaidImageFailedAfterAcceptance({
        productDir: input.productDir,
        slot,
        providerTaskId: match.taskId,
        reason: `explicit provider task failed after authenticated task-list recovery; status=${verified.status}`,
        providerResponse: verified.payload
      });
      input.onProgress?.(`Recovered terminal failed provider task for fixed slot ${slot}; authorizing controlled same-slot recovery.`);
      return { kind: "task_recovered", slots: [slot] };
    }
    input.onProgress?.(`Recovered provider task-list gap for fixed slot ${slot}; status=${verified.status}.`);
    return { kind: "task_recovered", slots: [slot] };
  } catch (error) {
    keepPageOpenForLogin = isProviderTaskLoginRequiredError(error);
    throw error;
  } finally {
    if (!keepPageOpenForLogin) await page.close().catch(() => {});
  }
}

export async function recoverOrphanedPaidImageReservations(input: {
  configFile: string;
  productDir: string;
  expectedSlotCount: number;
  onProgress?: (message: string) => void;
}): Promise<number[]> {
  const reserved = Array.from({ length: input.expectedSlotCount }, (_, index) => index + 1).flatMap((slot) => {
    const record = readPaidImageSlotRecord({ productDir: input.productDir, slot });
    return record?.state === "reserved" ? [{ slot, record }] : [];
  });
  if (reserved.length === 0) return [];

  const reservationTimes = reserved.map(({ slot, record }) => {
    const ownerPid = record.owner?.pid;
    if (!Number.isInteger(ownerPid) || !processIsProvablyDead(ownerPid as number)) {
      throw new Error(`reserved paid image slot ${slot} is not owned by a provably dead process`);
    }
    const reservedAt = [...record.audit].reverse().find((entry) => entry.state === "reserved")?.at || "";
    const seconds = Date.parse(reservedAt) / 1000;
    if (!Number.isFinite(seconds)) {
      throw new Error(`reserved paid image slot ${slot} lacks a valid reservation timestamp`);
    }
    return seconds;
  });
  const windowStart = Math.floor(Math.min(...reservationTimes) - PROVIDER_TASK_GAP_LOOKBACK_SECONDS);
  const windowEnd = Math.ceil(Date.now() / 1000);
  if (windowEnd <= windowStart) {
    throw new Error("orphaned paid image reservations have an invalid bounded provider lookup window");
  }

  const knownProviderTaskIds = Array.from({ length: input.expectedSlotCount }, (_, index) => index + 1).flatMap((slot) => {
    const record = readPaidImageSlotRecord({ productDir: input.productDir, slot });
    if (!record?.providerTaskId) return [];
    const submittedInWindow = record.audit.some((entry) => {
      const at = Date.parse(entry.at || "") / 1000;
      return entry.state === "submitted" && at >= windowStart && at <= windowEnd;
    });
    return submittedInWindow ? [record.providerTaskId] : [];
  });

  const config = readOpenAiCompatibleImageConfig(input.configFile);
  if (!config.apiKey) throw new Error("image provider API key is required for orphan reservation recovery");
  const context = await launchPersistentBrowser();
  const page = await context.newPage();
  try {
    const taskPageUrl = providerTaskPageUrl(config.apiUrl);
    const taskListUrl = new URL(config.apiUrl);
    taskListUrl.pathname = "/api/task/self";
    taskListUrl.search = "";
    taskListUrl.searchParams.set("p", "1");
    taskListUrl.searchParams.set("page_size", "100");
    taskListUrl.searchParams.set("start_timestamp", String(windowStart));
    taskListUrl.searchParams.set("end_timestamp", String(windowEnd));
    const taskPage = await loadAuthenticatedProviderTasks({
      page, taskPageUrl, taskListUrl: taskListUrl.toString(), onProgress: input.onProgress
    });
    matchProviderTaskListNoAcceptanceGap({
      model: config.model,
      ambiguousSlot: reserved[0].slot,
      queryPage: taskPage.page,
      queryPageSize: taskPage.pageSize,
      queryTotal: taskPage.total,
      windowStart,
      windowEnd,
      knownProviderTaskIds,
      tasks: taskPage.tasks
    });
    const slots = reserved.map(({ slot }) => slot).sort((left, right) => left - right);
    for (const slot of slots) {
      recordPaidImageFailedBeforeAcceptance({
        productDir: input.productDir,
        slot,
        reason: `authenticated provider task-list proved orphan reservation was never accepted; known_tasks=${knownProviderTaskIds.length}; window=${windowStart}..${windowEnd}`
      });
    }
    input.onProgress?.(
      `Provider task-list proved ${slots.length} reservations from dead processes created no paid tasks; authorizing only those fixed-slot retries.`
    );
    return slots;
  } finally {
    await page.close().catch(() => {});
  }
}
