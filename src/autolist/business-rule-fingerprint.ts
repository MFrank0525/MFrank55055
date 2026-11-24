import crypto from "node:crypto";
import { getProductCategoryPlan, type ProductCategory } from "./product-category.js";
import { getShopSpecs } from "./shop-rules.js";
import {
  MAIN_IMAGE_FRAME_EXCLUDED_BRANDS,
  MAIN_IMAGE_FRAME_LAYOUT_VERSION,
  MAIN_IMAGE_FRAME_SAFE_ZONE_PROMPT_CONTRACT
} from "./main-image-frame-rules.js";
import { MAIN_IMAGE_PROMPT_REVISION_POLICY } from "./main-image-prompt-revision-rules.js";
import {
  MAIN_IMAGE_COLLAGE_GATE_VERSION,
  MAIN_IMAGE_SINGLE_POSTER_PROMPT_CONTRACT
} from "./main-image-collage-action.js";
import { MAIN_IMAGE_VISUAL_DIRECTION_VERSION } from "./main-image-visual-direction-rules.js";
import { MAIN_IMAGE_VISUAL_QUALITY_GATE_VERSION } from "./main-image-visual-quality-action.js";
import {
  MAIN_IMAGE_FIXED_PROMPT_CONTRACT,
  MAIN_IMAGE_PROMPT_CONTRACT_VERSION
} from "./main-image-prompt-contract.js";

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
    }),
    mainImageFrame: {
      layoutVersion: MAIN_IMAGE_FRAME_LAYOUT_VERSION,
      excludedBrands: MAIN_IMAGE_FRAME_EXCLUDED_BRANDS,
      promptContract: MAIN_IMAGE_FRAME_SAFE_ZONE_PROMPT_CONTRACT
    },
    mainImagePromptRevisionPolicy: MAIN_IMAGE_PROMPT_REVISION_POLICY,
    mainImagePromptContract: {
      version: MAIN_IMAGE_PROMPT_CONTRACT_VERSION,
      text: MAIN_IMAGE_FIXED_PROMPT_CONTRACT
    },
    mainImageSinglePoster: {
      gateVersion: MAIN_IMAGE_COLLAGE_GATE_VERSION,
      promptContract: MAIN_IMAGE_SINGLE_POSTER_PROMPT_CONTRACT
    },
    mainImageVisualDirectionVersion: MAIN_IMAGE_VISUAL_DIRECTION_VERSION,
    mainImageVisualQualityGateVersion: MAIN_IMAGE_VISUAL_QUALITY_GATE_VERSION
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
