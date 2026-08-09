import assert from "node:assert/strict";
import fs from "node:fs";
import { getProductCategoryPlan } from "../dist/src/autolist/product-category.js";
import { getPublishCategoryMutationPolicy } from "../dist/src/business/publish-from-spu/publish-category-policy.js";

const expected = {
  医疗器械: {
    shops: 20,
    imagesPerShop: 1,
    policy: {
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
    }
  },
  非处方药: {
    shops: 5,
    imagesPerShop: 4,
    policy: {
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
    }
  },
  保健食品: {
    shops: 20,
    imagesPerShop: 1,
    policy: {
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
  }
};

for (const [category, contract] of Object.entries(expected)) {
  const plan = getProductCategoryPlan(category);
  assert.equal(plan.shopCodes.length, contract.shops, `${category} shop count drifted`);
  assert.equal(plan.imagesPerShop, contract.imagesPerShop, `${category} image distribution drifted`);
  const policy = getPublishCategoryMutationPolicy(category);
  assert.deepEqual(policy, contract.policy, `${category} action policy drifted`);
  assert.equal(Object.isFrozen(policy), true, `${category} action policy must be immutable at runtime`);
}

const actionFiles = [
  "src/business/publish-from-spu/actions/basic-info-action.ts",
  "src/business/publish-from-spu/actions/spec-price-action.ts",
  "src/business/publish-from-spu/actions/service-action.ts",
  "src/business/publish-from-spu/actions/submit-action.ts"
];
for (const file of actionFiles) {
  const source = fs.readFileSync(file, "utf8");
  assert.doesNotMatch(
    source,
    /productCategory\s*[!=]==?\s*"(?:医疗器械|非处方药|保健食品)"/,
    `${file} must consume the centralized category policy instead of branching on category names`
  );
  assert.match(source, /mutationPolicy/, `${file} must consume the centralized category policy`);
}

const policySource = fs.readFileSync("src/business/publish-from-spu/publish-category-policy.ts", "utf8");
assert.match(policySource, /assertPublishCategoryPolicyIsolation/);
assert.match(policySource, /medicalDeviceCertificate[\s\S]*healthFoodPackagingLabel/);

console.log("publish category isolation rule passed");
