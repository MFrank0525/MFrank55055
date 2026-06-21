import fs from "node:fs";
import path from "node:path";
import { writeSimpleWordDocument } from "./docx-lite.js";

export function writeFeishuPromptWordFiles(options: {
  mainImageWorkDir: string;
  sellingPointText: string;
  mainImageInstructionText: string;
  prompts: string[];
  positivePromptText: string;
  negativePromptText: string;
  promptCount?: number;
}): string[] {
  const promptCount = options.promptCount || 5;
  const mainImageInstructionText = options.mainImageInstructionText.trim();
  const sellingPointText = options.sellingPointText.trim();
  const positivePromptText = options.positivePromptText.trim();
  const negativePromptText = options.negativePromptText.trim();
  if (!mainImageInstructionText || !sellingPointText || !positivePromptText || !negativePromptText) {
    throw new Error("Feishu prompt Word files require 主图指令, 产品卖点, 正向提示词, and 反向提示词.");
  }
  if (options.prompts.length < promptCount) {
    throw new Error(`Poster prompt generation returned ${options.prompts.length} prompt(s), expected ${promptCount}.`);
  }
  fs.mkdirSync(options.mainImageWorkDir, { recursive: true });
  return options.prompts.slice(0, promptCount).map((prompt, index) => {
    const filePath = path.join(options.mainImageWorkDir, `主图提示词${String(index + 1).padStart(2, "0")}.docx`);
    writeSimpleWordDocument(filePath, [
      mainImageInstructionText,
      sellingPointText,
      prompt.trim(),
      positivePromptText,
      negativePromptText
    ]);
    return filePath;
  });
}
