import crypto from "node:crypto";
import { buildSelectedMainImageSellingPointText, parseMainImageCandidateText } from "./selling-point-rules.js";

export const MAIN_IMAGE_PROMPT_REVISION_POLICY = "feishu-source-local-qwen-atomic-v2";

export interface MainImagePromptRevision {
  revisionId: string;
  sellingPointDigest: string;
  previousSellingPointDigest: string;
  sellingPointText: string;
  previousSellingPointText: string;
  createdAt: string;
}

export function digestMainImagePromptSource(value: string): string {
  return crypto.createHash("sha256").update(value.trim(), "utf8").digest("hex");
}

function combinationsOfFive(values: string[]): string[][] {
  const combinations: string[][] = [];
  const visit = (start: number, selected: string[]): void => {
    if (selected.length === 5) {
      combinations.push(selected);
      return;
    }
    for (let index = start; index <= values.length - (5 - selected.length); index += 1) {
      visit(index + 1, [...selected, values[index]]);
    }
  };
  if (values.length >= 5) {
    visit(0, []);
  }
  return combinations;
}

function parseSelectedSellingPointText(value: string): {
  headline: string;
  subtitle: string;
  sellingPoints: string[];
} {
  const parts = value.replace(/。$/, "").split("，").map((part) => part.trim()).filter(Boolean);
  if (
    parts.length !== 10 ||
    !parts[0].startsWith("突出放大的有设计感的艺术字：") ||
    !parts[1].startsWith("尺寸略小一些的有设计感的艺术字：") ||
    parts[2] !== "官方正品" ||
    parts[8] !== "图示产品的使用步骤" ||
    parts[9] !== "突出产品使用部位" ||
    new Set(parts.slice(3, 8)).size !== 5
  ) {
    throw new Error("Current main-image selling points do not match the immutable ten-part structure.");
  }
  return {
    headline: parts[0].slice("突出放大的有设计感的艺术字：".length),
    subtitle: parts[1].slice("尺寸略小一些的有设计感的艺术字：".length),
    sellingPoints: parts.slice(3, 8)
  };
}

export function selectNextFeishuMainImageSellingPointText(input: {
  headlineCandidateText: string;
  subtitleCandidateText: string;
  sellingPointCandidateText: string;
  currentSellingPointText: string;
  previouslyUsedSellingPointTexts?: string[];
}): string {
  const headlines = parseMainImageCandidateText(input.headlineCandidateText);
  const subtitles = parseMainImageCandidateText(input.subtitleCandidateText);
  const sellingPoints = parseMainImageCandidateText(input.sellingPointCandidateText).filter((value) => value !== "官方正品");
  const current = parseSelectedSellingPointText(input.currentSellingPointText);
  const used = new Set([
    input.currentSellingPointText.trim(),
    ...(input.previouslyUsedSellingPointTexts || []).map((value) => value.trim())
  ]);
  const sellingPointCombinations = combinationsOfFive(sellingPoints);
  const candidates: Array<{ text: string; completelyChanged: boolean }> = [];
  for (const headline of headlines) {
    for (const subtitle of subtitles) {
      for (const selectedSellingPoints of sellingPointCombinations) {
        const text = buildSelectedMainImageSellingPointText({
          headlineCandidateText: headline,
          subtitleCandidateText: subtitle,
          sellingPointCandidateText: selectedSellingPoints.join("，"),
          randomInt: () => 0
        });
        if (used.has(text)) continue;
        candidates.push({
          text,
          completelyChanged:
            headline !== current.headline &&
            subtitle !== current.subtitle &&
            selectedSellingPoints.every((value) => !current.sellingPoints.includes(value))
        });
      }
    }
  }
  const selected = candidates.find((candidate) => candidate.completelyChanged) || candidates[0];
  if (!selected) {
    throw new Error("Feishu main-image candidates are exhausted; no unused fixed-structure revision remains.");
  }
  return selected.text;
}

export function createMainImagePromptRevision(input: {
  previousSellingPointText: string;
  sellingPointText: string;
  createdAt?: string;
}): MainImagePromptRevision {
  const previousSellingPointDigest = digestMainImagePromptSource(input.previousSellingPointText);
  const sellingPointDigest = digestMainImagePromptSource(input.sellingPointText);
  if (previousSellingPointDigest === sellingPointDigest) {
    throw new Error("Main-image prompt revision must change the Feishu-derived selling-point source.");
  }
  return {
    revisionId: `feishu-source-${sellingPointDigest.slice(0, 16)}`,
    sellingPointDigest,
    previousSellingPointDigest,
    sellingPointText: input.sellingPointText.trim(),
    previousSellingPointText: input.previousSellingPointText.trim(),
    createdAt: input.createdAt || new Date().toISOString()
  };
}

export function assertPromptWordRevisionMatches(input: {
  paragraphs: string[];
  sellingPointText: string;
  scenePrompt: string;
}): void {
  if (input.paragraphs.length !== 2) {
    throw new Error(`Main-image Word prompt must contain exactly two variable paragraphs, got ${input.paragraphs.length}.`);
  }
  if (input.paragraphs[0].trim() !== input.sellingPointText.trim()) {
    throw new Error("Main-image Word prompt mixes a stale selling-point revision.");
  }
  if (input.paragraphs[1].trim() !== input.scenePrompt.trim()) {
    throw new Error("Main-image Word prompt mixes a stale local-Qwen scene-plan revision.");
  }
}
