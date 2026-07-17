export type AutoListingBatchProgressLabelInput = {
  completed?: number;
  current?: number;
  total?: number;
};

function boundedCount(value: number | undefined, total: number): number | undefined {
  return Number.isFinite(value) ? Math.max(0, Math.min(total, Number(value))) : undefined;
}

export function formatAutoListingBatchProgressLabel(input: AutoListingBatchProgressLabelInput): string {
  const total = Number(input.total || 0);
  if (!Number.isFinite(total) || total <= 0) return "飞书批次待确认";
  const completed = boundedCount(input.completed, total);
  const current = boundedCount(input.current, total);
  if (completed === undefined) return current && current > 0 ? `飞书当前第 ${current}/${total}` : "飞书批次待确认";
  return current && current > completed && completed < total
    ? `飞书批次已完成 ${completed}/${total}，当前第 ${current}/${total}`
    : `飞书批次已完成 ${completed}/${total}`;
}

export function formatAutoListingPublishProgressLabel(input: {
  completed?: number;
  current?: number;
  total: number;
  shopCurrent?: number;
  shopTotal: number;
}): string {
  const total = Math.max(1, input.total);
  const shopTotal = Math.max(1, input.shopTotal);
  const completed = boundedCount(input.completed, total);
  const current = Math.max(1, boundedCount(input.current, total) || 1);
  const shopCurrent = Math.max(1, boundedCount(input.shopCurrent, shopTotal) || 1);
  if (completed === undefined) return `当前目标 ${current}/${total}｜当前店铺 ${shopCurrent}/${shopTotal}`;
  if (completed >= total) return `发布已完成 ${completed}/${total}｜店铺已完成 ${shopTotal}/${shopTotal}`;
  return `发布已完成 ${completed}/${total}｜当前目标 ${current}/${total}｜当前店铺 ${shopCurrent}/${shopTotal}`;
}

export function shouldRetainStoppedControllerPublishCheckpoint(input: {
  controllerStatus?: string;
  currentTaskStatus?: string;
  publishProgressAvailable: boolean;
}): boolean {
  return input.publishProgressAvailable &&
    ["pause_requested", "pending_products", "failed"].includes(String(input.controllerStatus || "")) &&
    ["published", "cleaned"].includes(String(input.currentTaskStatus || ""));
}

export function resolveAutoListingPublishGroupIdentity(
  entry: { batchFingerprint?: string; recordId?: string; taskId?: string; targetIdentity?: { batchFingerprint?: string; recordId?: string; taskId?: string } },
  fallbackName: string
): string {
  const identity = entry.targetIdentity || {};
  const recordId = String(entry.recordId || identity.recordId || "").trim();
  if (!recordId) return `name:${fallbackName}`;
  return [entry.batchFingerprint || identity.batchFingerprint || "", recordId, entry.taskId || identity.taskId || ""].join("::");
}

export function replaceAutoListingPublishProgressProductName(progressText: string, productName?: string): string {
  return productName?.trim() ? progressText.replace(/^当前商品：[^，]+，/, `当前商品：${productName.trim()}，`) : progressText;
}
