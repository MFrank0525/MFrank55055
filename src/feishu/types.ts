import type { ProductCategory } from "../autolist/product-category.js";

export interface FeishuBitableFieldMap {
  userCognitionName: string;
  genericName: string;
  brand: string;
  spu: string;
  sellingPointText: string;
  deepseekPromptText: string;
  mainImageInstructionText: string;
  positivePromptText: string;
  negativePromptText: string;
  titleKeywordText: string;
  titleSuffixText: string;
  productPriceText: string;
  shortTitle: string;
  productCategory: string;
  qualificationImages: string;
  whiteBackgroundImages: string;
  manufacturerName: string;
  manufacturerAddress: string;
  netContent: string;
  productStandardCode: string;
  ingredients: string;
  healthFunction: string;
  specification: string;
}

export interface FeishuBitableConfig {
  bitableUrl?: string;
  wikiNodeToken?: string;
  appToken: string;
  tableId: string;
  viewId?: string;
  pageSize?: number;
  fieldMap: FeishuBitableFieldMap;
  requiredFields?: Array<keyof FeishuBitableFieldMap>;
}

export interface FeishuBitableField {
  fieldId: string;
  fieldName: string;
  type?: number;
  raw: unknown;
}

export interface FeishuBitableAttachment {
  fileToken: string;
  identityDigest?: string;
  name: string;
  size?: number;
  mimeType?: string;
  temporaryUrl?: string;
  downloadUrl?: string;
  providerReferenceUrl?: string;
  localFile?: string;
  raw: unknown;
}

export interface FeishuProductRecord {
  recordId: string;
  userCognitionName: string;
  genericName: string;
  brand: string;
  spu: string;
  sellingPointText: string;
  deepseekPromptText: string;
  mainImageInstructionText: string;
  positivePromptText: string;
  negativePromptText: string;
  titleKeywordText: string;
  titleSuffixText: string;
  productPriceText: string;
  shortTitle: string;
  productCategory?: ProductCategory;
  qualificationImages: FeishuBitableAttachment[];
  whiteBackgroundImages: FeishuBitableAttachment[];
  manufacturerName: string;
  manufacturerAddress: string;
  netContent: string;
  productStandardCode: string;
  ingredients: string;
  healthFunction: string;
  specification: string;
  rawFields: Record<string, unknown>;
}

export interface FeishuProductPayload {
  schemaVersion: number;
  fieldMapVersion: number;
  batchFingerprint: string;
  ok?: boolean;
  count?: number;
  skippedEmptyCount?: number;
  missingMappedFields?: string[];
  invalidRecords?: Array<{ recordId: string; missing: string[] }>;
  records: FeishuProductRecord[];
  downloadedFiles?: string[];
  removedStaleFiles?: string[];
}
