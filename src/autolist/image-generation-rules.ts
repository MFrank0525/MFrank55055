export const imageServiceWaitCeilingMs = 3 * 60 * 1000;

export function resolveImageDownloadTimeoutMs(requestTimeoutMs: number | undefined): number {
  return Math.max(30000, requestTimeoutMs || 180000);
}

export function resolveImageGenerationRequestDeadlineMs(requestTimeoutMs: number | undefined): number {
  return Math.max(60000, resolveImageDownloadTimeoutMs(requestTimeoutMs) + 30000);
}

export type OpenAiCompatibleImageMode = "generations" | "edits" | "media-generate" | "videos-base64";

export function resolveOpenAiCompatibleImageMode(
  configuredMode: OpenAiCompatibleImageMode | undefined,
  apiUrl: string
): OpenAiCompatibleImageMode {
  if (configuredMode) {
    return configuredMode;
  }
  if (apiUrl.includes("/images/edits")) {
    return "edits";
  }
  if (apiUrl.includes("/v1/media/generate")) {
    return "media-generate";
  }
  if (apiUrl.includes("/v1/videos")) {
    return "videos-base64";
  }
  return "generations";
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
    /invalid request|validation failed|unsupported parameter|unknown parameter|authentication failed|unauthorized|forbidden/i.test(
      responseText
    )
  );
}

export function submitTransportFailureProvesNoPaidTaskAccepted(message: string): boolean {
  return /fetch failed|failed to fetch|network.*failed|ECONNRESET before response|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|request exceeded hard deadline|AbortError|aborted/i.test(
    message
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
  const timeoutPattern = /timeout|timed out|did not finish within|queued\/pending beyond|超时/i;
  const timeoutFailures = input.audit.filter(
    (entry) => entry.state === "failed_after_acceptance" && timeoutPattern.test(entry.reason || "")
  );
  const repeatedTimeout = timeoutPattern.test(input.failureReason) && timeoutFailures.length >= timeoutThreshold;
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
  const unsafeReplay =
    /permission denied|access forbidden|forbidden|unauthorized|余额|balance|quota|credit|insufficient|欠费|充值|billing/i.test(
      failureReason
    );
  const explicitAcceptedTaskTimeout =
    /provider task failed/i.test(failureReason) && /task_timeout|timeout|timed out|did not finish within|超时/i.test(failureReason);
  if (!explicitAcceptedTaskTimeout || unsafeReplay) {
    return { action: "bubble", usePolicyCompatiblePrompt: false, deferMs: 0 };
  }

  const timeoutRetry = resolvePaidImageProviderTimeoutRetry(input);
  return timeoutRetry.deferMs > 0
    ? {
        action: "defer_to_supervisor",
        usePolicyCompatiblePrompt: timeoutRetry.usePolicyCompatiblePrompt,
        deferMs: timeoutRetry.deferMs
      }
    : {
        action: "retry_fixed_slot_now",
        usePolicyCompatiblePrompt: timeoutRetry.usePolicyCompatiblePrompt,
        deferMs: 0
      };
}
