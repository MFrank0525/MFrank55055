import { generateTitlesWithAI } from "../generator/ai-provider.js";
import { buildPrompt } from "../generator/prompt-builder.js";
import { mergeAndRankCandidates } from "../generator/ranker.js";
import { generateTitlesByTemplate } from "../generator/template-generator.js";
import { loadRiskDictionary } from "../risk/dictionary.js";
import { filterUnsafeTitles } from "../risk/filters.js";
import { saveGeneratedTitles } from "../storage/title-repo.js";
import type { GenerationResult } from "../types/index.js";
import { logInfo } from "../utils/logger.js";
import { nowIso } from "../utils/time.js";
import { getLatestAnalysisByKeyword, getArg, readAnalysisFile, readProductFile, requireArg } from "./shared.js";

async function main(): Promise<void> {
  const productFile = requireArg("productFile");
  const keyword = getArg("keyword");
  const explicitAnalysisFile = getArg("analysisFile");
  const product = readProductFile(productFile);
  const analysis = explicitAnalysisFile
    ? readAnalysisFile(explicitAnalysisFile)
    : getLatestAnalysisByKeyword(keyword || product.productName);

  if (!analysis) throw new Error("Analysis file not found. Run search and analyze first.");

  const templateCandidates = generateTitlesByTemplate(product, analysis);
  const aiCandidates = await generateTitlesWithAI(buildPrompt(product, analysis));
  const ranked = mergeAndRankCandidates([...templateCandidates, ...aiCandidates]);
  const { safeTitles, warnings } = filterUnsafeTitles(ranked, loadRiskDictionary());

  const result: GenerationResult = {
    keyword: analysis.keyword,
    generatedAt: nowIso(),
    recommendedTitles: safeTitles,
    warnings,
    analysisFile: analysis.sourceSnapshot,
    productFile
  };

  const filePath = saveGeneratedTitles(result);
  logInfo(`saved generated titles: ${filePath}`);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
