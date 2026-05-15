import type { Page } from "playwright";
import type { SearchItem } from "../types/index.js";
import { logInfo, logWarn } from "../utils/logger.js";
import { parseProductCard } from "./parser.js";
import { SEARCH_CARD_SELECTORS } from "./selectors.js";

export class DouyinSearchScraper {
  async collectSearchSuggestions(page: Page, keyword: string, maxSuggestions = 10): Promise<string[]> {
    const input = page.locator("input").first();
    await input.click();
    await input.fill(keyword);
    await page.waitForTimeout(1800);

    const suggestions = await page.evaluate(
      ({ limit }) => {
        const input = document.querySelector("input");
        if (!(input instanceof HTMLInputElement)) return [];
        const rect = input.getBoundingClientRect();
        const seen = new Set<string>();
        const results: string[] = [];

        const elements = Array.from(document.querySelectorAll("body *"));
        for (const element of elements) {
          const text = (element.textContent || "").trim().replace(/\s+/g, " ");
          if (!text || text.length < 2 || text.length > 30) continue;
          if (text === "搜索") continue;

          const box = element.getBoundingClientRect();
          const withinVerticalRange = box.top >= rect.bottom && box.top <= rect.bottom + 360;
          const withinHorizontalRange = box.left >= rect.left - 12 && box.left <= rect.right + 120;
          const isSuggestionLike = box.width >= 100 && box.height >= 20 && box.height <= 40;
          if (!withinVerticalRange || !withinHorizontalRange || !isSuggestionLike) continue;
          if (seen.has(text)) continue;

          seen.add(text);
          results.push(text);
          if (results.length >= limit) break;
        }
        return results;
      },
      { limit: maxSuggestions }
    );

    if (!suggestions.length) {
      logWarn("no search suggestions captured");
    }
    return suggestions;
  }

  async collectSearchResults(page: Page, keyword: string, maxResults: number): Promise<SearchItem[]> {
    await page.waitForTimeout(8000);
    const selector = await this.findWorkingSelector(page);
    if (!selector) {
      throw new Error("No working search card selector found. Update src/scraper/selectors.ts.");
    }

    logInfo(`collecting search results with selector ${selector}`);
    const cards = await page.$$(selector);
    const items: SearchItem[] = [];

    for (const [index, card] of cards.slice(0, maxResults * 3).entries()) {
      const parsed = await parseProductCard(page, card as any, items.length + 1, keyword);
      if (!parsed) continue;
      if (items.some((item) => item.title === parsed.title)) continue;
      items.push(parsed);
      if (items.length >= maxResults) break;
    }

    if (!items.length) {
      logWarn("no items parsed from page");
    }
    return items;
  }

  private async findWorkingSelector(page: Page): Promise<string | null> {
    for (const selector of SEARCH_CARD_SELECTORS) {
      try {
        const count = await page.locator(selector).count();
        if (count > 0) return selector;
      } catch {}
    }
    return null;
  }
}
