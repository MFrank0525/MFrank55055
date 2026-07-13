export interface ShopSpec {
  shopCode: string;
  watermarkText: string;
}

export interface ShopImageAssignment {
  shopCode: string;
  imageOrdinalInShop: number;
}

export const SHOP_SPECS: readonly ShopSpec[] = [
  { shopCode: "01", watermarkText: "延草纲目大药房专营店" },
  { shopCode: "02", watermarkText: "延草纲目药品专营店" },
  { shopCode: "03", watermarkText: "延草纲目个护保健专营店" },
  { shopCode: "04", watermarkText: "延草纲目康复理疗专营店" },
  { shopCode: "05", watermarkText: "延草纲目医疗保健专营店" },
  { shopCode: "06", watermarkText: "延草纲目滋补专卖店" },
  { shopCode: "07", watermarkText: "延草纲目基础营养专卖店" },
  { shopCode: "08", watermarkText: "延草纲目身体护理专卖店" },
  { shopCode: "09", watermarkText: "延草纲目保健用品专卖店" },
  { shopCode: "10", watermarkText: "延草纲目营养膳食专卖店" },
  { shopCode: "11", watermarkText: "延草纲目理疗器械旗舰店" },
  { shopCode: "12", watermarkText: "延草纲目健康护理专营店" },
  { shopCode: "13", watermarkText: "延草纲目家庭护理专营店" },
  { shopCode: "14", watermarkText: "延草纲目中医保健专营店" },
  { shopCode: "15", watermarkText: "延草纲目养生器械专营店" },
  { shopCode: "16", watermarkText: "延草纲目特医食品专营店" },
  { shopCode: "17", watermarkText: "延草纲目美体器械专卖店" },
  { shopCode: "18", watermarkText: "延草纲目护肤专卖店" },
  { shopCode: "19", watermarkText: "延草纲目体外检测专卖店" },
  { shopCode: "20", watermarkText: "延草纲目防护用品专卖店" }
] as const;

export function getShopSpecs(): ShopSpec[] {
  return SHOP_SPECS.map((item) => ({ ...item }));
}

export function getOrderedShopCodes(limit = SHOP_SPECS.length): string[] {
  if (!Number.isInteger(limit) || limit < 1 || limit > SHOP_SPECS.length) {
    throw new Error(`Shop code limit must be between 1 and ${SHOP_SPECS.length}, got ${limit}.`);
  }
  return SHOP_SPECS.slice(0, limit).map((item) => item.shopCode);
}

export function resolveMainImageShopAssignments(input: {
  shopCodes: string[];
  imagesPerShop: number;
  totalImageCount: number;
}): ShopImageAssignment[] {
  if (input.imagesPerShop <= 0) {
    throw new Error(`imagesPerShop must be greater than 0, got ${input.imagesPerShop}.`);
  }
  const expectedTotal = input.shopCodes.length * input.imagesPerShop;
  if (expectedTotal !== input.totalImageCount) {
    throw new Error(
      `Shop image assignment mismatch: shopCodes=${input.shopCodes.length}, imagesPerShop=${input.imagesPerShop}, expectedTotal=${expectedTotal}, totalImageCount=${input.totalImageCount}.`
    );
  }

  return input.shopCodes.flatMap((shopCode) =>
    Array.from({ length: input.imagesPerShop }, (_, index) => ({
      shopCode,
      imageOrdinalInShop: index + 1
    }))
  );
}
