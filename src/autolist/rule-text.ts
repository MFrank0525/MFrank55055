import { readManualTextBlock } from "./operation-manual.js";
import { RULE_CONTRACT_MARKERS } from "./rule-contracts.js";

export const DOUBAO_URL = "https://www.doubao.com/chat/";
export const DEEPSEEK_URL = "https://chat.deepseek.com/";

export function getDoubaoConversationTitle(): string {
  throw new Error("Legacy selling point generation is disabled. Auto-listing selling points must come from Feishu product data.");
}

export function buildDoubaoSellingPointPrompt(): string {
  throw new Error("Legacy selling point generation is disabled. Auto-listing selling points must come from Feishu product data.");
}

export function getDeepSeekConversationTitle(): string {
  throw new Error("DeepSeek browser prompt generation is disabled. Poster prompts must come from Feishu DeepSeek提示词.");
}

export function getDeepSeekInstruction1(): string {
  throw new Error("DeepSeek browser prompt generation is disabled. Poster prompts must come from Feishu DeepSeek提示词.");
}

export function buildDeepSeekInstruction2(): string {
  throw new Error("DeepSeek browser prompt generation is disabled. Poster prompts must come from Feishu DeepSeek提示词.");
}

export function getDeepSeekRetryInstruction(): string {
  throw new Error("DeepSeek browser prompt generation is disabled. Poster prompts must come from Feishu DeepSeek提示词.");
}

function assertIncludes(text: string, expected: string, label: string): void {
  if (!text.includes(expected)) {
    throw new Error(`Rule text integrity check failed for ${label}: missing "${expected}".`);
  }
}

function assertNoReplacementChar(text: string, label: string): void {
  if (text.includes("�")) {
    throw new Error(`Rule text integrity check failed for ${label}: found replacement character.`);
  }
}

export function assertRuleTextIntegrity(): void {
  const mainImagePromptSourceRule = readManualTextBlock("main_images_generated", "飞书主图提示词来源规则");
  const posterPromptManual = readManualTextBlock("poster_prompts_generated", "来源规则");
  const titleGenerationManual = readManualTextBlock("titles_generated", "来源规则");

  for (const [label, text, includes] of [
    ["Main image prompt source rule", mainImagePromptSourceRule, RULE_CONTRACT_MARKERS.mainImagePromptSourceRule],
    ["Poster prompt source rule", posterPromptManual, RULE_CONTRACT_MARKERS.posterPromptSourceRule],
    ["Title keyword source rule", titleGenerationManual, RULE_CONTRACT_MARKERS.titleKeywordSourceRule]
  ] as const) {
    for (const expected of includes) {
      assertIncludes(text, expected, label);
    }
  }

  for (const [label, value] of [
    ["Main image prompt source rule", mainImagePromptSourceRule],
    ["Poster prompt source rule", posterPromptManual],
    ["Title keyword source rule", titleGenerationManual]
  ] as const) {
    assertNoReplacementChar(value, label);
  }
}
