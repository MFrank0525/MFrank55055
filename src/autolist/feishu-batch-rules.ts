import crypto from "node:crypto";
import path from "node:path";
import type { FeishuProductRecord } from "../feishu/types.js";

export function buildFeishuAttachmentIdentityDigest(fileToken: string): string {
  return fileToken ? crypto.createHash("sha256").update(fileToken).digest("hex").slice(0, 16) : "";
}

function attachmentIdentity(item: {
  fileToken?: string;
  identityDigest?: string;
  name?: string;
  size?: number;
  localFile?: string;
}): Record<string, unknown> {
  return {
    identityDigest: item.identityDigest || buildFeishuAttachmentIdentityDigest(item.fileToken || ""),
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

export function canResumeFeishuBatchArtifacts(input: {
  currentBatchFingerprint?: string;
  resumeBatchFingerprint?: string;
}): boolean {
  return Boolean(
    input.currentBatchFingerprint &&
      input.resumeBatchFingerprint &&
      input.currentBatchFingerprint === input.resumeBatchFingerprint
  );
}
