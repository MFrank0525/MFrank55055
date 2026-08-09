import assert from "node:assert/strict";
import fs from "node:fs";
import { getPublishCategoryMutationPolicy } from "../dist/src/business/publish-from-spu/publish-category-policy.js";
import { assertResolvedMetadata, resolvePublishFromSpuMetadata } from "../dist/src/business/publish-from-spu/metadata-resolution.js";

const otc = getPublishCategoryMutationPolicy("非处方药");
assert.equal(otc.categoryAttributes, "leave_platform_state");
assert.equal(otc.specification, "leave_platform_state");
assert.equal(otc.healthFoodSafetyAndCategoryAttributes, false);
assert.equal(otc.healthFoodPackagingLabel, false);
assert.equal(otc.medicalDeviceCertificate, false);

const medical = getPublishCategoryMutationPolicy("医疗器械");
assert.equal(medical.categoryAttributes, "fill_model_spec");
assert.equal(medical.specification, "apply_controlled_template");

const healthFood = getPublishCategoryMutationPolicy("保健食品");
assert.equal(healthFood.categoryAttributes, "fill_health_food_fields");
assert.equal(healthFood.specification, "apply_controlled_template");

const resolvedOtc = resolvePublishFromSpuMetadata({
  metadataOverride: { productCategory: "非处方药" },
  workbook: {
    brand: "延草纲目",
    spu: "SPU-OTC-001",
    title: "测试非处方药标题",
    shortTitle: "测试短标题",
    modelSpec: "",
    productPriceText: "40,30,20,10"
  }
});
assert.equal(resolvedOtc.modelSpec, "", "OTC must not synthesize a category-attribute/model-spec value");
assert.doesNotThrow(() => assertResolvedMetadata(resolvedOtc, "publish_from_spu"));

const publishFlowSource = fs.readFileSync("src/business/publish-from-spu/publish-flow.ts", "utf8");
assert.match(
  publishFlowSource,
  /getPublishCategoryMutationPolicy\(productCategory\)[\s\S]*categoryAttributes === "fill_model_spec"[\s\S]*modelSpec: metadata\.modelSpec/,
  "basic metadata must include modelSpec only when the category mutation policy permits it"
);

const specActionSource = fs.readFileSync("src/business/publish-from-spu/actions/spec-price-action.ts", "utf8");
assert.match(
  specActionSource,
  /input\.categoryContext\.mutationPolicy\.specification === "apply_controlled_template"[\s\S]*deps\.applyFixedSpecsOnPage/,
  "spec action must apply templates only under the explicit category mutation policy"
);
assert.match(
  specActionSource,
  /specification === "leave_platform_state"[\s\S]*leave_specification_unchanged/,
  "OTC spec action must explicitly record that the platform specification was left unchanged"
);

console.log("OTC publish policy rule passed");
