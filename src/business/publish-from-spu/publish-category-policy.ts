import { normalizeProductCategory, type ProductCategory } from "../../autolist/product-category.js";

export type CategoryAttributeMutationPolicy =
  | "fill_model_spec"
  | "fill_health_food_fields"
  | "leave_platform_state";

export type SpecificationMutationPolicy = "apply_controlled_template" | "leave_platform_state";

export interface PublishCategoryMutationPolicy {
  categoryAttributes: CategoryAttributeMutationPolicy;
  specification: SpecificationMutationPolicy;
}

const CATEGORY_MUTATION_POLICIES: Record<ProductCategory, PublishCategoryMutationPolicy> = {
  医疗器械: {
    categoryAttributes: "fill_model_spec",
    specification: "apply_controlled_template"
  },
  非处方药: {
    categoryAttributes: "leave_platform_state",
    specification: "leave_platform_state"
  },
  保健食品: {
    categoryAttributes: "fill_health_food_fields",
    specification: "apply_controlled_template"
  }
};

export function getPublishCategoryMutationPolicy(category: string | undefined): PublishCategoryMutationPolicy {
  return { ...CATEGORY_MUTATION_POLICIES[normalizeProductCategory(category)] };
}
