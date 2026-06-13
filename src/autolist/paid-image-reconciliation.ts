export interface PaidImageProviderTaskReconciliationInput {
  requestedTaskId: string;
  slotCreatedAt?: string;
  payload: unknown;
}

export interface PaidImageProviderTaskReconciliation {
  taskId: string;
  status: string;
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
