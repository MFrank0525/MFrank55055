import fs from "node:fs";
import path from "node:path";
import { assertNoGptPlusWebUrl } from "../utils/gpt-plus-guard.js";
import { resolveOpenAiCompatibleImageMode } from "./image-generation-rules.js";
import {
  requireOpenAiCompatibleImageProvider,
  resolveImageGenerationProvider,
  type ImageGenerationProvider
} from "./image-generation-provider.js";

export interface OpenAiCompatibleImageGenerationConfig {
  provider: "openai-compatible";
  apiUrl: string;
  apiKey: string;
  model: "gpt-image-2";
  mode: "videos-base64";
}

export function readOpenAiCompatibleImageGenerationConfig(
  configFile: string,
  context: string
): OpenAiCompatibleImageGenerationConfig {
  if (!configFile) {
    throw new Error(`${context} image generation config file is required.`);
  }
  const resolved = path.resolve(configFile);
  if (!fs.existsSync(resolved)) {
    throw new Error(`${context} image generation config file not found: ${resolved}`);
  }
  const parsed = JSON.parse(fs.readFileSync(resolved, "utf8")) as {
    provider?: unknown;
    apiUrl?: unknown;
    apiKey?: unknown;
    model?: unknown;
    mode?: unknown;
  };
  const apiUrl = typeof parsed.apiUrl === "string" ? parsed.apiUrl : "";
  const apiKey = process.env.IMAGE_GENERATION_API_KEY || (typeof parsed.apiKey === "string" ? parsed.apiKey : "");
  if (!apiUrl) {
    throw new Error(`${context} image generation config missing apiUrl: ${resolved}`);
  }
  if (!apiKey) {
    throw new Error(`${context} image generation config missing apiKey: ${resolved}`);
  }
  requireOpenAiCompatibleImageProvider(parsed.provider, `${context} image generation config in ${resolved}`);
  const mode = resolveOpenAiCompatibleImageMode(parsed.mode, apiUrl);
  assertNoGptPlusWebUrl(apiUrl, `${context} image generation apiUrl in ${resolved}`);
  if (parsed.model !== "gpt-image-2") {
    throw new Error(`${context} image generation model must be gpt-image-2: ${resolved}`);
  }
  return {
    provider: "openai-compatible",
    apiUrl,
    apiKey,
    model: "gpt-image-2",
    mode
  };
}

export function assertAutoListingControllerImageGenerationContract(
  input: {
    imageGenerationProvider?: ImageGenerationProvider;
    imageGenerationConfigFile?: string;
    simulateOnly?: boolean;
  } | undefined,
  rootDir: string
): void {
  if (!input) {
    throw new Error("Auto-listing controller selected job input is missing.");
  }
  const provider = resolveImageGenerationProvider(
    input.imageGenerationProvider,
    input.simulateOnly === true,
    "Auto-listing controller selected job"
  );
  if (provider === "none") {
    return;
  }
  if (!input.imageGenerationConfigFile) {
    throw new Error("Auto-listing controller selected job image generation config file is required.");
  }
  readOpenAiCompatibleImageGenerationConfig(
    path.resolve(rootDir, input.imageGenerationConfigFile),
    "Auto-listing controller selected job"
  );
}
