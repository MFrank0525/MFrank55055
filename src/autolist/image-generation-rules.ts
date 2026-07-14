export const imageServiceWaitCeilingMs = 3 * 60 * 1000;
export const videosBase64AcceptedTaskPollCeilingMs = 30 * 60 * 1000;

// Configured values deliberately normalize to the project's fixed 30-minute paid-task safety contract.
export function resolveVideosBase64AcceptedTaskPollCeilingMs(_configuredMaxPollMs: number | undefined): number {
  return videosBase64AcceptedTaskPollCeilingMs;
}

export function resolveImageDownloadTimeoutMs(requestTimeoutMs: number | undefined): number {
  return Math.max(30000, requestTimeoutMs || 180000);
}

export function resolveImageGenerationRequestDeadlineMs(requestTimeoutMs: number | undefined): number {
  return Math.max(60000, resolveImageDownloadTimeoutMs(requestTimeoutMs) + 30000);
}

export type OpenAiCompatibleImageMode = "videos-base64";

export function resolveOpenAiCompatibleImageMode(
  configuredMode: unknown,
  apiUrl: string
): OpenAiCompatibleImageMode {
  let endpoint: URL;
  try {
    endpoint = new URL(apiUrl);
  } catch {
    throw new Error("OpenAI-compatible image generation requires mode videos-base64 and a valid /v1/videos apiUrl.");
  }
  const pathname = endpoint.pathname;
  if (
    configuredMode !== "videos-base64" ||
    (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") ||
    !endpoint.hostname ||
    endpoint.username ||
    endpoint.password ||
    pathname !== "/v1/videos" ||
    endpoint.search ||
    endpoint.hash
  ) {
    throw new Error("OpenAI-compatible image generation requires mode videos-base64 and a credential-free http(s) apiUrl ending exactly in /v1/videos.");
  }
  return "videos-base64";
}

export function resolveVideosBase64SubmitTimeoutMs(
  requestTimeoutMs: number | undefined,
  maxPollMs: number | undefined
): number {
  const projectPollCeilingMs = 180000;
  return Math.min(projectPollCeilingMs, Math.max(resolveImageDownloadTimeoutMs(requestTimeoutMs), maxPollMs || projectPollCeilingMs));
}

export function resolveVideosBase64SubmitConcurrency(configuredConcurrency: number | undefined): number {
  if (!Number.isFinite(configuredConcurrency)) {
    return 2;
  }
  return Math.min(4, Math.max(1, Math.floor(configuredConcurrency as number)));
}

export interface PaidImageLedgerFailureSummary {
  expectedSlotCount: number;
  missing: number;
  reserved: number;
  submitted: number;
  completed: number;
  failedBeforeAcceptance: number;
  failedAfterAcceptance: number;
  ambiguous: number;
}

export type PaidImageLedgerFailureDisposition = "safety_block" | "retryable_external_wait" | "none";

export function resolvePaidImageLedgerFailureDisposition(
  summary: PaidImageLedgerFailureSummary
): PaidImageLedgerFailureDisposition {
  if (summary.ambiguous > 0 || summary.reserved > 0) {
    return "safety_block";
  }
  if (summary.submitted > 0) {
    return "retryable_external_wait";
  }
  return "none";
}

export function resolveMissingFixedImageIndexes(existingIndexes: number[], expectedCount: number): number[] {
  const existing = new Set(existingIndexes.filter((index) => Number.isInteger(index) && index >= 1 && index <= expectedCount));
  return Array.from({ length: expectedCount }, (_, index) => index + 1).filter((index) => !existing.has(index));
}

export interface ImageGenerationTransportRetryPolicy {
  maxRetries: number;
  delayMs: number[];
}

export interface ImageGenerationHttpRetryPolicyInput {
  status: number;
  responseText: string;
  configuredMaxRetries: number | undefined;
}

export interface ImageGenerationHttpRetryPolicy {
  maxRetries: number;
  delayMs: number[];
  reason:
    | "http_transient"
    | "provider_resource_overloaded"
    | "provider_gateway_unavailable"
    | "provider_upstream_failed"
    | "provider_upstream_forbidden";
}

export interface ImageGenerationEndpointProbe {
  status?: number;
  statusText?: string;
  errorName?: string;
  errorMessage?: string;
  errorCauseCode?: string;
}

export interface ImageGenerationEndpointProbeEvaluation {
  passed: boolean;
  issue: string;
  startAction: "continue" | "block";
}

export function providerExplicitlyProvesNoPaidTaskAccepted(status: number, responseText: string): boolean {
  return (
    [400, 401, 403, 404, 405, 422].includes(status) ||
    submitFailureResponseProvesNoPaidTaskAccepted(responseText) ||
    /invalid request|validation failed|unsupported parameter|unknown parameter|authentication failed|unauthorized|forbidden/i.test(
      responseText
    )
  );
}

function submitFailureResponseProvesNoPaidTaskAccepted(message: string): boolean {
  return (
    /fail_to_fetch_task/i.test(message) &&
    /model_not_found|No available channel|no available channel|没有可用.*通道|无可用.*通道/i.test(message)
  );
}

export function submitTransportFailureProvesNoPaidTaskAccepted(message: string): boolean {
  return (
    /fetch failed|failed to fetch|network.*failed|ECONNRESET before response|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|request exceeded hard deadline|AbortError|aborted/i.test(
      message
    ) || submitFailureResponseProvesNoPaidTaskAccepted(message)
  );
}

export function resolveImageGenerationTransportRetryPolicy(configuredMaxRetries: number | undefined): ImageGenerationTransportRetryPolicy {
  const maxRetries = Math.max(8, Number.isFinite(configuredMaxRetries || NaN) ? Number(configuredMaxRetries) : 0);
  const delayMs = Array.from({ length: maxRetries }, (_, index) => Math.min(45000, 3000 * Math.pow(2, index)));
  return { maxRetries, delayMs };
}

export function resolveImageGenerationHttpRetryPolicy(input: ImageGenerationHttpRetryPolicyInput): ImageGenerationHttpRetryPolicy {
  const longDelayMs = [60000, 90000, 120000, 180000, 180000, 180000, 180000, 180000];
  const longMaxRetries = Math.max(8, Number.isFinite(input.configuredMaxRetries || NaN) ? Number(input.configuredMaxRetries) : 0);
  if (/upstream access forbidden|access forbidden|please contact administrator|permission denied|forbidden/i.test(input.responseText)) {
    return {
      maxRetries: 0,
      delayMs: [],
      reason: "provider_upstream_forbidden"
    };
  }
  if (/system_memory_overloaded|memory overloaded|resource[_ -]?overloaded|server overloaded/i.test(input.responseText)) {
    return {
      maxRetries: longMaxRetries,
      delayMs: longDelayMs,
      reason: "provider_resource_overloaded"
    };
  }
  if ([502, 503, 504, 520, 521, 522, 523, 524].includes(input.status)) {
    return {
      maxRetries: longMaxRetries,
      delayMs: longDelayMs,
      reason: "provider_gateway_unavailable"
    };
  }
  if (/do_request_failed|upstream error|upstream.*failed/i.test(input.responseText)) {
    return {
      maxRetries: longMaxRetries,
      delayMs: longDelayMs,
      reason: "provider_upstream_failed"
    };
  }
  const maxRetries = Math.max(0, input.configuredMaxRetries ?? 3);
  return {
    maxRetries,
    delayMs: Array.from({ length: maxRetries }, (_, index) => 3000 * (index + 1)),
    reason: "http_transient"
  };
}

export function evaluateImageGenerationEndpointProbe(input: ImageGenerationEndpointProbe): ImageGenerationEndpointProbeEvaluation {
  if (typeof input.status === "number") {
    return { passed: true, issue: "", startAction: "continue" };
  }
  const errorName = input.errorName || "Error";
  const errorMessage = input.errorMessage || "unknown error";
  const cause = input.errorCauseCode ? `; cause=${input.errorCauseCode}` : "";
  return {
    passed: false,
    issue: `Image generation endpoint is not reachable from this Node runtime: ${errorName}: ${errorMessage}${cause}`,
    startAction: "continue"
  };
}

export type PolicyPromptRetryInput = {
  responseOk: boolean;
  responseText: string;
};

export function shouldRetryImageGenerationWithPolicyPrompt(input: PolicyPromptRetryInput): boolean {
  return !input.responseOk && /content[_ -]?policy|policy[_ -]?violation|safety|unsafe|moderation|violat/i.test(input.responseText);
}

export function shouldKeepPaidImagePolicyCompatiblePrompt(input: {
  failureReason: string;
  recordedPromptDigest: string;
  originalPromptDigest: string;
  policyCompatiblePromptDigest: string;
}): boolean {
  return (
    /content[_ -]?policy|policy[_ -]?violation|safety|unsafe|moderation|violat|违规|安全策略|内容策略/i.test(
      input.failureReason
    ) ||
    Boolean(
      input.recordedPromptDigest &&
        input.recordedPromptDigest !== input.originalPromptDigest &&
        input.recordedPromptDigest === input.policyCompatiblePromptDigest
    )
  );
}

export function isAcceptedPaidImageTaskTimeoutReason(reason: string): boolean {
  const hasTimeout = /task_timeout|timeout|timed out|did not finish within|queued\/pending beyond|超时/i.test(reason);
  const hasAcceptedTaskContext = /provider task failed|accepted task|submitted provider task/i.test(reason);
  return hasTimeout && hasAcceptedTaskContext;
}

function isPaidImageSubmitStageUncertaintyReason(reason: string): boolean {
  const hasStrongUncertainty =
    /response.*ambiguous|(?:missing|before|without|did not include).*task id|task id.*(?:missing|not received|not returned)/i.test(
      reason
    );
  if (hasStrongUncertainty) {
    return true;
  }
  if (/submitted provider task/i.test(reason)) {
    return false;
  }
  return (
    /\bsubmission\b|\bsubmitting\b/i.test(reason) ||
    /\bsubmit\b.*(?:request|response|failed|failure|ambiguous)|(?:request|response|failed|failure|ambiguous).*\bsubmit\b/i.test(
      reason
    )
  );
}

export function isUnsafePaidImageReplayReason(reason: string): boolean {
  const normalizedReason = (reason || "").replace(/[_-]+/g, " ");
  if (normalizedReason.trim().toLowerCase() === "[redacted]") {
    return true;
  }
  const providerProvedNoAcceptance = /fail to fetch task/i.test(normalizedReason);
  const authorizationFailure =
    /HTTP\s*(?:401|403)\b|invalid api key|api key invalid|authentication failed|authentication error|unauthenticated|unauthorized|permission denied|access forbidden|upstream forbidden/i.test(
      normalizedReason
    );
  const visualNonFinancialContext = /\bwhite balance\b|\bunbalanced\b|\baccreditation watermark\b/i.test(normalizedReason);
  const balanceOrQuotaFailure =
    !visualNonFinancialContext &&
    /\binsufficient\s+(?:account\s+)?(?:balance|credit|quota)\b|\b(?:balance|credit|quota)\b(?:\s+\w+){0,3}\s+(?:insufficient|exceeded|exhausted|depleted)\b|\bquota\s+(?:limit\s+)?(?:exceeded|exhausted|depleted)\b/i.test(
      normalizedReason
    );
  const financialFailure =
    balanceOrQuotaFailure || /\bbilling\b|\bpayment required\b|\brate limit\b|余额|欠费|充值/i.test(normalizedReason);
  return (
    (!providerProvedNoAcceptance && isPaidImageSubmitStageUncertaintyReason(reason)) ||
    authorizationFailure ||
    /\busage limit(?: exceeded| reached)?\b|\blimit (?:exceeded|reached)\b|\binsufficient funds\b/i.test(
      normalizedReason
    ) ||
    financialFailure
  );
}

export function isUnsafePaidImageReplayPayload(payload: unknown): boolean {
  const evidenceKeys = new Set([
    "code",
    "message",
    "error",
    "errors",
    "status",
    "state",
    "data",
    "detail",
    "details",
    "description",
    "errordescription"
  ]);
  const evidence: string[] = [];
  let visitedNodes = 0;
  let traversalIncomplete = false;
  const visit = (value: unknown, depth: number, key: string): void => {
    if (depth > 8 || visitedNodes >= 128) {
      traversalIncomplete = true;
      return;
    }
    visitedNodes += 1;
    if (value === null || value === undefined) {
      return;
    }
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (evidenceKeys.has(normalizedKey)) {
        evidence.push(
          (normalizedKey === "status" || normalizedKey === "state") && (value === 401 || value === 403)
            ? `HTTP ${value}`
            : String(value)
        );
      }
      return;
    }
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        if (depth + 1 > 8 || visitedNodes >= 128) {
          traversalIncomplete = true;
          break;
        }
        visit(value[index], depth + 1, key);
      }
      return;
    }
    if (typeof value === "object") {
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) {
        return;
      }
      for (const nestedKey in value as Record<string, unknown>) {
        if (!Object.prototype.hasOwnProperty.call(value, nestedKey)) {
          continue;
        }
        if (depth + 1 > 8 || visitedNodes >= 128) {
          traversalIncomplete = true;
          break;
        }
        visit((value as Record<string, unknown>)[nestedKey], depth + 1, nestedKey);
      }
    }
  };
  visit(payload, 0, "data");
  return traversalIncomplete || isUnsafePaidImageReplayReason(evidence.join("\n"));
}

