export interface PaidImageProviderTaskReconciliationInput {
  requestedTaskId: string;
  slotCreatedAt?: string;
  payload: unknown;
}

export interface PaidImageProviderTaskReconciliation {
  taskId: string;
  status: string;
}

export interface ProviderNoAcceptanceSlotEvidence {
  slot: number;
  updatedAt: string;
  responseStatus: number;
}

export interface ProviderTokenLogEntry {
  id?: unknown;
  created_at?: unknown;
  type?: unknown;
  model?: unknown;
  model_name?: unknown;
  quota?: unknown;
  content?: unknown;
  request_id?: unknown;
  upstream_request_id?: unknown;
  other?: unknown;
}

export interface ProviderNoAcceptanceLogMatch {
  slot: number;
  logId: string;
  logCreatedAt: number;
  clockSkewMs: number;
}

export interface ProviderBilledAcceptanceLogMatch {
  slot: number;
  logId: string;
  logCreatedAt: number;
  postResponseLagMs: number;
  requestId: string;
  upstreamRequestId: string;
}

const PROVIDER_NO_ACCEPTANCE_GATEWAY_STATUSES = new Set([502, 503, 504, 520, 521, 522, 523, 524]);

function providerLogOther(log: ProviderTokenLogEntry): Record<string, unknown> {
  if (log.other && typeof log.other === "object" && !Array.isArray(log.other)) {
    return log.other as Record<string, unknown>;
  }
  if (typeof log.other !== "string") return {};
  try {
    const parsed = JSON.parse(log.other) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function exactBilledTaskAcceptance(log: ProviderTokenLogEntry, model: string): {
  requestId: string;
  upstreamRequestId: string;
} | undefined {
  const loggedModel = String(log.model_name ?? log.model ?? "").trim();
  const requestId = String(log.request_id ?? "").trim();
  const upstreamRequestId = String(log.upstream_request_id ?? "").trim();
  const other = providerLogOther(log);
  if (
    Number(log.type) !== 2 ||
    loggedModel !== model ||
    !(Number(log.quota) > 0) ||
    String(log.content ?? "").trim() !== "操作 textGenerate，按次计费" ||
    !requestId ||
    !upstreamRequestId ||
    other.request_path !== "/v1/videos" ||
    other.is_task !== true
  ) {
    return undefined;
  }
  return { requestId, upstreamRequestId };
}

export function matchProviderBilledAcceptanceAfterGateway(input: {
  model: string;
  maximumPostResponseLagMs: number;
  slots: ProviderNoAcceptanceSlotEvidence[];
  logs: ProviderTokenLogEntry[];
}): ProviderBilledAcceptanceLogMatch[] {
  if (!input.model.trim()) {
    throw new Error("provider model is required for billed acceptance reconciliation");
  }
  if (!Number.isFinite(input.maximumPostResponseLagMs) || input.maximumPostResponseLagMs < 0) {
    throw new Error("maximumPostResponseLagMs must be a non-negative finite number");
  }
  const candidatesBySlot = input.slots.map((slot) => {
    const responseAtMs = Date.parse(slot.updatedAt);
    if (
      !Number.isInteger(slot.slot) ||
      slot.slot <= 0 ||
      !Number.isFinite(responseAtMs) ||
      !isProviderNoAcceptanceGatewayStatus(slot.responseStatus)
    ) {
      throw new Error(`slot ${slot.slot} lacks valid HTTP gateway billed-acceptance evidence`);
    }
    const candidates = input.logs.flatMap((log) => {
      const accepted = exactBilledTaskAcceptance(log, input.model);
      const createdAtSeconds = Number(log.created_at);
      const logId = String(log.id ?? "").trim();
      const postResponseLagMs = createdAtSeconds * 1000 - responseAtMs;
      return accepted && logId && Number.isFinite(createdAtSeconds) && postResponseLagMs >= 0 && postResponseLagMs <= input.maximumPostResponseLagMs
        ? [{
            slot: slot.slot,
            logId,
            logCreatedAt: createdAtSeconds,
            postResponseLagMs,
            requestId: accepted.requestId,
            upstreamRequestId: accepted.upstreamRequestId
          }]
        : [];
    });
    if (candidates.length === 0) {
      throw new Error(
        `slot ${slot.slot} requires a one-to-one set of unique post-gateway billed acceptance logs; found no candidate`
      );
    }
    candidates.sort((left, right) => left.postResponseLagMs - right.postResponseLagMs || left.logId.localeCompare(right.logId, undefined, { numeric: true }));
    return { slot: slot.slot, candidates };
  });
  const relevantLogIds = new Set(candidatesBySlot.flatMap((entry) => entry.candidates.map((candidate) => candidate.logId)));
  if (relevantLogIds.size !== input.slots.length) {
    throw new Error("provider logs do not form a one-to-one set of unique post-gateway billed acceptance logs");
  }
  const ordered = [...candidatesBySlot].sort(
    (left, right) => left.candidates.length - right.candidates.length || left.slot - right.slot
  );
  const assigned = new Map<number, ProviderBilledAcceptanceLogMatch>();
  const usedLogIds = new Set<string>();
  const findMatching = (index: number): boolean => {
    if (index >= ordered.length) return true;
    const entry = ordered[index];
    for (const candidate of entry.candidates) {
      if (usedLogIds.has(candidate.logId)) continue;
      usedLogIds.add(candidate.logId);
      assigned.set(entry.slot, candidate);
      if (findMatching(index + 1)) return true;
      assigned.delete(entry.slot);
      usedLogIds.delete(candidate.logId);
    }
    return false;
  };
  if (!findMatching(0)) {
    throw new Error("provider logs do not form a one-to-one set of unique post-gateway billed acceptance logs");
  }
  return input.slots.map((slot) => assigned.get(slot.slot) as ProviderBilledAcceptanceLogMatch);
}

export function isProviderNoAcceptanceGatewayStatus(status: number): boolean {
  return PROVIDER_NO_ACCEPTANCE_GATEWAY_STATUSES.has(status);
}

function exactZeroBilledGatewayNoAcceptanceStatus(
  log: ProviderTokenLogEntry,
  model: string
): number | undefined {
  const loggedModel = String(log.model_name ?? log.model ?? "").trim();
  const upstreamRequestId = String(log.upstream_request_id ?? "").trim();
  if (Number(log.type) !== 5 || loggedModel !== model || Number(log.quota) !== 0 || upstreamRequestId !== "") {
    return undefined;
  }
  const match = /^status_code=(\d{3}), error code: (\d{3})$/.exec(String(log.content ?? "").trim());
  if (!match || match[1] !== match[2]) {
    return undefined;
  }
  const status = Number(match[1]);
  return isProviderNoAcceptanceGatewayStatus(status) ? status : undefined;
}

export function matchProviderNoAcceptanceLogs(input: {
  model: string;
  maximumClockSkewMs: number;
  slots: ProviderNoAcceptanceSlotEvidence[];
  logs: ProviderTokenLogEntry[];
}): ProviderNoAcceptanceLogMatch[] {
  if (!input.model.trim()) {
    throw new Error("provider model is required for no-acceptance log reconciliation");
  }
  if (!Number.isFinite(input.maximumClockSkewMs) || input.maximumClockSkewMs < 0) {
    throw new Error("maximumClockSkewMs must be a non-negative finite number");
  }

  const candidatesBySlot = input.slots.map((slot) => {
    const slotUpdatedAtMs = Date.parse(slot.updatedAt);
    if (
      !Number.isInteger(slot.slot) ||
      slot.slot <= 0 ||
      !Number.isFinite(slotUpdatedAtMs) ||
      !isProviderNoAcceptanceGatewayStatus(slot.responseStatus)
    ) {
      throw new Error(`slot ${slot.slot} lacks valid HTTP gateway no-acceptance reconciliation evidence`);
    }
    const candidates = input.logs.flatMap((log) => {
      if (exactZeroBilledGatewayNoAcceptanceStatus(log, input.model) !== slot.responseStatus) {
        return [];
      }
      const createdAtSeconds = Number(log.created_at);
      const logId = String(log.id ?? "").trim();
      const clockSkewMs = Math.abs(createdAtSeconds * 1000 - slotUpdatedAtMs);
      return logId && Number.isFinite(createdAtSeconds) && clockSkewMs <= input.maximumClockSkewMs
        ? [{ slot: slot.slot, logId, logCreatedAt: createdAtSeconds, clockSkewMs }]
        : [];
    });
    if (candidates.length === 0) {
      throw new Error(
        `slot ${slot.slot} requires a one-to-one set of unique zero-billed no-acceptance logs; found no candidate`
      );
    }
    candidates.sort((left, right) => left.clockSkewMs - right.clockSkewMs || left.logId.localeCompare(right.logId, undefined, { numeric: true }));
    return { slot: slot.slot, candidates };
  });

  const relevantLogIds = new Set(candidatesBySlot.flatMap((entry) => entry.candidates.map((candidate) => candidate.logId)));
  if (relevantLogIds.size !== input.slots.length) {
    throw new Error(
      `provider logs do not form a one-to-one set of unique zero-billed no-acceptance logs: slots=${input.slots.length}, logs=${relevantLogIds.size}`
    );
  }

  const ordered = [...candidatesBySlot].sort(
    (left, right) => left.candidates.length - right.candidates.length || left.slot - right.slot
  );
  const assigned = new Map<number, ProviderNoAcceptanceLogMatch>();
  const usedLogIds = new Set<string>();
  const findMatching = (index: number): boolean => {
    if (index >= ordered.length) return true;
    const entry = ordered[index];
    for (const candidate of entry.candidates) {
      if (usedLogIds.has(candidate.logId)) continue;
      usedLogIds.add(candidate.logId);
      assigned.set(entry.slot, candidate);
      if (findMatching(index + 1)) return true;
      assigned.delete(entry.slot);
      usedLogIds.delete(candidate.logId);
    }
    return false;
  };
  if (!findMatching(0)) {
    throw new Error("provider logs do not form a one-to-one set of unique zero-billed no-acceptance logs");
  }
  return input.slots.map((slot) => assigned.get(slot.slot) as ProviderNoAcceptanceLogMatch);
}

export async function matchProviderNoAcceptanceLogsWithRefresh(input: {
  model: string;
  maximumClockSkewMs: number;
  maximumAttempts: number;
  slots: ProviderNoAcceptanceSlotEvidence[];
  loadLogs: () => Promise<ProviderTokenLogEntry[]>;
  waitBeforeRetry: (completedAttempt: number) => Promise<void>;
}): Promise<ProviderNoAcceptanceLogMatch[]> {
  if (!Number.isInteger(input.maximumAttempts) || input.maximumAttempts <= 0) {
    throw new Error("maximumAttempts must be a positive integer for provider log reconciliation");
  }
  let lastMatchError: unknown;
  for (let attempt = 1; attempt <= input.maximumAttempts; attempt += 1) {
    const logs = await input.loadLogs();
    try {
      return matchProviderNoAcceptanceLogs({
        model: input.model,
        maximumClockSkewMs: input.maximumClockSkewMs,
        slots: input.slots,
        logs
      });
    } catch (error) {
      lastMatchError = error;
      if (attempt < input.maximumAttempts) {
        await input.waitBeforeRetry(attempt);
      }
    }
  }
  throw lastMatchError instanceof Error
    ? lastMatchError
    : new Error("provider logs did not produce a safe no-acceptance match after bounded refresh");
}

export function validatePaidImageProviderTaskForReconciliation(
  input: PaidImageProviderTaskReconciliationInput
): PaidImageProviderTaskReconciliation {
  const payload = input.payload as { id?: unknown; status?: unknown; data?: { id?: unknown; status?: unknown } };
  const taskId = String(payload?.id ?? payload?.data?.id ?? "").trim();
  const status = String(payload?.status ?? payload?.data?.status ?? "").trim().toLowerCase();
  if (!taskId || taskId !== input.requestedTaskId) {
    throw new Error(`provider task id mismatch: expected ${input.requestedTaskId}, received ${taskId || "missing"}`);
  }
  if (!status) {
    throw new Error(`provider task ${taskId} did not include a status`);
  }
  if (/fail|error|cancel|reject/.test(status)) {
    throw new Error(`failed provider task ${taskId} cannot reconcile an ambiguous paid image slot: ${status}`);
  }
  if (input.slotCreatedAt) {
    const providerCreatedAtSeconds = Number((payload as { created_at?: unknown; data?: { created_at?: unknown } })?.created_at ??
      (payload as { data?: { created_at?: unknown } })?.data?.created_at);
    const slotCreatedAtMs = Date.parse(input.slotCreatedAt);
    const providerCreatedAtMs = providerCreatedAtSeconds * 1000;
    if (
      !Number.isFinite(providerCreatedAtSeconds) ||
      !Number.isFinite(slotCreatedAtMs) ||
      Math.abs(providerCreatedAtMs - slotCreatedAtMs) > 10 * 60_000
    ) {
      throw new Error(`provider task ${taskId} creation time does not match the ambiguous slot submission window`);
    }
  }
  return { taskId, status };
}
