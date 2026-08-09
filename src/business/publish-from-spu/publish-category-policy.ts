import { normalizeProductCategory, type ProductCategory } from "../../autolist/product-category.js";

export type CategoryAttributeMutationPolicy =
  | "fill_model_spec"
  | "fill_health_food_fields"
  | "leave_platform_state";

export type SpecificationMutationPolicy = "apply_controlled_template" | "leave_platform_state";
export type SubmitValidationPolicy = "generic_fill_check" | "health_food_packaging_gate";

export interface PublishCategoryMutationPolicy {
  readonly categoryAttributes: CategoryAttributeMutationPolicy;
  readonly specification: SpecificationMutationPolicy;
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
    specification: "apply_controlled_template",
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
    specification: "leave_platform_state",
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
    specification: "apply_controlled_template",
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
    if (policy.categoryAttributes === "leave_platform_state" && policy.specification !== "leave_platform_state") {
      throw new Error(`${category} cannot leave category attributes unchanged while mutating specification values.`);
    }
  }
}

assertPublishCategoryPolicyIsolation(CATEGORY_MUTATION_POLICIES);

export function getPublishCategoryMutationPolicy(category: string | undefined): PublishCategoryMutationPolicy {
  return Object.freeze({ ...CATEGORY_MUTATION_POLICIES[normalizeProductCategory(category)] });
}
