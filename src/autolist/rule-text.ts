import { readManualTextBlock } from "./operation-manual.js";

export const DOUBAO_URL = "https://www.doubao.com/chat/";
export const DEEPSEEK_URL = "https://chat.deepseek.com/";

export function getDoubaoConversationTitle(): string {
  return readManualTextBlock("doubao_generated", "固定对话标题");
}

export function buildDoubaoSellingPointPrompt(): string {
  return readManualTextBlock("doubao_generated", "豆包卖点指令");
}

export function getDeepSeekConversationTitle(): string {
  return readManualTextBlock("deepseek_generated", "固定对话标题");
}

export function getDeepSeekInstruction1(): string {
  return readManualTextBlock("deepseek_generated", "指令1");
}

export function buildDeepSeekInstruction2(): string {
  return readManualTextBlock("deepseek_generated", "指令2");
}

export function getDeepSeekRetryInstruction(): string {
  return readManualTextBlock("deepseek_generated", "重试指令");
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

export function buildDreaminaInstruction1(brand: string, userCognitionName: string, brandedGenericName: string): string {
  const template = readManualTextBlock("jimeng_generated", "即梦指令1模板");
  const brandedUserCognitionName = buildBrandedUserCognitionName(brand, userCognitionName);
  const normalizedGenericName = brandedGenericName.trim();
  if (!brandedUserCognitionName || !normalizedGenericName) {
    throw new Error("Dreamina instruction1 requires branded user cognition name and branded generic name.");
  }
  return template
    .replaceAll("{{带有品牌的用户认知名}}", brandedUserCognitionName)
    .replaceAll("{{带有品牌的产品通用名称}}", normalizedGenericName);
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
  const doubaoConversationTitle = getDoubaoConversationTitle();
  const deepseekConversationTitle = getDeepSeekConversationTitle();
  const deepseekInstruction1 = getDeepSeekInstruction1();
  const deepseekRetryInstruction = getDeepSeekRetryInstruction();
  const doubaoPrompt = buildDoubaoSellingPointPrompt();
  const deepseekInstruction2 = buildDeepSeekInstruction2();
  const dreaminaInstruction1 = buildDreaminaInstruction1("延草纲目", "医用膝盖喷剂", "延草纲目膝盖部位医用喷剂");

  assertIncludes(doubaoConversationTitle, "产品卖点生成", "Doubao conversation title");
  assertIncludes(deepseekConversationTitle, "日式医用贴膏海报设计", "DeepSeek conversation title");
  assertIncludes(deepseekInstruction1, "主题海报视觉设计", "DeepSeek instruction1");
  assertIncludes(deepseekRetryInstruction, "5段", "DeepSeek retry instruction");

  assertIncludes(doubaoPrompt, "产品卖点生成规则（完整整理版严格执行版）", "Doubao prompt");
  assertIncludes(doubaoPrompt, "注意：用户认知产品名不含品牌", "Doubao prompt");
  assertIncludes(doubaoPrompt, "01 品牌 + 用户认知产品名", "Doubao prompt");
  assertIncludes(doubaoPrompt, "02 带品牌的产品通用名称", "Doubao prompt");
  assertIncludes(doubaoPrompt, "严格按照 8 个卖点顺序输出", "Doubao prompt");

  assertIncludes(deepseekInstruction2, "海报视觉设计生成规则", "DeepSeek instruction2");
  assertIncludes(deepseekInstruction2, "每次需设计5款不同的电商海报", "DeepSeek instruction2");
  assertIncludes(deepseekInstruction2, "不展示医疗器械备案注册号", "DeepSeek instruction2");

  assertIncludes(dreaminaInstruction1, "【产品海报设计】", "Dreamina instruction1");
  assertIncludes(dreaminaInstruction1, "延草纲目医用膝盖喷剂", "Dreamina instruction1");
  assertIncludes(dreaminaInstruction1, "延草纲目膝盖部位医用喷剂", "Dreamina instruction1");

  for (const [label, value] of [
    ["Doubao conversation title", doubaoConversationTitle],
    ["DeepSeek conversation title", deepseekConversationTitle],
    ["DeepSeek instruction1", deepseekInstruction1],
    ["DeepSeek retry instruction", deepseekRetryInstruction],
    ["Doubao prompt", doubaoPrompt],
    ["DeepSeek instruction2", deepseekInstruction2],
    ["Dreamina instruction1", dreaminaInstruction1]
  ] as const) {
    assertNoReplacementChar(value, label);
  }
}
