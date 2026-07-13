import path from "node:path";
import {
  getOrderedShopCodes,
  getShopSpecs,
  resolveMainImageShopAssignments,
  type ShopImageAssignment,
  type ShopSpec
} from "./shop-rules.js";

export type ProductCategory = "医疗器械" | "非处方药" | "保健食品";

export interface ProductCategoryPlan {
  category: ProductCategory;
  shopCodes: string[];
  promptCount: number;
  titleCount: number;
  imagesPerShop: number;
  titleRule: "medical_device" | "otc_drug" | "health_food";
  titleCharacterCount: number;
}

const DEFAULT_CATEGORY: ProductCategory = "医疗器械";
const PUBLISH_TARGETS_PER_PRODUCT = 20;

const CATEGORY_PLANS: Record<ProductCategory, ProductCategoryPlan> = {
  医疗器械: {
    category: "医疗器械",
    shopCodes: getOrderedShopCodes(),
    promptCount: 5,
    titleCount: 20,
    imagesPerShop: 1,
    titleRule: "medical_device",
    titleCharacterCount: 58
  },
  非处方药: {
    category: "非处方药",
    shopCodes: getOrderedShopCodes(10),
    promptCount: 5,
    titleCount: 20,
    imagesPerShop: 2,
    titleRule: "otc_drug",
    titleCharacterCount: 58
  },
  保健食品: {
    category: "保健食品",
    shopCodes: getOrderedShopCodes(),
    promptCount: 5,
    titleCount: 20,
    imagesPerShop: 1,
    titleRule: "health_food",
    titleCharacterCount: 28
  }
};

function assertCategoryPlanClosure(plans: Record<ProductCategory, ProductCategoryPlan>): void {
  const knownShopCodes = new Set(getOrderedShopCodes());
  for (const plan of Object.values(plans)) {
    const uniqueShopCodes = new Set(plan.shopCodes);
    if (uniqueShopCodes.size !== plan.shopCodes.length) {
      throw new Error(`Product category plan ${plan.category} contains duplicate shop codes.`);
    }
    const unknownShopCodes = plan.shopCodes.filter((shopCode) => !knownShopCodes.has(shopCode));
    if (unknownShopCodes.length > 0) {
      throw new Error(`Product category plan ${plan.category} contains unknown shop codes: ${unknownShopCodes.join(", ")}.`);
    }
    const targetCount = plan.shopCodes.length * plan.imagesPerShop;
    if (targetCount !== PUBLISH_TARGETS_PER_PRODUCT) {
      throw new Error(
        `Product category plan ${plan.category} must resolve to ${PUBLISH_TARGETS_PER_PRODUCT} targets, got ${targetCount}.`
      );
    }
  }
}

assertCategoryPlanClosure(CATEGORY_PLANS);

export function normalizeProductCategory(value: string | undefined): ProductCategory {
  const normalized = String(value || "").replace(/\s+/g, "").trim();
  if (!normalized) {
    return DEFAULT_CATEGORY;
  }
  if (normalized.includes("非处方") || /^OTC$/i.test(normalized)) {
    return "非处方药";
  }
  if (normalized.includes("保健食品") || normalized.includes("食品")) {
    return "保健食品";
  }
  if (normalized.includes("医疗器械") || normalized.includes("器械")) {
    return "医疗器械";
  }
  throw new Error(`Unsupported product category: ${value}`);
}

export function getProductCategoryPlan(value: string | undefined): ProductCategoryPlan {
  return CATEGORY_PLANS[normalizeProductCategory(value)];
}

export function shopCodeFromFolder(shopFolder: string): string {
  return path.basename(shopFolder).match(/^(\d{2})/)?.[1] || "";
}

export { getShopSpecs, resolveMainImageShopAssignments };
export type { ShopImageAssignment, ShopSpec };
