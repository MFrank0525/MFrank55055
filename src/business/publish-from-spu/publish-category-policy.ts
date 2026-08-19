import { normalizeProductCategory, type ProductCategory } from "../../autolist/product-category.js";
import type { PlatformSpuSpecificationMatchPolicy } from "./platform-spu-query-rules.js";

export type CategoryAttributeMutationPolicy =
  | "fill_model_spec"
  | "fill_health_food_fields"
  | "leave_platform_state";

export type SpecTemplateSelectionPolicy = "feishu_exact";
export type ServiceSpuVerificationPolicy = "medical_registration" | "drug_approval_number" | "none";
export type ServiceAfterSalesPolicy = "unsupported_seven_day_returns" | "preserve_platform_state";
export type SubmitValidationPolicy = "generic_fill_check" | "health_food_packaging_gate";

export interface PublishCategoryMutationPolicy {
  readonly platformSpuSpecificationMatch: PlatformSpuSpecificationMatchPolicy;
  readonly categoryAttributes: CategoryAttributeMutationPolicy;
  readonly specTemplateSelection: SpecTemplateSelectionPolicy;
  readonly guardUnexpectedBasicFieldChanges: boolean;
  readonly healthFoodSafetyAndCategoryAttributes: boolean;
  readonly healthFoodShippingBeforeSpecification: boolean;
  readonly healthFoodSpecification: boolean;
  readonly serviceSpuVerification: ServiceSpuVerificationPolicy;
  readonly serviceAfterSalesPolicy: ServiceAfterSalesPolicy;
  readonly healthFoodPackagingLabel: boolean;
  readonly medicalDeviceCertificate: boolean;
  readonly submitValidation: SubmitValidationPolicy;
}

const CATEGORY_MUTATION_POLICIES: Record<ProductCategory, PublishCategoryMutationPolicy> = {
  医疗器械: {
    platformSpuSpecificationMatch: "ignore",
    categoryAttributes: "fill_model_spec",
    specTemplateSelection: "feishu_exact",
    guardUnexpectedBasicFieldChanges: true,
    healthFoodSafetyAndCategoryAttributes: false,
    healthFoodShippingBeforeSpecification: false,
    healthFoodSpecification: false,
    serviceSpuVerification: "medical_registration",
    serviceAfterSalesPolicy: "preserve_platform_state",
    healthFoodPackagingLabel: false,
    medicalDeviceCertificate: true,
    submitValidation: "generic_fill_check"
  },
  非处方药: {
    platformSpuSpecificationMatch: "require_exact",
    categoryAttributes: "leave_platform_state",
    specTemplateSelection: "feishu_exact",
    guardUnexpectedBasicFieldChanges: true,
    healthFoodSafetyAndCategoryAttributes: false,
    healthFoodShippingBeforeSpecification: false,
    healthFoodSpecification: false,
    serviceSpuVerification: "drug_approval_number",
    serviceAfterSalesPolicy: "unsupported_seven_day_returns",
    healthFoodPackagingLabel: false,
    medicalDeviceCertificate: false,
    submitValidation: "generic_fill_check"
  },
  保健食品: {
    platformSpuSpecificationMatch: "ignore",
    categoryAttributes: "fill_health_food_fields",
    specTemplateSelection: "feishu_exact",
    guardUnexpectedBasicFieldChanges: false,
    healthFoodSafetyAndCategoryAttributes: true,
    healthFoodShippingBeforeSpecification: true,
    healthFoodSpecification: true,
    serviceSpuVerification: "none",
    serviceAfterSalesPolicy: "preserve_platform_state",
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
    const otcServiceActions = [
      policy.serviceSpuVerification === "drug_approval_number",
      policy.serviceAfterSalesPolicy === "unsupported_seven_day_returns"
    ];
    if (otcServiceActions.some(Boolean) && !otcServiceActions.every(Boolean)) {
      throw new Error(`${category} contains a partially enabled OTC service-fulfillment action chain.`);
    }
  }
}

assertPublishCategoryPolicyIsolation(CATEGORY_MUTATION_POLICIES);

export function getPublishCategoryMutationPolicy(category: string | undefined): PublishCategoryMutationPolicy {
  return Object.freeze({ ...CATEGORY_MUTATION_POLICIES[normalizeProductCategory(category)] });
}

export function resolvePublishSpecTemplateKeyword(
  policy: PublishCategoryMutationPolicy,
  feishuSpecTemplate?: string
): string {
  if (policy.specTemplateSelection !== "feishu_exact") {
    throw new Error(`Unsupported specification-template selection policy: ${String(policy.specTemplateSelection)}`);
  }
  const value = (feishuSpecTemplate || "").trim();
  if (!value) {
    throw new Error("Missing required Feishu field: specTemplate");
  }
  return value;
}
