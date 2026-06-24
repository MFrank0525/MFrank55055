import type { ProductCategory } from "../../autolist/product-category.js";
import type { PublishTargetIdentity } from "../../autolist/publish-identity.js";

export interface PublishFromSpuMetadata {
  brand?: string;
  spu?: string;
  title?: string;
  shortTitle?: string;
  modelSpec?: string;
  productPriceText?: string;
  feishuRecordId?: string;
  productCategory?: ProductCategory;
  manufacturerName?: string;
  manufacturerAddress?: string;
  netContent?: string;
  productStandardCode?: string;
  ingredients?: string;
  healthFunction?: string;
  specification?: string;
  canonicalIdentity?: PublishTargetIdentity;
}

export interface ResolvedPublishFromSpuMetadata extends PublishFromSpuMetadata {
  brand: string;
  spu: string;
  title: string;
  shortTitle: string;
  modelSpec: string;
  productPriceText: string;
}

export interface PublishFromSpuJobInput {
  shopFolder: string;
  productFolder: string;
  mode?:
    | "prepare"
    | "open_platform_spu"
    | "query_platform_spu"
    | "inspect_publish_page"
    | "run_publish_flow"
    | "run_graphic_flow"
    | "run_pre_publish_flow"
    | "run_service_flow";
  metadata?: PublishFromSpuMetadata;
  publishPageUrl?: string;
  headless?: boolean;
  retryOnSystemError?: boolean;
}

export interface PublishFromSpuJobOptions {
  runId?: string;
  runtimeDir?: string;
  resultFile?: string;
  onProgress?: (message: string) => void;
}

export interface PublishFromSpuJobResult {
  ok: boolean;
  status: string;
  message: string;
  startedAt: string;
  finishedAt: string;
  runtimeDir: string;
  artifacts: {
    resultFile: string;
    screenshots: string[];
  };
  data?: unknown;
  error?: {
    code: string;
    message: string;
    stack?: string;
  };
}

export interface ProductSheetSummary {
  brand?: string;
  spu?: string;
  title?: string;
  shortTitle?: string;
  modelSpec?: string;
  productPriceText?: string;
  rows: string[][];
  parseError?: string;
}

export interface ProductAssets {
  workbookFile?: string;
  mainImages: string[];
  whiteBackgroundImages: string[];
  detailImages: string[];
  otherFiles: string[];
}

export interface ImageDimensions {
  width: number;
  height: number;
}

export interface QueryMatchCandidate {
  rowText: string;
  normalizedText: string;
  rowId: string;
  exactSpuCell: boolean;
  exactBrandCell: boolean;
  rowHasSpu: boolean;
  rowHasBrand: boolean;
}

export interface QueryDiagnosticError extends Error {
  screenshotFile?: string;
  candidateRows?: string[];
  candidateIds?: string[];
}

export type PublishFlowStage = {
  step: string;
  status: "completed" | "failed";
};

export interface PublishActionResult {
  action: string;
  ok: boolean;
  issue: string;
  screenshotFile?: string;
  pageUrl?: string;
  pageTitle?: string;
}

export interface PublishRuleDecision {
  rule: string;
  passed: boolean;
  issue: string;
}
