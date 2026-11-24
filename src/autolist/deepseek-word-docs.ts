import fs from "node:fs";
import path from "node:path";
import { writeSimpleWordDocument } from "./docx-lite.js";

export function writeFeishuPromptWordFiles(options: {
  mainImageWorkDir: string;
  sellingPointText: string;
  prompts: string[];
  promptCount?: number;
}): string[] {
  const promptCount = options.promptCount || 5;
  const sellingPointText = options.sellingPointText.trim();
  if (!sellingPointText) {
    throw new Error("Main-image prompt Word files require approved Feishu product copy.");
  }
  if (options.prompts.length < promptCount) {
    throw new Error(`Poster prompt generation returned ${options.prompts.length} prompt(s), expected ${promptCount}.`);
  }
  fs.mkdirSync(options.mainImageWorkDir, { recursive: true });
  return options.prompts.slice(0, promptCount).map((prompt, index) => {
    const filePath = path.join(options.mainImageWorkDir, `主图提示词${String(index + 1).padStart(2, "0")}.docx`);
    writeSimpleWordDocument(filePath, [sellingPointText, prompt.trim()]);
    return filePath;
  });
}
