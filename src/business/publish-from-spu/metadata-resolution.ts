import path from "node:path";
import { normalizeProductCategory } from "../../autolist/product-category.js";
import { normalizeShopName } from "./shop-name.js";
import type {
  ProductAssets,
  ProductSheetSummary,
  PublishFromSpuMetadata,
  ResolvedPublishFromSpuMetadata
} from "./types.js";

export function assertResolvedMetadata(
  metadata: {
    brand: string;
    spu: string;
    title: string;
    shortTitle: string;
    modelSpec: string;
    productPriceText: string;
    productCategory?: string;
  },
  mode: string
): void {
  const productCategory = normalizeProductCategory(metadata.productCategory);
  const missingFields: string[] = [];
  if (!metadata.brand.trim()) {
    missingFields.push("brand");
  }
  if (!metadata.spu.trim()) {
    missingFields.push("spu");
  }
  if (!metadata.title.trim()) {
    missingFields.push("title");
  }
  if (!metadata.shortTitle.trim()) {
    missingFields.push("shortTitle");
  }
  if (productCategory !== "保健食品" && !metadata.modelSpec.trim()) {
    missingFields.push("modelSpec");
  }
  if (!metadata.productPriceText.trim()) {
    missingFields.push("productPriceText");
  }
  if (missingFields.length > 0) {
    throw new Error(`Publish workbook metadata was incomplete for mode=${mode}: ${missingFields.join(", ")}`);
  }
}

export function resolvePublishFromSpuMetadata(input: {
  metadataOverride?: PublishFromSpuMetadata;
  workbook: ProductSheetSummary;
}): ResolvedPublishFromSpuMetadata {
  const metadataOverride = input.metadataOverride || {};
  const productCategory = normalizeProductCategory(metadataOverride.productCategory);
  return {
    ...metadataOverride,
    productCategory,
    brand: metadataOverride.brand || input.workbook.brand || "",
    spu: metadataOverride.spu || input.workbook.spu || "",
    title: metadataOverride.title || input.workbook.title || "",
    shortTitle: metadataOverride.shortTitle || input.workbook.shortTitle || "",
    modelSpec: metadataOverride.modelSpec || input.workbook.modelSpec || (productCategory === "保健食品" ? "" : "盒装"),
    productPriceText: metadataOverride.productPriceText || input.workbook.productPriceText || ""
  };
}

export function assertProductAssetsForShop(
  assets: ProductAssets,
  shopFolder: string,
  productFolder: string
): void {
  const expectedShopName = normalizeShopName(path.basename(shopFolder));
  const expectedShopVariants = new Set<string>([expectedShopName]);
  if (expectedShopName.includes("延草纲目健康护理专营店")) {
    expectedShopVariants.add("延草纲目健康护理旗舰店");
  }
  if (expectedShopName.includes("延草纲目健康护理旗舰店")) {
    expectedShopVariants.add("延草纲目健康护理专营店");
  }
  const primaryMainImage = assets.mainImages[0] || "";
  if (!primaryMainImage) {
    throw new Error(`Primary main image was missing for product folder: ${productFolder}`);
  }

  const mainImageName = normalizeShopName(path.basename(primaryMainImage));
  if (![...expectedShopVariants].some((variant) => mainImageName.includes(variant))) {
    throw new Error(
      `Primary main image watermark shop did not match current shop folder. shop=${[...expectedShopVariants].join(" / ")}, image=${path.basename(primaryMainImage)}`
    );
  }

  for (const detailImage of assets.detailImages) {
    const detailImageName = path.basename(detailImage);
    if (!/资质|医疗器械注册证|医疗器械备案|白装展开图|包装展开图/i.test(detailImageName)) {
      throw new Error(`Detail image did not look like a qualification/detail asset: ${detailImageName}`);
    }
  }
}
