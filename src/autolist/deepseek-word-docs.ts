import fs from "node:fs";
import path from "node:path";
import { writeSimpleWordDocument } from "./docx-lite.js";
import { buildMainImageInstruction1 } from "./rule-text.js";

export function writeDeepSeekPromptWordFiles(options: {
  jimengImageDir: string;
  sellingPointText: string;
  brand: string;
  userCognitionName: string;
  brandedGenericName: string;
  prompts: string[];
  promptCount?: number;
}): string[] {
  const instruction1 = buildMainImageInstruction1(options.brand, options.userCognitionName, options.brandedGenericName);
  const promptCount = options.promptCount || 5;
  if (options.prompts.length < promptCount) {
    throw new Error(`Poster prompt generation returned ${options.prompts.length} prompt(s), expected ${promptCount}.`);
  }
  fs.mkdirSync(options.jimengImageDir, { recursive: true });
  return options.prompts.slice(0, promptCount).map((prompt, index) => {
    const filePath = path.join(options.jimengImageDir, `主图提示词${String(index + 1).padStart(2, "0")}.docx`);
    writeSimpleWordDocument(filePath, [instruction1, options.sellingPointText, prompt]);
    return filePath;
  });
}
