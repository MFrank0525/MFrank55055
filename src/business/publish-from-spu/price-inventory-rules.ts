export const FIXED_FEISHU_PRICE_STOCK = 2000;
export const EXPECTED_FEISHU_PRICE_ROW_COUNT = 4;

export interface PriceInventoryRowValue {
  price: number;
  stock: number;
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
  if (prices.length !== EXPECTED_FEISHU_PRICE_ROW_COUNT) {
    throw new Error(`Feishu 产品价格必须正好填写 ${EXPECTED_FEISHU_PRICE_ROW_COUNT} 个价格。`);
  }
  return prices.map((price) => ({
    price,
    stock: FIXED_FEISHU_PRICE_STOCK
  }));
}
