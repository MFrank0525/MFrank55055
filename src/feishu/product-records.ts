import type { FeishuBitableAttachment, FeishuBitableConfig, FeishuProductRecord } from "./types.js";
import type { FeishuBitableRecord } from "./client.js";
import { normalizeProductCategory } from "../autolist/product-category.js";
import { buildFeishuAttachmentIdentityDigest } from "../autolist/feishu-batch-rules.js";

type FeishuFieldKey = keyof FeishuBitableConfig["fieldMap"];

const FEISHU_FIELD_ALIASES: Record<FeishuFieldKey, string[]> = {
  userCognitionName: ["用户认知名", "消费者认知名称", "认知名", "商品认知名", "产品认知名"],
  genericName: ["通用名称", "商品通用名", "产品通用名", "通用名"],
  brand: ["品牌", "商品品牌", "产品品牌", "品牌名"],
  spu: ["SPU", "SPU编码", "SPU编号", "SPU信息", "spu"],
  sellingPointText: ["产品卖点", "卖点", "商品卖点", "核心卖点"],
  deepseekPromptText: ["DeepSeek提示词", "Deepseek提示词", "生图提示词", "海报提示词", "图片提示词"],
  mainImageInstructionText: ["主图指令", "主图要求", "主图提示", "主图说明"],
  positivePromptText: ["正向提示词", "正向词", "正向提示", "正面提示词"],
  negativePromptText: ["反向提示词", "反向词", "反向提示", "负面提示词"],
  titleKeywordText: ["标题关键词", "标题词", "标题关键字", "标题关键词组"],
  titleSuffixText: ["标题固定后缀", "固定后缀", "标题后缀", "商品标题后缀"],
  productPriceText: ["产品价格", "产品售价", "商品价格", "价格", "售价"],
  shortTitle: ["导购短标题", "短标题", "商品短标题", "导购标题"],
  productCategory: ["产品类目", "商品类目", "类目", "产品分类", "商品分类"],
  qualificationImages: ["资质图片", "资质附件", "资质图", "资格图片", "证照图片"],
  whiteBackgroundImages: ["白底图", "白底附件", "白底图片", "白底产品图", "白底源图"],
  manufacturerName: ["生产企业名称", "生产企业", "生产厂家", "生产商", "生产单位"],
  manufacturerAddress: ["生产企业地址", "生产地址", "生产厂家地址", "生产商地址"],
  netContent: ["净含量", "净含量规格", "净重", "含量"],
  productStandardCode: ["产品标准代码", "产品标准号", "标准号", "执行标准", "产品执行标准"],
  ingredients: ["配料表", "配料", "原料", "主要原料"],
  healthFunction: ["保健功能", "功效", "功能", "蓝帽功能"],
  specification: ["规格", "商品规格", "产品规格", "规格值"]
};

const COMMON_REQUIRED_FIELDS: FeishuFieldKey[] = [
  "userCognitionName",
  "genericName",
  "brand",
  "spu",
  "sellingPointText",
  "deepseekPromptText",
  "mainImageInstructionText",
  "positivePromptText",
  "negativePromptText",
  "titleKeywordText",
  "shortTitle",
  "productCategory",
  "qualificationImages",
  "whiteBackgroundImages"
];

const CATEGORY_REQUIRED_FIELDS: Record<ReturnType<typeof normalizeProductCategory>, FeishuFieldKey[]> = {
  医疗器械: [...COMMON_REQUIRED_FIELDS.slice(0, 10), "titleSuffixText", "productPriceText", ...COMMON_REQUIRED_FIELDS.slice(10)],
  非处方药: [...COMMON_REQUIRED_FIELDS.slice(0, 10), "titleSuffixText", "productPriceText", ...COMMON_REQUIRED_FIELDS.slice(10)],
  保健食品: [
    ...COMMON_REQUIRED_FIELDS,
    "productPriceText",
    "manufacturerName",
    "manufacturerAddress",
    "netContent",
    "productStandardCode",
    "ingredients",
    "healthFunction",
    "specification"
  ]
};

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
        raw: item
      };
    })
    .filter((item): item is FeishuBitableAttachment => item !== null);
}

function hasNonWhitespaceText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeFieldName(value: string): string {
  return value.replace(/\s+/g, "").replace(/[^\p{L}\p{N}]+/gu, "").toLowerCase();
}

