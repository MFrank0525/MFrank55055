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
  const mainImageInstruction1 = buildMainImageInstruction1("延草纲目", "医用膝盖喷剂", "延草纲目膝盖部位医用喷剂");
  const posterPromptManual = readManualTextBlock("poster_prompts_generated", "来源规则");
  const titleGenerationManual = readManualTextBlock("titles_generated", "来源规则");

  for (const [label, text, includes] of [
    ["Main image instruction", mainImageInstruction1, RULE_CONTRACT_MARKERS.mainImageInstruction1],
    ["Poster prompt source rule", posterPromptManual, RULE_CONTRACT_MARKERS.posterPromptSourceRule],
    ["Title keyword source rule", titleGenerationManual, RULE_CONTRACT_MARKERS.titleKeywordSourceRule]
  ] as const) {
    for (const expected of includes) {
      assertIncludes(text, expected, label);
    }
  }

  for (const [label, value] of [
    ["Main image instruction", mainImageInstruction1],
    ["Poster prompt source rule", posterPromptManual],
    ["Title keyword source rule", titleGenerationManual]
  ] as const) {
    assertNoReplacementChar(value, label);
  }
}
