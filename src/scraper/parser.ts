import type { ElementHandle, Page } from "playwright";
import type { SearchItem } from "../types/index.js";
import { cleanText } from "../utils/text.js";
import { PRICE_SELECTORS, SALES_SELECTORS, SHOP_SELECTORS, TITLE_SELECTORS } from "./selectors.js";

async function firstText(handle: ElementHandle<HTMLElement>, selectors: string[]): Promise<string> {
  for (const selector of selectors) {
    try {
      const node = await handle.$(selector);
      const text = cleanText((await node?.innerText()) || "");
      if (text) return text;
    } catch {
      continue;
    }
  }
  return "";
}

export async function parseProductCard(
  page: Page,
  element: ElementHandle<HTMLElement>,
  rank: number,
  keyword: string
): Promise<SearchItem | null> {
  const title = await firstText(element, TITLE_SELECTORS);
  if (!title) return null;

  let url = "";
  let imageUrl = "";
  try {
    const anchor = await element.$("a[href]");
    const href = await anchor?.getAttribute("href");
    url = href ? new URL(href, page.url()).toString() : page.url();
    const img = await element.$("img");
    imageUrl = (await img?.getAttribute("src")) || "";
  } catch {
    url = page.url();
  }

  return {
    rank,
    keyword,
    title,
    price: await firstText(element, PRICE_SELECTORS),
    salesText: await firstText(element, SALES_SELECTORS),
    shopName: await firstText(element, SHOP_SELECTORS),
    url,
    imageUrl,
    collectedAt: new Date().toISOString()
  };
}
