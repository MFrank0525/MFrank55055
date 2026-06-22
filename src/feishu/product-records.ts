import type { FeishuBitableAttachment, FeishuBitableConfig, FeishuProductRecord } from "./types.js";
import type { FeishuBitableRecord } from "./client.js";
import { normalizeProductCategory } from "../autolist/product-category.js";
import { buildFeishuAttachmentIdentityDigest } from "../autolist/feishu-batch-rules.js";

function extractText(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value).trim();
  }
  if (Array.isArray(value)) {
    if (
      value.every((item) => item && typeof item === "object" && typeof (item as Record<string, unknown>).text === "string")
    ) {
      return value
        .map((item) => String((item as Record<string, unknown>).text || ""))
        .join("")
        .trim();
    }
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
        providerReferenceUrl:
          typeof object.tmp_url === "string" && object.tmp_url.trim()
            ? object.tmp_url.trim()
            : typeof object.url === "string" && object.url.trim()
              ? object.url.trim()
              : undefined,
        raw: item
      };
    })
    .filter((item): item is FeishuBitableAttachment => item !== null);
}

function sanitizeFeishuFieldValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeFeishuFieldValue(item));
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
    if (/^(tmp_url|url|download_url)$/i.test(key)) {
      sanitized[key] = "[redacted feishu media url]";
      continue;
    }
    if (/token/i.test(key)) {
      sanitized[key] = "[redacted]";
      continue;
    }
    sanitized[key] = sanitizeFeishuFieldValue(nestedValue);
  }
  return sanitized;
}

function sanitizeAttachment(attachment: FeishuBitableAttachment): FeishuBitableAttachment {
  return {
    fileToken: attachment.fileToken ? "[redacted]" : "",
    identityDigest: attachment.identityDigest || buildFeishuAttachmentIdentityDigest(attachment.fileToken || ""),
    name: attachment.name,
    size: attachment.size,
    mimeType: attachment.mimeType,
    temporaryUrl: attachment.temporaryUrl ? "[redacted feishu media url]" : undefined,
    downloadUrl: attachment.downloadUrl ? "[redacted feishu media url]" : undefined,
    providerReferenceUrl: attachment.providerReferenceUrl ? "[redacted feishu media url]" : undefined,
    localFile: attachment.localFile,
    raw: sanitizeFeishuFieldValue(attachment.raw)
  };
}

export function sanitizeFeishuProductRecord(record: FeishuProductRecord): FeishuProductRecord {
  return {
    ...record,
    qualificationImages: record.qualificationImages.map(sanitizeAttachment),
    whiteBackgroundImages: record.whiteBackgroundImages.map(sanitizeAttachment),
    rawFields: sanitizeFeishuFieldValue(record.rawFields) as Record<string, unknown>
  };
}

export function normalizeFeishuProductRecord(record: FeishuBitableRecord, config: FeishuBitableConfig): FeishuProductRecord {
  const fields = record.fields;
  const field = (key: keyof FeishuBitableConfig["fieldMap"]): unknown => {
    const fieldName = config.fieldMap[key];
    return fieldName ? fields[fieldName] : undefined;
  };

  return {
    recordId: record.recordId,
    userCognitionName: extractText(field("userCognitionName")),
    genericName: extractText(field("genericName")),
    brand: extractText(field("brand")),
    spu: extractText(field("spu")),
    sellingPointText: extractText(field("sellingPointText")),
    deepseekPromptText: extractText(field("deepseekPromptText")),
    mainImageInstructionText: extractText(field("mainImageInstructionText")),
    positivePromptText: extractText(field("positivePromptText")),
    negativePromptText: extractText(field("negativePromptText")),
    titleKeywordText: extractText(field("titleKeywordText")),
    titleSuffixText: extractText(field("titleSuffixText")),
    productPriceText: extractText(field("productPriceText")),
    shortTitle: extractText(field("shortTitle")),
    productCategory: extractText(field("productCategory")),
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
  if (!record.deepseekPromptText) missing.push("deepseekPromptText");
  if (!record.mainImageInstructionText) missing.push("mainImageInstructionText");
  if (!record.positivePromptText) missing.push("positivePromptText");
  if (!record.negativePromptText) missing.push("negativePromptText");
  if (!record.titleKeywordText) missing.push("titleKeywordText");
  if (!record.titleSuffixText) missing.push("titleSuffixText");
  if (!record.productPriceText) missing.push("productPriceText");
  if (!record.shortTitle) missing.push("shortTitle");
  if (!record.qualificationImages.length) missing.push("qualificationImages");
  if (!record.whiteBackgroundImages.length) missing.push("whiteBackgroundImages");
  try {
    normalizeProductCategory(record.productCategory);
  } catch (error) {
    missing.push(`productCategory(${error instanceof Error ? error.message : String(error)})`);
  }
  return missing;
}

export function isEmptyFeishuProductRecord(record: FeishuProductRecord): boolean {
  return (
    !record.userCognitionName &&
    !record.genericName &&
    !record.brand &&
    !record.spu &&
    !record.sellingPointText &&
    !record.deepseekPromptText &&
    !record.mainImageInstructionText &&
    !record.positivePromptText &&
    !record.negativePromptText &&
    !record.titleKeywordText &&
    !record.titleSuffixText &&
    !record.productPriceText &&
    !record.shortTitle &&
    !record.productCategory &&
    record.qualificationImages.length === 0 &&
    record.whiteBackgroundImages.length === 0
  );
}
