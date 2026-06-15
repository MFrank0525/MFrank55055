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
  metadata?: {
    brand?: string;
    spu?: string;
    title?: string;
    shortTitle?: string;
    modelSpec?: string;
  };
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
  rowIndex: number;
  publishButtonIndex: number;
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