export function resolvePaidImageProviderTimeoutRetry(input: {
  failureReason: string;
  audit: Array<{ state?: string; at?: string; reason?: string }>;
  recordedPromptDigest: string;
  policyCompatiblePromptDigest: string;
  nowMs: number;
  timeoutThreshold?: number;
  cooldownMs?: number;
}): { usePolicyCompatiblePrompt: boolean; deferMs: number } {
  const timeoutThreshold = Math.max(1, input.timeoutThreshold ?? 2);
  const cooldownMs = Math.min(imageServiceWaitCeilingMs, Math.max(0, input.cooldownMs ?? imageServiceWaitCeilingMs));
  const timeoutFailures = input.audit.filter(
    (entry) => entry.state === "failed_after_acceptance" && isAcceptedPaidImageTaskTimeoutReason(entry.reason || "")
  );
  const repeatedTimeout =
    isAcceptedPaidImageTaskTimeoutReason(input.failureReason) && timeoutFailures.length >= timeoutThreshold;
  if (!repeatedTimeout) {
    return { usePolicyCompatiblePrompt: false, deferMs: 0 };
  }
  const alreadyPolicyCompatible =
    Boolean(input.recordedPromptDigest) && input.recordedPromptDigest === input.policyCompatiblePromptDigest;
  if (!alreadyPolicyCompatible) {
    return { usePolicyCompatiblePrompt: true, deferMs: 0 };
  }
  const latestFailureMs = Math.max(
    ...timeoutFailures.map((entry) => Date.parse(entry.at || "")).filter((value) => Number.isFinite(value)),
    0
  );
  return {
    usePolicyCompatiblePrompt: true,
    deferMs: Math.max(0, latestFailureMs + cooldownMs - input.nowMs)
  };
}

