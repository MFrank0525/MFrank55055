import fs from "node:fs";
import path from "node:path";
import { writeSimpleWordDocument } from "./docx-lite.js";

export function writeScenePromptWordFiles(options: {
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
  if (options.prompts.length !== promptCount) {
    throw new Error(`Scene planning returned ${options.prompts.length} prompt(s), expected exactly ${promptCount}.`);
  }
  fs.mkdirSync(options.mainImageWorkDir, { recursive: true });
  return options.prompts.map((prompt, index) => {
    const scenePrompt = prompt.trim();
    if (!scenePrompt) throw new Error(`Scene prompt ${index + 1} was empty.`);
    const filePath = path.join(options.mainImageWorkDir, `主图提示词${String(index + 1).padStart(2, "0")}.docx`);
    writeSimpleWordDocument(filePath, [sellingPointText, scenePrompt]);
    return filePath;
  });
}
