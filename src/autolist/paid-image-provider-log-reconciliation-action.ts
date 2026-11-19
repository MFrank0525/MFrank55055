import fs from "node:fs";
import path from "node:path";
import { isDirectStructuredModelUnavailableNoAcceptanceResponse } from "./image-generation-rules.js";
import { readOpenAiCompatibleImageConfig } from "./main-image-provider-action.js";
import {
  excludeKnownAcceptedProviderLogs,
  isProviderAmbiguousAvailabilityResponse,
  isProviderNoAcceptanceGatewayStatus,
  matchProviderBilledAcceptanceAfterGateway,
  matchProviderNoAcceptanceLogs,
  type ProviderBilledAcceptanceLogMatch,
  type ProviderNoAcceptanceLogMatch,
  type ProviderTokenLogEntry
} from "./paid-image-reconciliation.js";
import {
  isProviderTaskLoginRequiredError,
  recoverBilledProviderTasks,
  recoverProviderTaskListAcceptanceGap
} from "./paid-image-task-recovery-action.js";
import {
  attachPaidImageGatewayEvidence,
  readPaidImageSlotRecord,
  reconcileAmbiguousPaidImageNoAcceptance,
  sha256File
} from "./paid-image-submission-ledger.js";
import { resolvePaidImageGatewayEvidenceFile } from "./paid-image-gateway-evidence.js";

// The provider records token-log errors asynchronously at whole-second
// precision. Live evidence shows a zero-billed gateway error can land 2.492 seconds
// after the locally persisted response, so retain a bounded five-second
// window while still requiring one unique one-to-one match.
const PROVIDER_LOG_CLOCK_SKEW_MS = 5_000;
// A durable submitted transition is written after the provider response arrives.
// Live completed evidence includes 7.136 seconds between provider billing and
// that transition. Exact full-set cardinality still rejects unrelated activity.
const PROVIDER_KNOWN_ACCEPTANCE_CLOCK_SKEW_MS = 10_000;
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

export function parseProviderTokenLogPayload(text: string): ProviderTokenLogEntry[] {
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error("provider token log is temporarily unavailable: non-JSON response");
  }
  return extractProviderLogs(payload);
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

