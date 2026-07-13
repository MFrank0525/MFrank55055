import crypto from "node:crypto";
import { getProductCategoryPlan, type ProductCategory } from "./product-category.js";
import { getShopSpecs } from "./shop-rules.js";

const CATEGORIES: ProductCategory[] = ["医疗器械", "非处方药", "保健食品"];

export function buildAutoListingBusinessRuleFingerprint(): string {
  const rules = {
    shops: getShopSpecs(),
    categories: CATEGORIES.map((category) => {
      const plan = getProductCategoryPlan(category);
      return {
        category: plan.category,
        shopCodes: plan.shopCodes,
        imagesPerShop: plan.imagesPerShop,
        promptCount: plan.promptCount,
        titleCount: plan.titleCount,
        titleRule: plan.titleRule,
        titleCharacterCount: plan.titleCharacterCount
      };
    })
  };
  return crypto.createHash("sha256").update(JSON.stringify(rules)).digest("hex").slice(0, 24);
}

export function canResumeAutoListingArtifacts(input: {
  currentBatchFingerprint?: string;
  resumeBatchFingerprint?: string;
  currentBusinessRuleFingerprint: string;
  resumeBusinessRuleFingerprint?: string;
}): boolean {
  return Boolean(
    input.currentBatchFingerprint &&
      input.resumeBatchFingerprint === input.currentBatchFingerprint &&
      input.resumeBusinessRuleFingerprint &&
      input.resumeBusinessRuleFingerprint === input.currentBusinessRuleFingerprint
  );
}
