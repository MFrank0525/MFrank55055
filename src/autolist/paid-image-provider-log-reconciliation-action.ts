import fs from "node:fs";
import path from "node:path";
import { readOpenAiCompatibleImageConfig } from "./main-image-provider-action.js";
import {
  excludeKnownAcceptedProviderLogs,
  isProviderNoAcceptanceGatewayStatus,
  matchProviderBilledAcceptanceAfterGateway,
  matchProviderNoAcceptanceLogs,
  type ProviderBilledAcceptanceLogMatch,
  type ProviderNoAcceptanceLogMatch,
  type ProviderTokenLogEntry
} from "./paid-image-reconciliation.js";
import { recoverBilledProviderTasks } from "./paid-image-task-recovery-action.js";
import {
  readPaidImageSlotRecord,
  reconcileAmbiguousPaidImageNoAcceptance,
  sha256File
} from "./paid-image-submission-ledger.js";

// The provider records token-log errors asynchronously at whole-second
// precision. Live evidence shows a zero-billed gateway error can land 2.492 seconds
// after the locally persisted response, so retain a bounded five-second
// window while still requiring one unique one-to-one match.
const PROVIDER_LOG_CLOCK_SKEW_MS = 5_000;
// Token logs are eventually consistent independently of their created_at value.
// A completed 7-slot incident still lacked its last entry on the first lookup.
// Refresh only the read-only log endpoint for at most three minutes; never replay a
// paid POST until the complete strict one-to-one proof exists.
const PROVIDER_LOG_LOOKUP_ATTEMPTS = 37;
const PROVIDER_LOG_LOOKUP_REFRESH_MS = 5_000;
// A task accepted immediately before Cloudflare returns a gateway page can be
// billed only after that response is persisted. Keep this diagnostic window
// narrow: it never authorizes replay and only upgrades the operator message
// from generic ambiguity to accepted-and-billed task-ID recovery.
const PROVIDER_BILLED_ACCEPTANCE_POST_RESPONSE_LAG_MS = 5 * 60_000;

function providerTokenLogUrl(apiUrl: string): string {
  const url = new URL(apiUrl);
  url.pathname = "/api/log/token";
  url.search = "";
  url.searchParams.set("p", "1");
  url.searchParams.set("page_size", "1000");
  return url.toString();
}

function extractProviderLogs(payload: unknown): ProviderTokenLogEntry[] {
  const candidate = payload as {
    data?: unknown[] | { items?: unknown[]; data?: unknown[] };
  };
  if (Array.isArray(candidate?.data)) {
    return candidate.data as ProviderTokenLogEntry[];
  }
  if (candidate?.data && typeof candidate.data === "object") {
    const nested = candidate.data as { items?: unknown[]; data?: unknown[] };
    if (Array.isArray(nested.items)) {
      return nested.items as ProviderTokenLogEntry[];
    }
    if (Array.isArray(nested.data)) {
      return nested.data as ProviderTokenLogEntry[];
    }
  }
  throw new Error("provider token log response did not contain a log array");
}

function responseFileForSlot(taskDir: string, slot: number, expectedImagesPerRound: number): string {
  const round = Math.floor((slot - 1) / expectedImagesPerRound) + 1;
  const localIndex = ((slot - 1) % expectedImagesPerRound) + 1;
  return path.join(
    taskDir,
    `main-image-${String(round).padStart(2, "0")}`,
    "openai-compatible",
    "raw",
    `response-${String(localIndex).padStart(2, "0")}.json`
  );
}

