import { videosBase64AcceptedTaskPollCeilingMs } from "./image-generation-rules.js";

export type PaidImageAcceptedTaskProgress = {
  activeStep?: string;
  activeMessage?: string;
};

export type PaidImageAcceptedTaskObservation = {
  taskKey: string;
  startedAtMs: number;
};

export function resolvePaidImageAcceptedTaskKey(input: PaidImageAcceptedTaskProgress): string | undefined {
  if (!/main_images_generated/i.test(input.activeStep || "")) {
    return undefined;
  }
  return /videos-base64 task (\S+) status (?:queued|pending)\s+0(?!\.\d|\d)/i.exec(input.activeMessage || "")?.[1];
}

export function isPaidImageAcceptedTaskHeartbeatText(message: string): boolean {
  return /videos-base64 task \S+ status (?:queued|pending)\s+0(?!\.\d|\d)/i.test(message);
}

export type PaidImageChildStallTimeoutInput = PaidImageAcceptedTaskProgress & {
  defaultTimeoutMs: number;
};

export function resolvePaidImageChildStallTimeoutMs(input: PaidImageChildStallTimeoutInput): number {
  return resolvePaidImageAcceptedTaskKey(input)
    ? Math.max(input.defaultTimeoutMs, videosBase64AcceptedTaskPollCeilingMs)
    : input.defaultTimeoutMs;
}

export function resolvePaidImageChildWatchdogDecision(input: PaidImageChildStallTimeoutInput & {
  lastProgressSeenAtMs: number;
  nowMs: number;
  acceptedTaskObservation?: PaidImageAcceptedTaskObservation;
}) {
  const taskKey = resolvePaidImageAcceptedTaskKey(input);
  const acceptedTaskObservation = taskKey
    ? input.acceptedTaskObservation?.taskKey === taskKey
      ? input.acceptedTaskObservation
      : { taskKey, startedAtMs: input.nowMs }
    : undefined;
  const stallBaselineMs = acceptedTaskObservation?.startedAtMs ?? input.lastProgressSeenAtMs;
  const effectiveStallTimeoutMs = resolvePaidImageChildStallTimeoutMs(input);
  return {
    acceptedTaskObservation,
    stallBaselineMs,
    effectiveStallTimeoutMs,
    shouldTerminate: input.nowMs - stallBaselineMs >= effectiveStallTimeoutMs
  };
}

export function shouldRefreshProgressSeenAtForPaidImageWait(input: PaidImageAcceptedTaskProgress): boolean {
  return !resolvePaidImageAcceptedTaskKey(input);
}

export function resolvePaidImageWaitStatus<T extends string>(input: {
  baseStatus: T;
  activeMainImageGeneration?: boolean;
  paidImageSubmitted?: number;
  publishProgressActive?: boolean;
  terminalFailureMessage?: string;
}): T | "external_service_wait" {
  return input.baseStatus === "running" && !input.terminalFailureMessage && !input.publishProgressActive &&
    input.activeMainImageGeneration && Number(input.paidImageSubmitted || 0) > 0
    ? "external_service_wait"
    : input.baseStatus;
}
