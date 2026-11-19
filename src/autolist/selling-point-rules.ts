import crypto from "node:crypto";

export interface SelectedMainImageSellingPoints {
  headline: string;
  subtitle: string;
  sellingPoints: string[];
  sellingPointText: string;
}

export function parseMainImageCandidateText(value: string): string[] {
  const normalized = value.replace(/\r/g, "\n").trim();
  if (!normalized) return [];
  const parts = /\n/.test(normalized)
    ? normalized.split(/\n+/)
    : normalized.split(/[，,、；;|]+/);
  return Array.from(new Set(parts
    // Only remove an actual list marker. The delimiter is mandatory so a
    // product specification such as "200ml大容量" or "60g/支" keeps its
    // leading number instead of being mistaken for an ordinal.
    .map((item) => item.replace(/^\s*(?:\d+|[一二三四五六七八九十]+)\s*[.、)）:]\s*/, "").trim())
    .filter(Boolean)));
}

function randomIndex(length: number, randomInt: (max: number) => number): number {
  if (length <= 0) throw new Error("Candidate list must not be empty.");
  const index = randomInt(length);
  if (!Number.isInteger(index) || index < 0 || index >= length) {
    throw new Error(`Random candidate index out of range: ${index}/${length}`);
  }
  return index;
}

function takeRandomUnique(items: string[], count: number, randomInt: (max: number) => number): string[] {
  if (items.length < count) {
    throw new Error(`主图卖点字段至少需要${count}个不同候选内容，当前只有${items.length}个。`);
  }
  const pool = [...items];
  const selected: string[] = [];
  while (selected.length < count) {
    selected.push(pool.splice(randomIndex(pool.length, randomInt), 1)[0]);
  }
  return selected;
}

export function buildSelectedMainImageSellingPointText(input: {
  headlineCandidateText: string;
  subtitleCandidateText: string;
  sellingPointCandidateText: string;
  randomInt?: (max: number) => number;
}): string {
  const headlines = parseMainImageCandidateText(input.headlineCandidateText);
  const subtitles = parseMainImageCandidateText(input.subtitleCandidateText);
  const sellingPoints = parseMainImageCandidateText(input.sellingPointCandidateText);
  if (!headlines.length && !subtitles.length && !sellingPoints.length) return "";
  if (!headlines.length) throw new Error("主图主标题字段至少需要1个候选内容。");
  if (!subtitles.length) throw new Error("主图副标题字段至少需要1个候选内容。");
  const randomInt = input.randomInt || ((max: number) => crypto.randomInt(max));
  const headline = headlines[randomIndex(headlines.length, randomInt)];
  const subtitle = subtitles[randomIndex(subtitles.length, randomInt)];
  const selectedSellingPoints = takeRandomUnique(sellingPoints, 3, randomInt);
  return [
    `突出放大的有设计感的艺术字：${headline}`,
    `尺寸略小一些的有设计感的艺术字：${subtitle}`,
    "官方正品",
    ...selectedSellingPoints,
    "图示产品的使用步骤",
    "突出产品使用部位。"
  ].join("，");
}

export function buildFeishuSellingPointText(input: {
  userCognitionName?: string;
  brandedGenericName?: string;
  sellingPointText: string;
}): string {
  return input.sellingPointText.trim();
}
