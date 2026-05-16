import type { FeishuBitableAttachment, FeishuBitableConfig, FeishuProductRecord } from "./types.js";
import type { FeishuBitableRecord } from "./client.js";

function extractText(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value).trim();
  }
  if (Array.isArray(value)) {
    return value.map((item) => extractText(item)).filter(Boolean).join(",").trim();
  }
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    for (const key of ["text", "name", "title", "link", "url", "email", "phone"]) {
      if (typeof object[key] === "string" && object[key].trim()) {
        return object[key].trim();
      }
    }
  }
  return "";
}

function extractAttachments(value: unknown): FeishuBitableAttachment[] {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return values
    .map((item): FeishuBitableAttachment | null => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const object = item as Record<string, unknown>;
      const fileToken = String(object.file_token || object.fileToken || object.token || "").trim();
      const name = String(object.name || object.file_name || object.fileName || "").trim();
      if (!fileToken && !name) {
        return null;
      }
      return {
        fileToken,
        name,
        size: typeof object.size === "number" ? object.size : undefined,
        mimeType: typeof object.mime_type === "string" ? object.mime_type : undefined,
        temporaryUrl: typeof object.tmp_url === "string" ? object.tmp_url : typeof object.url === "string" ? object.url : undefined,
        downloadUrl: typeof object.url === "string" ? object.url : undefined,
        raw: item
      };
    })
    .filter((item): item is FeishuBitableAttachment => item !== null);
}

export function normalizeFeishuProductRecord(record: FeishuBitableRecord, config: FeishuBitableConfig): FeishuProductRecord {
  const fields = record.fields;
  const field = (key: keyof FeishuBitableConfig["fieldMap"]): unknown => fields[config.fieldMap[key]];

  return {
    recordId: record.recordId,
    userCognitionName: extractText(field("userCognitionName")),
    genericName: extractText(field("genericName")),
    brand: extractText(field("brand")),
    spu: extractText(field("spu")),
    sellingPointText: extractText(field("sellingPointText")),
    shortTitle: extractText(field("shortTitle")),
    qualificationImages: extractAttachments(field("qualificationImages")),
    whiteBackgroundImages: extractAttachments(field("whiteBackgroundImages")),
    rawFields: fields
  };
}

export function validateFeishuProductRecord(record: FeishuProductRecord): string[] {
  const missing: string[] = [];
  if (!record.userCognitionName) missing.push("userCognitionName");
  if (!record.genericName) missing.push("genericName");
  if (!record.brand) missing.push("brand");
  if (!record.spu) missing.push("spu");
  if (!record.sellingPointText) missing.push("sellingPointText");
  if (!record.shortTitle) missing.push("shortTitle");
  if (!record.qualificationImages.length) missing.push("qualificationImages");
  if (!record.whiteBackgroundImages.length) missing.push("whiteBackgroundImages");
  return missing;
}

export function isEmptyFeishuProductRecord(record: FeishuProductRecord): boolean {
  return (
    !record.userCognitionName &&
    !record.genericName &&
    !record.brand &&
    !record.spu &&
    !record.sellingPointText &&
    !record.shortTitle &&
    record.qualificationImages.length === 0 &&
    record.whiteBackgroundImages.length === 0
  );
}
