export interface TaskArtifacts {
  logFile?: string;
  resultFile?: string;
  screenshots?: string[];
}

export interface TaskErrorInfo {
  code: string;
  message: string;
  stack?: string;
}

export interface TaskRequestBase {
  taskType: string;
  taskId?: string;
  runtimeDir?: string;
  resultFile?: string;
}

export interface DoubaoRunTaskRequest extends TaskRequestBase {
  taskType: "doubao.run";
  input: {
    promptFile?: string;
    promptText?: string;
    outputDir: string;
    imagePaths?: string[];
    imageDir?: string;
    imageExtensions?: string[];
    titleCount?: number;
    cleanupOutputDir?: boolean;
  };
}

export interface PublishFromSpuTaskRequest extends TaskRequestBase {
  taskType: "publish_from_spu";
  input: {
    shopFolder: string;
    productFolder: string;
    mode?: "prepare" | "open_platform_spu" | "query_platform_spu" | "inspect_publish_page" | "run_publish_flow";
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
  };
}

export type TaskRequest = DoubaoRunTaskRequest | PublishFromSpuTaskRequest;

export interface TaskResult {
  ok: boolean;
  taskType: string;
  taskId: string;
  status: string;
  message: string;
  startedAt: string;
  finishedAt: string;
  runtimeDir: string;
  artifacts: TaskArtifacts;
  data?: unknown;
  error?: TaskErrorInfo;
}
