import { closeBrowser, launchPersistentBrowser, openSearchPage, openSuggestionPage } from "../browser/launch.js";
import { DouyinSearchScraper } from "../scraper/douyin-search.js";
import { saveRawSearchSnapshot } from "../storage/search-repo.js";
import type { SearchItem, SearchSnapshot } from "../types/index.js";
import { logInfo, logWarn } from "../utils/logger.js";
import { nowIso } from "../utils/time.js";
import { requireArg, getArg, readTermListFile } from "./shared.js";

async function main(): Promise<void> {
  const keyword = requireArg("keyword");
  const maxResults = Number(getArg("maxResults", "20"));
  const imageSearchHotTermsFile = getArg("imageSearchHotTermsFile");
  const context = await launchPersistentBrowser();
  const scraper = new DouyinSearchScraper();

  try {
    const suggestionPage = await openSuggestionPage(context);
    const searchSuggestions = await scraper.collectSearchSuggestions(suggestionPage, keyword, 12);
    if (searchSuggestions.length) {
      logInfo(`captured suggestions: ${searchSuggestions.join(" | ")}`);
    }

    const page = await openSearchPage(context, keyword);
    const items = await scraper.collectSearchResults(page, keyword, maxResults);
    const imageSearchHotTerms = imageSearchHotTermsFile ? readTermListFile(imageSearchHotTermsFile).slice(0, 20) : [];

    if (!items.length) {
      logWarn("no live search results captured");
    }
    if (imageSearchHotTerms.length) {
      logInfo(`loaded image-search hot terms: ${imageSearchHotTerms.join(" | ")}`);
    }

    const snapshot: SearchSnapshot = {
      keyword,
      timestamp: nowIso(),
      items: items as SearchItem[],
      searchSuggestions,
      imageSearchHotTerms,
      source: "live",
      note: "Collected from Douyin search suggestions, general search result cards, and optional image-search hot terms."
    };

    const filePath = saveRawSearchSnapshot(snapshot);
    logInfo(`saved snapshot: ${filePath}`);
    console.log(JSON.stringify(snapshot, null, 2));
  } finally {
    await closeBrowser(context);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
