import fs from "node:fs";
import path from "node:path";
import { sanitizeFileName } from "../doubao/paths.js";
import type { DeepSeekArtifact } from "./types.js";
import {
  assertDeepSeekPromptsBelongToCurrentProduct,
  buildDeepSeekPromptValidationContext
} from "./deepseek-prompt-rules.js";

function ensureTaskDir(runtimeDir: string, taskId: string): string {
  const taskDir = path.join(runtimeDir, "tasks", sanitizeFileName(taskId));
  fs.mkdirSync(taskDir, { recursive: true });
  return taskDir;
}

function cleanPromptParagraph(value: string): string {
  return value
    .replace(/\r/g, "")
    .replace(/^\s*(?:第?[一二三四五六七八九十]+[段款条]?|[0-9]{1,2})\s*[、.．:：)）\]-]?\s*/, "")
    .trim()
    .replace(/[，、]/g, ",")
    .replace(/\s+/g, "")
    .replace(/,+/g, ",")
    .replace(/^,|,$/g, "");
}

function splitNumberedPromptText(text: string): string[] {
  return text
    .replace(/\r/g, "\n")
    .replace(/(?:^|\n)\s*(?=第?[一二三四五六七八九十]+[段款条]?[、.．:：)）\]-])/g, "\n")
    .replace(/(?:^|\n)\s*(?=[0-9]{1,2}[、.．:：)）\]-])/g, "\n")
    .split(/\n+/)
    .map(cleanPromptParagraph)
    .filter((item) => item.length > 0);
}

export function parseFeishuPosterPrompts(feishuPromptText: string, promptCount: number): string[] {
  const normalized = feishuPromptText.replace(/\r/g, "\n").trim();
  if (!normalized) {
    throw new Error("Feishu DeepSeek提示词 is required.");
  }

  const blankSeparated = normalized
    .split(/\n\s*\n+/)
    .map(cleanPromptParagraph)
    .filter(Boolean);
  const lineSeparated = normalized
    .split(/\n+/)
    .map(cleanPromptParagraph)
    .filter(Boolean);
  const numbered = splitNumberedPromptText(normalized);

  const candidates = [blankSeparated, lineSeparated, numbered].find((items) => items.length >= promptCount) || [];
  if (candidates.length < promptCount) {
    throw new Error(`Feishu DeepSeek提示词 must provide ${promptCount} poster prompt paragraph(s), got ${candidates.length}.`);
  }

  const prompts = candidates.slice(0, promptCount);
  if (new Set(prompts).size !== prompts.length) {
    throw new Error("Feishu DeepSeek提示词 must provide distinct poster prompt paragraphs.");
  }
  for (const prompt of prompts) {
    if (prompt.split(",").filter(Boolean).length < 4) {
      throw new Error(`Feishu DeepSeek提示词 paragraph is not keyword-like enough: ${prompt}`);
    }
  }
  return prompts;
}

export function buildPosterPromptArtifactFromFeishu(options: {
  runtimeDir: string;
  taskId: string;
  feishuPromptText: string;
  sellingPointText: string;
  userCognitionName?: string;
  brandedGenericName?: string;
  genericName?: string;
  promptCount: number;
  simulated: boolean;
}): DeepSeekArtifact {
  const taskDir = ensureTaskDir(options.runtimeDir, options.taskId);
  const promptFile = path.join(taskDir, "feishu-deepseek-prompt-source.txt");
  const rawFile = path.join(taskDir, "deepseek-raw.txt");
  const extractedFile = path.join(taskDir, "deepseek-extracted.txt");
  const screenshotFile = path.join(taskDir, "deepseek.png");
  const prompts = parseFeishuPosterPrompts(options.feishuPromptText, options.promptCount);
  const validationContext = buildDeepSeekPromptValidationContext({
    sellingPointText: options.sellingPointText,
    userCognitionName: options.userCognitionName,
    brandedGenericName: options.brandedGenericName,
    genericName: options.genericName
  });
  assertDeepSeekPromptsBelongToCurrentProduct(prompts, validationContext, options.promptCount);

  fs.writeFileSync(promptFile, `${options.feishuPromptText.trim()}\n`, "utf8");
  fs.writeFileSync(rawFile, `${prompts.join("\n")}\n`, "utf8");
  fs.writeFileSync(extractedFile, `${prompts.join("\n")}\n`, "utf8");

  return {
    promptFile,
    rawFile,
    extractedFile,
    screenshotFile,
    prompts,
    simulated: options.simulated
  };
}

export async function generatePosterPromptsWithDeepSeek(options: {
  runtimeDir: string;
  taskId: string;
  sellingPointText: string;
  feishuPromptText?: string;
  userCognitionName?: string;
  brandedGenericName?: string;
  genericName?: string;
  promptCount: number;
  simulateOnly: boolean;
}): Promise<DeepSeekArtifact> {
  if (!options.feishuPromptText?.trim()) {
    throw new Error("Poster prompt generation requires Feishu DeepSeek提示词. DeepSeek browser automation is disabled.");
  }
  return buildPosterPromptArtifactFromFeishu({
    runtimeDir: options.runtimeDir,
    taskId: options.taskId,
    feishuPromptText: options.feishuPromptText,
    sellingPointText: options.sellingPointText,
    userCognitionName: options.userCognitionName,
    brandedGenericName: options.brandedGenericName,
    genericName: options.genericName,
    promptCount: options.promptCount,
    simulated: options.simulateOnly
  });
}
