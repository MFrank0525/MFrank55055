export function resolveImageDownloadTimeoutMs(requestTimeoutMs: number | undefined): number {
  return Math.max(30000, requestTimeoutMs || 180000);
}

export interface ImageGenerationTransportRetryPolicy {
  maxRetries: number;
  delayMs: number[];
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
