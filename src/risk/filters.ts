import type { GeneratedTitle } from "../types/index.js";
import { scanTitleRisks } from "./scanner.js";

export function filterUnsafeTitles(
  titles: GeneratedTitle[],
  riskDictionary: { block: string[]; warn: string[] }
): { safeTitles: GeneratedTitle[]; warnings: string[] } {
  const warnings: string[] = [];
  const safeTitles: GeneratedTitle[] = [];

  for (const title of titles) {
    const result = scanTitleRisks(title.title, riskDictionary);
    if (result.level === "block") {
      warnings.push(`${title.title}: ${result.flags.join(", ")}`);
      continue;
    }
    safeTitles.push({ ...title, riskFlags: result.flags });
    if (result.level === "warn") warnings.push(`${title.title}: ${result.flags.join(", ")}`);
  }

  return { safeTitles, warnings };
}
