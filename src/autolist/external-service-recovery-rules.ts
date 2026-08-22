import {
  imageServiceWaitCeilingMs,
  isAcceptedPaidImageTaskServiceAvailabilityReason,
  isUnsafePaidImageReplayReason
} from "./image-generation-rules.js";
import { isPaidImageAcceptedTaskHeartbeatText } from "./paid-image-wait-rules.js";

export function resolveDefaultExternalServiceWaitAttempts(): number {
  return 12;
}

export function isPaidMainImageTransportFailure(message: string): boolean {
  return /main_images_generated|main image/i.test(message) &&
    /fetch failed|network|socket|terminated|reset|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|UND_ERR/i.test(message);
}

export function isPaidImageSubmissionSafetyBlock(message: string): boolean {
  return /paid image ledger blocked slot|blocked_(?:reserved|ambiguous)|paid submission safety block/i.test(message);
}

export function isRetryableVideosBase64NoAcceptanceTransportFailure(message: string): boolean {
  return /main_images_generated|videos-base64/i.test(message) &&
    /videos-base64 paid image slots failed/i.test(message) &&
    /fetch failed|failed to fetch|fail_to_fetch_task|Bad Request|openresty|network|socket|terminated|reset|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|UND_ERR|AbortError|aborted/i.test(message) &&
    !/blocked_(?:reserved|ambiguous)|paid submission safety block|ambiguous|reserved/i.test(message) &&
    !/videos-base64 task .*did not finish|videos-base64 task .*failed|provider task failed/i.test(message);
}

export function isRetryableVideosBase64ProviderTaskFailure(message: string): boolean {
  return /main_images_generated|videos-base64/i.test(message) &&
    /videos-base64 task .* failed|provider task failed/i.test(message) &&
    !isUnsafePaidImageReplayReason(message) &&
    !/please contact administrator/i.test(message);
}

function isRetryableVideosBase64AcceptedQueueWait(message: string): boolean {
  return /main_images_generated|main image|watchdog|no progress/i.test(message) &&
    isPaidImageAcceptedTaskHeartbeatText(message);
}

export function isRetryableExternalServiceAvailabilityFailure(message: string): boolean {
  if (
    isPaidImageSubmissionSafetyBlock(message) ||
    isUnsafePaidImageReplayReason(message) ||
    /please contact administrator/i.test(message)
  ) {
    return false;
  }
  return isRetryableVideosBase64AcceptedQueueWait(message) ||
    isRetryableVideosBase64NoAcceptanceTransportFailure(message) ||
    /paid image provider (?:timeout |service )?circuit open/i.test(message) ||
    isAcceptedPaidImageTaskServiceAvailabilityReason(message) ||
    isPaidMainImageTransportFailure(message) ||
    (/main_images_generated/i.test(message) && /videos-base64 task .*did not finish/i.test(message)) ||
    (/main_images_generated|image generation|main image/i.test(message) &&
      (/HTTP\s*(429|502|503|504|520|521|522|523|524)/i.test(message) ||
        /temporarily unavailable|gateway unavailable|service unavailable|resource[_ -]?overloaded|server overloaded|timed out|timeout|aborted/i.test(message)));
}

export function shouldConsumeSupervisorRecoveryAttempt(failureMessage: string): boolean {
  return !isRetryableExternalServiceAvailabilityFailure(failureMessage);
}

export function resolveSupervisorRecoveryDelayMs(input: {
  failureMessage: string;
  externalServiceWaitAttempts: number;
}): number {
  if (!isRetryableExternalServiceAvailabilityFailure(input.failureMessage)) {
    return 10000;
  }
  const retryMatch = /paid image provider (?:timeout |service )?circuit open[\s\S]*?retry after\s+(\d+)ms/i.exec(
    input.failureMessage
  );
  const slotDelayMs = retryMatch ? Number(retryMatch[1]) : Number.NaN;
  const validSlotDelay = slotDelayMs >= 1000 && slotDelayMs <= 6 * 60 * 60 * 1000;
  return validSlotDelay ? slotDelayMs : imageServiceWaitCeilingMs;
}
