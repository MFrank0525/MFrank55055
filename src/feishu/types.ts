export interface FeishuBitableFieldMap {
  userCognitionName: string;
  genericName: string;
  brand: string;
  spu: string;
  sellingPointText: string;
  deepseekPromptText?: string;
  titleKeywordText?: string;
  shortTitle: string;
  productCategory?: string;
  qualificationImages: string;
  whiteBackgroundImages: string;
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
  name: string;
  size?: number;
  mimeType?: string;
  temporaryUrl?: string;
  downloadUrl?: string;
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
  titleKeywordText: string;
  shortTitle: string;
  productCategory?: string;
  qualificationImages: FeishuBitableAttachment[];
  whiteBackgroundImages: FeishuBitableAttachment[];
  rawFields: Record<string, unknown>;
}
