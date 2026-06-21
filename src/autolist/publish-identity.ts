export interface PublishTargetIdentity {
  batchFingerprint: string;
  recordId: string;
  taskId: string;
  shopCode: string;
  watermarkNo: number;
}

function requiredText(value: string | undefined, label: string): string {
  const normalized = String(value || "").trim();
  if (!normalized) {
    throw new Error(`Publish target identity ${label} is required.`);
  }
  return normalized;
}

export function buildPublishTargetIdentity(input: PublishTargetIdentity): PublishTargetIdentity {
  const watermarkNo = Number(input.watermarkNo);
  if (!Number.isInteger(watermarkNo) || watermarkNo <= 0) {
    throw new Error("Publish target identity watermarkNo must be a positive integer.");
  }
  return {
    batchFingerprint: requiredText(input.batchFingerprint, "batchFingerprint"),
    recordId: requiredText(input.recordId, "recordId"),
    taskId: requiredText(input.taskId, "taskId"),
    shopCode: requiredText(input.shopCode, "shopCode"),
    watermarkNo
  };
}

export function publishTargetKey(input: PublishTargetIdentity): string {
  const identity = buildPublishTargetIdentity(input);
  return [
    identity.batchFingerprint,
    identity.recordId,
    identity.taskId,
    identity.shopCode,
    String(identity.watermarkNo).padStart(2, "0")
  ].map(encodeURIComponent).join("__");
}
