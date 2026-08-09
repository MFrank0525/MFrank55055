import { normalizeProductCategory, type ProductCategory } from "../../autolist/product-category.js";
import { SPEC_TEMPLATE_KEYWORD_DEFAULT, SPEC_TEMPLATE_KEYWORD_JIUGUANG } from "./constants.js";

export type CategoryAttributeMutationPolicy =
  | "fill_model_spec"
  | "fill_health_food_fields"
  | "leave_platform_state";

export type SpecTemplateSelectionPolicy = "title_controlled" | "buy_two_get_one";
export type SubmitValidationPolicy = "generic_fill_check" | "health_food_packaging_gate";

export interface PublishCategoryMutationPolicy {
  readonly categoryAttributes: CategoryAttributeMutationPolicy;
  readonly specTemplateSelection: SpecTemplateSelectionPolicy;
  readonly guardUnexpectedBasicFieldChanges: boolean;
  readonly healthFoodSafetyAndCategoryAttributes: boolean;
  readonly healthFoodShippingBeforeSpecification: boolean;
  readonly healthFoodSpecification: boolean;
  readonly verifySpuInServiceSettings: boolean;
  readonly healthFoodPackagingLabel: boolean;
  readonly medicalDeviceCertificate: boolean;
  readonly submitValidation: SubmitValidationPolicy;
}

const CATEGORY_MUTATION_POLICIES: Record<ProductCategory, PublishCategoryMutationPolicy> = {
  医疗器械: {
    categoryAttributes: "fill_model_spec",
    specTemplateSelection: "title_controlled",
    guardUnexpectedBasicFieldChanges: true,
    healthFoodSafetyAndCategoryAttributes: false,
    healthFoodShippingBeforeSpecification: false,
    healthFoodSpecification: false,
    verifySpuInServiceSettings: true,
    healthFoodPackagingLabel: false,
    medicalDeviceCertificate: true,
    submitValidation: "generic_fill_check"
  },
  非处方药: {
    categoryAttributes: "leave_platform_state",
    specTemplateSelection: "buy_two_get_one",
    guardUnexpectedBasicFieldChanges: true,
    healthFoodSafetyAndCategoryAttributes: false,
    healthFoodShippingBeforeSpecification: false,
    healthFoodSpecification: false,
    verifySpuInServiceSettings: true,
    healthFoodPackagingLabel: false,
    medicalDeviceCertificate: false,
    submitValidation: "generic_fill_check"
  },
  保健食品: {
    categoryAttributes: "fill_health_food_fields",
    specTemplateSelection: "buy_two_get_one",
    guardUnexpectedBasicFieldChanges: false,
    healthFoodSafetyAndCategoryAttributes: true,
    healthFoodShippingBeforeSpecification: true,
    healthFoodSpecification: true,
    verifySpuInServiceSettings: false,
    healthFoodPackagingLabel: true,
    medicalDeviceCertificate: false,
    submitValidation: "health_food_packaging_gate"
  }
};

export function assertPublishCategoryPolicyIsolation(
  policies: Record<ProductCategory, PublishCategoryMutationPolicy>
): void {
  for (const [category, policy] of Object.entries(policies)) {
    if (policy.medicalDeviceCertificate && policy.healthFoodPackagingLabel) {
      throw new Error(`${category} cannot run both medical-device certificate and health-food packaging actions.`);
    }
    const healthFoodActions = [
      policy.healthFoodSafetyAndCategoryAttributes,
      policy.healthFoodShippingBeforeSpecification,
      policy.healthFoodSpecification,
      policy.healthFoodPackagingLabel,
      policy.submitValidation === "health_food_packaging_gate"
    ];
    if (healthFoodActions.some(Boolean) && !healthFoodActions.every(Boolean)) {
      throw new Error(`${category} contains a partially enabled health-food action chain.`);
    }
  }
}

assertPublishCategoryPolicyIsolation(CATEGORY_MUTATION_POLICIES);

export function getPublishCategoryMutationPolicy(category: string | undefined): PublishCategoryMutationPolicy {
  return Object.freeze({ ...CATEGORY_MUTATION_POLICIES[normalizeProductCategory(category)] });
}

export function resolvePublishSpecTemplateKeyword(
  policy: PublishCategoryMutationPolicy,
  title?: string
): string {
  if (policy.specTemplateSelection === "buy_two_get_one") return SPEC_TEMPLATE_KEYWORD_DEFAULT;
  return (title || "").includes(SPEC_TEMPLATE_KEYWORD_JIUGUANG)
    ? SPEC_TEMPLATE_KEYWORD_JIUGUANG
    : SPEC_TEMPLATE_KEYWORD_DEFAULT;
}