export function resolvePaidImageFixedSlotRecovery(input: {
  failureReason: string;
  audit: Array<{ state?: string; at?: string; reason?: string }>;
  recordedPromptDigest: string;
  policyCompatiblePromptDigest: string;
  nowMs: number;
}): {
  action: "retry_fixed_slot_now" | "defer_to_supervisor" | "bubble";
  usePolicyCompatiblePrompt: boolean;
  deferMs: number;
} {
  const failureReason = input.failureReason || "";
  const unsafeReplay = isUnsafePaidImageReplayReason(failureReason);
  const explicitAcceptedTaskTimeout = isAcceptedPaidImageTaskTimeoutReason(failureReason);
  if (!explicitAcceptedTaskTimeout || unsafeReplay) {
    return { action: "bubble", usePolicyCompatiblePrompt: false, deferMs: 0 };
  }

  const timeoutRetry = resolvePaidImageProviderTimeoutRetry(input);
  const usePolicyCompatiblePrompt =
    timeoutRetry.usePolicyCompatiblePrompt ||
    (Boolean(input.recordedPromptDigest) && input.recordedPromptDigest === input.policyCompatiblePromptDigest);
  return timeoutRetry.deferMs > 0
    ? {
        action: "defer_to_supervisor",
        usePolicyCompatiblePrompt,
        deferMs: timeoutRetry.deferMs
      }
    : {
        action: "retry_fixed_slot_now",
        usePolicyCompatiblePrompt,
        deferMs: 0
      };
}
