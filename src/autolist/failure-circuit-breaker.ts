export interface PublishFailureCircuitState {
  signature: string;
  consecutive: number;
  open: boolean;
}

const EXCLUDED_FAILURE_CLASSES = new Set([
  "external_service_unavailable",
  "final_publish_state_uncertain",
  "spec_template_configuration_missing"
]);

const IMMEDIATE_FAILURE_CLASSES = new Set([
  "price_inventory_not_ready",
  "detail_qualification_not_ready",
  "doudian_login_required",
  "shop_context_mismatch"
]);

export function recordPublishFailure(
  state: PublishFailureCircuitState,
  input: { stage: string; errorClass: string; threshold?: number }
): PublishFailureCircuitState {
  if (EXCLUDED_FAILURE_CLASSES.has(input.errorClass)) {
    return { signature: "", consecutive: 0, open: false };
  }
  const signature = `${input.stage}:${input.errorClass}`;
  const consecutive = state.signature === signature ? state.consecutive + 1 : 1;
  const threshold = Math.max(1, input.threshold || 2);
  return {
    signature,
    consecutive,
    open: IMMEDIATE_FAILURE_CLASSES.has(input.errorClass) || consecutive >= threshold
  };
}