function parseRawProviderAmbiguousResponseStatus(responseFile: string, slot: number, expectedStatus?: number): number {
  if (!fs.existsSync(responseFile) || !fs.statSync(responseFile).isFile()) {
    throw new Error(`slot ${slot} is missing its persisted provider response`);
  }
  const text = fs.readFileSync(responseFile, "utf8");
  const titleStatus = /<title>[^<|]*\|\s*(\d{3})\s*:/i.exec(text)?.[1];
  const errorCode = /\berror\s+code\s*(\d{3})\b/i.exec(text)?.[1];
  const cloudflareStatus = titleStatus && titleStatus === errorCode
    && isProviderNoAcceptanceGatewayStatus(Number(titleStatus))
    && /id=["']cf-error-details["']/i.test(text)
    && /cloudflare\.com/i.test(text)
      ? Number(titleStatus)
      : undefined;
  const structuredStatus = expectedStatus !== undefined
    && isProviderAmbiguousAvailabilityResponse({ status: expectedStatus, responseText: text })
      ? expectedStatus
      : undefined;
  const status = cloudflareStatus ?? structuredStatus;
  if (status === undefined) {
    throw new Error(`slot ${slot} persisted response is not an explicit supported ambiguous provider availability artifact`);
  }
  return status;
}

function resolveBoundGatewayEvidence(input: {
  productDir: string; taskDir: string; slot: number; expectedImagesPerRound: number;
  record: NonNullable<ReturnType<typeof readPaidImageSlotRecord>>;
}): { responseFile: string; responseStatus: number; directNoAcceptance: boolean } {
  if (input.record.gatewayEvidence) {
    const responseFile = resolvePaidImageGatewayEvidenceFile(input.productDir, input.record.gatewayEvidence);
    const responseText = fs.readFileSync(responseFile, "utf8");
    if (
      input.record.gatewayEvidence.httpStatus === 503 &&
      isDirectStructuredModelUnavailableNoAcceptanceResponse(responseText)
    ) {
      return {
        responseFile,
        responseStatus: input.record.gatewayEvidence.httpStatus,
        directNoAcceptance: true
      };
    }
    const responseStatus = parseRawProviderAmbiguousResponseStatus(
      responseFile,
      input.slot,
      input.record.gatewayEvidence.httpStatus
    );
    if (responseStatus !== input.record.gatewayEvidence.httpStatus) {
      throw new Error(`slot ${input.slot} gateway evidence status does not match its ledger metadata`);
    }
    return { responseFile, responseStatus, directNoAcceptance: false };
  }
  const { runId, taskId } = input.record.owner || {};
  if (!runId || !taskId || !/^[A-Za-z0-9._-]+$/.test(runId) || !/^[A-Za-z0-9._-]+$/.test(taskId)) {
    throw new Error(`slot ${input.slot} lacks canonical gateway evidence and an exact legacy owner`);
  }
  const runsRoot = path.resolve(input.taskDir, "../../..");
  const ownerTaskDir = path.resolve(runsRoot, runId, "tasks", taskId);
  if (!ownerTaskDir.startsWith(runsRoot + path.sep)) {
    throw new Error(`slot ${input.slot} legacy gateway evidence owner escaped the runs directory`);
  }
  const legacyFile = responseFileForSlot(ownerTaskDir, input.slot, input.expectedImagesPerRound);
  const responseStatus = parseRawProviderAmbiguousResponseStatus(legacyFile, input.slot);
  const attached = attachPaidImageGatewayEvidence({
    productDir: input.productDir, slot: input.slot,
    responseEvidenceFile: legacyFile, responseStatus
  });
  const responseFile = resolvePaidImageGatewayEvidenceFile(input.productDir, attached.gatewayEvidence!);
  return { responseFile, responseStatus, directNoAcceptance: false };
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

  let ambiguous = Array.from({ length: expectedSlotCount }, (_, index) => index + 1).flatMap((slot) => {
    const record = readPaidImageSlotRecord({ productDir: input.productDir, slot });
    if (record?.state !== "ambiguous") {
      return [];
    }
    if (record.providerTaskId || record.providerResponseSummary) {
      throw new Error(`slot ${slot} contains provider acceptance evidence and cannot use no-acceptance reconciliation`);
    }
    const { responseFile, responseStatus, directNoAcceptance } = resolveBoundGatewayEvidence({
      productDir: input.productDir, taskDir: input.taskDir, slot,
      expectedImagesPerRound: input.expectedImagesPerRound, record
    });
    return [{ slot, updatedAt: record.updatedAt, responseStatus, responseFile, directNoAcceptance }];
  });
  if (ambiguous.length === 0) {
    return { kind: "none", slots: [] };
  }
  const directNoAcceptanceSlots = ambiguous
    .filter((item) => item.directNoAcceptance)
    .map((item) => item.slot);
  for (const slot of directNoAcceptanceSlots) {
    const evidence = ambiguous.find((item) => item.slot === slot)!;
    reconcileAmbiguousPaidImageNoAcceptance({
      productDir: input.productDir,
      slot,
      reason: [
        "direct structured model-unavailable no-acceptance proof",
        `http=${evidence.responseStatus}`,
        `response_sha256=${sha256File(evidence.responseFile)}`
      ].join("; ")
    });
  }
  ambiguous = ambiguous.filter((item) => !item.directNoAcceptance);
  if (ambiguous.length === 0) {
    return { kind: "no_acceptance", slots: directNoAcceptanceSlots };
  }

  const acceptedSlots = Array.from({ length: expectedSlotCount }, (_, index) => index + 1).flatMap((slot) => {
    const record = readPaidImageSlotRecord({ productDir: input.productDir, slot });
    return record?.audit
      .filter((entry) => entry.state === "submitted")
      .map((entry) => ({ slot, submittedAt: entry.at })) || [];
  });
  let matches: ProviderNoAcceptanceLogMatch[] | undefined;
  let billed: ProviderBilledAcceptanceLogMatch[] | undefined;
  let lastNoAcceptanceError: unknown;
  let lastLookupError: unknown;
  let successfulLookupCount = 0;
  const waitForProviderLogRefresh = (): Promise<void> =>
    new Promise<void>((resolve) => setTimeout(resolve, PROVIDER_LOG_LOOKUP_REFRESH_MS));
  for (let lookupAttempt = 1; lookupAttempt <= PROVIDER_LOG_LOOKUP_ATTEMPTS; lookupAttempt += 1) {
    let latestLogs: ProviderTokenLogEntry[] | undefined;
    try {
      const response = await fetch(providerTokenLogUrl(config.apiUrl), {
        method: "GET",
        headers: { Authorization: "Bearer " + config.apiKey }
      });
      if (!response.ok) {
        if (response.status === 429 || response.status >= 500) {
          throw new Error(`provider token log lookup failed with transient HTTP ${response.status}`);
        }
        throw new Error(`provider token log lookup failed with HTTP ${response.status}`);
      }
      latestLogs = parseProviderTokenLogPayload(await response.text());
      successfulLookupCount += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/fetch failed|failed to fetch|network|socket|terminated|reset|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|UND_ERR|AbortError|aborted|transient HTTP (?:429|5\d\d)|provider token log is temporarily unavailable/i.test(message)) {
        throw error;
      }
      lastLookupError = error;
      if (lookupAttempt === 1 || lookupAttempt % 6 === 0 || lookupAttempt === PROVIDER_LOG_LOOKUP_ATTEMPTS) {
        input.onProgress?.(
          `Provider token-log lookup is temporarily unavailable; read-only retry ${lookupAttempt}/${PROVIDER_LOG_LOOKUP_ATTEMPTS}.`
        );
      }
      if (lookupAttempt < PROVIDER_LOG_LOOKUP_ATTEMPTS) {
        await waitForProviderLogRefresh();
      }
      continue;
    }
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
        maximumClockSkewMs: PROVIDER_KNOWN_ACCEPTANCE_CLOCK_SKEW_MS,
        acceptedSlots,
        logs: latestLogs
      });
      billed = matchProviderBilledAcceptanceAfterGateway({
        model: config.model,
        maximumPreResponseSkewMs: PROVIDER_LOG_CLOCK_SKEW_MS,
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
    return {
      kind: "billed_task_recovered",
      slots: [...directNoAcceptanceSlots, ...recovered].sort((left, right) => left - right)
    };
  }
  if (!matches) {
    if (successfulLookupCount === 0 && lastLookupError) {
      const message = lastLookupError instanceof Error ? lastLookupError.message : String(lastLookupError);
      throw new Error(`provider_log_lookup_unavailable: ${message}`);
    }
    try {
      const recovered = await recoverProviderTaskListAcceptanceGap({
        configFile: input.configFile,
        productDir: input.productDir,
        expectedSlotCount,
        onProgress: input.onProgress
      });
      return {
        kind: recovered.kind === "no_acceptance" ? "no_acceptance" : "billed_task_recovered",
        slots: [...directNoAcceptanceSlots, ...recovered.slots].sort((left, right) => left - right)
      };
    } catch (taskGapError) {
      const taskGapReason = taskGapError instanceof Error ? taskGapError.message : String(taskGapError);
      input.onProgress?.(`Authenticated provider task-list gap is not yet conclusive: ${taskGapReason}`);
      if (isProviderTaskLoginRequiredError(taskGapError)) {
        throw taskGapError;
      }
    }
    const pendingReason = lastNoAcceptanceError instanceof Error
      ? lastNoAcceptanceError.message
      : "provider logs did not produce a safe acceptance outcome after bounded refresh";
    throw new Error(`provider_log_outcome_pending: ${pendingReason}`);
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
    slots: [
      ...directNoAcceptanceSlots,
      ...matches.map((match) => match.slot)
    ].sort((left, right) => left - right)
  };
}
