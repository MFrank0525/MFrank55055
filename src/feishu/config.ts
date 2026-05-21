import fs from "node:fs";
import path from "node:path";
import type { FeishuBitableConfig, FeishuBitableFieldMap } from "./types.js";

const REQUIRED_FIELD_MAP_KEYS: Array<keyof FeishuBitableFieldMap> = [
  "userCognitionName",
  "genericName",
  "brand",
  "spu",
  "sellingPointText",
  "shortTitle",
  "productCategory",
  "qualificationImages",
  "whiteBackgroundImages"
];

function readJsonFile(filePath: string): unknown {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Feishu config file not found: ${resolved}`);
  }
  return JSON.parse(fs.readFileSync(resolved, "utf8")) as unknown;
}

function readString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Feishu config missing required field: ${label}`);
  }
  return value.trim();
}

function parseBitableUrl(url: string): { appToken?: string; tableId?: string; viewId?: string; wikiNodeToken?: string } {
  if (!url.trim()) {
    return {};
  }
  const appToken = url.match(/\/(?:base|apps)\/([^/?#]+)/)?.[1] || "";
  const wikiNodeToken = url.match(/\/wiki\/([^/?#]+)/)?.[1] || "";
  const tableId = url.match(/[?&]table=([^&#]+)/)?.[1] || url.match(/\/tables\/([^/?#]+)/)?.[1] || "";
  const viewId = url.match(/[?&]view=([^&#]+)/)?.[1] || url.match(/\/views\/([^/?#]+)/)?.[1] || "";
  return {
    appToken: appToken ? decodeURIComponent(appToken) : undefined,
    tableId: tableId ? decodeURIComponent(tableId) : undefined,
    viewId: viewId ? decodeURIComponent(viewId) : undefined,
    wikiNodeToken: wikiNodeToken ? decodeURIComponent(wikiNodeToken) : undefined
  };
}

export function loadFeishuBitableConfig(configFile: string): FeishuBitableConfig {
  const parsed = readJsonFile(configFile);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Feishu config must be a JSON object.");
  }

  const input = parsed as Partial<FeishuBitableConfig>;
  const envAppToken = process.env.FEISHU_BITABLE_APP_TOKEN || process.env.FEISHU_APP_TOKEN || "";
  const envTableId = process.env.FEISHU_BITABLE_TABLE_ID || process.env.FEISHU_TABLE_ID || "";
  const envViewId = process.env.FEISHU_BITABLE_VIEW_ID || process.env.FEISHU_VIEW_ID || "";
  const envWikiNodeToken = process.env.FEISHU_WIKI_NODE_TOKEN || "";
  const parsedUrl = parseBitableUrl(input.bitableUrl || process.env.FEISHU_BITABLE_URL || "");

  const fieldMap = input.fieldMap;
  if (!fieldMap || typeof fieldMap !== "object" || Array.isArray(fieldMap)) {
    throw new Error("Feishu config missing required field: fieldMap");
  }

  for (const key of REQUIRED_FIELD_MAP_KEYS) {
    readString(fieldMap[key], `fieldMap.${key}`);
  }

  return {
    bitableUrl: input.bitableUrl || process.env.FEISHU_BITABLE_URL || undefined,
    wikiNodeToken: (input.wikiNodeToken || envWikiNodeToken || parsedUrl.wikiNodeToken || "").trim() || undefined,
    appToken: (input.appToken || envAppToken || parsedUrl.appToken || "").trim(),
    tableId: (input.tableId || envTableId || parsedUrl.tableId || "").trim(),
    viewId: (input.viewId || envViewId || parsedUrl.viewId || "").trim() || undefined,
    pageSize: input.pageSize || 100,
    fieldMap: {
      userCognitionName: readString(fieldMap.userCognitionName, "fieldMap.userCognitionName"),
      genericName: readString(fieldMap.genericName, "fieldMap.genericName"),
      brand: readString(fieldMap.brand, "fieldMap.brand"),
      spu: readString(fieldMap.spu, "fieldMap.spu"),
      sellingPointText: readString(fieldMap.sellingPointText, "fieldMap.sellingPointText"),
      shortTitle: readString(fieldMap.shortTitle, "fieldMap.shortTitle"),
      productCategory: readString(fieldMap.productCategory, "fieldMap.productCategory"),
      qualificationImages: readString(fieldMap.qualificationImages, "fieldMap.qualificationImages"),
      whiteBackgroundImages: readString(fieldMap.whiteBackgroundImages, "fieldMap.whiteBackgroundImages")
    },
    requiredFields: input.requiredFields?.length ? input.requiredFields : REQUIRED_FIELD_MAP_KEYS
  };
}

export function assertFeishuBitableConfigReady(config: FeishuBitableConfig): void {
  const missing: string[] = [];
  if (!config.appToken) {
    missing.push("appToken or FEISHU_BITABLE_APP_TOKEN");
  }
  if (!config.tableId) {
    missing.push("tableId or FEISHU_BITABLE_TABLE_ID");
  }
  if (missing.length) {
    throw new Error(`Feishu bitable config incomplete: ${missing.join(", ")}`);
  }
}
