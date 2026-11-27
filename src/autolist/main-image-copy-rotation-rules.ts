import crypto from "node:crypto";
import { parseMainImageCandidateText } from "./selling-point-rules.js";

const HEADLINE_PREFIX = "突出放大的有设计感的艺术字：";
const SUBTITLE_PREFIX = "尺寸略小一些的有设计感的艺术字：";
const FIXED_AUTHENTICITY_COPY = "官方正品";
const FIXED_USAGE_COPY = "图示产品的使用步骤";
const FIXED_BODY_COPY = "突出产品使用部位";

export interface MainImageCopyCandidateInput {
  headlineCandidateText: string;
  subtitleCandidateText: string;
  sellingPointCandidateText: string;
}

export interface MainImageCopyRecordHistory {
  candidateDigest: string;
  usedSelectionDigests: string[];
  lastSelectionText: string;
  cycle: number;
}

export interface RotatingMainImageCopySelection {
  candidateDigest: string;
  selectionDigest: string;
  sellingPointText: string;
  cycle: number;
  combinationCount: number;
}

export interface ParsedMainImageCopy {
  headline: string;
  subtitle: string;
  sellingPoints: string[];
}

function digest(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function normalizeCandidates(input: MainImageCopyCandidateInput): {
  headlines: string[];
  subtitles: string[];
  sellingPoints: string[];
} {
  const headlines = parseMainImageCandidateText(input.headlineCandidateText);
  const subtitles = parseMainImageCandidateText(input.subtitleCandidateText);
  const sellingPoints = parseMainImageCandidateText(input.sellingPointCandidateText)
    .filter((value) => value !== FIXED_AUTHENTICITY_COPY);
  if (!headlines.length && !subtitles.length && !sellingPoints.length) {
    return { headlines, subtitles, sellingPoints };
  }
  if (!headlines.length) throw new Error("主图主标题字段至少需要1个候选内容。");
  if (!subtitles.length) throw new Error("主图副标题字段至少需要1个候选内容。");
  if (sellingPoints.length < 5) {
    throw new Error(`主图卖点字段至少需要5个不同候选内容（固定文案“${FIXED_AUTHENTICITY_COPY}”不计入候选），当前只有${sellingPoints.length}个。`);
  }
  return { headlines, subtitles, sellingPoints };
}

function combinationsOfFive(values: string[]): string[][] {
  const output: string[][] = [];
  const visit = (start: number, selected: string[]): void => {
    if (selected.length === 5) {
      output.push(selected);
      return;
    }
    for (let index = start; index <= values.length - (5 - selected.length); index += 1) {
      visit(index + 1, [...selected, values[index]]);
    }
  };
  visit(0, []);
  return output;
}

export function formatSelectedMainImageCopy(input: ParsedMainImageCopy): string {
  return [
    `${HEADLINE_PREFIX}${input.headline}`,
    `${SUBTITLE_PREFIX}${input.subtitle}`,
    FIXED_AUTHENTICITY_COPY,
    ...input.sellingPoints,
    FIXED_USAGE_COPY,
    `${FIXED_BODY_COPY}。`
  ].join("，");
}

export function parseSelectedMainImageCopy(value: string): ParsedMainImageCopy {
  const parts = value.trim().replace(/。$/, "").split("，").map((part) => part.trim()).filter(Boolean);
  if (
    parts.length !== 10 ||
    !parts[0].startsWith(HEADLINE_PREFIX) ||
    !parts[1].startsWith(SUBTITLE_PREFIX) ||
    parts[2] !== FIXED_AUTHENTICITY_COPY ||
    parts[8] !== FIXED_USAGE_COPY ||
    parts[9] !== FIXED_BODY_COPY ||
    new Set(parts.slice(3, 8)).size !== 5 ||
    parts.slice(3, 8).includes(FIXED_AUTHENTICITY_COPY)
  ) {
    throw new Error("Main-image copy does not match the immutable ten-part structure.");
  }
  return {
    headline: parts[0].slice(HEADLINE_PREFIX.length),
    subtitle: parts[1].slice(SUBTITLE_PREFIX.length),
    sellingPoints: parts.slice(3, 8)
  };
}

export function buildMainImageCopyCandidateDigest(input: MainImageCopyCandidateInput): string {
  return digest(JSON.stringify(normalizeCandidates(input)));
}

export function digestSelectedMainImageCopy(value: string): string {
  const parsed = parseSelectedMainImageCopy(value);
  return digest(JSON.stringify({
    headline: parsed.headline,
    subtitle: parsed.subtitle,
    sellingPoints: [...parsed.sellingPoints].sort((left, right) => left.localeCompare(right, "zh-CN"))
  }));
}

export function countMainImageCopyCombinations(input: MainImageCopyCandidateInput): number {
  const normalized = normalizeCandidates(input);
  if (!normalized.headlines.length) return 0;
  return normalized.headlines.length * normalized.subtitles.length * combinationsOfFive(normalized.sellingPoints).length;
}

function differenceScore(candidate: ParsedMainImageCopy, previous: ParsedMainImageCopy | undefined): number {
  if (!previous) return 0;
  const differentSellingPoints = candidate.sellingPoints.filter((value) => !previous.sellingPoints.includes(value)).length;
  return (candidate.headline !== previous.headline ? 100 : 0) +
    (candidate.subtitle !== previous.subtitle ? 50 : 0) + differentSellingPoints * 10;
}

export function selectRotatingMainImageCopy(input: MainImageCopyCandidateInput & {
  recordId: string;
  history?: MainImageCopyRecordHistory;
  additionalPreviouslyUsedSellingPointTexts?: string[];
}): RotatingMainImageCopySelection {
  const normalized = normalizeCandidates(input);
  if (!normalized.headlines.length) {
    return { candidateDigest: "", selectionDigest: "", sellingPointText: "", cycle: 0, combinationCount: 0 };
  }
  const candidateDigest = buildMainImageCopyCandidateDigest(input);
  const matchingHistory = input.history?.candidateDigest === candidateDigest ? input.history : undefined;
  const additionalTexts = input.additionalPreviouslyUsedSellingPointTexts || [];
  const additionalDigests = additionalTexts.flatMap((value) => {
    try {
      return [digestSelectedMainImageCopy(value)];
    } catch {
      return [];
    }
  });
  const used = new Set([...(matchingHistory?.usedSelectionDigests || []), ...additionalDigests]);
  const previousText = matchingHistory?.lastSelectionText || additionalTexts.at(-1) || "";
  let previous: ParsedMainImageCopy | undefined;
  try {
    previous = previousText ? parseSelectedMainImageCopy(previousText) : undefined;
  } catch {
    previous = undefined;
  }
  const combinations = combinationsOfFive(normalized.sellingPoints);
  const all = normalized.headlines.flatMap((headline) => normalized.subtitles.flatMap((subtitle) =>
    combinations.map((sellingPoints) => {
      const sellingPointText = formatSelectedMainImageCopy({ headline, subtitle, sellingPoints });
      return {
        sellingPointText,
        selectionDigest: digestSelectedMainImageCopy(sellingPointText),
        parsed: { headline, subtitle, sellingPoints },
        order: digest(`${input.recordId}\n${candidateDigest}\n${sellingPointText}`)
      };
    })
  ));
  const exhausted = all.every((candidate) => used.has(candidate.selectionDigest));
  const available = exhausted ? all : all.filter((candidate) => !used.has(candidate.selectionDigest));
  available.sort((left, right) =>
    differenceScore(right.parsed, previous) - differenceScore(left.parsed, previous) || left.order.localeCompare(right.order)
  );
  const selected = available[0];
  return {
    candidateDigest,
    selectionDigest: selected.selectionDigest,
    sellingPointText: selected.sellingPointText,
    cycle: exhausted ? (matchingHistory?.cycle || 1) + 1 : matchingHistory?.cycle || 1,
    combinationCount: all.length
  };
}
