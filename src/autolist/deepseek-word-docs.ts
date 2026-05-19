import path from "node:path";
import { writeSimpleWordDocument } from "./docx-lite.js";
import { buildDreaminaInstruction1 } from "./rule-text.js";

export function writeDeepSeekPromptWordFiles(options: {
  jimengImageDir: string;
  sellingPointText: string;
  brand: string;
  userCognitionName: string;
  brandedGenericName: string;
  prompts: string[];
  promptCount?: number;
}): string[] {
  const instruction1 = buildDreaminaInstruction1(options.brand, options.userCognitionName, options.brandedGenericName);
  return options.prompts.slice(0, options.promptCount || 5).map((prompt, index) => {
    const filePath = path.join(options.jimengImageDir, `即梦提示词${String(index + 1).padStart(2, "0")}.docx`);
    writeSimpleWordDocument(filePath, [instruction1, options.sellingPointText, prompt]);
    return filePath;
  });
}
