export interface SubmitPromptOptions {
  imagePath?: string;
  promptFile?: string;
  promptText?: string;
  freshConversation?: boolean;
  conversationUrl?: string;
  attachImage?: boolean;
}

export interface SubmitPromptResult {
  activeUrl: string;
  imagePath: string;
  promptFile: string;
  promptLength: number;
  submittedAt: string;
}

export interface CaptureConversationOptions {
  outputDir: string;
  rawFileOut?: string;
  screenshotOut?: string;
  waitMs?: number;
  conversationUrl?: string;
  mode?: "titles" | "selling_points" | "latest";
}

export interface CaptureConversationResult {
  activeUrl: string;
  rawFile: string;
  pngFile: string;
  capturedAt: string;
}

export interface TitleRow {
  index: string;
  title: string;
}

export interface SaveTitlesOptions {
  rawFile: string;
  outputDir: string;
  titleCount?: number;
  timestamp?: Date;
  promptText?: string;
}

export interface SaveTitlesResult {
  productName: string;
  titleCount: number;
  csvFile: string;
  titles: TitleRow[];
}

export interface DoubaoJobInput {
  promptFile?: string;
  promptText?: string;
  outputDir: string;
  imagePaths?: string[];
  imageDir?: string;
  imageExtensions?: string[];
  titleCount?: number;
  resultFile?: string;
  runtimeDir?: string;
  cleanupOutputDir?: boolean;
  freshConversation?: boolean;
  conversationUrl?: string;
  attachImages?: boolean;
  captureWaitMs?: number;
}

export interface DoubaoJobResolved {
  promptFile: string;
  outputDir: string;
  imagePaths: string[];
  titleCount: number;
  resultFile: string;
  runtimeDir: string;
  cleanupOutputDir: boolean;
  freshConversation: boolean;
  conversationUrl?: string;
  attachImages: boolean;
  captureWaitMs?: number;
}

export interface DoubaoItemResult {
  imagePath: string;
  rawFile: string;
  csvFile: string;
  productName: string;
  titleCount: number;
  submittedAt: string;
  capturedAt: string;
}

export interface DoubaoRunResult {
  status: "success" | "failed";
  runId: string;
  startedAt: string;
  finishedAt: string;
  logFile: string;
  job: DoubaoJobResolved;
  items: DoubaoItemResult[];
  error?: {
    message: string;
    stack?: string;
  };
}
