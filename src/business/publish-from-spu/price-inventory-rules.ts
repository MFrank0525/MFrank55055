export const FIXED_FEISHU_PRICE_STOCK = 2000;

export interface PriceInventoryRowValue {
  price: number;
  stock: number;
}

export interface PriceInventoryRowCardinalityDecision {
  passed: boolean;
  issue: string;
}

export function parseFeishuProductPrices(priceText: string): number[] {
  const tokens = priceText
    .split(/[\n\r,，、;；|｜/]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (!tokens.length) {
    throw new Error("Feishu 产品价格 is required.");
  }
  const prices = tokens.map((token) => {
    const value = Number(token.replace(/,/g, ""));
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`Invalid Feishu 产品价格 value: ${token}`);
    }
    return value;
  });
  for (let index = 1; index < prices.length; index += 1) {
    if (prices[index - 1] < prices[index]) {
      throw new Error("Feishu 产品价格必须按照从大到小的顺序填写。");
    }
  }
  return prices;
}

export function resolveFeishuPriceInventoryRows(priceText: string): PriceInventoryRowValue[] {
  const prices = parseFeishuProductPrices(priceText);
  return prices.map((price) => ({
    price,
    stock: FIXED_FEISHU_PRICE_STOCK
  }));
}

export function evaluatePriceInventoryRowCardinality(input: {
  expectedPriceCount: number;
  actualSkuRowCount: number;
}): PriceInventoryRowCardinalityDecision {
  if (input.expectedPriceCount === input.actualSkuRowCount && input.expectedPriceCount > 0) {
    return { passed: true, issue: "" };
  }
  return {
    passed: false,
    issue: `Price/inventory row count must exact match Feishu price count: expected=${input.expectedPriceCount}; actual=${input.actualSkuRowCount}`
  };
}
