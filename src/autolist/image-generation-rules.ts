export function resolveImageDownloadTimeoutMs(requestTimeoutMs: number | undefined): number {
  return Math.max(30000, requestTimeoutMs || 180000);
}

export function resolveImageGenerationRequestDeadlineMs(requestTimeoutMs: number | undefined): number {
  return Math.max(60000, resolveImageDownloadTimeoutMs(requestTimeoutMs) + 30000);
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
  reason: "http_transient" | "provider_resource_overloaded" | "provider_gateway_unavailable" | "provider_upstream_failed";
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
}

export function resolveImageGenerationTransportRetryPolicy(configuredMaxRetries: number | undefined): ImageGenerationTransportRetryPolicy {
  const maxRetries = Math.max(8, Number.isFinite(configuredMaxRetries || NaN) ? Number(configuredMaxRetries) : 0);
  const delayMs = Array.from({ length: maxRetries }, (_, index) => Math.min(45000, 3000 * Math.pow(2, index)));
  return { maxRetries, delayMs };
}

export function resolveImageGenerationHttpRetryPolicy(input: ImageGenerationHttpRetryPolicyInput): ImageGenerationHttpRetryPolicy {
  const longDelayMs = [60000, 90000, 120000, 180000, 240000, 300000, 300000, 300000];
  const longMaxRetries = Math.max(8, Number.isFinite(input.configuredMaxRetries || NaN) ? Number(input.configuredMaxRetries) : 0);
  if (/system_memory_overloaded|memory overloaded|resource[_ -]?overloaded|server overloaded/i.test(input.responseText)) {
    return {
      maxRetries: longMaxRetries,
      delayMs: longDelayMs,
      reason: "provider_resource_overloaded"
    };
  }
  if ([502, 503, 504].includes(input.status)) {
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
    return { passed: true, issue: "" };
  }
  const errorName = input.errorName || "Error";
  const errorMessage = input.errorMessage || "unknown error";
  const cause = input.errorCauseCode ? `; cause=${input.errorCauseCode}` : "";
  return {
    passed: false,
    issue: `Image generation endpoint is not reachable from this Node runtime: ${errorName}: ${errorMessage}${cause}`
  };
}

export type PolicyPromptRetryInput = {
  responseOk: boolean;
  responseText: string;
};

export function shouldRetryImageGenerationWithPolicyPrompt(input: PolicyPromptRetryInput): boolean {
  return !input.responseOk && /content[_ -]?policy|policy[_ -]?violation|safety|unsafe|moderation|violat/i.test(input.responseText);
}
