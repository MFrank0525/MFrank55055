import crypto from "node:crypto";
import path from "node:path";
import type { FeishuProductRecord } from "../feishu/types.js";

function attachmentIdentity(item: { fileToken?: string; name?: string; size?: number; localFile?: string }): Record<string, unknown> {
  return {
    fileToken: item.fileToken || "",
    name: item.name || "",
    size: item.size || 0
  };
}

export function buildFeishuBatchIdentityFingerprint(records: FeishuProductRecord[]): string {
  const payload = records.map((record, index) => ({
    index,
    recordId: record.recordId || "",
    userCognitionName: record.userCognitionName || "",
    genericName: record.genericName || "",
    brand: record.brand || "",
    spu: record.spu || "",
    whiteBackgroundImages: (record.whiteBackgroundImages || []).map(attachmentIdentity),
    qualificationImages: (record.qualificationImages || []).map(attachmentIdentity)
  }));
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 24);
}

export function buildFeishuBatchFingerprint(records: FeishuProductRecord[]): string {
  return buildFeishuBatchIdentityFingerprint(records);
}
