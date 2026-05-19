import path from "node:path";

export type ProductCategory = "医疗器械" | "非处方药" | "保健食品";

export interface ProductCategoryPlan {
  category: ProductCategory;
  shopCodes: string[];
  promptCount: number;
  titleCount: number;
  titleRule: "medical_device" | "otc_drug" | "health_food";
  titleCharacterCount: number;
}

const DEFAULT_CATEGORY: ProductCategory = "医疗器械";

const CATEGORY_PLANS: Record<ProductCategory, ProductCategoryPlan> = {
  医疗器械: {
    category: "医疗器械",
    shopCodes: ["01", "02", "03", "04", "05"],
    promptCount: 5,
    titleCount: 20,
    titleRule: "medical_device",
    titleCharacterCount: 58
  },
  非处方药: {
    category: "非处方药",
    shopCodes: ["03", "04", "05"],
    promptCount: 3,
    titleCount: 12,
    titleRule: "otc_drug",
    titleCharacterCount: 58
  },
  保健食品: {
    category: "保健食品",
    shopCodes: ["01", "02", "03", "04", "05"],
    promptCount: 5,
    titleCount: 20,
    titleRule: "health_food",
    titleCharacterCount: 28
  }
};

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

