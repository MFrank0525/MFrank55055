import { compactText } from "../utils/text.js";

export function scanTitleRisks(
  title: string,
  riskDictionary: { block: string[]; warn: string[] }
): { level: "block" | "warn" | "pass"; flags: string[] } {
  const normalizedTitle = compactText(title);
  const flags: string[] = [];
  for (const word of riskDictionary.block) {
    if (normalizedTitle.includes(word)) flags.push(`block:${word}`);
  }
  for (const word of riskDictionary.warn) {
    if (normalizedTitle.includes(word)) flags.push(`warn:${word}`);
  }
  if (/(最好|顶级|第一|首选|100%|国家级)/.test(normalizedTitle)) flags.push("warn:绝对化表达");
  if (/(治愈|根治|疗效|治疗|消炎|止痛|降三高|高血压克星|一用就好)/.test(normalizedTitle)) {
    flags.push("block:疗效暗示");
  }
  if (/(医用级|专业级|医院同款|药监备案|医疗器械认证)/.test(normalizedTitle)) {
    flags.push("warn:资质宣称");
  }
  if (/[!！]{2,}/.test(title)) flags.push("warn:情绪化表达");

  if (flags.some((flag) => flag.startsWith("block:"))) return { level: "block", flags };
  if (flags.length) return { level: "warn", flags };
  return { level: "pass", flags };
}
