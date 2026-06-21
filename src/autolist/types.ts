import type { FeishuProductRecord } from "../feishu/types.js";

export const AUTO_LISTING_STEPS = [
  "source_images_discovered",
  "selling_points_loaded",
  "poster_prompts_generated",
  "main_images_generated",
  "product_folders_built",
  "titles_generated",
  "titles_distributed",
  "metadata_enriched",
  "qualifications_attached",
  "shop_distributed",
  "published",
  "cleaned",
  "done"
] as const;

export type AutoListingStep = (typeof AUTO_LISTING_STEPS)[number];
export type AutoListingStepInput = AutoListingStep;

export function normalizeAutoListingStep(step: AutoListingStepInput): AutoListingStep {
  return step;
}

export type AutoListingStatus = AutoListingStep | "failed";
export type MainImageCountStrategy = "accept_all" | "require_exact" | "limit_to_count";
export type ImageGenerationProvider = "openai-compatible";

export interface AutoListingJobInput {
  feishuImageDir: string;
  mainImageWorkDir?: string;
  titleDir: string;
  qualificationDir: string;
  productInfoXlsx?: string;
  productInfoKeyMapFile?: string;
  feishuProductDataFile?: string;
  shopRootDir: string;
  imageGenerationProvider?: ImageGenerationProvider;
  imageGenerationConfigFile?: string;
  mainImageExpectedCount?: number;
  mainImageCountStrategy?: MainImageCountStrategy;
  runtimeRootDir?: string;
  paidImageSubmissionLedgerDir?: string;
  processedImageManifest?: string;
  pauseSignalFile?: string;
  imageExtensions?: string[];
  serialOnly?: boolean;
  stopOnError?: boolean;
  cleanupAfterPublish?: boolean;
  cleanupSourceImageAfterPublish?: boolean;
  archiveMainImageDir?: string;
  titleCount?: number;
  maxImagesPerRun?: number;
  resumeSourceImagePath?: string;
  resumeTaskId?: string;
  resumeProductFolderNames?: string[];
  feishuBatchFingerprint?: string;
  simulateOnly?: boolean;
  clearTestOutputsBeforeRun?: boolean;
  startStep?: AutoListingStepInput;
  endStep?: AutoListingStepInput;
}

export interface AutoListingJobFile {
  runtimeDir?: string;
  resultFile?: string;
  runId?: string;
  input: AutoListingJobInput;
}

export interface AutoListingTaskError {
  step: string;
  message: string;
  capturedAt: string;
}

export interface SellingPointArtifact {
  promptFile: string;
  rawFile: string;
  screenshotFile: string;
  sellingPointText: string;
  segments: string[];
  brand: string;
  userCognitionName: string;
  brandedGenericName: string;
  segmentCount: number;
  submittedAt?: string;
  capturedAt?: string;
  simulated: boolean;
}

export interface DeepSeekArtifact {
  promptFile: string;
  rawFile: string;
  screenshotFile: string;
  prompts: string[];
  extractedFile?: string;
  wordFiles?: string[];
  submittedAt?: string;
  capturedAt?: string;
  simulated: boolean;
}

export interface MainImageGeneratedFile {
  imageFile: string;
  rawImageFile?: string;
  shopFolder?: string;
  productFolder: string;
  storeName: string;
  promptIndex: number;
  promptWordFile?: string;
  submitId?: string;
}

export interface MainImageArtifact {
  promptFile: string;
  generatedFiles: MainImageGeneratedFile[];
  simulated: boolean;
}

export interface TitleSheetFile {
  title: string;
  workbookFile: string;
  distributedTo?: string;
}

export interface TitleSheetArtifact {
  generatedFiles: TitleSheetFile[];
  simulated: boolean;
}

export interface MetadataArtifact {
  matchedProductName: string;
  shortTitle: string;
  brand: string;
  spu: string;
  updatedWorkbookFiles: string[];
  simulated: boolean;
}

export interface QualificationArtifact {
  copiedFiles: string[];
  simulated: boolean;
}

export interface ShopDistributionArtifact {
  distributedFolders: string[];
  simulated: boolean;
}

export interface PublishArtifact {
  preflightErrors?: Array<{
    productFolder: string;
    message: string;
  }>;
  results: Array<{
    productFolder: string;
    ok: boolean;
    status: string;
    message: string;
    resultFile?: string;
    finalVerifyStatus?: string;
    errorClass?: string;
  }>;
  simulated: boolean;
}

export interface CleanupArtifact {
  removedPaths: string[];
  archivedFiles?: string[];
  simulated: boolean;
}

export interface AutoListingPreflightSummary {
  generatedAt: string;
  runId: string;
  simulateOnly: boolean;
  source: {
    feishuProductDataFile?: string;
    productInfoXlsx?: string;
    feishuImageDir: string;
    mainImageWorkDir: string;
    qualificationDir: string;
    shopRootDir: string;
    imageGenerationProvider: ImageGenerationProvider;
    imageGenerationConfigFile?: string;
    mainImageExpectedCount: number;
    mainImageCountStrategy: MainImageCountStrategy;
    paidImageSubmissionLedgerDir: string;
    pauseSignalFile: string;
  };
  counts: {
    sourceImages: number;
    shops: number;
  };
  errors: string[];
  warnings: string[];
}

export interface ImageTaskState {
  taskId: string;
  sequenceNo: number;
  sourceImagePath: string;
  sourceImageName: string;
  status: AutoListingStatus;
  startedAt?: string;
  finishedAt?: string;
  lastUpdatedAt: string;
  generatedProductFolders: string[];
  notes: string[];
  sellingPointArtifact?: SellingPointArtifact;
  deepseekArtifact?: DeepSeekArtifact;
  mainImageArtifact?: MainImageArtifact;
  titleSheetArtifact?: TitleSheetArtifact;
  metadataArtifact?: MetadataArtifact;
  qualificationArtifact?: QualificationArtifact;
  shopDistributionArtifact?: ShopDistributionArtifact;
  publishArtifact?: PublishArtifact;
  cleanupArtifact?: CleanupArtifact;
  feishuProductRecord?: FeishuProductRecord;
  error?: AutoListingTaskError;
}

export interface AutoListingRunState {
  runId: string;
  feishuBatchFingerprint?: string;
  startedAt: string;
  lastUpdatedAt: string;
  status: "running" | "failed" | "completed" | "paused";
  currentTaskId?: string;
  tasks: ImageTaskState[];
  errors: AutoListingTaskError[];
}

export interface AutoListingEvent {
  timestamp: string;
  level: "info" | "error";
  taskId?: string;
  step: string;
  message: string;
}

export interface AutoListingResolvedJob {
  runtimeDir: string;
  resultFile: string;
  stateFile: string;
  eventFile: string;
  manualsReadFile: string;
  preflightFile: string;
  processedImageManifest: string;
  pauseSignalFile: string;
  input: Required<AutoListingJobInput>;
}

export interface AutoListingRunResult {
  ok: boolean;
  runId: string;
  feishuBatchFingerprint?: string;
  startedAt: string;
  finishedAt: string;
  runtimeDir: string;
  artifacts: {
    resultFile: string;
    stateFile: string;
    eventFile: string;
    manualsReadFile: string;
    processedImageManifest: string;
    preflightFile?: string;
    pauseSignalFile?: string;
  };
  discoveredImages: string[];
  tasks: ImageTaskState[];
  manualsRead?: Array<{
    step: string;
    filePath: string;
    readCount: number;
    firstReadAt: string;
    lastReadAt: string;
  }>;
  error?: {
    message: string;
    stack?: string;
  };
}