function resolveFieldName(key: FeishuFieldKey, availableFieldNames: Iterable<string>, configuredName = ""): string {
  const available = Array.from(availableFieldNames).filter(Boolean);
  if (configuredName && available.includes(configuredName)) {
    return configuredName;
  }

  const normalizedAvailable = available.map((fieldName) => ({
    fieldName,
    normalized: normalizeFieldName(fieldName)
  }));
  const candidates = [configuredName, ...FEISHU_FIELD_ALIASES[key]].filter(Boolean).map(normalizeFieldName);
  const exact = normalizedAvailable.find((item) => candidates.includes(item.normalized));
  if (exact) {
    return exact.fieldName;
  }
  const contained = normalizedAvailable.find((item) =>
    candidates.some((candidate) => candidate && (item.normalized.includes(candidate) || candidate.includes(item.normalized)))
  );
  return contained?.fieldName || "";
}

export function resolveFeishuFieldMap(
  fieldMap: FeishuBitableConfig["fieldMap"],
  availableFieldNames: Iterable<string>
): FeishuBitableConfig["fieldMap"] {
  const entries = Object.keys(FEISHU_FIELD_ALIASES).map((key) => {
    const fieldKey = key as FeishuFieldKey;
    return [fieldKey, resolveFieldName(fieldKey, availableFieldNames, fieldMap[fieldKey])] as const;
  });
  return entries.reduce((output, [key, fieldName]) => {
    output[key] = fieldName;
    return output;
  }, {} as FeishuBitableConfig["fieldMap"]);
}

export function getRequiredFeishuProductFields(categoryValue: string | undefined): FeishuFieldKey[] {
  return CATEGORY_REQUIRED_FIELDS[normalizeProductCategory(categoryValue)];
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
  const fieldMap = resolveFeishuFieldMap(config.fieldMap, Object.keys(fields));
  const field = (key: keyof FeishuBitableConfig["fieldMap"]): unknown => {
    const fieldName = fieldMap[key];
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
    productCategory: normalizeProductCategory(extractText(field("productCategory"))),
    qualificationImages: extractAttachments(field("qualificationImages")),
    whiteBackgroundImages: extractAttachments(field("whiteBackgroundImages")),
    manufacturerName: extractText(field("manufacturerName")),
    manufacturerAddress: extractText(field("manufacturerAddress")),
    netContent: extractText(field("netContent")),
    productStandardCode: extractText(field("productStandardCode")),
    ingredients: extractText(field("ingredients")),
    healthFunction: extractText(field("healthFunction")),
    specification: extractText(field("specification")),
    rawFields: fields
  };
}

export function validateFeishuProductRecord(record: FeishuProductRecord): string[] {
  const missing: string[] = [];
  let category: ReturnType<typeof normalizeProductCategory> | undefined;
  let categoryError = "";
  try {
    category = normalizeProductCategory(record.productCategory);
  } catch (error) {
    categoryError = `productCategory(${error instanceof Error ? error.message : String(error)})`;
  }
  if (categoryError) missing.push(categoryError);
  if (!category) {
    return missing;
  }
  for (const key of getRequiredFeishuProductFields(category)) {
    const value = record[key as keyof FeishuProductRecord];
    if (Array.isArray(value)) {
      if (value.length === 0) missing.push(key);
      continue;
    }
    if (!hasNonWhitespaceText(value)) {
      missing.push(key);
    }
  }
  return missing;
}

function hasEmptyFeishuProductContent(record: FeishuProductRecord, includeCategory: boolean): boolean {
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
    (!includeCategory || !record.productCategory) &&
    record.qualificationImages.length === 0 &&
    record.whiteBackgroundImages.length === 0 &&
    !record.manufacturerName &&
    !record.manufacturerAddress &&
    !record.netContent &&
    !record.productStandardCode &&
    !record.ingredients &&
    !record.healthFunction &&
    !record.specification
  );
}

export function isEmptyFeishuProductRecord(record: FeishuProductRecord): boolean {
  const rawFields = record.rawFields && typeof record.rawFields === "object" ? Object.values(record.rawFields) : [];
  if (rawFields.length === 0) {
    return hasEmptyFeishuProductContent(record, false);
  }
  return hasEmptyFeishuProductContent(record, true);
}
