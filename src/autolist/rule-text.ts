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
  return readManualTextBlock("poster_prompts_generated", "固定对话标题");
}

export function getDeepSeekInstruction1(): string {
  return readManualTextBlock("poster_prompts_generated", "指令1");
}

export function buildDeepSeekInstruction2(): string {
  return readManualTextBlock("poster_prompts_generated", "指令2");
}

export function getDeepSeekRetryInstruction(): string {
  return readManualTextBlock("poster_prompts_generated", "重试指令");
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeComparableText(input: string): string {
  return input.replace(/[\s\-_.，。、“”"'：:；;（）()【】[\]<>《》]/g, "").trim();
}

export function buildBrandedUserCognitionName(brand: string, userCognitionName: string): string {
  const normalizedBrand = brand.trim();
  const normalizedUser = userCognitionName.trim();
  if (!normalizedUser) {
    return "";
  }
  if (!normalizedBrand) {
    return normalizedUser;
  }

  const comparableBrand = normalizeComparableText(normalizedBrand);
  const comparableUser = normalizeComparableText(normalizedUser);
  if (!comparableBrand) {
    return normalizedUser;
  }

  if (!comparableUser.includes(comparableBrand)) {
    return `${normalizedBrand}${normalizedUser}`;
  }

  const duplicateBrandPattern = new RegExp(escapeRegExp(normalizedBrand), "g");
  const userWithoutBrand = normalizedUser.replace(duplicateBrandPattern, "").trim();
  if (!userWithoutBrand) {
    return normalizedBrand;
  }

  return `${normalizedBrand}${userWithoutBrand}`;
}

export function buildMainImageInstruction1(brand: string, userCognitionName: string, brandedGenericName: string): string {
  const template = readManualTextBlock("main_images_generated", "主图指令模板");
  const brandedUserCognitionName = buildBrandedUserCognitionName(brand, userCognitionName);
  const normalizedGenericName = brandedGenericName.trim();
  if (!brandedUserCognitionName || !normalizedGenericName) {
    throw new Error("Main image instruction requires branded user cognition name and branded generic name.");
  }
  return template
    .replaceAll("{{带有品牌的用户认知名}}", brandedUserCognitionName)
    .replaceAll("{{带有品牌的产品通用名称}}", normalizedGenericName)
    .replaceAll("{{用户认知名}}", brandedUserCognitionName)
    .replaceAll("{{产品通用名称}}", normalizedGenericName)
    .replaceAll("{{产品卖点}}", "");
}

export function buildMainImageEditInstruction(
  brand: string,
  userCognitionName: string,
  genericName: string,
  sellingPointText: string
): string {
  const template = readManualTextBlock("main_images_generated", "主图指令模板");
  const brandedUserCognitionName = buildBrandedUserCognitionName(brand, userCognitionName);
  const normalizedGenericName = genericName.trim();
  if (!brandedUserCognitionName || !normalizedGenericName) {
    throw new Error("Main image edit instruction requires user cognition name and generic name.");
  }
  return template
    .replaceAll("{{带有品牌的用户认知名}}", brandedUserCognitionName)
    .replaceAll("{{带有品牌的产品通用名称}}", normalizedGenericName)
    .replaceAll("{{用户认知名}}", brandedUserCognitionName)
    .replaceAll("{{产品通用名称}}", normalizedGenericName)
    .replaceAll("{{产品卖点}}", sellingPointText.trim());
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
  const deepseekConversationTitle = getDeepSeekConversationTitle();
  const deepseekInstruction1 = getDeepSeekInstruction1();
  const deepseekRetryInstruction = getDeepSeekRetryInstruction();
  const deepseekInstruction2 = buildDeepSeekInstruction2();
  const mainImageInstruction1 = buildMainImageInstruction1("延草纲目", "医用膝盖喷剂", "延草纲目膝盖部位医用喷剂");
  const titleConversationUrl = readManualTextBlock("titles_generated", "固定标题对话");
  const titlePromptPrefix = readManualTextBlock("titles_generated", "标题指令前缀");
  const titleGenerationRule = readManualTextBlock("titles_generated", "标题生成规则");

  for (const [label, text, includes] of [
    ["DeepSeek conversation title", deepseekConversationTitle, RULE_CONTRACT_MARKERS.deepseekConversationTitle],
    ["DeepSeek instruction1", deepseekInstruction1, RULE_CONTRACT_MARKERS.deepseekInstruction1],
    ["DeepSeek retry instruction", deepseekRetryInstruction, RULE_CONTRACT_MARKERS.deepseekRetryInstruction],
    ["DeepSeek instruction2", deepseekInstruction2, RULE_CONTRACT_MARKERS.deepseekInstruction2],
    ["Main image instruction", mainImageInstruction1, RULE_CONTRACT_MARKERS.mainImageInstruction1],
    ["Title conversation URL", titleConversationUrl, RULE_CONTRACT_MARKERS.titleConversationUrl],
    ["Title prompt prefix", titlePromptPrefix, RULE_CONTRACT_MARKERS.titlePromptPrefix],
    ["Title generation rule", titleGenerationRule, RULE_CONTRACT_MARKERS.titleGenerationRule]
  ] as const) {
    for (const expected of includes) {
      assertIncludes(text, expected, label);
    }
  }

  for (const [label, value] of [
    ["DeepSeek conversation title", deepseekConversationTitle],
    ["DeepSeek instruction1", deepseekInstruction1],
    ["DeepSeek retry instruction", deepseekRetryInstruction],
    ["DeepSeek instruction2", deepseekInstruction2],
    ["Main image instruction", mainImageInstruction1],
    ["Title conversation URL", titleConversationUrl],
    ["Title prompt prefix", titlePromptPrefix],
    ["Title generation rule", titleGenerationRule]
  ] as const) {
    assertNoReplacementChar(value, label);
  }
}
