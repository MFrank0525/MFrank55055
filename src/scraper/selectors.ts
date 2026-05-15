export const SEARCH_CARD_SELECTORS = [
  ".search-result-card",
  "[class*='search-result-card']",
  "[data-e2e='search-result-item']",
  "[data-e2e='search-item']",
  "[data-e2e='search-item-container']",
  "[data-index]",
  "div:has(a[href*='/product/'])"
];

export const TITLE_SELECTORS = [".BjLsdJMi", "[data-e2e='search-card-title']", "h3", "a[title]", "a"];
export const PRICE_SELECTORS = ["[class*='price']", "[data-e2e*='price']"];
export const SALES_SELECTORS = [".pMq55q1M", "[class*='sold']", "[class*='sale']", "[data-e2e*='sales']"];
export const SHOP_SELECTORS = [".WldPmwm5", "[class*='shop']", "[data-e2e*='shop']"];