function parseRawCloudflareGatewayStatus(responseFile: string, slot: number): number {
  if (!fs.existsSync(responseFile) || !fs.statSync(responseFile).isFile()) {
    throw new Error(`slot ${slot} is missing its persisted provider response`);
  }
  const text = fs.readFileSync(responseFile, "utf8");
  const titleStatus = /<title>[^<|]*\|\s*(\d{3})\s*:/i.exec(text)?.[1];
  const errorCode = /\berror\s+code\s*(\d{3})\b/i.exec(text)?.[1];
  if (
    !titleStatus ||
    titleStatus !== errorCode ||
    !isProviderNoAcceptanceGatewayStatus(Number(titleStatus)) ||
    !/id=["']cf-error-details["']/i.test(text) ||
    !/cloudflare\.com/i.test(text)
  ) {
    throw new Error(`slot ${slot} persisted response is not an explicit supported Cloudflare gateway artifact`);
  }
  return Number(titleStatus);
}

export interface ProviderLogReconciliationOutcome {
  kind: "none" | "no_acceptance" | "billed_task_recovered";
  slots: number[];
}

export async function reconcileStrictProviderLogOutcome(input: {
  configFile: string;
  productDir: string;
  taskDir: string;
  expectedImagesPerRound: number;
  onProgress?: (message: string) => void;
}): Promise<ProviderLogReconciliationOutcome> {
  const config = readOpenAiCompatibleImageConfig(input.configFile);
  const manifest = JSON.parse(fs.readFileSync(path.join(input.productDir, "product.json"), "utf8")) as {
    expectedSlotCount?: unknown;
  };
  const expectedSlotCount = Number(manifest.expectedSlotCount);
  if (!Number.isInteger(expectedSlotCount) || expectedSlotCount <= 0) {
    throw new Error("paid image product ledger has invalid expectedSlotCount");
  }
  if (!Number.isInteger(input.expectedImagesPerRound) || input.expectedImagesPerRound <= 0) {
    throw new Error("expectedImagesPerRound must be a positive integer");
  }

  const ambiguous = Array.from({ length: expectedSlotCount }, (_, index) => index + 1).flatMap((slot) => {
    const record = readPaidImageSlotRecord({ productDir: input.productDir, slot });
    if (record?.state !== "ambiguous") {
      return [];
    }
    if (record.providerTaskId || record.providerResponseSummary) {
      throw new Error(`slot ${slot} contains provider acceptance evidence and cannot use no-acceptance reconciliation`);
    }
    const responseFile = responseFileForSlot(input.taskDir, slot, input.expectedImagesPerRound);
    const responseStatus = parseRawCloudflareGatewayStatus(responseFile, slot);
    return [{ slot, updatedAt: record.updatedAt, responseStatus, responseFile }];
  });
  if (ambiguous.length === 0) {
    return { kind: "none", slots: [] };
  }

  const acceptedSlots = Array.from({ length: expectedSlotCount }, (_, index) => index + 1).flatMap((slot) => {
    const record = readPaidImageSlotRecord({ productDir: input.productDir, slot });
    const submittedAt = record
      ? [...record.audit].reverse().find((entry) => entry.state === "submitted")?.at
      : undefined;
    return record?.providerTaskId && submittedAt
      ? [{ slot, submittedAt }]
      : [];
  });
  let matches: ProviderNoAcceptanceLogMatch[] | undefined;
  let billed: ProviderBilledAcceptanceLogMatch[] | undefined;
  let lastNoAcceptanceError: unknown;
  for (let lookupAttempt = 1; lookupAttempt <= PROVIDER_LOG_LOOKUP_ATTEMPTS; lookupAttempt += 1) {
    const response = await fetch(providerTokenLogUrl(config.apiUrl), {
      method: "GET",
      headers: { Authorization: "Bearer " + config.apiKey }
    });
    if (!response.ok) {
      throw new Error(`provider token log lookup failed with HTTP ${response.status}`);
    }
    const latestLogs = extractProviderLogs(await response.json());
    try {
      matches = matchProviderNoAcceptanceLogs({
        model: config.model,
        maximumClockSkewMs: PROVIDER_LOG_CLOCK_SKEW_MS,
        slots: ambiguous,
        logs: latestLogs
      });
      break;
    } catch (error) {
      lastNoAcceptanceError = error;
    }
    try {
      const filtered = excludeKnownAcceptedProviderLogs({
        model: config.model,
        maximumClockSkewMs: PROVIDER_LOG_CLOCK_SKEW_MS,
        acceptedSlots,
        logs: latestLogs
      });
      billed = matchProviderBilledAcceptanceAfterGateway({
        model: config.model,
        maximumPostResponseLagMs: PROVIDER_BILLED_ACCEPTANCE_POST_RESPONSE_LAG_MS,
        slots: ambiguous,
        logs: filtered.logs
      });
      break;
    } catch {
      // Neither strict zero-billed nor strict billed evidence is complete yet.
    }
    if (lookupAttempt < PROVIDER_LOG_LOOKUP_ATTEMPTS) {
      await new Promise<void>((resolve) => setTimeout(resolve, PROVIDER_LOG_LOOKUP_REFRESH_MS));
    }
  }
  if (billed) {
    input.onProgress?.(
      `Provider billing logs prove ${billed.length} gateway-lost submissions were accepted; entering authenticated read-only task recovery.`
    );
    const recovered = await recoverBilledProviderTasks({
      configFile: input.configFile,
      productDir: input.productDir,
      expectedSlotCount,
      billed,
      onProgress: input.onProgress
    });
    return { kind: "billed_task_recovered", slots: recovered };
  }
  if (!matches) {
    throw lastNoAcceptanceError instanceof Error
      ? lastNoAcceptanceError
      : new Error("provider logs did not produce a safe acceptance outcome after bounded refresh");
  }

  for (const match of matches) {
    const evidence = ambiguous.find((item) => item.slot === match.slot);
    if (!evidence) {
      throw new Error(`internal reconciliation evidence missing for slot ${match.slot}`);
    }
    reconcileAmbiguousPaidImageNoAcceptance({
      productDir: input.productDir,
      slot: match.slot,
      reason: [
        "automatic provider-log no-acceptance proof",
        `log=${match.logId}`,
        `created_at=${match.logCreatedAt}`,
        `http=${evidence.responseStatus}`,
        "quota=0",
        "upstream_request_id=missing",
        `clock_skew_ms=${Math.round(match.clockSkewMs)}`,
        `response_sha256=${sha256File(evidence.responseFile)}`
      ].join("; ")
    });
  }
  return {
    kind: "no_acceptance",
    slots: matches.map((match) => match.slot).sort((left, right) => left - right)
  };
}
