import type { GeneratedTitle } from "../types/index.js";

export function mergeAndRankCandidates(candidates: GeneratedTitle[]): GeneratedTitle[] {
  const seen = new Set<string>();
  return candidates
    .filter((candidate) => {
      if (!candidate.title || seen.has(candidate.title)) return false;
      seen.add(candidate.title);
      return true;
    })
    .map((candidate, index) => ({ ...candidate, score: candidate.score + Math.max(0, 20 - index * 3) }))
    .sort((a, b) => b.score - a.score);
}
