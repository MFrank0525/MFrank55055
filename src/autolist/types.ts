export const AUTO_LISTING_STEPS = [
  "discovered",
  "doubao_generated",
  "deepseek_generated",
  "jimeng_generated",
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

export type AutoListingStatus = AutoListingStep | "failed";
export type DreaminaImageCountStrategy = "accept_all" | "require_exact" | "limit_to_count";

export interface AutoListingJobInput {
  feishuImageDir: string;
  jimengImageDir: string;
  titleDir: string;
  qualificationDir: string;
  productInfoXlsx: string;
  productInfoKeyMapFile?: string;
  shopRootDir: string;
  deepseekConversationUrl?: string;
  dreaminaBin?: string;
  dreaminaPollSeconds?: number;
  dreaminaModelVersion?: string;
  dreaminaResolutionType?: string;
  dreaminaRatio?: string;
  dreaminaExpectedImageCount?: number;
  dreaminaImageCountStrategy?: DreaminaImageCountStrategy;
  runtimeRootDir?: string;
  processedImageManifest?: string;
  imageExtensions?: string[];
  serialOnly?: boolean;
  stopOnError?: boolean;
  cleanupAfterPublish?: boolean;
  titleCount?: number;
  maxImagesPerRun?: number;
  simulateOnly?: boolean;
  clearTestOutputsBeforeRun?: boolean;
  startStep?: AutoListingStep;
  endStep?: AutoListingStep;
}

export interface AutoListingJobFile {
  runtimeDir?: string;
  resultFile?: string;
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

export interface JimengGeneratedFile {
  imageFile: string;
  rawImageFile?: string;
  shopFolder?: string;
  productFolder: string;
  storeName: string;
  promptIndex: number;
  promptWordFile?: string;
  submitId?: string;
}

export interface JimengArtifact {
  promptFile: string;
  generatedFiles: JimengGeneratedFile[];
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
  }>;
  simulated: boolean;
}

export interface CleanupArtifact {
  removedPaths: string[];
  simulated: boolean;
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
  jimengArtifact?: JimengArtifact;
  titleSheetArtifact?: TitleSheetArtifact;
  metadataArtifact?: MetadataArtifact;
  qualificationArtifact?: QualificationArtifact;
  shopDistributionArtifact?: ShopDistributionArtifact;
  publishArtifact?: PublishArtifact;
  cleanupArtifact?: CleanupArtifact;
  error?: AutoListingTaskError;
}

export interface AutoListingRunState {
  runId: string;
  startedAt: string;
  lastUpdatedAt: string;
  status: "running" | "failed" | "completed";
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
  processedImageManifest: string;
  input: Required<AutoListingJobInput>;
}

export interface AutoListingRunResult {
  ok: boolean;
  runId: string;
  startedAt: string;
  finishedAt: string;
  runtimeDir: string;
  artifacts: {
    resultFile: string;
    stateFile: string;
    eventFile: string;
    manualsReadFile: string;
    processedImageManifest: string;
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
