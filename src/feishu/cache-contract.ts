import { validateFeishuProductRecord } from "./product-records.js";
import { buildFeishuBatchFingerprint } from "../autolist/feishu-batch-rules.js";
import type { FeishuProductPayload, FeishuProductRecord } from "./types.js";

export const FEISHU_CACHE_SCHEMA_VERSION = 2;
export const FEISHU_FIELD_MAP_VERSION = 2;

function assertObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

export function validateFeishuProductPayload(input: unknown): FeishuProductPayload {
  const payload = assertObject(input, "Feishu product cache");
  if (payload.schemaVersion !== FEISHU_CACHE_SCHEMA_VERSION) {
    throw new Error(
      `Feishu cache schemaVersion mismatch: expected ${FEISHU_CACHE_SCHEMA_VERSION}, got ${String(payload.schemaVersion || "missing")}.`
    );
  }
  if (payload.fieldMapVersion !== FEISHU_FIELD_MAP_VERSION) {
    throw new Error(
      `Feishu cache fieldMapVersion mismatch: expected ${FEISHU_FIELD_MAP_VERSION}, got ${String(payload.fieldMapVersion || "missing")}.`
    );
  }
  if (typeof payload.batchFingerprint !== "string" || !payload.batchFingerprint.trim()) {
    throw new Error("Feishu cache batchFingerprint is required.");
  }
  if (!Array.isArray(payload.records)) {
    throw new Error("Feishu cache records must be an array.");
  }

  const records = payload.records as FeishuProductRecord[];
  const invalid = records.flatMap((record, index) => {
    const recordId = String(record?.recordId || `row-${index + 1}`);
    return validateFeishuProductRecord(record).map((field) => `${recordId}:${field}`);
  });
  if (invalid.length > 0) {
    throw new Error(`Feishu cache record validation failed: ${invalid.join(", ")}`);
  }
  const expectedBatchFingerprint = buildFeishuBatchFingerprint(records);
  if (payload.batchFingerprint.trim() !== expectedBatchFingerprint) {
    throw new Error(
      `Feishu cache batchFingerprint mismatch: expected ${expectedBatchFingerprint}, got ${payload.batchFingerprint.trim()}.`
    );
  }

  return {
    ...(payload as unknown as FeishuProductPayload),
    schemaVersion: FEISHU_CACHE_SCHEMA_VERSION,
    fieldMapVersion: FEISHU_FIELD_MAP_VERSION,
    batchFingerprint: expectedBatchFingerprint,
    records
  };
}
