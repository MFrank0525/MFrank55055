import { classifyTerms } from "../analyzer/classifier.js";
import { countHighFrequencyTerms } from "../analyzer/term-frequency.js";
import { extractTitlePatterns } from "../analyzer/title-patterns.js";
import { tokenizeTitles } from "../analyzer/tokenizer.js";
import { saveAnalysisResult } from "../storage/title-repo.js";
import type { AnalysisResult, SearchSnapshot } from "../types/index.js";
import { logInfo } from "../utils/logger.js";
import { nowIso } from "../utils/time.js";
import { uniq } from "../utils/text.js";
import { getArg, getLatestSnapshotByKeyword, readSnapshotFile, requireArg } from "./shared.js";

function isUsableHotTerm(term: string, keyword: string): boolean {
  if (!term) return false;
  if (term === keyword) return true;
  if (term.length < 2 || term.length > 8) return false;
  if (/(怎么|如何|什么|哪个|牌子|最好|排名|原理|方法|校准|推荐|准确率|正确)/.test(term)) return false;
  if (/(第一|顶级|首选|根治|治愈|疗效)/.test(term)) return false;
  return true;
}

function buildPriceBands(prices: string[]): Array<{ range: string; count: number }> {
  const bands = [
    { range: "0-99", min: 0, max: 99, count: 0 },
    { range: "100-199", min: 100, max: 199, count: 0 },
    { range: "200+", min: 200, max: Number.MAX_SAFE_INTEGER, count: 0 }
  ];
  for (const raw of prices) {
    const value = Number(raw.replace(/[^\d.]/g, ""));
    if (!Number.isFinite(value)) continue;
    const band = bands.find((item) => value >= item.min && value <= item.max);
    if (band) band.count += 1;
  }
  return bands.map(({ range, count }) => ({ range, count }));
}

async function main(): Promise<void> {
  const keyword = requireArg("keyword");
  const snapshotFile = getArg("snapshotFile");
  const snapshot = snapshotFile
    ? readSnapshotFile<SearchSnapshot>(snapshotFile)
    : getLatestSnapshotByKeyword(keyword);
  if (!snapshot) throw new Error(`No snapshot found for keyword ${keyword}`);

  const titles = snapshot.items.map((item) => item.title);
  const titleTokens = tokenizeTitles(titles);
  const suggestionTokens = tokenizeTitles(snapshot.searchSuggestions || []);
  const weightedTokens = [...titleTokens, ...suggestionTokens, ...suggestionTokens];
  const highFreqTerms = countHighFrequencyTerms(weightedTokens).filter((term) => isUsableHotTerm(term, keyword));
  const classifiedTerms = classifyTerms(highFreqTerms);
  const suggestionTerms = countHighFrequencyTerms(suggestionTokens)
    .filter((term) => isUsableHotTerm(term, keyword) && term !== keyword)
    .slice(0, 12);
  const promotionTerms = uniq([
    ...(classifiedTerms.function || []),
    ...(classifiedTerms.people || []),
    ...(classifiedTerms.scene || []),
    ...(classifiedTerms.spec || []),
    ...suggestionTerms,
    ...snapshot.imageSearchHotTerms || []
  ]).filter((term) => isUsableHotTerm(term, keyword) && term !== keyword).slice(0, 16);

  const analysis: AnalysisResult = {
    keyword,
    analyzedAt: nowIso(),
    itemCount: snapshot.items.length,
    highFreqTerms,
    suggestionTerms,
    promotionTerms,
    titlePatterns: extractTitlePatterns(titles),
    classifiedTerms,
    priceBands: buildPriceBands(snapshot.items.map((item) => item.price || "")),
    sourceSnapshot: `${snapshot.keyword}-${snapshot.timestamp}`
  };

  const filePath = saveAnalysisResult(analysis);
  logInfo(`saved analysis: ${filePath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
