import path from "node:path";
import type { ImageGenerationProvider } from "../autolist/image-generation-provider.js";
import type { ControllerJobStatus } from "../autolist/maintenance-rules.js";

export interface RunnerJob {
  pid: number;
  startedAt: string;
  cwd: string;
  command: string;
  args: string[];
  logFile: string;
  expectedResultFile?: string;
  mode: "full-real-flow" | "resume-real-job";
  status: ControllerJobStatus;
  batchFingerprint?: string;
  businessRuleFingerprint?: string;
  finishedAt?: string;
}
export interface DirectAutoListingProcess {
  pid: number;
  command: string;
  jobFile: string;
  runtimeDir?: string;
}
export interface ExternalServiceWait {
  supervisorPid?: number;
  status?: "external_service_wait" | "doudian_login_wait";
  reason?: string;
  attempt?: number;
  retryAt?: string;
}

export interface PauseSignalFile {
  requestedAt: string;
  reason: "operator" | "batch_mismatch";
  source: "auto-listing-controller";
  message: string;
  currentBatchFingerprint?: string;
  runtimeBatchFingerprint?: string;
  runId?: string;
  pid?: number;
}

export interface AutoListingJobFile {
  input?: {
    [key: string]: unknown;
    startStep?: string;
    endStep?: string;
    resumeSourceImagePath?: string;
    resumeTaskId?: string;
    resumeProductFolderNames?: string[];
    feishuBatchFingerprint?: string;
    businessRuleFingerprint?: string;
    feishuProductDataFile?: string;
    processedImageManifest?: string;
    paidImageSubmissionLedgerDir?: string;
    imageGenerationConfigFile?: string;
    imageGenerationProvider?: ImageGenerationProvider;
    simulateOnly?: boolean;
    shopRootDir?: string;
    maxImagesPerRun?: number;
    clearTestOutputsBeforeRun?: boolean;
  };
  resultFile?: string;
  runtimeDir?: string;
  runId?: string;
  startStep?: string;
}

export interface AutoListingTaskFile {
  taskId?: string;
  sourceImageName?: string;
  sourceImagePath?: string;
  status?: string;
  feishuProductRecord?: {
    recordId?: string;
    userCognitionName?: string;
    genericName?: string;
    spu?: string;
  };
  generatedProductFolders?: string[];
  mainImageArtifact?: { generatedFiles?: Array<{ productFolder?: string }> };
  shopDistributionArtifact?: { distributedFolders?: string[] };
  error?: { step?: string; message?: string };
}

export interface AutoListingResultFile {
  ok?: boolean;
  feishuBatchFingerprint?: string;
  businessRuleFingerprint?: string;
  status?: string;
  runId?: string;
  runtimeDir?: string;
  artifacts?: { processedImageManifest?: string };
  discoveredImages?: string[];
  tasks?: AutoListingTaskFile[];
  error?: { message?: string };
}

export interface AutoListingStateFile { runId?: string; feishuBatchFingerprint?: string; businessRuleFingerprint?: string; status?: string; tasks?: AutoListingTaskFile[] }

export interface PublishManifestFile {
  generatedAt?: string;
  entries?: Array<{
    productFolder?: string;
    runtimeKey?: string;
    shopFolder?: string;
    watermarkNo?: number | null;
    sourceImagePath?: string;
    recordId?: string;
    userCognitionName?: string;
    genericName?: string;
    status?: "pending" | "published" | "failed" | "skipped";
    finalVerifyStatus?: string;
    errorClass?: string;
    message?: string;
    updatedAt?: string;
  }>;
}

export interface PublishPlanFile {
  generatedAt?: string;
  plan?: Array<{
    productFolder?: string;
    runtimeKey?: string;
    action?: "skip" | "publish";
  }>;
}

export interface DeferredMainImageRoundFile {
  batchFingerprint?: string;
  recordId?: string;
  createdAt?: string;
  round?: number;
  movedProductFolders?: Array<{
    from?: string;
    to?: string;
  }>;
}

export interface LocalFeishuConfig {
  auth?: {
    appId?: string;
    appSecret?: string;
    tenantAccessToken?: string;
  };
}

export const rootDir = process.cwd();
export const controlDir = path.resolve(rootDir, "data/auto-listing/control");
export const jobFile = path.join(controlDir, "auto-listing-controller-job.json");
export const childControlFile = path.join(controlDir, "auto-listing-child.json");
export const externalServiceWaitFile = path.join(controlDir, "auto-listing-wait.json");
export const pauseFile = path.join(controlDir, "pause.requested");
export const resumeJobFile = path.resolve(rootDir, "input/auto-listing/auto-listing.job.mac-feishu-real.resume.generated.json");
export const fullRealJobFile = path.resolve(rootDir, "input/auto-listing.job.mac-feishu-real.json");
export const deferredMainImageRoot = path.resolve(rootDir, "data/auto-listing/deferred-main-images");
export const feishuConfigFile = path.resolve(rootDir, "input/feishu-bitable.config.json");
