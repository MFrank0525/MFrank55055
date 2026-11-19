export const FIXED_FEISHU_PRICE_STOCK = 2000;

export interface PriceInventoryRowValue {
  price: number;
  stock: number;
}

export interface PriceInventoryRowCardinalityDecision {
  passed: boolean;
  issue: string;
}

const CONTROLLED_SPEC_TEMPLATE_SKU_COUNTS: Readonly<Record<string, number>> = {
  "买一送一": 2,
  "买二送一": 4
};

export function evaluateControlledSpecTemplatePriceCardinality(input: {
  specTemplate: string;
  priceCount: number;
}): PriceInventoryRowCardinalityDecision {
  const template = input.specTemplate.replace(/\s+/g, "").trim();
  const expectedPriceCount = CONTROLLED_SPEC_TEMPLATE_SKU_COUNTS[template];
  if (expectedPriceCount === undefined || expectedPriceCount === input.priceCount) {
    return { passed: true, issue: "" };
  }
  return {
    passed: false,
    issue: `Feishu controlled spec-template/price cardinality mismatch: template=${template}; expectedPrices=${expectedPriceCount}; actualPrices=${input.priceCount}. Correct 规格模板 or 产品价格 in Feishu before continuing.`
  };
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
